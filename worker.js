const METALS_CACHE_KEY = "https://meead-accessories.local/api/metals-cache";
const CRYPTO_CACHE_KEY = "https://meead-accessories.local/api/crypto-cache";
const NOBITEX_API = "https://apiv2.nobitex.ir";
const GOLD_API = "https://api.gold-api.com/price";
const ALYAWM_SPOT = "https://alyawmgold.com/api/v1/spot/latest?country=USD";
const ALYAWM_HISTORY = "https://alyawmgold.com/api/v1/history";
const XAUS_INTRADAY = "https://xaus.com/api/v1/intraday?symbol=xau&hours=24";

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
  // Fetch all independent sources in parallel so one blocked/slow API cannot
  // consume the Worker timeout and make the whole crypto card empty.
  const btcSources = [
    {
      name: "CoinLore",
      promise: fetchJson("https://api.coinlore.net/api/ticker/?id=90", 5000),
      parse: (d) => number(Array.isArray(d) ? d?.[0]?.price_usd : d?.data?.[0]?.price_usd),
    },
    {
      name: "Kraken",
      promise: fetchJson("https://api.kraken.com/0/public/Ticker?pair=xbtusd", 5000),
      parse: (d) => {
        const result = d?.result;
        const row = result?.XXBTZUSD || result?.XBTUSD || Object.values(result || {})?.[0];
        return number(row?.c?.[0]);
      },
    },
    {
      name: "Coinbase",
      promise: fetchJson("https://api.coinbase.com/v2/prices/BTC-USD/spot", 5000),
      parse: (d) => number(d?.data?.amount),
    },
    {
      name: "CoinPaprika",
      promise: fetchJson("https://api.coinpaprika.com/v1/tickers/btc-bitcoin?quotes=USD", 5000),
      parse: (d) => number(d?.quotes?.USD?.price),
    },
  ];

  const usdtSources = [
    {
      name: "Nobitex",
      promise: fetchJson(NOBITEX_API + "/v3/orderbook/USDTIRT", 5000),
      parse: (d) => {
        if (d?.status !== "ok") return null;
        const raw = number(d?.lastTradePrice);
        return raw !== null && raw > 0 ? raw / 10 : null;
      },
    },
    {
      name: "Nobitex All Markets",
      promise: fetchJson(NOBITEX_API + "/v3/orderbook/all", 5000),
      parse: (d) => {
        const row = d?.USDTIRT;
        if (!row) return null;
        const raw = number(row?.lastTradePrice);
        return raw !== null && raw > 0 ? raw / 10 : null;
      },
    },
    {
      name: "Nobitex Stats",
      promise: fetchJson(
        NOBITEX_API + "/market/stats?srcCurrency=usdt&dstCurrency=rls",
        5000
      ),
      parse: (d) => {
        const row = d?.stats?.["usdt-rls"];
        const raw = number(row?.latest || row?.lastTradePrice);
        return raw !== null && raw > 0 ? raw / 10 : null;
      },
    },
    {
      name: "Nobitex Trades",
      promise: fetchJson(NOBITEX_API + "/v2/trades/USDTIRT", 5000),
      parse: (d) => {
        const raw = number(d?.trades?.[0]?.price);
        return raw !== null && raw > 0 ? raw / 10 : null;
      },
    },
    {
      name: "Wallex",
      promise: fetchJson("https://api.wallex.ir/v1/markets", 5000),
      parse: (d) => {
        const row = d?.result?.symbols?.USDTTMN;
        const price = number(row?.stats?.lastPrice || row?.stats?.bidPrice);
        return price !== null && price > 0 ? price : null;
      },
    },
  ];

  const settled = await Promise.allSettled([
    ...btcSources.map((source) => source.promise),
    ...usdtSources.map((source) => source.promise),
  ]);

  let btcUsdt = null;
  let btcSource = null;

  for (let i = 0; i < btcSources.length; i++) {
    const result = settled[i];
    if (result.status !== "fulfilled") continue;
    try {
      const price = btcSources[i].parse(result.value);
      if (price !== null && price > 0) {
        btcUsdt = price;
        btcSource = btcSources[i].name;
        break;
      }
    } catch {
      // Try the next independent BTC source.
    }
  }

  let usdtIrt = null;
  let usdtSource = null;

  for (let i = 0; i < usdtSources.length; i++) {
    const result = settled[btcSources.length + i];
    if (result.status !== "fulfilled") continue;
    try {
      const price = usdtSources[i].parse(result.value);
      if (price !== null && price > 0) {
        usdtIrt = price;
        usdtSource = usdtSources[i].name;
        break;
      }
    } catch {
      // Try the next independent USDT source.
    }
  }

  if (btcUsdt === null && usdtIrt === null) {
    throw new Error("crypto_sources_unavailable");
  }

  return {
    ok: true,
    usdtIrt,
    btcUsdt,
    btcSource,
    usdtSource,
    source: [btcSource, usdtSource].filter(Boolean).join(" + "),
    updatedAt: Date.now(),
  };
}
async function getXau24h(ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://meead-accessories.local/api/xau-24h", { method: "GET" });
  const cached = await cache.match(cacheKey);

  try {
    const data = await fetchJson(XAUS_INTRADAY + `&fresh=${Date.now()}`, 7000);
    const body = {
      ok: true,
      ...data,
      fetchedAt: new Date().toISOString(),
    };
    const result = response(body, {
      "Cache-Control": "public, max-age=60, stale-if-error=300",
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
          "X-XAU-Source": "cache",
        },
      });
    }

    return response(
      { ok: false, reason: "xau_unavailable" },
      { "Cache-Control": "no-store" }
    );
  }
}

async function getCrypto(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(CRYPTO_CACHE_KEY, { method: "GET" });
  const cached = await cache.match(cacheKey);

  try {
    const prices = await readCryptoPrices();
    const body = {
      ok: true,
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

    if (url.pathname === "/api/xau-24h") {
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

      return getXau24h(ctx);
    }

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