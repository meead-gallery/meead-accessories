-- Public readers must not be required to evaluate the admin-only is_admin() function.
-- Keep the public path limited to published rows; authenticated admins can read all rows.

drop policy if exists "Public and admins can read market analysis"
  on public.daily_market_analysis;

create policy "Public can read published market analysis"
  on public.daily_market_analysis
  for select
  to anon, authenticated
  using (published = true);

create policy "Admins can read all market analysis"
  on public.daily_market_analysis
  for select
  to authenticated
  using (is_admin());
