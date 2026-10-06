import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Bar = { close: number };

async function yahoo(symbol: string): Promise<Bar[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "3mo");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return closes.filter((x: unknown): x is number => typeof x === "number").map((close) => ({ close }));
}

function pct(a: number, b: number) {
  return b ? ((a - b) / b) * 100 : 0;
}

function avg(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function level(n: number) {
  return Number(n).toFixed(2);
}

function makeAnalysis(metal: "gold" | "silver", bars: Bar[], dxy: Bar[]) {
  if (bars.length < 25) throw new Error(`Not enough ${metal} data`);
  const closes = bars.map((b) => b.close);
  const last = closes.at(-1)!;
  const prev = closes.at(-2)!;
  const five = closes.at(-6)!;
  const twenty = closes.at(-21)!;
  const ma10 = avg(closes.slice(-10));
  const ma20 = avg(closes.slice(-20));
  const recent20 = closes.slice(-20);
  const support = Math.min(...recent20);
  const resistance = Math.max(...recent20);
  const fiveRet = pct(last, five);
  const twentyRet = pct(last, twenty);
  const dxyLast = dxy.at(-1)?.close ?? 0;
  const dxyPrev = dxy.at(-6)?.close ?? dxyLast;
  const dxy5 = pct(dxyLast, dxyPrev);

  let bias: "صعودی" | "نزولی" | "خنثی" = "خنثی";
  if (last > ma10 && ma10 >= ma20 && fiveRet > 0) bias = "صعودی";
  else if (last < ma10 && ma10 <= ma20 && fiveRet < 0) bias = "نزولی";

  const name = metal === "gold" ? "طلا" : "نقره";
  const direction = fiveRet > 0 ? "افزایشی" : fiveRet < 0 ? "کاهشی" : "کم‌نوسان";
  const dxyText = dxy5 > 0.2 ? "قدرت گرفتن شاخص دلار یک فشار نزولی برای فلزات ایجاد می‌کند." : dxy5 < -0.2 ? "افت شاخص دلار به نفع فلزات گران‌بهاست." : "حرکت شاخص دلار فعلاً اثر تعیین‌کننده‌ای ندارد.";

  return {
    analysis_date: new Date().toISOString().slice(0, 10),
    metal,
    title: `${name}؛ ${direction} در کوتاه‌مدت`,
    summary: `قیمت پایانی اخیر حدود ${level(last)} است و بازده ۵روزه ${fiveRet.toFixed(2)}٪ و بازده ۲۰روزه ${twentyRet.toFixed(2)}٪ ثبت شده است. قیمت نسبت به میانگین‌های ۱۰ و ۲۰روزه ${last >= ma10 ? "بالاتر" : "پایین‌تر"} قرار دارد. ${dxyText}`,
    bias,
    support: level(support),
    resistance: level(resistance),
    key_driver: dxy5 > 0.2 ? "شاخص دلار و جهت حرکت آن" : dxy5 < -0.2 ? "افت شاخص دلار و تقاضای فلزات" : "مومنتوم قیمت و فاصله از میانگین‌های کوتاه‌مدت",
    risk_note: `شکست حمایت ${level(support)} یا مقاومت ${level(resistance)} می‌تواند سناریوی فعلی را تغییر دهد؛ این متن تحلیل عمومی است و توصیه سرمایه‌گذاری نیست.`,
    source_note: "داده‌های روزانه Yahoo Finance؛ نمادها: GC=F، SI=F و DX-Y.NYB. تحلیل به‌صورت الگوریتمی و اختصاصی برای Meead تولید شده است.",
    published: true,
  };
}

async function main() {
  const [gold, silver, dxy] = await Promise.all([
    yahoo("GC=F"),
    yahoo("SI=F"),
    yahoo("DX-Y.NYB"),
  ]);

  const rows = [
    makeAnalysis("gold", gold, dxy),
    makeAnalysis("silver", silver, dxy),
  ];

  const response = await fetch(`${SUPABASE_URL}/rest/v1/daily_market_analysis?on_conflict=analysis_date,metal`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) throw new Error(`Supabase insert failed: ${response.status} ${await response.text()}`);

  return { ok: true, date: rows[0].analysis_date, metals: rows.map((r) => r.metal) };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const result = await main();
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
