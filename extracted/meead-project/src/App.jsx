import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Lock, Unlock, Copy, Check, CheckCircle2, X, ChevronRight,
  Search, Clock, Upload, Users, Settings as SettingsIcon, Database,
  AlertTriangle, TrendingUp, TrendingDown, Package, History, LayoutDashboard,
  ShieldAlert
} from "lucide-react";

/* ---------------------------- Config & helpers --------------------------- */

const PRODUCTS = [
  { key: "9999", title: "ساچمه نقره عیار ۹۹۹.۹", purityLabel: "999.9" },
  { key: "990", title: "ساچمه نقره عیار ۹۹۰", purityLabel: "990" },
];

const DEFAULT_SETTINGS = {
  products: {
    "9999": { buyPrice: 0, sellPrice: 0, minWeight: 1, maxWeight: 1000, buyActive: true, sellActive: true, priceHistory: [] },
    "990": { buyPrice: 0, sellPrice: 0, minWeight: 1, maxWeight: 1000, buyActive: true, sellActive: true, priceHistory: [] },
  },
  market: { closeStart: "00:00", closeEnd: "11:00", buyEnabled: true, sellEnabled: true, emergencyStop: false },
  priceLockMinutes: 5,
  sellValidityDays: 3,
  bank: { cardNumber: "", accountNumber: "", sheba: "", ownerName: "" },
  sellAddress: "",
  adminPassword: "meead1404",
  nextOrderSeq: 1058,
  lastPriceUpdate: null,
};
function mergeSettings(patch = {}) {
  const s = patch || {};

  return {
    ...DEFAULT_SETTINGS,
    ...s,
    products: {
      ...DEFAULT_SETTINGS.products,
      ...(s.products || {}),
    },
    market: {
      ...DEFAULT_SETTINGS.market,
      ...(s.market || {}),
    },
    bank: {
      ...DEFAULT_SETTINGS.bank,
      ...(s.bank || {}),
    },
  };
}
const BUY_STATUSES = ["در انتظار پرداخت", "در انتظار تأیید پرداخت", "پرداخت تأیید شد", "پرداخت رد شد", "تکمیل شد", "لغو شد"];
const SELL_STATUSES = ["درخواست جدید", "منتظر دریافت ساچمه", "ساچمه دریافت شد", "در حال بررسی", "وزن نهایی ثبت شد", "مبلغ نهایی تعیین شد", "پرداخت شد", "تکمیل شد", "لغو شد"];

const toman = (n) => (Math.round(Number(n)) || 0).toLocaleString("fa-IR") + " تومان";
const fmtTime = (d) => new Date(d).toLocaleString("fa-IR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
const fmtClock = (d) => new Date(d).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });

function minutesSinceMidnight(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Handles wrap-around windows (e.g. 22:00 -> 06:00) as well as same-day windows.
function isWithinClosedWindow(closeStart, closeEnd, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = minutesSinceMidnight(closeStart);
  const end = minutesSinceMidnight(closeEnd);
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

function genOrderCode(seq) {
  return `SP-${seq}`;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/* ============================================================================
   DATA / SERVICE LAYER — Supabase backend.
   ----------------------------------------------------------------------------
   UI components below this layer continue to call `api.*`; persistence,
   pricing, quotes, orders, admin actions and receipt uploads are handled by
   Supabase RPCs, Auth and the Edge Function.
   ============================================================================ */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Supabase environment variables are missing");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function mapProduct(row, history = []) {
  return {
    buyPrice: Number(row?.buy_price ?? 0), sellPrice: Number(row?.sell_price ?? 0),
    minWeight: Number(row?.min_weight ?? 0), maxWeight: Number(row?.max_weight ?? 0),
    buyActive: !!row?.buy_active, sellActive: !!row?.sell_active,
    priceHistory: history.map(h => ({ time: h.created_at, buyPrice: Number(h.buy_price), sellPrice: Number(h.sell_price) }))
  };
}

function mapOrder(row, histories = []) {
  if (!row) return null;
  const history = histories
    .filter(h => Number(h.order_id) === Number(row.id))
    .sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
    .map(h => ({ status: h.status, time: h.created_at }));
  return {
    id: row.order_number || `SP-${row.id}`,
    dbId: Number(row.id),
    type: row.type, purity: row.purity, weight: Number(row.weight),
    pricePerGram: Number(row.price_per_gram ?? 0), total: row.total == null ? null : Number(row.total),
    approxTotal: row.approx_total == null ? null : Number(row.approx_total),
    name: row.name, phone: row.phone, createdAt: row.created_at,
    lockExpiresAt: row.lock_expires_at, sellValidUntil: row.sell_valid_until,
    bankSnapshot: row.bank_snapshot || { cardNumber:"", accountNumber:"", sheba:"", ownerName:"" },
    receiptPath: row.receipt_url || null,
    receiptImage: null,
    status: row.status, adminNote: row.admin_note || "",
    finalWeight: row.final_weight == null ? null : Number(row.final_weight),
    finalPricePerGram: row.final_price_per_gram == null ? null : Number(row.final_price_per_gram),
    finalTotal: row.final_total == null ? null : Number(row.final_total),
    history
  };
}

function mapSettings(publicData) {
  const products = publicData?.products || [];
  const market = publicData?.market || {};
  const system = publicData?.system || {};
  return mergeSettings({
    products: Object.fromEntries(PRODUCTS.map(p => [p.key, mapProduct(products.find(x => x.key === p.key) || {}, [])])),
    market: {
      closeStart: market.closeStart ?? "00:00", closeEnd: market.closeEnd ?? "11:00",
      buyEnabled: market.buyEnabled ?? true, sellEnabled: market.sellEnabled ?? true,
      emergencyStop: market.emergencyStop ?? false
    },
    priceLockMinutes: Number(system.priceLockMinutes ?? 5),
    sellValidityDays: Number(system.sellValidityDays ?? 3),
    lastPriceUpdate: system.lastPriceUpdate ?? null
  });
}

async function publicSettings() {
  const { data, error } = await supabase.rpc("get_public_settings");
  if (error) throw error;
  return data?.ok === false ? null : data;
}

async function adminState() {
  const [pub, productsRes, historiesRes, marketRes, systemRes, ordersRes, orderHistoriesRes, logRes] = await Promise.all([
    publicSettings(),
    supabase.from("products").select("*").order("key"),
    supabase.from("price_history").select("*").order("created_at", { ascending: false }),
    supabase.from("market_settings").select("*").order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("system_settings").select("*").order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("orders").select("*").order("created_at", { ascending: false }),
    supabase.from("order_history").select("*").order("created_at", { ascending: true }),
    supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(300)
  ]);
  for (const r of [productsRes,historiesRes,marketRes,systemRes,ordersRes,orderHistoriesRes,logRes]) if (r.error) throw r.error;
  const products = productsRes.data || [];
  const ph = historiesRes.data || [];
  const m = marketRes.data || {};
  const sys = systemRes.data || {};
  const settings = mergeSettings({
    products: Object.fromEntries(PRODUCTS.map(p => [p.key, mapProduct(products.find(x => x.key === p.key) || {}, ph.filter(h => h.product_key === p.key))])),
    market: { closeStart:m.close_start ?? "00:00", closeEnd:m.close_end ?? "11:00", buyEnabled:m.buy_enabled ?? true, sellEnabled:m.sell_enabled ?? true, emergencyStop:m.emergency_stop ?? false },
    priceLockMinutes: Number(sys.price_lock_minutes ?? 5), sellValidityDays: Number(sys.sell_validity_days ?? 3),
    bank: { cardNumber:sys.bank_card_number || "", accountNumber:sys.bank_account_number || "", sheba:sys.bank_sheba || "", ownerName:sys.bank_owner_name || "" },
    sellAddress: sys.sell_address || "", lastPriceUpdate: sys.last_price_update || null, nextOrderSeq: Number(sys.next_order_seq ?? 1058)
  });
  const orders = (ordersRes.data || []).map(r => mapOrder(r, orderHistoriesRes.data || []));
  const log = (logRes.data || []).map(x => ({ time:x.created_at, action:x.action, detail:x.detail }));
  return { settings, orders, log };
}

const api = {
  async getState() {
    const data = await publicSettings();
    return { settings: mapSettings(data), orders: [], log: [] };
  },
  async getAdminState() { return adminState(); },
  isMarketOpen(settings, mode) {
    const closed = isWithinClosedWindow(settings.market.closeStart, settings.market.closeEnd);
    const enabled = mode === "buy" ? settings.market.buyEnabled : settings.market.sellEnabled;
    return enabled && !closed && !settings.market.emergencyStop;
  },
  async createQuote(purityKey, mode) {
    const { data, error } = await supabase.rpc("create_quote", { p_purity_key: purityKey, p_mode: mode });
    if (error) return { ok:false, reason:error.message || "خطا در دریافت قیمت" };
    if (!data?.ok) return data || { ok:false, reason:"دریافت قیمت ناموفق بود" };
    return data;
  },
  async submitOrder(quote, weight, customer) {
    const { data, error } = await supabase.rpc("submit_order", { p_quote: quote, p_weight:Number(weight), p_name:customer.name, p_phone:customer.phone });
    if (error) return { ok:false, reason:error.message || "ثبت سفارش ناموفق بود" };
    if (!data?.ok) return data || {ok:false, reason:"ثبت سفارش ناموفق بود"};
    const row = data.order || data;
    const order = mapOrder(row, []);
    const pub = await publicSettings().catch(()=>null);
    return { ok:true, order, orders:[], settings:mapSettings(pub || {}) };
  },
  async attachReceipt(order, file) {
    try {
      const fd = new FormData();
      fd.append("orderNumber", order.id);
      fd.append("phone", order.phone);
      fd.append("file", file);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-receipt`, {
        method:"POST", headers:{ apikey:SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${SUPABASE_PUBLISHABLE_KEY}` }, body:fd
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || data.ok === false) return {ok:false, reason:data.reason || "آپلود رسید ناموفق بود"};
      const found = await this.findOrder(order.id, order.phone);
      return {ok:true, order:found, orders:[]};
    } catch(e) { return {ok:false, reason:"آپلود رسید ناموفق بود"}; }
  },
  async findOrder(code, phone) {
    const { data, error } = await supabase.rpc("find_order", { p_order_number:code.trim(), p_phone:phone.trim() });
    if (error || !data?.ok || !data?.order) return null;
    const o = data.order;
    return {
      id:o.order_number || code.trim(), dbId:Number(o.id), type:o.type, purity:o.purity, weight:Number(o.weight),
      pricePerGram:Number(o.price_per_gram ?? 0), total:o.total == null ? null : Number(o.total), approxTotal:o.approx_total == null ? null : Number(o.approx_total),
      name:o.name, phone:o.phone, createdAt:o.created_at, lockExpiresAt:o.lock_expires_at, sellValidUntil:o.sell_valid_until,
      bankSnapshot:o.bank_snapshot || {}, receiptPath:o.receipt_url || null, receiptImage:null, status:o.status, adminNote:o.admin_note || "",
      finalWeight:o.final_weight == null ? null : Number(o.final_weight), finalPricePerGram:o.final_price_per_gram == null ? null : Number(o.final_price_per_gram), finalTotal:o.final_total == null ? null : Number(o.final_total),
      history:(o.history || []).map(h=>({status:h.status,time:h.created_at || h.time}))
    };
  },
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email:email.trim(), password });
    if (error || !data.session) return {ok:false, reason:error?.message || "ورود ناموفق بود"};
    const { data:admin, error:ae } = await supabase.rpc("is_admin");
    if (ae || admin !== true) { await supabase.auth.signOut(); return {ok:false, reason:"این حساب دسترسی مدیریت ندارد"}; }
    return {ok:true};
  },
  async logout() { await supabase.auth.signOut(); },
  async updatePrices(productsForm) {
    const pricePayload = Object.fromEntries(Object.entries(productsForm).map(([key,v])=>[key,{buyPrice:Number(v.buyPrice),sellPrice:Number(v.sellPrice)}]));
    const limitPayload = Object.fromEntries(Object.entries(productsForm).map(([key,v])=>[key,{minWeight:Number(v.minWeight),maxWeight:Number(v.maxWeight)}]));
    let r = await supabase.rpc("update_prices", {p_products:pricePayload});
    if (r.error) throw r.error;
    r = await supabase.rpc("update_product_limits", {p_products:limitPayload});
    if (r.error) throw r.error;
    return (await adminState()).settings;
  },
  async updateMarket(marketPatch) {
    const {error}=await supabase.rpc("update_market_settings", {p_close_start:marketPatch.closeStart,p_close_end:marketPatch.closeEnd,p_buy_enabled:!!marketPatch.buyEnabled,p_sell_enabled:!!marketPatch.sellEnabled,p_emergency_stop:!!marketPatch.emergencyStop});
    if(error) throw error; return (await adminState()).settings;
  },
  async setEmergencyStop(flag) {
    const s=(await adminState()).settings.market;
    const {error}=await supabase.rpc("update_market_settings", {p_close_start:s.closeStart,p_close_end:s.closeEnd,p_buy_enabled:s.buyEnabled,p_sell_enabled:s.sellEnabled,p_emergency_stop:!!flag});
    if(error) throw error; return (await adminState()).settings;
  },
  async updateSystemSettings(patch) {
    const b=patch.bank || {};
    const {error}=await supabase.rpc("update_system_settings", {p_price_lock_minutes:Number(patch.priceLockMinutes),p_sell_validity_days:Number(patch.sellValidityDays),p_sell_address:patch.sellAddress || "",p_bank_card_number:b.cardNumber || "",p_bank_account_number:b.accountNumber || "",p_bank_sheba:b.sheba || "",p_bank_owner_name:b.ownerName || ""});
    if(error) throw error; return (await adminState()).settings;
  },
  async resolveOrderId(orderOrId) {
    if (orderOrId && typeof orderOrId === "object" && orderOrId.dbId) return Number(orderOrId.dbId);
    const st = await adminState();
    const found = st.orders.find(o => String(o.id) === String(orderOrId));
    if (!found) throw new Error("سفارش پیدا نشد");
    return Number(found.dbId);
  },
  async updateOrderStatus(order, status) {
    const dbId = await this.resolveOrderId(order);
    const {data,error}=await supabase.rpc("update_order_status", {p_order_id:dbId,p_status:status});
    if(error || !data?.ok) throw error || new Error(data?.reason || "خطا"); return (await adminState()).orders;
  },
  async recordFinalWeight(order, finalWeight) {
    const dbId = await this.resolveOrderId(order);
    const {data,error}=await supabase.rpc("record_final_weight", {p_order_id:dbId,p_final_weight:Number(finalWeight)});
    if(error || !data?.ok) throw error || new Error(data?.reason || "خطا"); return (await adminState()).orders;
  },
  async finalizeSellAmount(order, price) {
    const dbId = await this.resolveOrderId(order);
    const {data,error}=await supabase.rpc("finalize_sell_amount", {p_order_id:dbId,p_final_price_per_gram:Number(price)});
    if(error || !data?.ok) throw error || new Error(data?.reason || "خطا"); return (await adminState()).orders;
  },
  async setOrderNote(order, note) {
    const dbId = await this.resolveOrderId(order);
    const {error}=await supabase.from("orders").update({admin_note:note}).eq("id",dbId);
    if(error) throw error; return (await adminState()).orders;
  },
  async exportBackup() {
    return {...await adminState(), exportedAt:new Date().toISOString()};
  },
  async restoreBackup(data) {
    if (!data?.settings || !data?.orders) throw new Error("نسخه پشتیبان نامعتبر است");
    throw new Error("بازیابی مستقیم نسخه قدیمی در نسخه سروری غیرفعال است؛ برای جلوگیری از خراب شدن دیتابیس باید مهاجرت کنترل‌شده انجام شود.");
  },
};

/* --------------------------------- Icons --------------------------------- */

function TrendArrow({ up, size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ transform: up ? "none" : "scaleY(-1)" }}>
      <path d="M4 17L10 11L14 15L20 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 7H20V13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BrandMark({ size = 60 }) {
  return (
    <svg width={size} height={size * 0.95} viewBox="0 0 100 96" fill="none" aria-label="MEEAD ACCESSORIES">
      <defs>
        <linearGradient id="ma-gold" x1="0" y1="0" x2="100" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F3E2B0" />
          <stop offset="0.5" stopColor="#D8B76A" />
          <stop offset="1" stopColor="#9C7A34" />
        </linearGradient>
      </defs>
      <path d="M50 4 L68 22 L50 33 L32 22 Z" fill="url(#ma-gold)" />
      <path d="M32 22 L50 33 L43 47 Z" fill="url(#ma-gold)" opacity="0.85" />
      <path d="M68 22 L50 33 L57 47 Z" fill="url(#ma-gold)" opacity="0.85" />
      <text x="50" y="76" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontWeight="700" fontSize="30" fill="url(#ma-gold)" letterSpacing="-1">MA</text>
      <line x1="16" y1="86" x2="84" y2="86" stroke="url(#ma-gold)" strokeWidth="1.4" />
    </svg>
  );
}

function BarIcon({ tone }) {
  const isGold = tone === "gold";
  const id = isGold ? "bar-gold" : "bar-silver";
  return (
    <svg width={38} height={30} viewBox="0 0 60 46" fill="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="60" y2="46" gradientUnits="userSpaceOnUse">
          {isGold ? (
            <>
              <stop offset="0" stopColor="#F5E3AE" />
              <stop offset="0.5" stopColor="#D8B76A" />
              <stop offset="1" stopColor="#9C7A34" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#EEF1F3" />
              <stop offset="0.5" stopColor="#C3CAD1" />
              <stop offset="1" stopColor="#8A939D" />
            </>
          )}
        </linearGradient>
      </defs>
      <path d="M10 36 L4 14 H50 L56 36 Z" fill={`url(#${id})`} stroke={isGold ? "#9C7A34" : "#8A939D"} strokeWidth="1" />
      <path d="M4 14 H50 L44 8 H10 Z" fill={`url(#${id})`} opacity="0.7" />
      <path d="M50 14 L56 36 L60 30 L54 10 Z" fill={`url(#${id})`} opacity="0.55" />
    </svg>
  );
}

/* ---------------------------------- App ----------------------------------- */

export default function App() {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [orders, setOrders] = useState([]);
  const [log, setLog] = useState([]);
  const [view, setView] = useState("home");
  const [quote, setQuote] = useState(null); // {purityKey, mode, pricePerGram, expiresAt}
  const [weight, setWeight] = useState("");
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [lastOrder, setLastOrder] = useState(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPw, setAdminPw] = useState("");
  const [adminError, setAdminError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const state = await api.getState();
    setSettings(state.settings);
    if (isAdmin) {
      const admin = await api.getAdminState();
      setSettings(admin.settings); setOrders(admin.orders); setLog(admin.log);
    } else { setOrders([]); setLog([]); }
  }, [isAdmin]);

  const retryLoad = useCallback(async () => {
    setLoadError("");
    setReady(false);
    try {
      await load();
      setReady(true);
    } catch (error) {
      console.error("Initial app load failed:", error);
      setLoadError("ارتباط با سرور برقرار نشد. لطفاً اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.");
      setReady(true);
    }
  }, [load]);

  useEffect(() => {
    retryLoad();
  }, [retryLoad]);

  // Lightweight polling to approximate live price/order updates without a real backend push.
  // Swap this for a websocket/SSE subscription once a real backend exists.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        await load();
        if (loadError) setLoadError("");
      } catch (error) {
        console.error("Background refresh failed:", error);
      }
    }, 20000);
    return () => clearInterval(t);
  }, [load, loadError]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const closedByHours = isWithinClosedWindow(settings.market.closeStart, settings.market.closeEnd, new Date(now));
  const marketBuyOpen = api.isMarketOpen(settings, "buy");
  const marketSellOpen = api.isMarketOpen(settings, "sell");

  const startQuote = async (purityKey, mode) => {
    const res = await api.createQuote(purityKey, mode);
    if (!res.ok) return setToast(res.reason);
    setQuote(res.quote);
    setWeight("");
    setCustomer({ name: "", phone: "" });
    setView("order");
  };

  const refreshQuote = async () => {
    if (!quote) return;
    const res = await api.createQuote(quote.purityKey, quote.mode);
    if (!res.ok) return setToast(res.reason);
    setQuote(res.quote);
  };

  const quoteExpired = quote ? now >= quote.expiresAt : false;
  const total = quote ? Math.round((Number(weight) || 0) * quote.pricePerGram) : 0;
  const product = quote ? settings.products[quote.purityKey] : null;
  const productTitle = quote ? PRODUCTS.find((p) => p.key === quote.purityKey)?.title : "";
  const weightOutOfRange = quote && product && weight && (Number(weight) < product.minWeight || Number(weight) > product.maxWeight);
  const canContinue = quote && !quoteExpired && !weightOutOfRange && Number(weight) > 0 && customer.name.trim() && customer.phone.trim();

  const goToSummary = () => { if (canContinue) setView("order-summary"); };

  const submitOrder = async () => {
    const res = await api.submitOrder(quote, weight, customer);
    if (!res.ok) return setToast(res.reason);
    setLastOrder(res.order);
    const pub = await api.getState();
    setSettings(pub.settings);
    setView(res.order.type === "buy" ? "buy-payment" : "sell-submitted");
  };

  const attachReceipt = async (order, file) => {
    const res = await api.attachReceipt(order, file);
    if (!res.ok) return setToast(res.reason);
    setLastOrder(res.order);
    setToast("رسید ارسال شد");
  };

  const tryAdminLogin = async () => {
    const res = await api.login(adminEmail, adminPw);
    if (res.ok) { setAdminError(""); setAdminPw(""); setIsAdmin(true); setView("admin"); const st=await api.getAdminState(); setSettings(st.settings); setOrders(st.orders); setLog(st.log); }
    else setAdminError(res.reason || "ورود ناموفق بود");
  };

  if (!ready) {
    return (
      <div className="app-root" dir="rtl">
        <GlobalStyles />
        <div className="loading-screen">در حال بارگذاری…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-root" dir="rtl">
        <GlobalStyles />
        <div className="loading-screen">
          <div>{loadError}</div>
          <button onClick={retryLoad} style={{ marginTop: 16, padding: "10px 18px", cursor: "pointer" }}>تلاش دوباره</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-root" dir="rtl">
      <GlobalStyles />

      <header className="app-header">
        <span className="header-spacer" />
        <div className="brand">
          <BrandMark size={54} />
          <div className="brand-text">
            <span className="brand-name">MEEAD ACCESSORIES</span>
            <span className="brand-sub">معاملات فلزات گران‌بها</span>
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={async () => { if (isAdmin) { await api.logout(); setIsAdmin(false); setOrders([]); setLog([]); setView("home"); } else setView("admin-login"); }}
          aria-label="پنل مدیریت"
        >
          <Lock size={16} />
        </button>
      </header>

      <main className="app-main">
        {view === "home" && (
          <Home
            settings={settings} orders={orders}
            closedByHours={closedByHours} marketBuyOpen={marketBuyOpen} marketSellOpen={marketSellOpen}
            startQuote={startQuote} setView={setView}
          />
        )}

        {view === "track" && <TrackOrder onAttachReceipt={attachReceipt} onBack={() => setView("home")} />}

        {view === "order" && quote && (
          <OrderForm
            quote={quote} product={product} productTitle={productTitle}
            weight={weight} setWeight={setWeight}
            customer={customer} setCustomer={setCustomer}
            total={total} now={now} expired={quoteExpired}
            onRefresh={refreshQuote} onBack={() => setView("home")}
            onContinue={goToSummary} canContinue={canContinue}
            sellValidityDays={settings.sellValidityDays}
          />
        )}

        {view === "order-summary" && quote && (
          <OrderSummary
            quote={quote} product={product} productTitle={productTitle}
            weight={weight} customer={customer} total={total} now={now} expired={quoteExpired}
            onRefresh={refreshQuote} onEdit={() => setView("order")} onConfirm={submitOrder}
            sellValidityDays={settings.sellValidityDays}
          />
        )}

        {view === "buy-payment" && lastOrder && (
          <BuyPayment order={lastOrder} onAttachReceipt={(f) => attachReceipt(lastOrder, f)} onDone={() => setView("home")} setToast={setToast} />
        )}

        {view === "sell-submitted" && lastOrder && (
          <SellSubmitted order={lastOrder} sellAddress={settings.sellAddress} onDone={() => setView("home")} />
        )}

        {view === "admin-login" && (
          <AdminLogin email={adminEmail} setEmail={setAdminEmail} pw={adminPw} setPw={setAdminPw} error={adminError} onSubmit={tryAdminLogin} onCancel={() => setView("home")} />
        )}

        {view === "admin" && isAdmin && (
          <Admin
            settings={settings} setSettings={setSettings}
            orders={orders} setOrders={setOrders}
            log={log}
            onExit={() => { setIsAdmin(false); setView("home"); }}
            setToast={setToast}
          />
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ---------------------------------- Home ---------------------------------- */

function MarketBanner({ closedByHours, market }) {
  if (market.emergencyStop) {
    return (
      <div className="market-banner banner-danger">
        <ShieldAlert size={16} />
        <span>معاملات به‌طور موقت متوقف شده است</span>
      </div>
    );
  }
  if (closedByHours) {
    return (
      <div className="market-banner banner-closed">
        <Lock size={15} />
        <span>بازار در حال حاضر بسته است — ساعت فعالیت: {market.closeEnd} تا {market.closeStart}</span>
      </div>
    );
  }
  return (
    <div className="market-banner banner-open">
      <Unlock size={15} />
      <span>بازار باز است</span>
    </div>
  );
}

function PriceHalf({ side, price, active, onClick, disabledReason }) {
  const isBuy = side === "buy";
  const hasPrice = price > 0;
  const enabled = active && hasPrice;
  return (
    <button className={`price-half ${isBuy ? "half-buy" : "half-sell"} ${!enabled ? "half-off" : ""}`} onClick={onClick}>
      <span className="half-label"><TrendArrow up={isBuy} />{isBuy ? "خرید از فروشگاه" : "فروش به فروشگاه"}</span>
      <span className="half-price mono">{hasPrice ? toman(price) : "—"}</span>
      <span className="half-unit">{!active ? (disabledReason || "غیرفعال") : hasPrice ? "به ازای هر گرم" : "تماس با فروشگاه"}</span>
    </button>
  );
}

function Home({ settings, orders, closedByHours, marketBuyOpen, marketSellOpen, startQuote, setView }) {
  return (
    <div className="home">
      <MarketBanner closedByHours={closedByHours} market={settings.market} />

      <div className="update-row">
        <span>آخرین به‌روزرسانی قیمت</span>
        <span className="mono">{settings.lastPriceUpdate ? fmtClock(settings.lastPriceUpdate) : "—"}</span>
      </div>

      <div className="section-head">
        <span className="section-title">ساچمه نقره</span>
        <span className="section-caption">قیمت به ازای هر گرم</span>
      </div>

      <div className="purity-list">
        {PRODUCTS.map((p) => {
          const cfg = settings.products[p.key];
          return (
            <div className="purity-card" key={p.key}>
              <div className="purity-card-head">
                <div className="stamp-badge">
                  <span>{p.purityLabel}</span>
                </div>
                <div className="purity-card-body">
                  <span className="purity-name">{p.title}</span>
                  <span className="purity-chip">عیار {p.purityLabel} · وزن {cfg.minWeight} تا {cfg.maxWeight} گرم</span>
                </div>
              </div>
              <div className="price-split">
                <PriceHalf
                  side="buy" price={cfg.buyPrice} active={marketBuyOpen && cfg.buyActive}
                  disabledReason={!cfg.buyActive ? "غیرفعال" : "بسته"}
                  onClick={() => startQuote(p.key, "buy")}
                />
                <PriceHalf
                  side="sell" price={cfg.sellPrice} active={marketSellOpen && cfg.sellActive}
                  disabledReason={!cfg.sellActive ? "غیرفعال" : "بسته"}
                  onClick={() => startQuote(p.key, "sell")}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-head bars-head">
        <span className="section-title">شمش نقره و طلا</span>
        <span className="soon-ribbon">به‌زودی</span>
      </div>
      <div className="bars-row">
        <div className="bar-card"><BarIcon tone="silver" /><span>شمش نقره</span></div>
        <div className="bar-card"><BarIcon tone="gold" /><span>شمش طلا</span></div>
      </div>

      <button className="track-link" onClick={() => setView("track")}>
        <Search size={14} /> پیگیری سفارش با کد رهگیری
      </button>
    </div>
  );
}

/* ------------------------------- Track order ------------------------------ */

function TrackOrder({ onAttachReceipt, onBack }) {
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState(null);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    const found = await api.findOrder(code, phone);
    setResult(found);
    setSearched(true);
  };

  return (
    <div className="panel">
      <button className="back-link" onClick={onBack}><ChevronRight size={16} /> بازگشت</button>
      <h2 className="panel-title">پیگیری سفارش</h2>
      <label className="field"><span>کد رهگیری</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SP-1058" /></label>
      <label className="field"><span>شماره تماس</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xxxxxxxxx" /></label>
      <button className="primary-btn" onClick={search}>جستجو</button>

      {searched && !result && <p className="pay-note">سفارشی با این مشخصات پیدا نشد.</p>}

      {result && (
        <div className="confirm-summary" style={{ marginTop: 10 }}>
          <div className="calc-row"><span>وضعیت</span><span className="status-pill">{result.status}</span></div>
          <div className="calc-row"><span>محصول</span><span>{PRODUCTS.find((p) => p.key === result.purity)?.title}</span></div>
          <div className="calc-row"><span>وزن</span><span className="mono">{result.weight} گرم</span></div>
          <div className="calc-row total"><span>مبلغ</span><span className="mono">{toman(result.total ?? result.approxTotal)}</span></div>
          <div className="timeline">
            {result.history.map((h, i) => (
              <div className="timeline-row" key={i}><span className="mono">{fmtTime(h.time)}</span><span>{h.status}</span></div>
            ))}
          </div>
          {result.type === "buy" && result.status === "در انتظار پرداخت" && (
            <label className="upload-btn" style={{ marginTop: 10 }}>
              <Upload size={14} /> آپلود رسید پرداخت
              <input type="file" accept="image/*,.pdf" hidden onChange={(e) => e.target.files[0] && onAttachReceipt(result, e.target.files[0])} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Order form ------------------------------- */

function Countdown({ expiresAt, now }) {
  const remain = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mm = String(Math.floor(remain / 60)).padStart(2, "0");
  const ss = String(remain % 60).padStart(2, "0");
  return (
    <div className={`countdown ${remain <= 30 ? "countdown-warn" : ""}`}>
      <Clock size={13} /> اعتبار قیمت: <span className="mono">{mm}:{ss}</span>
    </div>
  );
}

function OrderForm({ quote, product, productTitle, weight, setWeight, customer, setCustomer, total, now, expired, onRefresh, onBack, onContinue, canContinue, sellValidityDays }) {
  const outOfRange = weight && product && (Number(weight) < product.minWeight || Number(weight) > product.maxWeight);
  return (
    <div className="panel">
      <button className="back-link" onClick={onBack}><ChevronRight size={16} /> بازگشت</button>
      <h2 className="panel-title">{productTitle}</h2>
      <span className={`panel-sub ${quote.mode === "buy" ? "tone-buy" : "tone-sell"}`}>
        {quote.mode === "buy" ? "خرید از فروشگاه" : "فروش به فروشگاه"}
      </span>

      {expired ? (
        <div className="expired-box">
          <span>زمان اعتبار این قیمت به پایان رسید.</span>
          <button className="ghost-btn" onClick={onRefresh}>دریافت قیمت جدید</button>
        </div>
      ) : (
        <Countdown expiresAt={quote.expiresAt} now={now} />
      )}

      <label className="field">
        <span>وزن (گرم) — بین {product?.minWeight} تا {product?.maxWeight} گرم</span>
        <input type="number" inputMode="decimal" min={product?.minWeight} max={product?.maxWeight} step="0.01"
          value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="مثلاً 50" disabled={expired} />
      </label>
      {outOfRange && <span className="error-text">وزن باید بین {product.minWeight} تا {product.maxWeight} گرم باشد</span>}

      <div className="calc-row"><span>قیمت هر گرم</span><span className="mono">{toman(quote.pricePerGram)}</span></div>
      <div className="calc-row total">
        <span>{quote.mode === "buy" ? "مبلغ قابل پرداخت" : "مبلغ تقریبی قابل دریافت"}</span>
        <span className="mono">{toman(total)}</span>
      </div>

      {quote.mode === "sell" && (
        <div className="sell-warning">
          ⚠️ توجه: قیمت تعیین‌شده برای فروش حداکثر تا {sellValidityDays} روز معتبر است. لطفاً ساچمه را در این مدت به دست ما برسانید. پس از پایان این مدت، قیمت بر اساس شرایط و قیمت روز محاسبه خواهد شد.
        </div>
      )}

      <div className="field-pair">
        <label className="field"><span>نام و نام خانوادگی</span>
          <input type="text" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="نام شما" disabled={expired} />
        </label>
        <label className="field"><span>شماره تماس</span>
          <input type="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="09xxxxxxxxx" disabled={expired} />
        </label>
      </div>

      <button className="primary-btn" onClick={onContinue} disabled={!canContinue}>ادامه و مشاهده خلاصه سفارش</button>
    </div>
  );
}

function OrderSummary({ quote, product, productTitle, weight, customer, total, now, expired, onRefresh, onEdit, onConfirm, sellValidityDays }) {
  return (
    <div className="panel">
      <button className="back-link" onClick={onEdit}><ChevronRight size={16} /> ویرایش سفارش</button>
      <h2 className="panel-title">خلاصه سفارش</h2>
      <span className={`panel-sub ${quote.mode === "buy" ? "tone-buy" : "tone-sell"}`}>
        {quote.mode === "buy" ? "خرید از فروشگاه" : "فروش به فروشگاه"}
      </span>

      {expired ? (
        <div className="expired-box">
          <span>زمان اعتبار این قیمت به پایان رسید.</span>
          <button className="ghost-btn" onClick={onRefresh}>دریافت قیمت جدید</button>
        </div>
      ) : (
        <Countdown expiresAt={quote.expiresAt} now={now} />
      )}

      <div className="confirm-summary">
        <div className="calc-row"><span>محصول</span><span>{productTitle}</span></div>
        <div className="calc-row"><span>عیار</span><span className="mono">{product ? PRODUCTS.find((p) => p.key === quote.purityKey)?.purityLabel : ""}</span></div>
        <div className="calc-row"><span>وزن</span><span className="mono">{weight} گرم</span></div>
        <div className="calc-row"><span>قیمت هر گرم</span><span className="mono">{toman(quote.pricePerGram)}</span></div>
        <div className="calc-row total">
          <span>{quote.mode === "buy" ? "مبلغ قابل پرداخت" : "مبلغ تقریبی قابل دریافت"}</span>
          <span className="mono">{toman(total)}</span>
        </div>
        <div className="calc-row"><span>زمان درخواست</span><span className="mono">{fmtClock(now)}</span></div>
        <div className="calc-row"><span>اعتبار قیمت تا</span><span className="mono">{fmtClock(quote.expiresAt)}</span></div>
        <div className="calc-row"><span>نام</span><span>{customer.name}</span></div>
        <div className="calc-row"><span>شماره تماس</span><span className="mono">{customer.phone}</span></div>
      </div>

      {quote.mode === "sell" && (
        <div className="sell-warning">
          ⚠️ توجه: قیمت تعیین‌شده برای فروش حداکثر تا {sellValidityDays} روز معتبر است. لطفاً ساچمه را در این مدت به دست ما برسانید. پس از پایان این مدت، قیمت بر اساس شرایط و قیمت روز محاسبه خواهد شد.
        </div>
      )}

      <button className="primary-btn" onClick={onConfirm} disabled={expired}>تأیید و ثبت نهایی سفارش</button>
    </div>
  );
}

/* ------------------------------- Buy payment ------------------------------- */

function BuyPayment({ order, onAttachReceipt, onDone, setToast }) {
  const [copied, setCopied] = useState(false);
  const bank = order.bankSnapshot || {};

  const copy = async (val) => {
    try { await navigator.clipboard.writeText(val); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch (e) { setToast("کپی خودکار ممکن نشد"); }
  };

  return (
    <div className="panel confirm">
      <div className="confirm-icon"><CheckCircle2 size={38} /></div>
      <h2 className="panel-title">سفارش ثبت شد</h2>
      <span className="order-code mono">کد پیگیری: {order.id}</span>

      <div className="confirm-summary">
        <div className="calc-row"><span>محصول</span><span>{PRODUCTS.find((p) => p.key === order.purity)?.title}</span></div>
        <div className="calc-row"><span>وزن</span><span className="mono">{order.weight} گرم</span></div>
        <div className="calc-row total"><span>مبلغ قابل پرداخت</span><span className="mono">{toman(order.total)}</span></div>
      </div>

      <div className="pay-box">
        <span className="pay-label">اطلاعات واریز:</span>
        {bank.cardNumber && (
          <div className="card-number-row">
            <span className="mono card-number">{bank.cardNumber}</span>
            <button className="icon-btn" onClick={() => copy(bank.cardNumber)}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
          </div>
        )}
        {bank.sheba && <div className="address-box mono">IR{bank.sheba}</div>}
        {bank.ownerName && <span className="pay-label">به نام: {bank.ownerName}</span>}
        {!bank.cardNumber && !bank.sheba && <p className="pay-note">اطلاعات پرداخت هنوز ثبت نشده — با فروشگاه تماس بگیرید.</p>}

        <p className="pay-note">پس از واریز، تصویر رسید را آپلود کنید تا سفارش شما بررسی شود.</p>
        <label className="upload-btn">
          <Upload size={14} /> آپلود رسید پرداخت
          <input type="file" accept="image/*,.pdf" hidden onChange={(e) => e.target.files[0] && onAttachReceipt(e.target.files[0])} />
        </label>
        {order.receiptImage && <span className="pay-note">✅ رسید ارسال شد — وضعیت: {order.status}</span>}
      </div>

      <button className="primary-btn" onClick={onDone}>بازگشت به صفحه اصلی</button>
    </div>
  );
}

/* ------------------------------ Sell submitted ----------------------------- */

function SellSubmitted({ order, sellAddress, onDone }) {
  return (
    <div className="panel confirm">
      <div className="confirm-icon"><CheckCircle2 size={38} /></div>
      <h2 className="panel-title">درخواست فروش ثبت شد</h2>
      <span className="order-code mono">کد پیگیری: {order.id}</span>

      <div className="confirm-summary">
        <div className="calc-row"><span>محصول</span><span>{PRODUCTS.find((p) => p.key === order.purity)?.title}</span></div>
        <div className="calc-row"><span>وزن اعلامی</span><span className="mono">{order.weight} گرم</span></div>
        <div className="calc-row total"><span>مبلغ تقریبی</span><span className="mono">{toman(order.approxTotal)}</span></div>
      </div>

      <div className="sell-warning">
        ⚠️ این مبلغ تا زمان دریافت و بررسی ساچمه، قطعی نیست. اعتبار قیمت تا {fmtTime(order.sellValidUntil)} است.
      </div>

      <div className="pay-box">
        <span className="pay-label">مرحله بعدی:</span>
        <p className="pay-note">ساچمه خود را بسته‌بندی کرده و طبق آدرس زیر ارسال کنید. پس از دریافت و بررسی وزن، مبلغ نهایی به شما اعلام و واریز می‌شود.</p>
        {sellAddress ? <div className="address-box">{sellAddress}</div> : <p className="pay-note">آدرس ارسال هنوز ثبت نشده — با فروشگاه تماس بگیرید.</p>}
      </div>

      <button className="primary-btn" onClick={onDone}>بازگشت به صفحه اصلی</button>
    </div>
  );
}

/* --------------------------------- Admin ----------------------------------- */

function AdminLogin({ email, setEmail, pw, setPw, error, onSubmit, onCancel }) {
  return (
    <div className="panel admin-login">
      <Lock size={26} />
      <h2 className="panel-title">ورود به پنل مدیریت</h2>
      <label className="field"><span>ایمیل مدیر</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} placeholder="admin@example.com" />
      </label>
      <label className="field"><span>رمز عبور</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} />
      </label>
      {error && <span className="error-text">{error}</span>}
      <div className="btn-row">
        <button className="primary-btn" onClick={onSubmit}>ورود</button>
        <button className="ghost-btn" onClick={onCancel}>انصراف</button>
      </div>
    </div>
  );
}

const TABS = [
  { key: "dashboard", label: "داشبورد", icon: LayoutDashboard },
  { key: "prices", label: "قیمت‌ها", icon: TrendingUp },
  { key: "orders", label: "سفارش‌ها", icon: Package },
  { key: "customers", label: "مشتریان", icon: Users },
  { key: "market", label: "بازار", icon: Clock },
  { key: "settings", label: "تنظیمات", icon: SettingsIcon },
  { key: "log", label: "لاگ", icon: History },
  { key: "backup", label: "پشتیبان", icon: Database },
];

function Admin({ settings, setSettings, orders, setOrders, log, onExit, setToast }) {
  const [tab, setTab] = useState("dashboard");

  return (
    <div className="panel admin">
      <div className="admin-header">
        <div className="admin-header-title"><SettingsIcon size={18} /><h2 className="panel-title">پنل مدیریت</h2></div>
        <button className="icon-btn" onClick={onExit}><X size={16} /></button>
      </div>

      <div className="admin-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "admin-tab active" : "admin-tab"} onClick={() => setTab(t.key)}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <TabDashboard settings={settings} orders={orders} />}
      {tab === "prices" && <TabPrices settings={settings} setSettings={setSettings} setToast={setToast} />}
      {tab === "orders" && <TabOrders orders={orders} setOrders={setOrders} />}
      {tab === "customers" && <TabCustomers orders={orders} />}
      {tab === "market" && <TabMarket settings={settings} setSettings={setSettings} setToast={setToast} />}
      {tab === "settings" && <TabSettings settings={settings} setSettings={setSettings} setToast={setToast} />}
      {tab === "log" && <TabLog log={log} />}
      {tab === "backup" && <TabBackup setSettings={setSettings} setOrders={setOrders} setToast={setToast} />}
    </div>
  );
}

function TabDashboard({ settings, orders }) {
  const today = new Date().toDateString();
  const todays = orders.filter((o) => new Date(o.createdAt).toDateString() === today);
  const buySum = todays.filter((o) => o.type === "buy").reduce((s, o) => s + (o.total || 0), 0);
  const sellSum = todays.filter((o) => o.type === "sell").reduce((s, o) => s + (o.approxTotal || 0), 0);
  const pending = orders.filter((o) => !["تکمیل شد", "لغو شد", "پرداخت رد شد"].includes(o.status)).length;

  return (
    <div className="admin-section" style={{ borderTop: "none", paddingTop: 0 }}>
      <div className="stat-grid">
        <div className="stat-card"><span className="stat-label">سفارش امروز</span><span className="stat-value mono">{todays.length}</span></div>
        <div className="stat-card"><span className="stat-label">مبلغ خرید امروز</span><span className="stat-value mono">{toman(buySum)}</span></div>
        <div className="stat-card"><span className="stat-label">مبلغ فروش امروز</span><span className="stat-value mono">{toman(sellSum)}</span></div>
        <div className="stat-card"><span className="stat-label">سفارش‌های در جریان</span><span className="stat-value mono">{pending}</span></div>
      </div>
      <p className="pay-note">
        {settings.market.emergencyStop ? "⛔ معاملات به‌طور اضطراری متوقف شده‌اند." :
          isWithinClosedWindow(settings.market.closeStart, settings.market.closeEnd) ? "🔒 بازار در حال حاضر بسته است." : "🟢 بازار باز است."}
      </p>
    </div>
  );
}

function TabPrices({ settings, setSettings, setToast }) {
  const [form, setForm] = useState(settings.products);
  useEffect(() => setForm(settings.products), [settings.products]);
  const [openHistory, setOpenHistory] = useState(null);

  const update = (key, field, val) => setForm({ ...form, [key]: { ...form[key], [field]: val } });

  const save = async () => {
    const nextSettings = await api.updatePrices(form);
    setSettings(nextSettings);
    setToast("تنظیمات قیمت ذخیره شد");
  };

  return (
    <div className="admin-section" style={{ borderTop: "none", paddingTop: 0 }}>
      {PRODUCTS.map((p) => (
        <div key={p.key} className="price-edit-card">
          <div className="price-edit-head">
            <span className="purity-name">{p.title}</span>
            <label className="toggle-row">
              <input type="checkbox" checked={form[p.key].buyActive} onChange={(e) => update(p.key, "buyActive", e.target.checked)} /> خرید فعال
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={form[p.key].sellActive} onChange={(e) => update(p.key, "sellActive", e.target.checked)} /> فروش فعال
            </label>
          </div>
          <div className="admin-grid">
            <label className="field"><span>قیمت خرید (تومان/گرم)</span><input type="number" value={form[p.key].buyPrice} onChange={(e) => update(p.key, "buyPrice", e.target.value)} /></label>
            <label className="field"><span>قیمت فروش (تومان/گرم)</span><input type="number" value={form[p.key].sellPrice} onChange={(e) => update(p.key, "sellPrice", e.target.value)} /></label>
            <label className="field"><span>حداقل وزن (گرم)</span><input type="number" value={form[p.key].minWeight} onChange={(e) => update(p.key, "minWeight", e.target.value)} /></label>
            <label className="field"><span>حداکثر وزن (گرم)</span><input type="number" value={form[p.key].maxWeight} onChange={(e) => update(p.key, "maxWeight", e.target.value)} /></label>
          </div>
          <button className="ghost-btn small-btn" onClick={() => setOpenHistory(openHistory === p.key ? null : p.key)}>
            <History size={13} /> تاریخچه قیمت ({(settings.products[p.key].priceHistory || []).length})
          </button>
          {openHistory === p.key && (
            <div className="history-list">
              {(settings.products[p.key].priceHistory || []).length === 0 && <span className="pay-note">تاریخچه‌ای ثبت نشده.</span>}
              {(settings.products[p.key].priceHistory || []).map((h, i) => (
                <div key={i} className="history-row mono">
                  {fmtTime(h.time)} — خرید {h.buyPrice.toLocaleString("fa-IR")} — فروش {h.sellPrice.toLocaleString("fa-IR")}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <button className="primary-btn" onClick={save}>ذخیره تنظیمات قیمت</button>
    </div>
  );
}

function OrderRow({ order, onStatusChange, onRecordWeight, onFinalizeAmount, onNoteChange }) {
  const [open, setOpen] = useState(false);
  const [finalWeight, setFinalWeight] = useState(order.finalWeight ?? "");
  const [finalPrice, setFinalPrice] = useState(order.finalPricePerGram ?? order.pricePerGram);
  const [note, setNote] = useState(order.adminNote ?? "");
  const statuses = order.type === "buy" ? BUY_STATUSES : SELL_STATUSES;

  const saveWeight = () => { if (Number(finalWeight) > 0) onRecordWeight(order.id, finalWeight); };
  const saveAmount = () => { if (Number(finalPrice) > 0) onFinalizeAmount(order.id, finalPrice); };

  return (
    <div className="order-row">
      <div className="order-row-top" onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <span className="mono">{order.id}</span>
        <span className={order.type === "buy" ? "tag tag-buy" : "tag tag-sell"}>{order.type === "buy" ? "خرید" : "فروش"}</span>
        <span className="status-pill">{order.status}</span>
      </div>
      <div className="order-row-mid">
        <span>{PRODUCTS.find((p) => p.key === order.purity)?.title} — {order.weight} گرم</span>
        <span className="mono">{toman(order.total ?? order.approxTotal)}</span>
      </div>
      <div className="order-row-mid">
        <span>{order.name}</span>
        <span className="mono">{order.phone}</span>
      </div>
      <div className="order-row-bottom">
        <span className="date">{fmtTime(order.createdAt)}</span>
        <select value={order.status} onChange={(e) => onStatusChange(order.id, e.target.value)}>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {open && (
        <div className="order-detail">
          <div className="calc-row"><span>قیمت هر گرم</span><span className="mono">{toman(order.pricePerGram)}</span></div>
          {order.type === "buy" && order.lockExpiresAt && (
            <div className="calc-row"><span>اعتبار قیمت تا</span><span className="mono">{fmtTime(order.lockExpiresAt)}</span></div>
          )}
          {order.type === "sell" && order.sellValidUntil && (
            <div className="calc-row"><span>اعتبار فروش تا</span><span className="mono">{fmtTime(order.sellValidUntil)}</span></div>
          )}

          {order.receiptImage && <img src={order.receiptImage} alt="رسید" className="receipt-img" />}

          {order.type === "sell" && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="admin-grid">
                <label className="field"><span>وزن نهایی واقعی (گرم)</span><input type="number" value={finalWeight} onChange={(e) => setFinalWeight(e.target.value)} /></label>
                <button className="ghost-btn small-btn" onClick={saveWeight}>ثبت وزن نهایی</button>
              </div>
              {order.finalWeight != null && (
                <div className="admin-grid">
                  <label className="field"><span>قیمت نهایی هر گرم</span><input type="number" value={finalPrice} onChange={(e) => setFinalPrice(e.target.value)} /></label>
                  <button className="ghost-btn small-btn" onClick={saveAmount}>تعیین مبلغ نهایی</button>
                </div>
              )}
              {order.finalTotal != null && <span className="pay-note">مبلغ نهایی: {toman(order.finalTotal)}</span>}
            </div>
          )}

          <label className="field" style={{ marginTop: 8 }}>
            <span>اطلاعات تکمیلی / یادداشت ادمین</span>
            <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => onNoteChange(order.id, note)} />
          </label>

          <div className="timeline" style={{ marginTop: 8 }}>
            {order.history.map((h, i) => <div className="timeline-row" key={i}><span className="mono">{fmtTime(h.time)}</span><span>{h.status}</span></div>)}
          </div>
        </div>
      )}
    </div>
  );
}

function TabOrders({ orders, setOrders }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = orders.filter((o) =>
    (typeFilter === "all" || o.type === typeFilter) && (statusFilter === "all" || o.status === statusFilter)
  );

  const handleStatusChange = async (id, status) => setOrders(await api.updateOrderStatus(id, status));
  const handleRecordWeight = async (id, weight) => setOrders(await api.recordFinalWeight(id, weight));
  const handleFinalizeAmount = async (id, price) => setOrders(await api.finalizeSellAmount(id, price));
  const handleNoteChange = async (id, note) => setOrders(await api.setOrderNote(id, note));

  const allStatuses = [...new Set([...BUY_STATUSES, ...SELL_STATUSES])];

  return (
    <div className="admin-section" style={{ borderTop: "none", paddingTop: 0 }}>
      <div className="admin-grid">
        <label className="field"><span>نوع</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">همه</option><option value="buy">خرید</option><option value="sell">فروش</option>
          </select>
        </label>
        <label className="field"><span>وضعیت</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">همه</option>
            {allStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="orders-list">
        {filtered.length === 0 && <p className="pay-note">سفارشی یافت نشد.</p>}
        {filtered.map((o) => (
          <OrderRow
            key={o.id} order={o}
            onStatusChange={handleStatusChange}
            onRecordWeight={handleRecordWeight}
            onFinalizeAmount={handleFinalizeAmount}
            onNoteChange={handleNoteChange}
          />
        ))}
      </div>
    </div>
  );
}

function TabCustomers({ orders }) {
  const map = {};
  orders.forEach((o) => {
    const k = o.phone;
    if (!map[k]) map[k] = { name: o.name, phone: o.phone, count: 0, buyTotal: 0, sellTotal: 0 };
    map[k].name = o.name;
    map[k].count += 1;
    if (o.type === "buy") map[k].buyTotal += o.total || 0;
    else map[k].sellTotal += o.finalTotal ?? o.approxTotal ?? 0;
  });
  const customers = Object.values(map).sort((a, b) => b.count - a.count);
  return (
    <div className="admin-section" style={{ borderTop: "none", paddingTop: 0 }}>
      {customers.length === 0 && <p className="pay-note">هنوز مشتری‌ای ثبت نشده.</p>}
      <div className="orders-list">
        {customers.map((c) => (
          <div className="order-row" key={c.phone}>
            <div className="order-row-top"><span>{c.name}</span><span className="mono">{c.phone}</span></div>
            <div className="order-row-mid"><span>تعداد سفارش: {c.count}</span></div>
            <div className="order-row-mid"><span className="mono">خرید: {toman(c.buyTotal)}</span><span className="mono">فروش: {toman(c.sellTotal)}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabMarket({ settings, setSettings, setToast }) {
  const [form, setForm] = useState(settings.market);
  useEffect(() => setForm(settings.market), [settings.market]);

  const save = async () => {
    const next = await api.updateMarket(form);
    setSettings(next);
    setToast("تنظیمات بازار ذخیره شد");
  };

  const toggleEmergency = async () => {
    const next = await api.setEmergencyStop(!form.emergencyStop);
    setSettings(next);
    setForm(next.market);
    setToast(next.market.emergencyStop ? "معاملات متوقف شد" : "معاملات دوباره فعال شد");
  };

  return (
    <div className="admin-section" style={{ borderTop: "none", paddingTop: 0 }}>
      <div className="admin-grid">
        <label className="field"><span>ساعت شروع بسته بودن</span><input type="time" value={form.closeStart} onChange={(e) => setForm({ ...form, closeStart: e.target.value })} /></label>
        <label className="field"><span>ساعت پایان بسته بودن</span><input type="time" value={form.closeEnd} onChange={(e) => setForm({ ...form, closeEnd: e.target.value })} /></label>
      </div>
      <label className="toggle-row"><input type="checkbox" checked={form.buyEnabled} onChange={(e) => setForm({ ...form, buyEnabled: e.target.checked })} /> خرید فعال باشد</label>
      <label className="toggle-row"><input type="checkbox" checked={form.sellEnabled} onChange={(e) => setForm({ ...form, sellEnabled: e.target.checked })} /> فروش فعال باشد</label>
      <button className="primary-btn" onClick={save}>ذخیره تنظیمات بازار</button>

      <div className="danger-zone">
        <span className="pay-label">توقف اضطراری معاملات</span>
        <p className="pay-note">با فعال کردن این گزینه، خرید و فروش فوراً و مستقل از ساعات بازار متوقف می‌شود.</p>
        <button className={form.emergencyStop ? "primary-btn danger-btn-active" : "danger-btn"} onClick={toggleEmergency}>
          <AlertTriangle size={14} /> {form.emergencyStop ? "لغو توقف اضطراری" : "توقف اضطراری معاملات"}
        </button>
      </div>
    </div>
  );
}

function TabSettings({ settings, setSettings, setToast }) {
  const [lockMinutes, setLockMinutes] = useState(settings.priceLockMinutes);
  const [sellDays, setSellDays] = useState(settings.sellValidityDays);
  const [sellAddress, setSellAddress] = useState(settings.sellAddress);
  const [bank, setBank] = useState(settings.bank);

  const save = async () => {
    const patch = {
      priceLockMinutes: Number(lockMinutes) || 5,
      sellValidityDays: Number(sellDays) || 3,
      sellAddress, bank,
    };
    const next = await api.updateSystemSettings(patch);
    setSettings(next);
    setToast("تنظیمات ذخیره شد");
  };

  return (
    <div className="admin-section" style={{ borderTop: "none", paddingTop: 0 }}>
      <h3>قفل قیمت و اعتبار فروش</h3>
      <div className="admin-grid">
        <label className="field"><span>مدت قفل قیمت (دقیقه)</span>
          <select value={lockMinutes} onChange={(e) => setLockMinutes(e.target.value)}>
            {[2, 3, 5, 10].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="field"><span>اعتبار فروش (روز)</span><input type="number" value={sellDays} onChange={(e) => setSellDays(e.target.value)} /></label>
      </div>

      <h3>آدرس دریافت ساچمه</h3>
      <textarea className="textarea" rows={2} value={sellAddress} onChange={(e) => setSellAddress(e.target.value)} />

      <h3>اطلاعات حساب بانکی</h3>
      <div className="admin-grid">
        <label className="field"><span>شماره کارت</span><input value={bank.cardNumber} onChange={(e) => setBank({ ...bank, cardNumber: e.target.value })} /></label>
        <label className="field"><span>شماره حساب</span><input value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} /></label>
        <label className="field"><span>شماره شبا (بدون IR)</span><input value={bank.sheba} onChange={(e) => setBank({ ...bank, sheba: e.target.value })} /></label>
        <label className="field"><span>نام صاحب حساب</span><input value={bank.ownerName} onChange={(e) => setBank({ ...bank, ownerName: e.target.value })} /></label>
      </div>

      <button className="primary-btn" onClick={save}>ذخیره تنظیمات</button>
      <p className="admin-footnote"><Package size={14} /> ورود پنل مدیریت با Supabase Authentication و سطح دسترسی مدیر انجام می‌شود.</p>
    </div>
  );
}

function TabLog({ log }) {
  return (
    <div className="admin-section" style={{ borderTop: "none", paddingTop: 0 }}>
      {log.length === 0 && <p className="pay-note">هنوز فعالیتی ثبت نشده.</p>}
      <div className="orders-list">
        {log.map((l, i) => (
          <div className="order-row" key={i}>
            <div className="order-row-top"><span className="mono">{fmtTime(l.time)}</span><span className="tag tag-buy">{l.action}</span></div>
            <div className="order-row-mid"><span>{l.detail}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabBackup({ setSettings, setOrders, setToast }) {
  const download = async () => {
    try {
      const data = JSON.stringify(await api.exportBackup(), null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `meead-backup-${Date.now()}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToast("فایل پشتیبان دانلود شد");
    } catch (e) {
      setToast("دانلود پشتیبان ناموفق بود");
    }
  };

  const restore = async (file) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const state = await api.restoreBackup(data);
      setSettings(state.settings);
      setOrders(state.orders);
      setToast("بازیابی با موفقیت انجام شد");
    } catch (e) {
      setToast("فایل پشتیبان معتبر نیست");
    }
  };

  return (
    <div className="admin-section" style={{ borderTop: "none", paddingTop: 0 }}>
      <p className="pay-note">
        این یک پشتیبان‌گیری دستی و ساده (خروجی/ورودی فایل JSON) است — برای بکاپ خودکار و امن در محلی جدا از سرور، به زیرساخت بک‌اند واقعی نیاز است.
      </p>
      <button className="primary-btn" onClick={download}>دانلود نسخه پشتیبان</button>
      <label className="upload-btn"><Upload size={14} /> بازیابی از فایل
        <input type="file" accept="application/json" hidden onChange={(e) => e.target.files[0] && restore(e.target.files[0])} />
      </label>
    </div>
  );
}

/* --------------------------------- Styles ---------------------------------- */

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');

      * { box-sizing: border-box; }
      .app-root { min-height: 100vh; background: linear-gradient(175deg, #F6F7F8 0%, #EDEFF1 100%); color: #1E242B; font-family: 'Vazirmatn', sans-serif; padding-bottom: 40px; }
      .mono { font-family: 'JetBrains Mono', monospace; direction: ltr; unicode-bidi: plaintext; }
      .loading-screen { display:flex; align-items:center; justify-content:center; height:100vh; color:#7A8494; }

      .app-header { display:grid; grid-template-columns: 36px 1fr 36px; align-items:center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid rgba(30,40,50,0.07); position: sticky; top:0; backdrop-filter: blur(10px); background: rgba(246,247,248,0.88); z-index: 10; }
      .header-spacer { width: 36px; height: 36px; }
      .brand { display:flex; flex-direction:column; align-items:center; justify-self:center; gap: 4px; text-align:center; }
      .brand-text { display:flex; flex-direction:column; align-items:center; }
      .brand-name { font-size: 11.5px; letter-spacing: 1.6px; color:#A9803A; font-weight:800; }
      .brand-sub { font-size: 12.5px; color:#1E242B; font-weight:600; margin-top: 2px; }

      .icon-btn { width: 34px; height: 34px; border-radius: 999px; border: 1px solid rgba(30,40,50,0.1); background:#FFFFFF; color:#667085; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:0.15s; }
      .icon-btn:hover { border-color:#A9803A; color:#A9803A; }

      .app-main { max-width: 480px; margin: 0 auto; padding: 18px 15px 0; }

      .market-banner { display:flex; align-items:center; gap:8px; padding: 10px 14px; border-radius: 12px; font-size: 12.5px; font-weight:600; margin-bottom: 12px; }
      .banner-closed { background: rgba(214,72,63,0.1); color:#B23A31; }
      .banner-open { background: rgba(18,145,91,0.1); color:#0F7A4C; }
      .banner-danger { background: rgba(214,72,63,0.15); color:#B23A31; }

      .update-row { display:flex; justify-content:space-between; font-size:11.5px; color:#93A0AF; padding: 0 2px 14px; }

      .section-head { display:flex; align-items:center; justify-content:space-between; padding: 4px 2px 10px; }
      .section-title { font-size:14px; font-weight:800; color:#1E242B; }
      .section-caption { font-size: 11px; color:#93A0AF; }
      .bars-head { margin-top: 24px; }

      .purity-list { display:flex; flex-direction:column; gap: 12px; }
      .purity-card { background:#FFFFFF; border:1px solid rgba(30,40,50,0.06); border-radius:16px; padding: 14px; box-shadow: 0 1px 3px rgba(20,30,45,0.04); }
      .purity-card-head { display:flex; align-items:center; gap:10px; margin-bottom: 12px; }
      .purity-card-body { display:flex; flex-direction:column; gap:4px; }
      .purity-name { font-size: 13px; font-weight:700; color:#1E242B; }
      .purity-chip { font-size: 10.5px; color:#93A0AF; }

      .stamp-badge { width: 40px; height: 40px; border-radius: 50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; background: radial-gradient(circle at 35% 30%, #3A424C, #1B1F25); border: 2px solid #A9803A; color:#EADFC3; font-family:'JetBrains Mono', monospace; font-weight:700; font-size:9.5px; }

      .price-split { display:flex; gap: 10px; }
      .price-half { flex:1; display:flex; flex-direction:column; align-items:center; gap:5px; border-radius:12px; padding: 11px 6px; cursor:pointer; font-family:inherit; border:1px solid transparent; transition:0.15s; }
      .price-half:hover { transform: translateY(-2px); }
      .half-buy { background: rgba(18,145,91,0.08); border-color: rgba(18,145,91,0.2); }
      .half-buy:hover { border-color:#12915B; }
      .half-buy .half-label { color:#12915B; }
      .half-sell { background: rgba(214,72,63,0.08); border-color: rgba(214,72,63,0.2); }
      .half-sell:hover { border-color:#D6483F; }
      .half-sell .half-label { color:#D6483F; }
      .half-off { opacity: 0.5; }
      .half-label { font-size:10.5px; font-weight:700; display:flex; align-items:center; gap:4px; }
      .half-price { font-size:14.5px; font-weight:800; color:#1E242B; }
      .half-unit { font-size:9px; color:#93A0AF; }

      .bars-row { display:flex; gap: 12px; }
      .bar-card { flex:1; display:flex; flex-direction:column; align-items:center; gap:8px; background:#FFFFFF; border:1px dashed rgba(30,40,50,0.14); border-radius:14px; padding: 14px 10px; font-size:12px; color:#93A0AF; }
      .soon-ribbon { font-size:10px; padding:3px 9px; border-radius:999px; background: rgba(169,128,58,0.12); color:#A9803A; }

      .track-link { display:flex; align-items:center; gap:6px; justify-content:center; width:100%; margin-top:20px; background:none; border:1px dashed rgba(30,40,50,0.15); color:#667085; padding: 12px; border-radius: 12px; font-family:inherit; font-size:12.5px; cursor:pointer; }

      .panel { background:#FFFFFF; border:1px solid rgba(30,40,50,0.06); border-radius:18px; padding: 20px 16px; display:flex; flex-direction:column; gap:12px; margin-bottom:24px; box-shadow: 0 1px 3px rgba(20,30,45,0.04); }
      .back-link { display:flex; align-items:center; gap:4px; background:none; border:none; color:#7A8494; font-family:inherit; font-size:13px; cursor:pointer; padding:0; align-self:flex-start; }
      .panel-title { font-size:16.5px; font-weight:800; margin:0; color:#1E242B; }
      .panel-sub { font-size:12px; font-weight:700; }
      .panel-sub.tone-buy { color:#12915B; }
      .panel-sub.tone-sell { color:#D6483F; }

      .countdown { display:flex; align-items:center; gap:6px; font-size:12px; color:#667085; background:#F6F7F8; padding:8px 10px; border-radius:10px; width:fit-content; }
      .countdown-warn { color:#D6483F; background: rgba(214,72,63,0.08); }
      .expired-box { display:flex; align-items:center; justify-content:space-between; gap:10px; background: rgba(214,72,63,0.08); color:#B23A31; padding:10px 12px; border-radius:10px; font-size:12.5px; }

      .field { display:flex; flex-direction:column; gap:6px; font-size:12px; color:#667085; }
      .field input, .textarea, select { background:#F6F7F8; border:1px solid rgba(30,40,50,0.1); border-radius:10px; padding:10px 12px; color:#1E242B; font-family:'JetBrains Mono', monospace; font-size:13.5px; direction:ltr; text-align:right; }
      .field input:focus, .textarea:focus { outline:none; border-color:#A9803A; }
      .textarea { font-family:'Vazirmatn', sans-serif; direction:rtl; text-align:right; width:100%; resize:vertical; }
      .field-pair { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
      .error-text { color:#D6483F; font-size:11.5px; }

      .calc-row { display:flex; justify-content:space-between; align-items:center; font-size:13px; color:#667085; padding:3px 0; }
      .calc-row.total { border-top: 1px dashed rgba(30,40,50,0.12); margin-top:4px; padding-top:10px; font-weight:800; color:#1E242B; font-size:14.5px; }

      .sell-warning { background: rgba(214,72,63,0.08); color:#8A342C; font-size:11.5px; line-height:1.9; padding:10px 12px; border-radius:10px; }

      .primary-btn { background: linear-gradient(145deg,#232A33,#12161C); color:#F6F7F8; border:none; border-radius:12px; padding:13px; font-family:inherit; font-weight:700; font-size:13.5px; cursor:pointer; transition:0.15s; }
      .primary-btn:disabled { opacity:0.5; cursor:not-allowed; }
      .primary-btn:hover:not(:disabled) { filter:brightness(1.15); }
      .ghost-btn { background:transparent; border:1px solid rgba(30,40,50,0.15); color:#667085; border-radius:12px; padding:13px; font-family:inherit; cursor:pointer; font-size:13px; }
      .small-btn { padding: 8px 12px; font-size: 11.5px; display:flex; align-items:center; gap:6px; width: fit-content; }
      .btn-row { display:flex; gap:10px; }
      .btn-row .primary-btn, .btn-row .ghost-btn { flex:1; }

      .confirm { align-items:center; text-align:center; }
      .confirm-icon { color:#12915B; }
      .order-code { color:#7A8494; font-size:12.5px; }
      .confirm-summary { width:100%; background:#F6F7F8; border-radius:12px; padding:12px 14px; }
      .pay-box { width:100%; display:flex; flex-direction:column; gap:8px; align-items:flex-start; text-align:right; }
      .pay-label { font-size:12.5px; color:#667085; font-weight:700; }
      .card-number-row { display:flex; align-items:center; gap:8px; background:#F6F7F8; border:1px solid rgba(30,40,50,0.1); border-radius:10px; padding:10px 12px; width:100%; justify-content:space-between; }
      .card-number { font-size:14.5px; letter-spacing:1px; }
      .pay-note { font-size:11.5px; color:#7A8494; line-height:1.9; margin:0; }
      .address-box { background:#F6F7F8; border-radius:10px; padding:10px 12px; font-size:12.5px; width:100%; }

      .upload-btn { display:flex; align-items:center; justify-content:center; gap:6px; background:#F6F7F8; border:1px dashed rgba(30,40,50,0.2); border-radius:10px; padding: 11px; font-size:12.5px; color:#667085; cursor:pointer; width:100%; }

      .admin-login { align-items:center; text-align:center; }

      .admin-header { display:flex; justify-content:space-between; align-items:center; }
      .admin-header-title { display:flex; align-items:center; gap:8px; }
      .admin-tabs { display:flex; flex-wrap:wrap; gap:6px; padding-bottom: 6px; border-bottom: 1px solid rgba(30,40,50,0.07); }
      .admin-tab { display:flex; align-items:center; gap:5px; background:#F6F7F8; border:1px solid transparent; color:#667085; padding: 7px 11px; border-radius:999px; font-size:11.5px; font-family:inherit; cursor:pointer; }
      .admin-tab.active { background:#232A33; color:#F6F7F8; }
      .admin-section { display:flex; flex-direction:column; gap:10px; border-top:1px solid rgba(30,40,50,0.07); padding-top:14px; }
      .admin-section h3 { font-size:12.5px; color:#667085; margin: 6px 0 0; font-weight:700; }
      .admin-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }

      .stat-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
      .stat-card { background:#F6F7F8; border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:4px; }
      .stat-label { font-size:11px; color:#93A0AF; }
      .stat-value { font-size:16px; font-weight:800; color:#1E242B; }

      .price-edit-card { background:#F6F7F8; border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px; }
      .price-edit-head { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; }
      .toggle-row { display:flex; align-items:center; gap:6px; font-size:11.5px; color:#667085; }
      .history-list { display:flex; flex-direction:column; gap:4px; background:#FFFFFF; border-radius:8px; padding:8px; }
      .history-row { font-size:11px; color:#667085; }

      .orders-list { display:flex; flex-direction:column; gap:10px; max-height: 460px; overflow-y:auto; }
      .order-row { background:#F6F7F8; border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:6px; font-size:12px; }
      .order-row-top, .order-row-mid, .order-row-bottom { display:flex; justify-content:space-between; align-items:center; }
      .tag { font-size:10px; padding:3px 9px; border-radius:999px; font-weight:700; }
      .tag-buy { background: rgba(18,145,91,0.12); color:#12915B; }
      .tag-sell { background: rgba(214,72,63,0.12); color:#D6483F; }
      .status-pill { font-size:10px; padding:3px 9px; border-radius:999px; background: rgba(169,128,58,0.12); color:#A9803A; font-weight:700; }
      .order-row select { padding:6px 8px; font-size:11px; font-family:'Vazirmatn',sans-serif; }
      .date { color:#93A0AF; font-size:10.5px; }
      .order-detail { border-top: 1px dashed rgba(30,40,50,0.12); margin-top:8px; padding-top:8px; }
      .receipt-img { max-width:100%; border-radius:8px; margin-bottom:8px; }
      .timeline { display:flex; flex-direction:column; gap:3px; }
      .timeline-row { display:flex; justify-content:space-between; font-size:10.5px; color:#667085; }
      .admin-footnote { display:flex; align-items:center; gap:6px; font-size:11px; color:#93A0AF; line-height:1.8; }

      .danger-zone { background: rgba(214,72,63,0.06); border:1px dashed rgba(214,72,63,0.3); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:6px; }
      .danger-btn { display:flex; align-items:center; justify-content:center; gap:6px; background:#FFFFFF; border:1px solid #D6483F; color:#D6483F; border-radius:10px; padding:11px; font-family:inherit; font-size:12.5px; cursor:pointer; }
      .danger-btn-active { background: linear-gradient(145deg,#D6483F,#B23A31) !important; display:flex; align-items:center; justify-content:center; gap:6px; }

      .toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#232A33; color:#F6F7F8; padding:10px 18px; border-radius:999px; font-size:12.5px; z-index:50; box-shadow: 0 8px 20px rgba(20,30,45,0.25); max-width: 90%; text-align:center; }

      @media (max-width: 380px) {
        .field-pair, .admin-grid, .stat-grid { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
