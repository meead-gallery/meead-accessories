const CACHE_NAME = "meead-accessories-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      return new Response("Network error", {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    })
  );
});
