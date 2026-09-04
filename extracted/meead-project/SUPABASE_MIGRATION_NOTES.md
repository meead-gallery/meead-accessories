# MEEAD Accessories — Supabase migration

This build replaces the browser `window.storage` service layer with Supabase.

## Before deployment
1. Install dependencies with `npm install`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the deployment environment, or keep the client constants currently embedded in `src/App.jsx` for this private migration build.
3. Run `supabase_submit_order_hardened.sql` once in Supabase SQL Editor. It restores server-side market-hours validation and evaluates the close window in Asia/Tehran time.
4. Confirm the admin Auth user exists and is present in `public.admin_users`.
5. Test on a separate Netlify site before replacing the production site.

## Admin login
The UI now asks for the Supabase Auth email and password. The account must also be present in `public.admin_users`.

## Security
The browser uses only the Supabase Publishable Key. Never put a Supabase Secret Key in this project or Netlify client-side variables.
