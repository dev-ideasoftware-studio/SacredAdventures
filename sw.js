/**
 * Sacred Adventures — Service Worker: DISABLED / SELF-DESTRUCT.
 * ============================================================
 * User directive: NO caching for this app. The previous cache-first worker
 * masked every fresh edit and forced hard-reload chases.
 *
 * This replaces it with a kill-switch. The browser re-fetches `sw.js` from
 * the NETWORK on every navigation's update check (the SW script is exempt
 * from the SW cache), so this propagates to ALL existing/stuck clients
 * automatically. On activate it: deletes every cache, unregisters itself,
 * and reloads controlled pages so they drop to plain network — fresh forever.
 *
 * There is intentionally NO fetch handler, so the browser uses the normal
 * network for every request (zero caching).
 */
self.addEventListener("install", () => {
  // Take over immediately so the cleanup runs without waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1) Nuke every cache this origin ever created.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (_) {}
      // 2) Unregister this worker so it never controls a page again.
      try {
        await self.registration.unregister();
      } catch (_) {}
      // NOTE: intentionally NO client.navigate()/reload here. Forcing a reload
      // on activate caused a double-load / reload loop on mobile (Chrome showed
      // the loader twice; Opera looped). The worker is now unregistered + caches
      // cleared; the page's CURRENT load continues and the NEXT navigation is
      // already SW-free and fresh. No forced reload = no loop.
    })()
  );
});

// No "fetch" listener on purpose — all requests go straight to the network.
