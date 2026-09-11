import path from "node:path";

export default function restoreBackupPlugin() {
  return {
    name: "meead-restore-backup-fix",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(path.join("src", "App.jsx"))) return null;

      let next = code;
      let changed = false;

      const restoreStart = next.indexOf("  async restoreBackup(data) {");
      if (restoreStart !== -1) {
        const restoreEnd = next.indexOf("\n  },\n};", restoreStart);
        if (restoreEnd !== -1) {
          const replacement = `  async restoreBackup(data) {
    if (!data?.settings || !Array.isArray(data?.orders) || !Array.isArray(data?.log)) {
      throw new Error("نسخه پشتیبان نامعتبر است");
    }

    const { data: result, error } = await supabase.rpc("restore_backup", {
      p_backup: data,
    });

    if (error || !result?.ok) {
      throw error || new Error(result?.reason || "بازیابی نسخه پشتیبان ناموفق بود");
    }

    return await adminState();
  }`;
          next = next.slice(0, restoreStart) + replacement + next.slice(restoreEnd + "\n  },".length);
          changed = true;
        }
      }

      const submitStart = next.indexOf("  async submitOrder(quote, weight, customer) {");
      if (submitStart !== -1) {
        const submitEnd = next.indexOf("\n  },\n  async ", submitStart);
        if (submitEnd !== -1) {
          const replacement = `  async submitOrder(quote, weight, customer) {
    const payload = {
      p_quote: quote,
      p_weight: Number(weight),
      p_first_name: customer.firstName,
      p_last_name: customer.lastName,
      p_phone: customer.phone,
      p_address: customer.address,
      p_province: customer.province,
      p_city: customer.city,
      p_postal_code: customer.postalCode,
    };

    const { data, error } = await supabase.rpc("submit_order", payload);

    if (error || !data?.ok) {
      const recovery = await supabase.rpc("recover_order_by_quote", { p_quote: quote }).catch(() => ({ data: null }));
      if (recovery?.data?.ok && recovery.data.order) {
        const order = mapOrder(recovery.data.order, []);
        return { ok: true, order, orders: [], settings: mapSettings({}) };
      }
      return { ok: false, reason: data?.reason || error?.message || "ثبت سفارش ناموفق بود" };
    }

    const row = data.order || data;
    const order = mapOrder(row, []);
    return { ok: true, order, orders: [], settings: mapSettings({}) };
  },`;
          next = next.slice(0, submitStart) + replacement + next.slice(submitEnd + "\n  },".length);
          changed = true;
        }
      }

      const uiStart = next.indexOf("  const submitOrder = async () => {");
      if (uiStart !== -1) {
        const uiEnd = next.indexOf("\n\n    \n  const attachReceipt", uiStart);
        if (uiEnd !== -1) {
          const replacement = `  const submitOrder = async () => {
  const expiresAtMs = quote ? new Date(quote.expiresAt).getTime() : 0;

  if (!quote || !Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
    setNow(Date.now());
    setToast("اعتبار قیمت تمام شده است. لطفاً قیمت جدید دریافت کنید.");
    return;
  }

  try {
    const res = await api.submitOrder(quote, weight, customer);

    if (!res.ok) {
      if (res.code === "quote_expired" || res.reason === "quote_expired") {
        setNow(Date.now());
        setToast("اعتبار قیمت تمام شده است. لطفاً قیمت جدید دریافت کنید.");
        return;
      }
      setToast(res.reason || "ثبت سفارش ناموفق بود");
      return;
    }

    setLastOrder(res.order);
    setView(res.order.type === "buy" ? "buy-payment" : "sell-submitted");

    try {
      const pub = await api.getState();
      setSettings(pub.settings);
    } catch (e) {
      console.warn("Public settings refresh after order failed:", e);
    }
  } catch (e) {
    try {
      const recovery = await supabase.rpc("recover_order_by_quote", { p_quote: quote });
      if (recovery?.data?.ok && recovery.data.order) {
        const order = mapOrder(recovery.data.order, []);
        setLastOrder(order);
        setView(order.type === "buy" ? "buy-payment" : "sell-submitted");
        return;
      }
    } catch (recoveryError) {
      console.warn("Order recovery failed:", recoveryError);
    }
    setToast(e?.message || "ثبت سفارش ناموفق بود");
  }
};`;
          next = next.slice(0, uiStart) + replacement + next.slice(uiEnd);
          changed = true;
        }
      }

      return changed ? { code: next, map: null } : null;
    },
  };
}
