// =====================================================================
// actions.js — photo operations shared by Feed, Gallery, Viewer, Selection
// =====================================================================
import {
  S, $, $$, esc, icon, uid, isNative, isIOS, shareFilesWeb, openModal, confirmDialog, promptDialog, toast, sfx, savePhotos, saveAlbum, removePhotosForever, deleteRecords,
  addLog, emit, photoById, albumById, saveBlob, shareBlob, copyText, rotatedBlob, downloadName, hydrateThumbs, getBlob, db, sleep
} from './core.js';

const nm = p => `“${p.name}”`;
const cnt = n => `${n} foto`;

export async function toggleLike(p) {
  const me = S.member?.id || 'guest';
  p.likedBy = Array.isArray(p.likedBy) ? p.likedBy : [];
  const liked = p.likedBy.includes(me);
  p.likedBy = liked ? p.likedBy.filter(x => x !== me) : [...p.likedBy, me];
  p.likes = p.likedBy.length;
  await savePhotos(p);
  sfx(liked ? 'tap' : 'like');
  addLog(liked ? 'unlike' : 'like', liked ? `batal menyukai ${nm(p)}` : `menyukai ${nm(p)}`, { photoId: p.id });
  return !liked;
}
export const isLiked = p => (p.likedBy || []).includes(S.member?.id || 'guest');

export async function toggleFav(p) {
  p.fav = !p.fav;
  await savePhotos(p);
  sfx(p.fav ? 'fav' : 'tap');
  addLog(p.fav ? 'favorite' : 'unfavorite', p.fav ? `memfavoritkan ${nm(p)}` : `menghapus ${nm(p)} dari favorit`, { photoId: p.id });
  return p.fav;
}

export async function rename(p) {
  const v = await promptDialog('Ganti nama foto', { value: p.name, label: 'Nama baru', maxLength: 120 });
  if (v == null) return false;
  const name = v.trim();
  if (!name || name === p.name) return false;
  const old = p.name; p.name = name;
  await savePhotos(p);
  addLog('rename', `mengganti nama “${old}” menjadi “${name}”`, { photoId: p.id });
  sfx('success'); toast('Nama diganti', { type: 'success' });
  emit('change');
  return true;
}

export function editDescTags(p) {
  return new Promise(resolve => {
    let ok = false;
    sfx('open');
    const md = openModal({
      title: 'Deskripsi & Tag',
      body: `<div class="field"><label for="dsc">Deskripsi</label><textarea class="input" id="dsc" maxlength="1000" placeholder="Ceritakan momen ini…">${esc(p.desc || '')}</textarea></div>
        <div class="field"><label for="tgs">Tag</label><input class="input" id="tgs" value="${esc((p.tags || []).join(', '))}" placeholder="liburan, ulang tahun, pantai" />
        <div class="hint">Pisahkan dengan koma. Tag bisa dicari di Galeri.</div></div>`,
      actions: [{ label: 'Batal' }, {
        label: 'Simpan', cls: 'primary', fn: async () => {
          p.desc = $('#dsc', md.el).value.trim();
          p.tags = [...new Set($('#tgs', md.el).value.split(',').map(t => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 20);
          await savePhotos(p);
          addLog('edit-desc', `mengubah deskripsi/tag ${nm(p)}`, { photoId: p.id });
          ok = true; sfx('success'); toast('Disimpan', { type: 'success' }); emit('change');
        }
      }],
      onClose: () => resolve(ok)
    });
  });
}

export async function rotate(p) {
  p.rot = ((p.rot || 0) + 90) % 360;
  await savePhotos(p);
  sfx('tap');
  emit('change');
}

// --- delete / restore -------------------------------------------------
export async function softDelete(ids, { undo = true } = {}) {
  const list = ids.map(photoById).filter(Boolean);
  if (!list.length) return;
  const now = Date.now();
  list.forEach(p => { p.deleted = true; p.deletedAt = now; });
  await savePhotos(list);
  addLog('delete', list.length === 1 ? `menghapus ${nm(list[0])}` : `menghapus ${cnt(list.length)}`);
  sfx('delete');
  emit('change');
  if (undo) toast(list.length === 1 ? 'Dipindah ke Sampah' : `${cnt(list.length)} dipindah ke Sampah`, {
    action: { label: 'Urungkan', fn: () => restore(list.map(p => p.id), { silent: true }).then(() => toast('Dibatalkan', { type: 'success' })) }
  });
}
export async function restore(ids, { silent = false } = {}) {
  const list = ids.map(photoById).filter(Boolean);
  list.forEach(p => { p.deleted = false; p.deletedAt = null; });
  await savePhotos(list);
  addLog('restore', list.length === 1 ? `memulihkan ${nm(list[0])}` : `memulihkan ${cnt(list.length)}`);
  if (!silent) { sfx('success'); toast(list.length === 1 ? 'Foto dipulihkan' : `${cnt(list.length)} dipulihkan`, { type: 'success' }); }
  emit('change');
}
export async function deleteForever(ids) {
  if (!ids.length) return false;
  if (!(await confirmDialog(`Hapus permanen ${cnt(ids.length)}? Tindakan ini tidak bisa dibatalkan.`, { title: 'Hapus permanen', okLabel: 'Hapus', danger: true }))) return false;
  await removePhotosForever(ids);
  addLog('delete-forever', `menghapus permanen ${cnt(ids.length)}`);
  sfx('delete'); toast('Dihapus permanen');
  emit('change');
  return true;
}
export async function emptyTrash() {
  const ids = S.photos.filter(p => p.deleted).map(p => p.id);
  if (!ids.length) { toast('Sampah sudah kosong'); return; }
  if (!(await confirmDialog(`Kosongkan Sampah? ${cnt(ids.length)} akan dihapus permanen.`, { title: 'Kosongkan Sampah', okLabel: 'Kosongkan', danger: true }))) return;
  await removePhotosForever(ids);
  addLog('trash-empty', `mengosongkan sampah (${cnt(ids.length)})`);
  sfx('delete'); toast('Sampah dikosongkan');
  emit('change');
}

// --- flags --------------------------------------------------------------
export async function setFlag(ids, flag, value) {
  const list = ids.map(photoById).filter(Boolean);
  list.forEach(p => { p[flag] = value; });
  await savePhotos(list);
  const label = { fav: value ? ['favorite', 'memfavoritkan'] : ['unfavorite', 'menghapus favorit'], pinned: value ? ['pin', 'menyematkan'] : ['unpin', 'melepas sematan'], archived: value ? ['archive', 'mengarsipkan'] : ['unarchive', 'mengeluarkan dari arsip'] }[flag];
  addLog(label[0], `${label[1]} ${list.length === 1 ? nm(list[0]) : cnt(list.length)}`);
  sfx(flag === 'fav' && value ? 'fav' : 'success');
  const msg = {
    fav: value ? 'Ditambahkan ke Favorit' : 'Dihapus dari Favorit',
    pinned: value ? 'Disematkan' : 'Sematan dilepas',
    archived: value ? 'Diarsipkan' : 'Dikeluarkan dari Arsip'
  }[flag];
  toast(list.length > 1 ? `${msg} (${list.length})` : msg, { type: 'success' });
  emit('change');
}

// --- albums -------------------------------------------------------------
export async function createAlbum(name) {
  if (name == null) name = await promptDialog('Album baru', { placeholder: 'mis. Liburan Bali 2026', label: 'Nama album', okLabel: 'Buat', maxLength: 60 });
  if (name == null || !name.trim()) return null;
  const a = { id: uid(), name: name.trim(), coverId: null, createdAt: Date.now() };
  await saveAlbum(a);
  addLog('album-create', `membuat album “${a.name}”`);
  sfx('success'); toast('Album dibuat', { type: 'success' });
  emit('change');
  return a;
}
export async function renameAlbum(a) {
  const v = await promptDialog('Ganti nama album', { value: a.name, label: 'Nama album', maxLength: 60 });
  if (v == null || !v.trim() || v.trim() === a.name) return;
  const old = a.name; a.name = v.trim();
  await saveAlbum(a);
  addLog('album-rename', `mengganti nama album “${old}” menjadi “${a.name}”`);
  sfx('success'); toast('Album diganti nama', { type: 'success' }); emit('change');
}
export async function deleteAlbum(a) {
  const n = S.photos.filter(p => p.albumId === a.id).length;
  if (!(await confirmDialog(`Hapus album “${a.name}”? ${n ? `${cnt(n)} di dalamnya tetap ada di Galeri.` : ''}`, { title: 'Hapus album', okLabel: 'Hapus', danger: true }))) return false;
  const list = S.photos.filter(p => p.albumId === a.id);
  list.forEach(p => { p.albumId = null; });
  if (list.length) await savePhotos(list);
  await deleteRecords('albums', [a.id]);
  addLog('album-delete', `menghapus album “${a.name}”`);
  sfx('delete'); toast('Album dihapus'); emit('change');
  return true;
}
export async function moveToAlbum(ids, albumId) {
  const list = ids.map(photoById).filter(Boolean);
  list.forEach(p => { p.albumId = albumId; });
  await savePhotos(list);
  const a = albumById(albumId);
  addLog('move-album', a ? `memindahkan ${list.length === 1 ? nm(list[0]) : cnt(list.length)} ke album “${a.name}”` : `mengeluarkan ${cnt(list.length)} dari album`);
  sfx('success'); toast(a ? `Dipindah ke “${a.name}”` : 'Dikeluarkan dari album', { type: 'success' });
  emit('change');
}
// Sheet: choose album (or create new) for ids.
export function chooseAlbum(ids) {
  return new Promise(resolve => {
    sfx('open');
    const cur = ids.length === 1 ? photoById(ids[0])?.albumId : undefined;
    const md = openModal({
      sheet: true, title: 'Pindah ke album',
      body: `<div class="sheet-list">
        <button class="row" data-new><span class="ri">${icon('folder-plus', 'sm')}</span><span class="rt"><b>Buat album baru</b></span></button>
        ${S.albums.map(a => `<button class="row" data-a="${a.id}"><span class="ri">${icon('album', 'sm')}</span><span class="rt"><b>${esc(a.name)}</b><small>${S.photos.filter(p => p.albumId === a.id && !p.deleted).length} foto</small></span>${cur === a.id ? `<span class="rv">${icon('check', 'sm')}</span>` : ''}</button>`).join('')}
        ${ids.some(id => photoById(id)?.albumId) ? `<button class="row danger" data-none><span class="ri red">${icon('x', 'sm')}</span><span class="rt"><b>Keluarkan dari album</b></span></button>` : ''}
      </div>`,
      onClose: () => resolve()
    });
    $$('[data-a]', md.el).forEach(b => b.onclick = async () => { md.close(); await moveToAlbum(ids, b.dataset.a); });
    $('[data-new]', md.el).onclick = async () => { md.close(); const a = await createAlbum(); if (a) await moveToAlbum(ids, a.id); };
    const none = $('[data-none]', md.el); if (none) none.onclick = async () => { md.close(); await moveToAlbum(ids, null); };
  });
}
export async function setCover(p) {
  const a = albumById(p.albumId);
  if (!a) { toast('Foto ini belum ada di album'); return; }
  a.coverId = p.id; await saveAlbum(a);
  sfx('success'); toast(`Jadi cover “${a.name}”`, { type: 'success' }); emit('change');
}

// --- download / share / copy / export ---------------------------------
export async function downloadPhotos(ids) {
  const list = ids.map(photoById).filter(Boolean);
  if (!list.length) return;
  if (!isNative && isIOS) {
    // iPhone/iPad: open the share sheet so the user can tap "Simpan Gambar" (Save to Photos).
    const files = [];
    for (const p of list) { const b = await rotatedBlob(p); if (b) files.push(new File([b], downloadName(p, true), { type: b.type || 'image/jpeg' })); }
    const r = await shareFilesWeb(files, 'Kirana Gallery');
    if (r === true) { sfx('success'); return; }
    if (r === 'cancel') return;
  }
  const close = list.length > 1 ? toast(`Menyimpan ${cnt(list.length)}…`, { duration: 60000 }) : null;
  let where = '', okCount = 0;
  for (const p of list) {
    const blob = await rotatedBlob(p);
    if (!blob) continue;
    const r = await saveBlob(blob, downloadName(p, true), { quiet: list.length > 1 });
    if (r.ok) { okCount++; where = r.where; }
    if (list.length > 1) await sleep(60);
  }
  close && close();
  if (okCount) { sfx('success'); toast(okCount === 1 ? `Tersimpan di ${where}` : `${okCount} foto tersimpan di ${where}`, { type: 'success', duration: 3500 }); }
}
export async function sharePhoto(p) {
  const blob = await rotatedBlob(p);
  if (!blob) return;
  try { await shareBlob(blob, downloadName(p, true), p.desc || p.name); } catch { toast('Gagal membagikan', { type: 'error' }); }
}
export async function copyPhoto(p) {
  // Try copying the image itself; WebViews often refuse, so fall back to text.
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      const blob = await rotatedBlob(p);
      const png = await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      sfx('success'); toast('Gambar disalin', { type: 'success' }); return;
    }
  } catch { /* fall back */ }
  const txt = `${p.name}${p.desc ? '\n' + p.desc : ''}${p.tags?.length ? '\n#' + p.tags.join(' #') : ''}\n— ${p.memberEmoji || ''} ${p.memberName || ''}`;
  if (await copyText(txt)) { sfx('success'); toast('Info foto disalin', { type: 'success' }); }
  else toast('Gagal menyalin', { type: 'error' });
}
async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
export function photoMeta(p) {
  const a = albumById(p.albumId);
  return {
    id: p.id, name: p.name, desc: p.desc || '', tags: p.tags || [], size: p.size, type: p.type, width: p.w, height: p.h,
    uploaded_at: new Date(p.uploadedAt).toISOString(), taken_at: p.takenAt ? new Date(p.takenAt).toISOString() : null,
    album_id: p.albumId || null, album_name: a?.name || null, fav: !!p.fav, likes: p.likes || 0,
    liked_by: (p.likedBy || []).map(id => S.members.find(m => m.id === id)?.name || id),
    pinned: !!p.pinned, archived: !!p.archived, deleted: !!p.deleted, rot: p.rot || 0,
    member_id: p.memberId, member_name: p.memberName, member_emoji: p.memberEmoji,
    viewed_at: p.viewedAt ? new Date(p.viewedAt).toISOString() : null, sha256: p.hash || null
  };
}
export async function exportMeta(p) {
  const blob = new Blob([JSON.stringify(photoMeta(p), null, 2)], { type: 'application/json' });
  const r = await saveBlob(blob, p.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.json');
  if (r.ok) { sfx('success'); toast(`Metadata tersimpan di ${r.where}`, { type: 'success' }); }
}

export async function markViewed(p) {
  p.viewedAt = Date.now();
  await savePhotos(p, { local: true });
}

// --- picker modal: choose photos from a list ---------------------------
export function pickPhotos(title, list, { okLabel = 'Pilih', single = false } = {}) {
  return new Promise(resolve => {
    const sel = new Set(); let result = null;
    sfx('open');
    const md = openModal({
      title, wide: true,
      body: list.length ? `<div class="pick-grid">${list.map(p => `<button class="pick-cell" data-id="${p.id}"><img data-thumb="${p.id}" alt=""></button>`).join('')}</div>` : '<p class="msg">Tidak ada foto yang bisa dipilih.</p>',
      actions: single ? [{ label: 'Batal' }] : [{ label: 'Batal' }, { label: okLabel, cls: 'primary', fn: () => { result = [...sel]; } }],
      onClose: () => resolve(result)
    });
    hydrateThumbs(md.el);
    $$('[data-id]', md.el).forEach(b => b.onclick = () => {
      sfx('tap');
      if (single) { result = [b.dataset.id]; md.close(); return; }
      const id = b.dataset.id;
      sel.has(id) ? sel.delete(id) : sel.add(id);
      b.classList.toggle('sel', sel.has(id));
    });
  });
}

// --- duplicates -------------------------------------------------------
export async function scanDuplicates() {
  const close = toast('Memindai duplikat…', { duration: 60000 });
  const list = S.photos.filter(p => !p.deleted);
  const { sha256 } = await import('./core.js');
  for (const p of list) {
    if (p.hash) continue;
    const b = await getBlob(p.id);
    if (b) { p.hash = await sha256(await b.arrayBuffer()); await savePhotos(p, { local: true }); }
  }
  close();
  const groups = {};
  list.forEach(p => { if (p.hash) (groups[p.hash] ||= []).push(p); });
  const dups = Object.values(groups).filter(g => g.length > 1).map(g => g.sort((a, b) => a.uploadedAt - b.uploadedAt));
  if (!dups.length) { sfx('success'); toast('Tidak ada foto duplikat 🎉', { type: 'success' }); return; }
  const extra = dups.flatMap(g => g.slice(1).map(p => p.id));
  sfx('open');
  const md = openModal({
    title: `${dups.length} grup duplikat`, wide: true,
    body: `<p class="msg" style="margin-bottom:12px">Foto pertama di tiap grup akan disimpan, sisanya (${extra.length}) dipindah ke Sampah.</p>
      ${dups.map(g => `<div class="dup-group"><div class="pick-grid">${g.map((p, i) => `<div class="pick-cell ${i === 0 ? 'keep' : ''}"><img data-thumb="${p.id}" alt=""></div>`).join('')}</div></div>`).join('')}`,
    actions: [{ label: 'Tutup' }, { label: `Hapus ${extra.length} duplikat`, cls: 'danger', fn: () => softDelete(extra) }]
  });
  hydrateThumbs(md.el);
}
