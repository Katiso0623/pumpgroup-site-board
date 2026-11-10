// ---------- kept on this device ----------
// Two small stores in the browser's own database: "kv" holds the copy of the register that opens when there is no
// signal, and "out" holds what was written without a signal (a new requisition, a delivery) until it has been sent.
let IDBP = null;
const MEM = {kv: new Map(), out: new Map()};   // used when the browser will not give the app a database (a private window)
function idb(){
  if (!IDBP) IDBP = new Promise(res => {
    try {
      const q = indexedDB.open('pg-rq', 1);
      q.onupgradeneeded = () => { const d = q.result; for (const n of ['kv', 'out']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); };
      q.onsuccess = () => res(q.result); q.onerror = () => res(null); q.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return IDBP;
}
async function store(name, mode, fn){
  const d = await idb();
  if (!d) return fn(null, MEM[name]);
  return new Promise((res, rej) => {
    let out;
    try {
      const t = d.transaction(name, mode), q = fn(t.objectStore(name));
      if (q) q.onsuccess = () => { out = q.result; };
      t.oncomplete = () => res(out); t.onerror = t.onabort = () => rej(t.error || new Error('The device could not save this.'));
    } catch (e) { rej(e); }
  });
}
const localGet = k => store('kv', 'readonly', (s, m) => s ? s.get(k) : m.get(k)).catch(() => null);
const localSet = (k, v) => store('kv', 'readwrite', (s, m) => s ? s.put(v, k) : void m.set(k, v));
const localDel = k => store('kv', 'readwrite', (s, m) => s ? s.delete(k) : void m.delete(k)).catch(() => {});
const outAll = async () => ((await store('out', 'readonly', (s, m) => s ? s.getAll() : [...m.values()]).catch(() => [])) || []).sort((a, b) => String(a.at).localeCompare(String(b.at)));
const outGet = id => store('out', 'readonly', (s, m) => s ? s.get(id) : m.get(id)).catch(() => null);
const outPut = it => store('out', 'readwrite', (s, m) => s ? s.put(it, it.id) : void m.set(it.id, it));
const outDel = id => store('out', 'readwrite', (s, m) => s ? s.delete(id) : void m.delete(id)).catch(() => {});
const draftsClear = () => store('out', 'readwrite', (s, m) => s ? s.clear() : void m.clear()).catch(() => {});

// what is waiting on this device, for the banner and the home page
let OUT = [];
async function outRefresh(){ OUT = (await outAll()).filter(x => !S.me || !x.uid || x.uid === S.me.id); return OUT; }
const outWaiting = () => OUT.filter(x => x.state === 'queued' || x.state === 'error');
const outDrafts = () => OUT.filter(x => x.state === 'draft');

// ---------- sending what was written without a signal ----------
let SENDING = false;
async function trySendDrafts(manual){
  if (SENDING || !S.ready || S.saved || !S.me) return;
  SENDING = true;
  let sent = 0, stuck = null;
  try {
    for (const it of (await outRefresh()).filter(x => x.state === 'queued' || (manual && x.state === 'error'))) {
      try { await sendItem(it); await outDel(it.id); sent++; }
      catch (e) {
        if (offlineErr(e)) { stuck = e; break; }                    // still no signal: everything stays for the next try
        it.state = 'error'; it.err = errText(e); await outPut(it).catch(() => {});
      }
    }
  } finally { SENDING = false; }
  await outRefresh();
  if (sent) { toast(sent === 1 ? 'Sent to the office.' : sent + ' items sent to the office.'); refresh(); }
  else if (manual && stuck) toast('Still no connection. It stays on this device and is sent when the signal is back.', true);
  else if (manual) refresh();
  drawBanner();
}
async function sendItem(it){
  // the photos and documents first. Each one is uploaded once: its number is kept as soon as it is up, so trying again
  // after a dropped signal never uploads it twice.
  for (const f of it.files || []) {
    if (!f.asset) { f.asset = await uploadBlob(new Blob([f.buf], {type: f.type}), f.type, f.level || 2); await outPut(it); }
    if (f.tbuf && !f.th) { f.th = await uploadBlob(new Blob([f.tbuf], {type: 'image/jpeg'}), 'image/jpeg', f.level || 2); await outPut(it); }
  }
  const files = {};
  for (const f of it.files || []) files[f.asset] = {name: f.name, type: f.type, size: f.size, th: f.th || null, by: S.me.id, at: it.at};
  if (it.kind === 'rq') return sendRq(it, files);
  if (it.kind === 'grn') {
    const body = {...it.body, files: {...(it.body.files || {}), ...files}, by: S.me.id, at: it.at};
    await docPatch('rq', it.rqId, {grn: {[it.key]: body}});
    return;
  }
  throw {code: 'invalid_request', message: 'This kind of item cannot be sent.'};
}
async function sendRq(it, files){
  const id = it.rqId, now = nowISO();
  const g = await rpc('sb_get', {p_path: 'rq/' + id});
  if (it.mode !== 'edit') {
    if (g && g.exists) { putDoc('rq', id, g.data, g.rev); return; }           // it did arrive the first time: nothing to send again
    // a new requisition takes the next number at the moment it reaches the office
    try { applyChanges(await rpc('sb_changes', {p_since: S.since})); } catch (e) { if (offlineErr(e)) throw e; }
    const doc = {...it.body, v: 1, no: nextNo(id), files: {...(it.body.files || {}), ...files}, state: 'sent', rev: 1, by: S.me.id, at: it.at, sentAt: now};
    // The directors' part (budget line, rates, how it is paid) is saved first. If it cannot be saved, nothing is on the
    // register yet and the whole item is tried again; it is never lost without a word.
    if (it.office && isDirector()) await docSet('budget', 'rq.' + id, {v: 1, ...it.office, at: now, by: S.me.id});
    await docSet('rq', id, doc);
    await healNumbers();
    return;
  }
  // a requisition that was changed and is sent again: the lines are replaced one by one, what was removed is cleared
  if (!g || !g.exists) throw {code: 'invalid_request', message: 'This requisition is no longer on the register'};
  putDoc('rq', id, g.data, g.rev);
  const cur = g.data || {};
  if (cur.editKey === it.id) return;                                             // this change did arrive the first time
  const fl = {...(it.body.files || {}), ...files};
  const patch = {...it.body, files: fl, state: 'sent', rev: (cur.rev || 1) + 1, sentAt: now, editedBy: S.me.id, editedAt: now, editKey: it.id,
    hist: {[newKey(8)]: {t: 'Changed and sent again', by: S.me.id, at: now}}};
  if (!Object.keys(fl).length) delete patch.files;
  patch.lines = {...(it.body.lines || {})};
  for (const k of Object.keys(cur.lines || {})) if (!(k in patch.lines)) patch.lines[k] = null;
  if (it.office && isDirector()) await moneyPatch(id, it.office);          // first, for the same reason as above
  await docPatch('rq', id, patch);
}
// sends one item straight away (the person pressed Send with a signal). It waits its turn behind the background sender.
async function sendNow(it){
  while (SENDING) await new Promise(r => setTimeout(r, 120));
  SENDING = true;
  try {
    if (!(await outGet(it.id))) return;            // the background sender got to it first
    await sendItem(it); await outDel(it.id);
  } finally { SENDING = false; await outRefresh(); drawBanner(); }
}
