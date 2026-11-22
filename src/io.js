// =====================================================================
// io.js — Upload handler · Backup export/import (.kfg)
// =====================================================================
import {
  S, $, esc, icon, uid, openModal, toast, sfx, db, savePhotos, saveAlbum, saveMember, addLog, emit, pickFiles,
  decodeImage, makeThumb, sha256, isNative, blobToDataURL, dataURLToBlob, saveBlob, writeChunks, shareUri, fmtSize,
  albumById, getBlob, sleep
} from './core.js';

// ----------------------------- Upload --------------------------------
export async function startUpload({ albumId = null } = {}) {
  const files = (await pickFiles('fileInput', { accept: 'image/*', multiple: true })).filter(f => !f.type || f.type.startsWith('image/'));
  if (!files.length) return;
  await uploadFiles(files, { albumId });
}

export async function uploadFiles(files, { albumId = null } = {}) {
  const md = openModal({
    title: 'Mengunggah foto', dismissable: false,
    body: `<div class="up-meta"><span id="upCount">0 / ${files.length}</span><span id="upPct">0%</span></div>
      <div class="up-progress"><i id="upBar"></i></div>
      <div class="up-file" id="upFile">Menyiapkan…</div>
      <div class="up-thumbs" id="upThumbs"></div>`
  });
  try { navigator.storage?.persist?.(); } catch { /* ignore */ }
  const bar = $('#upBar', md.el), cnt = $('#upCount', md.el), pct = $('#upPct', md.el), fl = $('#upFile', md.el), th = $('#upThumbs', md.el);
  const known = new Set(S.photos.filter(p => !p.deleted && p.hash).map(p => p.hash));
  let ok = 0, failed = 0, dup = 0;
  const added = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    fl.textContent = f.name || `Foto ${i + 1}`;
    const setP = frac => { const v = Math.round(((i + frac) / files.length) * 100); bar.style.width = v + '%'; pct.textContent = v + '%'; };
    setP(0.05);
    try {
      const img = await decodeImage(f);
      setP(0.35);
      const thumb = await makeThumb(img, 500, 0.82);
      const w = img.width, h = img.height;
      if (img.close) img.close();
      setP(0.6);
      const hash = await sha256(await f.arrayBuffer());
      if (known.has(hash)) dup++;
      known.add(hash);
      setP(0.8);
      const id = uid();
      const m = S.member || {};
      const p = {
        id, name: f.name || `Foto ${new Date().toISOString().slice(0, 10)}.jpg`, desc: '', tags: [], size: f.size, type: f.type || 'image/jpeg',
        uploadedAt: Date.now(), takenAt: f.lastModified || Date.now(), albumId, fav: false, likes: 0, likedBy: [], pinned: false,
        archived: false, deleted: false, deletedAt: null, rot: 0, memberId: m.id || '', memberName: m.name || 'Tamu', memberEmoji: m.emoji || '👤',
        viewedAt: null, w, h, hash
      };
      await db.put('blobs', { id, blob: f, thumb });
      await savePhotos(p);
      added.push(p);
      ok++;
      const u = URL.createObjectURL(thumb);
      if (th.children.length < 12) th.insertAdjacentHTML('beforeend', `<img src="${u}" alt="">`);
      sfx('shutter', { volume: 0.6 });
    } catch (e) {
      console.warn('upload failed', f.name, e);
      failed++;
    }
    cnt.textContent = `${i + 1} / ${files.length}`;
    setP(1);
  }
  fl.textContent = 'Selesai!';
  await sleep(350);
  md.close();
  if (ok) {
    const a = albumById(albumId);
    await addLog('upload', `mengunggah ${ok} foto${a ? ` ke album “${a.name}”` : ''}`);
    sfx('success');
    toast(`${ok} foto berhasil diunggah${dup ? ` · ${dup} mungkin duplikat` : ''}`, { type: 'success', duration: 3200 });
  }
  if (failed) toast(`${failed} file gagal dibaca (format tidak didukung)`, { type: 'error', duration: 3800 });
  emit('change');
  return added;
}

// ----------------------------- Backup --------------------------------
const MAGIC = 'kirana-family-gallery';

async function* backupChunks(onPhoto) {
  const head = { app: MAGIC, version: 1, exportedAt: new Date().toISOString(), members: S.members, albums: S.albums, logs: S.logs };
  yield JSON.stringify(head).slice(0, -1) + ',"photos":[';
  for (let i = 0; i < S.photos.length; i++) {
    const p = S.photos[i];
    const rec = await db.get('blobs', p.id);
    const data = rec?.blob ? await blobToDataURL(rec.blob) : null;
    const thumb = rec?.thumb ? await blobToDataURL(rec.thumb) : null;
    yield (i ? ',' : '') + JSON.stringify({ ...p, data, thumb });
    onPhoto && onPhoto(i + 1);
  }
  yield ']}';
}

function progressModal(title, total) {
  const md = openModal({
    title, dismissable: false,
    body: `<div class="up-meta"><span id="bpC">0 / ${total}</span><span id="bpP">0%</span></div><div class="up-progress"><i id="bpB"></i></div><div class="up-file" id="bpF">Menyiapkan…</div>`
  });
  return {
    md,
    set(n, label) {
      const v = total ? Math.round(n / total * 100) : 100;
      $('#bpB', md.el).style.width = v + '%'; $('#bpP', md.el).textContent = v + '%';
      $('#bpC', md.el).textContent = `${n} / ${total}`;
      if (label) $('#bpF', md.el).textContent = label;
    }
  };
}

export async function exportBackup({ share = false } = {}) {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
  const filename = `kirana-backup-${stamp}.kfg`;
  const pm = progressModal('Membuat cadangan', S.photos.length);
  try {
    let result;
    if (isNative) {
      result = await writeChunks(filename, backupChunks(n => pm.set(n, `Foto ${n} dari ${S.photos.length}`)));
    } else {
      const parts = [];
      for await (const c of backupChunks(n => pm.set(n, `Foto ${n} dari ${S.photos.length}`))) parts.push(c);
      await saveBlob(new Blob(parts, { type: 'application/json' }), filename);
      result = { path: 'Unduhan/' + filename };
    }
    pm.md.close();
    await addLog('backup-export', `membuat cadangan (${S.photos.length} foto)`);
    sfx('success');
    if (share && result.uri) { await shareUri(result.uri, 'Kirim cadangan Kirana Gallery'); return; }
    openModal({
      title: 'Cadangan selesai ✅',
      body: `<p class="msg">File cadangan tersimpan di:</p><p style="font-weight:800;margin:8px 0 12px;word-break:break-all">${esc(result.path)}</p>
        <p class="hint">Buka file ini dari menu <b>Impor cadangan</b> di HP lain untuk menyalin semua foto, album, anggota & log.</p>`,
      actions: result.uri ? [{ label: 'Tutup' }, { label: 'Bagikan', icon: 'share', cls: 'primary', fn: () => shareUri(result.uri, 'Kirim cadangan Kirana Gallery') }] : [{ label: 'OK', cls: 'primary' }]
    });
  } catch (e) {
    console.error(e);
    pm.md.close();
    sfx('error');
    toast('Gagal membuat cadangan: ' + (e?.message || e), { type: 'error', duration: 4500 });
  }
}

export async function importBackup() {
  const [file] = await pickFiles('importInput', { accept: '', multiple: false });
  if (!file) return;
  let data;
  const loading = toast('Membaca file cadangan…', { duration: 120000 });
  try { data = JSON.parse(await file.text()); }
  catch { loading(); sfx('error'); toast('File bukan cadangan Kirana yang valid', { type: 'error' }); return; }
  loading();
  if (!data || data.app !== MAGIC || !Array.isArray(data.photos)) { sfx('error'); toast('File bukan cadangan Kirana yang valid', { type: 'error' }); return; }
  const pm = progressModal('Mengimpor cadangan', data.photos.length);
  let addedP = 0, addedA = 0, addedM = 0, addedL = 0;
  try {
    for (const m of data.members || []) if (m?.id && !S.members.some(x => x.id === m.id)) { await saveMember(m); addedM++; }
    for (const a of data.albums || []) if (a?.id && !S.albums.some(x => x.id === a.id)) { await saveAlbum(a); addedA++; }
    const logIds = new Set(S.logs.map(l => l.id));
    const newLogs = (data.logs || []).filter(l => l?.id && !logIds.has(l.id));
    if (newLogs.length) { await db.putMany('logs', newLogs); S.logs.push(...newLogs); S.logs.sort((a, b) => b.ts - a.ts); addedL = newLogs.length; }
    for (let i = 0; i < data.photos.length; i++) {
      const raw = data.photos[i];
      pm.set(i + 1, raw?.name || '');
      if (!raw?.id || !raw.data) continue;
      const existing = S.photos.find(p => p.id === raw.id);
      if (existing) {
        // merge likes so families combining backups keep everyone's likes
        const lb = [...new Set([...(existing.likedBy || []), ...(raw.likedBy || [])])];
        if (lb.length !== (existing.likedBy || []).length) { existing.likedBy = lb; existing.likes = lb.length; await savePhotos(existing); }
        continue;
      }
      const blob = await dataURLToBlob(raw.data);
      const thumb = raw.thumb ? await dataURLToBlob(raw.thumb) : blob;
      const { data: _d, thumb: _t, ...meta } = raw;
      await db.put('blobs', { id: meta.id, blob, thumb });
      await savePhotos(meta);
      addedP++;
      raw.data = null; raw.thumb = null;
    }
    pm.md.close();
    await addLog('backup-import', `mengimpor cadangan (${addedP} foto baru)`);
    sfx('success');
    openModal({
      title: 'Impor selesai ✅',
      body: `<p class="msg">${addedP} foto, ${addedA} album, ${addedM} anggota dan ${addedL} log baru ditambahkan. Data yang sudah ada dilewati.</p>`,
      actions: [{ label: 'OK', cls: 'primary' }]
    });
    emit('change'); emit('member');
  } catch (e) {
    console.error(e);
    pm.md.close(); sfx('error');
    toast('Impor gagal: ' + (e?.message || e), { type: 'error', duration: 4500 });
    emit('change');
  }
}

export async function storageInfo() {
  let used = S.photos.reduce((s, p) => s + (p.size || 0), 0), quota = 0;
  try { const est = await navigator.storage.estimate(); used = est.usage || used; quota = est.quota || 0; } catch { /* ignore */ }
  return { used, quota, text: quota ? `${fmtSize(used)} dari ${fmtSize(quota)}` : fmtSize(used) };
}
export { getBlob };
