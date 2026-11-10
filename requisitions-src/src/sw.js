// Pump Group requisitions: keeps the app's own files on the device, so the app opens without a signal.
// Requisitions, photos and documents never pass through here: they come from the server with the signed-in
// person's access. This worker looks after its own folder only (the site board has its own).
const BUILD = '__BUILD__';
const SHELL = __SHELL__;
const LATER = __LATER__;   // kept the first time they are used (the spreadsheet tool)
const CACHE = 'pg-rq-shell-' + BUILD;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pg-rq-shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
const offlinePage = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Requisitions</title><body style="font:16px system-ui,sans-serif;padding:24px;color:#1F2A37">No connection. Open Requisitions again when the phone has signal.</body>',
  {status: 503, headers: {'content-type': 'text/html; charset=utf-8'}});
// the page itself: from the network first, so a new version shows at once; the saved copy when there is no signal
// or the signal is too weak to answer within a few seconds
async function page(req){
  const cache = await caches.open(CACHE), key = self.registration.scope;
  const net = fetch(req).then(res => { if (res.ok) cache.put(key, res.clone()).catch(() => {}); return res; });
  const saved = await cache.match(key);
  if (!saved) return net.catch(offlinePage);
  return Promise.race([net.catch(() => saved), new Promise(r => setTimeout(() => r(saved.clone()), 3500))]);
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url), scope = self.registration.scope;
  if (url.origin !== location.origin || !url.href.startsWith(scope)) return;
  const rel = url.href.slice(scope.length).split('#')[0];
  if (req.mode === 'navigate' || rel === '' || rel.startsWith('index.html')) { e.respondWith(page(req)); return; }
  // the app's files carry their version in the address, so a saved copy is always the right one
  e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && (SHELL.includes(rel) || LATER.includes(rel))) c.put(req, res.clone()).catch(() => {});
    return res;
  }))));
});
