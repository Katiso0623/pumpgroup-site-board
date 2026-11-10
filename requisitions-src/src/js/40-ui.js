// ---------- the screen: pages, the two bars, sheets, messages ----------
let ROUTE = {seg: [], q: new URLSearchParams(), name: 'home'};
const PAGES = {};      // name -> {title, render(route) -> html, after(root, route), dir (directors only), form (do not redraw while open)}
const ACT = {};        // what a tap on [data-act] does
const FORMS = {};      // what sending a <form data-form> does
const PICKS = {};      // what happens with files picked in <input type=file data-pick>

function parseHash(){
  const h = location.hash.replace(/^#\/?/, ''), [path, qs] = h.split('?');
  const seg = path.split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  return {seg, q: new URLSearchParams(qs || ''), name: seg[0] || 'home'};
}
function go(h){ if (location.hash === h) render(true); else location.hash = h; }
function navItems(){
  const V = allViews(), n = f => V.filter(f).length;
  return isDirector() ? [
    {h: '#/', k: 'home', label: 'Dashboard', icon: 'home', n: n(v => v.key === 'sent')},
    {h: '#/list', k: 'list', label: 'Requisitions', icon: 'list'},
    {h: '#/buy', k: 'buy', label: 'Buying', icon: 'cart', n: n(v => v.needOrder.length > 0)},
    {h: '#/in', k: 'in', label: 'Deliveries', icon: 'truck', n: n(v => v.expect.length > 0), quiet: true},
    {h: '#/money', k: 'money', label: 'Money', icon: 'money'},
  ] : [
    {h: '#/', k: 'home', label: 'Home', icon: 'home', n: n(v => v.key === 'query' || v.key === 'rejected')},
    {h: '#/list', k: 'list', label: 'Requisitions', icon: 'list'},
    {h: '#/new', k: 'new', label: 'New', icon: 'plus', plus: true},
    {h: '#/in', k: 'in', label: 'Deliveries', icon: 'truck', n: n(v => v.expect.length > 0), quiet: true},
  ];
}
function drawNav(){
  const cur = {rq: 'list', edit: 'new', new: isDirector() ? 'list' : 'new', team: 'home'}[ROUTE.name] || ROUTE.name, items = navItems();
  const badge = it => it.n ? `<span class="badge${it.quiet ? ' n' : ''}">${it.n}</span>` : '';
  $('#nav').innerHTML = items.filter(it => !it.plus).map(it => `<a href="${it.h}"${it.k === cur ? ' aria-current="page"' : ''}>${esc(it.label)}${badge(it)}</a>`).join('')
    + (isDirector() ? '' : `<a href="#/new"${cur === 'new' ? ' aria-current="page"' : ''}>New requisition</a>`);
  $('#bnav').innerHTML = items.map(it => it.plus
    ? `<a href="${it.h}" class="plus" aria-label="New requisition"><i>${ICON.plus}</i><span>${esc(it.label)}</span></a>`
    : `<a href="${it.h}"${it.k === cur ? ' aria-current="page"' : ''}>${ICON[it.icon]}<span>${esc(it.label)}</span>${badge(it)}</a>`).join('');
}
function drawBanner(){
  const el = $('#banner'); if (!el || !S.ready) return;
  const B = [], w = outWaiting(), bad = w.find(x => x.state === 'error');
  if (S.saved) B.push(`<div class="notice warn"><b>No connection.</b> This is the copy this device saved ${esc(ago(S.saved))}. You can still write a requisition or book a delivery: it is kept here and sent when the signal is back.</div>`);
  if (w.length) B.push(`<div class="notice ${bad ? 'bad' : 'info'}"><div class="flex between"><span><b>${plural(w.length, 'item')} on this device</b> still to be sent to the office.${bad ? ' One could not be sent: ' + esc(bad.err || 'unknown reason') + '.' : ''}</span>
    <span class="acts"><button type="button" class="btn sm" data-act="out-send">Send now</button><a class="btn sm ghost" href="#/">See them</a></span></div></div>`);
  if (S.setup === false && S.lvl >= 4 && !S.saved) B.push(`<div class="notice warn"><b>One set-up step is still open.</b> The access rule for requisitions is not in the database yet. Until it is, do not give the site team logins here: a site login could approve, and a Site Board viewer could open requisitions.</div>`);
  el.innerHTML = B.join('');
}

// what the person has typed on a page that redraws itself (a search box, a message being written) is kept across the redraw
function keepInputs(root){
  const act = document.activeElement, out = {vals: {}, focus: null};
  for (const el of $$('[data-keep]', root)) out.vals[el.dataset.keep] = el.value;
  if (act && root.contains(act) && act.dataset && act.dataset.keep) out.focus = {k: act.dataset.keep, a: act.selectionStart, b: act.selectionEnd};
  return out;
}
function restoreInputs(root, kept){
  for (const el of $$('[data-keep]', root)) if (kept.vals[el.dataset.keep] != null && el.value !== kept.vals[el.dataset.keep]) el.value = kept.vals[el.dataset.keep];
  if (kept.focus) { const el = $(`[data-keep="${CSS.escape(kept.focus.k)}"]`, root); if (el) { el.focus({preventScroll: true}); try { el.setSelectionRange(kept.focus.a, kept.focus.b); } catch (e) {} } }
}
let SHOWN = '';
function render(nav){
  if (!S.ready) return;
  ROUTE = parseHash();
  let page = PAGES[ROUTE.name];
  if (!page || (page.dir && !isDirector())) { if (location.hash !== '#/' && location.hash !== '') { location.replace('#/'); return; } page = PAGES.home; ROUTE.name = 'home'; }
  VIEWS = new Map();
  drawNav(); drawBanner();
  const el = $('#view'), sameHash = SHOWN === location.hash;
  if (sameHash && page.form && !nav) return;             // someone is filling a form in: new data must not wipe it
  const kept = !nav && el.dataset.page === ROUTE.name ? keepInputs(el) : {vals: {}, focus: null};
  let html;
  try { html = page.render(ROUTE); }
  catch (e) { console.error(e); html = `<div class="notice bad">This page could not be shown (${esc(errText(e))}). <a href="#/">Back to the start</a></div>`; }
  if (html == null) return;                               // the page sent the person somewhere else
  const moved = SHOWN.split('?')[0] !== location.hash.split('?')[0];
  el.innerHTML = html; el.dataset.page = ROUTE.name; SHOWN = location.hash;
  restoreInputs(el, kept);
  try { if (page.after) page.after(el, ROUTE); } catch (e) { console.error(e); }
  hydrateThumbs(el);
  document.title = (page.title ? (typeof page.title === 'function' ? page.title(ROUTE) : page.title) + ' · ' : '') + 'Requisitions · Mashaeng';
  if (nav && moved) window.scrollTo(0, 0);
}
// new data arrived, or something was saved: draw the page again
function refresh(){ if (S.ready) render(false); }
window.addEventListener('hashchange', () => { closeSheet(true); render(true); const m = $('#view'); if (m) m.focus({preventScroll: true}); });

// ---------- sheets ----------
function openSheet(title, html){
  const d = $('#sheet');
  d.innerHTML = `<div class="sheet-hd"><h2>${esc(title)}</h2><button type="button" class="sheet-x" data-act="sheet-close" aria-label="Close">×</button></div>${html}`;
  if (!d.open) d.showModal();
  d.scrollTop = 0; hydrateThumbs(d);
  const f = $('[autofocus]', d); if (f) f.focus();     // at once, never a moment later: a late jump of the cursor sends what is typed next into the wrong field
  return d;
}
let SHEET = null;      // what the open sheet is working on
function closeSheet(quiet){
  const d = $('#sheet'), s = SHEET; SHEET = null;
  if (d && d.open) d.close(); if (d) d.innerHTML = '';
  if (s && s.done) s.done(null);                          // a question that was closed without an answer
  if (s && s.files) for (const f of s.files) { try { URL.revokeObjectURL(f.url); } catch (e) {} }
  if (!quiet) refresh();
}
ACT['sheet-close'] = () => closeSheet();
document.addEventListener('cancel', ev => { if (ev.target.id === 'sheet') { ev.preventDefault(); closeSheet(); } }, true);
ACT['viewer-close'] = () => { VIEWING = null; const d = $('#viewer'); if (d.open) d.close(); d.innerHTML = ''; };
ACT['viewer-step'] = t => { if (!VIEWING) return; const n = filesAt(VIEWING.where).list.length; VIEWING.i = (VIEWING.i + (+t.dataset.d) + n) % n; drawViewer(); };
ACT['file-open'] = t => openViewer(t.dataset.where, +t.dataset.i);
ACT['file-remove'] = t => removeFileAt(t.dataset.where, t.dataset.id);
ACT['out-send'] = () => trySendDrafts(true);
document.addEventListener('close', ev => { if (ev.target.id === 'viewer') { VIEWING = null; ev.target.innerHTML = ''; } }, true);

let TOAST_T = null;
function toast(msg, bad){
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); }
  const host = [$('#viewer'), $('#sheet')].find(d => d && d.open) || document.body;       // an open sheet sits above the page: the message goes inside it
  if (el.parentNode !== host) host.appendChild(el);
  el.textContent = msg; el.className = 'toast' + (bad ? ' bad' : ''); el.hidden = false;
  clearTimeout(TOAST_T); TOAST_T = setTimeout(() => { el.hidden = true; }, bad ? 7000 : 3400);
}
// a button that is doing its work: no second tap
function working(btn, on, label){
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin sm"></span> ' + esc(label || 'Saving…'); }
  else { btn.disabled = false; if (btn.dataset.label != null) btn.innerHTML = btn.dataset.label; }
}
const needOnline = () => { if (S.saved || !S.online) { toast('No connection. Try again when the signal is back.', true); return false; } return true; };
const why = e => String(errText(e)).replace(/[.\s]+$/, '');      // the reason, to put inside a sentence
const saveFail = e => toast(offlineErr(e) ? 'No connection: not saved. Try again when the signal is back.' : 'Not saved: ' + errText(e), true);

document.addEventListener('click', ev => {
  const t = ev.target.closest && ev.target.closest('[data-act]'); if (!t) return;
  const fn = ACT[t.dataset.act]; if (!fn) return;
  if (t.tagName === 'A' || t.tagName === 'BUTTON' || t.getAttribute('role') === 'button') ev.preventDefault();
  try { const p = fn(t, ev); if (p && p.catch) p.catch(e => { console.error(e); saveFail(e); }); } catch (e) { console.error(e); toast(errText(e), true); }
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const t = ev.target; if (!t || !t.matches) return;
  if (t.matches('tr.click[data-href]')) { ev.preventDefault(); go(t.dataset.href); }
  else if (t.matches('span[role="button"][data-act]')) { ev.preventDefault(); t.click(); }
});
document.addEventListener('click', ev => { const tr = ev.target.closest && ev.target.closest('tr.click[data-href]'); if (tr && !ev.target.closest('a,button,input,select,label')) go(tr.dataset.href); });
document.addEventListener('submit', ev => {
  const f = ev.target, fn = f && f.dataset && FORMS[f.dataset.form]; if (!fn) return;
  ev.preventDefault();
  const p = fn(f, ev); if (p && p.catch) p.catch(e => { console.error(e); saveFail(e); for (const b of $$('button[disabled]', f)) working(b, false); });
});
document.addEventListener('change', async ev => {
  const t = ev.target; if (!t || t.type !== 'file' || !t.dataset.pick) return;
  const fn = PICKS[t.dataset.pick.split(':')[0]], files = [...t.files]; t.value = '';
  if (fn && files.length) { try { await fn(files, t); } catch (e) { console.error(e); saveFail(e); } }
});

// ---------- printing on the Pump Group letterhead ----------
function printDoc(title, html){
  const host = $('#print'), logo = $('img[src^="logo.png"]');
  // on the letterhead when this device has it (it comes with the register file); otherwise under the logo
  host.innerHTML = `<div class="ph${S.lh ? '' : ' plain'}"><img src="${S.lh || (logo && logo.getAttribute('src')) || 'logo.png'}" alt=""></div><table class="pframe"><thead><tr><td></td></tr></thead><tbody><tr><td>${html}</td></tr></tbody><tfoot><tr><td></td></tr></tfoot></table>`;
  const img = $('img', host), old = document.title;
  const run = () => { document.title = title; window.print(); setTimeout(() => { document.title = old; }, 500); };
  if (img.complete) run(); else { img.onload = run; img.onerror = run; }
}
window.addEventListener('afterprint', () => { const h = $('#print'); if (h) h.innerHTML = ''; });

// ---------- small pieces the pages share ----------
const waLink = text => 'https://wa.me/?text=' + encodeURIComponent(text);
const appLink = h => location.origin + location.pathname + (h || '');
const pageHead = (title, lede, right) => `<div class="pagehead"><div><h2>${esc(title)}</h2>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${right ? `<div class="acts">${right}</div>` : ''}</div>`;
const emptyBox = (title, text) => `<div class="empty"><b>${esc(title)}</b>${text || ''}</div>`;
const dueTxt = (iso, word) => { if (!iso) return ''; const n = daysTo(iso); return `${word} <b${n < 0 ? ' style="color:var(--bad)"' : ''}>${esc(dfmt(iso))}</b> <span class="muted">(${esc(rel(iso))})</span>`; };
// one requisition as a card, for the home pages and the lists on a phone
function rqCard(v, opt){
  opt = opt || {};
  const r = v.r, tone = opt.tone || (v.key === 'query' || v.key === 'rejected' || v.late || v.orderLate ? 'bad' : v.st.tone === 'ok' ? 'ok' : v.st.tone === 'warn' ? 'warn' : v.st.tone === 'info' ? 'info' : 'n');
  const nA = v.A.length, nO = v.A.filter(l => l.ordered || l.received).length, nR = v.A.filter(l => l.received).length;
  const bits = [];
  if (r.needBy) bits.push(dueTxt(r.needBy, 'Needed'));
  else if (r.needTxt) bits.push('Needed <b>' + esc(r.needTxt) + '</b>');
  if (opt.order && r.orderBy) bits.push(dueTxt(r.orderBy, 'Order by'));
  bits.push(plural(v.lines.length, 'line'));
  if (isDirector() && v.est) bits.push('about <b>' + esc(money(v.est)) + '</b>');
  if (opt.who !== false) bits.push('by ' + esc(firstName2(r)));
  return `<a class="card c-${tone}" href="#/rq/${encodeURIComponent(v.id)}">
    <div class="card-top"><span class="card-no">${esc(r.no || 'New')}</span>${stPill(v)}${r.urgent ? '<span class="pill p-bad">Urgent</span>' : ''}${v.late ? '<span class="pill p-bad">Delivery late</span>' : ''}${v.orderLate ? '<span class="pill p-bad">Order late</span>' : ''}</div>
    <div class="card-t">${esc(r.title || 'Requisition')}</div>
    <div class="card-m">${bits.map(b => `<span>${b}</span>`).join('')}</div>
    ${opt.extra || ''}
    ${v.approved && nA ? `<div class="prog" aria-hidden="true"><i><b style="width:100%"></b></i><i><b style="width:${Math.round(100 * nO / nA)}%"></b></i><i class="g"><b style="width:${Math.round(100 * nR / nA)}%"></b></i></div>` : ''}</a>`;
}
const firstName2 = r => r.by ? firstName(r.by) : String(r.for || 'the office').split(/[ ,]/)[0];

function startUI(){
  if (startUI.done) { render(true); return; }
  startUI.done = true;
  outRefresh().then(() => { drawBanner(); if (ROUTE.name === 'home') refresh(); });
  render(true);
}
