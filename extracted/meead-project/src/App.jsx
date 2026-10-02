import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Lock, Unlock, Copy, Check, CheckCircle2, X, ChevronRight,
  Search, Clock, Upload, Users, Settings as SettingsIcon, Database,
  AlertTriangle, TrendingUp, TrendingDown, Package, History, LayoutDashboard,Headphones,Phone, PhoneCall,
  ShieldAlert ,
} from "lucide-react";
import { iranLocations } from "./iranLocations";
import { trackSiteVisit } from "./siteAnalytics";
import TabAnalytics from "./TabAnalytics";
function PwaInstallPrompt({ onClose }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;

    if (isStandalone) {
      onClose();
      return;
    }

    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !window.MSStream &&
      !/CriOS|FxiOS/.test(navigator.userAgent);

    setIsIOS(ios);

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt
    );

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
    };
  }, [onClose]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();

    await deferredPrompt.userChoice;

    setDeferredPrompt(null);
    onClose();
  };

  return (
    <div className="pwa-overlay">
      <div className="pwa-card" dir="rtl">
        <button className="pwa-close" onClick={onClose}>
          ×
        </button>

        <div className="pwa-icon">M</div>

        <h2>نصب Meead</h2>

        <p>
          برای دسترسی سریع‌تر، Meead را به صفحه اصلی گوشی خود اضافه کنید.
        </p>

        {isIOS ? (
          <div className="pwa-steps">
            <div className="pwa-step">
              <strong>۱</strong>
              در Safari روی دکمه <b>Share</b> بزنید.
            </div>

            <div className="pwa-step">
              <strong>۲</strong>
              گزینه <b>Add to Home Screen</b> یا «افزودن به صفحه اصلی» را
              انتخاب کنید.
            </div>

            <div className="pwa-step">
              <strong>۳</strong>
              روی <b>Add</b> یا «افزودن» بزنید.
            </div>
          </div>
        ) : deferredPrompt ? (
          <button className="pwa-install-btn" onClick={handleInstall}>
            افزودن Meead به صفحه اصلی
          </button>
        ) : (
          <div className="pwa-steps">
            <div className="pwa-step">
              از منوی مرورگر گزینه <b>Add to Home Screen</b> را انتخاب کنید.
            </div>
          </div>
        )}

        <button className="pwa-later" onClick={onClose}>
          فعلاً نه
        </button>
      </div>
    </div>
  );
}

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
  nextOrderSeq: 1058,
  lastPriceUpdate: null,
support: {
  landline: "",
  mobile: "",
  whatsapp: "",
  telegram: "",
  instagram: "",
},
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
    support: {
  ...DEFAULT_SETTINGS.support,
  ...(s.support || {}),
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
    name: row.name,
firstName: row.first_name || "",
lastName: row.last_name || "",
phone: row.phone,
province: row.province || "",
city: row.city || "",
address: row.address || "",
postalCode: row.postal_code || "",
createdAt: row.created_at,
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
  const products = publicData?.products || {};
  const market = publicData?.market || {};
  const system = publicData?.system || {};
  return mergeSettings({
    products: Object.fromEntries(PRODUCTS.map(p => [p.key, products[p.key] || {}])),
    market: {
      closeStart: market.closeStart ?? "00:00", closeEnd: market.closeEnd ?? "11:00",
      buyEnabled: market.buyEnabled ?? true, sellEnabled: market.sellEnabled ?? true,
      emergencyStop: market.emergencyStop ?? false
    },
    priceLockMinutes: Number(system.priceLockMinutes ?? 5),
    sellValidityDays: Number(system.sellValidityDays ?? 3),
    sellAddress: system.sellAddress ?? "",
    lastPriceUpdate: system.lastPriceUpdate ?? null ,
    support: {

  landline: system.support?.landline ?? "",

  mobile: system.support?.mobile ?? "",

  whatsapp: system.support?.whatsapp ?? "",

  telegram: system.support?.telegram ?? "",

  instagram: system.support?.instagram ?? "",

}
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
    supabase.from("orders").select("*").order("Created_at", { ascending: false }),
    supabase.from("order_history").select("*").order("created_at", { ascending: true }),
    supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(300)
  ]);
  for (const r of [productsRes,historiesRes,marketRes,systemRes,ordersRes,orderHistoriesRes,logRes]) if (r.error) throw r.error;
  const products = productsRes.data || [];
  const ph = historiesRes.data || [];
  const m = marketRes.data || {};
  const sys = systemRes.data || {};
  const settings = mergeSettings({
    products: Object.fromEntries(
  PRODUCTS.map(p => [
    p.key,
    mapProduct(
      products.find(r => String(r.key) === String(p.key)) || {},
      ph.filter(h => String(h.product_key) === String(p.key))
    )
  ])
),
    market: { closeStart:m.close_start ?? "00:00", closeEnd:m.close_end ?? "11:00", buyEnabled:m.buy_enabled ?? true, sellEnabled:m.sell_enabled ?? true, emergencyStop:m.emergency_stop ?? false },
    priceLockMinutes: Number(sys.price_lock_minutes ?? 5), sellValidityDays: Number(sys.sell_validity_days ?? 3),
    bank: { cardNumber:sys.bank_card_number || "", accountNumber:sys.bank_account_number || "", sheba:sys.bank_sheba || "", ownerName:sys.bank_owner_name || "" },
    sellAddress: sys.sell_address || "",
lastPriceUpdate: sys.last_price_update || null,
nextOrderSeq: Number(sys.next_order_seq ?? 1058),
support: {
  landline: sys.support_landline || "",
  mobile: sys.support_mobile || "",
  whatsapp: sys.support_whatsapp || "",
  telegram: sys.support_telegram || "",
  instagram: sys.support_instagram || "",
}
  });
  const orders = await Promise.all((ordersRes.data || []).map(async (r) => {
  const order = mapOrder(r, orderHistoriesRes.data || []);
  if (order?.receiptPath) {
    try {
      const { data: signed, error: signedError } = await supabase.storage
        .from("receipts")
        .createSignedUrl(order.receiptPath, 3600);

      if (!signedError && signed?.signedUrl) {
        order.receiptImage = signed.signedUrl;
      }
    } catch (e) {
      console.error("Receipt preview URL error:", e);
    }
  }
  return order;
}));
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
    const { data, error } = await supabase.rpc("submit_order", {
  p_quote: quote,
  p_weight: Number(weight),
  p_first_name: customer.firstName,
p_last_name: customer.lastName,
p_phone: customer.phone,
p_address: customer.address,
p_province: customer.province,
p_city: customer.city,
p_postal_code: customer.postalCode,
});
    if (error) return { ok:false, reason:error.message || "ثبت سفارش ناموفق بود" };
    if (!data?.ok) return data || {ok:false, reason:"ثبت سفارش ناموفق بود"};
    const row = data.order || data;
    const order = mapOrder(row, []);
    const pub = await publicSettings().catch(()=>null);
    return { ok:true, order, orders:[], settings:mapSettings(pub || {}) };
  },
  async attachReceipt(order, file, onProgress) {
  try {
    const fd = new FormData();

    fd.append("orderNumber", order.id);
    fd.append("phone", order.phone);
    fd.append("file", file);

    if (onProgress) onProgress(0);

    const { data, error } = await supabase.functions.invoke(
      "upload-receipt",
      {
        body: fd,
      }
    );

    if (error || data?.ok === false) {
      console.error("Receipt upload failed:", error, data);

      return {
        ok: false,
        reason:
          data?.reason ||
          error?.message ||
          "آپلود رسید ناموفق بود",
      };
    }

    if (onProgress) onProgress(100);

    return {
      ok: true,
      order: {
        ...order,
        status:
          data?.status ||
          "در انتظار تأیید پرداخت",
        receiptPath:
          data?.receiptPath ||
          order.receiptPath ||
          null,
      },
      orders: [],
    };
  } catch (e) {
    console.error("Receipt upload error:", e);

    return {
      ok: false,
      reason:
        e?.message ||
        "آپلود رسید ناموفق بود",
    };
  }
},
  
  async findOrder(code, phone) {
  const normalizedCode = String(code || "").trim();
  const normalizedPhone = String(phone || "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .trim();

  const { data, error } = await supabase.rpc("find_order", {
    p_order_number: normalizedCode,
    p_phone: normalizedPhone
  });

  console.log("Meead find_order:", {
    code: normalizedCode,
    phone: normalizedPhone,
    data,
    error
  });

  if (error) {
    throw new Error(error.message || "خطا در پیگیری سفارش");
  }

  if (!data?.ok || !data?.order) {
  throw new Error(
    data?.reason ||
    data?.message ||
    "find_order پاسخ نامعتبر برگرداند: " + JSON.stringify(data)
  );
}

  const o = data.order;

  return {
    id: o.order_number || normalizedCode,
    dbId: Number(o.id),
    type: o.type,
    purity: o.purity,
    weight: Number(o.weight),
    pricePerGram: Number(o.price_per_gram ?? 0),
    total: o.total == null ? null : Number(o.total),
    approxTotal: o.approx_total == null ? null : Number(o.approx_total),
    name: o.name,
    firstName: o.first_name || "",
    lastName: o.last_name || "",
    phone: o.phone,
    address: o.address || "",
    createdAt: o.created_at,
    lockExpiresAt: o.lock_expires_at,
    sellValidUntil: o.sell_valid_until,
    bankSnapshot: o.bank_snapshot || {},
    receiptPath: o.receipt_url || null,
    receiptImage: null,
    status: o.status,
    adminNote: o.admin_note || "",
    finalWeight: o.final_weight == null ? null : Number(o.final_weight),
    finalPricePerGram: o.final_price_per_gram == null ? null : Number(o.final_price_per_gram),
    finalTotal: o.final_total == null ? null : Number(o.final_total),
    history: (Array.isArray(o.history) ? o.history : []).map(h => ({
      status: h.status,
      time: h.created_at || h.time
    }))
  };
},
  async login(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error || !data?.session) {
      return {
        ok: false,
        reason: error?.message || "ورود ناموفق بود",
      };
    }

    // اطمینان از اینکه session جدید واقعاً روی کلاینت ثبت شده است
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError || !sessionData?.session) {
      return {
        ok: false,
        reason: sessionError?.message || "نشست کاربری ایجاد نشد",
      };
    }

    const { data: admin, error: adminError } =
      await supabase.rpc("is_admin");

    if (adminError) {
      console.error("Admin check failed:", adminError);
      return {
        ok: false,
        reason: adminError.message || "خطا در بررسی دسترسی مدیر",
      };
    }

    if (admin !== true) {
      await supabase.auth.signOut();

      return {
        ok: false,
        reason: "این حساب دسترسی مدیریت ندارد",
      };
    }

    return { ok: true };
  } catch (error) {
    console.error("Admin login error:", error);

    return {
      ok: false,
      reason: error?.message || "خطا در ورود به پنل مدیریت",
    };
  }
},
  async logout() { await supabase.auth.signOut(); },
  async updatePrices(productsForm) {
    const toBoolean = (value) =>
      value === true || value === "true" || value === 1 || value === "1";

    const productPayload = Object.fromEntries(
      PRODUCTS.map((p) => {
        const v = productsForm[p.key] || {};
        return [
          p.key,
          {
            buyPrice: Number(v.buyPrice),
            sellPrice: Number(v.sellPrice),
            minWeight: Number(v.minWeight),
            maxWeight: Number(v.maxWeight),
            buyActive: toBoolean(v.buyActive),
            sellActive: toBoolean(v.sellActive),
          },
        ];
      })
    );

    const { data, error } = await supabase.rpc("save_product_settings", {
      p_products: productPayload,
    });

    if (error || !data?.ok) {
      throw error || new Error(
        data?.reason || "ذخیره تنظیمات قیمت ناموفق بود"
      );
    }

    return adminState();
  },
   async updateMarket(marketPatch) {
    const { data, error } = await supabase.rpc("update_market_settings", {
      p_close_start: marketPatch.closeStart,
      p_close_end: marketPatch.closeEnd,
      p_buy_enabled: !!marketPatch.buyEnabled,
      p_sell_enabled: !!marketPatch.sellEnabled,
      p_emergency_stop: !!marketPatch.emergencyStop
    });

    if (error) throw error;

    if (!data?.ok) {
      throw new Error(data?.reason || "ذخیره تنظیمات بازار ناموفق بود");
    }

    return mergeSettings({
      market: {
        closeStart: data.closeStart,
        closeEnd: data.closeEnd,
        buyEnabled: data.buyEnabled,
        sellEnabled: data.sellEnabled,
        emergencyStop: data.emergencyStop,
      },
    });
  },

  async setEmergencyStop(flag) {
    const s = (await adminState()).settings.market;
    const { error } = await supabase.rpc("update_market_settings", {
      p_close_start: s.closeStart,
      p_close_end: s.closeEnd,
      p_buy_enabled: s.buyEnabled,
      p_sell_enabled: s.sellEnabled,
      p_emergency_stop: !!flag
    });

    if (error) throw error;
    return (await adminState()).settings;
  },
  async updateSystemSettings(patch) {
  const current = (await adminState()).settings;

  const b = {
    ...current.bank,
    ...(patch.bank || {}),
  };

  const s = {
    ...current.support,
    ...(patch.support || {}),
  };

  const { data, error } = await supabase.rpc("update_system_settings", {
    p_price_lock_minutes: Number(
      patch.priceLockMinutes ?? current.priceLockMinutes
    ),
    p_sell_validity_days: Number(
      patch.sellValidityDays ?? current.sellValidityDays
    ),
    p_sell_address: patch.sellAddress ?? current.sellAddress ?? "",
    p_bank_card_number: b.cardNumber || "",
    p_bank_account_number: b.accountNumber || "",
    p_bank_sheba: b.sheba || "",
    p_bank_owner_name: b.ownerName || "",

    p_support_landline: s.landline || "",
    p_support_mobile: s.mobile || "",
    p_support_whatsapp: s.whatsapp || "",
    p_support_telegram: s.telegram || "",
    p_support_instagram: s.instagram || "",
  });

  if (error) throw error;

  if (!data?.ok) {
    throw new Error(
      data?.reason || "ذخیره تنظیمات ناموفق بود"
    );
  }

  return (await adminState()).settings;
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
  async deleteOrder(order) {
    const dbId = await this.resolveOrderId(order);

    const { data, error } = await supabase.rpc("delete_order", {
      p_order_id: dbId,
    });

    if (error || !data?.ok) {
      throw error || new Error(data?.reason || "حذف سفارش ناموفق بود");
    }

    return (await adminState()).orders;
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
function Support({ onBack, settings }) {
  const support = settings.support || {};

  const itemStyle = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    color: "#000",
    textDecoration: "none",
  };

  const textStyle = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    color: "#000",
  };

  const labelStyle = {
    color: "#000",
    fontWeight: 600,
  };

  const valueStyle = {
    color: "#000",
  };

  return (
    <div className="panel">
      <button className="back-link" onClick={onBack}>
        <ChevronRight size={16} /> بازگشت
      </button>

      <h2 className="panel-title" style={{ color: "#000" }}>
        پشتیبانی
      </h2>

      <div
        className="support-list"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >

        <a
          className="support-item"
          style={itemStyle}
          href={`tel:${support.landline}`}
        >
          <Phone size={20} />
          <div style={textStyle}>
            <strong style={labelStyle}>تلفن ثابت</strong>
            <span style={valueStyle}>
              {support.landline || "ثبت نشده"}
            </span>
          </div>
        </a>

        <a
          className="support-item"
          style={itemStyle}
          href={`tel:${support.mobile}`}
        >
          <PhoneCall size={20} />
          <div style={textStyle}>
            <strong style={labelStyle}>تلفن همراه</strong>
            <span style={valueStyle}>
              {support.mobile || "ثبت نشده"}
            </span>
          </div>
        </a>

        <a
          className="support-item"
          style={itemStyle}
          href={`https://wa.me/${support.whatsapp}`}
        >
          <div className="social-icon whatsapp">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M20.52 3.48A11.8 11.8 0 0 0 12.08 0C5.55 0 .23 5.32.23 11.85c0 2.09.55 4.13 1.59 5.93L.13 24l6.36-1.67a11.8 11.8 0 0 0 5.58 1.42h.01c6.53 0 11.85-5.32 11.85-11.85 0-3.17-1.23-6.15-3.41-8.42ZM12.08 21.7h-.01a9.8 9.8 0 0 1-4.99-1.36l-.36-.21-3.77.99 1.01-3.67-.23-.38a9.8 9.8 0 1 1 8.35 4.63Zm5.37-7.35c-.29-.15-1.72-.85-1.99-.95-.27-.1-.46-.15-.65.15-.19.29-.75.95-.92 1.14-.17.19-.34.22-.63.07-.29-.15-1.23-.45-2.35-1.43-.87-.77-1.45-1.72-1.62-2.01-.17-.29-.02-.45.13-.6.13-.13.29-.34.43-.51.15-.17.19-.29.29-.49.1-.19.05-.37-.02-.52-.07-.15-.65-1.57-.89-2.15-.23-.56-.47-.48-.65-.49h-.56c-.19 0-.5.07-.76.37-.26.29-1 1-1 2.43s1.03 2.82 1.17 3.01c.15.19 2.03 3.1 4.92 4.35.69.3 1.23.49 1.65.63.69.22 1.32.19 1.82.12.55-.08 1.72-.7 1.96-1.37.24-.67.24-1.24.17-1.37-.07-.12-.26-.19-.55-.34Z" />
            </svg>
          </div>

          <div style={textStyle}>
            <strong style={labelStyle}>واتساپ</strong>
            <span style={valueStyle}>
              {support.whatsapp || "ثبت نشده"}
            </span>
          </div>
        </a>

        <a
          className="support-item"
          style={itemStyle}
          href={`https://t.me/${support.telegram}`}
        >
          <div className="social-icon telegram">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M21.6 3.2 2.9 10.4c-1.28.5-1.27 1.2-.23 1.51l4.8 1.5 1.84 5.64c.23.64.12.9.79.9.52 0 .75-.24 1.02-.53l2.34-2.27 4.86 3.58c.89.49 1.53.24 1.75-.83l3.13-14.76c.33-1.32-.5-1.92-1.6-1.39ZM8.2 13.1l9.46-5.97c.47-.28.9-.13.55.17l-7.66 6.92-.3 3.23-1.02-3.15-1.03-.32Z" />
            </svg>
          </div>

          <div style={textStyle}>
            <strong style={labelStyle}>تلگرام</strong>
            <span style={valueStyle}>
              {support.telegram || "ثبت نشده"}
            </span>
          </div>
        </a>

        <a
          className="support-item"
          style={itemStyle}
          href={`https://instagram.com/${support.instagram}`}
        >
          <div className="social-icon instagram">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle
                cx="17.5"
                cy="6.5"
                r="1"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </div>

          <div style={textStyle}>
            <strong style={labelStyle}>اینستاگرام</strong>
            <span style={valueStyle}>
              {support.instagram || "ثبت نشده"}
            </span>
          </div>
        </a>

      </div>
    </div>
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
  const [customer, setCustomer] = useState({
  firstName: "",
  lastName: "",
  phone: "",
  province: "",
  city: "",
  address: "",
  postalCode: "",
});
  const [lastOrder, setLastOrder] = useState(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPw, setAdminPw] = useState("");
  const [adminError, setAdminError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now());
  const [showPwaPrompt, setShowPwaPrompt] = useState(false);

  // Analytics is deliberately fire-and-forget: a failure here must never
  // block storefront loading or affect orders, prices, market state or auth.
  useEffect(() => {
    trackSiteVisit(supabase);
  }, []);

  useEffect(() => {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (isStandalone) return;

  const dismissed =
    localStorage.getItem("meead-pwa-install-dismissed") === "1";

  if (dismissed) return;

  const timer = setTimeout(() => {
    setShowPwaPrompt(true);
  }, 900);

  return () => clearTimeout(timer);
}, []);
const [uploadingReceiptId, setUploadingReceiptId] = useState(null);
const [receiptUploadStatus, setReceiptUploadStatus] = useState("idle");
  const [receiptUploadProgress, setReceiptUploadProgress] = useState(0);
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
  if (!api.isMarketOpen(settings, mode)) {
    if (settings.market.emergencyStop) {
      setToast("معاملات به‌طور موقت متوقف شده است.");
    } else if (
      isWithinClosedWindow(
        settings.market.closeStart,
        settings.market.closeEnd,
        new Date(now)
      )
    ) {
      setToast(
        `بازار بسته است. ${mode === "buy" ? "خرید" : "فروش"} در ساعات فعالیت بازار امکان‌پذیر است.`
      );
    } else {
      setToast(
        `${mode === "buy" ? "خرید" : "فروش"} در حال حاضر فعال نیست.`
      );
    }
    return;
  }

      const product = settings.products[purityKey];

  if (mode === "buy" && !product?.buyActive) {
    setToast("خرید در حال حاضر فعال نیست.");
    return;
  }

  if (mode === "sell" && !product?.sellActive) {
    setToast("فروش در حال حاضر فعال نیست.");
    return;
  }

  
    const res = await api.createQuote(purityKey, mode);

  if (!res.ok) {
  const message =
    res.reason === "buy disabled"
      ? "خرید در حال حاضر فعال نیست."
      : res.reason === "sell disabled"
      ? "فروش در حال حاضر فعال نیست."
      : res.reason;

  return setToast(message);
}

  setQuote(res.quote);
  setWeight("");
  setCustomer({
  firstName: "",
  lastName: "",
  phone: "",
  province: "",
  city: "",
  address: "",
  postalCode: "",
});
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
  const canContinue =
  quote &&
  !quoteExpired &&
  !weightOutOfRange &&
  Number(weight) > 0 &&
  customer.firstName.trim() &&
  customer.lastName.trim() &&
  customer.phone.trim() &&
  (
    quote.mode === "sell" ||
    (
      customer.province &&
      customer.city &&
      customer.address.trim() &&
      /^\d{10}$/.test(customer.postalCode)
    )
  );
  const goToSummary = () => {
  if (!customer.firstName.trim()) {
    setToast("لطفاً نام را وارد کنید.");
    return;
  }

  if (!customer.lastName.trim()) {
    setToast("لطفاً نام خانوادگی را وارد کنید.");
    return;
  }

  if (!/^09\d{9}$/.test(customer.phone.trim())) {
    setToast("لطفاً شماره موبایل معتبر ۱۱ رقمی وارد کنید.");
    return;
  }

  if (quote.mode === "buy") {
  if (!customer.province) {
    setToast("لطفاً استان را انتخاب کنید.");
    return;
  }

  if (!customer.city) {
    setToast("لطفاً شهر را انتخاب کنید.");
    return;
  }

  if (!customer.address.trim()) {
    setToast("لطفاً آدرس کامل را وارد کنید.");
    return;
  }

  if (!/^\d{10}$/.test(customer.postalCode)) {
    setToast("لطفاً کد پستی ۱۰ رقمی را وارد کنید.");
    return;
  }
}

  if (!canContinue) return;

  setView("order-summary");
};

  const submitOrder = async () => {
  const expiresAtMs = quote ? new Date(quote.expiresAt).getTime() : 0;

  if (!quote || !Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
    setNow(Date.now());
    setToast("اعتبار قیمت تمام شده است. لطفاً قیمت جدید دریافت کنید.");
    return;
  }

  const res = await api.submitOrder(quote, weight, customer);

  if (!res.ok) {
    if (res.code === "quote_expired" || res.reason === "quote_expired") {
      setNow(Date.now());
      setToast("اعتبار قیمت تمام شده است. لطفاً قیمت جدید دریافت کنید.");
      return;
    }

    return setToast(res.reason);
  }

  setLastOrder(res.order);
  const pub = await api.getState();
  setSettings(pub.settings);
  setView(res.order.type === "buy" ? "buy-payment" : "sell-submitted");
};


    
  const attachReceipt = async (order, file) => {
  if (!file) return null;

  if (file.size > 5 * 1024 * 1024) {
    setUploadingReceiptId(order.id);
    setReceiptUploadStatus("error");
    setReceiptUploadProgress(0);
    setToast("حجم فایل نباید بیشتر از ۵ مگابایت باشد");

    setTimeout(() => {
      setUploadingReceiptId((id) =>
        id === order.id ? null : id
      );
      setReceiptUploadStatus("idle");
      setReceiptUploadProgress(0);
    }, 2500);

    return null;
  }

  // اول وضعیت آپلود را نمایش می‌دهیم
  setUploadingReceiptId(order.id);
  setReceiptUploadStatus("uploading");
  setReceiptUploadProgress(5);
  setToast("در حال ارسال رسید… لطفاً صفحه را نبندید.");

  // فرصت می‌دهیم React صفحه را رندر کند
  await new Promise((resolve) =>
    requestAnimationFrame(() => resolve())
  );

  let progressTimer = null;

  try {
    // پیشرفت نمایشی تا 90٪
    progressTimer = setInterval(() => {
      setReceiptUploadProgress((current) => {
        if (current >= 90) return current;

        const next =
          current + Math.floor(Math.random() * 3) + 1;

        return Math.min(next, 90);
      });
    }, 250);

    // شروع آپلود واقعی
    const res = await api.attachReceipt(order, file);

    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }

    if (!res.ok) {
      setReceiptUploadStatus("error");
      setToast(res.reason);
      setReceiptUploadProgress(0);

      setTimeout(() => {
        setUploadingReceiptId((id) =>
          id === order.id ? null : id
        );
        setReceiptUploadStatus("idle");
        setReceiptUploadProgress(0);
      }, 2500);

      return null;
    }

    // نمایش 100٪
    setReceiptUploadProgress(100);

    // حتماً 100٪ را قابل مشاهده می‌کنیم
    await new Promise((resolve) =>
      setTimeout(resolve, 1200)
    );

    setLastOrder(res.order);
    setReceiptUploadStatus("success");
    setToast("رسید با موفقیت ارسال شد");

    setTimeout(() => {
      setUploadingReceiptId((id) =>
        id === order.id ? null : id
      );
      setReceiptUploadStatus("idle");
      setReceiptUploadProgress(0);
    }, 2500);

    return res.order;

  } catch (e) {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }

    setReceiptUploadStatus("error");
    setReceiptUploadProgress(0);
    setToast("آپلود رسید ناموفق بود");

    setTimeout(() => {
      setUploadingReceiptId((id) =>
        id === order.id ? null : id
      );
      setReceiptUploadStatus("idle");
      setReceiptUploadProgress(0);
    }, 2500);

    return null;
  }
};

  const tryAdminLogin = async () => {
  setAdminError("");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: adminEmail.trim(),
      password: adminPw,
    });

    if (error || !data?.session) {
      setAdminError(
        error?.message || "ورود ناموفق بود"
      );
      return;
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError || !sessionData?.session) {
      setAdminError(
        sessionError?.message || "نشست کاربری ایجاد نشد"
      );
      return;
    }

    const { data: admin, error: adminError } =
      await supabase.rpc("is_admin");

    if (adminError) {
      console.error("Admin check failed:", adminError);
      setAdminError(
        adminError.message || "خطا در بررسی دسترسی مدیر"
      );
      return;
    }

    if (admin !== true) {
      await supabase.auth.signOut();
      setAdminError("این حساب دسترسی مدیریت ندارد");
      return;
    }

    setAdminPw("");
    setIsAdmin(true);
    setView("admin");
  } catch (error) {
    console.error("Admin login failed:", error);
    setAdminError(
      error?.message || "خطا در ورود به پنل مدیریت"
    );
  }
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
  <button
  className="icon-btn"
  onClick={() => setView("support")}
  aria-label="پشتیبانی"
>
  <Headphones size={16} />
</button>
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

        {view === "support" && (
  <Support
    settings={settings}
    onBack={() => setView("home")}
  />
)}
      
      </main>

      {toast && <div className="toast">{toast}</div>}
            {showPwaPrompt && (
        <PwaInstallPrompt
          onClose={() => {
            localStorage.setItem("meead-pwa-install-dismissed", "1");
            setShowPwaPrompt(false);
          }}
        />
      )}
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


function TwentyFourHourChartCard() {
  const [points, setPoints] = useState([]);
  const [status, setStatus] = useState("loading");
  const [lastDataAt, setLastDataAt] = useState(null);
  const [dataState, setDataState] = useState(null);
  const [errorText, setErrorText] = useState("");

  const parsePoints = (data) => {
    const source = Array.isArray(data?.points)
      ? data.points
      : Array.isArray(data?.data?.points)
        ? data.data.points
        : Array.isArray(data?.series)
          ? data.series
          : [];

    return source
      .map((point) => ({
        time: new Date(point?.t ?? point?.time ?? point?.timestamp ?? point?.d),
        price: Number(point?.p ?? point?.price ?? point?.close ?? point?.c),
      }))
      .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.time.getTime()))
      .sort((a, b) => a.time - b.time);
  };

  const requestIntraday = async (cacheBust = false) => {
    const url = cacheBust
      ? `/api/xau-24h?fresh=${Date.now()}`
      : "/api/xau-24h";

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
      return { response, data };
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const loadChart = useCallback(async () => {
    setStatus("loading");
    setErrorText("");

    try {
      let result = await requestIntraday(false);
      let normalized = parsePoints(result.data);

      if (normalized.length < 2) {
        result = await requestIntraday(true);
        normalized = parsePoints(result.data);
      }

      const data = result.data;
      setDataState(data?.data_state || null);

      if (normalized.length < 2) {
        setPoints([]);
        setLastDataAt(null);
        setErrorText(
          data?.error ||
          (data?.data_state?.status === "unavailable"
            ? "منبع داده XAUS فعلاً داده واقعی ندارد"
            : "داده کافی برای رسم نمودار دریافت نشد")
        );
        setStatus("unavailable");
        return;
      }

      setPoints(normalized);
      setLastDataAt(normalized[normalized.length - 1].time);
      setStatus("ready");
    } catch (error) {
      console.error("XAUS XAU/USD intraday chart error:", error);
      setPoints([]);
      setLastDataAt(null);
      setDataState(null);
      setErrorText(
        error?.name === "AbortError"
          ? "اتصال به منبع داده بیش از ۱۲ ثانیه طول کشید"
          : "اتصال به منبع داده XAU/USD برقرار نشد"
      );
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    loadChart();
    const timer = window.setInterval(loadChart, 120000);
    return () => window.clearInterval(timer);
  }, [loadChart]);

  const chart = (() => {
    if (points.length < 2) return null;

    const width = 640;
    const height = 150;
    const padX = 10;
    const padY = 12;
    const min = Math.min(...points.map((p) => p.price));
    const max = Math.max(...points.map((p) => p.price));
    const span = max - min || Math.max(Math.abs(max) * 0.0001, 0.01);
    const firstTime = points[0].time.getTime();
    const lastTime = points[points.length - 1].time.getTime();
    const timeSpan = lastTime - firstTime || 1;

    const coords = points.map((point) => {
      const x = padX + ((point.time.getTime() - firstTime) / timeSpan) * (width - padX * 2);
      const y = padY + ((max - point.price) / span) * (height - padY * 2);
      return { x, y };
    });

    const minIndex = points.reduce((best, point, index, arr) =>
      point.price < arr[best].price ? index : best, 0);
    const maxIndex = points.reduce((best, point, index, arr) =>
      point.price > arr[best].price ? index : best, 0);

    return {
      line: coords.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "),
      last: coords[coords.length - 1],
      min: { ...coords[minIndex], price: points[minIndex].price },
      max: { ...coords[maxIndex], price: points[maxIndex].price },
    };
  })();

  const latestPrice = points.length ? points[points.length - 1].price : null;
  const isStale = dataState?.status === "stale";

  const formatPrice = (value) =>
    Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatDataTime = (value) =>
    value ? value.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <section className="twenty-four-chart-card" dir="rtl" aria-label="نمودار ۲۴ ساعت گذشته انس جهانی طلا">
      <div className="twenty-four-chart-head">
        <div>
          <div className="twenty-four-chart-title">نمودار ۲۴ ساعت گذشته · XAU/USD</div>
          <div className="twenty-four-chart-subtitle">
            {latestPrice != null ? `آخرین قیمت: ${formatPrice(latestPrice)} دلار / اونس` : "انس جهانی طلا"}
          </div>
        </div>
        <div className="twenty-four-chart-badge">{isStale ? "داده قدیمی" : "XAU/USD"}</div>
      </div>

      <div className="twenty-four-chart-area">
        <div className="twenty-four-chart-grid"><span></span><span></span><span></span><span></span></div>

        {chart ? (
          <svg viewBox="0 0 640 150" preserveAspectRatio="none" style={{ position:"absolute", inset:"12px 12px 30px", width:"calc(100% - 24px)", height:"calc(100% - 42px)", overflow:"visible" }} role="img" aria-label="روند ۲۴ ساعت گذشته قیمت XAU/USD">
            <polyline points={chart.line} fill="none" stroke="#A9803A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={chart.last.x} cy={chart.last.y} r="4" fill="#A9803A" />
            <g fontFamily="Vazirmatn, sans-serif" fontSize="11" fontWeight="500" fill="#667085">
              <circle cx={chart.min.x} cy={chart.min.y} r="3" fill="#667085" />
              <text x={chart.min.x} y={Math.min(chart.min.y + 18, 148)} textAnchor="middle">
                {`کمترین: ${formatPrice(chart.min.price)}`}
              </text>
              <circle cx={chart.max.x} cy={chart.max.y} r="3" fill="#667085" />
              <text x={chart.max.x} y={Math.max(chart.max.y - 10, 10)} textAnchor="middle">
                {`بیشترین: ${formatPrice(chart.max.price)}`}
              </text>
            </g>
          </svg>
        ) : (
          <div className="twenty-four-chart-empty">
            <span className="twenty-four-chart-empty-icon">⌁</span>
            <span>
              {status === "loading" ? "در حال دریافت داده طلا…" : errorText || "در حال حاضر داده‌ای برای نمودار موجود نیست"}
            </span>
          </div>
        )}

        <div className="twenty-four-chart-axis"><span>۲۴ ساعت قبل</span><span>۱۲ ساعت قبل</span><span>اکنون</span></div>
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", gap:"10px", marginTop:"9px", fontSize:"10px", color:"#93A0AF" }}>
        <span>آخرین داده: {formatDataTime(lastDataAt)}</span>
        <span>{points.length ? `${points.length} نقطه` : "—"}</span>
      </div>
    </section>
  );
}

function Home({ settings, orders, closedByHours, marketBuyOpen, marketSellOpen, startQuote, setView }) {
  return (
    <div className="home">
      <MarketBanner closedByHours={closedByHours} market={settings.market} />

      <div className="update-row">
        <span>آخرین به‌روزرسانی قیمت</span>
        <span className="mono">{settings.lastPriceUpdate ? new Date(settings.lastPriceUpdate).toLocaleDateString("fa-IR") + " — " + new Date(settings.lastPriceUpdate).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
      </div>
      <div className="section-head">
        <span className="section-title">ساچمه نقره</span>
        
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
      <TwentyFourHourChartCard />
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
    setSearched(false);
    setResult(null);

    const normalizeDigits = (value) =>
      String(value || "")
        .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
        .trim();

    const normalizedCode = normalizeDigits(code);
    const normalizedPhone = normalizeDigits(phone);

    if (!normalizedCode || !normalizedPhone) {
      setSearched(true);
      return;
    }

    try {
      const found = await api.findOrder(normalizedCode, normalizedPhone);
      setResult(found);
    } catch (error) {
      console.error("Find order failed:", error);
      alert("خطای پیگیری سفارش:\n" + (error?.message || error));
    } finally {
      setSearched(true);
    }
  };



  return (
    <div className="panel">
      <button className="back-link" onClick={onBack}>
        <ChevronRight size={16} /> بازگشت
      </button>

      <h2 className="panel-title">پیگیری سفارش</h2>

      <label className="field">
        <span>کد رهگیری</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="SP-1058"
        />
      </label>

      <label className="field">
        <span>شماره تماس</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="09xxxxxxxxx"
        />
      </label>

      <button className="primary-btn" onClick={search}>
        جستجو
      </button>

      {searched && !result && (
        <p className="pay-note">
          سفارشی با این مشخصات پیدا نشد.
        </p>
      )}

      {result && (
        <div className="confirm-summary" style={{ marginTop: 10 }}>
          <div className="calc-row">
            <span>وضعیت</span>
            <span className="status-pill">{result.status}</span>
          </div>

          <div className="calc-row">
            <span>محصول</span>
            <span>
              {PRODUCTS.find((p) => p.key === result.purity)?.title}
            </span>
          </div>

          <div className="calc-row">
            <span>وزن</span>
            <span className="mono">{result.weight} گرم</span>
          </div>

          <div className="calc-row total">
            <span>مبلغ</span>
            <span className="mono">
              {toman(result.total ?? result.approxTotal)}
            </span>
          </div>

          <div className="timeline">
            {(Array.isArray(result.history) ? result.history : []).map(
              (h, i) => (
                <div className="timeline-row" key={i}>
                  <span className="mono">{fmtTime(h.time)}</span>
                  <span>{h.status}</span>
                </div>
              )
            )}
          </div>

          {result.type === "buy" &&
            result.status === "در انتظار پرداخت" && (
              <label
                className="upload-btn"
                style={{ marginTop: 10 }}
              >
                <Upload size={14} />
                آپلود رسید پرداخت

                <input
                  type="file"
                  accept="image/*,.pdf"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];

                    if (file) {
                      onAttachReceipt(result, file);
                    }

                    e.target.value = "";
                  }}
                />
              </label>
            )}
        </div>
      )}
    </div>
  );
}
        
/* -------------------------------- Order form ------------------------------- */

function Countdown({ expiresAt, now }) {
  const remain = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
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
  <label className="field">
    <span>نام</span>
    <input
      type="text"
      value={customer.firstName}
      onChange={(e) =>
        setCustomer({ ...customer, firstName: e.target.value })
      }
      placeholder="نام"
      disabled={expired}
    />
  </label>

  <label className="field">
    <span>نام خانوادگی</span>
    <input
      type="text"
      value={customer.lastName}
      onChange={(e) =>
        setCustomer({ ...customer, lastName: e.target.value })
      }
      placeholder="نام خانوادگی"
      disabled={expired}
    />
  </label>

  <label className="field">
    <span>شماره تلفن</span>
    <input
      type="tel"
      value={customer.phone}
      onChange={(e) =>
        setCustomer({ ...customer, phone: e.target.value })
      }
      placeholder="09xxxxxxxxx"
      disabled={expired}
    />
  </label>

{quote.mode === "buy" && (
  <>
    <label className="field">
      <span>استان</span>
      <select
        value={customer.province}
        onChange={(e) =>
          setCustomer({
            ...customer,
            province: e.target.value,
            city: "",
          })
        }
        disabled={expired}
      >
        <option value="">انتخاب استان</option>
        {Object.keys(iranLocations).map((province) => (
          <option key={province} value={province}>
            {province}
          </option>
        ))}
      </select>
    </label>

    <label className="field">
      <span>شهر</span>
      <select
        value={customer.city}
        onChange={(e) =>
          setCustomer({ ...customer, city: e.target.value })
        }
        disabled={expired || !customer.province}
      >
        <option value="">
          {customer.province ? "انتخاب شهر" : "ابتدا استان را انتخاب کنید"}
        </option>

        {customer.province &&
          iranLocations[customer.province]?.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
      </select>
    </label>
  </>
)}

      {quote.mode === "buy" && (
  <>
    <label className="field">
      <span>آدرس کامل</span>
      <input
        type="text"
        value={customer.address}
        onChange={(e) =>
          setCustomer({ ...customer, address: e.target.value })
        }
        placeholder="خیابان، کوچه، پلاک، واحد"
        disabled={expired}
      />
    </label>

    <label className="field">
      <span>کد پستی</span>
      <input
        type="tel"
        inputMode="numeric"
        maxLength={10}
        value={customer.postalCode}
        onChange={(e) =>
          setCustomer({
            ...customer,
            postalCode: e.target.value.replace(/\D/g, ""),
          })
        }
        placeholder="کد پستی ۱۰ رقمی"
        disabled={expired}
      />
    </label>
  </>
)}
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
        <div className="calc-row">
  <span>نام</span>
  <span>{customer.firstName}</span>
</div>

<div className="calc-row">
  <span>نام خانوادگی</span>
  <span>{customer.lastName}</span>
</div>

<div className="calc-row">
  <span>شماره تلفن</span>
  <span className="mono">{customer.phone}</span>
</div>

  {quote.mode === "buy" && (
  <>
    <div className="calc-row">
      <span>استان</span>
      <span>{customer.province}</span>
    </div>

    <div className="calc-row">
      <span>شهر</span>
      <span>{customer.city}</span>
    </div>

    <div className="calc-row">
      <span>آدرس کامل</span>
      <span>{customer.address}</span>
    </div>

    <div className="calc-row">
      <span>کد پستی</span>
      <span className="mono">{customer.postalCode}</span>
    </div>
  </>
)}
</div>
      {quote.mode === "sell" && (
        <div className="sell-warning">
          ⚠️ توجه: قیمت تعیین‌شده برای فروش حداکثر تا {sellValidityDays} روز معتبر است. لطفاً ساچمه را در این مدت به دست ما برسانید. پس از پایان این مدت، قیمت بر اساس شرایط و قیمت روز محاسبه خواهد شد.
        </div>
      )}

      {quote.mode === "buy" && (
        <div
          style={{
            marginTop: "12px",
            marginBottom: "12px",
            padding: "10px 12px",
            borderRadius: "10px",
            background: "#f5f1e8",
            border: "1px solid #d8cdb8",
            color: "#5f5545",
            fontSize: "13px",
            lineHeight: "1.8",
            display: "flex",
            alignItems: "flex-start",
            gap: "7px",
          }}
        >
          <span>💡</span>
          <span>
            <strong>نکته:</strong> در سفارش‌های کمتر از{" "}
            <strong>۱۰۰ گرم</strong>، هزینه ارسال بر عهده مشتری است.
          </span>
        </div>
      )}

      <button className="primary-btn" onClick={onConfirm} disabled={expired}>تأیید و ثبت نهایی سفارش</button>
    </div>
  );
}

/* ------------------------------- Buy payment ------------------------------- */



    function BuyPayment({ order, onAttachReceipt, onDone, setToast }) {
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const bank = order.bankSnapshot || {};

  const copy = async (val) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setToast("کپی خودکار ممکن نشد");
    }
  };

  const handleReceiptUpload = async (file) => {
    if (!file || uploading) return;

    if (file.size > 5 * 1024 * 1024) {
      setUploadError("حجم فایل نباید بیشتر از ۵ مگابایت باشد");
      return;
    }

    setUploading(true);
    setUploadSuccess(false);
    setUploadError("");
    setUploadProgress(5);

    let timer = null;

    try {
      timer = setInterval(() => {
        setUploadProgress((current) => {
          if (current >= 90) return current;

          const next =
            current + Math.floor(Math.random() * 4) + 1;

          return Math.min(next, 90);
        });
      }, 250);

      // آپلود واقعی
      const result = await onAttachReceipt(file);

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      if (!result) {
        setUploadError("آپلود رسید ناموفق بود");
        setUploadProgress(0);
        setUploading(false);
        return;
      }

      setUploadProgress(100);

      // اجازه می‌دهیم 100٪ دیده شود
      await new Promise((resolve) =>
        setTimeout(resolve, 1000)
      );

      setUploadSuccess(true);
      setUploading(false);

    } catch (e) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      setUploadError("آپلود رسید ناموفق بود");
      setUploadProgress(0);
      setUploading(false);
    }
  };

  return (
    <div className="panel confirm">
      <div className="confirm-icon">
        <CheckCircle2 size={38} />
      </div>

      <h2 className="panel-title">سفارش ثبت شد</h2>

      <span className="order-code mono">
        کد پیگیری: {order.id}
      </span>

      <div className="confirm-summary">
        <div className="calc-row">
          <span>محصول</span>
          <span>
            {PRODUCTS.find((p) => p.key === order.purity)?.title}
          </span>
        </div>

        <div className="calc-row">
          <span>وزن</span>
          <span className="mono">
            {order.weight} گرم
          </span>
        </div>

        <div className="calc-row total">
          <span>مبلغ قابل پرداخت</span>
          <span className="mono">
            {toman(order.total)}
          </span>
        </div>
      </div>

      <div className="pay-box">
        <span className="pay-label">
          اطلاعات واریز:
        </span>

        {bank.cardNumber && (
          <div className="card-number-row">
            <span className="mono card-number">
              {bank.cardNumber}
            </span>

            <button
              className="icon-btn"
              onClick={() => copy(bank.cardNumber)}
            >
              {copied ? (
                <Check size={16} />
              ) : (
                <Copy size={16} />
              )}
            </button>
          </div>
        )}

        {bank.sheba && (
          <div className="address-box mono">
            IR{bank.sheba}
          </div>
        )}

        {bank.ownerName && (
          <span className="pay-label">
            به نام: {bank.ownerName}
          </span>
        )}

        {!bank.cardNumber && !bank.sheba && (
          <p className="pay-note">
            اطلاعات پرداخت هنوز ثبت نشده — با فروشگاه تماس بگیرید.
          </p>
        )}

        {!uploading && !uploadSuccess && (
  <p className="pay-note">
    پس از واریز، تصویر رسید را آپلود کنید تا سفارش شما بررسی شود.
  </p>
)}

        {!uploading && !uploadSuccess && (