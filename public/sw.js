// App-shell cache for instant startup. Media & API calls always go to the network.
const V = 'aurora-v1';
const SHELL = ['/', '/css/app.css', '/vendor/hls.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // network-first for app code so updates land immediately, cache fallback for offline start
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
