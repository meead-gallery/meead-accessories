import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import restoreBackupPlugin from "./restore-backup-plugin.mjs";
import liveMetalsWidgetPlugin from "./live-metals-widget-plugin.mjs";
import priceSaveFixPlugin from "./price-save-fix-plugin.mjs";

export default defineConfig({
  plugins: [react(), restoreBackupPlugin(), liveMetalsWidgetPlugin(), priceSaveFixPlugin()],
  server: {
    port: 5173,
  },
});
