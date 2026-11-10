// ---------- account: who is signed in, the password, installing the app, and the team (directors) ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installEvt = ev; });
window.addEventListener('appinstalled', () => { installEvt = null; });
const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const ROLE_TXT = {owner: 'Director (owner)', editor: 'Director', contributor: 'Site team', viewer: 'Site Board viewer (no access here)'};
async function api(op, body){
  const {data, error} = await sb.functions.invoke('site-board-api', {body: {op, ...body}});
  if (error) {
    let m = error.message || 'failed';
    try { const j = error.context && typeof error.context.json === 'function' ? await error.context.json() : null; if (j && j.error) m = j.error; } catch (e) {}
    throw {code: /fetch|network/i.test(m) ? 'unavailable' : 'invalid_request', message: /fetch|network/i.test(m) ? 'No connection. Try again.' : m};
  }
  if (data && data.error) throw {code: 'invalid_request', message: data.error};
  return data;
}
function accountHtml(){
  const me = S.me || {}, ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return `<div class="sheet-bd">
    <div class="item"><b>${esc(me.name || '')}</b><div class="kv"><span>${esc(me.email || '')}</span><span class="pill p-info">${esc(ROLE_TXT[me.role] || me.role || '')}</span></div>
      <p class="help">${isDirector() ? 'You approve requisitions, record orders and see the money.' : 'You ask for materials and book deliveries in. Amounts are for the directors only.'} The same login opens the Pump Group Site Board.</p>
      <div class="acts"><button type="button" class="btn" data-act="acct-pass">Change my password</button><a class="btn" href="../">Open the Site Board</a><button type="button" class="btn danger" data-pg="signout">Sign out</button></div>
      <div id="acctPass"></div></div>
    <div class="item"><b>Put the app on this device</b>
      ${standalone() ? '<p class="help">It is installed: this is the app, opened from its own icon.</p>' : installEvt ? `<p class="help">Adds Requisitions to the home screen or the desktop with its own icon.</p><div class="acts"><button type="button" class="btn primary" data-act="acct-install">Install the app</button></div>`
        : ios ? '<p class="help">On an iPhone or iPad: open this page in Safari, tap the Share button, then "Add to Home Screen".</p>'
        : '<p class="help">In Chrome or Edge: open the browser menu (the three dots) and choose "Install app" or "Add to Home screen". On a phone that already has the Site Board installed, choose "Add to Home screen" for a shortcut that opens Requisitions.</p>'}</div>
    ${isDirector() ? `<div class="item"><div class="item-h"><b>The team</b><button type="button" class="btn sm primary" data-act="team-add">Add a person</button></div>
      <p class="help">Site team members can raise requisitions and book deliveries in. Directors also approve, order and see the money. A login made here also opens the Site Board.</p>
      ${S.setup === false ? '<div class="notice warn">Do not add site logins yet: one set-up step in the database is still open (see the note at the top of the page).</div>' : ''}
      <div id="teamBox" class="team"><div class="gate-load"><div class="spin sm"></div><span>Loading the team…</span></div></div></div>` : ''}
    <p class="help">Requisitions for ${esc(SITE_NAME)}, ${esc(CONTRACT)}. Version __BUILD__.</p>
  </div><div class="sheet-ft"><button type="button" class="btn" data-act="sheet-close">Close</button></div>`;
}
ACT.account = () => { SHEET = {kind: 'account'}; openSheet('Account', accountHtml()); if (isDirector()) drawTeam(); };
ACT['acct-install'] = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; ACT.account(); };
ACT['acct-pass'] = () => { $('#acctPass').innerHTML = `<form id="pgFChange2" class="form" style="margin-top:10px"><label>New password<input name="p1" type="password" autocomplete="new-password" minlength="8" required></label>
  <label>Type it again<input name="p2" type="password" autocomplete="new-password" minlength="8" required></label><div class="acts"><button class="btn primary" type="submit">Save my password</button></div><p class="small msg" role="status"></p></form>`; $('#acctPass input').focus(); };
async function drawTeam(){
  const box = $('#teamBox'); if (!box) return;
  let L; try { L = await rpc('sb_team'); } catch (e) { box.innerHTML = `<p class="err">${esc(offlineErr(e) ? 'No connection: the team list could not be loaded.' : errText(e))}</p>`; return; }
  if (!$('#teamBox')) return;
  const owner = S.lvl >= 4;
  box.innerHTML = (L || []).map(m => {
    const mine = m.id === S.me.id, can = !mine && m.role !== 'owner' && (owner || m.role !== 'editor');
    return `<div class="mem${m.active ? '' : ' off'}"><div><b>${esc(m.name || m.email)}</b> <span class="pill ${m.role === 'viewer' ? 'p-n' : 'p-info'}">${esc(ROLE_TXT[m.role] || m.role)}</span>${m.active ? '' : ' <span class="pill p-bad">Access off</span>'}${m.mustChange ? ' <span class="pill p-warn">Temporary password</span>' : ''}
        <div class="small muted">${esc(m.email)} · last on ${esc(ago(m.lastSeen))}</div></div>
      ${can ? `<div class="mem-act"><select aria-label="Role of ${esc(m.name || m.email)}" data-team-role="${esc(m.id)}">${[['contributor', 'Site team'], ['editor', 'Director'], ['viewer', 'Site Board viewer']].filter(([k]) => owner || k !== 'editor').map(([k, t]) => `<option value="${k}"${k === m.role ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <button type="button" class="btn sm" data-act="team-reset" data-id="${esc(m.id)}" data-name="${esc(m.name || m.email)}">New password</button>
        <button type="button" class="btn sm ${m.active ? 'danger' : ''}" data-act="team-active" data-id="${esc(m.id)}" data-on="${m.active ? '0' : '1'}">${m.active ? 'Turn access off' : 'Turn access on'}</button></div>` : ''}</div>`;
  }).join('') || '<p class="muted">Nobody yet.</p>';
}
document.addEventListener('change', async ev => {
  const t = ev.target; if (!t.dataset || !t.dataset.teamRole) return;
  try { await rpc('sb_team_set', {p_user: t.dataset.teamRole, p_role: t.value}); toast('Role changed.'); loadPeople(); } catch (e) { toast('Not changed: ' + errText(e), true); }
  drawTeam();
});
ACT['team-active'] = async t => {
  const on = t.dataset.on === '1';
  if (!on && !confirm('Turn this person\'s access off? They are signed out of Requisitions and the Site Board.')) return;
  try { await rpc('sb_team_set', {p_user: t.dataset.id, p_active: on}); toast(on ? 'Access is on again.' : 'Access is off.'); } catch (e) { toast('Not changed: ' + errText(e), true); }
  drawTeam();
};
const credText = (name, email, pw) => `Hello ${String(name || '').split(/\s+/)[0]}, here is your login for the Pump Group Requisitions app (${SITE_NAME}).\n\nOpen: ${appLink('')}\nEmail: ${email}\nTemporary password: ${pw}\n\nThe app asks you to choose your own password the first time. To put it on your phone, open the link in Chrome (or Safari on an iPhone) and choose "Add to Home screen". The same login opens the Site Board.`;
function credHtml(title, name, email, pw){
  const text = credText(name, email, pw);
  return `<div class="notice ok cred"><b>${esc(title)}</b><p class="small">Send these details to ${esc(String(name || '').split(/\s+/)[0] || 'the person')} yourself. The password is shown only now.</p><pre>${esc(text)}</pre>
    <div class="acts"><a class="btn sm primary" href="${esc(waLink(text))}" target="_blank" rel="noopener">Send on WhatsApp</a><button type="button" class="btn sm" data-act="copy" data-text="${esc(text)}">Copy</button>
      <a class="btn sm" href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Your login for Pump Group Requisitions')}&body=${encodeURIComponent(text)}">Email</a></div></div>`;
}
ACT.copy = async t => { try { await navigator.clipboard.writeText(t.dataset.text); toast('Copied.'); } catch (e) { toast('Could not copy: select the text and copy it by hand.', true); } };
ACT['team-reset'] = async t => {
  if (!confirm('Give ' + t.dataset.name + ' a new temporary password? The old password stops working.')) return;
  working(t, true, 'Working…');
  try { const r = await api('member_reset', {user_id: t.dataset.id}); const box = $('#teamBox'); if (box) box.insertAdjacentHTML('beforebegin', credHtml('New temporary password', t.dataset.name, r.email, r.temp_password)); }
  catch (e) { toast('Not done: ' + errText(e), true); }
  finally { working(t, false); }
};
ACT['team-add'] = () => {
  const box = $('#teamBox'); if (!box || $('#teamAdd')) return;
  box.insertAdjacentHTML('beforebegin', `<form id="teamAdd" class="form panel flat" data-form="team-add"><div class="frow"><label>Full name<input name="name" maxlength="120" required autocomplete="off"></label><label>Email address<input name="email" type="email" required autocomplete="off" autocapitalize="off"></label></div>
    <label>What they do<select name="role"><option value="contributor">Site team: raises requisitions and books deliveries in</option>${S.lvl >= 4 ? '<option value="editor">Director: approves, orders and sees the money</option>' : ''}</select></label>
    <div class="acts"><button class="btn primary" type="submit">Add and make a password</button><button type="button" class="btn" data-act="team-add-x">Cancel</button></div><p class="small err" role="alert"></p></form>`);
  $('#teamAdd input').focus();
};
ACT['team-add-x'] = () => { const f = $('#teamAdd'); if (f) f.remove(); };
FORMS['team-add'] = async f => {
  const e = f.elements, btn = $('button[type=submit]', f), msg = $('.err', f), name = e.name.value.trim(), email = e.email.value.trim().toLowerCase();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Enter the full name and a valid email address.'; return; }
  working(btn, true, 'Adding…'); msg.textContent = '';
  try {
    const r = await api('member_add', {full_name: name, email, role: e.role.value});
    f.outerHTML = r.temp_password ? credHtml(name + ' is on the team', name, r.email, r.temp_password)
      : `<div class="notice ok"><b>${esc(name)} is on the team.</b> They already have a Pump Group login (${esc(r.email)}) and sign in with their own password. Send them the link: ${esc(appLink(''))}</div>`;
    loadPeople(); drawTeam();
  } catch (er) { working(btn, false); msg.textContent = 'Not added: ' + errText(er); }
};
