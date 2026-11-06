/* Shell only. The cache name carries the build, so every deploy is a new worker. */
const CACHE = "uhoh-shell-__BUILD_SHA__";
const SHELL = "uhoh-shell-";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // Any earlier shell means this install is a deploy, not the first visit.
        self.__previous = keys.filter((key) => key.startsWith(SHELL) && key !== CACHE);
        return caches.open(CACHE);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const previous = Array.isArray(self.__previous) ? self.__previous : [];
      let fresh = null;
      if (previous.length > 0) {
        try {
          fresh = await fetch("/index.html", { cache: "no-store" });
        } catch {
          fresh = null;
        }
      }
      const cache = await caches.open(CACHE);
      if (fresh?.ok) {
        await cache.put("/index.html", fresh.clone());
        // The new page names new files. Drop the previous build's hashed assets.
        await Promise.all(previous.map((key) => caches.delete(key)));
        await self.clients.claim();
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        await Promise.all(windows.map((client) => (client.navigate ? client.navigate(client.url) : Promise.resolve())));
        return;
      }
      if (previous.length > 0) {
        // The new page could not be fetched. Keep the shell this phone already has.
        for (const key of previous) {
          const old = await caches.open(key);
          const requests = await old.keys();
          for (const request of requests) {
            const hit = await old.match(request);
            if (hit) await cache.put(request, hit);
          }
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(pathname) {
  return pathname.startsWith("/assets/") || pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.get("upgrade") === "websocket") return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws") ||
    url.pathname === "/health" ||
    url.pathname === "/config.js"
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          // A 502 during a deploy must not replace the saved page, and must not be what the phone plays.
          if (!response.ok) {
            return caches.match("/index.html").then((cached) => cached ?? response);
          }
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy)).catch(() => undefined);
          return response;
        })
        .catch(() =>
          caches.match("/index.html").then((cached) => cached ?? new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } })),
        ),
    );
    return;
  }

  if (!isStaticAsset(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      });
    }),
  );
});
