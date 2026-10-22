const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=15, s-maxage=15",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "MeeadMarketPrices/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("upstream_http_" + response.status);
  return response.json();
}

function positiveNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function tgjuItem(current, ...keys) {
  for (const key of keys) {
    const item = current?.[key];
    const price = positiveNumber(item?.p, item?.price?.value, item?.price);
    if (price) return { price, change: Number(item?.dp ?? item?.changePercent ?? NaN) };
  }
  return null;
}

async function metals() {
  const [goldData, silverData] = await Promise.all([
    getJson("https://api.gold-api.com/price/XAU"),
    getJson("https://api.gold-api.com/price/XAG"),
  ]);
  const gold = positiveNumber(goldData?.price, goldData?.value, goldData?.gold);
  const silver = positiveNumber(silverData?.price, silverData?.value, silverData?.silver);
  if (!gold || !silver) throw new Error("invalid_global_metals_response");
  return {
    ok: true,
    gold,
    silver,
    goldChange24h: Number(goldData?.changePercent ?? goldData?.change_24h ?? NaN),
    silverChange24h: Number(silverData?.changePercent ?? silverData?.change_24h ?? NaN),
    updatedAt: goldData?.updatedAt ?? silverData?.updatedAt ?? new Date().toISOString(),
  };
}

async function iranMarket() {
  // TGJU publishes the same market snapshot consumed by its web price boards.
  const data = await getJson("https://call3.tgju.org/ajax.json?rev=sS6c6AGKSb5ba24j7ZZmhqj6ohg1z5qoIzCKE9nfC6jLfPOLLHFN7n27Po5J");
  const current = data?.current;
  const dollar = tgjuItem(current, "usd", "price_dollar_rl", "dollar");
  const gold18 = tgjuItem(current, "geram18", "gold18", "price_geram18");
  if (!dollar || !gold18) throw new Error("tgju_market_fields_missing");
  // TGJU prices are quoted in rials; the UI uses toman.
  return {
    ok: true,
    dollarToman: dollar.price / 10,
    gold18Toman: gold18.price / 10,
    dollarChange: dollar.change,
    gold18Change: gold18.change,
    updatedAt: new Date().toISOString(),
  };
}

async function crypto() {
  const [nobitex, bitcoin] = await Promise.all([
    getJson("https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls"),
    getJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"),
  ]);
  const usdtRial = positiveNumber(nobitex?.stats?.["usdt-rls"]?.latest);
  const btcUsdt = positiveNumber(bitcoin?.bitcoin?.usd);
  if (!usdtRial || !btcUsdt) throw new Error("invalid_crypto_response");
  return {
    ok: true,
    usdtIrt: usdtRial / 10,
    btcUsdt,
    updatedAt: new Date().toISOString(),
  };
}

export async function onRequestGet({ request }) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  try {
    if (pathname === "/api/metals") return json(await metals());
    if (pathname === "/api/iran-market") return json(await iranMarket());
    if (pathname === "/api/crypto") return json(await crypto());
    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    console.error("Meead market endpoint failed", pathname, error?.message ?? error);
    return json({
      ok: false,
      error: "market_data_unavailable",
      endpoint: pathname,
      updatedAt: new Date().toISOString(),
    }, 502);
  }
}
