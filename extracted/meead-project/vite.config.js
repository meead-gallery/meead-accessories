import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import restoreBackupPlugin from "./restore-backup-plugin.mjs";

export default defineConfig({
  plugins: [react(), restoreBackupPlugin()],
  server: {
    port: 5173,
  },
});
