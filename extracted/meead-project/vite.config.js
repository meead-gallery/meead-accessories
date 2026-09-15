import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import restoreBackupPlugin from "./restore-backup-plugin.mjs";
import liveMetalsWidgetPlugin from "./live-metals-widget-plugin.mjs";

function priceSaveSessionPlugin() {
  return {
    name: "meead-price-save-session",
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

    const sessionResult = await supabase.auth.refreshSession();
    if (sessionResult.error) throw sessionResult.error;
    if (!sessionResult.data?.session) {
      throw new Error("نشست مدیریت منقضی شده است؛ دوباره وارد پنل شوید");
    }

    let r = await supabase.rpc("update_prices", {
      p_products: pricePayload
    });

    if (r.error || !r.data?.ok) {
      throw r.error || new Error(
        r.data?.reason || "ذخیره قیمت‌ها ناموفق بود"
      );
    }

    r = await supabase.rpc("update_product_limits", {
      p_products: limitPayload
    });

    if (r.error || !r.data?.ok) {
      throw r.error || new Error(
        r.data?.reason || "ذخیره محدوده وزن ناموفق بود"
      );
    }

    const publicData = await publicSettings();
    return mapSettings(publicData);
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
      const pricePayload = Object.fromEntries(
        Object.entries(form).map(([key, v]) => [key, {
          buyPrice: Number(v.buyPrice),
          sellPrice: Number(v.sellPrice)
        }])
      );

      const limitPayload = Object.fromEntries(
        Object.entries(form).map(([key, v]) => [key, {
          minWeight: Number(v.minWeight),
          maxWeight: Number(v.maxWeight)
        }])
      );

      const sessionResult = await supabase.auth.refreshSession();
      if (sessionResult.error) throw sessionResult.error;
      if (!sessionResult.data?.session) {
        throw new Error("نشست مدیریت منقضی شده است؛ دوباره وارد پنل شوید");
      }

      let result = await supabase.rpc("update_prices", {
        p_products: pricePayload
      });

      if (result.error || !result.data?.ok) {
        throw result.error || new Error(
          result.data?.reason || "ذخیره قیمت‌ها ناموفق بود"
        );
      }

      result = await supabase.rpc("update_product_limits", {
        p_products: limitPayload
      });

      if (result.error || !result.data?.ok) {
        throw result.error || new Error(
          result.data?.reason || "ذخیره محدوده وزن ناموفق بود"
        );
      }

      const publicData = await publicSettings();
      const nextSettings = mapSettings(publicData);
      setSettings(nextSettings);
      setForm(nextSettings.products);
      setToast("تنظیمات قیمت ذخیره شد");
    } catch (error) {
      console.error("Price save failed:", error);
      setToast(error?.message || "ذخیره تنظیمات قیمت ناموفق بود");
    }
  };`;

      next = next.replace(oldSave, newSave);

      if (next === code) {
        throw new Error("Meead price-save-session: target code was not found");
      }

      return { code: next, map: null };
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    restoreBackupPlugin(),
    liveMetalsWidgetPlugin(),
    priceSaveSessionPlugin(),
  ],
  server: {
    port: 5173,
  },
});