-- Add an amount to every high-weight payment destination.
-- cards/shebas are stored as [{number, amount}] inside the existing bank_snapshot JSONB.

create or replace function public.approve_high_weight_order(p_order_id bigint, p_payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_payment jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_shebas jsonb := '[]'::jsonb;
  v_owner text;
  v_description text;
  v_payment_total numeric := 0;
  v_order_total numeric := 0;
  v_item jsonb;
  v_number text;
  v_amount numeric;
begin
  if not public.is_admin() then return jsonb_build_object('ok',false,'reason','not_admin'); end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
  if v_order.type <> 'buy' or coalesce(v_order.weight,0) <= (select high_weight_threshold from public.system_settings order by id desc limit 1) then
    return jsonb_build_object('ok',false,'reason','not_high_weight_order');
  end if;
  if v_order.status <> 'در انتظار تأیید کارشناس' then return jsonb_build_object('ok',false,'reason','order_not_pending_approval'); end if;

  v_owner := trim(coalesce(p_payment->>'ownerName',''));
  v_description := trim(coalesce(p_payment->>'description',''));
  v_order_total := coalesce(v_order.total, v_order.approx_total, 0);

  if jsonb_typeof(p_payment->'cards') = 'array' then
    for v_item in select value from jsonb_array_elements(p_payment->'cards')
    loop
      if jsonb_typeof(v_item) = 'object' then
        v_number := regexp_replace(trim(coalesce(v_item->>'number','')),'\D','','g');
        v_amount := coalesce(nullif(v_item->>'amount','')::numeric,0);
        if v_number <> '' then
          if v_amount <= 0 then return jsonb_build_object('ok',false,'reason','payment_amount_incomplete'); end if;
          v_cards := v_cards || jsonb_build_array(jsonb_build_object('number',v_number,'amount',v_amount));
          v_payment_total := v_payment_total + v_amount;
        end if;
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_payment->'shebas') = 'array' then
    for v_item in select value from jsonb_array_elements(p_payment->'shebas')
    loop
      if jsonb_typeof(v_item) = 'object' then
        v_number := regexp_replace(regexp_replace(trim(coalesce(v_item->>'number','')),'^IR','','i'),'\D','','g');
        v_amount := coalesce(nullif(v_item->>'amount','')::numeric,0);
        if v_number <> '' then
          if v_amount <= 0 then return jsonb_build_object('ok',false,'reason','payment_amount_incomplete'); end if;
          v_shebas := v_shebas || jsonb_build_array(jsonb_build_object('number',v_number,'amount',v_amount));
          v_payment_total := v_payment_total + v_amount;
        end if;
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_cards) = 0 and jsonb_array_length(v_shebas) = 0 and trim(coalesce(p_payment->>'accountNumber','')) = '' then
    return jsonb_build_object('ok',false,'reason','payment_info_incomplete');
  end if;
  if v_owner = '' then return jsonb_build_object('ok',false,'reason','payment_info_incomplete'); end if;
  if v_payment_total <> v_order_total then return jsonb_build_object('ok',false,'reason','payment_amount_total_mismatch','orderTotal',v_order_total,'paymentTotal',v_payment_total); end if;

  v_payment := jsonb_build_object(
    'cards',v_cards,'shebas',v_shebas,
    'cardNumber',coalesce((v_cards->0)->>'number',''),'sheba',coalesce((v_shebas->0)->>'number',''),
    'accountNumber',trim(coalesce(p_payment->>'accountNumber','')),
    'ownerName',v_owner,'description',v_description
  );
  update public.orders set bank_snapshot = v_payment where id = p_order_id;
  insert into public.order_history(order_id,status,created_at) values(p_order_id,'در انتظار پرداخت',now());
  insert into public.activity_log(action,detail,created_at)
  values('approve_high_weight_order',jsonb_build_object('orderId',p_order_id,'weight',v_order.weight,'status','در انتظار پرداخت','paymentTotal',v_payment_total)::text,now());
  return jsonb_build_object('ok',true,'orderId',p_order_id,'status','در انتظار پرداخت','bankSnapshot',v_payment);
end;
$function$;

create or replace function public.set_high_weight_payment_info(p_order_id bigint, p_payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_payment jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_shebas jsonb := '[]'::jsonb;
  v_owner text;
  v_description text;
  v_payment_total numeric := 0;
  v_order_total numeric := 0;
  v_item jsonb;
  v_number text;
  v_amount numeric;
begin
  if not public.is_admin() then return jsonb_build_object('ok',false,'reason','not_admin'); end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
  if v_order.type <> 'buy' or coalesce(v_order.weight,0) <= (select high_weight_threshold from public.system_settings order by id desc limit 1) then
    return jsonb_build_object('ok',false,'reason','not_high_weight_order');
  end if;
  if v_order.status <> 'در انتظار پرداخت' then return jsonb_build_object('ok',false,'reason','order_not_waiting_for_payment'); end if;

  v_owner := trim(coalesce(p_payment->>'ownerName',''));
  v_description := trim(coalesce(p_payment->>'description',''));
  v_order_total := coalesce(v_order.total, v_order.approx_total, 0);

  if jsonb_typeof(p_payment->'cards') = 'array' then
    for v_item in select value from jsonb_array_elements(p_payment->'cards')
    loop
      if jsonb_typeof(v_item) = 'object' then
        v_number := regexp_replace(trim(coalesce(v_item->>'number','')),'\D','','g');
        v_amount := coalesce(nullif(v_item->>'amount','')::numeric,0);
        if v_number <> '' then
          if v_amount <= 0 then return jsonb_build_object('ok',false,'reason','payment_amount_incomplete'); end if;
          v_cards := v_cards || jsonb_build_array(jsonb_build_object('number',v_number,'amount',v_amount));
          v_payment_total := v_payment_total + v_amount;
        end if;
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_payment->'shebas') = 'array' then
    for v_item in select value from jsonb_array_elements(p_payment->'shebas')
    loop
      if jsonb_typeof(v_item) = 'object' then
        v_number := regexp_replace(regexp_replace(trim(coalesce(v_item->>'number','')),'^IR','','i'),'\D','','g');
        v_amount := coalesce(nullif(v_item->>'amount','')::numeric,0);
        if v_number <> '' then
          if v_amount <= 0 then return jsonb_build_object('ok',false,'reason','payment_amount_incomplete'); end if;
          v_shebas := v_shebas || jsonb_build_array(jsonb_build_object('number',v_number,'amount',v_amount));
          v_payment_total := v_payment_total + v_amount;
        end if;
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_cards) = 0 and jsonb_array_length(v_shebas) = 0 and trim(coalesce(p_payment->>'accountNumber','')) = '' then
    return jsonb_build_object('ok',false,'reason','payment_info_incomplete');
  end if;
  if v_owner = '' then return jsonb_build_object('ok',false,'reason','payment_info_incomplete'); end if;
  if v_payment_total <> v_order_total then return jsonb_build_object('ok',false,'reason','payment_amount_total_mismatch','orderTotal',v_order_total,'paymentTotal',v_payment_total); end if;

  v_payment := jsonb_build_object(
    'cards',v_cards,'shebas',v_shebas,
    'cardNumber',coalesce((v_cards->0)->>'number',''),'sheba',coalesce((v_shebas->0)->>'number',''),
    'accountNumber',trim(coalesce(p_payment->>'accountNumber','')),
    'ownerName',v_owner,'description',v_description
  );
  update public.orders set bank_snapshot = v_payment where id = p_order_id;
  insert into public.activity_log(action,detail,created_at)
  values('set_high_weight_payment_info',jsonb_build_object('orderId',p_order_id,'status',v_order.status,'paymentTotal',v_payment_total)::text,now());
  return jsonb_build_object('ok',true,'orderId',p_order_id,'status',v_order.status,'bankSnapshot',v_payment);
end;
$function$;

revoke execute on function public.set_high_weight_payment_info(bigint,jsonb) from public;
grant execute on function public.set_high_weight_payment_info(bigint,jsonb) to authenticated;
