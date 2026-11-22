// =====================================================================
// views.js — Nav · Feed · Gallery · Albums · Favorites · Memories ·
//            Archive · Trash · Selection · Stats · Log · Settings
// =====================================================================
import {
  S, $, $$, el, esc, icon, toast, sfx, emit, on, openModal, confirmDialog, promptDialog, copyText, actionSheet, hydrateThumbs, thumbUrl, fullUrl,
  photoById, albumById, memberById, visible, avatarHTML, fmtSize, fmtDate, fmtDateTime, fmtTime, relTime, dayLabel, monthName,
  setSetting, db, addLog, logIcon, deleteRecords, isVideo, fmtDur, native, mix, hexToRgb, isNative, isIOS, isStandalone, storage, audio, savePhotos
} from './core.js';
import * as A from './actions.js';
import { startUpload, uploadMenu, exportBackup, importBackup, storageInfo } from './io.js';
import { openViewer, openSlideshow, viewerOpen } from './viewer.js';
import { showMemberPicker, editMember, deleteMember, lockApp, setupPin, verifyPin } from './members.js';
import { sync, syncSummary, familyLink, setFamilyCode, startSync, stopSync, validCode, normCode, newCode, resyncNow, relayInfo } from './sync.js';

const NAV = [
  { id: 'feed', label: 'Feed', icon: 'feed', key: 'F' },
  { id: 'gallery', label: 'Galeri', icon: 'grid', key: 'G' },
  { id: 'albums', label: 'Album', icon: 'album', key: 'A' },
  { id: 'favorites', label: 'Favorit', icon: 'heart', key: 'V' },
  { id: 'memories', label: 'Kenangan', icon: 'sparkles', key: 'M' },
  { id: 'archive', label: 'Arsip', icon: 'archive', key: 'R' },
  { id: 'trash', label: 'Sampah', icon: 'trash', key: 'T' },
  { id: 'log', label: 'Log Aktivitas', icon: 'activity', key: 'L' },
  { id: 'stats', label: 'Statistik', icon: 'chart', key: 'S' },
  { id: 'settings', label: 'Pengaturan', icon: 'settings', key: ',' }
];
const MOBILE_NAV = ['feed', 'gallery', 'albums', 'favorites'];
const TITLES = Object.fromEntries(NAV.map(n => [n.id, n.label]));

let currentList = []; // ids shown in the current grid (viewer context)

// ----------------------------- Nav -----------------------------------
export function go(view, param = null, { push = true } = {}) {
  if (S.view === view && S.param === param) return;
  if (push && !(S.view === view)) navStack.push([S.view, S.param]);
  if (navStack.length > 20) navStack.shift();
  S.view = view; S.param = param;
  exitSelection(false);
  render({ resetScroll: true });
}
const navStack = [];
export function goBack() {
  if (S.selecting) { exitSelection(); return true; }
  if (S.view === 'album') { go('albums', null, { push: false }); return true; }
  if (S.view !== 'feed') { go('feed', null, { push: false }); return true; }
  return false;
}

function counts() {
  const v = visible();
  return {
    gallery: v.length, favorites: v.filter(p => p.fav).length, albums: S.albums.length,
    archive: S.photos.filter(p => p.archived && !p.deleted).length, trash: S.photos.filter(p => p.deleted).length
  };
}

function renderSidebar() {
  const c = counts();
  const active = S.view === 'album' ? 'albums' : S.view;
  $('#sidebar').innerHTML = `
    <div class="brand"><span class="brand-mark">${icon('image')}</span><div>KIRANA<small>FAMILY GALLERY</small></div></div>
    <button class="btn primary block" data-upload style="margin-bottom:12px">${icon('upload', 'sm')} Unggah Foto/Video</button>
    ${NAV.map((n, i) => `${i === 4 || i === 7 ? '<div class="side-sep"></div>' : ''}<button class="side-item ${active === n.id ? 'active' : ''}" data-go="${n.id}">${icon(n.icon)}<span>${n.label}</span>${c[n.id] != null ? `<span class="count">${c[n.id]}</span>` : ''}</button>`).join('')}
    <div class="side-sep"></div>
    <button class="side-item" data-sync>${icon('users')}<span>Sinkron Keluarga</span></button>
    <button class="side-item" data-upfiles>${icon('upload')}<span>Unggah dari File</span></button>
    <button class="side-item" data-surprise>${icon('gift')}<span>Kejutan!</span></button>
    <button class="side-item" data-lock>${icon('lock')}<span>Kunci Aplikasi</span></button>
    <div class="side-foot"><button class="member-chip" data-member style="width:100%;max-width:none">${avatarHTML(S.member, 'sm')}<span>${esc(S.member?.name || 'Pilih profil')}</span></button></div>`;
}

function renderBottomNav() {
  const active = S.view === 'album' ? 'albums' : S.view;
  const nav = $('#bottomNav');
  nav.classList.toggle('on-feed', S.view === 'feed');
  nav.innerHTML = MOBILE_NAV.map(id => { const n = NAV.find(x => x.id === id); return `<button class="nav-btn ${active === id ? 'active' : ''}" data-go="${id}">${icon(n.icon, active === id && id === 'favorites' ? 'fill' : '')}<span>${n.label}</span></button>`; }).join('')
    + `<button class="nav-btn ${!MOBILE_NAV.includes(active) ? 'active' : ''}" data-more>${icon('apps')}<span>Lainnya</span></button>`;
}

export function syncPill(dark = false) {
  const st = sync.status;
  const busy = sync.receiving || sync.queued;
  const cls = st === 'connected' ? 'on' : st === 'searching' ? 'wait' : 'off';
  return `<button class="sync-pill ${cls} ${busy ? 'busy' : ''} ${dark ? 'dark' : ''}" data-sync aria-label="Sinkron keluarga">${icon(busy ? 'download' : 'users', 'sm')}<span>${st === 'connected' ? sync.peers : st === 'searching' ? '…' : '!'}</span></button>`;
}
function refreshPills() {
  $$('[data-sync]').forEach(b => { if (b.closest('.modal, .sheet')) return; const dark = b.classList.contains('dark'); b.outerHTML = syncPill(dark); });
  const st = document.getElementById('syncStatus'); if (st) st.textContent = syncSummary();
}
on('sync', refreshPills);

function relayText() {
  const r = relayInfo();
  return r.total ? `Server perantara: ${r.open}/${r.total} tersambung` : 'Server perantara: menyambung…';
}
export function openFamilySync() {
  sfx('open');
  const code = S.settings.familyCode;
  const md = openModal({
    title: 'Sinkron Keluarga',
    body: `<p class="msg" style="margin-bottom:12px">Semua HP dengan <b>kode keluarga yang sama</b> otomatis saling kirim foto, album, profil anggota & log — langsung antar HP, tanpa server & gratis.</p>
      <div class="code-box"><small>Kode keluarga HP ini</small><b>${esc(code || '—')}</b></div>
      <div class="sync-status"><span class="dot ${sync.status}"></span><span id="syncStatus">${esc(syncSummary())}</span></div>
      <div class="hint" id="relayStatus" style="margin:4px 0 0 18px">${esc(relayText())}</div>
      <div class="stack" style="gap:8px;margin-top:12px">
        <button class="btn primary block" data-sx="now">${icon('rotate', 'sm')} Sinkron sekarang</button>
        <button class="btn block" data-sx="share">${icon('send', 'sm')} Kirim link ke keluarga</button>
        <button class="btn block" data-sx="copy">${icon('copy', 'sm')} Salin kode</button>
        <button class="btn block" data-sx="join">${icon('users', 'sm')} Masukkan kode dari HP lain</button>
        <button class="btn block ghost" data-sx="toggle">${S.settings.syncOn ? 'Matikan sinkron di HP ini' : 'Nyalakan sinkron'}</button>
      </div>
      <div class="card" style="margin-top:12px;box-shadow:none;background:var(--surface-2)">
        <b style="display:block;margin-bottom:6px">Belum tersambung? Cek ini:</b>
        <div class="hint" style="line-height:1.55">1. <b>Kode harus sama persis</b> di semua HP. Kalau beda, ketuk “Masukkan kode dari HP lain” di salah satu HP.<br>
        2. Buka aplikasi ini di <b>kedua HP pada waktu yang sama</b>, tunggu ±30 detik sampai titik jadi hijau.<br>
        3. Paling lancar di <b>Wi-Fi yang sama</b>. Di iPhone, buka dari ikon di Layar Utama (bukan dari WhatsApp).</div>
      </div>`
  });
  const tick = setInterval(() => { const r = $('#relayStatus', md.el); if (!r || !document.body.contains(r)) { clearInterval(tick); return; } r.textContent = relayText(); const d = $('.sync-status .dot', md.el); if (d) d.className = 'dot ' + sync.status; }, 1500);
  $$('[data-sx]', md.el).forEach(b => b.onclick = async () => {
    sfx('tap');
    const a = b.dataset.sx;
    if (a === 'now') {
      if (resyncNow()) toast('Menyinkronkan dengan HP keluarga…', { type: 'success' });
      else { await startSync(); toast('Menyambung ulang… pastikan HP keluarga juga sedang membuka aplikasi'); }
    } else if (a === 'share') {
      const text = `Yuk gabung galeri foto keluarga Kirana! Buka link ini di Safari/Chrome, lalu "Add to Home Screen":\n${familyLink()}\n(Kode keluarga: ${S.settings.familyCode})`;
      if (navigator.share) { try { await navigator.share({ title: 'Kirana Family Gallery', text }); } catch { /* cancelled */ } }
      else if (await copyText(text)) toast('Link disalin — tempel di WhatsApp keluarga', { type: 'success' });
    } else if (a === 'copy') {
      if (await copyText(S.settings.familyCode)) toast('Kode disalin', { type: 'success' });
    } else if (a === 'join') {
      md.close();
      await askJoinCode();
    } else if (a === 'toggle') {
      setSetting('syncOn', !S.settings.syncOn);
      if (S.settings.syncOn) startSync(); else stopSync();
      md.close(); render();
    }
  });
}
export async function askJoinCode() {
  const v = await promptDialog('Gabung keluarga', { label: 'Kode keluarga dari HP lain', placeholder: 'ABCD-1234', okLabel: 'Gabung', maxLength: 12, hint: 'Lihat kodenya di HP keluarga: Lainnya → Sinkron.' });
  if (v == null) return false;
  if (!validCode(v)) { sfx('error'); toast('Kode tidak valid. Contoh: ABCD-1234', { type: 'error' }); return false; }
  await setFamilyCode(normCode(v));
  sfx('success'); toast('Tergabung! Buka aplikasi di HP keluarga juga supaya tersambung.', { type: 'success', duration: 4000 }); render();
  return true;
}

function topbarHTML(title, extra = '') {
  return `<div class="title">${title}</div>${extra}${syncPill()}
    <button class="icon-btn accent hide-desk" data-upload aria-label="Unggah">${icon('upload')}</button>
    <button class="member-chip hide-desk" data-member style="padding-right:4px">${avatarHTML(S.member, 'sm')}</button>`;
}

export function openMore() {
  actionSheet('Lainnya', [
    { icon: 'sparkles', label: 'Kenangan', color: 'pink', fn: () => go('memories') },
    { icon: 'archive', label: 'Arsip', color: 'blue', fn: () => go('archive') },
    { icon: 'trash', label: 'Sampah', color: 'red', fn: () => go('trash') },
    { icon: 'activity', label: 'Log', color: 'green', fn: () => go('log') },
    { icon: 'chart', label: 'Statistik', color: 'yellow', fn: () => go('stats') },
    { icon: 'settings', label: 'Pengaturan', fn: () => go('settings') },
    { icon: 'users', label: 'Sinkron', color: 'green', fn: openFamilySync },
    { icon: 'upload', label: 'Unggah dari File', color: 'yellow', fn: () => startUpload({ fromFiles: true }) },
    { icon: 'gift', label: 'Kejutan!', color: 'pink', fn: surprise },
    { icon: 'lock', label: 'Kunci Aplikasi', color: 'blue', fn: lockNow }
  ], { grid: true });
}
export async function lockNow() {
  if (!S.settings.pin) {
    const ok = await confirmDialog('Kamu belum membuat PIN. Buat PIN 4 digit sekarang?', { title: 'Kunci Aplikasi', okLabel: 'Buat PIN' });
    if (ok) await setupPin();
    render();
    return;
  }
  lockApp();
}
export function surprise() {
  const v = visible();
  if (!v.length) { toast('Belum ada foto untuk kejutan 😅'); return; }
  const p = v[Math.floor(Math.random() * v.length)];
  sfx('fav');
  toast('✨ Kejutan! Foto acak untukmu');
  openViewer([p.id], 0);
}
export function memberMenu() {
  actionSheet(S.member ? `${S.member.emoji || ''} ${S.member.name}` : 'Profil', [
    { icon: 'switch', label: 'Ganti pengguna', sub: 'Pilih profil lain', fn: () => showMemberPicker() },
    { icon: 'edit', label: 'Edit profil', sub: 'Nama, emoji, warna, foto, password', fn: async () => { if (S.member && await editMember(S.member)) render(); } },
    { icon: 'users', label: 'Kelola anggota keluarga', fn: () => go('settings') }
  ]);
}

// ----------------------------- Render dispatcher ---------------------
let lastViewKey = '';
export function render({ resetScroll = false } = {}) {
  const main = $('#main');
  const key = S.view + ':' + (S.param || '');
  const keepScroll = !resetScroll && key === lastViewKey ? main.scrollTop : 0;
  lastViewKey = key;
  document.body.classList.toggle('private', !!S.settings.private);
  renderSidebar();
  renderBottomNav();
  main.classList.toggle('feed-mode', S.view === 'feed');
  $('#topbar').classList.toggle('hidden', S.view === 'feed');
  const fn = VIEWS[S.view] || VIEWS.feed;
  fn(main);
  renderSelbar();
  if (S.view !== 'feed') main.scrollTop = keepScroll;
}

// ----------------------------- Empty state ---------------------------
function emptyArt(sym = 'image') {
  return `<svg class="art" viewBox="0 0 170 150" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="eg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient>
    <linearGradient id="eg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff8fb3"/></linearGradient></defs>
    <ellipse cx="85" cy="138" rx="60" ry="7" fill="currentColor" opacity=".08"/>
    <g transform="rotate(-10 60 72)"><rect x="18" y="30" width="84" height="84" rx="14" fill="var(--surface-3)"/><rect x="26" y="38" width="68" height="52" rx="8" fill="var(--surface-2)"/></g>
    <g transform="rotate(8 100 70)"><rect x="56" y="22" width="92" height="96" rx="16" fill="var(--surface)" stroke="var(--border)" stroke-width="2"/>
      <rect x="65" y="31" width="74" height="58" rx="10" fill="url(#eg1)" opacity=".9"/>
      <circle cx="122" cy="47" r="8" fill="url(#eg2)"/>
      <path d="M65 80l20-20 16 15 12-10 26 24v4a10 10 0 0 1-10 10H75a10 10 0 0 1-10-10z" fill="#fff" opacity=".85"/>
      <rect x="66" y="97" width="44" height="6" rx="3" fill="var(--surface-3)"/><rect x="66" y="107" width="28" height="5" rx="2.5" fill="var(--surface-3)"/></g>
    <circle cx="140" cy="112" r="20" fill="url(#eg1)"/>
    <svg x="128" y="100" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${sym}"/></svg>
    <circle cx="22" cy="24" r="4" fill="var(--accent)" opacity=".5"/><circle cx="156" cy="20" r="3" fill="#ff8fb3" opacity=".7"/><circle cx="12" cy="104" r="2.5" fill="#ffd27a"/>
  </svg>`;
}
function emptyState(sym, title, text, buttons = '') {
  return `<div class="empty">${emptyArt(sym)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${buttons}</div>`;
}
const uploadBtn = (label = 'Unggah Foto/Video') => `<button class="btn primary" data-upload>${icon('upload', 'sm')} ${label}</button>`;

// ----------------------------- Grid ----------------------------------
function cellHTML(p, { trash = false } = {}) {
  const sel = S.selected.has(p.id);
  const left = trash && p.deletedAt ? Math.max(0, 30 - Math.floor((Date.now() - p.deletedAt) / 86400000)) : null;
  return `<div class="cell ${sel ? 'sel' : ''} ${p.rot ? 'rot-' + p.rot : ''}" data-pid="${p.id}">
    <img data-thumb="${p.id}" alt="">
    <span class="badges">${p.pinned ? `<span class="badge">${icon('pin')}</span>` : ''}${p.fav ? `<span class="badge fav">${icon('star', 'fill')}</span>` : ''}</span>
    ${p.likes ? `<span class="likes">${icon('heart', 'fill')}${p.likes}</span>` : ''}
    ${isVideo(p) ? `<span class="dur ${left != null ? 'up' : ''}">${icon('play', 'fill')}${fmtDur(p.duration)}</span>` : ''}
    ${left != null ? `<span class="days-left">${left} hari</span>` : ''}
    <span class="check">${icon('check')}</span></div>`;
}
function gridHTML(list, opts = {}) {
  return `<div class="grid ${S.selecting ? 'selecting' : ''}" style="--cols:${S.settings.cols}">${list.map(p => cellHTML(p, opts)).join('')}</div>`;
}
function groupedGridHTML(list, dateKey) {
  if (!list.length) return '';
  let html = '', cur = '', bucket = [];
  const flush = () => { if (bucket.length) { html += `<div class="month-head">${cur}</div>` + gridHTML(bucket); bucket = []; } };
  list.forEach(p => {
    const d = new Date(p[dateKey] || p.uploadedAt);
    const k = `${monthName(d.getMonth())} ${d.getFullYear()}`;
    if (k !== cur) { flush(); cur = k; }
    bucket.push(p);
  });
  flush();
  return html;
}

// Grid interactions: tap (open / toggle), long-press (start selection)
let lp = null, lpFired = false;
function bindGrid(root, mode = 'normal') {
  hydrateThumbs(root);
  root.onpointerdown = e => {
    const c = e.target.closest('.cell'); if (!c) return;
    lpFired = false;
    const x = e.clientX, y = e.clientY;
    clearTimeout(lp);
    lp = setTimeout(() => {
      lpFired = true;
      if (!S.selecting) enterSelection(c.dataset.pid); else toggleSel(c.dataset.pid);
      if (S.settings.haptics) sfx('toggle');
    }, 460);
    const cancel = ev => { if (!ev || Math.hypot(ev.clientX - x, ev.clientY - y) > 10) { clearTimeout(lp); off(); } };
    const off = () => { window.removeEventListener('pointermove', cancel); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    const up = () => { clearTimeout(lp); off(); };
    window.addEventListener('pointermove', cancel); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  root.oncontextmenu = e => { if (e.target.closest('.cell')) e.preventDefault(); };
  root.onclick = e => {
    const c = e.target.closest('.cell'); if (!c) return;
    if (lpFired) { lpFired = false; return; }
    const id = c.dataset.pid;
    if (S.selecting) { toggleSel(id); return; }
    sfx('tap');
    const ids = $$('.cell', root).map(x => x.dataset.pid);
    currentList = ids;
    openViewer(ids, ids.indexOf(id), { mode });
  };
}

// ----------------------------- Selection -----------------------------
export function enterSelection(id) {
  S.selecting = true; S.selected.clear();
  if (id) S.selected.add(id);
  $$('#main .grid').forEach(g => g.classList.add('selecting'));
  if (id) $(`#main .cell[data-pid="${id}"]`)?.classList.add('sel');
  renderSelbar();
}
export function exitSelection(rerender = true) {
  if (!S.selecting) return;
  S.selecting = false; S.selected.clear();
  $$('#main .grid').forEach(g => g.classList.remove('selecting'));
  $$('#main .cell.sel').forEach(c => c.classList.remove('sel'));
  renderSelbar();
  if (rerender) sfx('close');
}
function toggleSel(id) {
  S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
  $(`#main .cell[data-pid="${id}"]`)?.classList.toggle('sel', S.selected.has(id));
  sfx('tap');
  if (!S.selected.size) { exitSelection(); return; }
  renderSelbar();
}
function renderSelbar() {
  const bar = $('#selbar');
  $('#main').classList.toggle('with-selbar', S.selecting);
  if (!S.selecting) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  const n = S.selected.size;
  const ids = () => [...S.selected];
  const allFav = ids().every(id => photoById(id)?.fav);
  const allPin = ids().every(id => photoById(id)?.pinned);
  let acts;
  if (S.view === 'trash') acts = [
    ['restore', 'Pulihkan', async () => { await A.restore(ids()); exitSelection(); }],
    ['trash', 'Hapus permanen', async () => { if (await A.deleteForever(ids())) exitSelection(); }, true]
  ];
  else if (S.view === 'archive') acts = [
    ['archive', 'Keluarkan', async () => { await A.setFlag(ids(), 'archived', false); exitSelection(); }],
    ['tag', 'Tag', async () => { if (await A.bulkTags(ids())) exitSelection(); }],
    ['download', 'Unduh', () => A.downloadPhotos(ids())],
    ['trash', 'Hapus', async () => { await A.softDelete(ids()); exitSelection(); }, true]
  ];
  else acts = [
    ['star', allFav ? 'Batal favorit' : 'Favorit', async () => { await A.setFlag(ids(), 'fav', !allFav); exitSelection(); }],
    ['pin', allPin ? 'Lepas pin' : 'Pin', async () => { await A.setFlag(ids(), 'pinned', !allPin); exitSelection(); }],
    ['archive', 'Arsip', async () => { await A.setFlag(ids(), 'archived', true); exitSelection(); }],
    ['album', 'Album', async () => { await A.chooseAlbum(ids()); exitSelection(); }],
    ['tag', 'Tag', async () => { if (await A.bulkTags(ids())) exitSelection(); }],
    ['download', 'Unduh', () => A.downloadPhotos(ids())],
    ['trash', 'Hapus', async () => { await A.softDelete(ids()); exitSelection(); }, true]
  ];
  bar.innerHTML = `<div class="top"><button class="icon-btn ghost" data-sx>${icon('x')}</button><b>${n} dipilih</b>
      <button class="btn sm" data-sall>${icon('select', 'sm')} Pilih semua</button></div>
    <div class="acts" style="--n:${acts.length}">${acts.map((a, i) => `<button class="sel-act ${a[3] ? 'danger' : ''}" data-si="${i}" ${n ? '' : 'disabled'}>${icon(a[0])}<span>${a[1]}</span></button>`).join('')}</div>`;
  $('[data-sx]', bar).onclick = () => exitSelection();
  $('[data-sall]', bar).onclick = () => {
    const all = $$('#main .cell').map(c => c.dataset.pid);
    const every = all.every(id => S.selected.has(id));
    S.selected = new Set(every ? [] : all);
    $$('#main .cell').forEach(c => c.classList.toggle('sel', S.selected.has(c.dataset.pid)));
    sfx('tap');
    if (!S.selected.size) exitSelection(); else renderSelbar();
  };
  $$('[data-si]', bar).forEach(b => b.onclick = () => { sfx('tap'); acts[+b.dataset.si][2](); });
}

// ----------------------------- Feed ----------------------------------
let feedIO = null, feedList = [], feedRendered = 0, viewTimer = null;
function feedItemHTML(p) {
  const m = memberById(p.memberId);
  const a = albumById(p.albumId);
  const r = p.rot || 0;
  return `<section class="feed-item ${r ? 'r' + r : ''}" data-fid="${p.id}" style="--rot:${r}deg">
    <div class="feed-bg"></div>
    ${isVideo(p) ? '<video class="feed-img feed-vid" playsinline webkit-playsinline muted loop preload="none"></video><div class="vid-ind"></div>' : '<img class="feed-img" alt="">'}
    <div class="feed-shade"></div>
    <div class="feed-rail">
      <button class="rail-btn" data-f="who">${m ? avatarHTML(m) : `<span class="avatar">${esc(p.memberEmoji || '👤')}</span>`}</button>
      <button class="rail-btn ${A.isLiked(p) ? 'liked' : ''}" data-f="like"><span class="bub">${icon('heart')}</span><span class="n">${p.likes || 0}</span></button>
      ${isVideo(p) ? `<button class="rail-btn" data-f="mute"><span class="bub">${icon(feedMuted ? 'volume-x' : 'volume')}</span><span>${feedMuted ? 'Suara' : 'Bisukan'}</span></button>` : ''}
      <button class="rail-btn ${p.fav ? 'faved' : ''}" data-f="fav"><span class="bub">${icon('star')}</span><span>Favorit</span></button>
      <button class="rail-btn" data-f="share"><span class="bub">${icon('share')}</span><span>Bagikan</span></button>
      <button class="rail-btn" data-f="dl"><span class="bub">${icon('download')}</span><span>Simpan</span></button>
      <button class="rail-btn" data-f="more"><span class="bub">${icon('more')}</span></button>
    </div>
    <div class="feed-info">
      ${a ? `<span class="album-pill">${icon('album')}${esc(a.name)}</span>` : ''}
      <div class="who">${esc(p.memberEmoji || '')} ${esc(m?.name || p.memberName || 'Anggota')} <span class="when">· ${relTime(p.uploadedAt)}</span></div>
      <div class="name">${esc(p.name)}</div>
      ${p.desc ? `<div class="desc">${esc(p.desc)}</div>` : ''}
      ${p.tags?.length ? `<div class="tags">${p.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
  </section>`;
}
let feedMuted = true;
async function loadFeedItem(sec) {
  if (sec.dataset.loaded) return;
  sec.dataset.loaded = '1';
  const id = sec.dataset.fid;
  const media = $('.feed-img', sec);
  const t = await thumbUrl(id);
  if (t) $('.feed-bg', sec).style.backgroundImage = `url("${t}")`;
  if (media.tagName === 'VIDEO') { if (t) media.poster = t; return; }
  if (t && !media.src) media.src = t;
  if (photoById(id)?.unsupported) return;
  const f = await fullUrl(id);
  if (f) { const pre = new Image(); pre.onload = () => { media.src = f; }; pre.src = f; }
}
// Play the video in the current feed item, pause all others.
async function feedPlay(sec) {
  $$('#feed video').forEach(v => { if (!sec || !sec.contains(v)) { try { v.pause(); } catch { /* ignore */ } } });
  const v = sec && $('video', sec);
  if (!v) return;
  if (!v.src) { const u = await fullUrl(sec.dataset.fid); if (!u) return; v.src = u; }
  if (!sec.classList.contains('current')) return;
  v.muted = feedMuted;
  try { await v.play(); } catch { v.muted = true; try { await v.play(); } catch { /* user must tap */ } }
}
function feedInd(sec, playing) {
  const ind = $('.vid-ind', sec); if (!ind) return;
  ind.innerHTML = icon(playing ? 'play' : 'pause', 'fill');
  ind.classList.remove('show'); void ind.offsetWidth; ind.classList.add('show');
}
function appendFeed(feed, n = 8) {
  const next = feedList.slice(feedRendered, feedRendered + n);
  if (!next.length) return;
  feed.insertAdjacentHTML('beforeend', next.map(feedItemHTML).join(''));
  feedRendered += next.length;
  $$('.feed-item:not([data-obs])', feed).forEach(s => { s.dataset.obs = '1'; feedIO.observe(s); });
}
// Feed order: shuffled (default) or newest first. The shuffle stays the same until the app is
// reopened or 🔀 is tapped (so liking/scrolling doesn't reshuffle). Only photos uploaded in the
// last 3 minutes are pinned on top, so you see what you just added.
let feedSeed = Math.floor(Math.random() * 1e9);
let feedReset = false;
let shuffledAt = Date.now(); // page open time: only uploads made after this (and after the last 🔀) are pinned on top
const FRESH_MS = 3 * 60 * 1000;
function seeded(id) {
  let h = feedSeed ^ 0x9e3779b9;
  for (let i = 0; i < id.length; i++) { h = Math.imul(h ^ id.charCodeAt(i), 0x85ebca6b); h ^= h >>> 13; }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0;
}
function feedOrder(list) {
  if (S.settings.feedMode === 'new') return list.sort((a, b) => b.uploadedAt - a.uploadedAt);
  const now = Date.now();
  const fresh = list.filter(p => now - p.uploadedAt < FRESH_MS && p.uploadedAt > shuffledAt && p.memberId === S.member?.id).sort((a, b) => b.uploadedAt - a.uploadedAt).slice(0, 12);
  const freshIds = new Set(fresh.map(p => p.id));
  const rest = list.filter(p => !freshIds.has(p.id)).sort((a, b) => seeded(a.id) - seeded(b.id));
  return [...fresh, ...rest];
}
export function reshuffleFeed() {
  setSetting('feedMode', 'shuffle');
  feedSeed = Math.floor(Math.random() * 1e9);
  feedReset = true;
  shuffledAt = Date.now();
  sfx('toggle');
  toast('Feed diacak ulang 🔀', { action: { label: 'Terbaru dulu', fn: () => { setSetting('feedMode', 'new'); feedReset = true; render({ resetScroll: true }); toast('Feed: terbaru dulu'); } } });
  if (S.view !== 'feed') go('feed'); else render({ resetScroll: true });
}
function feedModeMenu() {
  // Tap 🔀 = reshuffle right away; when in "newest" mode, switch back to shuffle.
  reshuffleFeed();
}

function renderFeed(main) {
  const prevId = feedReset ? null : $('.feed-item.current', main)?.dataset.fid;
  feedReset = false;
  feedList = feedOrder(visible());
  const shuffleOn = S.settings.feedMode !== 'new';
  const top = `<div class="feed-top"><div class="title"><span class="brand-mark">${icon('image')}</span>KIRANA</div>
    <button class="icon-btn ${shuffleOn ? 'on' : ''}" data-feedmode aria-label="Urutan feed" title="${shuffleOn ? 'Acak' : 'Terbaru'}">${icon(shuffleOn ? 'shuffle' : 'clock')}</button>
    ${syncPill(true)}
    <button class="icon-btn" data-upload aria-label="Unggah">${icon('upload')}</button>
    <button class="member-chip" data-member>${avatarHTML(S.member, 'sm')}<span class="hide-mob">${esc(S.member?.name || '')}</span></button></div>`;
  if (!feedList.length) {
    main.innerHTML = `${top}<div class="feed-empty">${emptyState('camera', 'Feed masih kosong', 'Unggah foto keluarga pertama kamu. Semua foto tersimpan aman di HP ini.', uploadBtn())}</div>`;
    return;
  }
  main.innerHTML = `${top}<div class="feed" id="feed"></div>`;
  const feed = $('#feed', main);
  feedIO?.disconnect();
  feedIO = new IntersectionObserver(entries => {
    entries.forEach(en => {
      const sec = en.target;
      if (!en.isIntersecting) { const v = $('video', sec); if (v) try { v.pause(); } catch { /* ignore */ } }
      if (en.isIntersecting) {
        loadFeedItem(sec);
        const nx = sec.nextElementSibling; if (nx) loadFeedItem(nx);
      }
      if (en.intersectionRatio > 0.6) {
        $$('.feed-item.current', feed).forEach(x => x.classList.remove('current'));
        sec.classList.add('current');
        feedPlay(sec);
        clearTimeout(viewTimer);
        viewTimer = setTimeout(() => { const p = photoById(sec.dataset.fid); if (p && sec.classList.contains('current')) A.markViewed(p); }, 1500);
        if (!sec.nextElementSibling || !sec.nextElementSibling.nextElementSibling) appendFeed(feed);
      }
    });
  }, { root: feed, threshold: [0, 0.6] });
  feedRendered = 0;
  const idx = prevId ? feedList.findIndex(p => p.id === prevId) : -1;
  appendFeed(feed, Math.max(8, idx + 3));
  if (idx > 0) { const t = $(`.feed-item[data-fid="${idx >= 0 ? prevId : ''}"]`, feed); if (t) feed.scrollTop = t.offsetTop; }
  bindFeed(feed);
}
function bindFeed(feed) {
  let lastTap = 0, tapTimer = null;
  feed.addEventListener('click', async e => {
    const sec = e.target.closest('.feed-item'); if (!sec) return;
    const p = photoById(sec.dataset.fid); if (!p) return;
    const b = e.target.closest('[data-f]');
    if (b) {
      const f = b.dataset.f;
      if (f === 'like') { const liked = await A.toggleLike(p); b.classList.toggle('liked', liked); $('.n', b).textContent = p.likes; if (liked) burst(sec, null); }
      else if (f === 'fav') { const fav = await A.toggleFav(p); b.classList.toggle('faved', fav); toast(fav ? 'Ditambahkan ke Favorit' : 'Dihapus dari Favorit'); }
      else if (f === 'share') A.sharePhoto(p);
      else if (f === 'dl') A.downloadPhotos([p.id]);
      else if (f === 'who') { const m = memberById(p.memberId); toast(`Diunggah oleh ${m?.name || p.memberName} ${p.memberEmoji || ''} · ${fmtDateTime(p.uploadedAt)}`); }
      else if (f === 'more') feedMore(p);
      else if (f === 'mute') {
        feedMuted = !feedMuted;
        $$('#feed video').forEach(v => { v.muted = feedMuted; });
        $$('#feed [data-f="mute"]').forEach(x => { x.innerHTML = `<span class="bub">${icon(feedMuted ? 'volume-x' : 'volume')}</span><span>${feedMuted ? 'Suara' : 'Bisukan'}</span>`; });
        const v = $('video', sec); if (v && v.paused) feedPlay(sec);
      }
      return;
    }
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer); lastTap = 0;
      if (!A.isLiked(p)) { await A.toggleLike(p); const lb = $('[data-f="like"]', sec); lb.classList.add('liked'); $('.n', lb).textContent = p.likes; }
      burst(sec, e);
    } else {
      lastTap = now;
      const v = $('video', sec);
      if (v) tapTimer = setTimeout(() => {
        if (v.paused) { v.muted = feedMuted; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); feedInd(sec, true); }
        else { v.pause(); feedInd(sec, false); }
      }, 300);
    }
  });
}
function burst(sec, e) {
  const r = sec.getBoundingClientRect();
  const x = e ? e.clientX - r.left : r.width / 2, y = e ? e.clientY - r.top : r.height / 2;
  const h = el(`<div class="heart-burst" style="left:${x}px;top:${y}px">${icon('heart')}</div>`);
  sec.appendChild(h); setTimeout(() => h.remove(), 850);
}
function feedMore(p) {
  actionSheet(p.name, [
    { icon: 'zoom', label: 'Buka di penampil', sub: isVideo(p) ? 'Layar penuh dengan kontrol video' : 'Zoom, putar, info lengkap', fn: () => openViewer(feedList.map(x => x.id), feedList.findIndex(x => x.id === p.id)) },
    { icon: 'tag', label: 'Deskripsi & tag', fn: () => A.editDescTags(p) },
    { icon: 'album', label: 'Pindah ke album', fn: () => A.chooseAlbum([p.id]) },
    { icon: 'edit', label: 'Ganti nama', fn: () => A.rename(p) },
    { icon: 'pin', label: p.pinned ? 'Lepas sematan' : 'Sematkan', fn: () => A.setFlag([p.id], 'pinned', !p.pinned) },
    { icon: 'archive', label: 'Arsipkan', fn: () => A.setFlag([p.id], 'archived', true) },
    { icon: 'trash', label: 'Hapus', danger: true, fn: () => A.softDelete([p.id]) }
  ]);
}
export function feedScroll(dir) {
  const feed = $('#feed'); if (!feed) return;
  feed.scrollBy({ top: dir * feed.clientHeight, behavior: 'smooth' });
}

// ----------------------------- Gallery -------------------------------
function applyFilters(list) {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  if (q) list = list.filter(p => [p.name, p.desc, (p.tags || []).join(' '), p.memberName].join(' ').toLowerCase().includes(q.replace(/^#/, '')));
  if (f.member !== 'all') list = list.filter(p => p.memberId === f.member);
  if (f.kind === 'video') list = list.filter(isVideo); else if (f.kind === 'photo') list = list.filter(p => !isVideo(p));
  if (f.tag) list = list.filter(p => (p.tags || []).includes(f.tag));
  const now = new Date(); const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ranges = { today: [sod, Infinity], d7: [Date.now() - 7 * 864e5, Infinity], d30: [Date.now() - 30 * 864e5, Infinity], year: [new Date(now.getFullYear(), 0, 1).getTime(), Infinity] };
  if (ranges[f.range]) { const [a, b] = ranges[f.range]; list = list.filter(p => p.uploadedAt >= a && p.uploadedAt < b); }
  if (f.range === 'custom') {
    const a = f.from ? new Date(f.from + 'T00:00').getTime() : -Infinity;
    const b = f.to ? new Date(f.to + 'T23:59:59').getTime() : Infinity;
    list = list.filter(p => p.uploadedAt >= a && p.uploadedAt <= b);
  }
  const sorters = {
    new: (a, b) => b.uploadedAt - a.uploadedAt, old: (a, b) => a.uploadedAt - b.uploadedAt,
    taken: (a, b) => (b.takenAt || b.uploadedAt) - (a.takenAt || a.uploadedAt),
    az: (a, b) => a.name.localeCompare(b.name, 'id'), za: (a, b) => b.name.localeCompare(a.name, 'id'),
    size: (a, b) => (b.size || 0) - (a.size || 0), likes: (a, b) => (b.likes || 0) - (a.likes || 0) || b.uploadedAt - a.uploadedAt,
    viewed: (a, b) => (b.viewedAt || 0) - (a.viewedAt || 0)
  };
  return list.sort(sorters[f.sort] || sorters.new);
}
const SORTS = [['new', 'Terbaru'], ['old', 'Terlama'], ['taken', 'Tanggal foto'], ['az', 'Nama A–Z'], ['za', 'Nama Z–A'], ['size', 'Ukuran terbesar'], ['likes', 'Paling disukai'], ['viewed', 'Baru dilihat']];
const RANGES = [['all', 'Semua waktu'], ['today', 'Hari ini'], ['d7', '7 hari'], ['d30', '30 hari'], ['year', 'Tahun ini'], ['custom', 'Rentang…']];
const colsSeg = () => `<div class="seg" data-cols>${[2, 3, 4, 6].map(c => `<button class="${S.settings.cols === c ? 'active' : ''}" data-c="${c}">${c}</button>`).join('')}</div>`;

function renderGallery(main) {
  const all = visible();
  const nVid = all.filter(isVideo).length;
  $('#topbar').innerHTML = topbarHTML(`Galeri <small>${nVid ? `${all.length} item` : `${all.length} foto`}</small>`, `<button class="icon-btn" data-select aria-label="Pilih">${icon('select')}</button>`);
  if (!all.length) { main.innerHTML = emptyState('image', 'Belum ada foto', 'Foto yang kamu unggah akan muncul di sini, rapi per bulan.', uploadBtn()); return; }
  const f = S.filters;
  main.innerHTML = `
    <div class="toolbar">
      <label class="search-box">${icon('search', 'sm')}<input id="q" type="search" placeholder="Cari nama, deskripsi, #tag…" value="${esc(f.q)}" /></label>
      <select class="select" id="sort">${SORTS.map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="select" id="range">${RANGES.map(([v, l]) => `<option value="${v}" ${f.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${colsSeg()}
    </div>
    ${f.range === 'custom' ? `<div class="date-range">${icon('calendar', 'sm')}<input type="date" id="from" value="${f.from}"> – <input type="date" id="to" value="${f.to}"></div>` : ''}
    <div class="chips" id="kchips">${[['all', 'Semua jenis'], ['photo', '📷 Foto'], ['video', '🎬 Video']].map(([k, l]) => `<button class="chip ${(f.kind || 'all') === k ? 'active' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
    ${(() => { const tags = A.allTags().slice(0, 30); if (f.tag && !tags.includes(f.tag)) f.tag = ''; return tags.length ? `<div class="chips" id="tchips">${tags.map(t => `<button class="chip ${f.tag === t ? 'active' : ''}" data-t="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''; })()}
    <div class="chips" id="mchips"><button class="chip ${f.member === 'all' ? 'active' : ''}" data-m="all">Semua</button>${S.members.map(m => `<button class="chip ${f.member === m.id ? 'active' : ''}" data-m="${m.id}">${esc(m.emoji)} ${esc(m.name)}</button>`).join('')}</div>
    <div id="gres"></div>`;
  const res = $('#gres', main);
  const draw = () => {
    const list = applyFilters(visible());
    if (!list.length) { res.innerHTML = emptyState('search', 'Tidak ditemukan', 'Coba kata kunci atau filter lain.'); return; }
    const filtered = f.q || f.member !== 'all' || f.range !== 'all' || (f.kind && f.kind !== 'all') || f.tag;
    const pinned = !filtered && ['new', 'old', 'taken'].includes(f.sort) ? list.filter(p => p.pinned) : [];
    const rest = pinned.length ? list.filter(p => !p.pinned) : list;
    let html = '';
    if (pinned.length) html += `<div class="section-title">${icon('pin', 'sm')} Disematkan <span class="sub">${pinned.length}</span></div>` + gridHTML(pinned);
    if (filtered) html += `<div class="month-head">${list.length} hasil</div>`;
    html += ['new', 'old', 'taken'].includes(f.sort) ? groupedGridHTML(rest, f.sort === 'taken' ? 'takenAt' : 'uploadedAt') : gridHTML(rest);
    res.innerHTML = html;
    bindGrid(res);
  };
  draw();
  const q = $('#q', main);
  q.oninput = () => { f.q = q.value; clearTimeout(q._t); q._t = setTimeout(draw, 180); };
  $('#sort', main).onchange = e => { f.sort = e.target.value; sfx('tap'); draw(); };
  $('#range', main).onchange = e => { f.range = e.target.value; sfx('tap'); render(); };
  if ($('#from', main)) { $('#from', main).onchange = e => { f.from = e.target.value; draw(); }; $('#to', main).onchange = e => { f.to = e.target.value; draw(); }; }
  $$('#tchips [data-t]', main).forEach(b => b.onclick = () => { f.tag = f.tag === b.dataset.t ? '' : b.dataset.t; sfx('tap'); $$('#tchips .chip', main).forEach(x => x.classList.toggle('active', x.dataset.t === f.tag)); draw(); });
  $$('#kchips [data-k]', main).forEach(b => b.onclick = () => { f.kind = b.dataset.k; sfx('tap'); $$('#kchips .chip', main).forEach(x => x.classList.toggle('active', x === b)); draw(); });
  $$('#mchips [data-m]', main).forEach(b => b.onclick = () => { f.member = b.dataset.m; sfx('tap'); $$('#mchips .chip', main).forEach(x => x.classList.toggle('active', x === b)); draw(); });
  bindCols(main, draw);
}
function bindCols(main, redraw) {
  $$('[data-cols] [data-c]', main).forEach(b => b.onclick = () => {
    setSetting('cols', +b.dataset.c); sfx('tap');
    $$('[data-cols] button', main).forEach(x => x.classList.toggle('active', x === b));
    $$('.grid', main).forEach(g => g.style.setProperty('--cols', S.settings.cols));
    redraw && 0;
  });
}
export function focusSearch() {
  if (S.view !== 'gallery') go('gallery');
  setTimeout(() => $('#q')?.focus(), 60);
}

// ----------------------------- Albums --------------------------------
function albumCount(a) { return S.photos.filter(p => p.albumId === a.id && !p.deleted && !p.archived).length; }
function albumCoverId(a) {
  if (a.coverId && photoById(a.coverId) && !photoById(a.coverId).deleted) return a.coverId;
  const ps = S.photos.filter(p => p.albumId === a.id && !p.deleted && !p.archived).sort((x, y) => y.uploadedAt - x.uploadedAt);
  return ps[0]?.id || null;
}
function renderAlbums(main) {
  $('#topbar').innerHTML = topbarHTML(`Album <small>${S.albums.length}</small>`, `<button class="btn sm" data-newalbum>${icon('folder-plus', 'sm')} Baru</button>`);
  if (!S.albums.length) { main.innerHTML = emptyState('album', 'Belum ada album', 'Kelompokkan foto liburan, ulang tahun, atau momen spesial dalam album.', `<button class="btn primary" data-newalbum>${icon('folder-plus', 'sm')} Buat Album</button>`); return; }
  main.innerHTML = `<div class="albums">${S.albums.map(a => {
    const cid = albumCoverId(a);
    return `<button class="album-card" data-album="${a.id}"><div class="album-cover">${cid ? `<img data-thumb="${cid}" alt="">` : icon('image', 'xl')}</div>
      <div class="nm">${esc(a.name)}</div><div class="ct">${albumCount(a)} foto</div></button>`;
  }).join('')}<button class="album-card album-new" data-newalbum><div class="album-cover">${icon('plus', 'xl')}</div><div class="nm">Album baru</div><div class="ct">&nbsp;</div></button></div>`;
  hydrateThumbs(main);
  $$('[data-album]', main).forEach(b => b.onclick = () => { sfx('tap'); go('album', b.dataset.album); });
}
function renderAlbum(main) {
  const a = albumById(S.param);
  if (!a) { go('albums', null, { push: false }); return; }
  const list = S.photos.filter(p => p.albumId === a.id && !p.deleted && !p.archived).sort((x, y) => (y.pinned - x.pinned) || y.uploadedAt - x.uploadedAt);
  $('#topbar').innerHTML = `<button class="icon-btn" data-back>${icon('left')}</button>` + topbarHTML(`${esc(a.name)} <small>${list.length} foto</small>`, `<button class="icon-btn" data-amenu>${icon('more-v')}</button>`);
  main.innerHTML = `<div class="album-head">
      <button class="btn primary sm" data-upalbum>${icon('upload', 'sm')} Unggah ke album</button>
      <button class="btn sm" data-addto>${icon('plus', 'sm')} Tambah foto</button>
      ${list.length ? `<button class="btn sm" data-ssalbum>${icon('play', 'sm')} Slideshow</button><button class="btn sm" data-select>${icon('select', 'sm')} Pilih</button>` : ''}
      <span style="flex:1"></span>${list.length ? colsSeg() : ''}
    </div>
    ${list.length ? gridHTML(list) : emptyState('album', 'Album ini masih kosong', 'Unggah foto langsung ke album ini, atau tambahkan dari Galeri.')}`;
  bindGrid(main);
  bindCols(main);
  $('[data-upalbum]', main).onclick = () => uploadMenu({ albumId: a.id });
  $('[data-addto]', main).onclick = async () => {
    const ids = await A.pickPhotos(`Tambah ke “${a.name}”`, visible().filter(p => p.albumId !== a.id).sort((x, y) => y.uploadedAt - x.uploadedAt), { okLabel: 'Tambahkan' });
    if (ids?.length) await A.moveToAlbum(ids, a.id);
  };
  const ss = $('[data-ssalbum]', main); if (ss) ss.onclick = () => openSlideshow(list.map(p => p.id));
  $('[data-amenu]').onclick = () => actionSheet(a.name, [
    { icon: 'edit', label: 'Ganti nama album', fn: () => A.renameAlbum(a) },
    { icon: 'image', label: 'Pilih cover album', fn: async () => { const ids = await A.pickPhotos('Pilih cover', list, { single: true }); if (ids?.[0]) await A.setCover(photoById(ids[0])); } },
    { icon: 'play', label: 'Putar slideshow', fn: () => list.length ? openSlideshow(list.map(p => p.id)) : toast('Album kosong') },
    { icon: 'trash', label: 'Hapus album', danger: true, fn: async () => { if (await A.deleteAlbum(a)) go('albums', null, { push: false }); } }
  ]);
}

// ----------------------------- Favorites -----------------------------
function renderFavorites(main) {
  const list = visible().filter(p => p.fav).sort((a, b) => b.uploadedAt - a.uploadedAt);
  $('#topbar').innerHTML = topbarHTML(`Favorit <small>${list.length}</small>`, list.length ? `<button class="icon-btn" data-select>${icon('select')}</button>` : '');
  if (!list.length) { main.innerHTML = emptyState('star', 'Belum ada favorit', 'Ketuk ikon bintang di foto untuk menyimpannya di sini.', `<button class="btn primary" data-go="gallery">${icon('grid', 'sm')} Buka Galeri</button>`); return; }
  main.innerHTML = `<div class="album-head"><button class="btn primary sm" data-ssfav>${icon('play', 'sm')} Putar Slideshow</button><button class="btn sm" data-ssshuf>${icon('shuffle', 'sm')} Acak</button><span style="flex:1"></span>${colsSeg()}</div>${gridHTML(list)}`;
  bindGrid(main); bindCols(main);
  $('[data-ssfav]', main).onclick = () => openSlideshow(list.map(p => p.id));
  $('[data-ssshuf]', main).onclick = () => openSlideshow(list.map(p => p.id), { shuffle: true });
}

// ----------------------------- Memories ------------------------------
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function renderMemories(main) {
  $('#topbar').innerHTML = topbarHTML('Kenangan');
  const v = visible();
  if (!v.length) { main.innerHTML = emptyState('sparkles', 'Kenangan akan muncul di sini', 'Setelah ada foto, kamu akan melihat “hari ini tahun lalu”, foto favorit acak, dan lainnya.', uploadBtn()); return; }
  const now = new Date();
  const sameDay = p => { const d = new Date(p.takenAt || p.uploadedAt); return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() < now.getFullYear(); };
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sections = [
    ['Hari ini di tahun-tahun lalu', 'calendar', v.filter(sameDay).sort((a, b) => (b.takenAt || 0) - (a.takenAt || 0)), p => `${now.getFullYear() - new Date(p.takenAt || p.uploadedAt).getFullYear()} tahun lalu`],
    ['Foto hari ini', 'camera', v.filter(p => p.uploadedAt >= sod).sort((a, b) => b.uploadedAt - a.uploadedAt), p => fmtTime(p.uploadedAt)],
    ['Baru ditambahkan', 'upload', v.slice().sort((a, b) => b.uploadedAt - a.uploadedAt).slice(0, 15), p => relTime(p.uploadedAt)],
    ['Baru dilihat', 'clock', v.filter(p => p.viewedAt).sort((a, b) => b.viewedAt - a.viewedAt).slice(0, 15), p => relTime(p.viewedAt)],
    ['Favorit acak', 'star', shuffle(v.filter(p => p.fav)).slice(0, 12), p => p.memberName || '']
  ];
  const heroPool = sections[0][2].length ? sections[0][2] : (sections[4][2].length ? sections[4][2] : v);
  const hero = heroPool[Math.floor(Math.random() * heroPool.length)];
  const heroLabel = sections[0][2].length ? 'Hari ini tahun lalu' : (sections[4][2].length ? 'Dari favoritmu' : 'Kenangan acak');
  main.innerHTML = `
    <button class="mem-hero" data-hero="${hero.id}"><img data-thumb="${hero.id}" alt=""><div class="shade"></div>
      <div class="txt"><div class="k">${heroLabel}</div><h2>${esc(hero.desc || hero.name)}</h2><span class="btn sm primary">${icon('play', 'sm')} Putar kenangan</span></div></button>
    ${sections.map(([title, ic, list, cap], si) => list.length ? `
      <div class="section-title">${icon(ic, 'sm')} ${title} <span class="sub">${list.length}</span>
        <button class="btn sm ghost right" data-ss="${si}">${icon('play', 'sm')} Putar</button></div>
      <div class="mem-row">${list.map(p => `<button class="mem-card" data-mem="${si}" data-id="${p.id}"><img data-thumb="${p.id}" alt="">${isVideo(p) ? `<span class="vbadge">${icon('play', 'fill')}</span>` : ''}<div class="cap">${esc(cap(p))}</div></button>`).join('')}</div>` : '').join('')}`;
  hydrateThumbs(main);
  $('[data-hero]', main).onclick = () => openSlideshow(heroPool.map(p => p.id), { start: heroPool.indexOf(hero) });
  $$('[data-ss]', main).forEach(b => b.onclick = () => openSlideshow(sections[+b.dataset.ss][2].map(p => p.id)));
  $$('[data-mem]', main).forEach(b => b.onclick = () => { sfx('tap'); const ids = sections[+b.dataset.mem][2].map(p => p.id); openViewer(ids, ids.indexOf(b.dataset.id)); });
}

// ----------------------------- Archive / Trash -----------------------
function renderArchive(main) {
  const list = S.photos.filter(p => p.archived && !p.deleted).sort((a, b) => b.uploadedAt - a.uploadedAt);
  $('#topbar').innerHTML = topbarHTML(`Arsip <small>${list.length}</small>`, list.length ? `<button class="icon-btn" data-select>${icon('select')}</button>` : '');
  if (!list.length) { main.innerHTML = emptyState('archive', 'Arsip kosong', 'Foto yang diarsipkan disembunyikan dari Feed dan Galeri, tapi tidak dihapus.'); return; }
  main.innerHTML = `<p class="hint" style="margin:0 2px 12px">Foto di sini tidak tampil di Feed & Galeri. Tekan lama untuk memilih banyak.</p>${gridHTML(list)}`;
  bindGrid(main, 'archive');
}
function renderTrash(main) {
  const list = S.photos.filter(p => p.deleted).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  $('#topbar').innerHTML = topbarHTML(`Sampah <small>${list.length}</small>`, list.length ? `<button class="icon-btn" data-select>${icon('select')}</button>` : '');
  if (!list.length) { main.innerHTML = emptyState('trash', 'Sampah kosong', 'Foto yang dihapus disimpan di sini selama 30 hari sebelum dihapus otomatis.'); return; }
  main.innerHTML = `<div class="album-head"><p class="hint" style="flex:1;min-width:200px">Foto dihapus otomatis setelah 30 hari.</p>
    <button class="btn sm" data-restoreall>${icon('restore', 'sm')} Pulihkan semua</button>
    <button class="btn sm soft-danger" data-empty>${icon('trash', 'sm')} Kosongkan</button></div>${gridHTML(list, { trash: true })}`;
  bindGrid(main, 'trash');
  $('[data-empty]', main).onclick = () => A.emptyTrash();
  $('[data-restoreall]', main).onclick = () => A.restore(list.map(p => p.id));
}
export async function autoPurge() {
  const limit = Date.now() - 30 * 864e5;
  const old = S.photos.filter(p => p.deleted && p.deletedAt && p.deletedAt < limit).map(p => p.id);
  if (!old.length) return;
  const { removePhotosForever } = await import('./core.js');
  await removePhotosForever(old);
  await addLog('trash-empty', `menghapus otomatis ${old.length} foto (lebih dari 30 hari di sampah)`);
}

// ----------------------------- Stats ---------------------------------
async function renderStats(main) {
  $('#topbar').innerHTML = topbarHTML('Statistik');
  const live = S.photos.filter(p => !p.deleted);
  const total = live.reduce((s, p) => s + (p.size || 0), 0);
  const likes = live.reduce((s, p) => s + (p.likes || 0), 0);
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ y: d.getFullYear(), m: d.getMonth(), n: 0 }); }
  live.forEach(p => { const d = new Date(p.uploadedAt); const b = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth()); if (b) b.n++; });
  const max = Math.max(1, ...months.map(x => x.n));
  const W = 600, H = 210, bw = W / 12;
  const chart = `<svg class="chart" viewBox="0 0 ${W} ${H + 24}"><defs><linearGradient id="cb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75, 1].map(f => `<line x1="0" x2="${W}" y1="${H - f * (H - 24)}" y2="${H - f * (H - 24)}" stroke="var(--border)" stroke-dasharray="4 6"/>`).join('')}
    ${months.map((b, i) => { const h = b.n ? Math.max(6, b.n / max * (H - 24)) : 3; const x = i * bw + bw * 0.18; return `<rect x="${x}" y="${H - h}" width="${bw * 0.64}" height="${h}" rx="7" fill="${b.n ? 'url(#cb)' : 'var(--surface-3)'}"/>${b.n ? `<text x="${x + bw * 0.32}" y="${H - h - 6}" text-anchor="middle" style="fill:var(--text);font-size:12px;font-weight:800">${b.n}</text>` : ''}<text x="${x + bw * 0.32}" y="${H + 18}" text-anchor="middle">${monthName(b.m, true)}</text>`; }).join('')}</svg>`;
  const up = {};
  live.forEach(p => { const k = p.memberId || p.memberName; (up[k] ||= { n: 0, name: p.memberName, emoji: p.memberEmoji, id: p.memberId }).n++; });
  S.members.forEach(m => { up[m.id] ||= { n: 0, name: m.name, emoji: m.emoji, id: m.id }; });
  const board = Object.values(up).sort((a, b) => b.n - a.n);
  const bmax = Math.max(1, ...board.map(b => b.n));
  const top = live.filter(p => p.likes).sort((a, b) => b.likes - a.likes).slice(0, 6);
  const st = await storageInfo();
  const card = (v, l, ic) => `<div class="stat">${icon(ic, 'sm')}<div class="v">${v}</div><div class="l">${l}</div></div>`;
  main.innerHTML = `
    <div class="stats-grid">
      ${card(live.filter(p => !isVideo(p)).length, 'Foto', 'image')}${card(live.filter(isVideo).length, 'Video', 'play')}
      ${card(fmtSize(total), 'Ukuran total', 'database')}
      ${card(S.albums.length, 'Album', 'album')}${card(live.filter(p => p.fav).length, 'Favorit', 'star')}
      ${card(likes, 'Total suka', 'heart')}${card(S.members.length, 'Anggota', 'users')}${card(fmtDur(live.filter(isVideo).reduce((a, p) => a + (p.duration || 0), 0)), 'Durasi video', 'clock')}
      ${card(live.filter(p => p.archived).length, 'Diarsipkan', 'archive')}${card(S.photos.filter(p => p.deleted).length, 'Di sampah', 'trash')}
    </div>
    <div class="section-title">${icon('chart', 'sm')} Foto per bulan <span class="sub">12 bulan terakhir</span></div>
    <div class="card">${chart}</div>
    <div class="section-title">${icon('trophy', 'sm')} Leaderboard unggahan</div>
    <div class="card">${board.map((b, i) => { const m = memberById(b.id); return `<div class="lb-row"><span class="lb-rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${m ? avatarHTML(m, 'sm') : `<span class="avatar sm">${esc(b.emoji || '👤')}</span>`}<div style="flex:1;min-width:0"><div style="display:flex;gap:8px"><span class="lb-name">${esc(m?.name || b.name || 'Tamu')}</span><span class="lb-num">${b.n}</span></div><div class="lb-bar"><i style="width:${b.n / bmax * 100}%"></i></div></div></div>`; }).join('')}</div>
    ${top.length ? `<div class="section-title">${icon('heart', 'sm')} Paling disukai</div><div class="mem-row">${top.map(p => `<button class="mem-card" data-id="${p.id}"><img data-thumb="${p.id}" alt=""><div class="cap">❤️ ${p.likes} · ${esc(p.memberName || '')}</div></button>`).join('')}</div>` : ''}
    <div class="section-title">${icon('database', 'sm')} Penyimpanan HP</div>
    <div class="card"><b>${st.text}</b><div class="hint">Semua foto tersimpan offline di HP ini.</div></div>`;
  hydrateThumbs(main);
  $$('.mem-card', main).forEach(b => b.onclick = () => { const ids = top.map(p => p.id); openViewer(ids, ids.indexOf(b.dataset.id)); });
}

// ----------------------------- Log -----------------------------------
function renderLog(main) {
  const f = S.logFilter;
  const list = f === 'all' ? S.logs : S.logs.filter(l => l.memberId === f);
  $('#topbar').innerHTML = topbarHTML(`Log <small>${list.length}</small>`, S.logs.length ? `<button class="icon-btn" data-clearlog aria-label="Hapus log">${icon('trash')}</button>` : '');
  const chips = `<div class="chips"><button class="chip ${f === 'all' ? 'active' : ''}" data-lf="all">Semua</button>${S.members.map(m => `<button class="chip ${f === m.id ? 'active' : ''}" data-lf="${m.id}">${esc(m.emoji)} ${esc(m.name)}</button>`).join('')}</div>`;
  if (!list.length) { main.innerHTML = chips + emptyState('activity', 'Belum ada aktivitas', 'Setiap unggahan, suka, favorit, hapus, dan perubahan album akan tercatat di sini.'); bindLog(main); return; }
  let html = chips, day = '';
  const shown = list.slice(0, 400);
  shown.forEach((l, i) => {
    const d = dayLabel(l.ts);
    if (d !== day) { if (day) html += '</div>'; html += `<div class="log-day">${d}</div><div class="list">`; day = d; }
    html += `<div class="log-item"><span class="act">${icon(logIcon(l.action))}</span><div class="txt"><b>${esc(l.memberEmoji)} ${esc(l.memberName)}</b> ${esc(l.text)}<div class="tm">${fmtTime(l.ts)}</div></div></div>`;
    if (i === shown.length - 1) html += '</div>';
  });
  if (list.length > shown.length) html += `<p class="hint" style="text-align:center;margin:14px">Menampilkan 400 aktivitas terbaru dari ${list.length}.</p>`;
  main.innerHTML = html;
  bindLog(main);
}
function bindLog(main) {
  $$('[data-lf]', main).forEach(b => b.onclick = () => { S.logFilter = b.dataset.lf; sfx('tap'); render({ resetScroll: true }); });
  const c = $('[data-clearlog]'); if (c) c.onclick = clearLogs;
}
async function clearLogs() {
  const f = S.logFilter;
  const m = memberById(f);
  const target = f === 'all' ? S.logs : S.logs.filter(l => l.memberId === f);
  if (!target.length) return;
  if (!(await confirmDialog(f === 'all' ? `Hapus semua ${target.length} log aktivitas?` : `Hapus ${target.length} log milik ${m?.name || 'anggota ini'}?`, { title: 'Hapus log', okLabel: 'Hapus', danger: true }))) return;
  await deleteRecords('logs', target.map(l => l.id));
  sfx('delete'); toast('Log dihapus'); render();
}

// ----------------------------- Settings ------------------------------
const ACCENTS = ['#7c5cff', '#ff5d8f', '#2fd39a', '#4da6ff', '#ffb547', '#ff7a45', '#14b8a6', '#e11d48'];
export function applyTheme() {
  const r = document.documentElement;
  r.dataset.theme = S.settings.theme;
  const a = S.settings.accent || '#7c5cff';
  const [R, G, B] = hexToRgb(a);
  r.style.setProperty('--accent', a);
  r.style.setProperty('--accent-2', mix(a, '#ffffff', 0.22));
  r.style.setProperty('--accent-soft', `rgba(${R},${G},${B},${S.settings.theme === 'light' ? 0.13 : 0.18})`);
  const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
  r.style.setProperty('--accent-text', lum > 0.7 ? '#111' : '#fff');
  const bg = S.settings.theme === 'light' ? '#f3f4f9' : '#0a0a0f';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  if (isNative) import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    StatusBar.setStyle({ style: S.settings.theme === 'light' ? Style.Light : Style.Dark }).catch(() => {});
    StatusBar.setBackgroundColor?.({ color: bg }).catch(() => {});
  }).catch(() => {});
}
const sw = on => `<span class="switch ${on ? 'on' : ''}"></span>`;
async function renderSettings(main) {
  $('#topbar').innerHTML = topbarHTML('Pengaturan');
  const s = S.settings;
  const m = S.member;
  const st = await storageInfo();
  if (S.view !== 'settings') return;
  main.innerHTML = `
    <div class="card" style="display:flex;align-items:center;gap:14px">${avatarHTML(m, 'lg')}
      <div style="flex:1;min-width:0"><div class="hint">Sedang dipakai oleh</div><div style="font-size:20px;font-weight:900">${esc(m?.name || '-')} ${m?.pass ? icon('lock', 'sm') : ''}</div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn sm" data-act="editme">${icon('edit', 'sm')} Edit profil</button><button class="btn sm" data-act="switch">${icon('switch', 'sm')} Ganti</button></div></div></div>

    <div class="group-label">Sinkron keluarga</div>
    <div class="list"><button class="row" data-sync><span class="ri green">${icon('users', 'sm')}</span><span class="rt"><b>Kode keluarga: ${esc(S.settings.familyCode || '—')}</b><small id="syncStatus">${esc(syncSummary())}</small></span><span class="rv">${icon('right', 'sm')}</span></button></div>

    <div class="group-label">Anggota keluarga</div>
    <div class="list">${S.members.map(x => `<div class="row">${avatarHTML(x, 'sm')}<span class="rt"><b>${esc(x.name)} ${x.pass ? icon('lock', 'sm') : ''}</b><small>${S.photos.filter(p => p.memberId === x.id && !p.deleted).length} foto</small></span>
      <button class="icon-btn ghost" data-medit="${x.id}">${icon('edit', 'sm')}</button><button class="icon-btn ghost" data-mdel="${x.id}" style="color:var(--danger)">${icon('trash', 'sm')}</button></div>`).join('')}
      <button class="row" data-act="addmember"><span class="ri">${icon('plus', 'sm')}</span><span class="rt"><b>Tambah anggota</b></span></button></div>

    <div class="group-label">Tampilan</div>
    <div class="list">
      <div class="row"><span class="ri">${icon(s.theme === 'light' ? 'sun' : 'moon', 'sm')}</span><span class="rt"><b>Tema</b></span>
        <div class="seg"><button class="${s.theme === 'dark' ? 'active' : ''}" data-theme="dark">${icon('moon', 'sm')} Gelap</button><button class="${s.theme === 'light' ? 'active' : ''}" data-theme="light">${icon('sun', 'sm')} Terang</button></div></div>
      <div class="row" style="border-bottom:0"><span class="ri">${icon('palette', 'sm')}</span><span class="rt"><b>Warna aksen</b><small>${esc(s.accent)}</small></span></div>
      <div class="swatches">${ACCENTS.map(c => `<button class="swatch ${s.accent.toLowerCase() === c ? 'active' : ''}" style="--c:${c}" data-accent="${c}"></button>`).join('')}
        <label class="swatch picker ${ACCENTS.includes(s.accent.toLowerCase()) ? '' : 'active'}" style="--c:${esc(s.accent)}" title="Pilih warna bebas"><input type="color" id="accIn" value="${esc(s.accent)}"></label></div>
      <div class="row"><span class="ri">${icon('grid', 'sm')}</span><span class="rt"><b>Kolom galeri</b></span>${colsSeg()}</div>
    </div>

    <div class="group-label">Privasi & keamanan</div>
    <div class="list">
      <button class="row" data-act="private"><span class="ri">${icon('eye-off', 'sm')}</span><span class="rt"><b>Mode privat</b><small>Buramkan thumbnail di galeri & feed</small></span>${sw(s.private)}</button>
      <button class="row" data-act="pin"><span class="ri">${icon('lock', 'sm')}</span><span class="rt"><b>PIN aplikasi</b><small>${s.pin ? 'Aktif — ketuk untuk ubah/hapus' : 'Kunci aplikasi dengan PIN 4 digit'}</small></span><span class="rv">${s.pin ? 'Aktif' : 'Mati'}</span></button>
      ${s.pin ? `<button class="row" data-act="lockresume"><span class="ri">${icon('clock', 'sm')}</span><span class="rt"><b>Kunci saat kembali</b><small>Minta PIN setelah aplikasi ditinggal 30 detik</small></span>${sw(s.lockOnResume)}</button>` : ''}
      <div class="row"><span class="ri green">${icon('trash', 'sm')}</span><span class="rt"><b>Sampah otomatis</b><small>Foto di Sampah dihapus permanen setelah 30 hari</small></span><span class="rv">Aktif</span></div>
    </div>

    <div class="group-label">Suara & getar</div>
    <div class="list">
      <button class="row" data-act="sound"><span class="ri">${icon('volume', 'sm')}</span><span class="rt"><b>Efek suara</b></span>${sw(s.sound)}</button>
      <button class="row" data-act="haptics"><span class="ri">${icon('vibrate', 'sm')}</span><span class="rt"><b>Getar</b></span>${sw(s.haptics)}</button>
    </div>

    ${isNative ? '' : `<div class="group-label">Pasang aplikasi</div>
    <div class="list">
      <button class="row" data-act="install"><span class="ri">${icon('download', 'sm')}</span><span class="rt"><b>Pasang di Layar Utama</b><small>iPhone: Safari → Bagikan → Add to Home Screen</small></span></button>
    </div>`}

    <div class="group-label">Cadangan & pindah HP</div>
    <div class="list">
      <button class="row" data-act="export"><span class="ri">${icon('download', 'sm')}</span><span class="rt"><b>Ekspor cadangan (.kfg)</b><small>Semua foto, album, anggota & log dalam satu file</small></span></button>
      <button class="row" data-act="send"><span class="ri">${icon('send', 'sm')}</span><span class="rt"><b>Kirim ke HP lain</b><small>Bagikan file cadangan lewat WhatsApp, Bluetooth, Drive…</small></span></button>
      <button class="row" data-act="import"><span class="ri">${icon('upload', 'sm')}</span><span class="rt"><b>Impor cadangan</b><small>Gabungkan foto dari file .kfg</small></span></button>
    </div>

    <div class="group-label">Alat</div>
    <div class="list">
      <button class="row" data-act="dups"><span class="ri yellow">${icon('layers', 'sm')}</span><span class="rt"><b>Scan duplikat</b><small>Temukan foto yang sama persis</small></span></button>
      <button class="row" data-act="keys"><span class="ri">${icon('keyboard', 'sm')}</span><span class="rt"><b>Pintasan keyboard</b><small>Untuk tablet/desktop dengan keyboard</small></span></button>
      <button class="row danger" data-act="wipe"><span class="ri red">${icon('alert', 'sm')}</span><span class="rt"><b>Hapus semua data</b><small>Menghapus semua foto, album, anggota & log di HP ini</small></span></button>
    </div>

    <div class="group-label">Tentang</div>
    <div class="list"><div class="row"><span class="ri">${icon('info', 'sm')}</span><span class="rt"><b>Kirana Family Gallery</b><small>Versi ${__APP_VERSION__} · 100% offline · Penyimpanan: ${st.text}</small></span></div></div>
    <div style="height:20px"></div>`;
  bindCols(main);
  $$('[data-theme]', main).forEach(b => b.onclick = () => { setSetting('theme', b.dataset.theme); sfx('toggle'); applyTheme(); render(); });
  $$('[data-accent]', main).forEach(b => b.onclick = () => { setSetting('accent', b.dataset.accent); sfx('tap'); applyTheme(); render(); });
  const acc = $('#accIn', main);
  acc.oninput = () => { S.settings.accent = acc.value; applyTheme(); };
  acc.onchange = () => { setSetting('accent', acc.value); render(); };
  $$('[data-medit]', main).forEach(b => b.onclick = async () => { if (await editMember(memberById(b.dataset.medit))) render(); });
  $$('[data-mdel]', main).forEach(b => b.onclick = async () => { if (await deleteMember(memberById(b.dataset.mdel))) render(); });
  $$('[data-act]', main).forEach(b => b.onclick = () => settingsAction(b.dataset.act));
}
async function settingsAction(act) {
  const s = S.settings;
  const toggle = k => { setSetting(k, !s[k]); sfx('toggle'); render(); };
  switch (act) {
    case 'editme': if (S.member && await editMember(S.member)) render(); break;
    case 'switch': await showMemberPicker(); render(); break;
    case 'addmember': if (await editMember(null)) render(); break;
    case 'private': toggle('private'); toast(S.settings.private ? 'Mode privat aktif' : 'Mode privat mati'); break;
    case 'sound': toggle('sound'); break;
    case 'haptics': setSetting('haptics', !s.haptics); (await import('./lib/haptics.js')).haptics.setEnabled(S.settings.haptics); sfx('toggle'); render(); break;
    case 'lockresume': toggle('lockOnResume'); break;
    case 'pin':
      if (!s.pin) { await setupPin(); render(); }
      else actionSheet('PIN aplikasi', [
        { icon: 'edit', label: 'Ubah PIN', fn: async () => { if (await verifyPin()) { await setupPin(); render(); } } },
        { icon: 'x', label: 'Matikan PIN', danger: true, fn: async () => { if (await verifyPin()) { setSetting('pin', ''); toast('PIN dimatikan'); render(); } } }
      ]);
      break;
    case 'export': exportBackup(); break;
    case 'send': isNative ? exportBackup({ share: true }) : exportBackup(); break;
    case 'import': importBackup(); break;
    case 'dups': A.scanDuplicates(); break;
    case 'keys': showShortcuts(); break;
    case 'wipe': wipeAll(); break;
    case 'install': showInstallHelp(true); break;
  }
}
export async function showInstallHelp(fromSettings = false) {
  const bip = window.__installPrompt;
  if (bip && !isIOS) {
    bip.prompt();
    const r = await bip.userChoice.catch(() => null);
    if (r?.outcome === 'accepted') { window.__installPrompt = null; toast('Aplikasi dipasang 🎉', { type: 'success' }); }
    return;
  }
  const standalone = isStandalone();
  sfx('open');
  openModal({
    title: standalone ? 'Sudah terpasang ✅' : 'Pasang di Layar Utama',
    body: standalone ? '<p class="msg">Kirana Gallery sudah berjalan sebagai aplikasi dari Layar Utama. Foto kamu tersimpan di perangkat ini.</p>' : `
      <p class="msg" style="margin-bottom:14px">Supaya terasa seperti aplikasi (layar penuh, ikon di Layar Utama, data lebih awet):</p>
      <div class="list">
        <div class="row"><span class="ri">1</span><span class="rt"><b>Buka di Safari</b><small>Di iPhone harus Safari, bukan Chrome/WhatsApp</small></span></div>
        <div class="row"><span class="ri">${icon('share', 'sm')}</span><span class="rt"><b>Ketuk tombol Bagikan</b><small>Ikon kotak dengan panah ke atas di bawah layar</small></span></div>
        <div class="row"><span class="ri">${icon('plus', 'sm')}</span><span class="rt"><b>Pilih “Add to Home Screen”</b><small>“Tambah ke Layar Utama”, lalu ketuk Tambah</small></span></div>
      </div>
      <p class="hint" style="margin-top:12px">Android (Chrome): menu ⋮ → “Instal aplikasi” / “Tambahkan ke layar utama”. Foto tersimpan di perangkat masing-masing — pakai <b>Kirim ke HP lain</b> untuk berbagi semua foto.</p>`,
    actions: [{ label: 'Mengerti', cls: 'primary' }]
  });
  if (!fromSettings) storage.set('installHintShown', true);
}
export function showShortcuts() {
  const rows = [['F', 'Feed'], ['G', 'Galeri'], ['A', 'Album'], ['V', 'Favorit'], ['M', 'Kenangan'], ['R', 'Arsip'], ['T', 'Sampah'], ['L', 'Log'], ['S', 'Statistik'], ['/', 'Cari foto'], ['Esc', 'Tutup / kembali'], ['← →', 'Foto sebelumnya / berikutnya'], ['↑ ↓', 'Geser feed'], ['U', 'Unggah foto'], ['P', 'Mode privat']];
  openModal({ title: 'Pintasan keyboard', body: `<div class="kbd-list">${rows.map(([k, l]) => `<kbd>${k}</kbd><span>${l}</span>`).join('')}</div>`, actions: [{ label: 'OK', cls: 'primary' }] });
}
async function wipeAll() {
  if (!(await confirmDialog('Semua foto, album, anggota, dan log di HP ini akan dihapus permanen. Buat cadangan dulu jika perlu. Lanjutkan?', { title: 'Hapus semua data', okLabel: 'Hapus semua', danger: true }))) return;
  if (S.settings.pin && !(await verifyPin('Masukkan PIN untuk menghapus semua data'))) return;
  for (const st of ['photos', 'blobs', 'albums', 'members', 'logs', 'tombs']) await db.clear(st);
  storage.remove('settings');
  location.reload();
}

// ----------------------------- Views table ---------------------------
const VIEWS = {
  feed: renderFeed, gallery: renderGallery, albums: renderAlbums, album: renderAlbum, favorites: renderFavorites,
  memories: renderMemories, archive: renderArchive, trash: renderTrash, log: renderLog, stats: renderStats, settings: renderSettings
};

// Global click delegation for common data-* buttons
export function bindChrome() {
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-feedmode],[data-go],[data-upload],[data-upfiles],[data-member],[data-more],[data-select],[data-newalbum],[data-back],[data-surprise],[data-lock],[data-sync]');
    if (!t) return;
    if (t.closest('.modal, .sheet')) return;
    sfx('tap');
    if (t.dataset.go) go(t.dataset.go);
    else if (t.hasAttribute('data-upload')) uploadMenu();
    else if (t.hasAttribute('data-member')) memberMenu();
    else if (t.hasAttribute('data-more')) openMore();
    else if (t.hasAttribute('data-select')) { if (S.selecting) exitSelection(); else enterSelection(); }
    else if (t.hasAttribute('data-newalbum')) A.createAlbum();
    else if (t.hasAttribute('data-back')) goBack();
    else if (t.hasAttribute('data-surprise')) surprise();
    else if (t.hasAttribute('data-lock')) lockNow();
    else if (t.hasAttribute('data-sync')) openFamilySync();
    else if (t.hasAttribute('data-feedmode')) feedModeMenu();
    else if (t.hasAttribute('data-upfiles')) startUpload({ fromFiles: true });
  });
  on('change', () => { if (!viewerOpen()) render(); });
  on('member', () => render());
}
export { currentList };
