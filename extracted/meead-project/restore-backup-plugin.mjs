import path from "node:path";

export default function restoreBackupPlugin() {
  return {
    name: "meead-restore-backup-fix",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(path.join("src", "App.jsx"))) return null;

      const start = code.indexOf("  async restoreBackup(data) {");
      if (start === -1) return null;

      const end = code.indexOf("\n  },\n};", start);
      if (end === -1) return null;

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

      const next = code.slice(0, start) + replacement + code.slice(end + "\n  },".length);
      return { code: next, map: null };
    },
  };
}
