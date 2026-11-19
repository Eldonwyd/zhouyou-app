/* Cache the app shell and national map after the first online visit. Province
 * maps are cached only when the user presses the explicit region-cache button.
 */
const SHELL_CACHE = 'travel-shell-v5';
const REGION_CACHE = 'travel-region-maps-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const indexResponse = await fetch('./index.html');
    const html = await indexResponse.clone().text();
    await cache.put('./index.html', indexResponse);
    await cache.add('./maps/china.json');
    // The build writes every hashed chunk, including pages loaded on demand.
    // Development mode lacks precache.json, so use the initial page assets.
    let assetPaths;
    try {
      const manifestResponse = await fetch('./precache.json');
      if (!manifestResponse.ok) throw new Error('No precache manifest');
      assetPaths = await manifestResponse.json();
    } catch {
      assetPaths = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((match) => match[1]);
    }
    await Promise.all(assetPaths.map((assetPath) => cache.add(assetPath)));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('travel-shell-') && key !== SHELL_CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // AI replies and status must always reach the local API, never a stale shell.
  if (url.pathname.includes('/api/planner/')) return;
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/\/maps\/\d{6}\.json$/.test(url.pathname)) {
    event.respondWith(caches.open(REGION_CACHE).then(async (cache) => (await cache.match(request, { ignoreVary: true })) || fetch(request)));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html'))));
    return;
  }
  // Vite's crossorigin module requests carry an Origin header that differs
  // from cache.add()'s request. Ignore Vary here so the precached JS and CSS
  // remain usable when the browser goes offline.
  event.respondWith(caches.match(request, { ignoreVary: true }).then(async (cached) => {
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  }));
});
