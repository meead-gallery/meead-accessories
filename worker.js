const METALS_CACHE_KEY = "https://meead-accessories.local/api/metals-cache";

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function changePct(current, previous) {
  const now = Number(current), old = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(old) || old <= 0) return null;
  return ((now - old) / old) * 100;
}

async function get24hChanges() {
  try {
    const [g, s] = await Promise.all([
      fetchJson("https://xaus.com/api/v1/intraday?symbol=xau&hours=24"),
      fetchJson("https://xaus.com/api/v1/intraday?symbol=xag&hours=24"),
    ]);
    const oldest = (payload) => {
      const points = Array.isArray(payload?.points) ? payload.points.filter(p => Number.isFinite(Number(p?.p))) : [];
      return points.reduce((a, p) => !a || Number(p.t) < Number(a.t) ? p : a, null);
    };
    const gp = Array.isArray(g?.points) ? g.points : [];
    const sp = Array.isArray(s?.points) ? s.points : [];
    const go = oldest(g), so = oldest(s);
    return {
      goldChange24h: go && gp.length ? changePct(gp[gp.length - 1]?.p, go.p) : null,
      silverChange24h: so && sp.length ? changePct(sp[sp.length - 1]?.p, so.p) : null,
    };
  } catch { return { goldChange24h: null, silverChange24h: null }; }
}

async function getMetals(request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(METALS_CACHE_KEY, { method: "GET" });
  const cached = await cache.match(cacheKey);
  try {
    const [[gold, silver], changes] = await Promise.all([
      Promise.all([fetchJson("https://api.gold-api.com/price/XAU"), fetchJson("https://api.gold-api.com/price/XAG")]),
      get24hChanges(),
    ]);
    const goldPrice = Number(gold?.price), silverPrice = Number(silver?.price);
    if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) throw new Error("invalid_primary_price");
    const body = JSON.stringify({ ok: true, source: "Gold API", gold: goldPrice, silver: silverPrice, ...changes, updatedAt: gold?.updatedAt || gold?.timestamp || new Date().toISOString(), fetchedAt: new Date().toISOString() });
    const response = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=20, stale-if-error=300", "Access-Control-Allow-Origin": "*" } });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch {
    try {
      const [backup, changes] = await Promise.all([fetchJson(`https://xaus.com/api/v1/spot?compact=1&fresh=${Date.now()}`), get24hChanges()]);
      const goldPrice = Number(backup?.spot_usd_oz), silverPrice = Number(backup?.silver_usd_oz);
      if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) throw new Error("invalid_backup_price");
      const body = JSON.stringify({ ok: true, source: "XAUS", gold: goldPrice, silver: silverPrice, ...changes, updatedAt: backup?.price_as_of || backup?.updated_at || new Date().toISOString(), fetchedAt: new Date().toISOString(), stale: !!backup?.stale });
      const response = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=20, stale-if-error=300", "Access-Control-Allow-Origin": "*" } });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch {
      if (cached) return new Response(cached.body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*", "X-Metals-Source": "cache" } });
      return new Response(JSON.stringify({ ok: false, reason: "metals_unavailable" }), { status: 503, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/metals") {
      if (request.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
      if (request.method !== "GET") return new Response(JSON.stringify({ ok: false, reason: "method_not_allowed" }), { status: 405, headers: { "Content-Type": "application/json; charset=utf-8", "Allow": "GET, OPTIONS", "Access-Control-Allow-Origin": "*" } });
      return getMetals(request, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};