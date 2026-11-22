// =====================================================================
// sync.js — Family sync between phones, peer-to-peer (WebRTC).
// No server, no account: phones that share the same "kode keluarga" find
// each other through public relays (encrypted with the code) and then
// exchange photos directly. Every phone keeps a full copy in IndexedDB.
// Conflicts: last write wins per record (updatedAt); permanent deletes
// travel as tombstones.
// =====================================================================
import { joinRoom } from 'trystero';
import {
  S, db, emit, hooks, savePhotos, saveAlbum, saveMember, removePhotosForever, deleteRecords, getBlob, photoById,
  decodeImage, makeThumb, sha256, setSetting, debounce, toast
} from './core.js';

const APP_ID = 'yblig.kirana-family-gallery.v1';
const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const sync = { status: 'off', peers: 0, receiving: 0, queued: 0, sent: 0, lastSync: 0 };
let room = null, A = null;
const peers = new Set();
const queue = [];          // [{id, peerId}]
const missing = new Set(); // photo ids no connected peer could deliver yet
let working = false;

export function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  const c = Array.from(r, b => ALPH[b % ALPH.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
export const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
export const validCode = c => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normCode(c));
export const familyLink = () => `${location.origin}${location.pathname}#k=${S.settings.familyCode}`;

const notify = debounce(() => emit('sync'), 80);
const changed = debounce(() => { emit('change'); emit('member'); }, 400);
function setStatus(st) { sync.status = st; sync.peers = peers.size; notify(); }

// ---------------------------------------------------------------- room
export async function startSync() {
  await stopSync();
  if (!S.settings.familyCode || !S.settings.syncOn) { setStatus('off'); return; }
  if (!window.RTCPeerConnection) { setStatus('unsupported'); return; }
  try {
    const roomId = (await sha256('kfg-room:' + S.settings.familyCode)).slice(0, 24);
    room = joinRoom({ appId: APP_ID, password: 'kfg:' + S.settings.familyCode }, roomId);
  } catch (e) { console.warn('sync join', e); setStatus('error'); return; }
  A = {
    manifest: room.makeAction('manifest'),
    meta: room.makeAction('meta'),
    blob: room.makeAction('blob', { kind: 'request' })
  };
  setStatus('searching');
  room.onPeerJoin(({ peerId }) => {
    peers.add(peerId); setStatus('connected');
    A.manifest.send(manifest(), { target: peerId }).catch(() => {});
  });
  room.onPeerLeave(({ peerId }) => {
    peers.delete(peerId);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].peerId === peerId) { missing.add(queue[i].id); queue.splice(i, 1); }
    setStatus(peers.size ? 'connected' : 'searching');
  });
  room.onError?.(e => console.warn('sync room', e));
  A.manifest.onMessage((m, { peerId }) => onManifest(m, peerId).catch(e => console.warn('manifest', e)));
  A.meta.onMessage((m, { peerId }) => applyMeta(m, peerId).catch(e => console.warn('meta', e)));
  A.blob.onRequest(async req => {
    const b = req && req.id ? await getBlob(req.id) : null;
    if (b) { sync.sent++; notify(); }
    return b || new Uint8Array(0);
  });
}
export async function stopSync() {
  const r = room; room = null; A = null;
  peers.clear(); queue.length = 0;
  if (r) { try { await r.leave(); } catch { /* ignore */ } }
  setStatus('off');
}
export async function setFamilyCode(code) {
  setSetting('familyCode', normCode(code));
  updateUrl();
  await startSync();
}
// Keep the code in the address so "Add to Home Screen" on iPhone keeps it.
export function updateUrl() {
  if (!S.settings.familyCode) return;
  const want = '#k=' + S.settings.familyCode;
  if (location.hash !== want) history.replaceState(history.state, '', location.pathname + location.search + want);
}
export function codeFromUrl() {
  const m = (location.hash + location.search).match(/[#?&]k=([A-Za-z0-9-]{8,9})/);
  return m && validCode(m[1]) ? normCode(m[1]) : '';
}

// ----------------------------------------------------------- protocol
const strip = p => { const { pending, viewedAt, ...rest } = p; return rest; };
function manifest() {
  const photos = {};
  S.photos.forEach(p => { photos[p.id] = [p.updatedAt || 0, 1]; });
  S.pending.forEach(p => { photos[p.id] = [p.updatedAt || 0, 0]; });
  return {
    photos,
    albums: Object.fromEntries(S.albums.map(a => [a.id, a.updatedAt || 0])),
    members: Object.fromEntries(S.members.map(m => [m.id, m.updatedAt || 0])),
    logs: S.logs.map(l => l.id),
    tombs: Object.fromEntries(S.tombs)
  };
}
async function sendMeta(delta, target) {
  if (!A || !peers.size) return;
  const opts = target ? { target } : undefined;
  // batch big payloads so no single message gets huge
  const keys = ['photos', 'albums', 'members', 'logs'];
  const size = { photos: 150, albums: 200, members: 50, logs: 400 };
  const tombs = delta.tombs && Object.keys(delta.tombs).length ? delta.tombs : null;
  if (tombs) await A.meta.send({ tombs }, opts).catch(() => {});
  for (const k of keys) {
    const arr = delta[k] || [];
    for (let i = 0; i < arr.length; i += size[k]) await A.meta.send({ [k]: arr.slice(i, i + size[k]).map(strip) }, opts).catch(() => {});
  }
}
hooks.local = delta => { if (A && peers.size) sendMeta(delta); };

async function onManifest(m, peerId) {
  const tombsOut = {};
  S.tombs.forEach((ts, id) => { if (!m.tombs?.[id] || m.tombs[id] < ts) tombsOut[id] = ts; });
  const newer = (mine, theirs) => theirs == null || (mine || 0) > theirs;
  const out = {
    tombs: tombsOut,
    photos: [...S.photos, ...S.pending.values()].filter(p => newer(p.updatedAt, m.photos?.[p.id]?.[0])),
    albums: S.albums.filter(a => newer(a.updatedAt, m.albums?.[a.id])),
    members: S.members.filter(x => newer(x.updatedAt, m.members?.[x.id])),
    logs: (() => { const have = new Set(m.logs || []); return S.logs.filter(l => !have.has(l.id)); })()
  };
  await sendMeta(out, peerId);
  // Ask this peer for images we're still missing.
  Object.entries(m.photos || {}).forEach(([id, [, has]]) => { if (has && S.pending.has(id)) enqueue(id, peerId); });
  sync.lastSync = Date.now(); notify();
}

async function applyMeta(m, peerId) {
  let touched = false;
  for (const [id, ts] of Object.entries(m.tombs || {})) {
    if ((S.tombs.get(id) || 0) >= ts) continue;
    S.tombs.set(id, ts); await db.put('tombs', { id, ts });
    const p = photoById(id) || S.pending.get(id);
    if (p && (p.updatedAt || 0) <= ts) { await removePhotosForever([id], { remote: true }); touched = true; }
    for (const store of ['albums', 'members', 'logs']) {
      const rec = S[store].find(x => x.id === id);
      if (rec && (rec.updatedAt || 0) <= ts) { await deleteRecords(store, [id], { remote: true }); touched = true; }
    }
  }
  const dead = rec => (S.tombs.get(rec.id) || 0) >= (rec.updatedAt || 0) && S.tombs.has(rec.id);
  for (const rec of m.photos || []) {
    if (!rec?.id || dead(rec)) continue;
    const local = photoById(rec.id) || S.pending.get(rec.id);
    if (local && (local.updatedAt || 0) >= (rec.updatedAt || 0)) { if (S.pending.has(rec.id)) enqueue(rec.id, peerId); continue; }
    const merged = { ...rec, viewedAt: local?.viewedAt ?? null };
    if (photoById(rec.id)) { await savePhotos(merged, { remote: true }); }
    else {
      merged.pending = true;
      await db.put('photos', merged);
      S.pending.set(rec.id, merged);
      enqueue(rec.id, peerId);
    }
    touched = true;
  }
  for (const [store, save] of [['albums', saveAlbum], ['members', saveMember]]) {
    for (const rec of m[store] || []) {
      if (!rec?.id || dead(rec)) continue;
      const local = S[store].find(x => x.id === rec.id);
      if (local && (local.updatedAt || 0) >= (rec.updatedAt || 0)) continue;
      await save(rec, { remote: true });
      if (store === 'members' && S.member?.id === rec.id) S.member = rec;
      touched = true;
    }
  }
  const newLogs = (m.logs || []).filter(l => l?.id && !S.tombs.has(l.id) && !S.logs.some(x => x.id === l.id));
  if (newLogs.length) {
    await db.putMany('logs', newLogs);
    S.logs.push(...newLogs); S.logs.sort((a, b) => b.ts - a.ts);
    touched = true;
  }
  if (touched) { sync.lastSync = Date.now(); changed(); notify(); }
}

// ------------------------------------------------------- image transfer
function enqueue(id, peerId) {
  if (queue.some(q => q.id === id)) return;
  missing.delete(id);
  queue.push({ id, peerId });
  sync.queued = queue.length; notify();
  work();
}
async function work() {
  if (working) return;
  working = true;
  while (queue.length && A) {
    const { id, peerId } = queue[0];
    const rec = S.pending.get(id);
    if (!rec || !peers.has(peerId)) { queue.shift(); if (rec) missing.add(id); continue; }
    sync.receiving = 1; sync.queued = queue.length; notify();
    try {
      const res = await A.blob.request({ id }, { target: peerId, timeoutMs: 180000 });
      const blob = res instanceof Blob ? res : (res && (res.byteLength || res.size)) ? new Blob([res], { type: rec.type || 'image/jpeg' }) : null;
      if (blob && blob.size) {
        const typed = blob.type ? blob : new Blob([blob], { type: rec.type || 'image/jpeg' });
        let thumb = typed;
        try { const img = await decodeImage(typed); thumb = await makeThumb(img, 500, 0.82); img.close?.(); } catch { /* keep original as thumb */ }
        if (S.pending.has(id)) {
          await db.put('blobs', { id, blob: typed, thumb });
          const { pending, ...meta } = S.pending.get(id);
          await savePhotos(meta, { remote: true });
          changed();
        }
      } else missing.add(id);
    } catch (e) { console.warn('blob fetch', id, e); missing.add(id); }
    queue.shift();
  }
  working = false;
  sync.receiving = 0; sync.queued = 0; notify();
  if (missing.size && peers.size) toastOnce();
}
let toasted = 0;
function toastOnce() { if (Date.now() - toasted > 60000) { toasted = Date.now(); toast(`${S.pending.size} foto keluarga masih menunggu HP pengirimnya online`); } }

export function syncSummary() {
  const n = S.pending.size;
  if (sync.status === 'off') return S.settings.familyCode ? 'Sinkron dimatikan' : 'Belum terhubung ke keluarga';
  if (sync.status === 'unsupported') return 'Browser ini tidak mendukung sinkron';
  if (sync.status === 'error') return 'Gagal menyambung — coba lagi nanti';
  if (sync.receiving || sync.queued) return `Menerima foto… (${n} tersisa)`;
  if (sync.status === 'connected') return `Tersambung dengan ${sync.peers} HP keluarga${n ? ` · ${n} foto menunggu` : ' · semua sudah sinkron'}`;
  return `Mencari HP keluarga yang sedang online…${n ? ` · ${n} foto menunggu` : ''}`;
}
