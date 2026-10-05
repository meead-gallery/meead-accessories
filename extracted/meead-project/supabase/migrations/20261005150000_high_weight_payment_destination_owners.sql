-- Unify each payment destination into one complete account card.
-- A destination contains card, IBAN/account number, amount and owner details.
do $$
declare r record; src text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('approve_high_weight_order','set_high_weight_payment_info') loop
    select pg_get_functiondef(r.oid) into src;
    src := replace(src,
'begin
  if not public.is_admin()',
'begin
  if jsonb_typeof(p_payment->''destinations'') = ''array'' then
    p_payment := jsonb_set(p_payment, ''{cards}'', coalesce((select jsonb_agg(jsonb_build_object(''number'',regexp_replace(trim(coalesce(x.value->>''cardNumber'','''')), ''\\D'', '''', ''g''), ''amount'',coalesce(nullif(x.value->>''amount'','''')::numeric,0), ''ownerFirstName'',trim(coalesce(x.value->>''ownerFirstName'','''')), ''ownerLastName'',trim(coalesce(x.value->>''ownerLastName'','''')))) from jsonb_array_elements(p_payment->''destinations'') x where trim(coalesce(x.value->>''cardNumber'','''')) <> ''''), ''[]''::jsonb), true);
    p_payment := jsonb_set(p_payment, ''{shebas}'', coalesce((select jsonb_agg(jsonb_build_object(''number'',regexp_replace(regexp_replace(trim(coalesce(x.value->>''shebaNumber'','''')), ''^IR'', '''', ''i''), ''\\D'', '''', ''g''), ''amount'',coalesce(nullif(x.value->>''amount'','''')::numeric,0), ''ownerFirstName'',trim(coalesce(x.value->>''ownerFirstName'','''')), ''ownerLastName'',trim(coalesce(x.value->>''ownerLastName'','''')))) from jsonb_array_elements(p_payment->''destinations'') x where trim(coalesce(x.value->>''shebaNumber'','''')) <> ''''), ''[]''::jsonb), true);
    p_payment := jsonb_set(p_payment, ''{account}'', coalesce((select jsonb_build_object(''number'',trim(x.value->>''accountNumber''),''amount'',coalesce(nullif(x.value->>''amount'','''')::numeric,0),''ownerFirstName'',trim(coalesce(x.value->>''ownerFirstName'','''')),''ownerLastName'',trim(coalesce(x.value->>''ownerLastName'',''''))) from jsonb_array_elements(p_payment->''destinations'') x where trim(coalesce(x.value->>''accountNumber'','''')) <> '''' limit 1), ''{}''::jsonb), true);
  end if;
  if not public.is_admin()');
    execute src;
  end loop;
end $$;