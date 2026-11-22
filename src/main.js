import './polyfills.js';
// =====================================================================
// main.js — Init · keyboard shortcuts · back handling · app lock · PWA
// =====================================================================
import {
  S, $, db, loadAll, loadSettings, initAudio, storage, native, haptics, isNative, isIOS, isStandalone, memberById, inExternal, toast, overlayOpen
} from './core.js';
import { render, bindChrome, go, goBack, applyTheme, autoPurge, focusSearch, feedScroll, showShortcuts, showInstallHelp } from './views.js';
import { ensureDefaultMembers, showMemberPicker, lockApp } from './members.js';
import { startUpload, uploadFiles } from './io.js';
import { viewerOpen } from './viewer.js';
import { startSync, setFamilyCode, newCode, codeFromUrl, updateUrl, resyncNow } from './sync.js';
import { openFamilySync, askJoinCode } from './views.js';
import { confirmDialog, openModal, icon, on } from './core.js';
import { setSetting } from './core.js';

async function init() {
  await storage.init();
  loadSettings();
  haptics.setEnabled(S.settings.haptics);
  applyTheme();
  await native.init();

  // Lowest-priority back handler: navigate within the app.
  native.onBack(() => goBack());
  if (!isNative) {
    // Browser/PWA back button (Android) → close overlays / go back inside the app.
    history.replaceState({ kfg: 0 }, '');
    history.pushState({ kfg: 1 }, '');
    window.addEventListener('popstate', () => { if (native.tryBack()) history.pushState({ kfg: 1 }, ''); });
  }

  try {
    await db.open();
    await loadAll();
  } catch (e) {
    console.error(e);
    document.getElementById('main').innerHTML = `<div class="empty"><h3>Penyimpanan tidak tersedia</h3><p>Browser ini memblokir penyimpanan lokal (mode privat/incognito?). Buka di Safari/Chrome biasa.</p></div>`;
    return;
  }
  await autoPurge();
  await ensureDefaultMembers();
  S.member = memberById(S.settings.memberId) || null;

  bindChrome();
  bindKeys();
  bindDrop();
  render({ resetScroll: true });
  initAudio().catch(e => console.warn('audio', e));
  native.hideSplash();

  if (S.settings.pin) await lockApp();
  if (!S.member) await showMemberPicker({ required: true });
  const returning = S.settings.syncIntro;
  await setupFamily();
  if (returning && !isNative && isIOS && !isStandalone() && !storage.get('installHintShown', false)) setTimeout(() => showInstallHelp(), 600);

  // App lock when returning after 30 s in the background.
  let hiddenAt = 0;
  native.onPause(() => { hiddenAt = Date.now(); });
  native.onResume(() => {
    // iPhone kills network connections in the background: reconnect on return.
    if (hiddenAt && Date.now() - hiddenAt > 5000) startSync();
    if (S.settings.pin && S.settings.lockOnResume && !inExternal() && hiddenAt && Date.now() - hiddenAt > 30000) lockApp();
    hiddenAt = 0;
  });

  window.addEventListener('online', () => startSync());
  // Apps added to the home screen stay open for days: check for a newer version when they come back.
  const checkUpdate = async () => {
    if (location.protocol !== 'https:') return;
    try {
      const r = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      const v = await r.json();
      if (v.build && v.build !== __BUILD_ID__ && !document.querySelector('.backdrop, .viewer, .slideshow')) {
        toast(`Versi baru tersedia (${v.version})`, { duration: 15000, action: { label: 'Perbarui', fn: () => location.reload() } });
      }
    } catch { /* offline */ }
  };
  native.onResume(checkUpdate);
  setTimeout(checkUpdate, 8000);
  on('needMember', () => { toast('Profil yang kamu pakai dihapus oleh keluarga. Pilih profil lagi.'); showMemberPicker({ required: true }); });
  if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('sw', e));
  }
  try { navigator.storage?.persist?.(); } catch { /* ignore */ }
  window.__kfg = { S, go, render };
}

function bindKeys() {
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if (typing && !document.querySelector('.backdrop')) { e.target.blur(); return; }
      e.preventDefault();
      native.tryBack();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (overlayOpen() || viewerOpen()) return;
    const k = e.key.toLowerCase();
    const map = { f: 'feed', g: 'gallery', a: 'albums', v: 'favorites', m: 'memories', r: 'archive', t: 'trash', l: 'log', s: 'stats', ',': 'settings' };
    if (map[k]) { e.preventDefault(); go(map[k]); }
    else if (k === '/') { e.preventDefault(); focusSearch(); }
    else if (k === 'u') { e.preventDefault(); startUpload(); }
    else if (k === 'p') { e.preventDefault(); setSetting('private', !S.settings.private); render(); toast(S.settings.private ? 'Mode privat aktif' : 'Mode privat mati'); }
    else if (k === '?') { e.preventDefault(); showShortcuts(); }
    else if (S.view === 'feed' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); feedScroll(e.key === 'ArrowDown' ? 1 : -1); }
  });
}

// Desktop: drag photos onto the window to upload them.
function bindDrop() {
  window.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!files.length) return;
    e.preventDefault();
    uploadFiles(files, { albumId: S.view === 'album' ? S.param : null });
  });
}

// Family code: from an invite link (#k=CODE), or a fresh one for a new family.
async function setupFamily() {
  const fromUrl = codeFromUrl();
  const cur = S.settings.familyCode;
  if (fromUrl && fromUrl !== cur) {
    const fresh = !cur || S.photos.length === 0;
    if (fresh || await confirmDialog(`Gabung ke keluarga dengan kode ${fromUrl}? Foto di HP ini akan ikut dibagikan ke keluarga tersebut.`, { title: 'Gabung keluarga', okLabel: 'Gabung' })) {
      await setFamilyCode(fromUrl);
      setSetting('syncIntro', true);
      toast('Tergabung ke keluarga — foto akan masuk saat HP keluarga online 👨‍👩‍👧', { type: 'success', duration: 4500 });
      return;
    }
  }
  if (!S.settings.familyCode) {
    // Ask instead of silently creating a code, so a second phone doesn't start its own family.
    const choice = await new Promise(resolve => {
      let v = 'new';
      openModal({
        title: 'Sambungkan HP keluarga 👨‍👩‍👧', dismissable: false,
        body: `<p class="msg">Apakah sudah ada anggota keluarga yang memakai Kirana Gallery?</p>
          <p class="hint" style="margin-top:8px">Kalau sudah, minta <b>kode keluarga</b> atau link dari HP mereka (Lainnya → Sinkron) supaya foto & profil kalian tersambung.</p>`,
        actions: [{ label: 'Saya yang pertama', fn: () => { v = 'new'; } }, { label: 'Punya kode', cls: 'primary', fn: () => { v = 'join'; } }],
        onClose: () => resolve(v)
      });
    });
    if (choice === 'join' && await askJoinCode()) return;
    setSetting('familyCode', newCode());
    setSetting('syncIntro', true);
    updateUrl();
    await startSync();
    setTimeout(openFamilySync, 300);
    return;
  }
  updateUrl();
  await startSync();
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; });
window.addEventListener('unhandledrejection', e => console.warn('unhandled', e.reason));
init();
