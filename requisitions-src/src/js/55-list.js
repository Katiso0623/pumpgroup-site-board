// ---------- the register: every requisition, with a filter and a search ----------
const LIST_F = [
  ['open', 'Open', v => OPEN_STATES.includes(v.key)],
  ['approve', 'To approve', v => v.key === 'sent'],
  ['office', 'Question or hold', v => v.key === 'query' || v.key === 'hold' || v.key === 'rejected'],
  ['order', 'To order', v => v.needOrder.length > 0],
  ['coming', 'On order', v => v.expect.length > 0],
  ['done', 'Delivered', v => v.key === 'delivered' || v.key === 'closed'],
  ['all', 'All', () => true],
];
function listRows(route){
  const f = LIST_F.find(x => x[0] === route.q.get('f')) || LIST_F[0], q = (route.q.get('q') || '').trim().toLowerCase();
  let V = allViews().filter(f[2]);
  if (q) V = V.filter(v => [v.r.no, v.r.title, v.r.front, v.r.deliverTo, v.r.wbs, v.r.ms, ...v.lines.map(l => l.desc), ...v.orders.map(([, o]) => (o.supplier || '') + ' ' + (o.ref || ''))].join(' ').toLowerCase().includes(q));
  return {f, q, V};
}
PAGES.list = {
  title: 'Requisitions',
  render(route){
    const {f, q, V} = listRows(route), all = allViews(), dir = isDirector();
    const prog = v => { if (!v.approved || !v.A.length) return ''; const nO = v.A.filter(l => l.ordered || l.received).length, nR = v.A.filter(l => l.received).length; return `${nR} of ${v.A.length} delivered` + (nO > nR ? `, ${nO - nR} on order` : ''); };
    const rows = V.map(v => `<tr class="click" data-href="#/rq/${encodeURIComponent(v.id)}" tabindex="0">
      <td class="mono nowrap" data-l="No"><a href="#/rq/${encodeURIComponent(v.id)}">${esc(v.r.no || 'New')}</a></td>
      <td class="full"><b>${esc(v.r.title || 'Requisition')}</b>${v.r.urgent ? ' <span class="pill p-bad">Urgent</span>' : ''}<span class="sub">${esc(v.r.front || '')}</span></td>
      <td data-l="Needed" class="nowrap">${v.r.needBy ? esc(dfmt(v.r.needBy)) + (v.needLate ? ' <span class="pill p-bad">late</span>' : '') : esc(v.r.needTxt || '')}</td>
      <td data-l="Status">${stPill(v)}${v.orderLate ? ' <span class="pill p-bad">Order late</span>' : ''}${v.late ? ' <span class="pill p-bad">Delivery late</span>' : ''}</td>
      <td data-l="Lines">${v.lines.length}<span class="sub">${esc(prog(v))}</span></td>
      ${dir ? `<td class="num" data-l="Budget value">${v.est ? esc(money(v.est)) : '<span class="muted">not priced</span>'}</td>` : ''}
      <td data-l="Asked by" class="hide-m">${esc(firstName2(v.r))}</td></tr>`).join('');
    return `<div class="stack">
      ${pageHead('Requisitions', `${all.length} on the register for ${esc(SITE_NAME)}.`, `<a class="btn primary" href="#/new">${ICON.plus} New requisition</a>${dir ? `<button type="button" class="btn" data-act="more-register">Export or import</button>` : ''}`)}
      <div class="chips" role="group" aria-label="Show">${LIST_F.map(x => `<button type="button" class="chip" aria-pressed="${x[0] === f[0]}" data-act="list-f" data-f="${x[0]}">${esc(x[1])}<span class="c">${all.filter(x[2]).length}</span></button>`).join('')}</div>
      <input class="search" type="search" placeholder="Search number, material, supplier" aria-label="Search the register" value="${esc(q)}" data-keep="list-q" data-in="list-q">
      ${V.length ? `<div class="tbl stackable"><table><thead><tr><th>No</th><th>Requisition</th><th>Needed</th><th>Status</th><th>Lines</th>${dir ? '<th class="num">Budget value</th>' : ''}<th>Asked by</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : emptyBox(q ? 'Nothing matches' : 'Nothing here', q ? 'Try another word, or another filter.' : 'No requisition is at this stage.')}
    </div>`;
  },
};
const listHash = (f, q) => '#/list?f=' + encodeURIComponent(f) + (q ? '&q=' + encodeURIComponent(q) : '');
ACT['list-f'] = t => go(listHash(t.dataset.f, ROUTE.q.get('q') || ''));
const listSearch = debounce(v => { if (ROUTE.name === 'list') { history.replaceState(null, '', listHash(ROUTE.q.get('f') || 'open', v)); render(false); } }, 250);
document.addEventListener('input', ev => { if (ev.target.dataset && ev.target.dataset.in === 'list-q') listSearch(ev.target.value.trim()); });
