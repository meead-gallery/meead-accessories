import path from "node:path";

export default function liveMetalsWidgetPlugin() {
  return {
    name: "meead-live-metals-widget",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(path.join("src", "App.jsx"))) return null;
      if (code.includes("function LiveMetalsPrices()")) return null;

      const component = `
function LiveMetalsPrices() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadPrices = useCallback(async () => {
    const fetchJson = async (url, timeoutMs = 7000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("price_api_error");
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      const [gold, silver] = await Promise.all([
        fetchJson("https://api.gold-api.com/price/XAU"),
        fetchJson("https://api.gold-api.com/price/XAG"),
      ]);
      const goldPrice = Number(gold?.price);
      const silverPrice = Number(silver?.price);
      if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) throw new Error("invalid_price");
      setData({ gold: goldPrice, silver: silverPrice, updatedAt: gold?.updatedAt || gold?.timestamp || null, source: "Gold API" });
      return;
    } catch (primaryError) {
      try {
        const backup = await fetchJson("https://xaus.com/api/v1/spot?compact=1&fresh=" + Date.now());
        const goldPrice = Number(backup?.spot_usd_oz);
        const silverPrice = Number(backup?.silver_usd_oz);
        if (!Number.isFinite(goldPrice) || !Number.isFinite(silverPrice)) throw new Error("invalid_backup_price");
        setData({ gold: goldPrice, silver: silverPrice, updatedAt: backup?.price_as_of || backup?.updated_at || null, source: "XAUS" });
      } catch (backupError) {
        console.warn("Live metals price refresh failed:", backupError);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrices();
    const timer = setInterval(loadPrices, 30000);
    return () => clearInterval(timer);
  }, [loadPrices]);

  const formatUsd = (value) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatTime = (value) => {
    if (!value) return "اکنون";
    const date = typeof value === "number" ? new Date(value < 10000000000 ? value * 1000 : value) : new Date(value);
    if (Number.isNaN(date.getTime())) return "اکنون";
    return date.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <section className="live-metals-card" aria-label="قیمت لحظه‌ای انس طلا و نقره">
      <div className="live-metals-head">
        <div>
          <div className="live-metals-title">بازار جهانی</div>
          <div className="live-metals-subtitle">قیمت لحظه‌ای هر انس به دلار</div>
        </div>
        <span className={`live-metals-status ${data ? "is-live" : ""}`}>
          <span className="live-metals-dot" /> {data ? "آنلاین" : "در حال دریافت"}
        </span>
      </div>

      <div className="live-metals-grid">
        <div className="live-metal-item gold-metal">
          <div className="live-metal-label"><span className="metal-symbol">Au</span><span>طلا</span><small>XAU / USD</small></div>
          <div className="live-metal-value">{data ? "$" + formatUsd(data.gold) : "—"}</div>
        </div>
        <div className="live-metal-divider" />
        <div className="live-metal-item silver-metal">
          <div className="live-metal-label"><span className="metal-symbol">Ag</span><span>نقره</span><small>XAG / USD</small></div>
          <div className="live-metal-value">{data ? "$" + formatUsd(data.silver) : "—"}</div>
        </div>
      </div>

      <div className="live-metals-footer">
        <span>● بروزرسانی خودکار هر ۳۰ ثانیه</span>
        <span>{data ? `آخرین داده: ${formatTime(data.updatedAt)}` : loading ? "در حال اتصال…" : "قیمت موقتاً در دسترس نیست"}</span>
      </div>
    </section>
  );
}

`;

      let next = code;
      const homeMarker = "function Home({ settings, orders, closedByHours, marketBuyOpen, marketSellOpen, startQuote, setView }) {";
      if (!next.includes(homeMarker)) return null;

      next = next.replace(homeMarker, component + homeMarker);
      next = next.replace(
        "      <MarketBanner closedByHours={closedByHours} market={settings.market} />",
        "      <MarketBanner closedByHours={closedByHours} market={settings.market} />\n      <LiveMetalsPrices />"
      );

      const styleMarker = "      .update-row {";
      const styles = `      .live-metals-card { background: linear-gradient(145deg,#FFFFFF 0%,#F8F9FA 100%); border:1px solid rgba(169,128,58,0.22); border-radius:16px; padding:13px 14px 10px; margin-bottom:14px; box-shadow:0 5px 18px rgba(20,30,45,0.06); }\n      .live-metals-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }\n      .live-metals-title { font-size:13px; font-weight:800; color:#1E242B; }\n      .live-metals-subtitle { margin-top:2px; font-size:9.5px; color:#93A0AF; }\n      .live-metals-status { display:flex; align-items:center; gap:5px; padding:4px 8px; border-radius:999px; background:#F0F2F4; color:#8A94A2; font-size:9.5px; font-weight:700; white-space:nowrap; }\n      .live-metals-status.is-live { background:rgba(18,145,91,0.08); color:#0F7A4C; }\n      .live-metals-dot { width:6px; height:6px; border-radius:50%; background:#AAB2BC; }\n      .live-metals-status.is-live .live-metals-dot { background:#12915B; box-shadow:0 0 0 3px rgba(18,145,91,0.10); }\n      .live-metals-grid { display:grid; grid-template-columns:1fr 1px 1fr; align-items:center; gap:12px; margin-top:12px; }\n      .live-metal-divider { height:34px; background:rgba(30,40,50,0.08); }\n      .live-metal-item { min-width:0; }\n      .live-metal-label { display:flex; align-items:center; gap:6px; color:#667085; font-size:11px; font-weight:700; }\n      .live-metal-label small { margin-right:auto; font-family:'JetBrains Mono',monospace; direction:ltr; font-size:8px; color:#A0A8B3; font-weight:500; }\n      .metal-symbol { width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:700; }\n      .gold-metal .metal-symbol { background:rgba(169,128,58,0.12); color:#A9803A; border:1px solid rgba(169,128,58,0.28); }\n      .silver-metal .metal-symbol { background:rgba(102,112,133,0.10); color:#667085; border:1px solid rgba(102,112,133,0.18); }\n      .live-metal-value { margin-top:5px; font-family:'JetBrains Mono',monospace; direction:ltr; text-align:right; font-size:16px; font-weight:800; letter-spacing:-0.4px; color:#1E242B; }\n      .gold-metal .live-metal-value { color:#9A732F; }\n      .live-metals-footer { display:flex; justify-content:space-between; gap:8px; margin-top:10px; padding-top:8px; border-top:1px solid rgba(30,40,50,0.06); color:#9AA3AE; font-size:8.5px; }\n      @media (max-width:380px) { .live-metal-label small { display:none; } .live-metals-footer { font-size:8px; } .live-metal-value { font-size:14px; } }\n\n`;
      if (next.includes(styleMarker)) next = next.replace(styleMarker, styles + styleMarker);

      return { code: next, map: null };
    },
  };
}
