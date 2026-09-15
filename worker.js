const METALS_CACHE_KEY = "https://meead-accessories.local/api/metals-cache";
const GOLD_API = "https://api.gold-api.com/price";
const ALYAWM_SPOT = "https://alyawmgold.com/api/v1/spot/latest?country=USD";
const ALYAWM_HISTORY = "https://alyawmgold.com/api/v1/history";

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

function percentChange(current, previous) {
  const a = number(current);
  const b = number(previous);
  if (a === null || b === null || b <= 0) return null;
  return ((a - b) / b) * 100;
}

function findDailyPercent(value) {
  if (!value || typeof value !== "object") return null;

  const preferredKeys = [
    "dailyChangePercent",
    "daily_change_percent",
    "changePercent",
    "change_percent",
    "percentChange",
    "percent_change",
    "dailyChangePct",
    "daily_change_pct",
    "changePct",
    "change_pct",
    "chp",
  ];

  for (const key of preferredKeys) {
    const candidate = number(value?.[key]);
    if (candidate !== null) return candidate;
  }

  if (value.change && typeof value.change === "object") {
    const nested = findDailyPercent(value.change);
    if (nested !== null) return nested;
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findDailyPercent(child);
      if (found !== null) return found;
    }
  }

  return null;
}

function findHistoricalPrice(item) {
  if (!item || typeof item !== "object") return null;

  const keys = ["close", "price", "value", "spot", "usd_per_oz", "usdPerOz"];
  for (const key of keys) {
    const candidate = number(item?.[key]);
    if (candidate !== null && candidate > 0) return candidate;
  }

  if (item.rates && typeof item.rates === "object") {
    for (const key of ["USD", "XAU", "XAG", "USDXAU", "USDXAG"]) {
      const candidate = number(item.rates?.[key]);
      if (candidate !== null && candidate > 0) return candidate;
    }
  }

  return null;
}

async function alyawm24h(symbol, currentPrice) {
  try {
    const spot = await fetchJson(`${ALYAWM_SPOT}&fresh=${Date.now()}`);
    const metal = symbol === "XAU" ? spot?.metals?.gold : spot?.metals?.silver;

    const directChange = findDailyPercent(metal);
    if (directChange !== null) return directChange;
  } catch {
    // Fall through to the daily-history calculation.
  }

  try {
    const data = await fetchJson(
      `${ALYAWM_HISTORY}?metal=${symbol}&interval=daily&limit=3&fresh=${Date.now()}`
    );

    const rows = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.history)
        ? data.history
        : Array.isArray(data?.prices)
          ? data.prices
          : [];

    const prices = rows
      .map(findHistoricalPrice)
      .filter((value) => value !== null && value > 0);

    if (!prices.length) return null;

    const previous = prices[prices.length - 1];
    return percentChange(currentPrice, previous);
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

async function calculateChanges(gold, silver) {
  const [goldChange24h, silverChange24h] = await Promise.all([
    alyawm24h("XAU", gold),
    alyawm24h("XAG", silver),
  ]);

  return {
    goldChange24h,
    silverChange24h,
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
    const changes = await calculateChanges(prices.gold, prices.silver);

    const body = {
      ok: true,
      source: "Gold API + AlyawmGold 24h change",
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
      const changes = await calculateChanges(prices.gold, prices.silver);

      const body = {
        ok: true,
        source: "XAUS + AlyawmGold 24h change",
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