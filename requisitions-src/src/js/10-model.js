// ---------- what a requisition is and where it stands ----------
// A requisition moves through four steps: requested by the site, approved by a director, ordered, delivered.
// Nothing here is typed in as a status: it is worked out from the decision, the orders and the deliveries on record.
const UNITS = ['No', 'bag', 'm', 'm²', 'm³', 'kg', 't', 'L', 'set', 'roll', 'length', 'sheet', 'box', 'pair', 'load', 'day', 'h', 'sum', 'lot'];
const LTYPE = {option: 'Option', extra: 'Extra', plant: 'Plant hire'};
const ST = {
  draft:          {label: 'Draft', tone: 'n', step: 0},
  sent:           {label: 'Awaiting approval', tone: 'warn', step: 1},
  query:          {label: 'Question from the office', tone: 'bad', step: 1},
  hold:           {label: 'On hold', tone: 'n', step: 1},
  rejected:       {label: 'Not approved', tone: 'bad', step: 1},
  approved:       {label: 'Approved, to order', tone: 'info', step: 2},
  part_ordered:   {label: 'Part ordered', tone: 'info', step: 2},
  ordered:        {label: 'On order', tone: 'info', step: 3},
  part_delivered: {label: 'Part delivered', tone: 'warn', step: 3},
  delivered:      {label: 'Delivered', tone: 'ok', step: 4},
  closed:         {label: 'Closed', tone: 'n', step: 4},
  cancelled:      {label: 'Cancelled', tone: 'n', step: 0},
};
const OPEN_STATES = ['sent', 'query', 'hold', 'approved', 'part_ordered', 'ordered', 'part_delivered'];
// the checks of QMS form QF-05, Material Delivery Inspection
const QF05 = [
  ['count', 'Quantity counted or measured on site, not taken from the delivery note'],
  ['cert', 'Certificate, test report or data sheet received and kept'],
  ['approved', 'The material is the approved type, as on the requisition'],
  ['store', 'Stored as the supplier requires: off the ground, covered, dry'],
  ['photos', 'Photos taken of the delivery, the labels and the delivery note'],
];
// the cost ledger of the site board: the same kinds and budget lines, so an order booked here reads correctly there
const COST_TYPES = {mat: 'Materials', plant: 'Plant hire', sub: 'Subcontractor', cons: 'Consumables and small items', pg: 'Staff, vehicles, offices and site running', lab: 'Wages', other: 'Other'};
const COST_ST = {ordered: ['info', 'On order'], invoiced: ['warn', 'Invoiced'], paid: ['ok', 'Paid']};
const CODES_BASE = [['A-PG', 'Preliminaries and general'], ['A-PLANT', 'Plant'], ['A-CONS', 'Consumables and small items'], ['A-LAB', 'Section A labour'], ['A-DW', 'Dayworks and provisional sums'],
  ['B', 'Site clearance'], ['C', 'Earthworks platform'], ['D', 'Inlet works'], ['E', 'Clarifier'], ['F', 'Sludge recycling chamber'], ['G', 'Reactor'], ['H', 'Division box'],
  ['I', 'Repairs to existing works'], ['J', 'Buildings (SMME)'], ['K', 'Pipework'], ['L', 'Roads and stormwater'], ['M', 'Fence'], ['O', 'Mechanical and electrical']];
const budgetCodes = () => { const rs = budgetRows(); return (rs.length ? rs.map(r => [r.code, r.name]) : CODES_BASE).concat([['HO', 'Head-office overhead']]); };
const codeName = c => { const h = budgetCodes().find(x => x[0] === c); return h ? (/^(A-|HO)/.test(c) ? h[1] : c + ' ' + h[1]) : (c || ''); };
const codeOptions = sel => '<option value="">Pick a budget line</option>' + budgetCodes().map(([c, n]) => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(/^(A-|HO)/.test(c) ? n : c + ' ' + n)}</option>`).join('');

const linesOf = r => Object.entries((r && r.lines) || {}).filter(([, l]) => l && typeof l === 'object')
  .map(([id, l]) => ({id, ...l})).sort((a, b) => (a.n || 0) - (b.n || 0) || String(a.id).localeCompare(String(b.id)));
const officeOf = id => S.off.get(id) || null;
// the directors' own record of a requisition: budget rates, the budget line, how the work is paid (never sent to a site login)
const moneyOf = id => (isDirector() && S.bud.get('rq.' + id)) || null;
const rateOf = (id, lid) => { const m = moneyOf(id), v = m && m.rates ? m.rates[lid] : null; return v == null || v === '' ? null : Number(v); };
const costOf = (id, key) => (isDirector() && S.costs.get('rq.' + id + '.' + key)) || null;
const costId = (id, key) => 'rq.' + id + '.' + key;
const budgetRows = () => { const b = S.bud.get('prc02'); return (b && Array.isArray(b.rows)) ? b.rows : []; };
// A text that quotes an amount has two wordings: the one on the requisition (no amount) and the directors' one.
// The directors' wording is shown only while the wording on the requisition is still the one it was written for.
const fullOf = (M, map, base, k, cur) => (M && M[map] && M[map][k] != null && (!M[base] || M[base][k] == null || M[base][k] === cur)) ? M[map][k] : cur;

// a short fingerprint of what was asked for, kept with each decision: if the lines change afterwards without the
// requisition being sent again, the directors are told
function sigOf(r){
  const s = linesOf(r).map(l => [l.id, l.qty == null ? '' : l.qty, l.unit || '', l.desc || ''].join('\u0001')).join('\u0002');
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36) + '.' + s.length;
}
function curDec(id, r){
  const o = officeOf(id); if (!o || !o.cur || !o.dec) return null;
  const d = o.dec[o.cur]; if (!d || typeof d !== 'object') return null;
  return {...d, key: o.cur, stale: (d.rev || 1) !== (r.rev || 1)};
}

let VIEWS = null;
function view(id){
  if (VIEWS && VIEWS.has(id)) return VIEWS.get(id);
  const r = S.rq.get(id); if (!r || typeof r !== 'object') return null;
  const o = officeOf(id), d = curDec(id, r), dec = d && !d.stale ? d : null;
  const approved = !!dec && dec.state === 'approved';
  const orders = live(r.orders).sort(byAt), grns = live(r.grn).sort(byAt), M = moneyOf(id);
  const L = linesOf(r).map(l => {
    const snap = approved ? (dec.lines || {})[l.id] : null;
    const ok = approved ? !!(snap && snap.ok) : null;
    const aq = ok ? (snap.qty == null || snap.qty === '' ? null : Number(snap.qty)) : null;        // what was approved
    let oq = 0, oany = false, got = 0, rany = false, rdone = false, rej = 0, eta = '';
    for (const [, od] of orders) { const x = od.lines && od.lines[l.id]; if (x) { oany = true; oq += Number(x.q) || 0; if (od.eta && (!eta || od.eta > eta)) eta = od.eta; } }
    for (const [, g] of grns) {
      const x = g.lines && g.lines[l.id]; if (!x) continue;
      if (x.acc === 'rejected') { rej += Number(x.q) || 0; continue; }
      rany = true; got += Number(x.q) || 0; if (x.done) rdone = true;
    }
    const ordered = !!ok && (aq == null ? oany : oq >= aq - 1e-9);
    const received = !!ok && (rdone || (aq != null && aq > 0 && got >= aq - 1e-9));
    const rate = rateOf(id, l.id);
    const said = ok && snap.desc != null ? snap.desc : l.desc;            // once approved, the wording that was approved
    return {...l, ok, aq, oq: r2(oq), oany, ordered, got: r2(got), rany, received, rej: r2(rej), eta, rate,
      desc: fullOf(M, 'ld', 'ls', l.id, said), siteDesc: said, unit: ok && snap.unit != null ? snap.unit : l.unit,
      note: fullOf(M, 'ln', 'lns', l.id, l.note), asked: l.qty, askedDesc: l.desc,
      toOrder: ok && !ordered && !received ? (aq == null ? null : r2(Math.max(0, aq - Math.max(oq, got)))) : 0,
      toCome: ok && !received && (oany || ordered) ? (aq == null ? null : r2(Math.max(0, Math.min(aq, oq) - got))) : 0};
  });
  const A = L.filter(l => l.ok);
  let key;
  if (r.state === 'cancelled') key = 'cancelled';
  else if (o && o.closed) key = 'closed';
  else if (r.state === 'draft') key = 'draft';
  else if (!dec) key = 'sent';
  else if (dec.state !== 'approved') key = ST[dec.state] ? dec.state : 'sent';
  else {
    const nO = A.filter(l => l.ordered || l.received).length, nR = A.filter(l => l.received).length;
    key = A.length && nR === A.length ? 'delivered' : A.some(l => l.rany) ? 'part_delivered'
      : A.length && nO === A.length ? 'ordered' : A.some(l => l.oany) ? 'part_ordered' : 'approved';
  }
  const act = OPEN_STATES.includes(key) && ST[key].step >= 2;
  const needOrder = act ? A.filter(l => !l.ordered && !l.received) : [];
  const expect = act ? A.filter(l => !l.received && (l.oany || l.ordered)) : [];
  let est = 0, unpriced = 0;
  if (M) for (const l of approved ? A : L.filter(x => x.type === 'line' || !x.type)) {
    const q = approved ? l.aq : l.qty;
    if (l.rate != null && q != null) est += q * l.rate; else unpriced++;
  }
  // the money booked on it: one ledger entry for each order, and for each delivery the site team bought itself
  let ov = 0, inv = 0, paid = 0, unvalued = 0;
  if (isDirector()) for (const [k] of orders.concat(grns.filter(([, g]) => g.site))) {
    const c = costOf(id, k);
    if (!c) { unvalued++; continue; }
    const a = Number(c.amount) || 0;
    if (c.status === 'paid') paid += a; else if (c.status === 'invoiced') inv += a; else ov += a;
  }
  const nextEta = expect.map(l => l.eta || l.need || r.needBy || '').filter(Boolean).sort()[0] || '';
  const v = {id, r, o, dec, stale: d && d.stale ? d : null, key, st: ST[key], approved, lines: L, A, orders, grns, M,
    needOrder, expect, nextEta,
    orderLate: needOrder.length > 0 && !!r.orderBy && daysTo(r.orderBy) < 0,
    late: expect.length > 0 && !!nextEta && daysTo(nextEta) < 0,
    needLate: OPEN_STATES.includes(key) && !!r.needBy && daysTo(r.needBy) < 0,
    tampered: approved && !!dec.sig && dec.sig !== sigOf(r),
    est: r2(est), unpriced, ov: r2(ov), inv: r2(inv), paid: r2(paid), unvalued,
    msgs: live(r.msgs).sort(byAt), files: live(r.files).sort(byAt)};
  if (VIEWS) VIEWS.set(id, v);
  return v;
}
function allViews(){
  if (!VIEWS) VIEWS = new Map();
  const out = []; for (const id of S.rq.keys()) { const v = view(id); if (v) out.push(v); }
  return out.sort((a, b) => noKey(b.r.no).localeCompare(noKey(a.r.no)) || String(b.r.sentAt || '').localeCompare(String(a.r.sentAt || '')));
}
const noKey = no => String(no || '').replace(/\d+/g, m => m.padStart(6, '0'));
const byNeed = (a, b) => String(a.r.needBy || '9999').localeCompare(String(b.r.needBy || '9999')) || noKey(a.r.no).localeCompare(noKey(b.r.no));
// the next requisition number: one more than the highest on record, MR-09 after MR-08
function nextNo(skip){
  let n = 0; for (const [id, r] of S.rq) { if (id === skip) continue; const m = /^MR-(\d+)$/.exec((r && r.no) || ''); if (m) n = Math.max(n, +m[1]); }
  return 'MR-' + String(n + 1).padStart(2, '0');
}
// two phones sending at the same moment can pick the same number: the later one takes the next number by itself
async function healNumbers(){
  if (!S.me || S.saved) return;
  for (const [id, r] of S.rq) {
    if (!r || r.by !== S.me.id || !r.no) continue;
    const clash = [...S.rq].some(([j, x]) => j !== id && x && x.no === r.no && (String(x.sentAt || '') < String(r.sentAt || '') || (String(x.sentAt || '') === String(r.sentAt || '') && j < id)));
    if (clash) { try { await docPatch('rq', id, {no: nextNo(id)}); } catch (e) {} }
  }
}

const stPill = v => `<span class="pill p-${v.st.tone}">${esc(v.st.label)}</span>`;
const lineQty = (q, unit) => (q == null ? 'TBC' : qfmt(q)) + (unit ? ' ' + esc(unit) : '');
const frontsKnown = () => [...new Set([...S.rq.values()].map(r => r && r.front).filter(Boolean))].sort();
const suppliersKnown = () => [...new Set([...S.rq.values()].flatMap(r => [...live(r && r.orders).map(([, o]) => o.supplier), ...live(r && r.grn).map(([, g]) => g.supplier)]).filter(Boolean))].sort();
const placesKnown = () => [...new Set([...S.rq.values()].flatMap(r => [r && r.deliverTo, ...live(r && r.grn).map(([, g]) => g.stored)]).filter(Boolean))].sort();

// everything that happened on one requisition, oldest first
function timeline(v){
  const r = v.r, T = [];
  if (r.sentAt) T.push({at: r.sentAt, tone: 'brand', who: whoOf(r), text: 'Requisition sent to the office' + (r.src ? ' (from the ' + r.src + ')' : '')});
  for (const [k, e] of Object.entries(r.hist || {})) if (e && e.at) T.push({at: e.at, tone: '', who: nameOf(e.by), text: e.t || 'Changed', k});
  const o = v.o;
  for (const [k, d] of Object.entries((o && o.dec) || {})) {
    if (!d || !d.at) continue;
    const t = {approved: 'Approved', rejected: 'Not approved', query: 'Asked a question', hold: 'Put on hold'}[d.state] || d.state;
    T.push({at: d.at, tone: d.state === 'approved' ? 'ok' : d.state === 'hold' ? 'warn' : 'bad', who: nameOf(d.by), text: t + (d.note ? ': ' + d.note : ''), k});
  }
  for (const [k, od] of Object.entries(r.orders || {})) {
    if (!od || !od.at) continue;
    T.push({at: od.at, tone: 'info', who: nameOf(od.by), k,
      text: (od.kind === 'site' ? 'Bought on site' : 'Ordered') + (od.supplier ? ' from ' + od.supplier : '') + (od.ref ? ' (' + od.ref + ')' : '') + (od.x ? ', cancelled since' : '')});
  }
  for (const [k, g] of Object.entries(r.grn || {})) {
    if (!g || !g.at) continue;
    T.push({at: g.at, tone: 'ok', who: nameOf(g.by), k, text: 'Delivery booked in' + (g.supplier ? ' from ' + g.supplier : '') + (g.dn ? ' (delivery note ' + g.dn + ')' : '') + (g.x ? ', removed since' : '')});
  }
  for (const [k, m] of v.msgs) T.push({at: m.at, tone: '', who: nameOf(m.by), text: m.t, msg: true, k});
  if (o && o.closed) T.push({at: o.closed.at, tone: '', who: nameOf(o.closed.by), text: 'Closed' + (o.closed.note ? ': ' + o.closed.note : '')});
  if (r.state === 'cancelled' && r.cancelAt) T.push({at: r.cancelAt, tone: 'bad', who: nameOf(r.cancelBy), text: 'Cancelled' + (r.cancelNote ? ': ' + r.cancelNote : '')});
  return T.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
