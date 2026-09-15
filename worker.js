const METALS_CACHE_KEY = "https://meead-accessories.local/api/metals-cache";
const GOLD_API = "https://api.gold-api.com/price";
const XAUS_INTRADAY = "https://xaus.com/api/v1/intraday";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const DAY_SECONDS = 24 * 60 * 60;

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`upstream_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function timestampSeconds(value) {
  const n = number(value);
  if (n !== null && n > 0) return n > 10000000000 ? n / 1000 : n;

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed / 1000;
  }

  return null;
}

function percentChange(current, previous) {
  const a = number(current);
  const b = number(previous);
  if (a === null || b === null || b <= 0) return null;
  return ((a - b) / b) * 100;
}

function nearest24hChange(points) {
  const clean = points
    .map((point) => ({
      t: timestampSeconds(point?.t),
      p: number(point?.p),
    }))
    .filter((point) => point.t !== null && point.p !== null && point.p > 0)
    .sort((a, b) => a.t - b.t);

  if (clean.length < 2) return null;

  const latest = clean[clean.length - 1];
  const target = latest.t - DAY_SECONDS;

  let previous = null;
  let distance = Infinity;

  for (const point of clean) {
    const d = Math.abs(point.t - target);
    if (d < distance) {
      distance = d;
      previous = point;
    }
  }

  if (!previous || distance > 3 * 60 * 60) return null;
  return percentChange(latest.p, previous.p);
}

async function xaus24h(symbol) {
  try {
    const data = await fetchJson(
      `${XAUS_INTRADAY}?symbol=${symbol}&hours=48&fresh=${Date.now()}`
    );

    const points = Array.isArray(data?.points)
      ? data.points
      : Array.isArray(data?.data?.points)
        ? data.data.points
        : [];

    return nearest24hChange(points);
  } catch {
    return null;
  }
}

async function yahoo24h(symbol) {
  try {
    const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=5d&interval=5m&includePrePost=true`;
    const data = await fetchJson(url);
    const chart = data?.chart?.result?.[0];
    const timestamps = Array.isArray(chart?.timestamp) ? chart.timestamp : [];
    const closes = chart?.indicators?.quote?.[0]?.close;

    if (!Array.isArray(closes) || timestamps.length !== closes.length) return null;

    const points = timestamps.map((t, i) => ({
      t,
      p: closes[i],
    }));

    return nearest24hChange(points);
  } catch {
    return null;
  }
}

async function readPrimaryPrices() {
  const [gold, silver] = await Promise.all([
    fetchJson(`${GOLD_API}/XAU`),
    fetchJson(`${GOLD_API}/XAG`),
  ]);

  const goldPrice = number(gold?.price);
  const silverPrice = number(silver?.price);

  if (goldPrice === null || silverPrice === null) {
    throw new Error("invalid_primary_price");
  }

  return {
    gold: goldPrice,
    silver: silverPrice,
    updatedAt: gold?.updatedAt || gold?.timestamp || new Date().toISOString(),
  };
}

async function readXausPrices() {
  const data = await fetchJson(
    `https://xaus.com/api/v1/spot?compact=1&fresh=${Date.now()}`
  );

  const goldPrice = number(data?.spot_usd_oz);
  const silverPrice = number(data?.silver_usd_oz);

  if (goldPrice === null || silverPrice === null) {
    throw new Error("invalid_xaus_price");
  }

  return {
    gold: goldPrice,
    silver: silverPrice,
    updatedAt: data?.price_as_of || data?.updated_at || new Date().toISOString(),
    stale: !!data?.stale,
  };
}

async function calculateChanges() {
  const [goldXaus, silverXaus] = await Promise.all([
    xaus24h("xau"),
    xaus24h("xag"),
  ]);

  const [goldYahoo, silverYahoo] = await Promise.all([
    goldXaus === null ? yahoo24h("XAUUSD=X") : Promise.resolve(null),
    silverXaus === null ? yahoo24h("XAGUSD=X") : Promise.resolve(null),
  ]);

  return {
    goldChange24h: goldXaus ?? goldYahoo,
    silverChange24h: silverXaus ?? silverYahoo,
  };
}

function response(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...headers,
    },
  });
}

async function getMetals(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(METALS_CACHE_KEY, { method: "GET" });
  const cached = await cache.match(cacheKey);

  try {
    const prices = await readPrimaryPrices();
    const changes = await calculateChanges();

    const body = {
      ok: true,
      source: "Gold API + 24h market history",
      ...prices,
      ...changes,
      fetchedAt: new Date().toISOString(),
    };

    const result = response(body, {
      "Cache-Control": "public, max-age=20, stale-if-error=300",
    });

    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch {
    try {
      const prices = await readXausPrices();
      const changes = await calculateChanges();

      const body = {
        ok: true,
        source: "XAUS + 24h market history",
        ...prices,
        ...changes,
        fetchedAt: new Date().toISOString(),
      };

      const result = response(body, {
        "Cache-Control": "public, max-age=20, stale-if-error=300",
      });

      ctx.waitUntil(cache.put(cacheKey, result.clone()));
      return result;
    } catch {
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

      return response(
        { ok: false, reason: "metals_unavailable" },
        { "Cache-Control": "no-store" }
      );
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
        return response(
          { ok: false, reason: "method_not_allowed" },
          { Allow: "GET, OPTIONS" }
        );
      }

      return getMetals(ctx);
    }

    return env.ASSETS.fetch(request);
  },
};