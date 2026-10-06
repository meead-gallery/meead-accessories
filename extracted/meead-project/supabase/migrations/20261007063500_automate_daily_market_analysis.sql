grant select, insert, update on public.daily_market_analysis to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'daily-market-analysis';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end $$;

select cron.schedule(
  'daily-market-analysis',
  '35 6 * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'daily_analysis_project_url') || '/functions/v1/daily-market-analysis',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'daily_analysis_publishable_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'daily_analysis_publishable_key')
      ),
      body := jsonb_build_object('scheduled_at', now()),
      timeout_milliseconds := 10000
    ) as request_id;
  $job$
);