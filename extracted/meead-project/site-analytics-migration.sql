create table if not exists public.site_visit_events (
  id bigint generated always as identity primary key,
  visitor_id uuid not null,
  session_id uuid not null,
  bucket_start timestamptz not null,
  page_path text not null default '/',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint site_visit_events_bucket_unique unique (visitor_id, bucket_start)
);

create index if not exists site_visit_events_occurred_at_idx
  on public.site_visit_events (occurred_at desc);

create index if not exists site_visit_events_bucket_idx
  on public.site_visit_events (bucket_start desc);

alter table public.site_visit_events enable row level security;
revoke all on table public.site_visit_events from anon, authenticated;
grant select on table public.site_visit_events to authenticated;

drop policy if exists "site_visit_events_admin_select" on public.site_visit_events;
create policy "site_visit_events_admin_select"
  on public.site_visit_events
  for select
  to authenticated
  using ((select public.is_admin()));

create or replace function public.get_site_analytics(
  p_from timestamptz,
  p_to timestamptz,
  p_timezone text default 'Asia/Tehran'
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when not (select public.is_admin()) then
      jsonb_build_object('ok', false, 'reason', 'forbidden')
    else
      jsonb_build_object(
        'ok', true,
        'daily',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'bucket', x.bucket,
              'uniqueVisitors', x.unique_visitors,
              'events', x.events
            )
            order by x.bucket
          )
          from (
            select date_trunc('day', e.occurred_at, p_timezone) as bucket,
              count(distinct e.visitor_id)::integer as unique_visitors,
              count(*)::integer as events
            from public.site_visit_events e
            where e.occurred_at >= p_from and e.occurred_at < p_to
            group by 1
          ) x
        ), '[]'::jsonb),
        'hourly',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'bucket', x.bucket,
              'uniqueVisitors', x.unique_visitors,
              'events', x.events
            )
            order by x.bucket
          )
          from (
            select date_trunc('hour', e.occurred_at, p_timezone) as bucket,
              count(distinct e.visitor_id)::integer as unique_visitors,
              count(*)::integer as events
            from public.site_visit_events e
            where e.occurred_at >= greatest(p_from, p_to - interval '48 hours')
              and e.occurred_at < p_to
            group by 1
          ) x
        ), '[]'::jsonb)
      )
  end;
$$;

revoke execute on function public.get_site_analytics(timestamptz, timestamptz, text) from public;
revoke execute on function public.get_site_analytics(timestamptz, timestamptz, text) from anon;
grant execute on function public.get_site_analytics(timestamptz, timestamptz, text) to authenticated;
