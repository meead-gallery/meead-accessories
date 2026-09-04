/**
 * Development-only shim for `window.storage`.
 *
 * The app's data layer (see `store` inside src/App.jsx) was written against
 * `window.storage.get/set(key, value, shared)` — the key-value API available
 * inside Claude Artifacts. That API does not exist in a normal browser or a
 * plain Vite/CRA build, so this shim backs it with localStorage purely so the
 * app can run and be clicked through locally.
 *
 * This is NOT a real backend and is NOT multi-user (the `shared` flag is
 * ignored — everything is just local to the current browser). It exists only
 * so `npm run dev` works out of the box. Replace the internals of `store` in
 * src/App.jsx with real `fetch()` calls to your API once a backend exists —
 * see TECHNICAL_ARCHITECTURE.md for the exact endpoint list.
 */
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      const raw = localStorage.getItem(`meead:${key}`);
      if (raw === null) return null;
      return { key, value: raw, shared: false };
    },
    async set(key, value) {
      localStorage.setItem(`meead:${key}`, value);
      return { key, value, shared: false };
    },
    async delete(key) {
      const existed = localStorage.getItem(`meead:${key}`) !== null;
      localStorage.removeItem(`meead:${key}`);
      return { key, deleted: existed, shared: false };
    },
    async list(prefix = "") {
      const keys = Object.keys(localStorage)
        .filter((k) => k.startsWith(`meead:${prefix}`))
        .map((k) => k.replace("meead:", ""));
      return { keys, prefix, shared: false };
    },
  };
}
