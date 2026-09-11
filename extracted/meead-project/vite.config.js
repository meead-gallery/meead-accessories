import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import restoreBackupPlugin from "./restore-backup-plugin.mjs";
import liveMetalsWidgetPlugin from "./live-metals-widget-plugin.mjs";

export default defineConfig({
  plugins: [react(), restoreBackupPlugin(), liveMetalsWidgetPlugin()],
  server: {
    port: 5173,
  },
});
