// =====================================================================
// core.js — Utils · DB wrapper (IndexedDB) · Log helper · URL cache ·
//           State · UI primitives (toast/modal/confirm/prompt/sheet) ·
//           Platform (save/share/sound/haptics)
// =====================================================================
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import { storage } from './lib/storage.js';
import { audio } from './lib/audio.js';
import { haptics } from './lib/haptics.js';
import { native } from './lib/native.js';

export const isNative = Capacitor.isNativePlatform();
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
// On iPhone the share sheet is the only way to put a picture into the Photos app.
export async function shareFilesWeb(files, title = '') {
  if (!navigator.canShare || !navigator.canShare({ files })) return false;
  try { await navigator.share({ files, title }); return true; }
  catch (e) { return e?.name === 'AbortError' ? 'cancel' : false; }
}

// ----------------------------- Utils ---------------------------------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export const icon = (name, cls = '') => `<svg class="ic ${cls}"><use href="#i-${name}"/></svg>`;
export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function fmtSize(b = 0) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const monthName = (m, short = false) => (short ? BLN : BULAN)[m];
export function fmtDate(ts) { const d = new Date(ts); return `${d.getDate()} ${BLN[d.getMonth()]} ${d.getFullYear()}`; }
export function fmtTime(ts) { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`; }
export const fmtDateTime = ts => `${fmtDate(ts)}, ${fmtTime(ts)}`;
export function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' hari lalu';
  return fmtDate(ts);
}
export function dayLabel(ts) {
  const d = new Date(ts); const t = new Date();
  const k = x => x.toDateString();
  if (k(d) === k(t)) return 'Hari ini';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (k(d) === k(y)) return 'Kemarin';
  return fmtDate(ts);
}
export async function sha256(input) {
  const buf = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [124, 92, 255];
}
export function mix(hex, toward, amt) {
  const a = hexToRgb(hex), b = hexToRgb(toward);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amt).toString(16).padStart(2, '0')).join('');
}
export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
export function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
export async function dataURLToBlob(url) { const r = await fetch(url); return r.blob(); }
export function extFor(type = '') { return ({ 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/avif': 'avif', 'image/bmp': 'bmp' })[type] || 'jpg'; }
export function withExt(name, type) { return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${extFor(type)}`; }
export function safeName(n) { return String(n).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'foto'; }

// ----------------------------- DB wrapper ----------------------------
const DB_NAME = 'kirana-gallery';
const STORES = ['photos', 'blobs', 'albums', 'members', 'logs', 'tombs'];
let _db = null;
export const db = {
  open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
      };
      req.onsuccess = () => { _db = req.result; res(_db); };
      req.onerror = () => rej(req.error);
    });
  },
  async tx(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const st = t.objectStore(store);
      let out;
      Promise.resolve(fn(st)).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Transaksi dibatalkan'));
    });
  },
  all(store) {
    return this.open().then(d => new Promise((res, rej) => {
      const r = d.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    }));
  },
  get(store, id) {
    return this.open().then(d => new Promise((res, rej) => {
      const r = d.transaction(store).objectStore(store).get(id);
      r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
    }));
  },
  put(store, obj) { return this.tx(store, 'readwrite', st => { st.put(obj); }); },
  putMany(store, arr) { return this.tx(store, 'readwrite', st => { arr.forEach(o => st.put(o)); }); },
  del(store, id) { return this.tx(store, 'readwrite', st => { st.delete(id); }); },
  delMany(store, ids) { return this.tx(store, 'readwrite', st => { ids.forEach(id => st.delete(id)); }); },
  clear(store) { return this.tx(store, 'readwrite', st => { st.clear(); }); }
};

// ----------------------------- State ---------------------------------
export const S = {
  photos: [], albums: [], members: [], logs: [],
  pending: new Map(), // photo records received from family whose image is still downloading
  tombs: new Map(),   // id -> deletedAt, so permanent deletes spread to other phones
  member: null,
  view: 'feed', param: null,
  selecting: false, selected: new Set(),
  filters: { q: '', sort: 'new', range: 'all', from: '', to: '', member: 'all', kind: 'all' },
  logFilter: 'all',
  settings: {}
};
const DEFAULTS = { theme: 'dark', accent: '#7c5cff', cols: 3, private: false, pin: '', lockOnResume: true, sound: true, haptics: true, memberId: '', familyCode: '', syncOn: true, syncIntro: false, feedMode: 'shuffle' };
export function loadSettings() { S.settings = { ...DEFAULTS, ...storage.get('settings', {}) }; }
export function setSetting(k, v) { S.settings[k] = v; storage.set('settings', S.settings); }

export const photoById = id => S.photos.find(p => p.id === id);
export const albumById = id => S.albums.find(a => a.id === id);
export const memberById = id => S.members.find(m => m.id === id);
export const live = () => S.photos.filter(p => !p.deleted);
export const visible = () => S.photos.filter(p => !p.deleted && !p.archived);

export async function loadAll() {
  const [photos, albums, members, logs, tombs] = await Promise.all(['photos', 'albums', 'members', 'logs', 'tombs'].map(s => db.all(s)));
  S.photos = photos.filter(p => !p.pending);
  S.pending = new Map(photos.filter(p => p.pending).map(p => [p.id, p]));
  S.albums = albums.sort((a, b) => b.createdAt - a.createdAt);
  S.members = members.sort((a, b) => a.createdAt - b.createdAt);
  S.logs = logs.sort((a, b) => b.ts - a.ts);
  S.tombs = new Map(tombs.map(t => [t.id, t.ts]));
}
// Sync hook: sync.js replaces this to broadcast local changes to family phones.
export const hooks = { local: () => {} };
const stamp = (list, o) => { if (!o.remote && !o.local) { const t = Date.now(); list.forEach(x => { x.updatedAt = t; }); } };
const share = (o, delta) => { if (!o.remote && !o.local) { try { hooks.local(delta); } catch (e) { console.warn('sync', e); } } };
// o.remote: change came from another phone (no re-broadcast); o.local: device-only change (e.g. viewedAt)
export async function savePhotos(list, o = {}) {
  list = Array.isArray(list) ? list : [list];
  stamp(list, o);
  await db.putMany('photos', list);
  list.forEach(p => { const i = S.photos.findIndex(x => x.id === p.id); if (i >= 0) S.photos[i] = p; else S.photos.push(p); S.pending.delete(p.id); });
  share(o, { photos: list });
}
async function addTombs(ids, o) {
  const ts = Date.now();
  const recs = ids.map(id => ({ id, ts }));
  recs.forEach(r => S.tombs.set(r.id, r.ts));
  await db.putMany('tombs', recs);
  share(o, { tombs: Object.fromEntries(recs.map(r => [r.id, r.ts])) });
}
export async function removePhotosForever(ids, o = {}) {
  await db.delMany('photos', ids);
  await db.delMany('blobs', ids);
  ids.forEach(revokeUrls);
  S.photos = S.photos.filter(p => !ids.includes(p.id));
  ids.forEach(id => S.pending.delete(id));
  S.albums.forEach(a => { if (ids.includes(a.coverId)) a.coverId = null; });
  if (!o.remote) await addTombs(ids, o);
}
// Permanently delete albums / members / logs (with tombstones for sync).
export async function deleteRecords(store, ids, o = {}) {
  if (!ids.length) return;
  await db.delMany(store, ids);
  const set = new Set(ids);
  S[store] = S[store].filter(x => !set.has(x.id));
  if (!o.remote) await addTombs(ids, o);
}
export async function saveAlbum(a, o = {}) { stamp([a], o); await db.put('albums', a); const i = S.albums.findIndex(x => x.id === a.id); if (i >= 0) S.albums[i] = a; else S.albums.unshift(a); share(o, { albums: [a] }); }
export async function saveMember(m, o = {}) { stamp([m], o); await db.put('members', m); const i = S.members.findIndex(x => x.id === m.id); if (i >= 0) S.members[i] = m; else S.members.push(m); share(o, { members: [m] }); }

// Simple event bus: views subscribe to "change" to re-render.
const listeners = {};
export const on = (ev, fn) => (listeners[ev] ||= []).push(fn);
export const emit = (ev, data) => (listeners[ev] || []).forEach(fn => fn(data));

// ----------------------------- Log helper ----------------------------
const LOG_ICON = { upload: 'upload', favorite: 'star', unfavorite: 'star', like: 'heart', unlike: 'heart', rename: 'edit', delete: 'trash', restore: 'restore', 'move-album': 'album', 'album-create': 'folder-plus', 'album-rename': 'edit', 'album-delete': 'trash', 'trash-empty': 'trash', 'backup-export': 'database', 'backup-import': 'database', pin: 'pin', unpin: 'pin', archive: 'archive', unarchive: 'archive', 'delete-forever': 'trash', 'edit-desc': 'tag', 'member-add': 'users', 'member-edit': 'user', 'member-delete': 'users', rotate: 'rotate' };
export const logIcon = a => LOG_ICON[a] || 'activity';
export async function addLog(action, text, extra = {}) {
  const m = S.member || {};
  const entry = { id: uid(), ts: Date.now(), action, text, memberId: m.id || '', memberName: m.name || 'Tamu', memberEmoji: m.emoji || '👤', ...extra };
  S.logs.unshift(entry);
  try {
    await db.put('logs', entry);
    share({}, { logs: [entry] });
    if (S.logs.length > 3000) { const old = S.logs.splice(3000); await db.delMany('logs', old.map(l => l.id)); }
  } catch (e) { console.warn('log', e); }
}

// ----------------------------- URL cache -----------------------------
const thumbCache = new Map(); // id -> objectURL
const fullCache = new Map();
const pending = new Map();
function lru(map, max) {
  while (map.size > max) { const [k, u] = map.entries().next().value; URL.revokeObjectURL(u); map.delete(k); }
}
export async function thumbUrl(id) {
  if (thumbCache.has(id)) { const u = thumbCache.get(id); thumbCache.delete(id); thumbCache.set(id, u); return u; }
  const key = 't' + id;
  if (pending.has(key)) return pending.get(key);
  const p = db.get('blobs', id).then(rec => {
    pending.delete(key);
    if (!rec) return '';
    const u = URL.createObjectURL(rec.thumb || rec.blob);
    thumbCache.set(id, u); lru(thumbCache, 700);
    return u;
  }).catch(() => { pending.delete(key); return ''; });
  pending.set(key, p);
  return p;
}
export async function fullUrl(id) {
  if (fullCache.has(id)) { const u = fullCache.get(id); fullCache.delete(id); fullCache.set(id, u); return u; }
  const rec = await db.get('blobs', id);
  if (!rec) return '';
  const u = URL.createObjectURL(rec.view || rec.blob); // view = browser-friendly copy for HEIC/TIFF/RAW
  fullCache.set(id, u); lru(fullCache, 14);
  return u;
}
export async function getBlob(id) { const rec = await db.get('blobs', id); return rec?.blob || null; }
export function revokeUrls(id) {
  [thumbCache, fullCache].forEach(m => { if (m.has(id)) { URL.revokeObjectURL(m.get(id)); m.delete(id); } });
}

// Lazy thumbnail loading for any <img data-thumb="id">
const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    const img = en.target; io.unobserve(img);
    loadThumbInto(img);
  });
}, { rootMargin: '400px 0px' }) : null;
async function loadThumbInto(img) {
  const u = await thumbUrl(img.dataset.thumb);
  if (!u) return;
  img.onload = () => img.classList.add('loaded');
  img.src = u;
}
export function hydrateThumbs(root) {
  $$('img[data-thumb]', root).forEach(img => { if (img.src) return; io ? io.observe(img) : loadThumbInto(img); });
}

// ----------------------------- Sound / haptics -----------------------
let audioReady = false;
export async function initAudio() {
  await audio.load({
    tap: 'audio/tap.wav', open: 'audio/open.wav', close: 'audio/close.wav', like: 'audio/like.wav', fav: 'audio/fav.wav',
    success: 'audio/success.wav', delete: 'audio/delete.wav', error: 'audio/error.wav', shutter: 'audio/shutter.wav',
    unlock: 'audio/unlock.wav', toggle: 'audio/toggle.wav', slideshow: 'audio/slideshow.ogg'
  });
  audioReady = true;
}
export function sfx(name, opts) {
  if (S.settings.sound && audioReady) audio.play(name, opts);
  if (!S.settings.haptics) return;
  if (name === 'like' || name === 'fav') haptics.light();
  else if (name === 'error') haptics.error();
  else if (name === 'success' || name === 'unlock') haptics.success();
  else if (name === 'delete') haptics.medium();
  else if (name === 'tap' || name === 'toggle') haptics.tap();
}
export { audio, haptics, native, storage };

// ----------------------------- Back-button stack ---------------------
// Each overlay registers a closer; Android back / Esc closes the top one.
// ----------------------------- UI: toasts ----------------------------
export function toast(msg, { type = 'info', action = null, duration = 2600 } = {}) {
  const box = $('#toasts');
  const ic = type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info';
  const t = el(`<div class="toast ${type}">${icon(ic, 'sm')}<span>${esc(msg)}</span></div>`);
  let done = false;
  const close = () => { if (done) return; done = true; t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  if (action) {
    const b = el(`<button class="act">${esc(action.label)}</button>`);
    b.onclick = () => { close(); action.fn(); };
    t.appendChild(b);
  }
  while (box.children.length > 2) box.firstElementChild.remove();
  box.appendChild(t);
  setTimeout(close, action ? Math.max(duration, 5000) : duration);
  return close;
}
native.toast = msg => toast(msg === 'Press back again to exit' ? 'Tekan kembali sekali lagi untuk keluar' : msg);

// ----------------------------- UI: modal -----------------------------
let openCount = 0;
export const overlayOpen = () => openCount > 0 || !!document.querySelector('.viewer, .slideshow, .lock-screen');
export function openModal({ title = '', body = '', actions = [], wide = false, cls = '', dismissable = true, sheet = false, onClose = null, noHead = false } = {}) {
  const root = $('#overlays');
  const bd = el(`<div class="backdrop ${sheet ? 'sheet-wrap' : ''}"></div>`);
  const box = sheet
    ? el(`<div class="sheet ${cls}"><div class="grab"></div>${title ? `<h3>${esc(title)}</h3>` : ''}<div class="sheet-body"></div></div>`)
    : el(`<div class="modal ${wide ? 'wide' : ''} ${cls}">${noHead ? '' : `<div class="modal-head"><h3>${esc(title)}</h3>${dismissable ? `<button class="icon-btn ghost" data-x>${icon('x')}</button>` : ''}</div>`}<div class="modal-body"></div>${actions.length ? '<div class="modal-foot"></div>' : ''}</div>`);
  const bodyEl = box.querySelector(sheet ? '.sheet-body' : '.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  bd.appendChild(box);
  root.appendChild(bd);
  openCount++;
  let closed = false;
  const unBack = native.onBack(() => { if (dismissable) api.close(); return true; });
  const api = {
    el: box, body: bodyEl, backdrop: bd,
    close(result) {
      if (closed) return; closed = true; openCount--; unBack();
      bd.classList.add('closing');
      setTimeout(() => bd.remove(), 190);
      onClose && onClose(result);
    }
  };
  if (dismissable) {
    bd.addEventListener('click', e => { if (e.target === bd) { sfx('close'); api.close(); } });
    box.querySelector('[data-x]')?.addEventListener('click', () => { sfx('close'); api.close(); });
  }
  const foot = box.querySelector('.modal-foot');
  actions.forEach(a => {
    const b = el(`<button class="btn ${a.cls || ''}">${a.icon ? icon(a.icon, 'sm') : ''}${esc(a.label)}</button>`);
    b.onclick = async () => { sfx('tap'); const r = a.fn ? await a.fn(api) : undefined; if (r !== false && a.close !== false) api.close(r); };
    foot.appendChild(b);
  });
  return api;
}
export function confirmDialog(message, { title = 'Konfirmasi', okLabel = 'Ya', cancelLabel = 'Batal', danger = false } = {}) {
  return new Promise(resolve => {
    let val = false;
    sfx('open');
    openModal({
      title, body: `<p class="msg">${esc(message)}</p>`,
      actions: [{ label: cancelLabel, fn: () => { val = false; } }, { label: okLabel, cls: danger ? 'danger' : 'primary', fn: () => { val = true; } }],
      onClose: () => resolve(val)
    });
  });
}
export function promptDialog(title, { value = '', placeholder = '', label = '', type = 'text', multiline = false, okLabel = 'Simpan', hint = '', maxLength = 200 } = {}) {
  return new Promise(resolve => {
    let val = null;
    const field = multiline
      ? `<textarea class="input" id="pd" placeholder="${esc(placeholder)}" maxlength="${maxLength}">${esc(value)}</textarea>`
      : `<input class="input" id="pd" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${maxLength}" autocomplete="off" />`;
    const m = openModal({
      title,
      body: `<div class="field">${label ? `<label for="pd">${esc(label)}</label>` : ''}${field}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`,
      actions: [{ label: 'Batal' }, { label: okLabel, cls: 'primary', fn: () => { val = $('#pd', m.el).value; } }],
      onClose: () => resolve(val)
    });
    const inp = $('#pd', m.el);
    setTimeout(() => { inp.focus(); if (inp.select && !multiline) inp.select(); }, 250);
    if (!multiline) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { val = inp.value; m.close(); } });
  });
}
// Bottom sheet with actions. items: [{icon,label,sub,fn,danger,tile,color}] ; mode 'grid' or 'list'
export function actionSheet(title, items, { grid = false } = {}) {
  sfx('open');
  const body = grid
    ? `<div class="sheet-grid">${items.map((it, i) => `<button class="tile ${it.color ? 't-' + it.color : ''}" data-i="${i}"><span class="ti">${icon(it.icon)}</span>${esc(it.label)}</button>`).join('')}</div>`
    : `<div class="sheet-list">${items.map((it, i) => `<button class="row ${it.danger ? 'danger' : ''}" data-i="${i}"><span class="ri ${it.danger ? 'red' : ''}">${icon(it.icon, 'sm')}</span><span class="rt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join('')}</div>`;
  const m = openModal({ title, body, sheet: true });
  $$('[data-i]', m.el).forEach(b => b.onclick = () => { sfx('tap'); m.close(); const it = items[+b.dataset.i]; setTimeout(() => it.fn && it.fn(), 120); });
  return m;
}

// ----------------------------- Platform: files -----------------------
let externalUntil = 0;
export const markExternal = (ms = 10 * 60 * 1000) => { externalUntil = Date.now() + ms; };
export const clearExternal = () => { externalUntil = 0; };
export const inExternal = () => Date.now() < externalUntil;

async function ensureFsPermission() {
  try {
    const p = await Filesystem.checkPermissions();
    if (p.publicStorage !== 'granted') await Filesystem.requestPermissions();
  } catch { /* Android 11+: not needed */ }
}
const FOLDER = 'Kirana Gallery';
// Save a blob to the phone (Documents/Kirana Gallery) or download in browser.
export async function saveBlob(blob, filename, { quiet = false } = {}) {
  filename = safeName(filename);
  if (!isNative) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return { ok: true, where: 'Unduhan' };
  }
  try {
    await ensureFsPermission();
    const data = await blobToBase64(blob);
    let path = `${FOLDER}/${filename}`;
    try { await Filesystem.stat({ path, directory: Directory.Documents }); path = `${FOLDER}/${Date.now().toString(36)}-${filename}`; } catch { /* not exists */ }
    await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
    return { ok: true, where: `Documents/${FOLDER}` };
  } catch (e) {
    console.warn('save failed, sharing instead', e);
    if (!quiet) await shareBlob(blob, filename);
    return { ok: false, shared: true };
  }
}
export async function shareBlob(blob, filename, text = '') {
  filename = safeName(filename);
  if (isNative) {
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: `share/${filename}`, data, directory: Directory.Cache, recursive: true });
    markExternal(5 * 60 * 1000);
    try { await Share.share({ title: filename, text: text || undefined, files: [res.uri], dialogTitle: 'Bagikan' }); }
    catch (e) { if (!/cancel/i.test(String(e?.message))) throw e; }
    return;
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename, text }); } catch { /* cancelled */ }
  } else {
    await saveBlob(blob, filename);
    toast('Berbagi tidak didukung — file diunduh');
  }
}
export async function copyText(text) {
  try { if (isNative) await Clipboard.write({ string: text }); else await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}
// Write a large file in chunks (used by backup on Android).
export async function writeChunks(filename, chunks, onProgress) {
  const path = `${FOLDER}/${safeName(filename)}`;
  await ensureFsPermission();
  let first = true, i = 0;
  for await (const chunk of chunks) {
    if (first) { await Filesystem.writeFile({ path, data: chunk, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true }); first = false; }
    else await Filesystem.appendFile({ path, data: chunk, directory: Directory.Documents, encoding: Encoding.UTF8 });
    onProgress && onProgress(++i);
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Documents });
  return { path: `Documents/${path}`, uri };
}
export async function shareUri(uri, title) {
  markExternal(5 * 60 * 1000);
  try { await Share.share({ title, files: [uri], dialogTitle: title }); } catch (e) { if (!/cancel/i.test(String(e?.message))) toast('Gagal membagikan', { type: 'error' }); }
}

// Pick files through a hidden <input type=file>.
export function pickFiles(inputId, { accept, multiple } = {}) {
  return new Promise(resolve => {
    const inp = document.getElementById(inputId);
    if (accept !== undefined) inp.accept = accept;
    if (multiple !== undefined) inp.multiple = multiple;
    inp.value = '';
    let settled = false;
    const finish = files => { if (settled) return; settled = true; clearExternal(); resolve(files); };
    inp.onchange = () => finish(Array.from(inp.files || []));
    inp.oncancel = () => finish([]);
    markExternal();
    inp.click();
  });
}

// ----------------------------- Images --------------------------------
export async function decodeImage(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  return new Promise((res, rej) => {
    const img = new Image(); const u = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(u); res(img); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Gambar tidak bisa dibaca')); };
    img.src = u;
  });
}
export function canvasToBlob(canvas, type = 'image/jpeg', q = 0.82) {
  return new Promise(res => canvas.toBlob(b => res(b), type, q));
}
export async function makeThumb(src, max = 500, q = 0.82) {
  const w0 = src.width, h0 = src.height;
  const s = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * s)); c.height = Math.max(1, Math.round(h0 * s));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', q);
}
// Returns the original blob, re-encoded with rotation applied when rot != 0.
export async function rotatedBlob(p) {
  const blob = await getBlob(p.id);
  if (!blob || !p.rot || isVideo(p)) return blob;
  try {
    const img = await decodeImage(blob);
    const r = ((p.rot % 360) + 360) % 360;
    const c = document.createElement('canvas');
    const swap = r === 90 || r === 270;
    c.width = swap ? img.height : img.width; c.height = swap ? img.width : img.height;
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2); g.rotate(r * Math.PI / 180);
    g.drawImage(img, -img.width / 2, -img.height / 2);
    return await canvasToBlob(c, 'image/jpeg', 0.92);
  } catch { return blob; }
}
export function downloadName(p, rotated) {
  if (isVideo(p)) return safeName(withExt(p.name, p.type).replace(/\.quicktime$/, '.mov'));
  const base = rotated && p.rot ? p.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg' : withExt(p.name, p.type);
  return safeName(base);
}

// ----------------------------- Video ---------------------------------
export const VIDEO_RE = /\.(mov|mp4|m4v|webm|3gp|mkv|avi)$/i;
export const isVideoFile = f => (f.type || '').startsWith('video/') || VIDEO_RE.test(f.name || '');
export const isVideo = p => !!p && ((p.type || '').startsWith('video/') || p.kind === 'video');
export function videoType(f) {
  if (f.type) return f.type;
  const ext = (f.name || '').split('.').pop().toLowerCase();
  return { mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', mkv: 'video/x-matroska', avi: 'video/x-msvideo' }[ext] || 'video/mp4';
}
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
async function placeholderThumb(w, h) {
  const r = w && h ? w / h : 16 / 9;
  const c = document.createElement('canvas');
  c.width = r >= 1 ? 500 : Math.round(500 * r); c.height = r >= 1 ? Math.round(500 / r) : 500;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, c.width, c.height);
  gr.addColorStop(0, '#3b2a8f'); gr.addColorStop(1, '#14121f');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  const cx = c.width / 2, cy = c.height / 2, R = Math.min(c.width, c.height) * 0.16;
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5b3fe0'; g.beginPath(); g.moveTo(cx - R * 0.3, cy - R * 0.45); g.lineTo(cx + R * 0.5, cy); g.lineTo(cx - R * 0.3, cy + R * 0.45); g.closePath(); g.fill();
  return canvasToBlob(c, 'image/jpeg', 0.85);
}
// Reads a video's size/duration and grabs a frame as JPEG thumbnail (max 500px).
export function videoInfo(blob, max = 500) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(blob);
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    let done = false;
    const finish = async ok => {
      if (done) return; done = true; clearTimeout(timer);
      const w = v.videoWidth || 0, h = v.videoHeight || 0;
      const duration = isFinite(v.duration) ? v.duration : 0;
      let thumb = null;
      if (ok && w && h) {
        try {
          const s = Math.min(1, max / Math.max(w, h));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          thumb = await canvasToBlob(c, 'image/jpeg', 0.82);
        } catch { thumb = null; }
      }
      if (!thumb) thumb = await placeholderThumb(w, h);
      try { v.pause(); } catch { /* ignore */ }
      v.removeAttribute('src'); try { v.load(); } catch { /* ignore */ }
      v.remove(); URL.revokeObjectURL(url);
      resolve({ thumb, w, h, duration });
    };
    const timer = setTimeout(() => finish(v.readyState >= 2), 9000);
    v.onloadedmetadata = () => {
      const t = Math.min(1, (v.duration || 0) / 3) || 0.1;
      try { v.currentTime = t; } catch { finish(true); }
    };
    v.onloadeddata = () => { // iOS sometimes needs a play() before frames can be drawn
      const p = v.play(); if (p && p.then) p.then(() => v.pause()).catch(() => {});
    };
    v.onseeked = () => setTimeout(() => finish(true), 150);
    v.onerror = () => finish(false);
    v.src = url;
  });
}
// Fast fingerprint for big files: size + first & last 2 MB.
export async function quickHash(file) {
  const MB2 = 2 * 1024 * 1024;
  if (file.size <= MB2 * 2) return sha256(await file.arrayBuffer());
  const a = new Uint8Array(await file.slice(0, MB2).arrayBuffer());
  const b = new Uint8Array(await file.slice(file.size - MB2).arrayBuffer());
  const sz = new TextEncoder().encode(String(file.size));
  const all = new Uint8Array(a.length + b.length + sz.length);
  all.set(a); all.set(b, a.length); all.set(sz, a.length + b.length);
  return sha256(all);
}

// ----------------------------- Members helpers -----------------------
export function avatarHTML(m, cls = '') {
  if (!m) return `<span class="avatar ${cls}" style="--c:#444">👤</span>`;
  return `<span class="avatar ${cls}" style="--c:${esc(m.color || '#7c5cff')}">${m.avatar ? `<img src="${m.avatar}" alt="">` : esc(m.emoji || '🙂')}</span>`;
}
export const hashPass = (m, pass) => sha256(`kfg:${m.id}:${pass}`);
