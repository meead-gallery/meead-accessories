-- Make the high-weight purchase threshold configurable from the admin settings.
-- Default remains 10g so existing behavior is unchanged.

alter table public.system_settings
  add column if not exists high_weight_threshold numeric not null default 10;

create or replace function public.update_high_weight_threshold(p_threshold numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id bigint;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok',false,'reason','not_admin');
  end if;

  if p_threshold is null or p_threshold <= 0 or p_threshold > 100000 then
    return jsonb_build_object('ok',false,'reason','invalid_high_weight_threshold');
  end if;

  select id into v_id
  from public.system_settings
  order by id desc
  limit 1
  for update;

  if v_id is null then
    insert into public.system_settings (high_weight_threshold)
    values (p_threshold)
    returning id into v_id;
  else
    update public.system_settings
    set high_weight_threshold = p_threshold
    where id = v_id;
  end if;

  insert into public.activity_log(action,detail,created_at)
  values (
    'update_high_weight_threshold',
    jsonb_build_object('highWeightThreshold',p_threshold)::text,
    now()
  );

  return jsonb_build_object(
    'ok',true,
    'highWeightThreshold',p_threshold
  );
end;
$function$;

do $migration$
declare
  v_def text;
begin
  -- The core order function is the source of truth for whether a purchase
  -- requires manual payment approval.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'submit_order'
    and pg_get_function_identity_arguments(p.oid) =
      'p_quote jsonb, p_weight numeric, p_name text, p_phone text';

  if v_def is null then
    raise exception 'submit_order core function not found';
  end if;

  v_def := replace(
    v_def,
    'v_existing.weight > 10',
    '(v_existing.weight > (select high_weight_threshold from public.system_settings order by id desc limit 1))'
  );

  v_def := replace(
    v_def,
    'v_requires_payment_approval := p_weight > 10;',
    'v_requires_payment_approval := p_weight > v_system.high_weight_threshold;'
  );

  execute v_def;

  -- Prevent bypassing the approval step through the generic status RPC.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'update_order_status'
    and pg_get_function_identity_arguments(p.oid) =
      'p_order_id bigint, p_status text';

  if v_def is null then
    raise exception 'update_order_status function not found';
  end if;

  v_def := replace(
    v_def,
    'coalesce(v_order.weight,0) > 10',
    'coalesce(v_order.weight,0) > (select high_weight_threshold from public.system_settings order by id desc limit 1)'
  );

  execute v_def;

  -- Keep the dedicated approval RPC aligned with the same threshold.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'approve_high_weight_order'
    and pg_get_function_identity_arguments(p.oid) =
      'p_order_id bigint, p_payment jsonb';

  if v_def is null then
    raise exception 'approve_high_weight_order function not found';
  end if;

  v_def := replace(
    v_def,
    'coalesce(v_order.weight,0) <= 10',
    'coalesce(v_order.weight,0) <= (select high_weight_threshold from public.system_settings order by id desc limit 1)'
  );

  execute v_def;
end;
$migration$;
