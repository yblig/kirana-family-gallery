// =====================================================================
// viewer.js — Photo viewer (swipe, pinch/double-tap zoom, rotate, keys)
//             and Slideshow (crossfade + Ken Burns + music)
// =====================================================================
import {
  S, $, $$, el, esc, icon, toast, sfx, on, emit, openModal, actionSheet, thumbUrl, fullUrl, photoById, albumById, memberById,
  fmtSize, fmtDateTime, native, audio, clamp
} from './core.js';
import * as A from './actions.js';

let V = null; // current viewer state

export function openViewer(ids, index = 0, { mode = 'normal' } = {}) {
  ids = ids.filter(id => photoById(id));
  if (!ids.length) return;
  if (V) closeViewer(true);
  sfx('open');
  const root = el(`<div class="viewer">
    <div class="v-stage"><div class="v-track"><img class="v-img" alt=""></div></div>
    <div class="v-bar v-top">
      <button class="v-btn" data-v="close" aria-label="Tutup">${icon('left')}</button>
      <div class="tt"><b></b><small></small></div>
      <button class="v-btn" data-v="info" aria-label="Info">${icon('info')}</button>
      <button class="v-btn" data-v="more" aria-label="Lainnya">${icon('more-v')}</button>
    </div>
    <button class="v-nav prev" data-v="prev">${icon('left')}</button>
    <button class="v-nav next" data-v="next">${icon('right')}</button>
    <div class="v-bar v-bottom"></div>
  </div>`);
  document.body.appendChild(root);
  V = { root, ids, i: clamp(index, 0, ids.length - 1), mode, s: 1, tx: 0, ty: 0, dx: 0, dy: 0, dirty: false, token: 0 };
  V.img = $('.v-img', root);
  V.unBack = native.onBack(() => { closeViewer(); return true; });
  V.onKey = onKey;
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', onClick);
  bindGestures($('.v-stage', root));
  show();
}

export function closeViewer(instant = false) {
  if (!V) return;
  const v = V; V = null;
  v.unBack(); document.removeEventListener('keydown', v.onKey, true);
  if (instant) v.root.remove();
  else { sfx('close'); v.root.classList.add('closing'); setTimeout(() => v.root.remove(), 180); }
  if (v.dirty) emit('change');
}

const cur = () => V && photoById(V.ids[V.i]);

async function show() {
  const p = cur(); if (!p) { closeViewer(); return; }
  V.s = 1; V.tx = V.ty = V.dx = V.dy = 0;
  const token = ++V.token;
  const r = p.rot || 0;
  V.img.className = 'v-img' + (r === 90 || r === 270 ? ' r' + r : '');
  applyTransform(false);
  V.img.style.opacity = '0';
  const t = await thumbUrl(p.id);
  if (!V || token !== V.token) return;
  V.img.src = t; V.img.style.opacity = '1';
  paintBars();
  const f = await fullUrl(p.id);
  if (!V || token !== V.token) return;
  if (f) { const pre = new Image(); pre.onload = () => { if (V && token === V.token) V.img.src = f; }; pre.src = f; }
  [V.i + 1, V.i - 1].forEach(j => { const id = V.ids[j]; if (id) fullUrl(id); });
  A.markViewed(p);
}

function paintBars() {
  const p = cur(); if (!p) return;
  $('.tt b', V.root).textContent = p.name;
  $('.tt small', V.root).textContent = `${V.i + 1} / ${V.ids.length} · ${p.memberEmoji || ''} ${p.memberName || ''} · ${fmtDateTime(p.uploadedAt)}`;
  const bottom = $('.v-bottom', V.root);
  if (V.mode === 'trash') {
    bottom.innerHTML = `
      <button class="v-btn" data-v="restore" aria-label="Pulihkan">${icon('restore')}</button>
      <button class="v-btn" data-v="info">${icon('info')}</button>
      <button class="v-btn" data-v="forever" aria-label="Hapus permanen" style="color:#ff5470">${icon('trash')}</button>`;
  } else {
    bottom.innerHTML = `
      <button class="v-btn ${A.isLiked(p) ? 'liked' : ''}" data-v="like" aria-label="Suka">${icon('heart')}<span class="cnt">${p.likes || ''}</span></button>
      <button class="v-btn ${p.fav ? 'faved' : ''}" data-v="fav" aria-label="Favorit">${icon('star')}</button>
      <button class="v-btn" data-v="share" aria-label="Bagikan">${icon('share')}</button>
      <button class="v-btn" data-v="dl" aria-label="Unduh">${icon('download')}</button>
      <button class="v-btn" data-v="rotate" aria-label="Putar">${icon('rotate')}</button>
      <button class="v-btn" data-v="delete" aria-label="Hapus">${icon('trash')}</button>`;
  }
  $('.v-nav.prev', V.root).style.visibility = V.i > 0 ? '' : 'hidden';
  $('.v-nav.next', V.root).style.visibility = V.i < V.ids.length - 1 ? '' : 'hidden';
}

function step(d) {
  const n = V.i + d;
  if (n < 0 || n >= V.ids.length) { bounce(d); return; }
  V.i = n; sfx('tap'); show();
}
function bounce(d) {
  V.dx = -d * 40; applyTransform(true);
  setTimeout(() => { if (V) { V.dx = 0; applyTransform(true); } }, 160);
}
function dropCurrent(id) {
  if (!V) return;
  const k = V.ids.indexOf(id);
  if (k >= 0) { V.ids.splice(k, 1); if (k < V.i) V.i--; }
  V.dirty = true;
  if (!V.ids.length) { closeViewer(); return; }
  if (V.i >= V.ids.length) V.i = V.ids.length - 1;
  show();
}

function applyTransform(anim) {
  const p = cur(); const r = p?.rot || 0;
  V.img.style.transition = anim ? 'transform .25s cubic-bezier(.2,.9,.3,1), opacity .2s' : 'opacity .2s';
  V.img.style.transform = `translate(-50%, -50%) translate(${V.tx + V.dx}px, ${V.ty + V.dy}px) scale(${V.s}) rotate(${r}deg)`;
  const fade = V.s === 1 ? 1 - Math.min(0.6, Math.abs(V.dy) / 500) : 1;
  V.root.style.background = `rgba(0,0,0,${fade})`;
}
function clampPan() {
  const st = $('.v-stage', V.root);
  const mx = st.clientWidth * (V.s - 1) / 2, my = st.clientHeight * (V.s - 1) / 2;
  V.tx = clamp(V.tx, -mx, mx); V.ty = clamp(V.ty, -my, my);
}
function zoomAt(x, y, s) {
  const st = $('.v-stage', V.root).getBoundingClientRect();
  const px = x - st.left - st.width / 2, py = y - st.top - st.height / 2;
  const k = s / V.s;
  V.tx = px - (px - V.tx) * k; V.ty = py - (py - V.ty) * k; V.s = s;
  if (V.s <= 1) { V.s = 1; V.tx = V.ty = 0; }
  clampPan();
}

function bindGestures(stage) {
  const pts = new Map();
  let start = null, pinch = null, lastTap = 0, tapTimer = null;
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, t: Date.now(), tx: V.tx, ty: V.ty, moved: false, axis: null };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: V.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; V.dx = V.dy = 0; }
  });
  stage.addEventListener('pointermove', e => {
    if (!V || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(pinch.cx, pinch.cy, clamp(pinch.s * d / pinch.d, 1, 5));
      start && (start.moved = true);
      applyTransform(false); return;
    }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 8) start.moved = true;
    if (V.s > 1) { V.tx = start.tx + dx; V.ty = start.ty + dy; clampPan(); }
    else {
      if (!start.axis && Math.hypot(dx, dy) > 10) start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (start.axis === 'x') V.dx = dx;
      else if (start.axis === 'y') V.dy = Math.max(0, dy);
    }
    applyTransform(false);
  });
  const end = e => {
    if (!V) return;
    pts.delete(e.pointerId);
    if (pts.size === 1) { pinch = null; const [a] = [...pts.values()]; start = { x: a.x, y: a.y, t: Date.now(), tx: V.tx, ty: V.ty, moved: true, axis: null }; return; }
    if (pts.size > 0) return;
    pinch = null;
    if (!start) return;
    const st = start; start = null;
    if (V.s <= 1.02) {
      if (V.dx < -70) { V.dx = 0; step(1); return; }
      if (V.dx > 70) { V.dx = 0; step(-1); return; }
      if (V.dy > 120) { closeViewer(); return; }
      V.s = 1; V.tx = V.ty = 0;
    }
    V.dx = V.dy = 0;
    applyTransform(true);
    if (!st.moved && Date.now() - st.t < 300) {
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapTimer); lastTap = 0;
        zoomAt(e.clientX, e.clientY, V.s > 1 ? 1 : 2.5); applyTransform(true); sfx('tap');
      } else {
        lastTap = now;
        tapTimer = setTimeout(() => { if (V) V.root.classList.toggle('ui-hidden'); }, 300);
      }
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, clamp(V.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 5));
    applyTransform(false);
  }, { passive: false });
}

function onKey(e) {
  if (!V) return;
  if (document.querySelector('.backdrop, .lock-screen')) return; // dialogs handle their own keys
  const k = e.key;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (k === 'ArrowRight') { handled(); step(1); }
  else if (k === 'ArrowLeft') { handled(); step(-1); }
  else if (k === 'Escape') { handled(); closeViewer(); }
  else if (k === '+' || k === '=') { handled(); V.s = clamp(V.s * 1.3, 1, 5); clampPan(); applyTransform(true); }
  else if (k === '-') { handled(); V.s = clamp(V.s / 1.3, 1, 5); if (V.s === 1) V.tx = V.ty = 0; clampPan(); applyTransform(true); }
  else if (k.toLowerCase() === 'r' && V.mode !== 'trash') { handled(); act('rotate'); }
  else if (k === 'Delete' && V.mode !== 'trash') { handled(); act('delete'); }
  else if (k.toLowerCase() === 'i') { handled(); act('info'); }
  else if (/^[a-z/,]$/i.test(k)) { handled(); } // swallow app shortcuts while viewing
}

function onClick(e) {
  const b = e.target.closest('[data-v]'); if (!b) return;
  act(b.dataset.v);
}

async function act(a) {
  const p = cur(); if (!p) return;
  switch (a) {
    case 'close': closeViewer(); break;
    case 'prev': step(-1); break;
    case 'next': step(1); break;
    case 'like': await A.toggleLike(p); V.dirty = true; paintBars(); break;
    case 'fav': { const f = await A.toggleFav(p); V.dirty = true; paintBars(); toast(f ? 'Ditambahkan ke Favorit' : 'Dihapus dari Favorit'); break; }
    case 'share': A.sharePhoto(p); break;
    case 'dl': A.downloadPhotos([p.id]); break;
    case 'rotate': { await A.rotate(p); V.dirty = true; const r = p.rot; V.img.className = 'v-img' + (r === 90 || r === 270 ? ' r' + r : ''); V.s = 1; V.tx = V.ty = 0; applyTransform(true); break; }
    case 'delete': await A.softDelete([p.id]); dropCurrent(p.id); break;
    case 'restore': await A.restore([p.id]); dropCurrent(p.id); break;
    case 'forever': if (await A.deleteForever([p.id])) dropCurrent(p.id); break;
    case 'info': showInfo(p); break;
    case 'more': moreMenu(p); break;
  }
}

function moreMenu(p) {
  const a = albumById(p.albumId);
  const items = [
    { icon: 'edit', label: 'Ganti nama', fn: async () => { if (await A.rename(p)) { V.dirty = true; paintBars(); } } },
    { icon: 'tag', label: 'Deskripsi & tag', fn: async () => { if (await A.editDescTags(p)) V.dirty = true; } },
    { icon: 'album', label: a ? `Pindah album (sekarang: ${a.name})` : 'Masukkan ke album', fn: async () => { await A.chooseAlbum([p.id]); V.dirty = true; } }
  ];
  if (a) items.push({ icon: 'image', label: 'Jadikan cover album', fn: () => A.setCover(p) });
  items.push(
    { icon: 'pin', label: p.pinned ? 'Lepas sematan' : 'Sematkan', fn: async () => { await A.setFlag([p.id], 'pinned', !p.pinned); V.dirty = true; } },
    { icon: 'archive', label: p.archived ? 'Keluarkan dari arsip' : 'Arsipkan', fn: async () => { await A.setFlag([p.id], 'archived', !p.archived); if (V.mode !== 'archive' && p.archived) dropCurrent(p.id); else if (V.mode === 'archive' && !p.archived) dropCurrent(p.id); } },
    { icon: 'copy', label: 'Salin', fn: () => A.copyPhoto(p) },
    { icon: 'json', label: 'Ekspor metadata (.json)', fn: () => A.exportMeta(p) },
    { icon: 'play', label: 'Slideshow dari sini', fn: () => { const ids = V.ids.slice(), i = V.i; closeViewer(true); openSlideshow(ids, { start: i }); } },
    { icon: 'trash', label: 'Hapus', danger: true, fn: async () => { await A.softDelete([p.id]); dropCurrent(p.id); } }
  );
  actionSheet(p.name, items);
}

function showInfo(p) {
  const a = albumById(p.albumId);
  const m = memberById(p.memberId);
  const likers = (p.likedBy || []).map(id => memberById(id)).filter(Boolean);
  sfx('open');
  const md = openModal({
    sheet: true, title: 'Detail foto',
    body: `<dl class="info-meta" style="padding:0 8px">
        <dt>Nama</dt><dd>${esc(p.name)}</dd>
        <dt>Diunggah</dt><dd>${esc(m?.emoji || p.memberEmoji || '')} ${esc(m?.name || p.memberName || '-')} · ${fmtDateTime(p.uploadedAt)}</dd>
        ${p.takenAt ? `<dt>Tanggal file</dt><dd>${fmtDateTime(p.takenAt)}</dd>` : ''}
        <dt>Ukuran</dt><dd>${fmtSize(p.size)}${p.w ? ` · ${p.w}×${p.h}px` : ''}</dd>
        <dt>Tipe</dt><dd>${esc(p.type || '-')}</dd>
        <dt>Album</dt><dd>${a ? esc(a.name) : '—'}</dd>
        <dt>Disukai</dt><dd>${likers.length ? likers.map(x => `${esc(x.emoji)} ${esc(x.name)}`).join(', ') : '—'}</dd>
        ${p.viewedAt ? `<dt>Dilihat</dt><dd>${fmtDateTime(p.viewedAt)}</dd>` : ''}
        <dt>Status</dt><dd>${[p.fav && '⭐ Favorit', p.pinned && '📌 Disematkan', p.archived && '🗄️ Diarsipkan', p.deleted && '🗑️ Di sampah'].filter(Boolean).join(' · ') || 'Normal'}</dd>
      </dl>
      <div style="padding:0 8px 6px"><div class="hint" style="margin-bottom:4px">Deskripsi</div><p style="margin-bottom:12px;white-space:pre-wrap;-webkit-user-select:text;user-select:text">${p.desc ? esc(p.desc) : '<span class="hint">Belum ada deskripsi</span>'}</p>
      ${p.tags?.length ? `<div class="tag-chips" style="margin-bottom:14px">${p.tags.map(t => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
      ${p.deleted ? '' : `<button class="btn block primary" data-ed>${icon('tag', 'sm')} Edit deskripsi & tag</button>`}</div>`
  });
  const ed = $('[data-ed]', md.el);
  if (ed) ed.onclick = async () => { md.close(); if (await A.editDescTags(p)) { V && (V.dirty = true); } };
}

// keep the open viewer in sync with changes made elsewhere (e.g. dialogs)
on('change', () => { if (V) { V.dirty = true; V.ids = V.ids.filter(id => photoById(id)); if (!V.ids.length) closeViewer(true); else { V.i = Math.min(V.i, V.ids.length - 1); paintBars(); } } });

// =====================================================================
// Slideshow
// =====================================================================
let SS = null;
const SPEEDS = [3, 5, 8];
export function openSlideshow(ids, { shuffle = false, start = 0 } = {}) {
  ids = ids.filter(id => photoById(id));
  if (!ids.length) { toast('Tidak ada foto untuk slideshow'); return; }
  if (shuffle) { ids = ids.slice(); for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; } start = 0; }
  sfx('open');
  const root = el(`<div class="slideshow">
    <div class="ss-layer"><div class="bg"></div><img alt=""></div><div class="ss-layer"><div class="bg"></div><img alt=""></div>
    <div class="ss-progress"><i></i></div>
    <div class="ss-ui">
      <div class="ss-top"><button class="v-btn" data-s="close">${icon('x')}</button><b>Slideshow</b>
        <button class="v-btn" data-s="speed" aria-label="Kecepatan"><span style="font-weight:900;font-size:14px" class="spd"></span></button>
        <button class="v-btn" data-s="shuffle" aria-label="Acak">${icon('shuffle')}</button>
        <button class="v-btn" data-s="music" aria-label="Musik">${icon('music')}</button></div>
      <div class="ss-cap"></div>
      <div class="ss-bottom"><button class="v-btn" data-s="prev">${icon('left')}</button><button class="play" data-s="play">${icon('pause')}</button><button class="v-btn" data-s="next">${icon('right')}</button></div>
    </div></div>`);
  document.body.appendChild(root);
  SS = { root, ids, i: clamp(start, 0, ids.length - 1), layer: 0, playing: true, speed: S.settings.ssSpeed || 5, music: S.settings.ssMusic !== false, timer: null, hideT: null };
  SS.unBack = native.onBack(() => { closeSlideshow(); return true; });
  SS.onKey = e => {
    if (!SS) return;
    const h = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Escape') { h(); closeSlideshow(); }
    else if (e.key === 'ArrowRight') { h(); ssStep(1); }
    else if (e.key === 'ArrowLeft') { h(); ssStep(-1); }
    else if (e.key === ' ') { h(); ssToggle(); }
    else if (/^[a-z/,]$/i.test(e.key)) h();
  };
  document.addEventListener('keydown', SS.onKey, true);
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-s]');
    if (!b) { root.classList.toggle('ui-hidden'); if (!root.classList.contains('ui-hidden')) autoHide(); return; }
    sfx('tap'); autoHide();
    const a = b.dataset.s;
    if (a === 'close') closeSlideshow();
    else if (a === 'next') ssStep(1);
    else if (a === 'prev') ssStep(-1);
    else if (a === 'play') ssToggle();
    else if (a === 'speed') { SS.speed = SPEEDS[(SPEEDS.indexOf(SS.speed) + 1) % SPEEDS.length]; S.settings.ssSpeed = SS.speed; paintSS(); schedule(); toast(`Ganti foto tiap ${SS.speed} detik`); }
    else if (a === 'shuffle') { const curId = SS.ids[SS.i]; const rest = SS.ids.filter(x => x !== curId); for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; } SS.ids = [curId, ...rest]; SS.i = 0; toast('Urutan diacak'); }
    else if (a === 'music') { SS.music = !SS.music; S.settings.ssMusic = SS.music; syncMusic(); paintSS(); toast(SS.music ? 'Musik nyala' : 'Musik mati'); }
  });
  let sx = 0;
  root.addEventListener('pointerdown', e => { sx = e.clientX; });
  root.addEventListener('pointerup', e => { const d = e.clientX - sx; if (Math.abs(d) > 60 && !e.target.closest('[data-s]')) ssStep(d < 0 ? 1 : -1); });
  syncMusic();
  paintSS();
  showSlide();
  autoHide();
}
function syncMusic() {
  if (!SS) { audio.stopMusic(0.6); return; }
  if (SS.music && S.settings.sound) audio.playMusic('slideshow', { fade: 1.2, volume: 0.8 }); else audio.stopMusic(0.6);
}
function paintSS() {
  $('.spd', SS.root).textContent = SS.speed + 'd';
  $('[data-s="play"]', SS.root).innerHTML = icon(SS.playing ? 'pause' : 'play');
  $('[data-s="music"]', SS.root).style.opacity = SS.music ? '1' : '.45';
}
function autoHide() { clearTimeout(SS.hideT); SS.hideT = setTimeout(() => SS && SS.playing && SS.root.classList.add('ui-hidden'), 3000); }
async function showSlide() {
  if (!SS) return;
  const p = photoById(SS.ids[SS.i]); if (!p) { ssStep(1); return; }
  const layers = $$('.ss-layer', SS.root);
  const nextL = layers[1 - SS.layer], prevL = layers[SS.layer];
  const r = p.rot || 0;
  nextL.className = 'ss-layer kb' + (r === 90 || r === 270 ? ' r' + r : '');
  nextL.style.setProperty('--rot', r + 'deg');
  nextL.style.setProperty('--dur', (SS.speed + 1.5) + 's');
  const url = await fullUrl(p.id) || await thumbUrl(p.id);
  const t = await thumbUrl(p.id);
  if (!SS) return;
  const img = $('img', nextL);
  await new Promise(res => { img.onload = img.onerror = res; img.src = url; });
  if (!SS) return;
  $('.bg', nextL).style.backgroundImage = `url("${t}")`;
  nextL.classList.add('show'); prevL.classList.remove('show');
  SS.layer = 1 - SS.layer;
  $('.ss-cap', SS.root).innerHTML = `${esc(p.desc || p.name)}<small>${esc(p.memberEmoji || '')} ${esc(p.memberName || '')} · ${SS.i + 1}/${SS.ids.length}</small>`;
  A.markViewed(p);
  const nx = SS.ids[(SS.i + 1) % SS.ids.length]; if (nx) fullUrl(nx);
  schedule();
}
function schedule() {
  if (!SS) return;
  clearTimeout(SS.timer);
  const bar = $('.ss-progress i', SS.root);
  bar.style.transition = 'none'; bar.style.width = '0';
  if (!SS.playing) return;
  void bar.offsetWidth;
  bar.style.transition = `width ${SS.speed}s linear`; bar.style.width = '100%';
  SS.timer = setTimeout(() => ssStep(1, true), SS.speed * 1000);
}
function ssStep(d, auto = false) {
  if (!SS) return;
  SS.i = (SS.i + d + SS.ids.length) % SS.ids.length;
  if (!auto) sfx('tap');
  showSlide();
}
function ssToggle() {
  SS.playing = !SS.playing; paintSS(); schedule();
  if (SS.playing) autoHide(); else SS.root.classList.remove('ui-hidden');
  audio.duckMusic(!SS.playing);
}
export function closeSlideshow() {
  if (!SS) return;
  const s = SS; SS = null;
  clearTimeout(s.timer); clearTimeout(s.hideT);
  s.unBack(); document.removeEventListener('keydown', s.onKey, true);
  audio.stopMusic(0.6); audio.duckMusic(false);
  sfx('close');
  s.root.style.transition = 'opacity .2s'; s.root.style.opacity = '0';
  setTimeout(() => s.root.remove(), 200);
}
export const viewerOpen = () => !!V || !!SS;
