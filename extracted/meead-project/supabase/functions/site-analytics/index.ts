import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getPublishableKey() {
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "";
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed?.default || "";
  } catch {
    return "";
  }
}

function getSecretKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed?.default || "";
  } catch {
    return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  }
}

function bucketStart(now: Date) {
  const d = new Date(now);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 30) * 30, 0, 0);
  return d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, reason: "method_not_allowed" }, 405);
  }

  const publishableKey = getPublishableKey();
  if (!publishableKey || req.headers.get("apikey") !== publishableKey) {
    return json({ ok: false, reason: "unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }

  const visitorId = String(body?.visitorId || "").trim();
  const sessionId = String(body?.sessionId || "").trim();
  const pagePath = String(body?.pagePath || "/").trim().slice(0, 200);

  if (!UUID_RE.test(visitorId) || !UUID_RE.test(sessionId)) {
    return json({ ok: false, reason: "invalid_visitor_id" }, 400);
  }

  if (!pagePath.startsWith("/")) {
    return json({ ok: false, reason: "invalid_page_path" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getSecretKey();

  if (!supabaseUrl || !secretKey) {
    return json({ ok: false, reason: "server_configuration_error" }, 500);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const bucket = bucketStart(now);

  const { data, error } = await admin
    .from("site_visit_events")
    .upsert(
      {
        visitor_id: visitorId,
        session_id: sessionId,
        bucket_start: bucket,
        page_path: pagePath,
        occurred_at: now.toISOString(),
      },
      { onConflict: "visitor_id,bucket_start", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("site analytics insert failed:", error);
    return json({ ok: false, reason: "record_failed" }, 500);
  }

  return json({
    ok: true,
    recorded: Boolean(data?.id),
    bucket,
  });
});
