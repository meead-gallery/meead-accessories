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
      return null;
    },
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