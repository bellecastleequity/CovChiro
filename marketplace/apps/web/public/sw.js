/* CoverageOnCall service worker: phone notifications. Pushes arrive empty; we fetch the newest
   unread notification for the signed-in person and show it. Tapping opens its link. */
const OFFLINE = "/offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("cm-offline-v1").then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

// Pages load from the network as usual; only when there's no connection do we show the offline screen.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE)) || Response.error()));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let n = null;
      try {
        const r = await fetch("/api/notifications/latest", { credentials: "include", cache: "no-store" });
        if (r.ok) n = (await r.json()).notification;
      } catch (e) {}
      const title = (n && n.title) || "CoverageOnCall";
      await self.registration.showNotification(title, {
        body: (n && n.body) || "You have a new update.",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: (n && n.link) || "coverageoncall",
        renotify: true,
        data: { url: (n && n.link) || "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          await c.focus();
          if ("navigate" in c) return c.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
