import path from "node:path";

export default function liveCryptoWidgetPlugin() {
  return {
    name: "meead-live-crypto-widget",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(path.join("src", "App.jsx"))) return null;
      if (code.includes("function LiveCryptoPrices()")) return null;

      const cryptoComponent = `
function LiveCryptoPrices() {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const loadPrices=useCallback(async()=>{
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),7000);
      const response=await fetch("/api/crypto",{signal:controller.signal,cache:"no-store"});
      clearTimeout(timer);
      if(!response.ok) throw new Error("crypto_unavailable");
      const result=await response.json();
      if(!result?.ok||(!Number.isFinite(Number(result.usdtIrt))&&!Number.isFinite(Number(result.btcUsdt)))) throw new Error("invalid_crypto_data");
      setData(result);
    }catch(error){console.warn("Live crypto price refresh failed:",error);}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{loadPrices();const timer=setInterval(loadPrices,30000);return()=>clearInterval(timer);},[loadPrices]);
  const formatToman=(value)=>Math.round(Number(value)).toLocaleString("fa-IR");
  const formatUsd=(value)=>Number(value).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const formatTime=(value)=>{
    if(!value)return "اکنون";
    const date=typeof value==="number"?new Date(value<10000000000?value*1000:value):new Date(value);
    if(Number.isNaN(date.getTime()))return "اکنون";
    return date.toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"});
  };
  return(
    <section className="live-metals-card" aria-label="قیمت لحظه‌ای تتر و بیت کوین">
      <div className="live-metals-head">
        <div><div className="live-metals-title">بازار ارز و رمزارز</div><div className="live-metals-subtitle">قیمت لحظه‌ای تتر به تومان و بیت‌کوین به دلار</div></div>
        <span className={"live-metals-status "+(data?"is-live":"")}><span className="live-metals-dot"/>{data?"آنلاین":"در حال دریافت"}</span>
      </div>
      <div className="live-metals-grid">
        <div className="live-metal-item silver-metal">
          <div className="live-metal-label"><span className="metal-symbol">₮</span><span>تتر</span><small>USDT / IRT</small></div>
          <div className="live-metal-price-row"><div className="live-metal-value">{Number.isFinite(Number(data?.usdtIrt))?formatToman(data.usdtIrt)+" تومان":"—"}</div></div>
        </div>
        <div className="live-metal-divider"/>
        <div className="live-metal-item gold-metal">
          <div className="live-metal-label"><span className="metal-symbol">₿</span><span>بیت‌کوین</span><small>BTC / USDT</small></div>
          <div className="live-metal-price-row"><div className="live-metal-value">{Number.isFinite(Number(data?.btcUsdt))?"$"+formatUsd(data.btcUsdt):"—"}</div></div>
        </div>
      </div>
      <div className="live-metals-footer"><span>● بروزرسانی خودکار هر ۳۰ ثانیه</span><span>{data?"آخرین داده: "+formatTime(data.updatedAt):loading?"در حال اتصال…":"قیمت موقتاً در دسترس نیست"}</span></div>
    </section>
  );
}

`;

      const metalsComponent = `
function LiveMetalsPrices() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const loadPrices = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const response = await fetch("/api/metals", { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!response.ok) throw new Error("metals_unavailable");
      const result = await response.json();
      if (!result?.ok || !Number.isFinite(Number(result.gold)) || !Number.isFinite(Number(result.silver))) throw new Error("invalid_metals_data");
      setData(result);
    } catch (error) {
      console.warn("Live metals price refresh failed:", error);
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
  const formatChange = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  };
  const formatTime = (value) => {
    if (!value) return "اکنون";
    const date = typeof value === "number" ? new Date(value < 10000000000 ? value * 1000 : value) : new Date(value);
    if (Number.isNaN(date.getTime())) return "اکنون";
    return date.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  };
  const ChangeBadge = ({ value }) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const up = n >= 0;
    return <span className={"live-metal-change " + (up ? "is-up" : "is-down")}>{up ? "▲" : "▼"} {formatChange(n)}</span>;
  };
  return (
    <section className="live-metals-card" aria-label="قیمت لحظه‌ای انس طلا و نقره">
      <div className="live-metals-head"><div><div className="live-metals-title">بازار جهانی</div><div className="live-metals-subtitle">قیمت لحظه‌ای هر انس به دلار</div></div><span className={"live-metals-status " + (data ? "is-live" : "")}><span className="live-metals-dot" /> {data ? "آنلاین" : "در حال دریافت"}</span></div>
      <div className="live-metals-grid">
        <div className="live-metal-item gold-metal"><div className="live-metal-label"><span className="metal-symbol">Au</span><span>طلا</span><small>XAU / USD</small></div><div className="live-metal-price-row"><div className="live-metal-value">{data ? "$" + formatUsd(data.gold) : "—"}</div><ChangeBadge value={data?.goldChange24h} /></div></div>
        <div className="live-metal-divider" />
        <div className="live-metal-item silver-metal"><div className="live-metal-label"><span className="metal-symbol">Ag</span><span>نقره</span><small>XAG / USD</small></div><div className="live-metal-price-row"><div className="live-metal-value">{data ? "$" + formatUsd(data.silver) : "—"}</div><ChangeBadge value={data?.silverChange24h} /></div></div>
      </div>
      <div className="live-metals-footer"><span>● بروزرسانی خودکار هر ۳۰ ثانیه</span><span>{data ? "آخرین داده: " + formatTime(data.updatedAt) : loading ? "در حال اتصال…" : "قیمت موقتاً در دسترس نیست"}</span></div>
    </section>
  );
}
`;

function LiveIranMarketPrices() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadPrices = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const response = await fetch("/api/iran-market", {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error("iran_market_unavailable");
      const result = await response.json();
      if (
        !result?.ok ||
        !Number.isFinite(Number(result.gold18Toman)) ||
        !Number.isFinite(Number(result.dollarToman))
      ) {
        throw new Error("invalid_iran_market_data");
      }
      setData(result);
    } catch (error) {
      console.warn("Live Iran market refresh failed:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrices();
    const timer = setInterval(loadPrices, 30000);
    return () => clearInterval(timer);
  }, [loadPrices]);

  const formatToman = (value) => Math.round(Number(value)).toLocaleString("fa-IR");

  const ChangeBadge = ({ value }) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const up = n >= 0;
    return (
      <span className={"iran-market-change " + (up ? "is-up" : "is-down")}>
        {up ? "▲" : "▼"} {Math.abs(n).toFixed(2)}٪
      </span>
    );
  };

  const formatTime = (value) => {
    if (!value) return "اکنون";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "اکنون";
    return date.toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <section className="iran-market-card" aria-label="نرخ لحظه‌ای طلا و دلار ایران">
      <div className="iran-market-head">
        <div>
          <div className="iran-market-title">بازار ایران</div>
          <div className="iran-market-subtitle">نرخ لحظه‌ای طلا و دلار · منبع TGJU</div>
        </div>
        <span className={"iran-market-status " + (data ? "is-live" : "")}>
          <span className="iran-market-dot" />
          {data ? "آنلاین" : "در حال دریافت"}
        </span>
      </div>

      <div className="iran-market-grid">
        <div className="iran-market-item">
          <div className="iran-market-label">
            <span className="iran-market-symbol gold">Au</span>
            <span>طلای ۱۸ عیار</span>
            <small>هر گرم</small>
          </div>
          <div className="iran-market-price-row">
            <div className="iran-market-value">
              {data ? formatToman(data.gold18Toman) + " تومان" : "—"}
            </div>
            <ChangeBadge value={data?.gold18Change} />
          </div>
        </div>

        <div className="iran-market-divider" />

        <div className="iran-market-item">
          <div className="iran-market-label">
            <span className="iran-market-symbol dollar">$</span>
            <span>دلار آزاد</span>
            <small>تومان</small>
          </div>
          <div className="iran-market-price-row">
            <div className="iran-market-value">
              {data ? formatToman(data.dollarToman) + " تومان" : "—"}
            </div>
            <ChangeBadge value={data?.dollarChange} />
          </div>
        </div>
      </div>

      <div className="iran-market-footer">
        <span>● بروزرسانی خودکار هر ۳۰ ثانیه</span>
        <span>
          {data
            ? "آخرین دریافت: " + formatTime(data.updatedAt)
            : loading
              ? "در حال اتصال…"
              : "قیمت موقتاً در دسترس نیست"}
        </span>
      </div>
    </section>
  );
}

      let next = code;

      const barsBlock = `      <div className="section-head bars-head">
        <span className="section-title">شمش نقره و طلا</span>
        <span className="soon-ribbon">به‌زودی</span>
      </div>
      <div className="bars-row">
        <div className="bar-card"><BarIcon tone="silver" /><span>شمش نقره</span></div>
        <div className="bar-card"><BarIcon tone="gold" /><span>شمش طلا</span></div>
      </div>`;
      if (!next.includes(barsBlock)) throw new Error("Meead bars visual marker missing");
      next = next.replace(barsBlock, `      {settings.liveMetalsEnabled !== false && <LiveMetalsPrices />}`);

      next = next.replace(
        'lastPriceUpdate: null,',
        'lastPriceUpdate: null,\nliveMetalsEnabled: true,\nliveCryptoEnabled: true,'
      );
      next = next.replace(
        'lastPriceUpdate: system.lastPriceUpdate ?? null ,',
        'lastPriceUpdate: system.lastPriceUpdate ?? null ,\nliveMetalsEnabled: system.liveMetalsEnabled ?? true,\nliveCryptoEnabled: system.liveCryptoEnabled ?? true,'
      );
      next = next.replace(
        'lastPriceUpdate: sys.last_price_update || null,',
        'lastPriceUpdate: sys.last_price_update || null,\nliveMetalsEnabled: sys.live_metals_enabled ?? true,\nliveCryptoEnabled: sys.live_crypto_enabled ?? true,'
      );

      next = next.replace(
        'p_support_instagram: s.instagram || "",\n  });',
        'p_support_instagram: s.instagram || "",\n    p_live_metals_enabled: patch.liveMetalsEnabled ?? current.liveMetalsEnabled ?? true,\n    p_live_crypto_enabled: patch.liveCryptoEnabled ?? current.liveCryptoEnabled ?? true,\n  });'
      );

      next = next.replace(
        '  const [bank, setBank] = useState(settings.bank);',
        '  const [bank, setBank] = useState(settings.bank);\n  const [liveMetalsEnabled, setLiveMetalsEnabled] = useState(settings.liveMetalsEnabled !== false);\n  const [liveCryptoEnabled, setLiveCryptoEnabled] = useState(settings.liveCryptoEnabled !== false);'
      );
      next = next.replace(
        '  const save = async () => {\n    const patch = {\n      priceLockMinutes: Number(lockMinutes) || 5,\n      sellValidityDays: Number(sellDays) || 3,\n      sellAddress, bank,\n    };',
        '  const save = async () => {\n    const patch = {\n      priceLockMinutes: Number(lockMinutes) || 5,\n      sellValidityDays: Number(sellDays) || 3,\n      sellAddress, bank,\n      liveMetalsEnabled,\n      liveCryptoEnabled,\n    };'
      );
      const settingsButtonMarker = '      <button className="primary-btn" onClick={save}>ذخیره تنظیمات</button>\n      <p className="admin-footnote"><Package size={14} /> ورود پنل مدیریت با Supabase Authentication و سطح دسترسی مدیر انجام می‌شود.</p>';
      const settingsToggle = '      <h3>نمایش بازارهای لحظه‌ای</h3>\n      <label className="toggle-row">\n        <input type="checkbox" checked={liveMetalsEnabled} onChange={(e) => setLiveMetalsEnabled(e.target.checked)} />\n        نمایش کارت «بازار جهانی» در صفحه اصلی\n      </label>\n      <label className="toggle-row">\n        <input type="checkbox" checked={liveCryptoEnabled} onChange={(e) => setLiveCryptoEnabled(e.target.checked)} />\n        نمایش کارت «بازار ارز و رمزارز» در صفحه اصلی\n      </label>\n\n' + settingsButtonMarker;
      if (next.includes(settingsButtonMarker)) next = next.replace(settingsButtonMarker, settingsToggle);

      const homeMarker = "function Home({ settings, orders, closedByHours, marketBuyOpen, marketSellOpen, startQuote, setView }) {";
      if (!next.includes(homeMarker)) return null;
      next = next.replace(homeMarker, cryptoComponent + metalsComponent + iranComponent + homeMarker);

      const trackButton = "      <button className=\"track-link\" onClick={() => setView(\"track\")}>\n        <Search size={14} /> پیگیری سفارش با کد رهگیری\n      </button>";

      if (next.includes(trackButton)) next = next.replace(trackButton, trackButton + "\n\n      {settings.liveCryptoEnabled !== false && <LiveCryptoPrices />}\n\n      <LiveIranMarketPrices />");

      const styleMarker = "      .update-row {";
      const styles = `
      .iran-market-card { background:linear-gradient(145deg,#FFFFFF 0%,#F8F9FA 100%); border:1px solid rgba(169,128,58,0.22); border-radius:16px; padding:13px 14px 10px; margin-top:10px; box-shadow:0 5px 18px rgba(20,30,45,0.06); }
      .iran-market-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .iran-market-title { font-size:13px; font-weight:800; color:#1E242B; }
      .iran-market-subtitle { margin-top:2px; font-size:9.5px; color:#93A0AF; }
      .iran-market-status { display:flex; align-items:center; gap:5px; padding:4px 8px; border-radius:999px; background:#F0F2F4; color:#8A94A2; font-size:9.5px; font-weight:700; white-space:nowrap; }
      .iran-market-status.is-live { background:rgba(18,145,91,0.08); color:#0F7A4C; }
      .iran-market-dot { width:6px; height:6px; border-radius:50%; background:#AAB2BC; }
      .iran-market-status.is-live .iran-market-dot { background:#12915B; box-shadow:0 0 0 3px rgba(18,145,91,0.10); }
      .iran-market-grid { display:grid; grid-template-columns:1fr 1px 1fr; align-items:center; gap:12px; margin-top:12px; }
      .iran-market-divider { height:46px; background:rgba(30,40,50,0.08); }
      .iran-market-item { min-width:0; }
      .iran-market-label { display:flex; align-items:center; gap:6px; color:#667085; font-size:11px; font-weight:700; }
      .iran-market-label small { margin-right:auto; font-size:8px; color:#A0A8B3; font-weight:500; }
      .iran-market-symbol { width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:700; }
      .iran-market-symbol.gold { background:rgba(169,128,58,0.12); color:#A9803A; border:1px solid rgba(169,128,58,0.28); }
      .iran-market-symbol.dollar { background:rgba(18,145,91,0.08); color:#0F7A4C; border:1px solid rgba(18,145,91,0.18); }
      .iran-market-price-row { display:flex; align-items:center; justify-content:flex-end; gap:7px; margin-top:5px; }
      .iran-market-value { font-family:'JetBrains Mono',monospace; direction:rtl; text-align:right; font-size:15px; font-weight:800; letter-spacing:-0.3px; color:#1E242B; white-space:nowrap; }
      .iran-market-item:first-child .iran-market-value { color:#9A732F; }
      .iran-market-change { direction:ltr; white-space:nowrap; font-family:'JetBrains Mono',monospace; font-size:8.5px; font-weight:800; padding:3px 5px; border-radius:6px; }
      .iran-market-change.is-up { color:#0F7A4C; background:rgba(18,145,91,0.08); }
      .iran-market-change.is-down { color:#B54747; background:rgba(181,71,71,0.08); }
      .iran-market-footer { display:flex; justify-content:space-between; gap:8px; margin-top:10px; padding-top:8px; border-top:1px solid rgba(30,40,50,0.06); color:#9AA3AE; font-size:8.5px; }
      @media (max-width:480px) { .home .iran-market-card { margin-top:8px; padding:10px 11px 8px; } .home .iran-market-grid { gap:8px; margin-top:9px; } .home .iran-market-divider { height:38px; } .home .iran-market-label { font-size:10px; } .home .iran-market-symbol { width:21px; height:21px; font-size:8px; } .home .iran-market-price-row { gap:4px; margin-top:3px; } .home .iran-market-value { font-size:12.5px; } .home .iran-market-change { font-size:7.5px; padding:2px 4px; } .home .iran-market-footer { margin-top:7px; padding-top:6px; font-size:7.5px; } }
      @media (max-width:380px) { .home .iran-market-label small { display:none; } .home .iran-market-value { font-size:11.5px; } }

      .live-metals-card { background: linear-gradient(145deg,#FFFFFF 0%,#F8F9FA 100%); border:1px solid rgba(169,128,58,0.22); border-radius:16px; padding:13px 14px 10px; margin-top:14px; box-shadow:0 5px 18px rgba(20,30,45,0.06); }\n      .live-metals-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }\n      .live-metals-title { font-size:13px; font-weight:800; color:#1E242B; }\n      .live-metals-subtitle { margin-top:2px; font-size:9.5px; color:#93A0AF; }\n      .live-metals-status { display:flex; align-items:center; gap:5px; padding:4px 8px; border-radius:999px; background:#F0F2F4; color:#8A94A2; font-size:9.5px; font-weight:700; white-space:nowrap; }\n      .live-metals-status.is-live { background:rgba(18,145,91,0.08); color:#0F7A4C; }\n      .live-metals-dot { width:6px; height:6px; border-radius:50%; background:#AAB2BC; }\n      .live-metals-status.is-live .live-metals-dot { background:#12915B; box-shadow:0 0 0 3px rgba(18,145,91,0.10); }\n      .live-metals-grid { display:grid; grid-template-columns:1fr 1px 1fr; align-items:center; gap:12px; margin-top:12px; }\n      .live-metal-divider { height:42px; background:rgba(30,40,50,0.08); }\n      .live-metal-item { min-width:0; }\n      .live-metal-label { display:flex; align-items:center; gap:6px; color:#667085; font-size:11px; font-weight:700; }\n      .live-metal-label small { margin-right:auto; font-family:'JetBrains Mono',monospace; direction:ltr; font-size:8px; color:#A0A8B3; font-weight:500; }\n      .metal-symbol { width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:700; }\n      .gold-metal .metal-symbol { background:rgba(169,128,58,0.12); color:#A9803A; border:1px solid rgba(169,128,58,0.28); }\n      .silver-metal .metal-symbol { background:rgba(102,112,133,0.10); color:#667085; border:1px solid rgba(102,112,133,0.18); }\n      .live-metal-price-row { display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-top:5px; }\n      .live-metal-value { font-family:'JetBrains Mono',monospace; direction:ltr; text-align:right; font-size:16px; font-weight:800; letter-spacing:-0.4px; color:#1E242B; }\n      .gold-metal .live-metal-value { color:#9A732F; }\n      .live-metal-change { direction:ltr; white-space:nowrap; font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:800; padding:3px 5px; border-radius:6px; }\n      .live-metal-change.is-up { color:#0F7A4C; background:rgba(18,145,91,0.08); }\n      .live-metal-change.is-down { color:#B54747; background:rgba(181,71,71,0.08); }\n      .live-metals-footer { display:flex; justify-content:space-between; gap:8px; margin-top:10px; padding-top:8px; border-top:1px solid rgba(30,40,50,0.06); color:#9AA3AE; font-size:8.5px; }\n      @media (max-width:380px) { .live-metal-label small { display:none; } .live-metals-footer { font-size:8px; } .live-metal-value { font-size:14px; } .live-metal-change { font-size:8px; } }\n\n      @media (max-width:480px) {\n        .home .market-banner { padding:7px 11px; margin-bottom:7px; font-size:11.5px; }\n        .home .update-row { padding-bottom:7px; font-size:10px; }\n        .home .section-head { padding:2px 2px 6px; }\n        .home .section-title { font-size:13px; }\n        .home .section-caption { font-size:10px; }\n        .home .purity-list { gap:7px; }\n        .home .purity-card { padding:9px 10px; border-radius:14px; }\n        .home .purity-card-head { gap:8px; margin-bottom:7px; }\n        .home .stamp-badge { width:34px; height:34px; font-size:8.5px; }\n        .home .purity-name { font-size:12px; }\n        .home .purity-chip { font-size:9.5px; }\n        .home .price-split { gap:7px; }\n        .home .price-half { gap:3px; padding:8px 5px; }\n        .home .half-label { font-size:9.5px; }\n        .home .half-price { font-size:13px; }\n        .home .half-unit { font-size:8px; }\n        .home .bars-head { margin-top:12px; }\n        .home .bars-row { gap:7px; }\n        .home .bar-card { gap:5px; padding:9px 7px; font-size:10.5px; }\n        .home .track-link { margin-top:10px; padding:9px; font-size:11px; }\n        .home .live-metals-card { margin-top:9px; padding:10px 11px 8px; }\n        .home .live-metals-grid { gap:8px; margin-top:9px; }\n        .home .live-metal-divider { height:34px; }\n        .home .live-metal-label { font-size:10px; }\n        .home .metal-symbol { width:21px; height:21px; font-size:8px; }\n        .home .live-metal-price-row { gap:5px; margin-top:3px; }\n        .home .live-metal-value { font-size:14px; }\n        .home .live-metal-change { font-size:8px; padding:2px 4px; }\n        .home .live-metals-footer { margin-top:7px; padding-top:6px; font-size:7.5px; }\n      }\n\n      @media (max-width:480px) and (max-height:740px) {\n        .home .market-banner { padding:6px 10px; margin-bottom:5px; }\n        .home .update-row { padding-bottom:5px; }\n        .home .purity-list { gap:5px; }\n        .home .purity-card { padding:7px 9px; }\n        .home .purity-card-head { margin-bottom:5px; }\n        .home .price-half { padding:7px 4px; }\n        .home .bars-head { margin-top:8px; }\n        .home .bar-card { padding:7px 6px; }\n        .home .track-link { margin-top:7px; padding:8px; }\n        .home .live-metals-card { margin-top:7px; padding:8px 10px 7px; }\n      }\n\n      @media (max-width:480px) {\n        .app-header { padding-top:4px !important; padding-bottom:4px !important; }\n        .app-header .logo { transform:scale(0.94); transform-origin:center; }\n      }\n\n      .home:not(:has(.live-metals-card)) {\n        min-height:100dvh;\n        box-sizing:border-box;\n        display:flex;\n        flex-direction:column;\n      }\n\n`;
      if (next.includes(styleMarker)) next = next.replace(styleMarker, styles + styleMarker);
      return { code: next, map: null };
    },
  };
}