/* Shell only. Hashed bundles can be kept. The page, API, and socket always come from the network. */
const CACHE = "uhoh-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // A cache from an older visit means this install is a deploy, not the first one.
        self.__hadShell = keys.includes(CACHE);
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
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
      if (!self.__hadShell) return;
      // An open phone is still running the previous bundle. Reload it onto this one
      // only when the new page can be fetched, so a dead network keeps the offline shell.
      let fresh = null;
      try {
        fresh = await fetch("/index.html", { cache: "no-store" });
      } catch {
        fresh = null;
      }
      if (!fresh?.ok) return;
      const cache = await caches.open(CACHE);
      await cache.put("/index.html", fresh.clone());
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(windows.map((client) => (client.navigate ? client.navigate(client.url) : Promise.resolve())));
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
