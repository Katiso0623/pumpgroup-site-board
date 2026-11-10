// ---------- photos and documents ----------
// A photo is made smaller on the phone before it is sent (about 300 KB instead of several MB), with a small picture
// for the lists. Files are kept in the Pump Group file store and can only be opened by someone signed in to the team.
const MAX_FILE = 20 * 1024 * 1024, PHOTO_PX = 1800, THUMB_PX = 360;
const EXT_TYPE = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', doc: 'application/msword', xls: 'application/vnd.ms-excel'};
const OK_TYPE = new RegExp('^(' + [...new Set(Object.values(EXT_TYPE))].map(t => t.replace(/[.+]/g, '\\$&')).join('|') + ')$');
const ACCEPT = 'image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,video/mp4,video/quicktime';
function typeOf(f){
  let t = String((f && f.type) || '').toLowerCase().split(';')[0].trim();
  if (t === 'image/jpg' || t === 'image/pjpeg') t = 'image/jpeg';
  if ((!t || t === 'application/octet-stream') && f && f.name) { const x = String(f.name).toLowerCase().match(/\.([a-z0-9]+)$/); if (x && EXT_TYPE[x[1]]) t = EXT_TYPE[x[1]]; }
  return t;
}
const isImg = t => /^image\//.test(t || '');
const extOf = f => { const m = /\.([A-Za-z0-9]{1,5})$/.exec((f && f.name) || ''); return m ? m[1].toUpperCase() : isImg(f && f.type) ? 'IMG' : (f && f.type === 'application/pdf') ? 'PDF' : 'FILE'; };
const sizeTxt = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

async function drawSmall(file, px, q){
  let src = null, w = 0, h = 0, url = null;
  try { src = await createImageBitmap(file, {imageOrientation: 'from-image'}); w = src.width; h = src.height; }
  catch (e) {
    url = URL.createObjectURL(file);
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('picture')); i.src = url; });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  try {
    const k = Math.min(1, px / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('picture')), 'image/jpeg', q));
  } finally { if (url) URL.revokeObjectURL(url); if (src && src.close) src.close(); }
}
// turns what the person picked into what is kept until it is sent: {key, name, type, size, buf, tbuf, url}
async function prepFiles(list){
  const out = [], bad = [];
  for (const f of [...(list || [])]) {
    let type = typeOf(f), blob = f, tblob = null, name = f.name || 'photo.jpg';
    try {
      if (isImg(type) && type !== 'image/gif') {
        try {
          const small = await drawSmall(f, PHOTO_PX, 0.8);
          if (small.size < f.size || type !== 'image/jpeg') { blob = small; type = 'image/jpeg'; name = name.replace(/\.[A-Za-z0-9]+$/, '') + '.jpg'; }
          tblob = await drawSmall(blob, THUMB_PX, 0.7);
        } catch (e) { if (!OK_TYPE.test(type)) throw {message: 'this phone could not read the picture'}; }
      }
      if (!OK_TYPE.test(type)) throw {message: 'this kind of file cannot be uploaded'};
      if (blob.size > MAX_FILE) throw {message: 'it is larger than 20 MB'};
      if (!blob.size) throw {message: 'it is empty'};
      out.push({key: newKey(10), name: name.slice(0, 120), type, size: blob.size, buf: await blob.arrayBuffer(), tbuf: tblob ? await tblob.arrayBuffer() : null,
        url: URL.createObjectURL(tblob || blob)});
    } catch (e) { bad.push((f.name || 'A file') + ': ' + errText(e)); }
  }
  if (bad.length) toast('Not added. ' + bad.join('; '), true);
  return out;
}
async function uploadBlob(blob, type, level){
  const r = await rpc('sb_asset_new', {p_type: type, p_size: blob.size, p_level: level || 2});
  let up; try { up = await sb.storage.from(BUCKET).upload('a/' + r.id, blob, {contentType: type, upsert: false, cacheControl: '0'}); } catch (e) { up = {error: e}; }
  if (up.error) {
    try { await rpc('sb_asset_forget', {p_id: r.id}); } catch (e) {}
    const m = String(up.error.message || up.error);
    throw /fetch|network|load failed|timeout/i.test(m) ? {code: 'unavailable', message: 'No connection just now.'} : {code: 'upstream_error', message: 'The file was not uploaded: ' + m};
  }
  return r.id;
}
// uploads picked files now (with a signal) and returns the map that goes into a record: {<file number>: {name, type, size, th, by, at}}
async function uploadPrepared(list, level, onStep){
  const out = {}; let n = 0;
  for (const f of list) {
    if (onStep) onStep(++n, list.length);
    if (!f.asset) f.asset = await uploadBlob(new Blob([f.buf], {type: f.type}), f.type, level || 2);
    if (f.tbuf && !f.th) f.th = await uploadBlob(new Blob([f.tbuf], {type: 'image/jpeg'}), 'image/jpeg', level || 2);
    out[f.asset] = {name: f.name, type: f.type, size: f.size, th: f.th || null, by: S.me.id, at: nowISO()};
  }
  return out;
}

// opening a stored file: fetched once with this person's sign-in, then kept on the device for the next time
const FURL = new Map();
const FCACHE = 'pg-rq-files-1';
async function fileBlob(id){
  const key = new URL('_f/' + id, location.href).href;
  let c = null; try { c = await caches.open(FCACHE); const hit = await c.match(key); if (hit) return await hit.blob(); } catch (e) {}
  const {data, error} = await sb.storage.from(BUCKET).download('a/' + id);
  if (error || !data) throw mapErr(error || 'not found');
  try { if (c) await c.put(key, new Response(data, {headers: {'content-type': data.type || 'application/octet-stream'}})); } catch (e) {}
  return data;
}
async function fileUrl(id){
  if (FURL.has(id)) return FURL.get(id);
  const p = fileBlob(id).then(b => URL.createObjectURL(b));
  FURL.set(id, p); p.catch(() => FURL.delete(id));
  return p;
}
function hydrateThumbs(root){
  for (const img of $$('img[data-asset]', root || document)) {
    if (img.dataset.done) continue; img.dataset.done = '1';
    fileUrl(img.dataset.asset).then(u => { img.src = u; }).catch(() => { img.alt = 'Not loaded'; img.closest('.thumb') && img.closest('.thumb').classList.add('fail'); });
  }
}
// the row of small pictures for a record's files. where = how to find the files again when one is tapped
function thumbsHtml(files, where, canRemove){
  if (!files.length) return '';
  return `<div class="thumbs">${files.map(([id, f], i) => `<div class="thumb" title="${esc(f.name || '')}"><button type="button" class="thumb-b" data-act="file-open" data-where="${esc(where)}" data-i="${i}" aria-label="Open ${esc(f.name || 'file')}">
    ${f.th ? `<img data-asset="${esc(f.th)}" alt="">` : `<span class="ext">${esc(extOf(f))}</span><span class="cap">${esc(f.name || '')}</span>`}</button>
    ${canRemove ? `<button type="button" class="x" aria-label="Remove ${esc(f.name || 'file')}" data-act="file-remove" data-where="${esc(where)}" data-id="${esc(id)}">×</button>` : ''}</div>`).join('')}</div>`;
}
// files not yet sent (on a form): small pictures straight from the device
function pendingHtml(list, group){
  return list.map(f => `<div class="thumb pending" title="${esc(f.name)}">${isImg(f.type) ? `<img src="${esc(f.url)}" alt="${esc(f.name)}">` : `<span class="ext">${esc(extOf(f))}</span><span class="cap">${esc(f.name)}</span>`}
    <button type="button" class="x" aria-label="Remove ${esc(f.name)}" data-act="pend-remove" data-group="${esc(group)}" data-key="${esc(f.key)}">×</button></div>`).join('');
}
const addTile = (group, label) => `<label class="thumb add">${ICON.cam}<span>${esc(label || 'Add photo or file')}</span><input type="file" class="sr" multiple accept="${ACCEPT}" data-pick="${esc(group)}"></label>`;

// which files a tapped picture belongs to: "rq:<id>" the requisition's own, "grn:<id>:<key>" a delivery's, "ord:<id>:<key>" an order's,
// "cost:<cost id>" the invoice kept with a ledger entry
function filesAt(where){
  const [kind, id, key] = String(where).split(':'), r = S.rq.get(id);
  if (kind === 'rq') return {list: live(r && r.files).sort(byAt), path: ['files']};
  if (kind === 'grn') return {list: live(r && r.grn && r.grn[key] && r.grn[key].files).sort(byAt), path: ['grn', key, 'files']};
  if (kind === 'ord') return {list: live(r && r.orders && r.orders[key] && r.orders[key].files).sort(byAt), path: ['orders', key, 'files']};
  if (kind === 'cost') { const c = S.costs.get(id); return {list: c && c.doc ? [[c.doc, {name: c.docName || 'Invoice', type: c.docType || '', th: c.docTh || null}]] : [], path: null}; }
  return {list: [], path: null};
}
let VIEWING = null;
async function openViewer(where, i){
  const {list} = filesAt(where); if (!list.length) return;
  VIEWING = {where, i: Math.max(0, Math.min(list.length - 1, i | 0))};
  const d = $('#viewer'); if (!d.open) d.showModal();
  await drawViewer();
}
async function drawViewer(){
  const d = $('#viewer'); if (!VIEWING) return;
  const {list} = filesAt(VIEWING.where), ent = list[VIEWING.i]; if (!ent) { d.close(); return; }
  const [id, f] = ent, many = list.length > 1, tok = VIEWING.tok = newKey(6);
  d.innerHTML = `<div class="viewer-in"><div class="viewer-hd"><span class="nm">${esc(f.name || 'File')}${many ? ` <span class="muted">(${VIEWING.i + 1} of ${list.length})</span>` : ''}</span>
    <button type="button" class="btn sm" data-act="viewer-close">Close</button></div>
    <div class="viewer-bd" id="viewerBd"><div class="spin" aria-label="Loading"></div></div>
    <div class="viewer-ft">${many ? `<button type="button" class="btn sm" data-act="viewer-step" data-d="-1">Previous</button><button type="button" class="btn sm" data-act="viewer-step" data-d="1">Next</button>` : ''}
    <a class="btn sm" id="viewerSave" hidden>Save to this device</a><a class="btn sm" id="viewerOpen" target="_blank" rel="noopener" hidden>Open in a new tab</a></div></div>`;
  try {
    const u = await fileUrl(id); if (!VIEWING || VIEWING.tok !== tok) return;
    const bd = $('#viewerBd'), t = f.type || '';
    if (isImg(t)) bd.innerHTML = `<img src="${esc(u)}" alt="${esc(f.name || '')}">`;
    else if (/^video\//.test(t)) bd.innerHTML = `<video src="${esc(u)}" controls playsinline style="max-width:100%;max-height:100%"></video>`;
    else if (t === 'application/pdf' && !/Android|iPhone|iPad/i.test(navigator.userAgent)) bd.innerHTML = `<iframe src="${esc(u)}" title="${esc(f.name || 'Document')}"></iframe>`;
    else bd.innerHTML = `<div style="text-align:center"><p class="b">${esc(f.name || 'File')}</p><p class="muted small">${esc(extOf(f))} file${f.size ? ', ' + sizeTxt(f.size) : ''}. Use the buttons below to open or save it.</p></div>`;
    const s = $('#viewerSave'), o = $('#viewerOpen'); s.href = u; s.download = f.name || 'file'; s.hidden = false; o.href = u; o.hidden = isImg(t);
  } catch (e) { if (VIEWING && VIEWING.tok === tok) $('#viewerBd').innerHTML = `<p>${offlineErr(e) ? 'No connection: this file is not on the device yet.' : 'The file could not be opened.'}</p>`; }
}
// takes a file off a record (the record keeps a note of it being removed; the stored file goes too where that is allowed)
async function removeFileAt(where, id){
  const {list, path} = filesAt(where), ent = list.find(([k]) => k === id); if (!ent || !path) return;
  if (!confirm('Remove "' + (ent[1].name || 'this file') + '" from the requisition?')) return;
  const rqId = String(where).split(':')[1];
  let patch = {[id]: null}; for (let i = path.length - 1; i >= 0; i--) patch = {[path[i]]: patch};
  try {
    await docPatch('rq', rqId, patch);
    try { await sb.storage.from(BUCKET).remove(['a/' + id].concat(ent[1].th ? ['a/' + ent[1].th] : [])); await rpc('sb_asset_forget', {p_id: id}); if (ent[1].th) await rpc('sb_asset_forget', {p_id: ent[1].th}); } catch (e) {}
    toast('Removed.'); refresh();
  } catch (e) { toast('Not removed: ' + errText(e), true); }
}
