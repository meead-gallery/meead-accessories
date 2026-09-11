const METALS_CACHE_KEY = "https://meead-accessories.local/api/metals-cache";

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
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

    const goldPrice = Number(gold?.price);
    const silverPrice = Number(silver?.price);
    if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) {
      throw new Error("invalid_primary_price");
    }

    const body = JSON.stringify({
      ok: true,
      source: "Gold API",
      gold: goldPrice,
      silver: silverPrice,
      updatedAt: gold?.updatedAt || gold?.timestamp || new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    });

    const response = new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=20, stale-if-error=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (primaryError) {
    try {
      const backup = await fetchJson(`https://xaus.com/api/v1/spot?compact=1&fresh=${Date.now()}`);
      const goldPrice = Number(backup?.spot_usd_oz);
      const silverPrice = Number(backup?.silver_usd_oz);
      if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) {
        throw new Error("invalid_backup_price");
      }

      const body = JSON.stringify({
        ok: true,
        source: "XAUS",
        gold: goldPrice,
        silver: silverPrice,
        updatedAt: backup?.price_as_of || backup?.updated_at || new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        stale: !!backup?.stale,
      });

      const response = new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=20, stale-if-error=300",
          "Access-Control-Allow-Origin": "*",
        },
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (backupError) {
      if (cached) {
        return new Response(cached.body, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
            "X-Metals-Source": "cache",
          },
        });
      }

      return new Response(JSON.stringify({ ok: false, reason: "metals_unavailable" }), {
        status: 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/metals") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (request.method !== "GET") {
        return new Response(JSON.stringify({ ok: false, reason: "method_not_allowed" }), {
          status: 405,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Allow": "GET, OPTIONS",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      return getMetals(request, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};
