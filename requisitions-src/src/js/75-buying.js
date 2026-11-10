// ---------- buying (directors): what is approved and not ordered yet, and the orders on their way ----------
function openOrder(id){
  const v = view(id); if (!v || !isDirector() || !needOnline()) return;
  const L = v.needOrder; if (!L.length) { toast('Nothing is left to order on this requisition.'); return; }
  const r = v.r, M = v.M || {}, eta = L.map(l => l.need).filter(Boolean).sort()[0] || r.needBy || '';
  const plant = L.every(l => l.type === 'plant' || /^hire\b/i.test(l.desc));
  SHEET = {kind: 'order', id, key: newKey(8), files: []};
  const row = l => `<div class="lc" data-line="${esc(l.id)}"><label class="check"><input type="checkbox" name="ok.${esc(l.id)}" checked data-osum> <span><b>${esc(l.desc)}</b>
      <span class="muted small" style="display:block;font-weight:400">Approved ${lineQty(l.aq, l.unit)}${l.oq ? ' · ordered so far ' + qfmt(l.oq) : ''}${l.need ? ' · needed ' + esc(dfmt(l.need)) : ''}${l.rate != null ? ' · budget rate ' + esc(money(l.rate)) : ''}</span></span></label>
    <label>Order now${l.unit ? ' (' + esc(l.unit) + ')' : ''}<input name="q.${esc(l.id)}" inputmode="decimal" autocomplete="off" value="${l.toOrder == null ? '' : esc(l.toOrder)}" placeholder="${l.aq == null ? 'To be confirmed' : ''}" data-osum data-rate="${l.rate == null ? '' : l.rate}"></label></div>`;
  openSheet('Record an order: ' + (r.no || ''), `<form data-form="order" novalidate><div class="sheet-bd">
      <div><b>${esc(r.title || '')}</b>${r.release ? `<p class="help">${esc(r.release)}</p>` : ''}</div>
      ${(r.hold || []).length ? `<div class="notice bad"><b>Do not buy:</b> ${r.hold.map(esc).join(' ')}</div>` : ''}
      <div class="frow"><label><span class="req">Supplier</span><input name="supplier" list="dlSup2" maxlength="120" autofocus></label><label>Order or PO number<input name="ref" maxlength="60" autocomplete="off"></label></div>
      <div class="frow"><label>Ordered on<input type="date" name="date" value="${today()}"></label><label>Expected on site<input type="date" name="eta" value="${esc(eta && daysTo(eta) >= 0 ? eta : '')}"></label></div>
      <h3>Lines on this order</h3><div class="lines">${L.map(row).join('')}</div>
      <div class="panel flat form"><b>For the cost ledger <span class="opt" style="font-weight:400">directors only; the site team never sees it</span></b>
        <div class="frow"><label>Order value, R excl VAT<input name="amount" inputmode="decimal" autocomplete="off" placeholder="Can be added later"></label><label>Budget line<select name="code">${codeOptions(M.code || '')}</select></label></div>
        <div class="frow"><label>What it is<select name="type">${Object.entries(COST_TYPES).map(([k, t]) => `<option value="${k}"${k === (plant ? 'plant' : 'mat') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label>The order or the quote <span class="opt">photo or PDF</span><input type="file" name="doc" accept="image/*,application/pdf"></label></div>
        <p class="help" id="ordSum"></p></div>
      <label class="fl">Note for the site <span class="opt">optional: when the truck comes, who to phone</span><textarea name="note" rows="2" maxlength="600"></textarea></label>
      <div class="err" id="ordErr" role="alert"></div>
      <datalist id="dlSup2">${suppliersKnown().map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    </div><div class="sheet-ft"><button type="button" class="btn" data-act="sheet-close">Back</button><button type="submit" class="btn primary">${ICON.check} Save the order</button></div></form>`);
  ordSum();
}
function ordSum(){
  const f = $('#sheet form[data-form="order"]'), el = $('#ordSum'); if (!f || !el) return;
  let tot = 0, n = 0, bare = 0;
  for (const card of $$('.lc[data-line]', f)) { const i = $('input[name^="q."]', card); if (!$('input[type=checkbox]', card).checked) continue; n++; const q = num(i.value), rate = num(i.dataset.rate); if (q != null && rate != null) tot += q * rate; else bare++; }
  el.textContent = n ? `Budget value of these ${plural(n, 'line')}: ${money(r2(tot))} excl VAT${bare ? ' (' + plural(bare, 'line') + ' without a rate or quantity)' : ''}.` : 'No line is ticked.';
}
document.addEventListener('input', ev => { if (SHEET && SHEET.kind === 'order' && ev.target.dataset && 'osum' in ev.target.dataset) ordSum(); });
ACT['order-new'] = t => openOrder(t.dataset.id);
const orderDesc = (v, lines) => ((v.r.no || '') + ' ' + (v.r.title || '') + ': ' + Object.entries(lines).map(([lid, x]) => { const l = v.lines.find(y => y.id === lid); return l ? (x.q != null ? qfmt(x.q) + ' ' + (l.unit || '') + ' ' : '') + l.desc : ''; }).filter(Boolean).join('; ')).slice(0, 300);
FORMS.order = async (f, ev) => {
  const s = SHEET; if (!s || s.kind !== 'order' || s.busy) return;
  const v = view(s.id), e = f.elements, err = $('#ordErr'), lines = {}, bad = [];
  for (const card of $$('.lc[data-line]', f)) {
    const id = card.dataset.line; if (!e['ok.' + id].checked) continue;
    const qs = e['q.' + id].value.trim(), q = num(qs), l = v.lines.find(x => x.id === id);
    if (qs && (q == null || q <= 0)) { bad.push('A quantity is not a number above 0.'); continue; }
    if (!qs && l && l.aq != null) { bad.push('Give the quantity ordered on each ticked line.'); continue; }
    lines[id] = {q};
  }
  if (!e.supplier.value.trim()) bad.push('Name the supplier.');
  if (!Object.keys(lines).length) bad.push('Tick at least one line.');
  const as = e.amount.value.trim(), amount = num(as);
  if (as && (amount == null || amount <= 0)) bad.push('The order value is not a number above 0.');
  if (amount && !e.code.value) bad.push('Pick the budget line the order value is booked to.');
  if (e.doc.files[0] && !amount) bad.push('Enter the order value to keep the document with it (documents with prices are kept in the cost ledger, for directors only).');
  if (bad.length) { err.innerHTML = [...new Set(bad)].map(esc).join('<br>'); err.scrollIntoView({block: 'center'}); return; }
  err.textContent = '';
  const btn = ev.submitter || $('button[type=submit]', f); s.busy = true; working(btn, true);
  try {
    const now = nowISO(), od = {kind: 'po', supplier: e.supplier.value.trim(), ref: e.ref.value.trim(), date: e.date.value || today(), eta: e.eta.value || '', lines, note: e.note.value.trim(), by: S.me.id, at: now};
    let doc = null, file = e.doc.files[0];
    if (file && amount) { const p = await prepFiles([file]); if (p.length) { const m = await uploadPrepared(p, 3); const [aid, meta] = Object.entries(m)[0]; doc = {id: aid, ...meta}; } }
    await docPatch('rq', s.id, {orders: {[s.key]: od}});
    // The value goes in the cost ledger: a second save. If that one fails the order is there without a value, and
    // the director is told so in the one message that stays on the screen.
    let lost = null;
    if (amount) await docSet('costs', costId(s.id, s.key), costDoc({date: od.date, type: e.type.value, code: e.code.value, supplier: od.supplier, ref: od.ref, desc: orderDesc(v, lines), amount, status: 'ordered', doc, rq: s.id, order: s.key, ov: amount}))
      .catch(er => { lost = er; });
    if (!lost && e.code.value && !(v.M && v.M.code)) await moneyPatch(s.id, {code: e.code.value}).catch(() => {});
    closeSheet(true); refresh();
    if (lost) toast(`The order is saved, but its value is not (${why(lost)}). Add the value${doc ? ' and the document' : ''} under Money.`, true);
    else toast('Order saved. The site sees it under Deliveries.');
  } catch (er) { s.busy = false; working(btn, false); err.textContent = offlineErr(er) ? 'No connection: not saved.' : 'Not saved: ' + errText(er); }
};
// one entry of the site board's cost ledger, in the ledger's own format (plus where it came from)
function costDoc(o){
  const d = o.doc || null;
  return {date: o.date || today(), type: o.type || 'mat', code: o.code, supplier: o.supplier || '', ref: o.ref || '', desc: o.desc || '', amount: r2(o.amount), status: o.status || 'ordered',
    paidOn: o.status === 'paid' ? (o.paidOn || o.date || today()) : '', doc: d ? d.id : (o.docId || ''), by: S.me.id, at: nowISO(), createdBy: o.createdBy || S.me.id,
    rq: o.rq, order: o.order, po: o.po != null ? o.po : (o.ref || ''), inv: o.inv || '', invDate: o.invDate || '', ov: o.ov != null ? r2(o.ov) : null,
    docName: d ? d.name : (o.docName || ''), docType: d ? d.type : (o.docType || ''), docTh: d ? (d.th || null) : (o.docTh || null), src: 'requisitions'};
}

PAGES.buy = {
  title: 'Buying', dir: true,
  render(){
    const V = allViews(), buy = V.filter(v => v.needOrder.length).sort((a, b) => String(a.r.orderBy || '9999').localeCompare(String(b.r.orderBy || '9999')) || byNeed(a, b));
    const open = []; for (const v of V) for (const [k, od] of v.orders) { const left = v.expect.filter(l => od.lines && od.lines[l.id]); if (left.length) open.push({v, k, od, left}); }
    open.sort((a, b) => String(a.od.eta || '9999').localeCompare(String(b.od.eta || '9999')));
    const nLines = buy.reduce((n, v) => n + v.needOrder.length, 0), est = r2(buy.reduce((a, v) => a + v.needOrder.reduce((b, l) => b + (l.toOrder != null && l.rate != null ? l.toOrder * l.rate : 0), 0), 0));
    const late = buy.filter(v => v.orderLate).length, lateIn = open.filter(o => o.od.eta && daysTo(o.od.eta) < 0).length;
    const tile = (k, val, s, tone) => `<div class="tile t-${tone}"><span class="k">${esc(k)}</span><span class="v">${val}</span><span class="s">${s}</span></div>`;
    const block = v => {
      const tot = r2(v.needOrder.reduce((a, l) => a + (l.toOrder != null && l.rate != null ? l.toOrder * l.rate : 0), 0));
      return `<div class="panel stack"><div class="flex between"><div class="grow"><a class="card-no" href="#/rq/${encodeURIComponent(v.id)}">${esc(v.r.no)}</a> <b>${esc(v.r.title || '')}</b>
          <div class="kv">${v.r.orderBy ? `<span>${dueTxt(v.r.orderBy, 'Order by')}</span>` : v.r.orderTxt ? `<span>Order: <b>${esc(v.r.orderTxt)}</b></span>` : ''}${v.r.needBy ? `<span>${dueTxt(v.r.needBy, 'Needed')}</span>` : ''}${tot ? `<span>budget <b>${esc(money(tot))}</b></span>` : ''}</div></div>
          <button type="button" class="btn primary" data-act="order-new" data-id="${esc(v.id)}">${ICON.cart} Record an order</button></div>
        ${v.r.release ? `<p class="small muted">${esc(v.r.release)}</p>` : ''}${(v.r.hold || []).length ? `<p class="small donot"><b>Do not buy:</b> ${v.r.hold.map(esc).join(' ')}</p>` : ''}
        <div class="tbl stackable ltbl"><table><thead><tr><th>Ref</th><th>What</th><th class="num">To order</th><th>Needed</th><th class="num">Budget rate</th><th class="num">Budget value</th></tr></thead><tbody>
          ${v.needOrder.map(l => `<tr><td data-l="Ref">${esc(l.ref || '')}</td><td class="full"><b>${esc(l.desc)}</b>${LTYPE[l.type] ? ` <span class="pill p-line">${LTYPE[l.type]}</span>` : ''}${l.note ? `<span class="sub">${esc(l.note)}</span>` : ''}</td>
            <td class="num" data-l="To order">${lineQty(l.toOrder, l.unit)}</td><td data-l="Needed">${esc(l.need ? dfmt(l.need) : (l.needTxt || ''))}</td>
            <td class="num" data-l="Budget rate">${l.rate == null ? '' : esc(money(l.rate))}</td><td class="num" data-l="Budget value">${l.rate != null && l.toOrder != null ? esc(money(r2(l.rate * l.toOrder))) : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
    };
    const ocard = ({v, k, od, left}) => {
      const c = costOf(v.id, k), lateO = od.eta && daysTo(od.eta) < 0;
      return `<div class="card c-${lateO ? 'bad' : 'info'}"><div class="card-top"><a class="card-no" href="#/rq/${encodeURIComponent(v.id)}">${esc(v.r.no)}</a><b>${esc(od.supplier || '')}</b>${od.ref ? `<span class="mono small">${esc(od.ref)}</span>` : ''}${lateO ? '<span class="pill p-bad">Late</span>' : ''}</div>
        <div class="card-m"><span>Ordered <b>${esc(dfmt(od.date || od.at))}</b></span>${od.eta ? `<span>${dueTxt(od.eta, 'Expected')}</span>` : '<span>no delivery date</span>'}<span>${c ? '<b>' + esc(money(c.amount)) + '</b>' : '<span class="pill p-warn">no value</span>'}</span></div>
        <ul class="notes">${left.slice(0, 5).map(l => `<li>${esc(l.desc)} <span class="muted">· ${l.toCome == null ? 'to come' : lineQty(l.toCome, l.unit) + ' to come'}</span></li>`).join('')}${left.length > 5 ? `<li class="muted">and ${left.length - 5} more</li>` : ''}</ul>
        <div class="card-acts"><button type="button" class="btn sm" data-act="cost-edit" data-id="${esc(v.id)}" data-key="${esc(k)}">${c ? 'Invoice or payment' : 'Enter the order value'}</button><a class="btn sm ghost" href="#/rq/${encodeURIComponent(v.id)}">Open ${esc(v.r.no)}</a></div></div>`;
    };
    return `<div class="stack">
      ${pageHead('Buying', 'Approved lines that are not ordered yet, and the orders on their way to site.', buy.length ? `<button type="button" class="btn" data-act="print-buy">Print the buying list</button>` : '')}
      <div class="tiles">${tile('To order', buy.length, plural(nLines, 'line') + (late ? `, <b style="color:var(--bad)">${late} past the order date</b>` : ''), late ? 'bad' : buy.length ? 'info' : 'ok')}
        ${tile('Budget value to order', esc(moneyK(est)), 'approved lines with a rate, excl VAT', 'brand')}
        ${tile('Orders on their way', open.length, lateIn ? `<b style="color:var(--bad)">${lateIn} past the delivery date</b>` : 'not fully delivered yet', lateIn ? 'bad' : 'info')}</div>
      ${section('To order', '', buy.length ? buy.map(block).join('') : emptyBox('Nothing to order', 'Lines show here as soon as a requisition is approved.'))}
      ${section('On order', '', open.length ? `<div class="cards">${open.map(ocard).join('')}</div>` : emptyBox('Nothing on its way', 'An order stays here until the site has booked all of it in.'))}
    </div>`;
  },
};
