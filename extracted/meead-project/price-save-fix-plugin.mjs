export default function priceSaveFixPlugin() {
  return {
    name: "meead-price-save-fix",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/src/App.jsx")) return null;

      const oldUpdatePrices = /async updatePrices\(productsForm\) \{[\s\S]*?\n\s*\},\n\s*async updateMarket/;
      const newUpdatePrices = `async updatePrices(productsForm) {
    const pricePayload = Object.fromEntries(
      Object.entries(productsForm).map(([key, v]) => [key, {
        buyPrice: Number(v.buyPrice),
        sellPrice: Number(v.sellPrice)
      }])
    );

    const limitPayload = Object.fromEntries(
      Object.entries(productsForm).map(([key, v]) => [key, {
        minWeight: Number(v.minWeight),
        maxWeight: Number(v.maxWeight)
      }])
    );

    let r = await supabase.rpc("update_prices", {
      p_products: pricePayload
    });

    if (r.error || !r.data?.ok) {
      throw r.error || new Error(r.data?.reason || "ذخیره قیمت‌ها ناموفق بود");
    }

    r = await supabase.rpc("update_product_limits", {
      p_products: limitPayload
    });

    if (r.error || !r.data?.ok) {
      throw r.error || new Error(r.data?.reason || "ذخیره محدوده وزن ناموفق بود");
    }

    const savedProducts = Object.fromEntries(
      PRODUCTS.map((p) => {
        const v = productsForm[p.key] || {};
        return [p.key, {
          ...v,
          buyPrice: Number(v.buyPrice),
          sellPrice: Number(v.sellPrice),
          minWeight: Number(v.minWeight),
          maxWeight: Number(v.maxWeight),
          buyActive: !!v.buyActive,
          sellActive: !!v.sellActive,
          priceHistory: Array.isArray(v.priceHistory) ? v.priceHistory : []
        }];
      })
    );

    return mergeSettings({
      products: savedProducts,
      lastPriceUpdate: new Date().toISOString()
    });
  },
  async updateMarket`;

      let next = code.replace(oldUpdatePrices, newUpdatePrices);

      const oldSave = `const save = async () => {
    const nextSettings = await api.updatePrices(form);
    setSettings(nextSettings);
    setToast("تنظیمات قیمت ذخیره شد");
  };`;
      const newSave = `const save = async () => {
    try {
      const nextSettings = await api.updatePrices(form);
      setSettings(nextSettings);
      setToast("تنظیمات قیمت ذخیره شد");
    } catch (error) {
      console.error("Price save failed:", error);
      setToast(error?.message || "ذخیره تنظیمات قیمت ناموفق بود");
    }
  };`;

      next = next.replace(oldSave, newSave);

      if (next === code) {
        throw new Error("Meead price-save fix: target code was not found");
      }

      return { code: next, map: null };
    }
  };
}
