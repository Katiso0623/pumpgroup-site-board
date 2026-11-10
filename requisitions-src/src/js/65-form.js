// ---------- writing a requisition: a new one, or one that is changed and sent again ----------
// What is typed is kept on the device as it is typed (a draft), so a dropped signal or a closed app loses nothing.
let FORM = null;
const blankLine = () => ({id: 'L' + newKey(6), desc: '', qty: '', unit: '', need: '', note: '', type: 'line', isNew: true});
const fileBack = f => ({...f, url: URL.createObjectURL(new Blob([f.tbuf || f.buf], {type: f.tbuf ? 'image/jpeg' : f.type}))});
async function loadForm(route, want){
  await null;                                   // the page that asked is still being drawn: finish that first
  const d = route.q.get('d'), mode = route.name === 'edit' ? 'edit' : 'new', rqId = mode === 'edit' ? route.seg[1] : null;
  let F = null;
  if (d) {
    const it = await outGet(d);
    if (it && it.kind === 'rq' && it.form && (!it.uid || it.uid === S.me.id)) F = {id: it.id, rqId: it.rqId, mode: it.mode, h: it.form.h, lines: it.form.lines, office: it.form.office || {code: '', pay: '', rates: {}},
      files: (it.files || []).map(fileBack), dirty: true, savedAt: it.at, at: it.at, err: it.state === 'error' ? it.err : ''};
  }
  if (!F && mode === 'edit') {
    const r = S.rq.get(rqId), M = moneyOf(rqId) || {};
    if (r) F = {id: newKey(12), rqId, mode: 'edit', files: [], dirty: false, savedAt: null,
      h: {title: r.title || '', front: r.front || '', needBy: r.needBy || '', needBy0: r.needBy || '', needTxt: r.needTxt || '', deliverTo: r.deliverTo || '', urgent: !!r.urgent, note: r.note || '',
        wbs: r.wbs || '', ms: r.ms || '', release: r.release || '', orderBy: r.orderBy || '', orderBy0: r.orderBy || '', orderTxt: r.orderTxt || ''},
      lines: linesOf(r).map(l => ({id: l.id, ref: l.ref || '', desc: l.desc || '', qty: l.qty == null ? '' : String(l.qty), wasBlank: l.qty == null, unit: l.unit || '', need: l.need || '', need0: l.need || '', needTxt: l.needTxt || '', note: l.note || '', type: l.type || 'line'})),
      office: {code: M.code || '', pay: M.pay || '', rates: Object.fromEntries(Object.entries(M.rates || {}).map(([k, v]) => [k, v == null ? '' : String(v)]))}};
  }
  if (!F && mode === 'new') F = {id: newKey(12), rqId: newKey(12), mode: 'new', files: [], dirty: false, savedAt: null,
    h: {title: '', front: '', needBy: '', deliverTo: '', urgent: false, note: '', wbs: '', ms: '', release: '', orderBy: '', orderTxt: ''}, lines: [blankLine()], office: {code: '', pay: '', rates: {}}};
  FORM = F ? Object.assign(F, {key: want}) : {key: want, missing: true};
  if (formKey(parseHash()) === want) render(true);
}
const formKey = route => route.name + '/' + (route.seg[1] || '') + '?' + (route.q.get('d') || '');
function lineCard(l, i){
  const dir = isDirector(), rate = (FORM.office.rates || {})[l.id];
  return `<div class="lc" data-line="${esc(l.id)}">
    <div class="lc-h"><span class="lc-n">Line ${i + 1}${LTYPE[l.type] ? ' · ' + LTYPE[l.type] : ''}</span>
      <button type="button" class="btn sm ghost danger" data-act="f-line-del" data-line="${esc(l.id)}" aria-label="Remove line ${i + 1}">Remove</button></div>
    <label><span class="req">What</span><input data-f="desc" maxlength="400" value="${esc(l.desc)}" placeholder="For example: cement CEM II 42.5N, 50 kg bags"></label>
    <div class="frow"><label><span${l.wasBlank ? '' : ' class="req"'}>How many</span><input data-f="qty" inputmode="decimal" autocomplete="off" value="${esc(l.qty)}"${l.wasBlank ? ' placeholder="To be confirmed"' : ''}></label>
      <label>Unit<input data-f="unit" list="dlUnit" maxlength="12" autocapitalize="off" autocomplete="off" value="${esc(l.unit)}" placeholder="bag, m, No"></label></div>
    <details${l.note || (l.need && l.need !== FORM.h.needBy) || (dir && rate) ? ' open' : ''}><summary>Size, grade, brand or a different date</summary>
      <div class="form"><label>Details<input data-f="note" maxlength="400" value="${esc(l.note)}" placeholder="Size, grade, brand, colour, drawing number"></label>
        <label>Needed on a different date <span class="opt">empty means the date above</span><input type="date" data-f="need" value="${esc(l.need)}"></label>
        ${dir ? `<label>Budget rate, R <span class="opt">directors only, never shown to the site</span><input data-f="rate" inputmode="decimal" autocomplete="off" value="${esc(rate == null ? '' : rate)}"></label>` : ''}</div></details>
  </div>`;
}
const formPage = {
  form: true,
  title: route => route.name === 'edit' ? 'Change a requisition' : 'New requisition',
  render(route){
    const want = formKey(route);
    if (!FORM || FORM.key !== want) { FORM = null; loadForm(route, want); return `<div class="gate-load"><div class="spin"></div><span>Opening…</span></div>`; }
    const F = FORM, dir = isDirector(), edit = F.mode === 'edit', r = edit ? S.rq.get(F.rqId) : null;
    if (F.missing || (edit && !r)) return `<div class="stack">${emptyBox('Not found', 'This requisition or draft is not on this device any more. <a href="#/">Back to the start</a>')}</div>`;
    const h = F.h, no = edit ? (r.no || 'the requisition') : '';
    return `<div class="stack">
      <div><a class="btn sm ghost" href="${edit ? '#/rq/' + encodeURIComponent(F.rqId) : '#/'}">${ICON.back} ${edit ? esc(no) : 'Back'}</a></div>
      ${pageHead(edit ? 'Change ' + no : 'New requisition', edit ? 'Change what is needed, then send it to the office again. A director approves the new version.' : 'Say what is needed on site. A director approves it, the office orders, and the delivery is booked in here when it arrives.')}
      ${F.err ? `<div class="notice bad"><b>This was not sent:</b> ${esc(F.err)}. Check it and send it again.</div>` : ''}
      <form class="form" data-form="rq" id="rqForm" novalidate>
        <div class="panel form">
          <label><span class="req">What is it for?</span><input name="title" maxlength="160" value="${esc(h.title)}" placeholder="For example: cement and sand for the plaster, beds 8 to 14"></label>
          <div class="frow"><label><span class="req">Needed on site by</span><input type="date" name="needBy" value="${esc(h.needBy)}"></label>
            <label>Work front <span class="opt">where it is used</span><input name="front" list="dlFront" maxlength="120" value="${esc(h.front)}"></label></div>
          <label>Deliver to, or store at<input name="deliverTo" list="dlPlace" maxlength="160" value="${esc(h.deliverTo)}" placeholder="For example: site store, drying beds"></label>
          <label class="check"><input type="checkbox" name="urgent"${h.urgent ? ' checked' : ''}> Urgent: the work stops without it</label>
        </div>
        <section class="sec"><h3>What is needed</h3>
          <div class="lines" id="fLines">${F.lines.map(lineCard).join('')}</div>
          <div><button type="button" class="btn" data-act="f-line-add">${ICON.plus} Add another line</button></div></section>
        <section class="sec"><div class="sec-h"><h3>Photos and documents</h3><span class="muted small">a photo of the part, a sketch, a quote</span></div>
          ${edit && live(r.files).length ? `<p class="help">${plural(live(r.files).length, 'file')} already on this requisition.</p>` : ''}
          <div class="thumbs" id="fFiles">${pendingHtml(F.files, 'rqf')}${addTile('rqf')}</div></section>
        <label>Note for the office <span class="opt">optional</span><textarea name="note" rows="3" maxlength="2000" placeholder="Anything the office must know: a supplier who has it, why it is needed, who to phone">${esc(h.note)}</textarea></label>
        ${dir ? `<details class="panel flat"${h.wbs || h.ms || h.release || h.orderBy || F.office.code || F.office.pay ? ' open' : ''}><summary class="b">For the office</summary><div class="form" style="margin-top:10px">
          <div class="frow"><label>Order by<input type="date" name="orderBy" value="${esc(h.orderBy)}"></label><label>Budget line<select name="code">${codeOptions(F.office.code)}</select></label></div>
          <label>When to order <span class="opt">the rule for releasing the order</span><input name="release" maxlength="400" value="${esc(h.release)}"></label>
          <div class="frow"><label>Programme activity (WBS)<input name="wbs" maxlength="80" value="${esc(h.wbs)}"></label><label>Method statement or drawing<input name="ms" maxlength="160" value="${esc(h.ms)}"></label></div>
          <label>Paid under <span class="opt">bill item or dayworks; directors only</span><input name="pay" maxlength="300" value="${esc(F.office.pay)}"></label></div></details>` : ''}
        <div class="err" id="fErr" role="alert"></div>
        <div class="savebar"><span class="grow" id="fSaved">${F.savedAt ? 'Draft kept on this device, ' + esc(ago(F.savedAt)) : 'Kept on this device as you type.'}</span>
          <button type="button" class="btn danger" data-act="f-drop">${F.savedAt ? 'Delete the draft' : 'Cancel'}</button>
          <button type="submit" class="btn primary">${dir && !edit ? 'Save and decide' : 'Send to the office'}</button></div>
      </form>
      <datalist id="dlFront">${frontsKnown().map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dlPlace">${placesKnown().map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dlUnit">${UNITS.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    </div>`;
  },
};
PAGES.new = formPage; PAGES.edit = formPage;

function formSync(){
  const f = $('#rqForm'); if (!f || !FORM || FORM.missing) return;
  const h = FORM.h, e = f.elements;
  h.title = e.title.value; h.needBy = e.needBy.value; h.front = e.front.value; h.deliverTo = e.deliverTo.value; h.urgent = e.urgent.checked; h.note = e.note.value;
  if (e.orderBy) { h.orderBy = e.orderBy.value; h.release = e.release.value; h.wbs = e.wbs.value; h.ms = e.ms.value; FORM.office.code = e.code.value; FORM.office.pay = e.pay.value; }
  for (const card of $$('.lc[data-line]', f)) {
    const l = FORM.lines.find(x => x.id === card.dataset.line); if (!l) continue;
    for (const inp of $$('[data-f]', card)) { if (inp.dataset.f === 'rate') FORM.office.rates[l.id] = inp.value; else l[inp.dataset.f] = inp.value; }
  }
}
function formItem(state){
  const F = FORM, h = F.h, dir = isDirector(), lines = {};
  let n = 0;
  for (const l of F.lines) {
    if (!String(l.desc).trim()) continue;
    lines[l.id] = {n: ++n, ref: l.isNew || !l.ref ? String(n) : l.ref, desc: l.desc.trim(), unit: String(l.unit || '').trim(), qty: num(l.qty), need: l.need || '',
      needTxt: l.need === (l.need0 || '') ? (l.needTxt || '') : '', note: String(l.note || '').trim(), type: l.type || 'line'};
  }
  const body = {title: h.title.trim(), front: h.front.trim(), needBy: h.needBy, needTxt: h.needBy === (h.needBy0 || '') ? (h.needTxt || '') : '', deliverTo: h.deliverTo.trim(), urgent: !!h.urgent, note: h.note.trim(), lines};
  if (F.mode === 'new') Object.assign(body, {wbs: '', ms: '', release: '', orderBy: '', orderTxt: '', notes: [], hold: []});
  if (dir) Object.assign(body, {wbs: h.wbs.trim(), ms: h.ms.trim(), release: h.release.trim(), orderBy: h.orderBy, orderTxt: h.orderBy === (h.orderBy0 || '') ? (h.orderTxt || '') : ''});
  let office = null;
  if (dir) { const rates = {}; for (const [k, v] of Object.entries(F.office.rates || {})) if (lines[k]) rates[k] = num(v); office = {code: F.office.code || null, pay: String(F.office.pay || '').trim(), rates}; }
  return {id: F.id, kind: 'rq', mode: F.mode, rqId: F.rqId, uid: S.me.id, at: F.at || (F.at = nowISO()), state, body, office,
    files: F.files.map(f => { const {url, ...rest} = f; return rest; }), form: {h: F.h, lines: F.lines, office: F.office}};
}
async function formSave(){
  if (!FORM || FORM.missing || !FORM.dirty || FORM.sending) return;
  const F = FORM;
  try {
    await outPut(formItem('draft')); F.savedAt = nowISO();
    if (FORM !== F) return;
    const el = $('#fSaved'); if (el) el.textContent = 'Draft kept on this device, ' + tfmt(F.savedAt).split(', ')[1];
    const want = '#/' + (F.mode === 'edit' ? 'edit/' + encodeURIComponent(F.rqId) : 'new') + '?d=' + encodeURIComponent(F.id);
    if (location.hash !== want && (ROUTE.name === 'new' || ROUTE.name === 'edit')) { history.replaceState(null, '', want); SHOWN = location.hash; ROUTE = parseHash(); F.key = formKey(ROUTE); }
    outRefresh();
  } catch (e) { const el = $('#fSaved'); if (el) el.textContent = 'This device could not keep the draft: send it before you leave the page.'; }
}
const formSaveSoon = debounce(formSave, 700);
const formTouched = () => { if (!FORM || FORM.missing) return; formSync(); FORM.dirty = true; formSaveSoon(); };
// a field that was marked as missing is unmarked as soon as it is filled in; the list of what is missing follows
function formUnmark(el){
  if (!el || !el.classList || !el.classList.contains('invalid') || !String(el.value || '').trim()) return;
  el.classList.remove('invalid');
  const err = document.getElementById('fErr'); if (err && err.textContent) err.innerHTML = formCheck(true).map(b => esc(b.msg)).join('<br>');
}
document.addEventListener('input', ev => { if (ev.target.closest && ev.target.closest('#rqForm')) { formTouched(); formUnmark(ev.target); } });
document.addEventListener('change', ev => { if (ev.target.closest && ev.target.closest('#rqForm') && ev.target.type !== 'file') formTouched(); });
function formRedrawLines(focusLast){
  $('#fLines').innerHTML = FORM.lines.map(lineCard).join('');
  if (focusLast) { const c = $$('#fLines .lc').pop(); if (c) { const i = $('[data-f="desc"]', c); i.focus(); c.scrollIntoView({block: 'center', behavior: 'smooth'}); } }
}
ACT['f-line-add'] = () => { formSync(); FORM.lines.push(blankLine()); formRedrawLines(true); FORM.dirty = true; formSaveSoon(); };
ACT['f-line-del'] = t => {
  formSync();
  const l = FORM.lines.find(x => x.id === t.dataset.line); if (!l) return;
  if (String(l.desc).trim() && !confirm('Remove this line?')) return;
  FORM.lines = FORM.lines.filter(x => x !== l); if (!FORM.lines.length) FORM.lines.push(blankLine());
  formRedrawLines(false); FORM.dirty = true; formSaveSoon();
};
PICKS.rqf = async files => {
  const add = await prepFiles(files); if (!add.length || !FORM) return;
  FORM.files.push(...add); $('#fFiles').innerHTML = pendingHtml(FORM.files, 'rqf') + addTile('rqf'); FORM.dirty = true; formSaveSoon();
};
ACT['pend-remove'] = t => {
  const g = t.dataset.group, key = t.dataset.key;
  if (g === 'rqf' && FORM) { const f = FORM.files.find(x => x.key === key); if (f) URL.revokeObjectURL(f.url); FORM.files = FORM.files.filter(x => x.key !== key); $('#fFiles').innerHTML = pendingHtml(FORM.files, 'rqf') + addTile('rqf'); FORM.dirty = true; formSaveSoon(); }
  if (g !== 'rqf' && SHEET && SHEET.files) { SHEET.files = SHEET.files.filter(x => x.key !== key); const el = $('#shFiles'); if (el) el.innerHTML = pendingHtml(SHEET.files, g) + addTile(g, SHEET.addLabel); }
};
ACT['f-drop'] = async () => {
  if (!FORM) return go('#/');
  const F = FORM, back = F.mode === 'edit' ? '#/rq/' + encodeURIComponent(F.rqId) : '#/';
  if ((F.dirty || F.savedAt) && !confirm(F.mode === 'edit' ? 'Drop these changes? The requisition stays as it was.' : 'Delete this draft?')) return;
  F.sending = true; await outDel(F.id); await outRefresh(); FORM = null; go(back);
};
function formCheck(quiet){
  const F = FORM, h = F.h, bad = [], f = $('#rqForm');
  if (!quiet) for (const el of $$('.invalid', f)) el.classList.remove('invalid');
  const mark = (el, msg) => { if (el && !quiet) el.classList.add('invalid'); bad.push({el, msg}); };
  if (!h.title.trim()) mark(f.elements.title, 'Say what it is for.');
  if (!h.needBy) mark(f.elements.needBy, 'Give the date it is needed on site.');
  const used = F.lines.filter(l => String(l.desc).trim() || String(l.qty).trim());
  if (!used.length) mark($('#fLines [data-f="desc"]'), 'Add at least one line: what is needed and how many.');
  for (const l of used) {
    const card = $(`.lc[data-line="${CSS.escape(l.id)}"]`, f), i = F.lines.indexOf(l) + 1, q = num(l.qty);
    if (!String(l.desc).trim()) mark($('[data-f="desc"]', card), `Line ${i}: say what is needed.`);
    if (String(l.qty).trim() ? (q == null || q <= 0) : !l.wasBlank) mark($('[data-f="qty"]', card), `Line ${i}: give a quantity (a number above 0).`);
    const rate = (F.office.rates || {})[l.id];
    if (isDirector() && String(rate == null ? '' : rate).trim() && (num(rate) == null || num(rate) < 0)) mark($('[data-f="rate"]', card), `Line ${i}: the budget rate is not a number.`);
  }
  return bad;
}
FORMS.rq = async (f, ev) => {
  if (!FORM || FORM.missing || FORM.sending) return;
  formSync();
  const bad = formCheck(), err = $('#fErr');
  if (bad.length) {
    err.innerHTML = bad.map(b => esc(b.msg)).join('<br>');
    const first = bad.find(b => b.el); if (first) { const d = first.el.closest('details'); if (d) d.open = true; first.el.focus(); first.el.scrollIntoView({block: 'center', behavior: 'smooth'}); }
    return;
  }
  err.textContent = '';
  const F = FORM, btn = ev.submitter || $('button[type=submit]', f), it = formItem('queued'), dir = isDirector();
  if (!Object.keys(it.body.lines).length) { err.textContent = 'Add at least one line.'; return; }
  F.sending = true; working(btn, true, 'Sending…');
  const leave = h => { FORM = null; for (const x of F.files) { try { URL.revokeObjectURL(x.url); } catch (e) {} } go(h); };
  try {
    await outPut(it);
    if (S.saved || !S.online) { await outRefresh(); toast('Kept on this device. It is sent to the office when the signal is back.'); return leave('#/'); }
    try {
      await sendNow(it);
      toast(F.mode === 'edit' ? 'Sent to the office again.' : 'Sent to the office.');
      return leave('#/rq/' + encodeURIComponent(F.rqId) + (dir && F.mode === 'new' ? '?do=decide' : ''));
    } catch (e) {
      if (offlineErr(e)) { toast('No connection: it is kept on this device and sent when the signal is back.'); return leave('#/'); }
      it.state = 'error'; it.err = errText(e); await outPut(it).catch(() => {}); await outRefresh();
      F.sending = false; F.err = it.err; working(btn, false); err.textContent = 'Not sent: ' + it.err;
    }
  } catch (e) { F.sending = false; working(btn, false); err.textContent = 'Not saved on this device: ' + errText(e); }
};
