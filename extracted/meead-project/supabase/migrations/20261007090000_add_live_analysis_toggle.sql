alter table public.system_settings
  add column if not exists live_analysis_enabled boolean not null default true;

create or replace function public.get_public_settings()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_products jsonb;
  v_market jsonb;
  v_system jsonb;
begin
  select coalesce(
    jsonb_object_agg(
      p.key,
      jsonb_build_object(
        'buyPrice', p.buy_price,
        'sellPrice', p.sell_price,
        'minWeight', p.min_weight,
        'maxWeight', p.max_weight,
        'buyActive', p.buy_active,
        'sellActive', p.sell_active
      )
    ), '{}'::jsonb
  ) into v_products from public.products p;

  select coalesce(
    jsonb_build_object(
      'closeStart', m.close_start,
      'closeEnd', m.close_end,
      'buyEnabled', m.buy_enabled,
      'sellEnabled', m.sell_enabled,
      'emergencyStop', m.emergency_stop
    ),
    jsonb_build_object('closeStart', null, 'closeEnd', null, 'buyEnabled', true, 'sellEnabled', true, 'emergencyStop', false)
  ) into v_market
  from public.market_settings m order by m.id limit 1;

  select coalesce(
    jsonb_build_object(
      'priceLockMinutes', s.price_lock_minutes,
      'sellValidityDays', s.sell_validity_days,
      'highWeightThreshold', coalesce(s.high_weight_threshold, 10),
      'receiptDeadlineMinutes', greatest(5, least(coalesce(s.receipt_deadline_minutes, 30), 120)),
      'sellAddress', coalesce(s.sell_address, ''),
      'lastPriceUpdate', s.last_price_update,
      'liveMetalsEnabled', coalesce(s.live_metals_enabled, true),
      'liveCryptoEnabled', coalesce(s.live_crypto_enabled, true),
      'liveIranEnabled', coalesce(s.live_iran_enabled, true),
      'liveChartEnabled', coalesce(s.live_chart_enabled, true),
      'liveAnalysisEnabled', coalesce(s.live_analysis_enabled, true),
      'support', jsonb_build_object(
        'landline', coalesce(s.support_landline, ''),
        'mobile', coalesce(s.support_mobile, ''),
        'whatsapp', coalesce(s.support_whatsapp, ''),
        'telegram', coalesce(s.support_telegram, ''),
        'instagram', coalesce(s.support_instagram, '')
      )
    ),
    jsonb_build_object(
      'priceLockMinutes', 5, 'sellValidityDays', 3, 'highWeightThreshold', 10,
      'receiptDeadlineMinutes', 30, 'sellAddress', '', 'lastPriceUpdate', null,
      'liveMetalsEnabled', true, 'liveCryptoEnabled', true, 'liveIranEnabled', true,
      'liveChartEnabled', true, 'liveAnalysisEnabled', true,
      'support', jsonb_build_object('landline','', 'mobile','', 'whatsapp','', 'telegram','', 'instagram','')
    )
  ) into v_system
  from public.system_settings s order by s.id limit 1;

  return jsonb_build_object('ok', true, 'products', v_products, 'market', v_market, 'system', v_system);
end;
$function$;

create or replace function public.update_analysis_visibility(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  update public.system_settings
  set live_analysis_enabled = coalesce(p_enabled, true)
  where id = (select id from public.system_settings order by id desc limit 1);

  if not found then
    insert into public.system_settings (price_lock_minutes, sell_validity_days, live_analysis_enabled)
    values (5, 3, coalesce(p_enabled, true));
  end if;

  return jsonb_build_object('ok', true, 'liveAnalysisEnabled', coalesce(p_enabled, true));
end;
$function$;

revoke execute on function public.update_analysis_visibility(boolean) from public;
grant execute on function public.update_analysis_visibility(boolean) to authenticated;
