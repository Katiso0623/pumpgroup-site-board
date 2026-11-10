// ---------- money (directors): order values, invoices and payments ----------
// Each order has one entry in the site board's cost ledger (costs/rq.<requisition>.<order>). The site team cannot
// read the ledger, and no amount is ever written into a requisition.
function moneyRows(){
  const out = [];
  for (const v of allViews()) {
    if (v.key === 'cancelled') continue;
    for (const [k, od] of v.orders) out.push({v, k, kind: 'order', date: od.date || String(od.at).slice(0, 10), supplier: od.supplier || '', ref: od.ref || '', c: costOf(v.id, k)});
    for (const [k, g] of v.grns) if (g.site) out.push({v, k, kind: 'site', date: g.date || String(g.at).slice(0, 10), supplier: g.supplier || '', ref: g.dn || '', c: costOf(v.id, k), slip: g.amt});
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
const MONEY_F = [['all', 'All', () => true], ['none', 'No value yet', x => !x.c], ['ordered', 'On order', x => x.c && x.c.status === 'ordered'], ['invoiced', 'Invoices to pay', x => x.c && x.c.status === 'invoiced'], ['paid', 'Paid', x => x.c && x.c.status === 'paid']];
PAGES.money = {
  title: 'Money', dir: true,
  render(route){
    const R = moneyRows(), f = MONEY_F.find(x => x[0] === route.q.get('f')) || MONEY_F[0], rows = R.filter(f[2]), V = allViews();
    const sum = st => r2(R.reduce((a, x) => a + (x.c && x.c.status === st ? Number(x.c.amount) || 0 : 0), 0));
    const est = r2(V.filter(v => v.approved && v.key !== 'cancelled').reduce((a, v) => a + v.est, 0)), none = R.filter(x => !x.c).length;
    const tile = (k, val, s, tone, h) => `<a class="tile t-${tone}" href="${h}"><span class="k">${esc(k)}</span><span class="v">${val}</span><span class="s">${s}</span></a>`;
    const by = new Map();
    for (const x of R) if (x.c) { const e = by.get(x.c.code) || {ordered: 0, invoiced: 0, paid: 0}; e[x.c.status] = (e[x.c.status] || 0) + (Number(x.c.amount) || 0); by.set(x.c.code, e); }
    const max = Math.max(1, ...[...by.values()].map(e => e.ordered + e.invoiced + e.paid));
    const bars = [...by].sort((a, b) => (b[1].ordered + b[1].invoiced + b[1].paid) - (a[1].ordered + a[1].invoiced + a[1].paid)).map(([code, e]) => { const t = e.ordered + e.invoiced + e.paid;
      return `<div class="barrow"><div class="lab"><span>${esc(codeName(code))}</span><span class="mono">${esc(money(r2(t)))}</span></div><div class="bar" role="img" aria-label="${esc(codeName(code))}: paid ${esc(money(r2(e.paid)))}, invoiced ${esc(money(r2(e.invoiced)))}, on order ${esc(money(r2(e.ordered)))}">
        <i class="b1" style="width:${100 * e.paid / max}%"></i><i class="b2" style="width:${100 * e.invoiced / max}%"></i><i class="b3" style="width:${100 * e.ordered / max}%"></i></div></div>`; }).join('');
    const tr = x => { const c = x.c, st = c ? COST_ST[c.status] || ['n', c.status] : null;
      return `<tr><td data-l="Date" class="nowrap">${esc(dfmt(c ? c.date : x.date))}</td>
        <td class="full"><a class="mono" href="#/rq/${encodeURIComponent(x.v.id)}">${esc(x.v.r.no)}</a> <b>${esc(x.supplier || 'Supplier not named')}</b>${x.kind === 'site' ? ' <span class="pill p-info">bought on site</span>' : ''}<span class="sub">${esc(x.v.r.title || '')}</span></td>
        <td data-l="Number" class="mono">${esc((c && (c.inv || c.ref)) || x.ref || '')}</td>
        <td data-l="Budget line">${c ? esc(codeName(c.code)) : ''}</td>
        <td class="num" data-l="Amount excl VAT">${c ? esc(money(c.amount)) : x.slip != null ? '<span class="muted">slip ' + esc(money(x.slip)) + '</span>' : ''}</td>
        <td data-l="Status">${st ? `<span class="pill p-${st[0]}">${esc(st[1])}</span>${c.status === 'paid' && c.paidOn ? `<span class="sub">${esc(dfmt(c.paidOn))}</span>` : ''}` : '<span class="pill p-warn">No value yet</span>'}</td>
        <td><button type="button" class="btn sm" data-act="cost-edit" data-id="${esc(x.v.id)}" data-key="${esc(x.k)}">${c ? (c.status === 'paid' ? 'Open' : 'Invoice or payment') : 'Enter the value'}</button></td></tr>`; };
    return `<div class="stack">
      ${pageHead('Money', 'Order values, invoices and payments on requisitions, excl VAT. Only directors can open this page: a site login never sees an amount.')}
      <div class="tiles">${tile('Approved', esc(moneyK(est)), 'budget value of what is approved', 'brand', '#/list?f=all')}
        ${tile('On order', esc(moneyK(sum('ordered'))), none ? `<b style="color:var(--warn)">${none} without a value yet</b>` : 'ordered, no invoice yet', none ? 'warn' : 'info', '#/money?f=' + (none ? 'none' : 'ordered'))}
        ${tile('Invoices to pay', esc(moneyK(sum('invoiced'))), 'invoiced, not paid', sum('invoiced') ? 'warn' : 'ok', '#/money?f=invoiced')}
        ${tile('Paid', esc(moneyK(sum('paid'))), 'paid on requisitions', 'ok', '#/money?f=paid')}</div>
      <div class="chips" role="group" aria-label="Show">${MONEY_F.map(x => `<button type="button" class="chip" aria-pressed="${x[0] === f[0]}" data-act="money-f" data-f="${x[0]}">${esc(x[1])}<span class="c">${R.filter(x[2]).length}</span></button>`).join('')}</div>
      ${rows.length ? `<div class="tbl stackable"><table><thead><tr><th>Date</th><th>Requisition and supplier</th><th>Number</th><th>Budget line</th><th class="num">Amount excl VAT</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>`
        : emptyBox(R.length ? 'Nothing at this stage' : 'No orders yet', R.length ? '' : 'Each order recorded under Buying shows here with its value, invoice and payment.')}
      ${bars ? `<div class="panel"><div class="panel-h"><h3>By budget line</h3><span class="sub">orders booked from requisitions</span></div><div class="bars">${bars}</div>
        <div class="legend" style="margin-top:10px"><span><i style="background:var(--ok)"></i>Paid</span><span><i style="background:var(--brand)"></i>Invoiced</span><span><i style="background:var(--cyan)"></i>On order</span></div></div>` : ''}
      <p class="help">Every amount entered here is one line in the cost ledger of the <a href="../">Site Board</a>, under Costs, where it counts against the PRC-02 budget. Wages, plant and other costs are entered there.</p>
    </div>`;
  },
};
ACT['money-f'] = t => go('#/money?f=' + encodeURIComponent(t.dataset.f));

function openCost(id, key){
  const v = view(id); if (!v || !isDirector() || !needOnline()) return;
  const r = v.r, od = (r.orders || {})[key], g = (r.grn || {})[key], src = od || g; if (!src) return;
  const c = costOf(id, key), M = v.M || {}, site = !od;
  const lines = Object.fromEntries(Object.entries(src.lines || {}).map(([k, x]) => [k, {q: x && x.q}]));
  const st = c ? c.status : site ? 'paid' : 'ordered';
  SHEET = {kind: 'cost', id, key, site};
  const val = c ? (c.ov != null ? c.ov : c.amount) : site ? (src.amt != null ? r2(src.amt / 1.15) : '') : '';
  openSheet(site ? 'Book a site purchase' : 'Order value, invoice and payment', `<form data-form="cost" novalidate><div class="sheet-bd">
      <div><span class="card-no">${esc(r.no)}</span> <b>${esc(src.supplier || 'Supplier not named')}</b>${src.ref || src.dn ? ` <span class="mono small">${esc(src.ref || src.dn)}</span>` : ''}
        <p class="help">${esc(orderDesc(v, lines).slice(0, 220))}</p>${site && src.amt != null ? `<p class="help">The slip total entered on site is ${esc(money(src.amt))} incl VAT, so ${esc(money(r2(src.amt / 1.15)))} excl VAT at 15%. Check it against the slip.</p>` : ''}</div>
      <div class="frow"><label><span class="req">Budget line</span><select name="code">${codeOptions((c && c.code) || M.code || '')}</select></label>
        <label>What it is<select name="type">${Object.entries(COST_TYPES).map(([k, t]) => `<option value="${k}"${k === ((c && c.type) || 'mat') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
      <div class="frow"><label>Supplier<input name="supplier" maxlength="120" value="${esc((c && c.supplier) || src.supplier || '')}"></label><label>Order or PO number<input name="po" maxlength="60" value="${esc((c && (c.po || (c.status === 'ordered' ? c.ref : ''))) || src.ref || '')}"></label></div>
      <label><span class="req">${site ? 'Amount' : 'Order value'}, R excl VAT</span><input name="ov" inputmode="decimal" autocomplete="off" value="${esc(val)}"></label>
      <div class="fl">Where it stands<div class="seg" id="costSt">${Object.entries(COST_ST).map(([k, [, t]]) => `<label><input type="radio" name="status" value="${k}"${k === st ? ' checked' : ''} data-cost><span>${esc(t)}</span></label>`).join('')}</div></div>
      <div id="costInv" class="form"${st === 'ordered' ? ' hidden' : ''}>
        <div class="frow"><label>Invoice number<input name="inv" maxlength="60" value="${esc((c && c.inv) || (site ? src.dn || '' : ''))}"></label><label>Invoice date<input type="date" name="invDate" value="${esc((c && c.invDate) || (site ? src.date || '' : ''))}"></label></div>
        <label>Invoice amount, R excl VAT <span class="opt">empty means the same as the order value</span><input name="invAmt" inputmode="decimal" autocomplete="off" value="${c && c.status !== 'ordered' && c.ov != null && c.amount !== c.ov ? esc(c.amount) : ''}"></label></div>
      <label id="costPaid"${st === 'paid' ? '' : ' hidden'}>Paid on<input type="date" name="paidOn" value="${esc((c && c.paidOn) || (site ? src.date || today() : today()))}"></label>
      <label>Invoice or order <span class="opt">photo or PDF; directors only</span><input type="file" name="doc" accept="image/*,application/pdf"></label>
      ${c && c.doc ? `<div><button type="button" class="btn sm" data-act="file-open" data-where="cost:${esc(costId(id, key))}" data-i="0">Open the document on file</button></div>` : ''}
      <div class="err" id="costErr" role="alert"></div>
    </div><div class="sheet-ft">${c ? `<button type="button" class="btn danger" data-act="cost-drop">Take it off the ledger</button>` : ''}<button type="button" class="btn" data-act="sheet-close">Back</button><button type="submit" class="btn primary">Save</button></div></form>`);
}
ACT['cost-edit'] = t => openCost(t.dataset.id, t.dataset.key);
document.addEventListener('change', ev => {
  if (!SHEET || SHEET.kind !== 'cost' || !ev.target.dataset || !('cost' in ev.target.dataset)) return;
  const st = ev.target.value; $('#costInv').hidden = st === 'ordered'; $('#costPaid').hidden = st !== 'paid';
});
ACT['cost-drop'] = async () => {
  const s = SHEET; if (!s || s.kind !== 'cost') return;
  if (!confirm('Take this amount off the cost ledger? The order itself stays on the requisition.')) return;
  await docDelete('costs', costId(s.id, s.key)); closeSheet(true); refresh(); toast('Taken off the ledger.');
};
FORMS.cost = async (f, ev) => {
  const s = SHEET; if (!s || s.kind !== 'cost' || s.busy) return;
  const v = view(s.id), e = f.elements, err = $('#costErr'), c = costOf(s.id, s.key), src = (v.r.orders || {})[s.key] || (v.r.grn || {})[s.key] || {}, bad = [];
  const ov = num(e.ov.value), st = e.status.value, ia = e.invAmt.value.trim(), invAmt = num(ia);
  if (!e.code.value) bad.push('Pick the budget line.');
  if (ov == null || ov <= 0) bad.push('Enter the amount excl VAT (a number above 0).');
  if (st !== 'ordered' && ia && (invAmt == null || invAmt <= 0)) bad.push('The invoice amount is not a number above 0.');
  if (bad.length) { err.innerHTML = bad.map(esc).join('<br>'); return; }
  err.textContent = '';
  const btn = ev.submitter || $('button[type=submit]', f); s.busy = true; working(btn, true);
  try {
    let doc = null; const file = e.doc.files[0];
    if (file) { const p = await prepFiles([file]); if (p.length) { const m = await uploadPrepared(p, 3); const [aid, meta] = Object.entries(m)[0]; doc = {id: aid, ...meta}; } }
    const lines = Object.fromEntries(Object.entries(src.lines || {}).map(([k, x]) => [k, {q: x && x.q}]));
    const amount = st === 'ordered' ? ov : (invAmt || ov), po = e.po.value.trim(), inv = e.inv.value.trim();
    await docSet('costs', costId(s.id, s.key), costDoc({date: st === 'ordered' ? (src.date || today()) : (e.invDate.value || src.date || today()), type: e.type.value, code: e.code.value,
      supplier: e.supplier.value.trim(), ref: st === 'ordered' ? po : (inv || po), desc: (c && c.desc) || orderDesc(v, lines), amount, status: st, paidOn: e.paidOn.value,
      doc, docId: c && c.doc, docName: c && c.docName, docType: c && c.docType, docTh: c && c.docTh, createdBy: c && c.createdBy, rq: s.id, order: s.key, po, inv, invDate: e.invDate.value, ov}));
    if (!(v.M && v.M.code)) await moneyPatch(s.id, {code: e.code.value}).catch(() => {});
    closeSheet(true); refresh(); toast('Saved in the cost ledger.');
  } catch (er) { s.busy = false; working(btn, false); err.textContent = offlineErr(er) ? 'No connection: not saved.' : 'Not saved: ' + errText(er); }
};
