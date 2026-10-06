alter table public.system_settings
  add column if not exists receipt_deadline_minutes integer not null default 30;

update public.system_settings
set receipt_deadline_minutes = 30
where receipt_deadline_minutes is null
   or receipt_deadline_minutes <= 0;

create or replace function public.update_receipt_deadline_minutes(p_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare v_id bigint;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 120 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_receipt_deadline_minutes');
  end if;
  select id into v_id from public.system_settings order by id desc limit 1 for update;
  if v_id is null then
    insert into public.system_settings (receipt_deadline_minutes) values (p_minutes);
  else
    update public.system_settings set receipt_deadline_minutes = p_minutes where id = v_id;
  end if;
  insert into public.activity_log(action, detail, created_at)
  values ('update_receipt_deadline_minutes', jsonb_build_object('receiptDeadlineMinutes', p_minutes)::text, now());
  return jsonb_build_object('ok', true, 'receiptDeadlineMinutes', p_minutes);
end;
$function$;

revoke execute on function public.update_receipt_deadline_minutes(integer) from public, anon;
grant execute on function public.update_receipt_deadline_minutes(integer) to authenticated;

create or replace function public.set_buy_receipt_deadline()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
declare v_minutes integer;
begin
  if new.type = 'buy' and new.status = 'در انتظار پرداخت'
     and (tg_op = 'INSERT' or old.status is distinct from new.status or new.receipt_deadline_at is null) then
    select coalesce(receipt_deadline_minutes, 30) into v_minutes
    from public.system_settings order by id desc limit 1;
    v_minutes := greatest(5, least(coalesce(v_minutes, 30), 120));
    new.receipt_deadline_at := now() + make_interval(mins => v_minutes);
  end if;
  return new;
end;
$function$;

create or replace function public.expire_pending_buy_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count integer := 0;
  v_order record;
  v_reason text;
  v_minutes integer;
begin
  select greatest(5, least(coalesce(receipt_deadline_minutes, 30), 120))
  into v_minutes from public.system_settings order by id desc limit 1;
  v_minutes := coalesce(v_minutes, 30);
  for v_order in
    select o.id, o.order_number, o.price_per_gram, o.receipt_deadline_at, p.buy_price as current_buy_price
    from public.orders o join public.products p on p.key = o.purity
    where o.type = 'buy' and o.status = 'در انتظار پرداخت'
      and ((o.receipt_deadline_at is not null and o.receipt_deadline_at <= now())
           or p.buy_price is distinct from o.price_per_gram)
    for update of o
  loop
    if v_order.current_buy_price is distinct from v_order.price_per_gram then
      v_reason := 'سفارش به دلیل تغییر نرخ خرید قبل از ارسال فیش منقضی شد.';
    else
      v_reason := format('سفارش به دلیل پایان مهلت %s دقیقه‌ای ارسال فیش منقضی شد.', v_minutes);
    end if;
    update public.orders set status = 'لغو شد', admin_note = v_reason
    where id = v_order.id and status = 'در انتظار پرداخت';
    if found then
      insert into public.order_history(order_id,status,created_at) values(v_order.id,'لغو شد',now());
      insert into public.activity_log(action,detail,created_at)
      values('expire_pending_buy_order', jsonb_build_object('orderId',v_order.id,'orderNumber',v_order.order_number,'reason',v_reason)::text, now());
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.attach_receipt(
  p_order_number text, p_phone text, p_receipt_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders%rowtype;
  v_current_price numeric;
  v_minutes integer;
  v_reason text;
begin
  if p_order_number is null or trim(p_order_number) = '' or p_phone is null or trim(p_phone) = '' or p_receipt_path is null or trim(p_receipt_path) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  select greatest(5, least(coalesce(receipt_deadline_minutes, 30), 120))
  into v_minutes from public.system_settings order by id desc limit 1;
  v_minutes := coalesce(v_minutes, 30);
  select * into v_order from public.orders
  where order_number = trim(p_order_number) and phone = trim(p_phone) limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;
  if v_order.type <> 'buy' then return jsonb_build_object('ok', false, 'reason', 'receipt_not_allowed'); end if;
  if v_order.status in ('لغو شد', 'تکمیل شد') then return jsonb_build_object('ok', false, 'reason', 'order_closed'); end if;
  if v_order.status = 'در انتظار پرداخت' then
    if v_order.receipt_deadline_at is null or v_order.receipt_deadline_at <= now() then
      v_reason := format('سفارش به دلیل پایان مهلت %s دقیقه‌ای ارسال فیش منقضی شد.', v_minutes);
      update public.orders set status = 'لغو شد', admin_note = v_reason
      where id = v_order.id and status = 'در انتظار پرداخت';
      if found then insert into public.order_history(order_id,status,created_at) values(v_order.id,'لغو شد',now()); end if;
      return jsonb_build_object('ok', false, 'reason', 'order_expired');
    end if;
    select p.buy_price into v_current_price from public.products p where p.key = v_order.purity limit 1;
    if v_current_price is null or v_current_price is distinct from v_order.price_per_gram then
      update public.orders set status = 'لغو شد', admin_note = 'سفارش به دلیل تغییر نرخ خرید قبل از ارسال فیش منقضی شد.'
      where id = v_order.id and status = 'در انتظار پرداخت';
      if found then insert into public.order_history(order_id,status,created_at) values(v_order.id,'لغو شد',now()); end if;
      return jsonb_build_object('ok', false, 'reason', 'price_changed', 'currentPrice', v_current_price);
    end if;
  end if;
  update public.orders set receipt_url = trim(p_receipt_path), status = 'در انتظار تأیید پرداخت' where id = v_order.id;
  insert into public.order_history(order_id,status,created_at) values(v_order.id,'در انتظار تأیید پرداخت',now());
  return jsonb_build_object('ok', true, 'orderNumber', v_order.order_number, 'status', 'در انتظار تأیید پرداخت', 'receiptPath', trim(p_receipt_path), 'receiptDeadlineAt', v_order.receipt_deadline_at);
end;
$function$;

create or replace function public.get_public_settings()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_products jsonb; v_market jsonb; v_system jsonb;
begin
  select coalesce(jsonb_object_agg(p.key,jsonb_build_object('buyPrice',p.buy_price,'sellPrice',p.sell_price,'minWeight',p.min_weight,'maxWeight',p.max_weight,'buyActive',p.buy_active,'sellActive',p.sell_active)),'{}'::jsonb) into v_products from public.products p;
  select coalesce(jsonb_build_object('closeStart',m.close_start,'closeEnd',m.close_end,'buyEnabled',m.buy_enabled,'sellEnabled',m.sell_enabled,'emergencyStop',m.emergency_stop),jsonb_build_object('closeStart',null,'closeEnd',null,'buyEnabled',true,'sellEnabled',true,'emergencyStop',false)) into v_market from public.market_settings m order by m.id limit 1;
  select coalesce(
    jsonb_build_object(
      'priceLockMinutes',s.price_lock_minutes,'sellValidityDays',s.sell_validity_days,
      'highWeightThreshold',coalesce(s.high_weight_threshold,10),
      'receiptDeadlineMinutes',greatest(5,least(coalesce(s.receipt_deadline_minutes,30),120)),
      'sellAddress',coalesce(s.sell_address,''),'lastPriceUpdate',s.last_price_update,
      'liveMetalsEnabled',coalesce(s.live_metals_enabled,true),'liveCryptoEnabled',coalesce(s.live_crypto_enabled,true),
      'liveIranEnabled',coalesce(s.live_iran_enabled,true),'liveChartEnabled',coalesce(s.live_chart_enabled,true),
      'support',jsonb_build_object('landline',coalesce(s.support_landline,''),'mobile',coalesce(s.support_mobile,''),'whatsapp',coalesce(s.support_whatsapp,''),'telegram',coalesce(s.support_telegram,''),'instagram',coalesce(s.support_instagram,''))
    ),
    jsonb_build_object('priceLockMinutes',5,'sellValidityDays',3,'highWeightThreshold',10,'receiptDeadlineMinutes',30,'sellAddress','','lastPriceUpdate',null,'liveMetalsEnabled',true,'liveCryptoEnabled',true,'liveIranEnabled',true,'liveChartEnabled',true,'support',jsonb_build_object('landline','','mobile','','whatsapp','','telegram','','instagram',''))
  ) into v_system from public.system_settings s order by s.id limit 1;
  return jsonb_build_object('ok',true,'products',v_products,'market',v_market,'system',v_system);
end;
$function$;