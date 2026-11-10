// ---------- the register as a spreadsheet, the starting register, and printing on the letterhead ----------
let XLSXP = null;
const loadXlsx = () => XLSXP || (XLSXP = new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = '__XLSX__';
  s.onload = () => window.XLSX ? res(window.XLSX) : rej({code: 'unavailable', message: 'The spreadsheet tool did not load.'});
  s.onerror = () => { XLSXP = null; rej({code: 'unavailable', message: 'The spreadsheet tool did not load. Check the connection.'}); };
  document.head.appendChild(s);
}));
const lineState = l => l.ok === false ? 'Not approved' : l.ok == null ? 'Awaiting approval' : l.received ? 'On site' : l.rany ? 'Part delivered' : l.ordered ? 'On order' : l.oany ? 'Part ordered' : 'To order';
async function exportRegister(){
  if (!isDirector()) throw {code: 'invalid_request', message: 'Only directors can export the register.'};
  const X = await loadXlsx(), V = allViews().slice().reverse(), dir = isDirector(), d = s => s ? parseISO(s) : '';
  const head = [['MR-00 Requisition register'], [SITE_NAME + ' · ' + CONTRACT_LONG], ['From the Pump Group requisitions app, ' + dlong(today()) + '. Amounts are in rand, excl VAT. Internal: not for the site team or the Engineer.'], []];
  const reg = head.concat([['MR no', 'Requisition', 'Work front', 'Programme activity', 'Asked by', 'Sent', 'Order by', 'Needed on site', 'Status', 'Lines', 'Approved lines', 'Ordered', 'On site', 'Budget value', 'On order', 'Invoiced', 'Paid', 'Suppliers', 'Order numbers', 'Deliver to', 'Paid under', 'Budget line']])
    .concat(V.map(v => [v.r.no, v.r.title, v.r.front, v.r.wbs, whoOf(v.r), d(String(v.r.sentAt || '').slice(0, 10)), d(v.r.orderBy) || v.r.orderTxt || '', d(v.r.needBy) || v.r.needTxt || '', v.st.label, v.lines.length,
      v.approved ? v.A.length : '', v.approved ? v.A.filter(l => l.ordered || l.received).length : '', v.approved ? v.A.filter(l => l.received).length : '', v.est || '', v.ov || '', v.inv || '', v.paid || '',
      [...new Set(v.orders.map(([, o]) => o.supplier).filter(Boolean))].join(', '), v.orders.map(([, o]) => o.ref).filter(Boolean).join(', '), v.r.deliverTo, (v.M && v.M.pay) || '', (v.M && v.M.code) || '']));
  const lines = head.concat([['MR no', 'Ref', 'Description', 'Unit', 'Asked', 'Approved', 'Ordered', 'On site', 'Still to come', 'Needed', 'Line status', 'Kind', 'Budget rate', 'Budget value', 'Note']]);
  for (const v of V) for (const l of v.lines) {
    const q = v.approved ? l.aq : l.asked;
    lines.push([v.r.no, l.ref, l.desc, l.unit, l.asked == null ? 'TBC' : l.asked, v.approved ? (l.ok ? (l.aq == null ? 'TBC' : l.aq) : 'No') : '', l.oq || '', l.got || '', l.ok && !l.received && l.aq != null ? r2(Math.max(0, l.aq - l.got)) : '',
      d(l.need) || l.needTxt || '', lineState(l), LTYPE[l.type] || 'Line', l.rate == null ? '' : l.rate, l.rate != null && q != null && l.ok !== false ? r2(q * l.rate) : '', l.note]);
  }
  const ords = head.concat([['MR no', 'Supplier', 'Order number', 'Ordered', 'Expected', 'Lines', 'Amount excl VAT', 'Where it stands', 'Invoice', 'Paid on', 'Budget line', 'Recorded by', 'Kind']]);
  const money = (v, k) => { const c = costOf(v.id, k); return [c ? c.amount : '', c ? (COST_ST[c.status] || ['', c.status])[1] : 'No value yet', c ? c.inv || '' : '', c && c.paidOn ? d(c.paidOn) : '', c ? c.code : '']; };
  for (const v of V) {
    for (const [k, o] of v.orders) ords.push([v.r.no, o.supplier, o.ref, d(o.date), d(o.eta), Object.keys(o.lines || {}).length, ...money(v, k), nameOf(o.by), 'Order']);
    for (const [k, g] of v.grns) if (g.site) ords.push([v.r.no, g.supplier, g.dn, d(g.date), d(g.date), Object.keys(g.lines || {}).length, ...money(v, k), nameOf(g.by), 'Bought on site']);
  }
  const dels = head.concat([['MR no', 'Date', 'Time', 'Supplier', 'Delivery note', 'Description', 'Quantity', 'Unit', 'Condition', 'Accepted', 'Remark', 'Stored at', 'Booked in by', 'QF-05 checks answered yes', 'Photos']]);
  for (const v of V) for (const [, g] of v.grns) for (const [lid, x] of Object.entries(g.lines || {})) { const l = v.lines.find(y => y.id === lid); if (!l || !x) continue;
    dels.push([v.r.no, d(g.date), g.time || '', g.supplier, g.dn, l.desc, x.q, l.unit, x.cond === 'damaged' ? 'Damaged' : 'Good', x.acc === 'rejected' ? 'Rejected, sent back' : 'Accepted', x.rem || '', g.stored, nameOf(g.by), QF05.filter(([c]) => g.chk && g.chk[c] === 'yes').length + ' of ' + QF05.length, live(g.files).length]); }
  const wb = X.utils.book_new();
  const add = (name, aoa, widths, moneyCols) => {
    const ws = X.utils.aoa_to_sheet(aoa, {cellDates: true, dateNF: 'dd mmm yyyy'});
    ws['!cols'] = widths.map(w => ({wch: w})); ws['!freeze'] = {xSplit: 0, ySplit: 5};
    const rg = X.utils.decode_range(ws['!ref']);
    for (let r = 5; r <= rg.e.r; r++) for (const c of moneyCols) { const cell = ws[X.utils.encode_cell({r, c})]; if (cell && cell.t === 'n') cell.z = '#,##0.00'; }
    ws['!autofilter'] = {ref: X.utils.encode_range({s: {r: 4, c: 0}, e: {r: Math.max(4, rg.e.r), c: rg.e.c}})};
    X.utils.book_append_sheet(wb, ws, name);
  };
  add('Register', reg, [9, 46, 30, 16, 22, 12, 14, 14, 20, 7, 9, 9, 9, 14, 14, 14, 14, 26, 18, 30, 40, 10], [13, 14, 15, 16]);
  add('Lines', lines, [9, 6, 60, 8, 9, 10, 9, 9, 11, 14, 16, 10, 12, 14, 50], [12, 13]);
  add('Orders', ords, [9, 28, 16, 12, 12, 7, 14, 14, 14, 12, 10, 20, 14], [6]);
  add('Deliveries', dels, [9, 12, 7, 26, 14, 50, 10, 8, 10, 18, 30, 26, 20, 12, 8], []);
  X.writeFile(wb, 'Mashaeng_Requisition_Register_' + today() + '.xlsx', {compression: true});
}
// loads a register file made by the office (MR-00 to start with). Nothing already on the register is replaced.
async function importSeed(file){
  let j; try { j = JSON.parse(await file.text()); } catch (e) { throw {message: 'This is not a register file.'}; }
  if (!j || j.kind !== 'pg-requisitions-seed' || !Array.isArray(j.docs)) throw {message: 'This is not a register file made for this app.'};
  let made = 0, kept = 0;
  for (const x of j.docs) {
    const m = /^(rq|budget)\/([A-Za-z0-9_.~:@+-]{1,200})$/.exec(String(x && x.path || ''));
    if (!m || !x.data || typeof x.data !== 'object' || (m[1] === 'budget' && !m[2].startsWith('rq.'))) continue;
    const g = await rpc('sb_get', {p_path: x.path});
    if (g && g.exists) { if (m[1] === 'rq') kept++; putDoc(m[1], m[2], g.data, g.rev); continue; }
    await docSet(m[1], m[2], x.data); if (m[1] === 'rq') made++;
  }
  // the letterhead for printing travels with the register file and is kept in the database, behind the sign-in
  let lh = false;
  const pl = lhOf(j.print);
  if (pl && pl !== S.lh) {
    await rpc('sb_set', {p_path: 'rq_cfg/print', p_data: {v: 1, lh: pl, by: S.me.id, at: nowISO()}});
    setLh({lh: pl}, true); lh = true;
  }
  return {made, kept, lh, source: j.source || ''};
}
ACT['more-register'] = () => {
  if (!isDirector()) return;
  SHEET = {kind: 'more'};
  openSheet('Export or import', `<div class="sheet-bd">
    <div class="item"><b>The register as a spreadsheet</b><p class="help">Four sheets in the MR-00 layout: register, lines, orders and deliveries, with the budget values and the money. For directors: do not pass it to the site team.</p>
      <div class="acts"><button type="button" class="btn primary" data-act="export-xlsx">Download the Excel file</button><button type="button" class="btn" data-act="print-register">Print the open requisitions</button></div></div>
    <div class="item"><b>Load a register file</b><p class="help">Loads the requisitions of a register file made by the office, for instance MR-01 to MR-08 of 10 November 2026, and the letterhead the app prints on. A requisition that is already on the register is left as it is.</p>
      <label class="btn" style="width:max-content">Choose the file<input type="file" class="sr" accept=".json,application/json" data-pick="seed"></label><p class="small" id="seedMsg" role="status"></p></div>
  </div><div class="sheet-ft"><button type="button" class="btn" data-act="sheet-close">Close</button></div>`);
};
ACT['export-xlsx'] = async t => { working(t, true, 'Making the file…'); try { await exportRegister(); toast('The Excel file is in your downloads.'); } finally { working(t, false); } };
PICKS.seed = async files => {
  if (!needOnline()) return;
  const el = $('#seedMsg'); if (el) el.textContent = 'Loading…';
  try { const r = await importSeed(files[0]); if (el) el.textContent = `${plural(r.made, 'requisition')} loaded${r.kept ? ', ' + r.kept + ' already on the register and left as they are' : ''}${r.lh ? ', with the letterhead for printing' : ''}${r.source ? ' (' + r.source + ')' : ''}.`; VIEWS = null; render(false); }
  catch (e) { if (el) el.textContent = 'Not loaded: ' + errText(e); }
};

// ---------- printing ----------
const pHead = sub => `<div class="p-hl"><b>${esc(SITE_NAME)} · ${esc(CONTRACT)}</b><span>${esc(sub)}</span></div>`;
const pFoot = () => `<div class="p-foot">Printed ${esc(dlong(today()))} from the Pump Group requisitions app by ${esc((S.me && S.me.name) || '')}. Internal document.</div>`;
function printRq(id){
  const v = view(id); if (!v) return;
  const r = v.r, kv = (k, val) => val ? `<tr><td class="k">${esc(k)}</td><td>${val}</td></tr>` : '';
  const lastO = v.orders[v.orders.length - 1], lastG = v.grns[v.grns.length - 1];
  const rows = v.lines.map(l => `<tr><td>${esc(l.ref || l.n || '')}</td><td>${esc(l.siteDesc)}${LTYPE[l.type] ? ' (' + LTYPE[l.type].toLowerCase() + ')' : ''}${r.lines[l.id] && r.lines[l.id].note ? `<br><span style="color:#6b7280">${esc(r.lines[l.id].note)}</span>` : ''}</td>
    <td>${esc(l.unit || '')}</td><td class="num">${l.asked == null ? 'TBC' : qfmt(l.asked)}</td><td class="num">${!v.approved ? '' : l.ok ? (l.aq == null ? 'TBC' : qfmt(l.aq)) : 'No'}</td>
    <td class="num">${l.ok && l.oany ? (l.oq ? qfmt(l.oq) : 'Yes') : ''}</td><td class="num">${l.ok && (l.rany || l.received) ? (l.got ? qfmt(l.got) : 'Yes') : ''}</td><td${l.need ? ' class="nw"' : ''}>${esc(l.need ? dfmt(l.need) : (l.needTxt || ''))}</td></tr>`).join('');
  printDoc((r.no || 'Requisition') + ' ' + (r.title || ''), `${pHead('Material requisition ' + (r.no || ''))}
    <h1>${esc(r.no || '')} Material requisition</h1><div class="p-sub">${esc(r.title || '')}</div>
    <table class="pt">${kv('Status', esc(v.st.label) + (v.dec && v.dec.note ? ': ' + esc(v.dec.note) : ''))}${kv('Work front', esc(r.front || ''))}${kv('Needed on site', esc(whenParts(r.needBy, r.needTxt).filter(Boolean).join(' ')))}
      ${kv('Order by', esc(whenParts(r.orderBy, r.orderTxt).filter(Boolean).join(' ')))}${kv('When to order', esc(r.release || ''))}${kv('Deliver to', esc(r.deliverTo || ''))}
      ${kv('Programme activity', esc(r.wbs || ''))}${kv('Method statement or drawing', esc(r.ms || ''))}</table>
    <table class="pt"><thead><tr><th>Ref</th><th>Description</th><th>Unit</th><th class="num">Asked</th><th class="num">Approved</th><th class="num">Ordered</th><th class="num">On site</th><th>Needed</th></tr></thead><tbody>${rows}</tbody></table>
    ${(r.hold || []).length ? `<div class="p-box"><b>Do not buy:</b> ${r.hold.map(esc).join(' ')}</div>` : ''}
    ${r.note ? `<div class="p-box">${esc(r.note)}</div>` : ''}${(r.notes || []).length ? `<ul>${r.notes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <table class="pt"><thead><tr><th>Requested</th><th>Approved</th><th>Ordered</th><th>Received on site</th></tr></thead><tbody><tr>
      <td>${esc(whoOf(r))}<br>${esc(dfmt(r.sentAt, true))}</td>
      <td>${v.approved ? esc(nameOf(v.dec.by)) + '<br>' + esc(dfmt(v.dec.at, true)) : '<br><br>'}</td>
      <td>${lastO ? esc(lastO[1].supplier || '') + (lastO[1].ref ? ', ' + esc(lastO[1].ref) : '') + '<br>' + esc(dfmt(lastO[1].date || lastO[1].at, true)) + (v.orders.length > 1 ? ' (' + v.orders.length + ' orders)' : '') : '<br><br>'}</td>
      <td>${lastG ? esc(nameOf(lastG[1].by)) + '<br>' + esc(dfmt(lastG[1].date || lastG[1].at, true)) + ' (QF-05' + (v.grns.length > 1 ? ', ' + v.grns.length + ' deliveries' : '') + ')' : '<br><br>'}</td></tr></tbody></table>
    ${pFoot()}`);
}
ACT['rq-print'] = t => printRq(t.dataset.id);
ACT['print-buy'] = () => {
  const buy = allViews().filter(v => v.needOrder.length).sort((a, b) => String(a.r.orderBy || '9999').localeCompare(String(b.r.orderBy || '9999')) || byNeed(a, b));
  printDoc('Buying list ' + today(), `${pHead('Buying list')}<h1>Buying list</h1><div class="p-sub">Approved lines not ordered yet, ${esc(dlong(today()))}</div>
    ${buy.map(v => `<table class="pt"><thead><tr><th colspan="5">${esc(v.r.no)} ${esc(v.r.title || '')}${v.r.orderBy ? ' · order by ' + esc(dfmt(v.r.orderBy)) : ''}${v.r.needBy ? ' · needed ' + esc(dfmt(v.r.needBy)) : ''}</th></tr></thead><tbody>
      ${v.needOrder.map(l => `<tr><td style="width:10mm">${esc(l.ref || '')}</td><td>${esc(l.siteDesc)}</td><td class="num" style="width:22mm">${l.toOrder == null ? 'TBC' : qfmt(l.toOrder)} ${esc(l.unit || '')}</td><td style="width:26mm">${esc(l.need ? dfmt(l.need) : (l.needTxt || ''))}</td><td style="width:34mm">Supplier / order no:</td></tr>`).join('')}
      ${(v.r.hold || []).length ? `<tr><td colspan="5"><b>Do not buy:</b> ${v.r.hold.map(esc).join(' ')}</td></tr>` : ''}</tbody></table>`).join('')}${pFoot()}`);
};
ACT['print-register'] = () => {
  const V = allViews().filter(v => OPEN_STATES.includes(v.key)).reverse();
  closeSheet(true);
  printDoc('Requisition register ' + today(), `${pHead('MR-00 Requisition register')}<h1>MR-00 Requisition register</h1><div class="p-sub">Open requisitions, ${esc(dlong(today()))}</div>
    <table class="pt"><thead><tr><th>No</th><th>Requisition</th><th>Needed</th><th>Status</th><th class="num">Lines</th><th class="num">Ordered</th><th class="num">On site</th></tr></thead><tbody>
    ${V.map(v => `<tr><td class="nw">${esc(v.r.no)}</td><td>${esc(v.r.title || '')}<br><span style="color:#6b7280">${esc(v.r.front || '')}</span></td><td${v.r.needBy ? ' class="nw"' : ''}>${esc(v.r.needBy ? dfmt(v.r.needBy) : (v.r.needTxt || ''))}</td><td>${esc(v.st.label)}</td>
      <td class="num">${v.approved ? v.A.length : v.lines.length}</td><td class="num">${v.approved ? v.A.filter(l => l.ordered || l.received).length : ''}</td><td class="num">${v.approved ? v.A.filter(l => l.received).length : ''}</td></tr>`).join('')}</tbody></table>${pFoot()}`);
};
