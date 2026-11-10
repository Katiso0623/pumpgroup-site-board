// ---------- one requisition: where it stands, its lines, orders, deliveries, files and messages ----------
function stepsHtml(v){
  const r = v.r, A = v.A.length, nO = v.A.filter(l => l.ordered || l.received).length, nR = v.A.filter(l => l.received).length;
  const s2 = v.approved ? 'done' : (v.key === 'query' || v.key === 'rejected') ? 'stop' : (v.key === 'sent' || v.key === 'hold') ? 'now' : '';
  const s3 = !v.approved ? '' : A && nO === A ? 'done' : v.A.some(l => l.oany || l.received) ? 'part' : 'now';
  const s4 = !v.approved ? '' : A && nR === A ? 'done' : v.A.some(l => l.rany) ? 'part' : s3 === 'done' ? 'now' : '';
  return `<div class="steps" aria-label="Progress">
    <div class="step done">Requested<small>${esc(dfmt(r.sentAt))}</small></div>
    <div class="step ${s2}">Approved<small>${v.approved ? esc(dfmt(v.dec.at)) : esc({query: 'question asked', rejected: 'not approved', hold: 'on hold', sent: 'waiting'}[v.key] || '')}</small></div>
    <div class="step ${s3}">Ordered<small>${v.approved ? nO + ' of ' + A : ''}</small></div>
    <div class="step ${s4}">Delivered<small>${v.approved ? nR + ' of ' + A : ''}</small></div></div>`;
}
function statusLine(v){
  const d = v.dec, who = d ? esc(nameOf(d.by)) : '', note = d && d.note ? `<div class="msg-b">${esc(d.note)}</div>` : '';
  switch (v.key) {
    case 'sent': return `<p>${isDirector() ? 'Waiting for your decision.' : 'With the office. A director approves it before anything is ordered.'}${v.stale ? ` <span class="muted">Changed and sent again after the office's last answer.</span>` : ''}</p>`;
    case 'query': return `<p><b>${who} asked a question.</b> ${isDirector() ? 'Waiting for the site to answer or to change the requisition.' : 'Answer in the messages below, or change the requisition and send it again.'}</p>${note}`;
    case 'rejected': return `<p><b>Not approved by ${who}.</b> ${isDirector() ? '' : 'Change it and send it again, or cancel it.'}</p>${note}`;
    case 'hold': return `<p><b>Put on hold by ${who}.</b> Nothing is ordered until a director approves it.</p>${note}`;
    case 'approved': return `<p><b>Approved by ${who}.</b> ${isDirector() ? plural(v.needOrder.length, 'line') + ' to order.' : 'The office orders next.'}</p>${note}`;
    case 'part_ordered': return `<p><b>Approved by ${who}.</b> ${plural(v.needOrder.length, 'line')} still to order${v.nextEta ? ', next delivery expected ' + esc(dfmt(v.nextEta)) : ''}.</p>${note}`;
    case 'ordered': return `<p><b>Everything approved is on order.</b>${v.nextEta ? ' Next delivery expected ' + esc(dfmt(v.nextEta)) + ' (' + esc(rel(v.nextEta)) + ').' : ''} Book each delivery in when it arrives.</p>`;
    case 'part_delivered': return `<p><b>${v.A.filter(l => l.received).length} of ${v.A.length} lines are on site.</b>${v.needOrder.length ? ' ' + plural(v.needOrder.length, 'line') + ' still to order.' : ''}${v.nextEta ? ' Next delivery expected ' + esc(dfmt(v.nextEta)) + '.' : ''}</p>`;
    case 'delivered': return `<p><b>Everything approved is on site.</b></p>`;
    case 'closed': return `<p><b>Closed by ${esc(nameOf(v.o.closed.by))}</b> on ${esc(dfmt(v.o.closed.at))}.</p>${v.o.closed.note ? `<div class="msg-b">${esc(v.o.closed.note)}</div>` : ''}`;
    case 'cancelled': return `<p><b>Cancelled${v.r.cancelBy ? ' by ' + esc(nameOf(v.r.cancelBy)) : ''}.</b></p>${v.r.cancelNote ? `<div class="msg-b">${esc(v.r.cancelNote)}</div>` : ''}`;
  }
  return '';
}
function rqActions(v){
  const dir = isDirector(), id = esc(v.id), k = v.key, B = [], more = [];
  const pre = ['sent', 'query', 'rejected', 'hold'].includes(k), act = ['approved', 'part_ordered', 'ordered', 'part_delivered'].includes(k);
  const b = (act_, label, cls, icon) => `<button type="button" class="btn ${cls || ''}" data-act="${act_}" data-id="${id}">${icon ? ICON[icon] + ' ' : ''}${label}</button>`;
  // no signal: only what can wait on the device, and printing (the letterhead is kept on the device too)
  if (S.saved) return (act && v.A.some(l => !l.received) ? `<div class="acts">${b('grn-new', 'Book a delivery in', 'primary', 'truck')}</div>` : '') + `<div class="acts">${b('rq-print', 'Print', 'sm')}</div>`;
  if (dir && pre) B.push(b('decide', k === 'sent' ? 'Decide' : 'Decide again', 'primary', 'check'));
  if (dir && v.needOrder.length) B.push(b('order-new', 'Record an order', 'primary', 'cart'));
  if (act && v.A.some(l => !l.received)) B.push(b('grn-new', 'Book a delivery in', dir && v.needOrder.length ? '' : 'primary', 'truck'));
  if (pre && (dir || canWrite())) B.push(`<a class="btn" href="#/edit/${encodeURIComponent(v.id)}">Change and send again</a>`);
  if (dir && act) more.push(b('decide', 'Change the approval', 'sm'));
  if (dir && (act || k === 'delivered')) more.push(b('rq-close', 'Close', 'sm'));
  if (dir && k === 'closed') more.push(b('rq-reopen', 'Open again', 'sm'));
  if (k === 'cancelled' && dir) more.push(b('rq-uncancel', 'Bring back', 'sm'));
  if ((pre || (dir && k === 'approved')) && !v.grns.length && !v.orders.length) more.push(b('rq-cancel', 'Cancel the requisition', 'sm danger'));
  more.push(b('rq-print', 'Print', 'sm'), b('rq-share', 'Send on WhatsApp', 'sm'));
  return `<div class="acts">${B.join('')}</div><div class="acts">${more.join('')}</div>`;
}
function linesTable(v){
  const dir = isDirector(), ap = v.approved, r = v.r;
  let tot = 0;
  const rows = v.lines.map(l => {
    const raw = r.lines[l.id] || {}, off = ap && !l.ok;
    const q = ap ? l.aq : l.asked, val = (!off && l.rate != null && q != null) ? r2(q * l.rate) : null;
    if (val != null && (ap || l.type === 'line' || !l.type)) tot += val;
    const st = off ? '<span class="pill p-n">Not approved</span>' : !ap ? '' : l.received ? '<span class="pill p-ok">On site</span>' : l.rany ? '<span class="pill p-warn">Part delivered</span>'
      : l.ordered ? '<span class="pill p-info">On order</span>' : l.oany ? '<span class="pill p-info">Part ordered</span>' : '<span class="pill p-line">To order</span>';
    return `<tr${off ? ' class="off"' : ''}>
      <td data-l="Ref">${esc(l.ref || l.n || '')}</td>
      <td class="full"><b>${esc(l.desc)}</b>${LTYPE[l.type] ? ` <span class="pill p-line">${LTYPE[l.type]}</span>` : ''} ${st}
        ${l.note ? `<span class="sub">${esc(l.note)}</span>` : ''}${l.needTxt || l.need ? `<span class="sub">Needed: ${esc(l.needTxt || dfmt(l.need))}</span>` : ''}
        ${l.rej ? `<span class="sub" style="color:var(--bad)">${qfmt(l.rej)} ${esc(l.unit || '')} rejected at delivery</span>` : ''}</td>
      <td class="num" data-l="Asked">${lineQty(l.asked, raw.unit)}</td>
      <td class="num" data-l="Approved">${!ap ? '' : off ? 'No' : lineQty(l.aq, l.unit)}</td>
      <td class="num" data-l="Ordered">${!ap || off ? '' : l.oany ? (l.aq == null && !l.oq ? 'Yes' : qfmt(l.oq)) : '0'}</td>
      <td class="num" data-l="On site">${!ap || off ? '' : l.rany ? qfmt(l.got) + (l.received ? ' ✓' : '') : l.received ? '✓' : '0'}</td>
      ${dir ? `<td class="num" data-l="Budget rate">${l.rate == null ? '' : esc(money(l.rate))}</td><td class="num" data-l="Budget value">${val == null ? '' : esc(money(val))}</td>` : ''}</tr>`;
  }).join('');
  return `<div class="tbl stackable ltbl"><table><thead><tr><th>Ref</th><th>What</th><th class="num">Asked</th><th class="num">Approved</th><th class="num">Ordered</th><th class="num">On site</th>${dir ? '<th class="num">Budget rate</th><th class="num">Budget value</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>${dir && tot ? `<tfoot><tr><td colspan="7">Budget value${ap ? ' of what is approved' : ' of the main lines'}, excl VAT${v.unpriced ? ` <span class="muted" style="font-weight:400">(${plural(v.unpriced, 'line')} without a rate)</span>` : ''}</td><td class="num">${esc(money(r2(tot)))}</td></tr></tfoot>` : ''}</table></div>
    ${dir && tot ? `<p class="small muted only-m">Budget value ${esc(money(r2(tot)))} excl VAT${v.unpriced ? ', ' + plural(v.unpriced, 'line') + ' without a rate' : ''}</p>` : ''}`;
}
function orderItem(v, k, od){
  const dir = isDirector(), c = costOf(v.id, k);
  const ls = Object.entries(od.lines || {}).map(([lid, x]) => { const l = v.lines.find(y => y.id === lid); return l ? `<li>${x && x.q != null ? qfmt(x.q) + ' ' + esc(l.unit || '') + ' ' : ''}${esc(l.desc)}</li>` : ''; }).join('');
  const m = !dir ? '' : c ? `<div class="kv"><span>${c.status === 'ordered' ? 'Order value' : 'Invoice'} <b>${esc(money(c.amount))}</b> excl VAT</span><span class="pill p-${COST_ST[c.status] ? COST_ST[c.status][0] : 'n'}">${esc(COST_ST[c.status] ? COST_ST[c.status][1] : c.status)}</span>
      ${c.inv ? `<span>invoice <b>${esc(c.inv)}</b></span>` : ''}${c.status === 'paid' && c.paidOn ? `<span>paid <b>${esc(dfmt(c.paidOn))}</b></span>` : ''}<span>${esc(codeName(c.code))}</span>
      ${c.doc ? `<button type="button" class="btn sm ghost" data-act="file-open" data-where="cost:${esc(costId(v.id, k))}" data-i="0">Open the document</button>` : ''}</div>`
    : `<div class="kv"><span class="pill p-warn">No order value entered</span></div>`;
  return `<div class="item"><div class="item-h"><b>${esc(od.supplier || 'Supplier not named')}</b>${od.ref ? `<span class="mono small">${esc(od.ref)}</span>` : ''}</div>
    <div class="kv"><span>Ordered <b>${esc(dfmt(od.date || od.at))}</b></span>${od.eta ? `<span>${dueTxt(od.eta, 'Expected')}</span>` : ''}<span>by ${esc(firstName(od.by))}</span></div>
    <ul class="notes">${ls}</ul>${od.note ? `<div class="msg-b">${esc(od.note)}</div>` : ''}${m}
    ${dir ? `<div class="acts"><button type="button" class="btn sm" data-act="cost-edit" data-id="${esc(v.id)}" data-key="${esc(k)}">${c ? 'Invoice or payment' : 'Enter the order value'}</button>
      <button type="button" class="btn sm danger" data-act="order-cancel" data-id="${esc(v.id)}" data-key="${esc(k)}">Cancel this order</button></div>` : ''}</div>`;
}
function grnItem(v, k, g){
  const dir = isDirector(), mine = S.me && g.by === S.me.id;
  const ls = Object.entries(g.lines || {}).map(([lid, x]) => {
    const l = v.lines.find(y => y.id === lid); if (!l || !x) return '';
    const bad = x.acc === 'rejected' || x.cond === 'damaged';
    return `<li${bad ? ' class="donot"' : ''}>${x.q != null ? qfmt(x.q) + ' ' + esc(l.unit || '') + ' ' : ''}${esc(l.desc)}${x.cond === 'damaged' ? ' · damaged' : ''}${x.acc === 'rejected' ? ' · rejected, sent back' : ''}${x.done && x.acc !== 'rejected' ? ' · complete' : ''}${x.rem ? ' · ' + esc(x.rem) : ''}</li>`;
  }).join('');
  const no = QF05.filter(([key]) => g.chk && g.chk[key] === 'no'), yes = QF05.filter(([key]) => g.chk && g.chk[key] === 'yes').length;
  const files = live(g.files).sort(byAt);
  return `<div class="item"><div class="item-h"><b>${esc(dfmt(g.date || g.at))}${g.time ? ' ' + esc(g.time) : ''}</b>${g.site ? '<span class="pill p-info">Bought on site</span>' : ''}</div>
    <div class="kv">${g.supplier ? `<span>from <b>${esc(g.supplier)}</b></span>` : ''}${g.dn ? `<span>delivery note <b>${esc(g.dn)}</b></span>` : ''}${g.vehicle ? `<span>vehicle or driver <b>${esc(g.vehicle)}</b></span>` : ''}
      ${g.stored ? `<span>stored at <b>${esc(g.stored)}</b></span>` : ''}<span>booked in by <b>${esc(nameOf(g.by))}</b></span>${g.site && g.amt != null ? `<span>slip total <b>${esc(money(g.amt))}</b></span>` : ''}</div>
    <ul class="notes">${ls}</ul>
    <div class="kv"><span>QF-05 checks: <b>${yes} of ${QF05.length}</b> yes</span>${no.map(([, t]) => `<span class="donot">No: ${esc(t)}</span>`).join('')}</div>
    ${g.note ? `<div class="msg-b">${esc(g.note)}</div>` : ''}${thumbsHtml(files, 'grn:' + v.id + ':' + k, dir || mine)}
    ${dir || (mine && daysTo(String(g.at).slice(0, 10)) >= -1) ? `<div class="acts"><button type="button" class="btn sm danger" data-act="grn-remove" data-id="${esc(v.id)}" data-key="${esc(k)}">Remove this delivery</button></div>` : ''}</div>`;
}
// a date with the words that came with it ("Wed 11 Nov (cement and sand); Thu 12 Nov (the rest)"): the date is not said twice
function whenParts(iso, txt){
  const d = iso ? dfmt(iso, true) : '', short = iso ? dfmt(iso) : '', plain = iso ? dfmt(iso).replace(/ \d{4}$/, '') : '';
  let t = String(txt || '').trim();
  for (const lead of [d, short, plain]) if (lead && t.toLowerCase().startsWith(lead.toLowerCase())) { t = t.slice(lead.length).replace(/^[\s,;:.-]+/, ''); break; }
  return [d, t];
}
const whenHtml = (iso, txt) => { const [d, t] = whenParts(iso, txt); return (d ? '<b>' + esc(d) + '</b> ' : '') + (t ? '<span class="muted">' + esc(t) + '</span>' : ''); };
PAGES.rq = {
  title: route => (S.rq.get(route.seg[1]) || {}).no || 'Requisition',
  render(route){
    const id = route.seg[1], v = view(id), dir = isDirector();
    if (!v) return `<div class="stack"><a class="btn sm ghost" href="#/list">${ICON.back} Requisitions</a>${emptyBox('Not found', 'This requisition is not on the register (it may have been removed).')}</div>`;
    const r = v.r, M = v.M || {}, T = timeline(v);
    const fact = (k, val) => val ? `<div class="fact"><dt>${esc(k)}</dt><dd>${val}</dd></div>` : '';
    const notes = (r.notes || []).map((t, i) => fullOf(v.M, 'nn', 'nns', i, t));
    return `<div class="stack">
      <div><a class="btn sm ghost" href="#/list">${ICON.back} Requisitions</a></div>
      <div class="panel rq-head">
        <div class="flex"><span class="rq-no">${esc(r.no || 'New')}</span>${stPill(v)}${r.urgent ? '<span class="pill p-bad">Urgent</span>' : ''}${v.orderLate ? '<span class="pill p-bad">Order late</span>' : ''}${v.late ? '<span class="pill p-bad">Delivery late</span>' : ''}</div>
        <h2 class="rq-title">${esc(r.title || 'Requisition')}</h2>
        ${v.key === 'cancelled' ? '' : stepsHtml(v)}
        ${statusLine(v)}
        ${v.tampered && dir ? `<div class="notice warn">The lines were changed after the approval without the requisition being sent again. The approval covers only what was approved: check the "Asked" and "Approved" columns.</div>` : ''}
        ${rqActions(v)}
      </div>
      <section class="sec"><div class="sec-h"><h3>Lines</h3><span class="muted small">${plural(v.lines.length, 'line')}</span></div>${linesTable(v)}</section>
      ${(r.hold || []).length ? `<section class="sec"><h3 class="donot">Do not buy</h3><div class="panel flat"><ul class="notes donot">${r.hold.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div></section>` : ''}
      ${r.note || notes.length ? `<section class="sec"><h3>Notes</h3><div class="panel flat stack">${r.note ? `<div class="msg-b">${esc(r.note)}</div>` : ''}${notes.length ? `<ul class="notes">${notes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div></section>` : ''}
      <section class="sec"><h3>Details</h3><div class="panel flat"><dl class="facts">
        ${fact('Needed on site', whenHtml(r.needBy, r.needTxt))}
        ${fact('Deliver to', esc(r.deliverTo || ''))}
        ${fact('Work front', esc(r.front || ''))}
        ${fact('Order by', whenHtml(r.orderBy, r.orderTxt))}
        ${fact('When to order', esc(r.release || ''))}
        ${fact('Programme activity', esc(r.wbs || ''))}
        ${fact('Method statement or drawing', esc(r.ms || ''))}
        ${fact('Asked by', esc(whoOf(r)) + (r.sentAt ? ' <span class="muted">' + esc(tfmt(r.sentAt)) + '</span>' : ''))}
        ${dir ? fact('Paid under', esc(M.pay || '')) + fact('Budget line', esc(codeName(M.code || ''))) + fact('Money on this requisition', [v.est ? 'budget ' + esc(money(v.est)) : '', v.ov ? 'on order ' + esc(money(v.ov)) : '', v.inv ? 'invoiced ' + esc(money(v.inv)) : '', v.paid ? 'paid ' + esc(money(v.paid)) : ''].filter(Boolean).join(' · ')) : ''}
      </dl></div></section>
      ${v.orders.length || (dir && v.needOrder.length) ? `<section class="sec"><div class="sec-h"><h3>Orders</h3>${dir && v.needOrder.length && !S.saved ? `<button type="button" class="btn sm" data-act="order-new" data-id="${esc(id)}">Record an order</button>` : ''}</div>
        ${v.orders.length ? v.orders.map(([k, od]) => orderItem(v, k, od)).join('') : emptyBox('No order yet', plural(v.needOrder.length, 'approved line') + ' to order.')}</section>` : ''}
      ${v.grns.length ? `<section class="sec"><h3>Deliveries</h3>${v.grns.map(([k, g]) => grnItem(v, k, g)).join('')}</section>` : ''}
      <section class="sec"><div class="sec-h"><h3>Photos and documents</h3><span class="muted small">quotes, sketches, photos of what is needed</span></div>
        <div class="thumbs-wrap">${thumbsHtml(v.files, 'rq:' + id, dir || canWrite())}${S.saved ? '' : `<div class="thumbs" style="margin-top:${v.files.length ? 8 : 0}px">${addTile('rqfile:' + id)}</div>`}</div></section>
      <section class="sec"><h3>Messages and history</h3><div class="panel flat stack">
        <ul class="feed">${T.map(e => `<li><span class="dot ${e.tone}"></span><div>${e.msg ? `<b>${esc(e.who)}</b><div class="msg-b">${esc(e.text)}</div>` : `${esc(e.text)} <span class="muted">· ${esc(e.who)}</span>`}<div class="when">${esc(tfmt(e.at))}</div></div></li>`).join('')}</ul>
        ${S.saved ? '' : `<form class="form" data-form="msg" data-id="${esc(id)}"><label>Message to ${dir ? 'the site team' : 'the office'}<textarea name="t" rows="2" maxlength="2000" data-keep="msg-${esc(id)}" placeholder="${dir ? 'For example: ordered from BuildIt, the truck comes Thursday morning' : 'For example: the supplier has only 30 bags, can we take the rest next week?'}"></textarea></label>
          <div class="acts"><button class="btn primary" type="submit">Send message</button></div></form>`}
      </div></section>
    </div>`;
  },
  after(root, route){
    if (route.q.get('do') === 'decide' && isDirector()) { history.replaceState(null, '', '#/rq/' + encodeURIComponent(route.seg[1])); SHOWN = location.hash; openDecision(route.seg[1]); }
  },
};

// a short question in a sheet (a note for a hold, a reason for a cancellation); resolves with the text, or null when closed
function askNote(o){
  return new Promise(res => {
    SHEET = {kind: 'ask', done: res};
    openSheet(o.title, `<form data-form="ask"><div class="sheet-bd">${o.text ? `<p>${o.text}</p>` : ''}
      <label class="fl">${esc(o.label || 'Note')}${o.required ? '' : ' <span class="opt">optional</span>'}<textarea name="t" rows="3" maxlength="1000" autofocus${o.required ? ' required' : ''}></textarea></label></div>
      <div class="sheet-ft"><button type="button" class="btn" data-act="sheet-close">Back</button><button type="submit" class="btn ${o.danger ? 'danger' : 'primary'}">${esc(o.ok || 'Save')}</button></div></form>`);
  });
}
FORMS.ask = f => { const s = SHEET; if (!s || s.kind !== 'ask') return; const t = f.elements.t.value.trim(), done = s.done; s.done = null; closeSheet(true); done(t); };

FORMS.msg = async f => {
  const t = f.elements.t.value.trim(), id = f.dataset.id; if (!t) return;
  if (!needOnline()) return;
  const btn = $('button[type=submit]', f); working(btn, true, 'Sending…');
  try { await docPatch('rq', id, {msgs: {[newKey(8)]: {t, by: S.me.id, at: nowISO()}}}); f.elements.t.value = ''; toast('Message sent.'); refresh(); }
  finally { working(btn, false); }
};
PICKS.rqfile = async (files, input) => {
  const id = input.dataset.pick.split(':')[1]; if (!needOnline()) return;
  const list = await prepFiles(files); if (!list.length) return;
  toast('Uploading ' + plural(list.length, 'file') + '…');
  const map = await uploadPrepared(list, 2);
  await docPatch('rq', id, {files: map});
  toast(plural(list.length, 'file') + ' added.'); refresh();
};
ACT['rq-cancel'] = async t => {
  if (!needOnline()) return;
  const id = t.dataset.id, note = await askNote({title: 'Cancel the requisition', label: 'Why is it cancelled?', ok: 'Cancel the requisition', danger: true, required: true}); if (note == null) return;
  await docPatch('rq', id, {state: 'cancelled', cancelBy: S.me.id, cancelAt: nowISO(), cancelNote: note}); toast('Cancelled.'); refresh();
};
ACT['rq-uncancel'] = async t => { if (!needOnline()) return; await docPatch('rq', t.dataset.id, {state: 'sent', cancelBy: null, cancelAt: null, cancelNote: null, hist: {[newKey(8)]: {t: 'Brought back after being cancelled', by: S.me.id, at: nowISO()}}}); toast('Back on the register.'); refresh(); };
ACT['rq-close'] = async t => {
  if (!needOnline()) return;
  const id = t.dataset.id, v = view(id), open = v ? v.A.filter(l => !l.received).length : 0;
  const note = await askNote({title: 'Close ' + ((v && v.r.no) || 'the requisition'), text: open ? `<b>${plural(open, 'approved line')}</b> ${open === 1 ? 'is' : 'are'} not on site yet. Closing means nothing more is expected on this requisition.` : 'Everything approved is on site. Closing takes it off the open lists.', label: 'Note', ok: 'Close it'});
  if (note == null) return;
  await officePatch(id, {closed: {by: S.me.id, at: nowISO(), note}}); toast('Closed.'); refresh();
};
ACT['rq-reopen'] = async t => { if (!needOnline()) return; await officePatch(t.dataset.id, {closed: null}); toast('Open again.'); refresh(); };
ACT['rq-share'] = t => {
  const v = view(t.dataset.id); if (!v) return;
  const r = v.r, txt = `${r.no} ${r.title}\n${v.st.label}${r.needBy ? ', needed ' + dfmt(r.needBy) : ''}${v.dec && v.dec.note ? '\n' + v.dec.note : ''}\n${appLink('#/rq/' + encodeURIComponent(v.id))}`;
  window.open(waLink(txt), '_blank', 'noopener');
};
ACT['order-cancel'] = async t => {
  if (!needOnline() || !isDirector()) return;
  const id = t.dataset.id, k = t.dataset.key, c = costOf(id, k);
  if (!confirm('Cancel this order? Its lines go back to "to order".' + (c ? ' Its entry in the cost ledger (' + money(c.amount) + ') is removed too.' : ''))) return;
  // The ledger entry goes first. If a save fails after that, the order is still there (without a value) and can be
  // cancelled again; the other way round would leave a cost in the ledger that this app no longer shows.
  if (c) await docDelete('costs', costId(id, k));
  try { await docPatch('rq', id, {orders: {[k]: {x: true, xBy: S.me.id, xAt: nowISO()}}}); }
  catch (e) { refresh(); toast(`The order is not cancelled yet${c ? ', but its value is already off the cost ledger' : ''} (${why(e)}). Cancel it again.`, true); return; }
  toast('Order cancelled.'); refresh();
};
ACT['grn-remove'] = async t => {
  if (!needOnline()) return;
  if (!confirm('Remove this delivery? Use this only when it was booked in by mistake.')) return;
  await docPatch('rq', t.dataset.id, {grn: {[t.dataset.key]: {x: true, xBy: S.me.id, xAt: nowISO()}}}); toast('Delivery removed.'); refresh();
};

// ---------- the decision (directors) ----------
function openDecision(id){
  const v = view(id); if (!v || !isDirector() || !needOnline()) return;
  const r = v.r, M = v.M || {}, prev = v.approved ? v.dec : null;
  SHEET = {kind: 'decide', id};
  const rows = v.lines.map(l => {
    const raw = r.lines[l.id] || {}, was = prev ? (prev.lines || {})[l.id] : null;
    const on = was ? !!was.ok : l.type !== 'option', q = was && was.ok ? was.qty : raw.qty;
    return `<div class="lc"><label class="check"><input type="checkbox" name="ok.${esc(l.id)}"${on ? ' checked' : ''} data-sum>
        <span><b>${esc(fullOf(v.M, 'ld', 'ls', l.id, raw.desc))}</b>${LTYPE[l.type] ? ` <span class="pill p-line">${LTYPE[l.type]}</span>` : ''}${l.note ? `<span class="muted small" style="display:block;font-weight:400">${esc(l.note)}</span>` : ''}</span></label>
      <div class="frow"><label>Approve <span class="opt">asked ${lineQty(raw.qty, raw.unit)}</span><input name="q.${esc(l.id)}" inputmode="decimal" autocomplete="off" value="${q == null ? '' : esc(q)}" placeholder="To be confirmed" data-sum></label>
        <label>Budget rate, R <span class="opt">optional</span><input name="r.${esc(l.id)}" inputmode="decimal" autocomplete="off" value="${l.rate == null ? '' : esc(l.rate)}" data-sum></label></div></div>`;
  }).join('');
  openSheet((prev ? 'Change the approval of ' : 'Decide on ') + (r.no || 'the requisition'), `<form data-form="decide"><div class="sheet-bd">
      <div><b>${esc(r.title || '')}</b><div class="kv">${r.needBy ? `<span>${dueTxt(r.needBy, 'Needed')}</span>` : ''}<span>asked by <b>${esc(whoOf(r))}</b></span>${r.urgent ? '<span class="pill p-bad">Urgent</span>' : ''}</div>${r.release ? `<p class="small muted" style="margin-top:4px">${esc(r.release)}</p>` : ''}</div>
      ${(r.hold || []).length ? `<div class="notice bad"><b>Do not buy:</b> ${r.hold.map(esc).join(' ')}</div>` : ''}
      <div class="lines">${rows}</div>
      <div class="notice info" id="decSum" role="status"></div>
      <div class="frow"><label>Budget line <span class="opt">for the cost ledger</span><select name="code">${codeOptions(M.code || '')}</select></label>
        <label>Paid under <span class="opt">bill item, dayworks</span><input name="pay" maxlength="300" value="${esc(M.pay || '')}"></label></div>
      <label class="fl">Note to the site <span class="opt">needed for a question, a hold or a refusal</span><textarea name="note" rows="2" maxlength="1000">${prev ? esc(prev.note || '') : ''}</textarea></label>
    </div><div class="sheet-ft"><button type="submit" class="btn danger" data-state="rejected">Do not approve</button><button type="submit" class="btn" data-state="hold">Hold</button>
      <button type="submit" class="btn" data-state="query">Ask a question</button><button type="submit" class="btn ok" data-state="approved">${ICON.check} Approve</button></div></form>`);
  decSum();
}
function decRead(f, r){
  const lines = {}, rates = {}; let n = 0, tot = 0, bare = 0, bad = null;
  for (const l of linesOf(r)) {
    const ok = f.elements['ok.' + l.id].checked, qs = f.elements['q.' + l.id].value.trim(), rs = f.elements['r.' + l.id].value.trim(), q = num(qs), rate = num(rs);
    if ((qs && q == null) || (rs && rate == null) || (q != null && q < 0) || (rate != null && rate < 0)) bad = l;
    lines[l.id] = ok ? {ok, qty: q, desc: l.desc || '', unit: l.unit || ''} : {ok, qty: null}; rates[l.id] = rate;
    if (ok) { n++; if (q != null && rate != null) tot += q * rate; else bare++; }
  }
  return {lines, rates, n, tot: r2(tot), bare, bad};
}
function decSum(){
  const f = $('#sheet form[data-form="decide"]'), el = $('#decSum'); if (!f || !SHEET || !el) return;
  const d = decRead(f, S.rq.get(SHEET.id));
  el.innerHTML = d.bad ? `<span class="err">Check the numbers on "${esc(String(d.bad.desc).slice(0, 60))}".</span>`
    : `<b>${plural(d.n, 'line')}</b> ticked for approval. Budget value <b>${esc(money(d.tot))}</b> excl VAT${d.bare ? ` <span class="muted">(${plural(d.bare, 'line')} without a rate or quantity)</span>` : ''}.`;
}
document.addEventListener('input', ev => { if (SHEET && SHEET.kind === 'decide' && ev.target.dataset && 'sum' in ev.target.dataset) decSum(); });
document.addEventListener('change', ev => { if (SHEET && SHEET.kind === 'decide' && ev.target.dataset && 'sum' in ev.target.dataset) decSum(); });
async function moneyPatch(id, patch){
  if (S.bud.has('rq.' + id)) return docPatch('budget', 'rq.' + id, {...patch, at: nowISO(), by: S.me.id});
  const g = await rpc('sb_get', {p_path: 'budget/rq.' + id});
  if (g && g.exists) { putDoc('budget', 'rq.' + id, g.data, g.rev); return docPatch('budget', 'rq.' + id, {...patch, at: nowISO(), by: S.me.id}); }
  return docSet('budget', 'rq.' + id, {v: 1, ...patch, at: nowISO(), by: S.me.id});
}
FORMS.decide = async (f, ev) => {
  const sub = ev.submitter, state = (sub && sub.dataset.state) || 'approved', id = SHEET && SHEET.id, r = S.rq.get(id); if (!r) return;
  const note = f.elements.note.value.trim(), d = decRead(f, r);
  if (d.bad) { toast('Check the numbers: a quantity or a rate is not a number.', true); return; }
  if (state !== 'approved' && !note) { toast('Write a short note, so the site knows what you need.', true); f.elements.note.focus(); return; }
  if (state === 'approved' && !d.n) { toast('Tick at least one line to approve.', true); return; }
  working(sub, true);
  try {
    const key = newKey(8), now = nowISO(), dec = {state, by: S.me.id, at: now, note, rev: r.rev || 1, sig: sigOf(r)};
    if (state === 'approved') dec.lines = d.lines;
    await officePatch(id, {dec: {[key]: dec}, cur: key});
    const rates = {}; for (const [k, val] of Object.entries(d.rates)) if (val != null || rateOf(id, k) != null) rates[k] = val;
    let lost = null;                                   // the budget line and rates are a second save, in the directors' own record
    await moneyPatch(id, {rates, code: f.elements.code.value || null, pay: f.elements.pay.value.trim()}).catch(e => { lost = e; });
    closeSheet(true); refresh();
    if (lost) toast(`The decision is saved, but the budget line and rates are not (${why(lost)}). Decide on it again to enter them.`, true);
    else toast({approved: 'Approved. It now shows under Buying.', query: 'Question sent to the site.', hold: 'Put on hold.', rejected: 'Marked as not approved.'}[state]);
  } finally { working(sub, false); }
};
ACT.decide = t => { if (ROUTE.name === 'rq' && ROUTE.seg[1] === t.dataset.id) openDecision(t.dataset.id); else go('#/rq/' + encodeURIComponent(t.dataset.id) + '?do=decide'); };
