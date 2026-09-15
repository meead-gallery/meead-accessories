const METALS_CACHE_KEY = "https://meead-accessories.local/api/metals-cache";

async function fetchJson(url, timeoutMs = 7000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json", ...extraHeaders },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function changePct(current, previous) {
  const now = Number(current), old = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(old) || old <= 0) return null;
  return ((now - old) / old) * 100;
}

async function getIntraday24hChange(symbol, currentPrice) {
  const data = await fetchJson(
    `https://xaus.com/api/v1/intraday?symbol=${symbol}&hours=48&fresh=${Date.now()}`
  );

  const points = Array.isArray(data?.points) ? data.points : [];
  const normalized = points
    .map(point => ({
      timestamp: Number(point?.t),
      price: Number(point?.p),
    }))
    .filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.price) && point.price > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!normalized.length) return null;

  const latest = normalized[normalized.length - 1];
  const target = latest.timestamp - 24 * 60 * 60;

  let previous = normalized[0];
  let bestDistance = Math.abs(previous.timestamp - target);

  for (const point of normalized) {
    const distance = Math.abs(point.timestamp - target);
    if (distance < bestDistance) {
      previous = point;
      bestDistance = distance;
    }
  }

  return changePct(currentPrice, previous.price);
}

async function getMetals(request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(METALS_CACHE_KEY, { method: "GET" });
  const cached = await cache.match(cacheKey);
  try {
    const [gold, silver] = await Promise.all([
      fetchJson("https://api.gold-api.com/price/XAU"),
      fetchJson("https://api.gold-api.com/price/XAG"),
    ]);

    const goldPrice = Number(gold?.price), silverPrice = Number(silver?.price);
    if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) throw new Error("invalid_primary_price");

    const [goldChange24h, silverChange24h] = await Promise.all([
      getIntraday24hChange("xau", goldPrice),
      getIntraday24hChange("xag", silverPrice),
    ]);

    const body = JSON.stringify({
      ok: true,
      source: "Gold API + XAUS intraday",
      gold: goldPrice,
      silver: silverPrice,
      goldChange24h,
      silverChange24h,
      updatedAt: gold?.updatedAt || gold?.timestamp || new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    });
    const response = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=20, stale-if-error=300", "Access-Control-Allow-Origin": "*" } });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch {
    try {
      const backup = await fetchJson(`https://xaus.com/api/v1/spot?compact=1&fresh=${Date.now()}`);
      const goldPrice = Number(backup?.spot_usd_oz), silverPrice = Number(backup?.silver_usd_oz);
      if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) throw new Error("invalid_backup_price");

      let goldChange24h = null;
      let silverChange24h = null;
      try {
        [goldChange24h, silverChange24h] = await Promise.all([
          getIntraday24hChange("xau", goldPrice),
          getIntraday24hChange("xag", silverPrice),
        ]);
      } catch {}

      const body = JSON.stringify({ ok: true, source: "XAUS", gold: goldPrice, silver: silverPrice, goldChange24h, silverChange24h, updatedAt: backup?.price_as_of || backup?.updated_at || new Date().toISOString(), fetchedAt: new Date().toISOString(), stale: !!backup?.stale });
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
