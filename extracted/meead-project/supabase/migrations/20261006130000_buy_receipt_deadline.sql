-- Purchase receipt deadline and automatic expiration.
-- Buy orders remain valid for 30 minutes after payment information becomes available.
-- If the buy rate changes before the receipt is submitted, the order is expired.
-- The deadline starts immediately for low-weight buys and when high-weight approval
-- moves the order into "در انتظار پرداخت".

alter table public.orders
  add column if not exists receipt_deadline_at timestamptz;

create index if not exists orders_receipt_deadline_idx
  on public.orders (status, receipt_deadline_at)
  where type = 'buy' and status = 'در انتظار پرداخت';

create or replace function public.set_buy_receipt_deadline()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
begin
  if new.type = 'buy'
     and new.status = 'در انتظار پرداخت'
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or new.receipt_deadline_at is null
     ) then
    new.receipt_deadline_at := now() + interval '30 minutes';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_set_buy_receipt_deadline on public.orders;

create trigger trg_set_buy_receipt_deadline
before insert or update of status on public.orders
for each row
execute function public.set_buy_receipt_deadline();

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
begin
  for v_order in
    select o.id, o.order_number, o.price_per_gram, o.receipt_deadline_at,
           p.buy_price as current_buy_price
    from public.orders o
    join public.products p on p.key = o.purity
    where o.type = 'buy'
      and o.status = 'در انتظار پرداخت'
      and (
        (o.receipt_deadline_at is not null and o.receipt_deadline_at <= now())
        or p.buy_price is distinct from o.price_per_gram
      )
    for update of o
  loop
    if v_order.current_buy_price is distinct from v_order.price_per_gram then
      v_reason := 'سفارش به دلیل تغییر نرخ خرید قبل از ارسال فیش منقضی شد.';
    else
      v_reason := 'سفارش به دلیل پایان مهلت ۳۰ دقیقه‌ای ارسال فیش منقضی شد.';
    end if;

    update public.orders
    set status = 'لغو شد',
        admin_note = v_reason
    where id = v_order.id
      and status = 'در انتظار پرداخت';

    if found then
      insert into public.order_history(order_id,status,created_at)
      values(v_order.id,'لغو شد',now());

      insert into public.activity_log(action,detail,created_at)
      values(
        'expire_pending_buy_order',
        jsonb_build_object(
          'orderId',v_order.id,
          'orderNumber',v_order.order_number,
          'reason',v_reason
        )::text,
        now()
      );

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$;

revoke execute on function public.expire_pending_buy_orders() from public, anon, authenticated;

create or replace function public.attach_receipt(
  p_order_number text,
  p_phone text,
  p_receipt_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders%rowtype;
  v_current_price numeric;
begin
  if p_order_number is null
     or trim(p_order_number) = ''
     or p_phone is null
     or trim(p_phone) = ''
     or p_receipt_path is null
     or trim(p_receipt_path) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  select *
  into v_order
  from public.orders
  where order_number = trim(p_order_number)
    and phone = trim(p_phone)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  if v_order.type <> 'buy' then
    return jsonb_build_object('ok', false, 'reason', 'receipt_not_allowed');
  end if;

  if v_order.status in ('لغو شد', 'تکمیل شد') then
    return jsonb_build_object('ok', false, 'reason', 'order_closed');
  end if;

  if v_order.status = 'در انتظار پرداخت' then
    if v_order.receipt_deadline_at is null
       or v_order.receipt_deadline_at <= now() then
      update public.orders
      set status = 'لغو شد',
          admin_note = 'سفارش به دلیل پایان مهلت ۳۰ دقیقه‌ای ارسال فیش منقضی شد.'
      where id = v_order.id
        and status = 'در انتظار پرداخت';

      if found then
        insert into public.order_history(order_id,status,created_at)
        values(v_order.id,'لغو شد',now());
      end if;

      return jsonb_build_object('ok', false, 'reason', 'order_expired');
    end if;

    select p.buy_price
    into v_current_price
    from public.products p
    where p.key = v_order.purity
    limit 1;

    if v_current_price is null
       or v_current_price is distinct from v_order.price_per_gram then
      update public.orders
      set status = 'لغو شد',
          admin_note = 'سفارش به دلیل تغییر نرخ خرید قبل از ارسال فیش منقضی شد.'
      where id = v_order.id
        and status = 'در انتظار پرداخت';

      if found then
        insert into public.order_history(order_id,status,created_at)
        values(v_order.id,'لغو شد',now());
      end if;

      return jsonb_build_object(
        'ok', false,
        'reason', 'price_changed',
        'currentPrice', v_current_price
      );
    end if;
  end if;

  update public.orders
  set receipt_url = trim(p_receipt_path),
      status = 'در انتظار تأیید پرداخت'
  where id = v_order.id;

  insert into public.order_history(order_id,status,created_at)
  values(v_order.id,'در انتظار تأیید پرداخت',now());

  return jsonb_build_object(
    'ok', true,
    'orderNumber', v_order.order_number,
    'status', 'در انتظار تأیید پرداخت',
    'receiptPath', trim(p_receipt_path),
    'receiptDeadlineAt', v_order.receipt_deadline_at
  );
end;
$function$;

revoke execute on function public.attach_receipt(text,text,text) from public, anon;
grant execute on function public.attach_receipt(text,text,text) to anon, authenticated;

create or replace function public.find_order(
  p_order_number text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders%rowtype;
  v_history jsonb;
  v_phone text;
  v_request_key text;
  v_attempts integer;
  v_headers jsonb;
  v_found boolean;
begin
  if p_order_number is null or trim(p_order_number) = '' or p_phone is null or trim(p_phone) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  v_request_key := coalesce(nullif(v_headers ->> 'x-forwarded-for', ''), nullif(v_headers ->> 'cf-connecting-ip', ''), 'unknown');

  delete from public.order_lookup_attempts where attempted_at < now() - interval '30 minutes';

  select count(*) into v_attempts from public.order_lookup_attempts
  where request_key = v_request_key and attempted_at >= now() - interval '15 minutes' and success = false;

  if v_attempts >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  v_phone := translate(trim(p_phone), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789');

  select * into v_order from public.orders
  where lower(order_number) = lower(trim(p_order_number))
    and translate(trim(phone), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789') = v_phone
  limit 1;

  v_found := found;

  insert into public.order_lookup_attempts(request_key, success) values (v_request_key, v_found);

  if not v_found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('status', h.status, 'time', h.created_at) order by h.created_at), '[]'::jsonb)
  into v_history from public.order_history h where h.order_id = v_order.id;

  return jsonb_build_object('ok', true, 'order', jsonb_build_object(
    'id', v_order.id,
    'orderNumber', v_order.order_number,
    'order_number', v_order.order_number,
    'type', v_order.type,
    'purity', v_order.purity,
    'weight', v_order.weight,
    'pricePerGram', v_order.price_per_gram,
    'price_per_gram', v_order.price_per_gram,
    'total', v_order.total,
    'approxTotal', v_order.approx_total,
    'approx_total', v_order.approx_total,
    'name', v_order.name,
    'firstName', v_order.first_name,
    'lastName', v_order.last_name,
    'phone', v_order.phone,
    'province', v_order.province,
    'city', v_order.city,
    'address', v_order.address,
    'postalCode', v_order.postal_code,
    'createdAt', v_order.created_at,
    'created_at', v_order.created_at,
    'lockExpiresAt', v_order.lock_expires_at,
    'lock_expires_at', v_order.lock_expires_at,
    'receiptDeadlineAt', v_order.receipt_deadline_at,
    'receipt_deadline_at', v_order.receipt_deadline_at,
    'sellValidUntil', v_order.sell_valid_until,
    'sell_valid_until', v_order.sell_valid_until,
    'status', v_order.status,
    'finalWeight', v_order.final_weight,
    'final_weight', v_order.final_weight,
    'finalPricePerGram', v_order.final_price_per_gram,
    'final_price_per_gram', v_order.final_price_per_gram,
    'finalTotal', v_order.final_total,
    'final_total', v_order.final_total,
    'adminNote', v_order.admin_note,
    'admin_note', v_order.admin_note,
    'receiptUrl', v_order.receipt_url,
    'receipt_url', v_order.receipt_url,
    'bankSnapshot', v_order.bank_snapshot,
    'bank_snapshot', v_order.bank_snapshot,
    'history', v_history
  ));
end;
$function$;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'meead-expire-pending-buy-orders'
  ) then
    perform cron.schedule(
      'meead-expire-pending-buy-orders',
      '* * * * *',
      'select public.expire_pending_buy_orders();'
    );
  end if;
end $$;
