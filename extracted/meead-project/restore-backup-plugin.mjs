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
    const normalizedWeight = normalizeDigits(weight);
    const normalizedCustomer = {
      ...customer,
      phone: normalizeDigits(customer.phone),
      postalCode: normalizeDigits(customer.postalCode),
    };

    const payload = {
      p_quote: quote,
      p_weight: Number(normalizedWeight),
      p_first_name: normalizedCustomer.firstName,
      p_last_name: normalizedCustomer.lastName,
      p_phone: normalizedCustomer.phone,
      p_address: normalizedCustomer.address,
      p_province: normalizedCustomer.province,
      p_city: normalizedCustomer.city,
      p_postal_code: normalizedCustomer.postalCode,
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

      // Accept Persian and Arabic-Indic digits in phone, postal code and weight.
      const normalizeHelper = `function normalizeDigits(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}\n\n`;
      if (!next.includes("function normalizeDigits(value)")) {
        next = normalizeHelper + next;
        changed = true;
      }

      const replacements = [
        [
          'const total = quote ? Math.round((Number(weight) || 0) * quote.pricePerGram) : 0;',
          'const normalizedWeight = normalizeDigits(weight);\n  const normalizedPhone = normalizeDigits(customer.phone);\n  const normalizedPostalCode = normalizeDigits(customer.postalCode);\n  const total = quote ? Math.round((Number(normalizedWeight) || 0) * quote.pricePerGram) : 0;'
        ],
        [
          'const weightOutOfRange = quote && product && weight && (Number(weight) < product.minWeight || Number(weight) > product.maxWeight);',
          'const weightOutOfRange = quote && product && normalizedWeight && (Number(normalizedWeight) < product.minWeight || Number(normalizedWeight) > product.maxWeight);'
        ],
        ['Number(weight) > 0', 'Number(normalizedWeight) > 0'],
        ['customer.phone.trim()', 'normalizedPhone.trim()'],
        ['/^\\d{10}$/.test(customer.postalCode)', '/^\\d{10}$/.test(normalizedPostalCode)'],
      ];

      for (const [from, to] of replacements) {
        if (next.includes(from)) {
          next = next.replace(from, to);
          changed = true;
        }
      }

      return changed ? { code: next, map: null } : null;
    },
  };
}
