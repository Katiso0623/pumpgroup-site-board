// Pump Group requisitions: small helpers, the connection to the Pump Group database (the same sign-in and team as
// the site board) and the records this app keeps there:
//   rq/<id>          a requisition with its lines, files, orders, deliveries and messages (the site team and the office)
//   rq_office/<id>   the directors' decisions on it (only directors can write)
//   costs/<id>       the site board's cost ledger: order values, invoices and payments (directors only)
//   budget/rq.<id>   the estimated rates of a requisition's lines (directors only)
const CFG = window.PG_CONFIG || {};
const BUCKET = CFG.bucket || 'site-board';
const AUTH_KEY = CFG.storageKey || 'pg-site-board-auth';
const APP_NAME = 'Requisitions';
const SITE_NAME = 'Mashaeng WWTW';
const CONTRACT = 'Contract TS 004/2026';
const CONTRACT_LONG = 'Contract TS 004/2026 - Upgrading of Mashaeng WWTW';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
const money = (n, dash) => (n == null || n === '' || !isFinite(n)) ? (dash == null ? '–' : dash) : 'R ' + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const moneyK = n => { n = Number(n) || 0; return Math.abs(n) >= 1e6 ? 'R ' + (n / 1e6).toFixed(2) + 'm' : Math.abs(n) >= 10000 ? 'R ' + Math.round(n / 1000) + 'k' : 'R ' + Math.round(n).toLocaleString('en-US'); };
const qfmt = n => (n == null || n === '' || !isFinite(n)) ? 'TBC' : Number(n).toLocaleString('en-US', {maximumFractionDigits: 3});
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
const pad2 = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const today = () => isoOf(new Date());
const nowISO = () => new Date().toISOString();
const parseISO = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Tue 10 Nov" (the year only when it is not this year, or when asked)
const dfmt = (s, yr) => { const d = parseISO(s); if (!d) return ''; return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + (yr || d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''); };
const dlong = s => { const d = parseISO(s); return d ? d.getDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getFullYear() : ''; };
const daysTo = s => { const d = parseISO(s); if (!d) return null; return Math.round((d - parseISO(today())) / 86400000); };
const rel = s => { const n = daysTo(s); if (n == null) return ''; return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? 'in ' + n + ' days' : -n + ' days ago'; };
const addDays = (s, n) => { const d = parseISO(s) || new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
const tfmt = iso => { const d = new Date(iso); if (isNaN(d)) return ''; return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const ago = iso => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : tfmt(iso); };
const newKey = (n = 12) => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', b = crypto.getRandomValues(new Uint8Array(n)); return Array.from(b, x => a[x % 62]).join(''); };
const live = o => Object.entries(o || {}).filter(([, v]) => v && typeof v === 'object' && !v.x);   // entries not removed or cancelled
const byAt = (a, b) => String(a[1].at || '').localeCompare(String(b[1].at || '')) || String(a[0]).localeCompare(String(b[0]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.8h6v3H9z"/><path d="M8.5 11h7M8.5 15h7"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2.5l2.2 10.5h10.2L20 7H7"/><circle cx="9.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5h11v10h-11z"/><path d="M13.5 10h4l3 3.2v3.3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v5M17.5 9.5v5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3.2l1.4-2.2h6.8L16.800 8H20v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>',
};

// ---------- only ever on the secure page ----------
const INSECURE = location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

// ---------- the database ----------
const storedSession = () => { try { return !!localStorage.getItem(AUTH_KEY); } catch (e) { return false; } };
const storedUid = () => { try { const j = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); return (j && j.user && j.user.id) || null; } catch (e) { return null; } };
const sb = (!INSECURE && window.supabase && CFG.url) ? window.supabase.createClient(CFG.url, CFG.anonKey, {
  auth: {storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false},
  global: {fetch: (input, init) => fetch(input, {...(init || {}), cache: 'no-store'})},
}) : null;

const CODES = /^(invalid_argument|quota_exceeded|resource_exhausted|revoked|unauthenticated|not_uploader|too_large|unsupported_type|rate_limited|invalid_request)\b:?\s*/;
function mapErr(e){
  const msg = String((e && (e.message || e.error_description || e.error)) || e || '');
  const m = msg.match(CODES);
  if (m) return {code: m[1], message: msg.slice(m[0].length) || m[1]};
  if (e && typeof e.code === 'string' && /^[a-z_]+$/.test(e.code) && e.message) return e;
  return {code: 'unavailable', message: /fetch|network|load failed|timeout|abort/i.test(msg) || !msg ? 'No connection just now.' : msg};
}
async function rpc(fn, args){
  let r;
  try { r = await sb.rpc(fn, args || {}); } catch (e) { throw mapErr(e); }
  if (r.error) {
    const msg = String(r.error.message || '');
    if (/jwt|token|401|permission denied|^unauthenticated/i.test(msg) || r.status === 401 || r.error.code === '42501') {   // the sign-in expired while the app was open: renew once
      try { await sb.auth.refreshSession(); r = await sb.rpc(fn, args || {}); } catch (e) { throw mapErr(e); }
      if (!r.error) return r.data;
      const {data} = await sb.auth.getSession();
      if (!data || !data.session) {
        if (storedSession()) throw {code: 'unavailable', message: 'No connection just now.'};   // could not be renewed on a weak signal: not a sign-out
        onSignedOut(); throw {code: 'revoked', message: 'Signed out'};
      }
    }
    const err = mapErr(r.error);
    if (err.code === 'revoked') onRevoked();
    throw err;
  }
  return r.data;
}
const offlineErr = e => e && (e.code === 'unavailable' || e.code === 'upstream_error');
const errText = e => (e && (e.message || e.code)) || String(e || 'Something went wrong');

// ---------- what this app holds ----------
const S = {
  me: null, lvl: 0, people: new Map(),
  rq: new Map(), off: new Map(), costs: new Map(), bud: new Map(),
  lh: null,               // the letterhead for printing: a picture kept in the database, behind the sign-in
  setup: null,            // is the access rule for requisitions in the database? (null = not known yet)
  ready: false, since: null, online: true, saved: null,   // saved: showing the copy kept on this device (ISO time), no connection yet
  timer: null, busy: false, fail: 0, stopped: false,
};
const COLL = {rq: 'rq', rq_office: 'off', costs: 'costs', budget: 'bud'};
const keeps = (coll, id) => coll !== 'budget' || id === 'prc02' || String(id).startsWith('rq.');   // of the office's budget records only these two kinds are used here
const REVS = new Map();
function putDoc(coll, id, data, rev){
  if (!keeps(coll, id)) return false;
  const k = coll + '/' + id, have = REVS.get(k);
  if (have != null && rev != null && have >= rev) return false;
  REVS.set(k, rev == null ? (have || 0) : rev);
  S[COLL[coll]].set(id, data);
  return true;
}
function dropDoc(coll, id, rev){
  const k = coll + '/' + id, have = REVS.get(k);
  if (!S[COLL[coll]].has(id) || (rev != null && have != null && have > rev)) return false;
  S[COLL[coll]].delete(id); REVS.delete(k); return true;
}
const isDirector = () => S.lvl >= 3;
const canWrite = () => S.lvl >= 2;
const nameOf = id => { const p = id && S.people.get(id); return p && p.name ? p.name : (id && S.me && id === S.me.id ? (S.me.name || 'You') : 'Someone'); };
const firstName = id => nameOf(id).split(/\s+/)[0];
const whoOf = r => r.by ? nameOf(r.by) : (r.for || 'The office');

async function loadPeople(){ try { const L = await rpc('sb_people'); S.people = new Map((L || []).map(p => [p.id, p])); } catch (e) {} }

// the letterhead the app prints on. It is not one of the app's public files: it comes from the database after the
// sign-in (rq_cfg/print, loaded with the register file) and is kept on this device with the saved copy.
const LH_OK = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const lhOf = d => d && typeof d.lh === 'string' && d.lh.length < 250000 && LH_OK.test(d.lh) ? d.lh : null;
function setLh(data, keep){
  const lh = lhOf(data);
  if (lh === S.lh) return;
  S.lh = lh;
  if (keep && S.me) Promise.resolve(lh ? localSet('lh', {uid: S.me.id, lh}) : localDel('lh')).catch(() => {});
}

async function loadAll(){
  // the server's clock first, so nothing that changes while the lists load is missed by the first refresh
  const t0 = await rpc('sb_changes', {p_since: '2100-01-01T00:00:00Z'});
  if (S.me && t0.uid && t0.uid !== S.me.id) { onSignedOut(); throw {code: 'revoked', message: 'Signed out'}; }
  const dir = t0.level >= 3;
  const [rq, off, costs, budget, app, cfg] = await Promise.all([
    rpc('sb_list', {p_coll: 'rq'}), rpc('sb_list', {p_coll: 'rq_office'}),
    dir ? rpc('sb_list', {p_coll: 'costs'}) : [], dir ? rpc('sb_list', {p_coll: 'budget'}) : [],
    rpc('sb_app_get', {p_keys: ['rq_setup']}), rpc('sb_get', {p_path: 'rq_cfg/print'}).catch(() => null), loadPeople(),
  ]);
  S.rq.clear(); S.off.clear(); S.costs.clear(); S.bud.clear(); REVS.clear();
  for (const x of rq || []) putDoc('rq', x.id, x.data, x.rev);
  for (const x of off || []) putDoc('rq_office', x.id, x.data, x.rev);
  for (const x of costs || []) putDoc('costs', x.id, x.data, x.rev);
  for (const x of budget || []) putDoc('budget', x.id, x.data, x.rev);
  S.setup = !!(app && app.rq_setup);
  setLh(cfg && cfg.exists ? cfg.data : null, true);
  S.lvl = t0.level;
  const t = Date.parse(t0.now); S.since = isFinite(t) ? new Date(t - 60000).toISOString() : null;
  S.saved = null;
  keepCopy();
}
function applyChanges(res){
  if (!res) return false;
  if (S.me && res.uid && res.uid !== S.me.id) { onSignedOut(); return false; }
  if (S.lvl && res.level !== S.lvl) { S.stopped = true; location.reload(); return false; }   // the role changed: start again with the new access
  let ch = false;
  for (const g of res.gone || []) if (g.p === 'rq_cfg/print') setLh(null, true);
  for (const x of res.docs || []) if (x.c === 'rq_cfg' && x.i === 'print') setLh(x.d, true);
  for (const x of res.docs || []) if (COLL[x.c] && putDoc(x.c, x.i, x.d, x.r)) ch = true;
  for (const g of res.gone || []) if (COLL[g.c] && dropDoc(g.c, g.p.slice(g.c.length + 1), g.r)) ch = true;
  const t = Date.parse(res.now); if (isFinite(t)) S.since = new Date(t - 60000).toISOString();
  return ch;
}
async function poll(){
  if (S.busy || S.stopped || !S.ready) return;
  S.busy = true;
  const slow = setTimeout(() => setOnline(false), 10000);
  try {
    if (S.saved) { await loadAll(); setOnline(true); refresh(); trySendDrafts(); }      // back in signal after opening on the saved copy
    else { const ch = applyChanges(await rpc('sb_changes', {p_since: S.since})); S.fail = 0; setOnline(true); if (ch) { keepCopy(); refresh(); } }
  } catch (e) { S.fail++; if (offlineErr(e)) setOnline(false); }
  finally { clearTimeout(slow); S.busy = false; schedule(); }
}
function schedule(ms){
  clearTimeout(S.timer);
  if (document.hidden || S.stopped) return;
  S.timer = setTimeout(poll, ms != null ? ms : (S.fail ? Math.min(60000, 4000 * 2 ** Math.min(S.fail, 4)) : 8000));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.ready) poll(); });
window.addEventListener('online', () => { if (S.ready) poll(); });
window.addEventListener('offline', () => setOnline(false));
function setOnline(ok){
  const was = S.online; S.online = ok;
  const el = $('#net'); if (el) el.hidden = ok;
  if (ok && !was) trySendDrafts();
}

// ---------- writing ----------
// A new record is set once under a new random id; every later change is a merge, so two people saving different
// parts of the same requisition (a delivery and a message, say) never overwrite each other.
async function docSet(coll, id, data){
  const body = clone(data);
  const r = await rpc('sb_set', {p_path: coll + '/' + id, p_data: body});
  putDoc(coll, id, body, r.rev); keepCopy(); schedule(1500);
  return body;
}
async function docPatch(coll, id, patch){
  const r = await rpc('sb_update', {p_path: coll + '/' + id, p_patch: clone(patch)});
  putDoc(coll, id, r.data, r.rev); keepCopy(); schedule(1500);
  return r.data;
}
// the directors' record for a requisition: made on the first decision, merged into after that
async function officePatch(id, patch){
  if (!S.off.has(id)) {
    const g = await rpc('sb_get', {p_path: 'rq_office/' + id});
    if (!g || !g.exists) return docSet('rq_office', id, patch);
    putDoc('rq_office', id, g.data, g.rev);
  }
  return docPatch('rq_office', id, patch);
}
async function docDelete(coll, id){
  await rpc('sb_delete', {p_path: coll + '/' + id});
  S[COLL[coll]].delete(id); REVS.delete(coll + '/' + id); keepCopy(); schedule(1500);
}

// ---------- sign-in ----------
let DENIED_EMAIL = '', SIGNING_OUT = false, closing = false, appOpen = false;
// is the person already in another field of this form? Then the cursor stays where they put it.
const typingIn = (form, el) => { const a = document.activeElement; return !!(a && a !== el && form && form.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
function showGate(which, msg){
  const g = $('#pgGate'); if (!g) return;
  g.hidden = false; document.body.classList.add('gated'); const a = $('#app'); if (a) a.hidden = true;
  for (const id of ['signin', 'change', 'denied', 'viewer', 'loading', 'error']) { const el = $('#pg-' + id); if (el) el.hidden = id !== which; }
  if (which === 'denied') $('#pgDeniedWho').textContent = (S.me && S.me.email) || DENIED_EMAIL || 'This login';
  if (which === 'viewer') $('#pgViewerWho').textContent = (S.me && (S.me.name || S.me.email)) || 'This login';
  if (which === 'error') $('#pgErrMsg').textContent = msg || 'Something went wrong.';
  if (which === 'loading' && msg) $('#pgLoadMsg').textContent = msg;
  if (which === 'signin') setTimeout(() => { const e = $('#pgEmail'); if (e && !e.value && !typingIn(e.form, e)) e.focus(); }, 50);
  if (which === 'change') setTimeout(() => { const f = $('#pgFChange'); if (f && !typingIn(f, f.p1)) f.p1.focus(); }, 50);
}
function hideGate(){ $('#pgGate').hidden = true; document.body.classList.remove('gated'); $('#app').hidden = false; }
function fatal(msg){ if ($('#pgGate')) showGate('error', msg); else document.body.textContent = msg; }

async function swStart(){
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('sw.js', {scope: './'}); } catch (e) { console.warn('service worker', e); }
  repairParentShell();
}
// This app lives in a folder of the site board's address. On a device that already has the site board, the site
// board's own offline copy of its front page can pick up this page the first time it is opened here. Put it right.
async function repairParentShell(){
  try {
    if (!window.caches) return;
    const parent = new URL('../', location.href).href;
    for (const name of await caches.keys()) {
      if (!name.startsWith('pg-sb-shell-')) continue;
      const c = await caches.open(name), hit = await c.match(parent);
      if (!hit) continue;
      const text = await hit.clone().text();
      if (!/<meta name="pg-app" content="requisitions">/.test(text)) continue;
      let good = null;
      try { const r = await fetch(parent, {cache: 'no-store'}); if (r.ok) { const t = await r.clone().text(); if (!/<meta name="pg-app" content="requisitions">/.test(t)) good = r; } } catch (e) {}
      if (good) await c.put(parent, good); else await c.delete(parent);
    }
  } catch (e) {}
}

async function boot(){
  if (INSECURE) {
    const secure = 'https://' + location.hostname + location.pathname + location.search + location.hash;
    showGate('loading', 'Opening the secure page…'); location.replace(secure); return;
  }
  if (!sb) return fatal('The app could not start: a file did not load. Refresh the page.');
  showGate('loading', 'Opening…');
  await swStart();
  let data = null;
  try { ({data} = await sb.auth.getSession()); } catch (e) {}
  if (!data || !data.session) {
    if (storedSession() && await openSaved()) return;      // signed in before, no signal now: the copy kept on this device
    await purgeLocal(false); return showGate('signin');
  }
  await afterSignIn();
}
async function afterSignIn(){
  showGate('loading', 'Checking your access…');
  let me;
  try { me = await rpc('sb_whoami'); }
  catch (e) {
    if (offlineErr(e) && await openSaved()) return;
    return showGate('error', offlineErr(e) ? 'No connection. Check the signal and try again.' : errText(e));
  }
  if (!me || !me.member) { DENIED_EMAIL = (me && me.email) || ''; S.me = null; await purgeLocal(false); return showGate('denied'); }
  S.me = me; S.lvl = me.level;
  // drafts and the saved copy on this device belong to one person at one access level
  let seen = null; try { seen = JSON.parse(localStorage.getItem('pg-rq-me') || 'null'); } catch (e) {}
  if (!seen || seen.id !== me.id || seen.level !== me.level) await purgeLocal(!!seen && seen.id === me.id);
  try { localStorage.setItem('pg-rq-me', JSON.stringify({id: me.id, name: me.name, email: me.email, role: me.role, level: me.level})); } catch (e) {}
  if (me.level < 2) return showGate('viewer');
  if (me.mustChange) return showGate('change');
  await openApp();
}
async function openApp(){
  if (appOpen) { hideGate(); return; }
  showGate('loading', 'Loading the requisitions…');
  try { await loadAll(); }
  catch (e) {
    if (e && e.code === 'revoked') return;
    if (offlineErr(e) && await openSaved()) return;
    return showGate('error', offlineErr(e) ? 'No connection. Check the signal and try again.' : errText(e));
  }
  startApp();
}
// no signal: open on what this device kept the last time, read only, with drafts still possible
async function openSaved(){
  let seen = null; try { seen = JSON.parse(localStorage.getItem('pg-rq-me') || 'null'); } catch (e) {}
  const uid = storedUid();
  if (!seen || !uid || seen.id !== uid || seen.level < 2) return false;
  const copy = await localGet('copy');
  if (!copy || copy.uid !== uid) return false;
  S.me = {...seen, member: true}; S.lvl = seen.level;
  S.rq = new Map(copy.rq || []); S.off = new Map(copy.off || []); S.costs = new Map(seen.level >= 3 ? (copy.costs || []) : []);
  S.bud = new Map(seen.level >= 3 ? (copy.bud || []) : []);
  S.people = new Map(copy.people || []); S.setup = copy.setup == null ? null : copy.setup;
  const lh = await localGet('lh'); S.lh = lh && lh.uid === uid ? lhOf(lh) : null;
  S.saved = copy.at || nowISO(); S.online = false;
  startApp();
  return true;
}
function startApp(){
  S.ready = true; appOpen = true;
  hideGate(); setOnline(!S.saved);
  $('#acctName').textContent = (S.me.name || S.me.email || 'Account').split(/\s+/)[0];
  startUI();
  schedule(S.saved ? 5000 : 8000);
  trySendDrafts();
}
const keepCopy = debounce(() => {
  if (!S.me || S.saved) return;
  localSet('copy', {uid: S.me.id, at: nowISO(), rq: [...S.rq], off: [...S.off], costs: isDirector() ? [...S.costs] : [], bud: isDirector() ? [...S.bud] : [], people: [...S.people], setup: S.setup}).catch(() => {});
}, 800);

function onRevoked(){
  if (S.stopped) return; S.stopped = true; clearTimeout(S.timer);
  S.rq.clear(); S.off.clear(); S.costs.clear(); S.bud.clear();
  purgeLocal(false, true).then(() => { showGate('denied'); });
}
function onSignedOut(){
  if (closing) return; closing = true; S.stopped = true; clearTimeout(S.timer);
  showGate('loading', 'Signed out. Opening the sign-in page…');
  purgeLocal(false).then(() => location.reload());
}
async function signOut(){
  SIGNING_OUT = true; closing = true; S.stopped = true; clearTimeout(S.timer);
  showGate('loading', 'Signing out…');
  let res = null; try { res = await sb.auth.signOut({scope: 'local'}); } catch (e) { res = {error: e}; }
  if (!res || res.error || storedSession()) {   // no signal: the sign-in is taken off this device all the same
    for (const x of ['', '-code-verifier', '-user']) try { localStorage.removeItem(AUTH_KEY + x); } catch (e) {}
  }
  await purgeLocal(false, true);
  location.reload();
}
// everything this app keeps on the device: the saved copy, saved files and (unless they are this person's own) drafts
// (board: on signing out, and when access is turned off, the Site Board's saved photos and documents go too, as the
// board does itself: one sign-in serves both apps)
async function purgeLocal(keepDrafts, board){
  try { localStorage.removeItem('pg-rq-me'); } catch (e) {}
  try { const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith('pg-rq-files') || (board && k.startsWith('pg-sb-files'))).map(k => caches.delete(k))); } catch (e) {}
  S.lh = null;
  try { await localDel('copy'); await localDel('lh'); if (!keepDrafts) await draftsClear(); } catch (e) {}
}
if (sb) sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'SIGNED_OUT') { if (S.me && !SIGNING_OUT) onSignedOut(); return; }
  if (S.me && session && session.user && session.user.id !== S.me.id) onSignedOut();   // another person signed in on this browser
});

document.addEventListener('submit', async ev => {
  const f = ev.target; if (!f || !f.id || !f.id.startsWith('pgF')) return;
  ev.preventDefault();
  if (f.id === 'pgFSignIn') {
    const email = $('#pgEmail').value.trim(), password = $('#pgPass').value, msg = $('#pgSignMsg'), btn = f.querySelector('button[type=submit]');
    if (!email || !password) { msg.textContent = 'Enter your email address and password.'; return; }
    btn.disabled = true; msg.textContent = 'Signing in…';
    let error = null; try { ({error} = await sb.auth.signInWithPassword({email, password})); } catch (e) { error = e; }
    btn.disabled = false;
    if (error) { const m = String(error.message || error); msg.textContent = /invalid|credentials/i.test(m) ? 'That email address and password do not match. Check them, or ask Katiso for a new temporary password.' : /fetch|network|load failed/i.test(m) ? 'No connection. Check the signal and try again.' : m; return; }
    msg.textContent = ''; $('#pgPass').value = '';
    await afterSignIn();
  }
  if (f.id === 'pgFChange' || f.id === 'pgFChange2') {
    const a = f.p1.value, b = f.p2.value, msg = f.querySelector('.msg'), btn = f.querySelector('button[type=submit]');
    if (a.length < 8) { msg.textContent = 'Use at least 8 characters.'; return; }
    if (a !== b) { msg.textContent = 'The two passwords are not the same.'; return; }
    btn.disabled = true; msg.textContent = 'Saving…';
    let error = null; try { ({error} = await sb.auth.updateUser({password: a})); } catch (e) { error = e; }
    if (error) { btn.disabled = false; const m = String(error.message || error); msg.textContent = /same|different/i.test(m) ? 'Choose a password different from the temporary one.' : /fetch|network/i.test(m) ? 'No connection. Try again.' : m; return; }
    try { await rpc('sb_password_changed'); } catch (e) {}
    btn.disabled = false; msg.textContent = ''; f.reset();
    if (S.me) S.me.mustChange = false;
    if (f.id === 'pgFChange2') { closeSheet(); toast('Your new password is saved.'); return; }
    await openApp();
  }
});
document.addEventListener('click', ev => {
  const t = ev.target.closest && ev.target.closest('[data-pg]'); if (!t) return;
  const a = t.dataset.pg;
  if (a === 'signout') return signOut();
  if (a === 'retry') return boot();
  if (a === 'show-pass') { const i = document.getElementById(t.dataset.for); if (i) { i.type = i.type === 'password' ? 'text' : 'password'; t.textContent = i.type === 'password' ? 'Show' : 'Hide'; } }
});
