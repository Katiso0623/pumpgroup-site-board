// Pump Group site board: keeps the app's own files on the device, and opens photos and documents (the _blob/<id>
// links) with the signed-in person's access. Data always comes live from the server after sign-in.
const BUILD = "964a10ea68";
const SHELL = ["", "index.html", "app.js?v=c07ff0f93a", "config.js?v=d9f60a0b7f", "logo.png", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png", "vendor/three.min.js?v=9274bbcec8", "vendor/OrbitControls.js?v=02bb4ade71", "vendor/xlsx.full.min.js?v=c9506197ca", "vendor/jszip.min.js?v=acc7e41455", "vendor/supabase.js?v=8596965fe9"];
const SHELL_CACHE = 'pg-sb-shell-' + BUILD;
// one store of saved files per person and access level, so a shared phone never shows one person's files to the
// next, and a person whose access is lowered starts again from what the server lets them open
const filesCache = (uid, lvl) => 'pg-sb-files-' + String(uid || 'none').replace(/[^0-9a-f-]/gi, '') + '-' + (lvl | 0);
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm)|application\/pdf|text\/plain|text\/csv)$/;
const DOWNLOAD_ONLY = /^(application\/(vnd\.openxmlformats-officedocument\.[a-z.]+|msword|vnd\.ms-excel|vnd\.ms-project|zip|x-zip-compressed|json))$/;

let TOKEN = null, EXP = 0, API = null, UID = null, LVL = 0;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pg-sb-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'token') { if (m.uid !== UID || (m.level | 0) !== LVL) CHECKED.clear(); TOKEN = m.token || null; EXP = m.exp || 0; UID = m.uid || null; LVL = m.level | 0; API = m.api || API; }
  if (m.type === 'signout') { CHECKED.clear(); TOKEN = null; EXP = 0; UID = null; LVL = 0; e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('pg-sb-files')).map(k => caches.delete(k))))); }
});

function ask(client){
  return new Promise(res => {
    const ch = new MessageChannel(), t = setTimeout(() => res(null), 3000);
    ch.port1.onmessage = ev => { clearTimeout(t); res(ev.data); };
    try { client.postMessage({type: 'need-token'}, [ch.port2]); } catch (x) { clearTimeout(t); res(null); }
  });
}
async function token(){
  if (TOKEN && API && Date.now() < EXP * 1000 - 30000) return TOKEN;
  const cs = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
  for (const c of cs) {
    const m = await ask(c);
    if (m && m.token) { if (m.uid !== UID || (m.level | 0) !== LVL) CHECKED.clear(); TOKEN = m.token; EXP = m.exp || 0; UID = m.uid || null; LVL = m.level | 0; API = m.api || API; return TOKEN; }
  }
  return null;
}
const note = (status, text) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Site board file</title><body style="font:16px system-ui,sans-serif;padding:24px;color:#1F2A37">${text}</body>`,
  {status, headers: {'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff'}});

function headersFor(raw, id){
  const h = new Headers({'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'accept-ranges': 'bytes'});
  if (INLINE.test(raw)) {
    h.set('content-type', raw.startsWith('text/') ? raw + '; charset=utf-8' : raw);
    if (raw !== 'application/pdf') h.set('content-security-policy', "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'");
  } else {
    h.set('content-type', DOWNLOAD_ONLY.test(raw) ? raw : 'application/octet-stream');
    h.set('content-disposition', `attachment; filename="site-board-${id}"`);
    h.set('content-security-policy', "sandbox; default-src 'none'");
  }
  return h;
}
// the whole file, or the part asked for: video players (Safari on every iPhone) ask for parts and need a 206 answer
async function safe(res, id, range){
  const raw = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const h = headersFor(raw, id);
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (!m[1] && !m[2])) return new Response(res.body, {status: 200, headers: h});
  const body = await res.blob(), size = body.size;
  let start, end;
  if (m[1]) { start = +m[1]; end = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
  else { start = Math.max(0, size - +m[2]); end = size - 1; }
  if (!(start <= end) || start >= size) { h.set('content-range', `bytes */${size}`); return new Response(null, {status: 416, headers: h}); }
  h.set('content-range', `bytes ${start}-${end}/${size}`); h.set('content-length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), {status: 206, headers: h});
}
const objUrl = id => `${API.url}/storage/v1/object/authenticated/${API.bucket}/a/${id}`;
// never through the browser's own cache: what a file answers must always come from the server, with this sign-in
const getObj = (id, t, extra) => fetch(objUrl(id), {cache: 'no-store', headers: {Authorization: 'Bearer ' + t, apikey: API.anon, ...(extra || {})}});
const CHECKED = new Map();   // file id -> when the server last said this person may still open it
async function stillAllowed(id, t){
  // a quick question to the server before a saved copy is shown (at most every 10 minutes for each file):
  // true, false (no longer allowed), or null (no answer, so the saved copy is shown)
  const at = CHECKED.get(id);
  if (at && Date.now() - at < 600000) return true;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(objUrl(id), {cache: 'no-store', signal: ctl.signal, headers: {Authorization: 'Bearer ' + t, apikey: API.anon, Range: 'bytes=0-0'}});
    clearTimeout(timer);
    try { await r.body?.cancel(); } catch (e) {}
    if (r.ok) { CHECKED.set(id, Date.now()); return true; }
    return [400, 401, 403, 404].includes(r.status) ? false : null;
  } catch (e) { return null; }
}

async function blob(id, range){
  // signed in first, even for a file saved on this device
  const t = await token();
  if (!t || !API || !UID) return note(401, 'Open the Pump Group site board and sign in, then try this link again.');
  const key = new Request(self.registration.scope + '_blob/' + id);
  const cache = LVL ? await caches.open(filesCache(UID, LVL)) : null;
  const hit = cache ? await cache.match(key) : null;
  if (hit) {
    const ok = await stillAllowed(id, t);
    if (ok === false) { await cache.delete(key); return note(404, 'This file is not available to you, or it is no longer on the site board.'); }
    return safe(hit, id, range);   // allowed, or no signal: the saved copy
  }
  let r;
  try { r = await getObj(id, t); }
  catch (e) { return note(503, 'No connection. This file opens when the phone has signal again.'); }
  if (!r.ok) return note(r.status === 400 || r.status === 404 ? 404 : r.status, 'This file is not available to you, or it is no longer on the site board.');
  const body = await r.blob();
  const keep = new Response(body, {headers: {'content-type': r.headers.get('content-type') || body.type || 'application/octet-stream'}});
  if (cache && body.size < 25 * 1024 * 1024) { try { await cache.put(key, keep.clone()); } catch (e) {} }
  return safe(keep, id, range);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.href.startsWith(self.registration.scope)) return;
  const m = url.pathname.match(/\/_blob\/([0-9a-f]{32})$/i);
  if (m) { e.respondWith(blob(m[1].toLowerCase(), req.headers.get('range'))); return; }
  const rel = url.href.slice(self.registration.scope.length).split('#')[0];
  // the page itself: network first, so a new version shows at once; the saved copy when there is no signal
  if (req.mode === 'navigate' || rel === '' || rel.startsWith('index.html')) {
    e.respondWith(fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(SHELL_CACHE).then(x => x.put(self.registration.scope, c)); } return res; })
      .catch(() => caches.match(self.registration.scope).then(r => r || caches.match('index.html'))));
    return;
  }
  // the app's files carry their version in the address, so a saved copy is always the right one
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && SHELL.includes(rel)) { const c = res.clone(); caches.open(SHELL_CACHE).then(x => x.put(req, c)); }
    return res;
  })));
});
