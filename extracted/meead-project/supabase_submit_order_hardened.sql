-- MEEAD ACCESSORIES
-- Hardened submit_order: restores server-side market-hours validation and
-- uses Iran time (Asia/Tehran) for the configured close window.
-- Run this once in Supabase SQL Editor before production.

CREATE OR REPLACE FUNCTION public.submit_order(
  p_quote jsonb,
  p_weight numeric,
  p_name text,
  p_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote_id uuid;
  v_purity_key text;
  v_mode text;
  v_price numeric;
  v_expires_at timestamptz;
  v_quote record;
  v_product public.products%ROWTYPE;
  v_market public.market_settings%ROWTYPE;
  v_system public.system_settings%ROWTYPE;
  v_weight numeric := p_weight;
  v_total numeric;
  v_order_number text;
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_tehran_time time;
  v_close_start time;
  v_close_end time;
  v_closed boolean := false;
BEGIN
  v_quote_id := (p_quote->>'id')::uuid;
  v_purity_key := p_quote->>'purityKey';
  v_mode := lower(p_quote->>'mode');
  v_price := (p_quote->>'pricePerGram')::numeric;
  v_expires_at := (p_quote->>'expiresAt')::timestamptz;

  IF v_mode NOT IN ('buy','sell') THEN
    RETURN jsonb_build_object('ok',false,'reason','نوع معامله نامعتبر است');
  END IF;
  IF v_purity_key IS NULL OR v_price IS NULL OR v_expires_at IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','قیمت قفل‌شده نامعتبر است');
  END IF;
  IF v_now >= v_expires_at THEN
    RETURN jsonb_build_object('ok',false,'reason','زمان اعتبار قیمت تمام شده — قیمت جدید بگیرید');
  END IF;

  SELECT * INTO v_quote
  FROM public.quote_tokens
  WHERE id = v_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','قیمت قفل‌شده پیدا نشد');
  END IF;
  IF v_quote.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','این قیمت قبلاً استفاده شده است');
  END IF;
  IF v_quote.product_key <> v_purity_key OR v_quote.mode <> v_mode OR v_quote.price <> v_price THEN
    RETURN jsonb_build_object('ok',false,'reason','قیمت قفل‌شده معتبر نیست');
  END IF;
  IF v_now >= v_quote.expires_at THEN
    RETURN jsonb_build_object('ok',false,'reason','زمان اعتبار قیمت تمام شده — قیمت جدید بگیرید');
  END IF;

  SELECT * INTO v_product FROM public.products WHERE key = v_purity_key FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','محصول پیدا نشد');
  END IF;

  IF v_mode = 'buy' AND NOT v_product.buy_active THEN
    RETURN jsonb_build_object('ok',false,'reason','این محصول در حال حاضر غیرفعال است');
  END IF;
  IF v_mode = 'sell' AND NOT v_product.sell_active THEN
    RETURN jsonb_build_object('ok',false,'reason','این محصول در حال حاضر غیرفعال است');
  END IF;

  SELECT * INTO v_market
  FROM public.market_settings
  ORDER BY id DESC LIMIT 1;

  IF COALESCE(v_market.emergency_stop,false) THEN
    RETURN jsonb_build_object('ok',false,'reason','معاملات به‌طور موقت متوقف شده است');
  END IF;
  IF v_mode = 'buy' AND NOT COALESCE(v_market.buy_enabled,true) THEN
    RETURN jsonb_build_object('ok',false,'reason','خرید در حال حاضر غیرفعال است');
  END IF;
  IF v_mode = 'sell' AND NOT COALESCE(v_market.sell_enabled,true) THEN
    RETURN jsonb_build_object('ok',false,'reason','فروش در حال حاضر غیرفعال است');
  END IF;

  IF v_market.close_start IS NOT NULL AND v_market.close_end IS NOT NULL THEN
    v_tehran_time := (v_now AT TIME ZONE 'Asia/Tehran')::time;
    v_close_start := v_market.close_start::time;
    v_close_end := v_market.close_end::time;
    IF v_close_start <> v_close_end THEN
      IF v_close_start < v_close_end THEN
        v_closed := v_tehran_time >= v_close_start AND v_tehran_time < v_close_end;
      ELSE
        v_closed := v_tehran_time >= v_close_start OR v_tehran_time < v_close_end;
      END IF;
    END IF;
  END IF;
  IF v_closed THEN
    RETURN jsonb_build_object('ok',false,'reason',format('بازار بسته است — ساعات فعالیت: %s تا %s',v_market.close_end,v_market.close_start));
  END IF;

  IF v_mode = 'buy' THEN
    IF v_product.buy_price <= 0 OR v_product.buy_price <> v_price THEN
      RETURN jsonb_build_object('ok',false,'reason','قیمت تغییر کرده — لطفاً دوباره شروع کنید');
    END IF;
  ELSE
    IF v_product.sell_price <= 0 OR v_product.sell_price <> v_price THEN
      RETURN jsonb_build_object('ok',false,'reason','قیمت تغییر کرده — لطفاً دوباره شروع کنید');
    END IF;
  END IF;

  IF v_weight IS NULL OR v_weight <= 0 THEN
    RETURN jsonb_build_object('ok',false,'reason','وزن را وارد کنید');
  END IF;
  IF v_weight < v_product.min_weight OR v_weight > v_product.max_weight THEN
    RETURN jsonb_build_object('ok',false,'reason',format('وزن باید بین %s تا %s گرم باشد',v_product.min_weight,v_product.max_weight));
  END IF;
  IF NULLIF(trim(p_name),'') IS NULL OR NULLIF(trim(p_phone),'') IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','نام و شماره تماس را وارد کنید');
  END IF;

  SELECT * INTO v_system
  FROM public.system_settings
  ORDER BY id DESC LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.system_settings (price_lock_minutes,sell_validity_days,next_order_seq)
    VALUES (5,3,1058)
    RETURNING * INTO v_system;
  END IF;

  v_order_number := 'SP-' || v_system.next_order_seq::text;
  v_total := round(v_weight * v_price);

  IF v_mode = 'buy' THEN
    INSERT INTO public.orders (
      type,purity,weight,price_per_gram,total,name,phone,created_at,
      lock_expires_at,bank_snapshot,status,order_number
    ) VALUES (
      'buy',v_purity_key,v_weight,v_price,v_total,trim(p_name),trim(p_phone),v_now,
      v_quote.expires_at,jsonb_build_object(
        'cardNumber',coalesce(v_system.bank_card_number,''),
        'accountNumber',coalesce(v_system.bank_account_number,''),
        'sheba',coalesce(v_system.bank_sheba,''),
        'ownerName',coalesce(v_system.bank_owner_name,'')
      ),'در انتظار پرداخت',v_order_number
    ) RETURNING * INTO v_order;
  ELSE
    INSERT INTO public.orders (
      type,purity,weight,price_per_gram,approx_total,name,phone,created_at,
      sell_valid_until,final_price_per_gram,status,order_number
    ) VALUES (
      'sell',v_purity_key,v_weight,v_price,v_total,trim(p_name),trim(p_phone),v_now,
      v_now + make_interval(days => coalesce(v_system.sell_validity_days,3)),v_price,'درخواست جدید',v_order_number
    ) RETURNING * INTO v_order;
  END IF;

  UPDATE public.system_settings
  SET next_order_seq = v_system.next_order_seq + 1
  WHERE id = v_system.id;

  INSERT INTO public.order_history(order_id,status,created_at)
  VALUES (v_order.id,v_order.status,v_now);

  UPDATE public.quote_tokens SET used_at = v_now WHERE id = v_quote_id;

  RETURN jsonb_build_object('ok',true,'order',to_jsonb(v_order));
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok',false,'reason','اطلاعات قیمت یا زمان نامعتبر است');
  WHEN others THEN
    RETURN jsonb_build_object('ok',false,'reason','ثبت سفارش ناموفق بود');
END;
$$;
