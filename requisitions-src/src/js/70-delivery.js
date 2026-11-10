// ---------- deliveries: booking materials in at the gate (QMS form QF-05, Material Delivery Inspection) ----------
// Works without a signal: the delivery and its photos are kept on the phone and sent when the signal is back.
function openGrn(id){
  const v = view(id); if (!v) return;
  if (!v.approved) { toast('This requisition is not approved yet, so nothing can be booked in on it.', true); return; }
  const lines = v.A.filter(l => !l.received);
  if (!lines.length) { toast('Everything approved on this requisition is already on site.'); return; }
  const r = v.r, now = new Date(), open = v.orders.filter(([, o]) => Object.keys(o.lines || {}).some(k => lines.some(l => l.id === k)));
  const sup = open.length ? open[open.length - 1][1].supplier || '' : '';
  SHEET = {kind: 'grn', id, key: newKey(8), files: [], addLabel: 'Photo of the delivery note'};
  const row = l => {
    const left = l.aq == null ? null : r2(Math.max(0, l.aq - l.got)), n = esc(l.id);
    return `<div class="lc" data-line="${n}" data-left="${left == null ? '' : left}">
      <div><b>${esc(l.desc)}</b><span class="muted small" style="display:block">Approved ${lineQty(l.aq, l.unit)}${l.oany ? ' · ordered ' + qfmt(l.oq) : ' · order not recorded'}${l.got ? ' · on site so far ' + qfmt(l.got) : ''}${left != null ? ' · <b>' + qfmt(left) + ' to come</b>' : ''}</span></div>
      <div class="frow wide"><label>Delivered now${l.unit ? ' (' + esc(l.unit) + ')' : ''}<span class="qtyrow"><button type="button" class="btn" data-act="q-step" data-d="-1" aria-label="One less">−</button>
          <input name="q.${n}" inputmode="decimal" autocomplete="off" placeholder="0" data-grn><button type="button" class="btn" data-act="q-step" data-d="1" aria-label="One more">+</button></span></label>
        <div class="fl">Condition<div class="seg"><label><input type="radio" name="c.${n}" value="ok" checked><span>Good</span></label><label><input type="radio" name="c.${n}" value="damaged"><span>Damaged, kept</span></label><label><input type="radio" name="c.${n}" value="rejected"><span>Sent back</span></label></div></div></div>
      <div class="flex">${left ? `<button type="button" class="btn sm" data-act="q-all">All ${qfmt(left)} delivered</button>` : ''}<label class="check"><input type="checkbox" name="d.${n}"> Nothing more to come on this line</label></div>
      <label>Remark <span class="opt">what is wrong, a batch number, a short delivery</span><input name="m.${n}" maxlength="300"></label></div>`;
  };
  openSheet('Book a delivery in: ' + (r.no || ''), `<form data-form="grn" novalidate><div class="sheet-bd">
      <div><b>${esc(r.title || '')}</b><p class="help">Count it before the delivery note is signed. Write a short delivery on the note. Take a photo of the note.</p></div>
      <div class="frow"><label>Date<input type="date" name="date" value="${today()}" max="${today()}" required></label><label>Time<input type="time" name="time" value="${pad2(now.getHours())}:${pad2(now.getMinutes())}"></label></div>
      <div class="frow"><label>Supplier<input name="supplier" list="dlSup" maxlength="120" value="${esc(sup)}"></label><label>Delivery note number<input name="dn" maxlength="60" autocomplete="off"></label></div>
      <div class="frow"><label>Vehicle or driver <span class="opt">optional</span><input name="vehicle" maxlength="80"></label><label>Stored at<input name="stored" list="dlPlace2" maxlength="160" value="${esc(r.deliverTo || '')}"></label></div>
      <h3>What came</h3><div class="lines">${lines.map(row).join('')}</div>
      <h3>Checks</h3>
      <div class="lines">${QF05.map(([k, t]) => `<div class="fl" data-chk="${k}"><span>${esc(t)}</span><div class="seg"><label><input type="radio" name="k.${k}" value="yes"><span>Yes</span></label><label><input type="radio" name="k.${k}" value="no"><span>No</span></label><label><input type="radio" name="k.${k}" value="na"><span>Does not apply</span></label></div></div>`).join('')}</div>
      <h3>Photos</h3><p class="help">The delivery note first, then the material and its labels, and any damage.</p>
      <div class="thumbs" id="shFiles">${addTile('grn', SHEET.addLabel)}</div>
      <label class="check"><input type="checkbox" name="site" data-grn> Bought by the site team (cash or the site account)</label>
      <label id="grnAmt" hidden>Total on the slip, R <span class="opt">incl VAT, as printed</span><input name="amt" inputmode="decimal" autocomplete="off"></label>
      <label class="fl">Note <span class="opt">optional</span><textarea name="note" rows="2" maxlength="1000"></textarea></label>
      <div class="err" id="grnErr" role="alert"></div>
      <datalist id="dlSup">${suppliersKnown().map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="dlPlace2">${placesKnown().map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    </div><div class="sheet-ft"><button type="button" class="btn" data-act="sheet-close">Back</button><button type="submit" class="btn primary">${ICON.check} Save the delivery</button></div></form>`);
}
ACT['grn-new'] = t => openGrn(t.dataset.id);
const grnAuto = card => {   // "nothing more to come" ticks itself when the full quantity is in
  const q = num($('input[data-grn]', card).value), left = num(card.dataset.left), box = $('input[type=checkbox]', card);
  if (left != null && q != null) box.checked = q >= left - 1e-9;
};
ACT['q-step'] = t => { const card = t.closest('.lc'), i = $('input[data-grn]', card), v = Math.max(0, r2((num(i.value) || 0) + (+t.dataset.d))); i.value = v ? String(v) : ''; grnAuto(card); };
ACT['q-all'] = t => { const card = t.closest('.lc'); $('input[data-grn]', card).value = card.dataset.left; grnAuto(card); };
document.addEventListener('input', ev => {
  const t = ev.target; if (!SHEET || SHEET.kind !== 'grn' || !t.dataset || !('grn' in t.dataset)) return;
  if (t.name === 'site') { $('#grnAmt').hidden = !t.checked; return; }
  grnAuto(t.closest('.lc'));
});
PICKS.grn = async files => {
  if (!SHEET || SHEET.kind !== 'grn') return;
  const add = await prepFiles(files); if (!add.length || !SHEET) return;
  SHEET.files.push(...add); $('#shFiles').innerHTML = pendingHtml(SHEET.files, 'grn') + addTile('grn', 'Another photo');
};
FORMS.grn = async (f, ev) => {
  const s = SHEET; if (!s || s.kind !== 'grn' || s.busy) return;
  const v = view(s.id), e = f.elements, err = $('#grnErr'), lines = {}, bad = [];
  for (const card of $$('.lc[data-line]', f)) {
    const id = card.dataset.line, qs = e['q.' + id].value.trim(), q = num(qs), c = e['c.' + id].value, done = e['d.' + id].checked, rem = e['m.' + id].value.trim();
    if (qs && (q == null || q < 0)) { bad.push('A quantity is not a number.'); continue; }
    if (!q && !done) continue;
    if (c !== 'ok' && !rem) bad.push('Say in the remark what is wrong with the damaged or returned material.');
    lines[id] = {q: q || 0, cond: c === 'ok' ? 'ok' : 'damaged', acc: c === 'rejected' ? 'rejected' : 'accepted', done: c === 'rejected' ? false : done, rem};
  }
  if (!Object.keys(lines).length) bad.push('Enter what was delivered on at least one line.');
  const chk = {}; for (const [k] of QF05) { const val = e['k.' + k].value; if (!val) { bad.push('Answer each of the five checks.'); break; } chk[k] = val; }
  if (!e.date.value) bad.push('Give the date of the delivery.');
  const site = e.site.checked, amt = num(e.amt.value);
  if (site && e.amt.value.trim() && (amt == null || amt < 0)) bad.push('The slip total is not a number.');
  if (bad.length) { err.innerHTML = [...new Set(bad)].map(esc).join('<br>'); err.scrollIntoView({block: 'center'}); return; }
  if (!s.files.length && !confirm('There is no photo of the delivery note. Save the delivery without one?')) return;
  err.textContent = '';
  const btn = ev.submitter || $('button[type=submit]', f); s.busy = true; working(btn, true);
  const body = {date: e.date.value, time: e.time.value, supplier: e.supplier.value.trim(), dn: e.dn.value.trim(), vehicle: e.vehicle.value.trim(), stored: e.stored.value.trim(),
    lines, chk, note: e.note.value.trim(), site, amt: site ? amt : null};
  const it = {id: newKey(12), kind: 'grn', rqId: s.id, key: s.key, uid: S.me.id, at: nowISO(), state: 'queued', body, files: s.files.map(x => { const {url, ...rest} = x; return rest; })};
  try {
    await outPut(it);
    if (S.saved || !S.online) { closeSheet(true); await outRefresh(); refresh(); toast('Kept on this device. The delivery is sent to the office when the signal is back.'); return; }
    try { await sendNow(it); closeSheet(true); refresh(); toast('Delivery booked in.'); }
    catch (er) {
      if (offlineErr(er)) { closeSheet(true); refresh(); toast('No connection: the delivery is kept on this device and sent when the signal is back.'); return; }
      it.state = 'error'; it.err = errText(er); await outPut(it).catch(() => {}); await outRefresh(); closeSheet(true); refresh(); toast('Not sent: ' + it.err + '. It is kept on this device.', true);
    }
  } catch (er) { s.busy = false; working(btn, false); err.textContent = 'Not saved on this device: ' + errText(er); }
};

PAGES.in = {
  title: 'Deliveries',
  render(){
    const V = allViews();
    const coming = V.filter(v => v.expect.length).sort((a, b) => String(a.nextEta || '9999').localeCompare(String(b.nextEta || '9999')));
    const bare = V.filter(v => v.needOrder.length && !v.expect.length && !S.saved).sort(byNeed);
    const done = []; for (const v of V) for (const [k, g] of v.grns) done.push({v, k, g});
    done.sort((a, b) => String(b.g.date || b.g.at).localeCompare(String(a.g.date || a.g.at)) || String(b.g.at).localeCompare(String(a.g.at)));
    const waiting = OUT.filter(x => x.kind === 'grn');
    return `<div class="stack">
      ${pageHead('Deliveries', 'Book every delivery in before the delivery note is signed: count it, check it, photograph the note.')}
      ${waiting.length ? `<div class="notice info">${plural(waiting.length, 'delivery', 'deliveries')} kept on this device, still to be sent to the office.</div>` : ''}
      ${section('Expected on site', coming.length ? plural(coming.length, 'requisition') : '', coming.length ? `<div class="cards">${coming.map(expectCard).join('')}</div>` : emptyBox('Nothing on order', 'When the office records an order, it shows here.'))}
      ${bare.length ? section('Approved, order not recorded yet', 'book in here if it arrives or is bought on site', `<div class="cards">${bare.map(v => rqCard(v, {who: false, extra: `<div class="card-acts"><span class="btn sm" role="button" tabindex="0" data-act="grn-new" data-id="${esc(v.id)}">${ICON.truck} Book it in</span></div>`})).join('')}</div>`) : ''}
      ${section('Booked in', done.length ? plural(done.length, 'delivery', 'deliveries') : '', done.length ? `<div class="tbl stackable"><table><thead><tr><th>Date</th><th>Requisition</th><th>Supplier and delivery note</th><th>What came</th><th>Booked in by</th></tr></thead><tbody>${done.slice(0, 60).map(({v, k, g}) => {
        const n = Object.keys(g.lines || {}).length, bad = Object.values(g.lines || {}).some(x => x && (x.acc === 'rejected' || x.cond === 'damaged')), ph = live(g.files).length;
        return `<tr class="click" data-href="#/rq/${encodeURIComponent(v.id)}" tabindex="0"><td data-l="Date" class="nowrap">${esc(dfmt(g.date || g.at))}</td>
          <td class="full"><a href="#/rq/${encodeURIComponent(v.id)}" class="mono">${esc(v.r.no)}</a> ${esc(v.r.title || '')}</td>
          <td data-l="Supplier">${esc(g.supplier || '')}${g.dn ? `<span class="sub">note ${esc(g.dn)}</span>` : ''}</td>
          <td data-l="What came">${plural(n, 'line')}${bad ? ' <span class="pill p-bad">damage or return</span>' : ''}${g.site ? ' <span class="pill p-info">bought on site</span>' : ''}<span class="sub">${ph ? plural(ph, 'photo') : 'no photo'}</span></td>
          <td data-l="By">${esc(firstName(g.by))}</td></tr>`; }).join('')}</tbody></table></div>` : emptyBox('No delivery booked in yet', ''))}
    </div>`;
  },
};
