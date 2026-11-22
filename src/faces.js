// =====================================================================
// faces.js — Face recognition (100% on the phone, no server):
//  • People ("Orang"): name + sample faces (128-number fingerprints)
//  • Face tagger: tap a detected face or draw a box to crop one, give it a name
//  • Auto-tag: every new upload is scanned; recognised faces add the person's
//    name as a tag. Stored fingerprints let the whole library be re-matched
//    instantly whenever a new sample is added.
// Models (face-api / TensorFlow.js, ~12 MB) load only when this feature is used.
// =====================================================================
import {
  S, $, $$, el, esc, icon, uid, toast, sfx, emit, on, openModal, confirmDialog, promptDialog, actionSheet,
  savePhotos, savePerson, personById, photoById, deleteRecords, addLog, thumbUrl, fullUrl, isVideo, native, setSetting, hydrateThumbs
} from './core.js';

const MODEL_URL = './models';
export const STRICTNESS = { ketat: 0.45, normal: 0.52, longgar: 0.6 };
const threshold = () => STRICTNESS[S.settings.faceStrict] || 0.52;
export const personTag = name => String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^#+/, '').slice(0, 40);

// ----------------------------------------------------------- models
let api = null, loading = null;
export async function loadModels({ quiet = false } = {}) {
  if (api) return api;
  if (!loading) loading = (async () => {
    const md = quiet ? null : openModal({
      title: 'Menyiapkan pengenal wajah', dismissable: false,
      body: `<p class="msg">Pertama kali perlu mengunduh data pengenal wajah (±13 MB). Setelah itu bisa dipakai tanpa internet.</p><div class="up-progress"><i style="width:35%"></i></div>`
    });
    try {
      const faceapi = await import('@vladmandic/face-api');
      try { await faceapi.tf.setBackend('webgl'); } catch { /* fall back to default */ }
      await faceapi.tf.ready();
      const bar = md && $('.up-progress i', md.el);
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL); if (bar) bar.style.width = '65%';
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL); if (bar) bar.style.width = '75%';
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL); if (bar) bar.style.width = '100%';
      api = faceapi;
      return api;
    } catch (e) {
      loading = null;
      throw e;
    } finally { md && md.close(); }
  })();
  return loading;
}

// ------------------------------------------------------------ helpers
const r3 = v => Math.round(v * 1000) / 1000;
const r4 = v => Math.round(v * 10000) / 10000;
export function faceDist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }
export function match(d) {
  let best = null, bd = Infinity;
  for (const p of S.people) for (const smp of p.samples || []) { const x = faceDist(d, smp.d); if (x < bd) { bd = x; best = p; } }
  return best && bd < threshold() ? { pid: best.id, dist: bd } : null;
}
function loadImg(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
// Photo → canvas (rotation applied, max side `max`)
export async function photoCanvas(p, max = 1280) {
  const url = isVideo(p) || p.unsupported ? await thumbUrl(p.id) : (await fullUrl(p.id) || await thumbUrl(p.id));
  const img = await loadImg(url);
  const r = ((p.rot || 0) % 360 + 360) % 360;
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const c = document.createElement('canvas');
  const swap = r === 90 || r === 270;
  c.width = swap ? h : w; c.height = swap ? w : h;
  const g = c.getContext('2d');
  g.translate(c.width / 2, c.height / 2); g.rotate(r * Math.PI / 180);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}
export async function detect(canvas) {
  const fa = await loadModels({ quiet: true });
  const res = await fa.detectAllFaces(canvas, new fa.SsdMobilenetv1Options({ minConfidence: 0.45, maxResults: 30 })).withFaceLandmarks().withFaceDescriptors();
  return res.filter(r => r.detection.box.width >= 24).map(r => {
    const b = r.detection.box;
    return { b: [r4(b.x / canvas.width), r4(b.y / canvas.height), r4(b.width / canvas.width), r4(b.height / canvas.height)], d: Array.from(r.descriptor, r3) };
  });
}
// Descriptor for a hand-drawn box (pixels in canvas space)
async function cropDescriptor(canvas, x, y, w, h) {
  const fa = await loadModels({ quiet: true });
  const m = 0.25;
  const cx = Math.max(0, x - w * m), cy = Math.max(0, y - h * m);
  const cw = Math.min(canvas.width - cx, w * (1 + 2 * m)), ch = Math.min(canvas.height - cy, h * (1 + 2 * m));
  const c = document.createElement('canvas'); c.width = Math.round(cw); c.height = Math.round(ch);
  c.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, c.width, c.height);
  let one = null;
  try { one = await fa.detectSingleFace(c, new fa.SsdMobilenetv1Options({ minConfidence: 0.2 })).withFaceLandmarks().withFaceDescriptor(); } catch { one = null; }
  if (one) return Array.from(one.descriptor, r3);
  const sq = document.createElement('canvas'); sq.width = sq.height = 150;
  sq.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, 150, 150);
  const d = await fa.computeFaceDescriptor(sq);
  return Array.from(Array.isArray(d) ? d[0] : d, r3);
}
function cropThumb(canvas, b) {
  const [x, y, w, h] = [b[0] * canvas.width, b[1] * canvas.height, b[2] * canvas.width, b[3] * canvas.height];
  const m = 0.18, s = Math.max(w, h) * (1 + 2 * m);
  const c = document.createElement('canvas'); c.width = c.height = 112;
  c.getContext('2d').drawImage(canvas, x + w / 2 - s / 2, y + h / 2 - s / 2, s, s, 0, 0, 112, 112);
  return c.toDataURL('image/jpeg', 0.8);
}

// Recompute the person tags of a photo from its faces.
export function applyFaceTags(p) {
  const names = [...new Set((p.faces || []).map(f => f.pid && personById(f.pid)).filter(Boolean).map(x => personTag(x.name)).filter(Boolean))];
  const old = new Set(p.faceTags || []);
  const before = (p.tags || []).join('|');
  p.tags = [...new Set([...(p.tags || []).filter(t => !old.has(t) || names.includes(t)), ...names])];
  const changed = before !== p.tags.join('|') || (p.faceTags || []).join('|') !== names.join('|');
  p.faceTags = names;
  return changed;
}
export const peopleIn = p => [...new Set((p.faces || []).map(f => f.pid).filter(Boolean))].map(personById).filter(Boolean);

// ------------------------------------------------------- scanning queue
const queue = [];
let running = false, chip = null, total = 0, done = 0;
function paintChip() {
  if (!queue.length && !running) { chip?.remove(); chip = null; return; }
  if (!chip) { chip = el(`<div class="face-chip">${icon('user', 'sm')}<span></span></div>`); document.body.appendChild(chip); }
  $('span', chip).textContent = `Mendeteksi wajah ${done}/${total}`;
}
export function queueScan(ids, { force = false } = {}) {
  const add = ids.filter(id => { const p = photoById(id); return p && !p.deleted && (force || !p.facesScanned) && !queue.includes(id); });
  if (!add.length) return 0;
  queue.push(...add); total += add.length; paintChip(); work();
  return add.length;
}
async function work() {
  if (running) return;
  running = true;
  try { await loadModels({ quiet: true }); }
  catch (e) { console.warn('face models', e); queue.length = 0; running = false; total = done = 0; paintChip(); toast('Pengenal wajah gagal dimuat — periksa internet lalu coba lagi', { type: 'error' }); return; }
  let found = 0;
  while (queue.length) {
    const id = queue.shift();
    const p = photoById(id);
    if (p && !p.deleted) {
      try {
        const c = await photoCanvas(p, 1024);
        const faces = await detect(c);
        const keep = (p.faces || []).filter(f => f.manual);
        const auto = faces.filter(f => !keep.some(k => overlap(k.b, f.b) > 0.4)).map(f => ({ ...f, pid: match(f.d)?.pid || null }));
        p.faces = [...keep, ...auto];
        p.facesScanned = true;
        applyFaceTags(p);
        found += auto.filter(f => f.pid).length;
        await savePhotos(p);
      } catch (e) { console.warn('scan', id, e); }
    }
    done++; paintChip();
    await new Promise(r => setTimeout(r, 30));
  }
  running = false;
  const n = total; total = done = 0; paintChip();
  emit('change');
  if (n > 1 || found) toast(found ? `Selesai: ${found} wajah dikenali di ${n} foto` : `Selesai memindai ${n} foto`, { type: 'success' });
}
function overlap(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / Math.min(a[2] * a[3], b[2] * b[3]);
}
// After samples change: re-match every stored (non-manual) face. Fast: no AI needed.
let rematchT = null;
export function rematchSoon() { clearTimeout(rematchT); rematchT = setTimeout(rematchAll, 300); }
export async function rematchAll() {
  const changed = [];
  for (const p of S.photos) {
    if (!p.faces?.length) continue;
    let dirty = false;
    for (const f of p.faces) {
      if (f.manual) continue;
      const pid = match(f.d)?.pid || null;
      if (pid !== (f.pid || null)) { f.pid = pid; dirty = true; }
    }
    if (applyFaceTags(p) || dirty) changed.push(p);
  }
  for (let i = 0; i < changed.length; i += 100) await savePhotos(changed.slice(i, i + 100));
  if (changed.length) emit('change');
  return changed.length;
}
export function scanLibrary() {
  const n = queueScan(S.photos.filter(p => !p.deleted).map(p => p.id));
  if (!n) toast('Semua foto sudah dipindai. Wajah dicocokkan ulang…');
  rematchAll();
}
// called after uploads
export function autoScan(ids) { if (S.settings.faceAuto !== false && S.people.length) queueScan(ids); }

// ------------------------------------------------------------- people
export async function createPerson(name) {
  if (name == null) name = await promptDialog('Orang baru', { label: 'Nama', placeholder: 'mis. Kirana, Ayah, Nenek', okLabel: 'Simpan', maxLength: 40 });
  if (name == null || !name.trim()) return null;
  const p = { id: uid(), name: name.trim(), samples: [], createdAt: Date.now() };
  await savePerson(p);
  addLog('person-add', `menambahkan orang “${p.name}”`);
  sfx('success');
  return p;
}
export async function renamePerson(pr) {
  const v = await promptDialog('Ganti nama', { value: pr.name, label: 'Nama', maxLength: 40 });
  if (v == null || !v.trim() || v.trim() === pr.name) return;
  pr.name = v.trim(); await savePerson(pr);
  const changed = S.photos.filter(p => p.faces?.some(f => f.pid === pr.id) && applyFaceTags(p));
  if (changed.length) await savePhotos(changed);
  toast('Nama diganti', { type: 'success' }); emit('change');
}
export async function deletePerson(pr) {
  if (!(await confirmDialog(`Hapus “${pr.name}” dan semua sampel wajahnya? Tag nama ini dihapus dari foto.`, { title: 'Hapus orang', okLabel: 'Hapus', danger: true }))) return false;
  const changed = [];
  S.photos.forEach(p => { if (p.faces?.some(f => f.pid === pr.id)) { p.faces.forEach(f => { if (f.pid === pr.id) { f.pid = null; f.manual = false; } }); changed.push(p); } });
  await deleteRecords('people', [pr.id]);
  changed.forEach(applyFaceTags);
  if (changed.length) await savePhotos(changed);
  addLog('person-delete', `menghapus orang “${pr.name}”`);
  sfx('delete'); toast('Orang dihapus'); emit('change');
  return true;
}
async function addSample(pr, d, thumb, photoId) {
  pr.samples = [...(pr.samples || []), { id: uid(), d, t: thumb, ph: photoId }].slice(-40);
  await savePerson(pr);
  rematchSoon();
}
export async function removeSample(pr, sid) {
  pr.samples = (pr.samples || []).filter(s => s.id !== sid);
  await savePerson(pr);
  rematchSoon();
}
export const personAvatar = (pr, cls = '') => pr?.samples?.[0]?.t
  ? `<span class="avatar ${cls}" style="--c:#333"><img src="${pr.samples[0].t}" alt=""></span>`
  : `<span class="avatar ${cls}" style="--c:var(--accent)">${esc((pr?.name || '?')[0].toUpperCase())}</span>`;

// Pick a person (or create one) — resolves person or null; 'remove' for removing the box
function choosePerson(title, { allowRemove = false, current = null } = {}) {
  return new Promise(resolve => {
    let out = null, creating = false;
    const md = openModal({
      sheet: true, title,
      body: `<div class="sheet-list">
        <button class="row" data-new><span class="ri">${icon('plus', 'sm')}</span><span class="rt"><b>Orang baru…</b></span></button>
        ${S.people.map(p => `<button class="row" data-p="${p.id}">${personAvatar(p, 'sm')}<span class="rt"><b>${esc(p.name)}</b><small>${(p.samples || []).length} sampel wajah</small></span>${current === p.id ? `<span class="rv">${icon('check', 'sm')}</span>` : ''}</button>`).join('')}
        ${allowRemove ? `<button class="row" data-unk><span class="ri yellow">${icon('x', 'sm')}</span><span class="rt"><b>Bukan siapa-siapa / lepas nama</b></span></button>
        <button class="row danger" data-rm><span class="ri red">${icon('trash', 'sm')}</span><span class="rt"><b>Hapus kotak ini</b><small>Bukan wajah</small></span></button>` : ''}
      </div>`,
      onClose: () => { if (!creating) resolve(out); }
    });
    $$('[data-p]', md.el).forEach(b => b.onclick = () => { out = personById(b.dataset.p); md.close(); });
    $('[data-new]', md.el).onclick = async () => { creating = true; md.close(); out = await createPerson(); resolve(out); };
    const unk = $('[data-unk]', md.el); if (unk) unk.onclick = () => { out = 'none'; md.close(); };
    const rm = $('[data-rm]', md.el); if (rm) rm.onclick = () => { out = 'remove'; md.close(); };
  });
}

// ---------------------------------------------------------- face tagger
export async function openFaceTagger(p, { personId = null } = {}) {
  if (!p) return;
  try { await loadModels(); } catch { toast('Pengenal wajah gagal dimuat — butuh internet untuk pertama kali', { type: 'error' }); return; }
  const root = el(`<div class="ftag">
    <div class="ftag-top"><button class="v-btn" data-f="close">${icon('x')}</button><b>Tandai wajah</b>
      <button class="btn sm" data-f="draw">${icon('edit', 'sm')} Kotak manual</button></div>
    <div class="ftag-stage"><div class="ftag-wrap"><canvas></canvas><div class="ftag-boxes"></div><div class="ftag-draw" hidden></div></div></div>
    <div class="ftag-hint">Mendeteksi wajah…</div></div>`);
  document.body.appendChild(root);
  const unBack = native.onBack(() => { close(); return true; });
  const hint = $('.ftag-hint', root), wrap = $('.ftag-wrap', root), boxes = $('.ftag-boxes', root), drawEl = $('.ftag-draw', root);
  let drawMode = false, dirty = false;
  const canvas = await photoCanvas(p, 1280);
  const view = $('canvas', root);
  view.width = canvas.width; view.height = canvas.height;
  view.getContext('2d').drawImage(canvas, 0, 0);
  const fit = () => {
    const st = $('.ftag-stage', root).getBoundingClientRect();
    const s = Math.min(st.width / canvas.width, st.height / canvas.height);
    wrap.style.width = canvas.width * s + 'px'; wrap.style.height = canvas.height * s + 'px';
  };
  fit(); window.addEventListener('resize', fit);
  let faces = p.facesScanned ? (p.faces || []).map(f => ({ ...f })) : null;
  if (!faces) {
    try { faces = (await detect(canvas)).map(f => ({ ...f, pid: match(f.d)?.pid || null })); }
    catch (e) { console.warn(e); faces = []; }
    p.faces = faces; p.facesScanned = true; applyFaceTags(p); await savePhotos(p); dirty = true;
  }
  const paint = () => {
    boxes.innerHTML = faces.map((f, i) => {
      const pr = f.pid && personById(f.pid);
      return `<button class="fbox ${pr ? 'named' : ''} ${f.manual ? 'manual' : ''}" data-i="${i}" style="left:${f.b[0] * 100}%;top:${f.b[1] * 100}%;width:${f.b[2] * 100}%;height:${f.b[3] * 100}%"><span>${pr ? esc(pr.name) : 'Siapa?'}</span></button>`;
    }).join('');
    const target = personId && personById(personId);
    hint.textContent = drawMode ? 'Geser jari di atas wajah untuk membuat kotak'
      : faces.length ? (target ? `Ketuk wajah ${target.name}` : 'Ketuk kotak wajah untuk memberi nama') : 'Tidak ada wajah terdeteksi — pakai “Kotak manual” untuk memotong wajah';
  };
  paint();
  async function assign(i) {
    const f = faces[i];
    let pr = personId ? personById(personId) : await choosePerson('Ini siapa?', { allowRemove: true, current: f.pid });
    if (!pr) return;
    if (pr === 'remove') faces.splice(i, 1);
    else if (pr === 'none') { f.pid = null; f.manual = true; }
    else {
      f.pid = pr.id; f.manual = true;
      await addSample(pr, f.d, cropThumb(canvas, f.b), p.id);
      sfx('success'); toast(`Ditandai: ${pr.name}`, { type: 'success' });
    }
    p.faces = faces.map(x => ({ ...x }));
    applyFaceTags(p); await savePhotos(p); dirty = true;
    paint();
  }
  boxes.addEventListener('click', e => { const b = e.target.closest('.fbox'); if (b && !drawMode) { sfx('tap'); assign(+b.dataset.i); } });
  $('[data-f="close"]', root).onclick = close;
  $('[data-f="draw"]', root).onclick = () => { drawMode = !drawMode; $('[data-f="draw"]', root).classList.toggle('primary', drawMode); drawEl.hidden = !drawMode; paint(); };
  // drawing a manual box
  let start = null;
  drawEl.addEventListener('pointerdown', e => { const r = wrap.getBoundingClientRect(); start = { x: e.clientX - r.left, y: e.clientY - r.top, r }; drawEl.setPointerCapture(e.pointerId); drawEl.innerHTML = '<i></i>'; });
  drawEl.addEventListener('pointermove', e => {
    if (!start) return;
    const x = e.clientX - start.r.left, y = e.clientY - start.r.top;
    const i = $('i', drawEl);
    Object.assign(i.style, { left: Math.min(x, start.x) + 'px', top: Math.min(y, start.y) + 'px', width: Math.abs(x - start.x) + 'px', height: Math.abs(y - start.y) + 'px' });
  });
  drawEl.addEventListener('pointerup', async e => {
    if (!start) return;
    const r = start.r; const x = e.clientX - r.left, y = e.clientY - r.top;
    const bx = Math.max(0, Math.min(x, start.x) / r.width), by = Math.max(0, Math.min(y, start.y) / r.height);
    const bw = Math.min(1 - bx, Math.abs(x - start.x) / r.width), bh = Math.min(1 - by, Math.abs(y - start.y) / r.height);
    start = null; drawEl.innerHTML = '';
    if (bw * r.width < 16 || bh * r.height < 16) return;
    hint.textContent = 'Membaca wajah…';
    try {
      const d = await cropDescriptor(canvas, bx * canvas.width, by * canvas.height, bw * canvas.width, bh * canvas.height);
      const nb = [r4(bx), r4(by), r4(bw), r4(bh)];
      faces = faces.filter(f => f.manual || overlap(f.b, nb) < 0.4); // the hand-drawn box replaces an auto box on the same face
      faces.push({ b: nb, d, pid: null, manual: true });
      drawMode = false; $('[data-f="draw"]', root).classList.remove('primary'); drawEl.hidden = true;
      paint();
      await assign(faces.length - 1);
    } catch (err) { console.warn(err); toast('Gagal membaca wajah di kotak itu', { type: 'error' }); paint(); }
  });
  function close() {
    window.removeEventListener('resize', fit); unBack(); root.remove();
    if (dirty) emit('change');
  }
}

// ------------------------------------------------------------ views
// rendered by views.js (people list & person detail)
export function peopleSummary() {
  const counts = {};
  S.photos.forEach(p => { if (!p.deleted) peopleIn(p).forEach(pr => { counts[pr.id] = (counts[pr.id] || 0) + 1; }); });
  return counts;
}
export const photosOf = pid => S.photos.filter(p => !p.deleted && !p.archived && p.faces?.some(f => f.pid === pid)).sort((a, b) => b.uploadedAt - a.uploadedAt);
