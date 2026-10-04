-- High-weight silver granule payment approval
-- > 10g buy orders must not receive the default bank details.
-- They remain pending until an admin records per-order payment information.

CREATE OR REPLACE FUNCTION public.submit_order(
  p_quote jsonb,
  p_weight numeric,
  p_name text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_quote_id uuid;
  v_quote public.quote_tokens%rowtype;
  v_product public.products%rowtype;
  v_market public.market_settings%rowtype;
  v_system public.system_settings%rowtype;
  v_current_price numeric;
  v_total numeric;
  v_order_id bigint;
  v_order_number text;
  v_sell_valid_until timestamptz;
  v_status text;
  v_now timestamptz := now();
  v_bank_snapshot jsonb;
  v_now_time time;
  v_close_start time;
  v_close_end time;
  v_market_closed boolean := false;
  v_existing public.orders%rowtype;
  v_requires_payment_approval boolean := false;
begin
  if p_quote ? 'id' and not (p_quote ? 'quote') then
    p_quote := jsonb_build_object('ok', true, 'quote', p_quote);
  end if;

  if p_quote is null or jsonb_typeof(p_quote) <> 'object'
     or coalesce((p_quote ->> 'ok')::boolean,false) <> true then
    return jsonb_build_object('ok',false,'reason','invalid_quote');
  end if;

  begin
    v_quote_id := (p_quote #>> '{quote,id}')::uuid;
  exception when others then
    return jsonb_build_object('ok',false,'reason','invalid_quote');
  end;

  select * into v_quote
  from public.quote_tokens
  where id=v_quote_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','quote_not_found');
  end if;

  if v_quote.used_at is not null then
    if v_quote.order_id is not null then
      select * into v_existing from public.orders where id=v_quote.order_id;
      if found then
        return jsonb_build_object(
          'ok',true,
          'order',jsonb_build_object(
            'id',v_existing.id,
            'orderNumber',v_existing.order_number,
            'order_number',v_existing.order_number,
            'type',v_existing.type,
            'purity',v_existing.purity,
            'weight',v_existing.weight,
            'pricePerGram',v_existing.price_per_gram,
            'price_per_gram',v_existing.price_per_gram,
            'total',v_existing.total,
            'approxTotal',v_existing.approx_total,
            'approx_total',v_existing.approx_total,
            'name',v_existing.name,
            'phone',v_existing.phone,
            'createdAt',v_existing.created_at,
            'created_at',v_existing.created_at,
            'lockExpiresAt',v_existing.lock_expires_at,
            'lock_expires_at',v_existing.lock_expires_at,
            'sellValidUntil',v_existing.sell_valid_until,
            'sell_valid_until',v_existing.sell_valid_until,
            'status',v_existing.status,
            'requiresPaymentApproval',
              (v_existing.type = 'buy' and v_existing.weight > 10 and v_existing.status = 'در انتظار تأیید کارشناس'),
            'bankSnapshot',v_existing.bank_snapshot,
            'bank_snapshot',v_existing.bank_snapshot
          )
        );
      end if;
    end if;
    return jsonb_build_object('ok',false,'reason','quote_already_used');
  end if;

  if v_quote.expires_at <= v_now then
    return jsonb_build_object(
      'ok',false,
      'reason','اعتبار قیمت تمام شده است. لطفاً قیمت جدید دریافت کنید.',
      'code','quote_expired'
    );
  end if;

  if p_name is null or trim(p_name)='' or p_phone is null or trim(p_phone)='' then
    return jsonb_build_object('ok',false,'reason','invalid_customer');
  end if;

  if p_weight is null or p_weight<=0 then
    return jsonb_build_object('ok',false,'reason','invalid_weight');
  end if;

  select * into v_product
  from public.products
  where key=v_quote.product_key
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','product_not_found');
  end if;

  if v_quote.mode='buy' and not v_product.buy_active then
    return jsonb_build_object('ok',false,'reason','buy_disabled');
  end if;

  if v_quote.mode='sell' and not v_product.sell_active then
    return jsonb_build_object('ok',false,'reason','sell_disabled');
  end if;

  if p_weight<v_product.min_weight or p_weight>v_product.max_weight then
    return jsonb_build_object(
      'ok',false,
      'reason','weight_out_of_range',
      'minWeight',v_product.min_weight,
      'maxWeight',v_product.max_weight
    );
  end if;

  select * into v_market
  from public.market_settings
  order by id
  limit 1;

  if v_market.id is null then
    return jsonb_build_object('ok',false,'reason','market_settings_not_configured');
  end if;

  if coalesce(v_market.emergency_stop,false) then
    return jsonb_build_object('ok',false,'reason','emergency_stop');
  end if;

  if v_quote.mode='buy' and not coalesce(v_market.buy_enabled,true) then
    return jsonb_build_object('ok',false,'reason','buy_disabled');
  end if;

  if v_quote.mode='sell' and not coalesce(v_market.sell_enabled,true) then
    return jsonb_build_object('ok',false,'reason','sell_disabled');
  end if;

  if v_market.close_start is not null and v_market.close_end is not null then
    v_close_start:=v_market.close_start::time;
    v_close_end:=v_market.close_end::time;
    v_now_time:=(v_now at time zone 'Asia/Tehran')::time;

    if v_close_start<v_close_end then
      v_market_closed:=v_now_time>=v_close_start and v_now_time<v_close_end;
    elsif v_close_start>v_close_end then
      v_market_closed:=v_now_time>=v_close_start or v_now_time<v_close_end;
    end if;
  end if;

  if v_market_closed then
    return jsonb_build_object(
      'ok',false,
      'reason','بازار بسته است. ثبت سفارش در این ساعت امکان‌پذیر نیست.',
      'code','market_closed'
    );
  end if;

  if v_quote.mode='buy' then
    v_current_price:=v_product.buy_price;
  else
    v_current_price:=v_product.sell_price;
  end if;

  if v_current_price is null or v_current_price<=0 then
    return jsonb_build_object('ok',false,'reason','price_not_set');
  end if;

  if v_quote.price<>v_current_price then
    return jsonb_build_object(
      'ok',false,
      'reason','price_changed',
      'currentPrice',v_current_price
    );
  end if;

  select * into v_system
  from public.system_settings
  order by id
  limit 1
  for update;

  if v_system.id is null then
    return jsonb_build_object('ok',false,'reason','system_settings_not_configured');
  end if;

  v_total:=p_weight*v_current_price;

  if v_quote.mode='buy' then
    v_requires_payment_approval := p_weight > 10;
    if v_requires_payment_approval then
      v_status:='در انتظار تأیید کارشناس';
      v_bank_snapshot:=null;
    else
      v_status:='در انتظار پرداخت';
      v_bank_snapshot:=jsonb_build_object(
        'cardNumber',coalesce(v_system.bank_card_number,''),
        'accountNumber',coalesce(v_system.bank_account_number,''),
        'sheba',coalesce(v_system.bank_sheba,''),
        'ownerName',coalesce(v_system.bank_owner_name,''),
        'sellAddress',coalesce(v_system.sell_address,'')
      );
    end if;
    v_sell_valid_until:=null;
  else
    v_status:='درخواست جدید';
    v_sell_valid_until:=v_now+make_interval(
      days=>coalesce(nullif(v_system.sell_validity_days,0),3)
    );
    v_bank_snapshot:=jsonb_build_object(
      'cardNumber',coalesce(v_system.bank_card_number,''),
      'accountNumber',coalesce(v_system.bank_account_number,''),
      'sheba',coalesce(v_system.bank_sheba,''),
      'ownerName',coalesce(v_system.bank_owner_name,''),
      'sellAddress',coalesce(v_system.sell_address,'')
    );
  end if;

  if v_system.next_order_seq is null or v_system.next_order_seq<=0 then
    return jsonb_build_object('ok',false,'reason','order_sequence_not_configured');
  end if;

  v_order_number:='SP-'||v_system.next_order_seq::text;

  update public.system_settings
  set next_order_seq=next_order_seq+1
  where id=v_system.id;

  insert into public.orders(
    type,purity,weight,price_per_gram,total,approx_total,
    name,phone,created_at,lock_expires_at,sell_valid_until,
    bank_snapshot,status,order_number
  )
  values(
    v_quote.mode,v_quote.product_key,p_weight,v_current_price,
    v_total,v_total,trim(p_name),trim(p_phone),v_now,
    v_quote.expires_at,v_sell_valid_until,v_bank_snapshot,
    v_status,v_order_number
  )
  returning id into v_order_id;

  insert into public.order_history(order_id,status,created_at)
  values(v_order_id,v_status,v_now);

  update public.quote_tokens
  set used_at=v_now, order_id=v_order_id
  where id=v_quote_id;

  begin
    insert into public.order_email_jobs(order_id) values(v_order_id);
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok',true,
    'order',jsonb_build_object(
      'id',v_order_id,
      'orderNumber',v_order_number,
      'order_number',v_order_number,
      'type',v_quote.mode,
      'purity',v_quote.product_key,
      'weight',p_weight,
      'pricePerGram',v_current_price,
      'price_per_gram',v_current_price,
      'total',v_total,
      'approxTotal',v_total,
      'approx_total',v_total,
      'name',trim(p_name),
      'phone',trim(p_phone),
      'createdAt',v_now,
      'created_at',v_now,
      'lockExpiresAt',v_quote.expires_at,
      'lock_expires_at',v_quote.expires_at,
      'sellValidUntil',v_sell_valid_until,
      'sell_valid_until',v_sell_valid_until,
      'status',v_status,
      'requiresPaymentApproval',v_requires_payment_approval,
      'bankSnapshot',v_bank_snapshot,
      'bank_snapshot',v_bank_snapshot
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_high_weight_order(
  p_order_id bigint,
  p_payment jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_payment jsonb;
  v_has_destination boolean;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok',false,'reason','not_admin');
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','order_not_found');
  end if;

  if v_order.type <> 'buy' or coalesce(v_order.weight,0) <= 10 then
    return jsonb_build_object('ok',false,'reason','not_high_weight_order');
  end if;

  if v_order.status <> 'در انتظار تأیید کارشناس' then
    return jsonb_build_object('ok',false,'reason','order_not_pending_approval');
  end if;

  v_payment := jsonb_build_object(
    'cardNumber', trim(coalesce(p_payment->>'cardNumber','')),
    'accountNumber', trim(coalesce(p_payment->>'accountNumber','')),
    'sheba', regexp_replace(trim(coalesce(p_payment->>'sheba','')), '^IR', '', 'i'),
    'ownerName', trim(coalesce(p_payment->>'ownerName','')),
    'description', trim(coalesce(p_payment->>'description',''))
  );

  v_has_destination :=
    coalesce(v_payment->>'cardNumber','') <> ''
    or coalesce(v_payment->>'accountNumber','') <> ''
    or coalesce(v_payment->>'sheba','') <> '';

  if not v_has_destination or coalesce(v_payment->>'ownerName','') = '' then
    return jsonb_build_object('ok',false,'reason','payment_info_incomplete');
  end if;

  update public.orders
  set bank_snapshot = v_payment,
      status = 'در انتظار پرداخت'
  where id = p_order_id;

  insert into public.order_history(order_id,status,created_at)
  values(p_order_id,'در انتظار پرداخت',now());

  insert into public.activity_log(action,detail,created_at)
  values(
    'approve_high_weight_order',
    jsonb_build_object(
      'orderId',p_order_id,
      'weight',v_order.weight,
      'status','در انتظار پرداخت'
    )::text,
    now()
  );

  return jsonb_build_object(
    'ok',true,
    'orderId',p_order_id,
    'status','در انتظار پرداخت',
    'bankSnapshot',v_payment
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_high_weight_order(bigint,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_high_weight_order(bigint,jsonb) TO authenticated;

-- Prevent the generic status dropdown from bypassing payment-info approval.
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id bigint,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  IF p_status NOT IN (
    'در انتظار تأیید کارشناس',
    'در انتظار پرداخت',
    'در انتظار تأیید پرداخت',
    'پرداخت تأیید شد',
    'پرداخت رد شد',
    'تکمیل شد',
    'لغو شد',
    'درخواست جدید',
    'منتظر دریافت ساچمه',
    'ساچمه دریافت شد',
    'در حال بررسی',
    'وزن نهایی ثبت شد',
    'مبلغ نهایی تعیین شد',
    'پرداخت شد'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status');
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  IF v_order.type = 'buy'
     AND coalesce(v_order.weight,0) > 10
     AND v_order.status = 'در انتظار تأیید کارشناس'
     AND p_status <> 'لغو شد' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'high_weight_requires_payment_approval'
    );
  END IF;

  UPDATE public.orders
  SET status = p_status
  WHERE id = p_order_id;

  INSERT INTO public.order_history(order_id,status,created_at)
  VALUES(p_order_id,p_status,now());

  INSERT INTO public.activity_log(action,detail,created_at)
  VALUES(
    'update_order_status',
    jsonb_build_object(
      'orderId',p_order_id,
      'oldStatus',v_order.status,
      'newStatus',p_status
    )::text,
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'status', p_status
  );
END;
$function$;
