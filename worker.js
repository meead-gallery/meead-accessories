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

function pointTimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10000000000 ? value * 1000 : value;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 10000000000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function getDailyChanges(currentGold, currentSilver) {
  try {
    const [g, s] = await Promise.all([
      fetchJson("https://xaus.com/api/v1/intraday?symbol=xau&hours=48"),
      fetchJson("https://xaus.com/api/v1/intraday?symbol=xag&hours=48"),
    ]);

    const previousTradingPoint = (payload) => {
      const points = Array.isArray(payload?.points)
        ? payload.points
            .map(p => ({ ...p, _timeMs: pointTimeMs(p?.t) }))
            .filter(p => Number.isFinite(Number(p?.p)) && Number.isFinite(p._timeMs))
            .sort((a, b) => a._timeMs - b._timeMs)
        : [];

      if (!points.length) return null;

      const today = new Date().toISOString().slice(0, 10);

      // Use the latest quote from a calendar day before today.
      // This gives Tuesday -> Monday and Monday -> Friday when Friday is inside the 48h feed.
      for (let i = points.length - 1; i >= 0; i--) {
        const day = new Date(points[i]._timeMs).toISOString().slice(0, 10);
        if (day < today) return points[i];
      }

      return null;
    };

    const goldPrevious = previousTradingPoint(g);
    const silverPrevious = previousTradingPoint(s);

    return {
      goldChange24h: goldPrevious ? changePct(currentGold, goldPrevious.p) : null,
      silverChange24h: silverPrevious ? changePct(currentSilver, silverPrevious.p) : null,
    };
  } catch {
    return { goldChange24h: null, silverChange24h: null };
  }
}

async function getMetals(request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(METALS_CACHE_KEY, { method: "GET" });
  const cached = await cache.match(cacheKey);
  try {
    const [gold, silver] = await Promise.all([
      fetchJson("https://api.gold-api.com/price/XAU"),
      fetchJson("https://api.gold-api.com/price/XAG")
    ]);
    const goldPrice = Number(gold?.price), silverPrice = Number(silver?.price);
    if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) throw new Error("invalid_primary_price");
    const changes = await getDailyChanges(goldPrice, silverPrice);
    const body = JSON.stringify({ ok: true, source: "Gold API", gold: goldPrice, silver: silverPrice, ...changes, updatedAt: gold?.updatedAt || gold?.timestamp || new Date().toISOString(), fetchedAt: new Date().toISOString() });
    const response = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=20, stale-if-error=300", "Access-Control-Allow-Origin": "*" } });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch {
    try {
      const backup = await fetchJson(`https://xaus.com/api/v1/spot?compact=1&fresh=${Date.now()}`);
      const goldPrice = Number(backup?.spot_usd_oz), silverPrice = Number(backup?.silver_usd_oz);
      if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) throw new Error("invalid_backup_price");
      const changes = await getDailyChanges(goldPrice, silverPrice);
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