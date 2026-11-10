// ---------- the first page: what needs doing today ----------
// The site team sees its two jobs (ask for materials, book a delivery in) and what the office has sent back.
// The directors see what is waiting for a decision, what must be ordered, what is on its way and the money.
const section = (title, sub, html, more) => `<section class="sec"><div class="sec-h"><h3>${esc(title)}${sub ? ` <span class="muted small" style="font-family:var(--f-body);font-weight:400">${sub}</span>` : ''}</h3>${more || ''}</div>${html}</section>`;
function outboxHtml(){
  const L = OUT.filter(x => x.state !== 'sending'); if (!L.length) return '';
  const row = it => {
    const what = it.kind === 'grn' ? 'Delivery for ' + ((S.rq.get(it.rqId) || {}).no || 'a requisition') : (it.body && it.body.title) || 'Requisition without a title';
    const st = it.state === 'draft' ? '<span class="pill p-n">Draft, not sent</span>' : it.state === 'error' ? '<span class="pill p-bad">Not sent</span>' : '<span class="pill p-warn">Waiting for a signal</span>';
    return `<div class="card c-${it.state === 'error' ? 'bad' : it.state === 'draft' ? 'n' : 'warn'}"><div class="card-top">${st}<span class="muted small">${esc(ago(it.at))}</span></div>
      <div class="card-t">${esc(what)}</div>${it.err ? `<div class="err">${esc(it.err)}</div>` : ''}
      <div class="card-acts">${it.kind === 'rq' ? `<a class="btn sm" href="#/${it.mode === 'edit' ? 'edit/' + encodeURIComponent(it.rqId) : 'new'}?d=${encodeURIComponent(it.id)}">${it.state === 'draft' ? 'Carry on' : 'Open'}</a>` : ''}
      ${it.state !== 'draft' ? `<button type="button" class="btn sm" data-act="out-send">Send now</button>` : ''}
      <button type="button" class="btn sm danger" data-act="out-drop" data-id="${esc(it.id)}">Delete</button></div></div>`;
  };
  return section('On this device', 'not with the office yet', `<div class="cards">${L.map(row).join('')}</div>`);
}
ACT['out-drop'] = async t => {
  if (!confirm('Delete this from the device? It has not been sent to the office.')) return;
  await outDel(t.dataset.id); await outRefresh(); refresh();
};
function expectCard(v){
  const L = v.expect.slice(0, 4).map(l => `<li>${esc(l.desc)} <span class="muted">· ${l.toCome == null ? 'on order' : lineQty(l.toCome, l.unit) + ' to come'}</span></li>`).join('');
  const sup = [...new Set(v.orders.filter(([, o]) => Object.keys(o.lines || {}).some(k => v.expect.some(l => l.id === k))).map(([, o]) => o.supplier).filter(Boolean))];
  return rqCard(v, {tone: v.late ? 'bad' : 'info', who: false, extra: `<ul class="notes">${L}${v.expect.length > 4 ? `<li class="muted">and ${v.expect.length - 4} more</li>` : ''}</ul>
    <div class="card-m">${v.nextEta ? `<span>${dueTxt(v.nextEta, 'Expected')}</span>` : ''}${sup.length ? `<span>from <b>${esc(sup.join(', '))}</b></span>` : ''}</div>
    <div class="card-acts"><span class="btn sm primary" data-act="grn-new" data-id="${esc(v.id)}" role="button" tabindex="0">${ICON.truck} Book it in</span></div>`});
}
function homeSite(){
  const V = allViews(), me = S.me || {};
  const back = V.filter(v => v.key === 'query' || v.key === 'rejected').sort(byNeed);
  const coming = V.filter(v => v.expect.length).sort((a, b) => String(a.nextEta || '9999').localeCompare(String(b.nextEta || '9999')));
  const waiting = V.filter(v => ['sent', 'hold', 'approved', 'part_ordered'].includes(v.key) && !v.expect.length).sort(byNeed);
  const done = V.filter(v => v.key === 'delivered').slice(0, 4);
  return `<div class="stack">
    ${pageHead('Hello ' + (me.name || '').split(/\s+/)[0], esc(SITE_NAME) + ' · ' + esc(dfmt(today(), true)))}
    <div class="hero"><a class="btn primary" href="#/new">${ICON.plus}<span>New requisition</span></a><a class="btn" href="#/in">${ICON.truck}<span>Book a delivery in</span></a></div>
    ${outboxHtml()}
    ${back.length ? section('The office is waiting for you', '', `<div class="cards">${back.map(v => rqCard(v, {extra: v.dec && v.dec.note ? `<div class="msg-b">${esc(v.dec.note)}</div>` : ''})).join('')}</div>`) : ''}
    ${section('Deliveries expected', coming.length ? plural(coming.length, 'requisition') : '', coming.length ? `<div class="cards">${coming.map(expectCard).join('')}</div>` : emptyBox('Nothing on order yet', 'When the office orders, the delivery shows here for you to book in.'))}
    ${waiting.length ? section('With the office', 'being approved or ordered', `<div class="cards">${waiting.map(v => rqCard(v)).join('')}</div>`) : ''}
    ${done.length ? section('Delivered lately', '', `<div class="cards">${done.map(v => rqCard(v, {who: false})).join('')}</div>`, '<a class="btn sm ghost" href="#/list?f=done">All</a>') : ''}
    ${!V.length && !OUT.length ? emptyBox('No requisitions yet', 'Tap "New requisition" to ask the office for materials, plant or tools.') : ''}
  </div>`;
}
function homeDirector(){
  const V = allViews();
  const appr = V.filter(v => v.key === 'sent').sort((a, b) => (b.r.urgent ? 1 : 0) - (a.r.urgent ? 1 : 0) || byNeed(a, b));
  const buy = V.filter(v => v.needOrder.length).sort((a, b) => String(a.r.orderBy || '9999').localeCompare(String(b.r.orderBy || '9999')) || byNeed(a, b));
  const coming = V.filter(v => v.expect.length).sort((a, b) => String(a.nextEta || '9999').localeCompare(String(b.nextEta || '9999')));
  const office = V.filter(v => v.key === 'query' || v.key === 'hold');
  const wk = addDays(today(), -7), got = V.reduce((n, v) => n + v.grns.filter(([, g]) => (g.date || String(g.at).slice(0, 10)) >= wk).length, 0);
  const buyLate = buy.filter(v => v.orderLate).length, late = coming.filter(v => v.late).length;
  const sum = k => r2(V.reduce((a, v) => a + (v[k] || 0), 0));
  const estOpen = r2(buy.reduce((a, v) => a + v.needOrder.reduce((b, l) => b + ((l.toOrder != null && l.rate != null) ? l.toOrder * l.rate : 0), 0), 0));
  const unval = V.reduce((n, v) => n + (OPEN_STATES.includes(v.key) || v.key === 'delivered' ? v.unvalued : 0), 0);
  const tile = (k, v, s, tone, h) => `<a class="tile t-${tone}" href="${h}"><span class="k">${esc(k)}</span><span class="v">${v}</span><span class="s">${s}</span></a>`;
  const feed = [];
  for (const v of V) {
    for (const [k, g] of v.grns) feed.push({at: g.at, id: v.id, tone: 'ok', text: `${esc(firstName(g.by))} booked a delivery in for <b>${esc(v.r.no)}</b>${g.supplier ? ' from ' + esc(g.supplier) : ''}`});
    for (const [k, m] of v.msgs) if (!S.me || m.by !== S.me.id) feed.push({at: m.at, id: v.id, tone: 'info', text: `${esc(firstName(m.by))} on <b>${esc(v.r.no)}</b>: ${esc(String(m.t).slice(0, 140))}`});
    if (v.r.sentAt && v.r.by) feed.push({at: v.r.sentAt, id: v.id, tone: 'brand', text: `${esc(firstName(v.r.by))} sent <b>${esc(v.r.no)}</b> ${esc(v.r.title || '')}`});
  }
  feed.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return `<div class="stack">
    ${pageHead('Dashboard', esc(SITE_NAME) + ' · requisitions, orders and deliveries · ' + esc(dfmt(today(), true)), `<a class="btn primary" href="#/new">${ICON.plus} New requisition</a>`)}
    <div class="tiles">
      ${tile('To approve', appr.length, appr.length ? (appr.some(v => v.r.urgent) ? 'urgent among them' : 'waiting for a director') : 'nothing waiting', appr.length ? 'warn' : 'ok', '#/list?f=approve')}
      ${tile('To order', buy.length, buy.length ? (buyLate ? `<b style="color:var(--bad)">${buyLate} past the order date</b>` : 'approved, not ordered yet') : 'nothing to order', buyLate ? 'bad' : buy.length ? 'info' : 'ok', '#/buy')}
      ${tile('On order', coming.length, coming.length ? (late ? `<b style="color:var(--bad)">${late} late</b>` : 'on their way to site') : 'nothing on its way', late ? 'bad' : 'info', '#/in')}
      ${tile('Delivered', got, 'deliveries booked in, last 7 days', 'ok', '#/in')}
    </div>
    <div class="tiles">
      ${tile('Still to order', esc(moneyK(estOpen)), 'budget value of the approved lines not ordered', 'brand', '#/buy')}
      ${tile('On order', esc(moneyK(sum('ov'))), unval ? `<b style="color:var(--warn)">${unval} without a value yet</b>` : 'ordered, no invoice yet', unval ? 'warn' : 'brand', '#/money')}
      ${tile('Invoices to pay', esc(moneyK(sum('inv'))), 'invoiced, not paid', sum('inv') ? 'warn' : 'brand', '#/money?f=invoiced')}
      ${tile('Paid', esc(moneyK(sum('paid'))), 'on requisitions, excl VAT', 'brand', '#/money?f=paid')}
    </div>
    ${outboxHtml()}
    <div class="g2">
      ${section('To approve', '', appr.length ? `<div class="cards">${appr.map(v => rqCard(v, {extra: `<div class="card-acts"><span class="btn sm primary" role="button" tabindex="0" data-act="decide" data-id="${esc(v.id)}">Decide</span></div>`})).join('')}</div>` : emptyBox('Nothing to approve', 'New requisitions from site show here.'))}
      ${section('Order next', buy.length ? 'by order date' : '', buy.length ? `<div class="cards">${buy.slice(0, 6).map(v => rqCard(v, {order: true, who: false, extra: `<div class="card-m"><span>${plural(v.needOrder.length, 'line')} to order</span></div>`})).join('')}</div>${buy.length > 6 ? `<a class="btn sm ghost" href="#/buy">All ${buy.length}</a>` : ''}` : emptyBox('Nothing to order', 'Approved lines that are not ordered yet show here.'))}
    </div>
    <div class="g2">
      ${section('Deliveries due', '', coming.length ? `<div class="cards">${coming.slice(0, 6).map(v => rqCard(v, {tone: v.late ? 'bad' : 'info', who: false, extra: `<div class="card-m">${v.nextEta ? `<span>${dueTxt(v.nextEta, 'Expected')}</span>` : ''}<span>${plural(v.expect.length, 'line')} to come</span></div>`})).join('')}</div>` : emptyBox('Nothing on its way', 'Orders show here until the site books the delivery in.'))}
      ${section('Latest from site', '', feed.length ? `<div class="panel flat"><ul class="feed">${feed.slice(0, 8).map(f => `<li><span class="dot ${f.tone}"></span><div><a href="#/rq/${encodeURIComponent(f.id)}" style="color:inherit;text-decoration:none">${f.text}</a><div class="when">${esc(ago(f.at))}</div></div></li>`).join('')}</ul></div>` : emptyBox('Nothing yet', 'Messages, new requisitions and deliveries from site show here.'))}
    </div>
    ${office.length ? section('Waiting for site, or on hold', '', `<div class="cards">${office.map(v => rqCard(v)).join('')}</div>`) : ''}
  </div>`;
}
PAGES.home = {title: () => isDirector() ? 'Dashboard' : 'Home', render: () => isDirector() ? homeDirector() : homeSite()};
