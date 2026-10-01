const METALS_CACHE_KEY = "https://meead-accessories.local/api/metals-cache";
const CRYPTO_CACHE_KEY = "https://meead-accessories.local/api/crypto-cache";
const NOBITEX_API = "https://apiv2.nobitex.ir";
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

  const keys = [
    "close",
    "price",
    "value",
    "spot",
    "usd_per_oz",
    "usdPerOz",
    "average",
    "avg",
    "mean",
  ];

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

function historyRows(data) {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.history)) return data.history;
  if (Array.isArray(data?.prices)) return data.prices;
  if (Array.isArray(data?.observations)) return data.observations;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
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

    const prices = historyRows(data)
      .map(findHistoricalPrice)
      .filter((value) => value !== null && value > 0);

    if (prices.length < 2) return null;

    // AlyawmGold returns historical observations oldest -> newest.
    // Use the previous completed daily observation, not the newest row.
    const previous = prices[prices.length - 2];
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

async function readCryptoPrices() {
  const [usdtResult, btcResult] = await Promise.allSettled([
    fetchJson(NOBITEX_API + "/v3/orderbook/USDTIRT"),
    fetchJson(NOBITEX_API + "/v3/orderbook/BTCUSDT"),
  ]);

  let usdtIrt = null;
  let btcUsdt = null;
  const timestamps = [];

  if (usdtResult.status === "fulfilled" && usdtResult.value?.status === "ok") {
    const usdtRaw = number(usdtResult.value?.lastTradePrice);
    if (usdtRaw !== null && usdtRaw > 0) {
      // Nobitex public IRT market prices are returned in rials; Meead displays toman.
      usdtIrt = usdtRaw / 10;
      const updated = number(usdtResult.value?.lastUpdate);
      if (updated !== null && updated > 0) timestamps.push(updated);
    }
  }

  if (btcResult.status === "fulfilled" && btcResult.value?.status === "ok") {
    const btcRaw = number(btcResult.value?.lastTradePrice);
    if (btcRaw !== null && btcRaw > 0) {
      btcUsdt = btcRaw;
      const updated = number(btcResult.value?.lastUpdate);
      if (updated !== null && updated > 0) timestamps.push(updated);
    }
  }

  // Wallex public market data is the backup source when Nobitex is unavailable.
  // Use the small per-symbol trades endpoints first; fall back to the markets
  // endpoint if either symbol cannot be read.
  if (usdtIrt === null || btcUsdt === null) {
    const [wallexUsdtResult, wallexBtcResult] = await Promise.allSettled([
      fetchJson("https://api.wallex.ir/v1/trades?symbol=USDTTMN"),
      fetchJson("https://api.wallex.ir/v1/trades?symbol=BTCUSDT"),
    ]);

    if (usdtIrt === null && wallexUsdtResult.status === "fulfilled") {
      const price = number(wallexUsdtResult.value?.result?.latestTrades?.[0]?.price);
      if (price !== null && price > 0) usdtIrt = price;
    }

    if (btcUsdt === null && wallexBtcResult.status === "fulfilled") {
      const price = number(wallexBtcResult.value?.result?.latestTrades?.[0]?.price);
      if (price !== null && price > 0) btcUsdt = price;
    }
  }

  if (usdtIrt === null || btcUsdt === null) {
    try {
      const wallex = await fetchJson("https://api.wallex.ir/v1/markets");
      if (wallex?.success === true && wallex?.result?.symbols) {
        if (usdtIrt === null) {
          const wallexUsdt = number(wallex.result.symbols?.USDTTMN?.stats?.lastPrice);
          if (wallexUsdt !== null && wallexUsdt > 0) usdtIrt = wallexUsdt;
        }

        if (btcUsdt === null) {
          const wallexBtc = number(wallex.result.symbols?.BTCUSDT?.stats?.lastPrice);
          if (wallexBtc !== null && wallexBtc > 0) btcUsdt = wallexBtc;
        }
      }
    } catch {
      // Continue to the global fallback below.
    }
  }

  // Global fallback: CoinGecko is used only if the Iranian sources fail.
  // Tether is returned in IRR, so convert rial to toman for the UI.
  if (usdtIrt === null || btcUsdt === null) {
    try {
      const global = await fetchJson(
        "https://api.coingecko.com/api/v3/simple/price?ids=tether,bitcoin&vs_currencies=irr,usd"
      );

      if (usdtIrt === null) {
        const tetherIrr = number(global?.tether?.irr);
        if (tetherIrr !== null && tetherIrr > 0) usdtIrt = tetherIrr / 10;
      }

      if (btcUsdt === null) {
        const bitcoinUsd = number(global?.bitcoin?.usd);
        if (bitcoinUsd !== null && bitcoinUsd > 0) btcUsdt = bitcoinUsd;
      }
    } catch {
      // Keep any valid value and fall through to the existing cache.
    }
  }

  if (usdtIrt === null || btcUsdt === null) {
    throw new Error("crypto_sources_unavailable");
  }

  return {
    usdtIrt,
    btcUsdt,
    updatedAt: timestamps.length ? Math.min(...timestamps) : Date.now(),
  };
}

async function getCrypto(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(CRYPTO_CACHE_KEY, { method: "GET" });
  const cached = await cache.match(cacheKey);

  try {
    const prices = await readCryptoPrices();
    const body = {
      ok: true,
      source: "Nobitex public market data",
      ...prices,
      fetchedAt: new Date().toISOString(),
    };

    const result = response(body, {
      "Cache-Control": "public, max-age=15, stale-if-error=300",
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
          "X-Crypto-Source": "cache",
        },
      });
    }

    return response(
      { ok: false, reason: "crypto_unavailable" },
      { "Cache-Control": "no-store" }
    );
  }
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

    if (url.pathname === "/api/crypto") {
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

      return getCrypto(ctx);
    }

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