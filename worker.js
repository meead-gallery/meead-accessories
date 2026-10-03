const METALS_CACHE_KEY = "https://meead-accessories.local/api/metals-cache";
const IRAN_MARKET_CACHE_KEY = "https://meead-accessories.local/api/iran-market-cache";
const CRYPTO_CACHE_KEY = "https://meead-accessories.local/api/crypto-cache";
const NOBITEX_API = "https://apiv2.nobitex.ir";
const GOLD_API = "https://api.gold-api.com/price";
const ALYAWM_SPOT = "https://alyawmgold.com/api/v1/spot/latest?country=USD";
const ALYAWM_HISTORY = "https://alyawmgold.com/api/v1/history";
const XAUS_CHART = "https://xaus.com/api/v1/chart";

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

async function fetchText(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Meead/1.0 (+https://meead.sachmeh.workers.dev)",
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`upstream_${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeIranDigits(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٬،]/g, ",")
    .replace(/٫/g, ".");
}

function parseTgjuMarketRow(html, labels) {
  const text = normalizeIranDigits(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
  );

  // TGJU's widget contains the same market label more than once (menus,
  // selectors, footer and the actual price row). Do not use lastIndexOf:
  // it can land on a label that has no price beside it.
  for (const label of labels) {
    let from = 0;

    while (from < text.length) {
      const index = text.indexOf(label, from);
      if (index < 0) break;

      const tail = text.slice(index + label.length, index + label.length + 260);
      const match = tail.match(/([0-9][0-9,\\.]*)(?:\\s*\\(([-+]?\\d+(?:\\.\\d+)?)%\\))?/);

      if (match) {
        const value = Number(String(match[1]).replace(/,/g, ""));
        if (Number.isFinite(value) && value > 0) {
          return {
            valueRial: value,
            change: match[2] == null ? null : Number(match[2]),
          };
        }
      }

      from = index + label.length;
    }
  }

  return null;
}
function parseTgjuDollarProfile(html) {
  const text = normalizeIranDigits(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
  );

  const patterns = [
    /نرخ فعلی\s*:?\s*([0-9][0-9,\.]+)/,
    /Last\s*:?\s*([0-9][0-9,\.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(String(match[1]).replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) {
      return { valueRial: value };
    }
  }

  return null;
}

async function readTgjuDollar() {
  const sources = [
    "https://www.tgju.org/profile/price_dollar_rl/today?fresh=" + Date.now(),
    "https://english.tgju.org/profile/price_dollar_rl/today?fresh=" + Date.now(),
    "https://gem.tgju.org/profile/price_dollar_rl?fresh=" + Date.now(),
  ];

  let lastError = null;

  for (const url of sources) {
    try {
      const html = await fetchText(url, 7000);
      const dollar = parseTgjuDollarProfile(html);

      if (!dollar) throw new Error("tgju_dollar_parse_failed");

      return {
        dollarToman: Math.round(dollar.valueRial / 10),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("tgju_dollar_unavailable");
}

async function readTgjuIranMarket() {
  const sources = [
    "https://www.tgju.org/widget/get/market-data?fresh=" + Date.now(),
    "https://gem.tgju.org/widget/get/market-data?fresh=" + Date.now(),
  ];

  let lastError = null;

  for (const url of sources) {
    try {
      const html = await fetchText(url, 7000);
      const gold = parseTgjuMarketRow(html, ["طلا ۱۸", "طلا 18", "طلای 18", "طلای ۱۸"]);

      if (!gold) throw new Error("tgju_gold_parse_failed");

      const dollar = await readTgjuDollar();

      return {
        gold18Toman: Math.round(gold.valueRial / 10),
        dollarToman: dollar.dollarToman,
        gold18Change: gold.change,
        dollarChange: null,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("tgju_market_unavailable");
}

async function getIranMarket(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(IRAN_MARKET_CACHE_KEY, { method: "GET" });
  const cached = await cache.match(cacheKey);

  try {
    const prices = await readTgjuIranMarket();
    const body = {
      ok: true,
      source: "TGJU",
      ...prices,
      fetchedAt: new Date().toISOString(),
    };
    const result = response(body, {
      "Cache-Control": "public, max-age=25, stale-if-error=300",
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
          "X-Iran-Market-Source": "cache",
        },
      });
    }

    return response(
      { ok: false, reason: "iran_market_unavailable" },
      { "Cache-Control": "no-store" }
    );
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
    const data = await fetchJson(
      XAUS_CHART + `?symbol=xau&range=1d&interval=15m&fresh=${Date.now()}`,
      7000
    );
    const rows = Array.isArray(data?.points) ? data.points : [];
    const points = rows
      .map((row) => ({ t: Number(row?.t) * 1000, p: Number(row?.c) }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0)
      .sort((a, b) => a.t - b.t);
    const body = {
      ok: true,
      points,
      count: points.length,
      data_state: data?.data_state || null,
      source: "XAUS chart XAU/USD 15m",
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

async function getXag24h(ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://meead-accessories.local/api/xag-24h", { method: "GET" });
  const cached = await cache.match(cacheKey);

  try {
    const data = await fetchJson(
      XAUS_CHART + `?symbol=silver&range=1d&interval=15m&fresh=${Date.now()}`,
      7000
    );
    const rows = Array.isArray(data?.points) ? data.points : [];
    const points = rows
      .map((row) => ({ t: Number(row?.t) * 1000, p: Number(row?.c) }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0)
      .sort((a, b) => a.t - b.t);
    const body = {
      ok: true,
      points,
      count: points.length,
      data_state: data?.data_state || null,
      source: "XAUS chart XAG/USD 15m",
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
          "X-XAG-Source": "cache",
        },
      });
    }

    return response(
      { ok: false, reason: "xag_unavailable" },
      { "Cache-Control": "no-store" }
    );
  }
}

async function getBtc24h(ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://meead-accessories.local/api/btc-24h", { method: "GET" });
  const cached = await cache.match(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  const from = now - 24 * 60 * 60;
  const makeResponse = (points, source) => {
    const body = { ok: true, source, points, fetchedAt: new Date().toISOString() };
    const result = response(body, { "Cache-Control": "public, max-age=60, stale-if-error=300" });
    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  };
  try {
    const data = await fetchJson(`${NOBITEX_API}/market/udf/history?symbol=BTCUSDT&resolution=15&from=${from}&to=${now}`, 7000);
    const points = Array.isArray(data?.t) && Array.isArray(data?.c)
      ? data.t.map((time, index) => ({ t: Number(time) * 1000, p: Number(data.c[index]) })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0).sort((a, b) => a.t - b.t)
      : [];
    if (points.length >= 2) return makeResponse(points, "Nobitex BTC-USDT 15m");
  } catch {}
  try {
    const data = await fetchJson(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900&start=${new Date(from * 1000).toISOString()}&end=${new Date(now * 1000).toISOString()}`, 7000);
    const points = Array.isArray(data) ? data.map(row => ({ t: Number(row?.[0]) * 1000, p: Number(row?.[4]) })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0).sort((a,b) => a.t-b.t) : [];
    if (points.length >= 2) return makeResponse(points, "Coinbase BTC-USD 15m");
  } catch {}
  try {
    const data = await fetchJson(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=15&since=${from}`, 7000);
    const rows = data?.result?.XXBTZUSD || data?.result?.XBTUSD || Object.values(data?.result || {}).find(Array.isArray);
    const points = Array.isArray(rows) ? rows.map(row => ({ t: Number(row?.[0]) * 1000, p: Number(row?.[4]) })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0).sort((a,b) => a.t-b.t) : [];
    if (points.length >= 2) return makeResponse(points, "Kraken BTC-USD 15m");
  } catch {}
  try {
    const startIso = new Date(from * 1000).toISOString();
    const endIso = new Date(now * 1000).toISOString();
    const data = await fetchJson(`https://api.coinpaprika.com/v1/coins/btc-bitcoin/ohlcv/historical?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&interval=15m`, 7000);
    const points = Array.isArray(data) ? data.map(row => ({ t: new Date(row?.time_open || row?.time_close).getTime(), p: Number(row?.close) })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0).sort((a,b) => a.t-b.t) : [];
    if (points.length >= 2) return makeResponse(points, "CoinPaprika BTC-USD 15m");
  } catch {}
  if (cached) return new Response(cached.body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*", "X-BTC-Source": "cache" } });
  return response({ ok: false, reason: "btc_unavailable" }, { "Cache-Control": "no-store" });
}
async function getUsdt24h(ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://meead-accessories.local/api/usdt-24h", { method: "GET" });
  const cached = await cache.match(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  const from = now - 24 * 60 * 60;

  const makeResponse = (points, source) => {
    const body = {
      ok: true,
      source,
      points,
      count: points.length,
      fetchedAt: new Date().toISOString(),
    };
    const result = response(body, {
      "Cache-Control": "public, max-age=60, stale-if-error=300",
    });
    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  };

  const normalizePoints = (rows) => {
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => {
        if (Array.isArray(row)) {
          return {
            t: new Date(row[0] || row[1]).getTime(),
            p: Number(row[4] ?? row[1] ?? row[0]),
          };
        }

        const rawTime = row?.t ?? row?.time ?? row?.timestamp ?? row?.date;
        const rawPrice =
          row?.close ??
          row?.c ??
          row?.price ??
          row?.value ??
          row?.last;

        let t = Number(rawTime);
        if (Number.isFinite(t) && t < 100000000000) t *= 1000;
        if (!Number.isFinite(t)) t = new Date(rawTime).getTime();

        return { t, p: Number(rawPrice) };
      })
      .filter(
        (point) =>
          Number.isFinite(point.t) &&
          Number.isFinite(point.p) &&
          point.p > 0 &&
          point.t >= from * 1000 &&
          point.t <= now * 1000 + 60 * 60 * 1000
      )
      .sort((a, b) => a.t - b.t);
  };

  // Primary: Arzbin public read-only market-history service.
  // It provides USDT/Toman OHLC history without requiring an API key.
  try {
    const initResponse = await fetch("https://hub.arzbin.com/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "Meead", version: "1.0" },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!initResponse.ok) throw new Error(`arzbin_init_${initResponse.status}`);

    const sessionId = initResponse.headers.get("Mcp-Session-Id");
    if (!sessionId) throw new Error("arzbin_session_missing");

    const historyResponse = await fetch("https://hub.arzbin.com/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_market_history",
          arguments: { assetType: "crypto", code: "USDT", days: 1 },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!historyResponse.ok) throw new Error(`arzbin_history_${historyResponse.status}`);

    const raw = await historyResponse.text();
    const jsonCandidates = [];

    try {
      jsonCandidates.push(JSON.parse(raw));
    } catch {}

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        jsonCandidates.push(JSON.parse(trimmed.slice(5).trim()));
      } catch {}
    }

    const collectRows = (value) => {
      const found = [];
      const visit = (node) => {
        if (!node || typeof node !== "object") return;

        if (Array.isArray(node)) {
          if (
            node.length &&
            node.every(
              (item) =>
                Array.isArray(item) ||
                (item && typeof item === "object" &&
                  ("close" in item || "c" in item || "price" in item || "value" in item))
            )
          ) {
            found.push(...node);
          }
          for (const child of node) visit(child);
          return;
        }

        for (const [key, child] of Object.entries(node)) {
          if (
            typeof child === "string" &&
            (key === "text" || key === "data" || key === "result")
          ) {
            try {
              visit(JSON.parse(child));
            } catch {}
          }
          visit(child);
        }
      };

      visit(value);
      return found;
    };

    for (const candidate of jsonCandidates) {
      const points = normalizePoints(collectRows(candidate));
      if (points.length >= 2) {
        return makeResponse(points, "Arzbin USDT/Toman OHLC");
      }
    }
  } catch {
    // Continue to direct exchange sources.
  }

  // Backup: Wallex 1-hour candles.
  try {
    const data = await fetchJson(
      `https://api.wallex.ir/v1/udf/history?symbol=USDTTMN&resolution=60&from=${from}&to=${now}&countback=24`,
      5000
    );
    const points = Array.isArray(data?.t) && Array.isArray(data?.c)
      ? data.t.map((time, index) => ({
          t: Number(time) * 1000,
          p: Number(data.c[index]) / 10,
        }))
        .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0)
        .sort((a, b) => a.t - b.t)
      : [];
    if (points.length >= 2) return makeResponse(points, "Wallex OHLC 1h");
  } catch {}

  // Backup: Nobitex 15-minute candles.
  const nobitexHosts = ["https://apiv2.nobitex.ir", "https://api.nobitex.ir"];
  for (const host of nobitexHosts) {
    try {
      const data = await fetchJson(
        `${host}/market/udf/history?symbol=USDTIRT&resolution=15&from=${from}&to=${now}&countback=96`,
        5000
      );
      const points = Array.isArray(data?.t) && Array.isArray(data?.c)
        ? data.t.map((time, index) => ({
            t: Number(time) * 1000,
            p: Number(data.c[index]) / 10,
          }))
          .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0)
          .sort((a, b) => a.t - b.t)
        : [];
      if (points.length >= 2) return makeResponse(points, "Nobitex OHLC 15m");
    } catch {}
  }

  // Last real-data fallback: recent Nobitex trades.
  try {
    const data = await fetchJson(
      "https://apiv2.nobitex.ir/v2/trades/USDTIRT?limit=1000",
      5000
    );
    const points = Array.isArray(data?.trades)
      ? data.trades
          .map((trade) => ({
            t: new Date(trade?.time || trade?.timestamp || trade?.createdAt).getTime(),
            p: Number(trade?.price) / 10,
          }))
          .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0)
          .sort((a, b) => a.t - b.t)
      : [];

    if (points.length >= 2) return makeResponse(points, "Nobitex trades");
  } catch {}

  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "X-USDT-Source": "cache",
      },
    });
  }

  return response(
    { ok: false, reason: "usdt_unavailable" },
    { "Cache-Control": "no-store" }
  );
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

    if (url.pathname === "/api/xag-24h") {
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

      return getXag24h(ctx);
    }

    if (url.pathname === "/api/btc-24h") {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
      }
      if (request.method !== "GET") return response({ ok: false, reason: "method_not_allowed" }, { Allow: "GET, OPTIONS" });
      return getBtc24h(ctx);
    }

    if (url.pathname === "/api/usdt-24h") {
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

      return getUsdt24h(ctx);
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

    if (url.pathname === "/api/iran-market") {
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

      return getIranMarket(ctx);
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