-- Allow admins to manually select any valid buy status for high-weight orders.
-- The dedicated approval RPC remains available for saving order-specific payment details.

create or replace function public.update_order_status(p_order_id bigint, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  if p_status not in (
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
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  update public.orders
  set status = p_status
  where id = p_order_id;

  insert into public.order_history(order_id,status,created_at)
  values(p_order_id,p_status,now());

  insert into public.activity_log(action,detail,created_at)
  values(
    'update_order_status',
    jsonb_build_object(
      'orderId',p_order_id,
      'oldStatus',v_order.status,
      'newStatus',p_status
    )::text,
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'status', p_status
  );
end;
$function$;
