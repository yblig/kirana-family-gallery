// =====================================================================
// members.js — Members (picker, editor, password) · App lock PIN
// =====================================================================
import {
  S, $, $$, el, esc, icon, uid, openModal, deleteRecords, confirmDialog, toast, sfx, saveMember, db, addLog,
  avatarHTML, hashPass, sha256, setSetting, pickFiles, decodeImage, canvasToBlob, blobToDataURL, native, emit
} from './core.js';

export const EMOJIS = ['👨', '👩', '🧒', '👧', '👦', '👶', '👴', '👵', '🧔', '👱‍♀️', '👩‍🦱', '🧑', '😎', '🥰', '😺', '🐶', '🦊', '🐼', '🐻', '🐯', '🦁', '🐰', '🐨', '🐸', '🌸', '🌻', '⭐', '🌈', '🎈', '⚽', '🎮', '🎨'];
export const COLORS = ['#7c5cff', '#ff5d8f', '#2fd39a', '#ffb547', '#4da6ff', '#ff7a45', '#b45cff', '#14b8a6', '#ef4444', '#64748b'];

export async function ensureDefaultMembers() {
  if (S.members.length) return;
  // Fixed ids so the default profiles on every family phone are the same people after syncing.
  const defs = [['m-ayah', 'Ayah', '👨', '#4da6ff'], ['m-ibu', 'Ibu', '👩', '#ff5d8f'], ['m-anak', 'Anak', '🧒', '#2fd39a']];
  for (let i = 0; i < defs.length; i++) {
    const [id, name, emoji, color] = defs[i];
    if (S.tombs.has(id)) continue;
    await saveMember({ id, name, emoji, color, avatar: '', pass: '', createdAt: i + 1, updatedAt: 0 }, { local: true });
  }
}

export function setCurrentMember(m) {
  S.member = m;
  setSetting('memberId', m ? m.id : '');
  emit('member');
}

// Ask for a member's password. Resolves true if correct (or no password).
export function verifyMemberPassword(m, reason = 'Masukkan password') {
  if (!m.pass) return Promise.resolve(true);
  return new Promise(resolve => {
    let ok = false;
    const md = openModal({
      title: `${m.emoji || ''} ${m.name}`,
      body: `<div style="text-align:center;margin-bottom:14px">${avatarHTML(m, 'lg')}</div>
        <div class="field"><label for="pw">${esc(reason)}</label>
        <input class="input" id="pw" type="password" autocomplete="off" placeholder="Password" /></div>
        <div class="err" id="pwErr"></div>`,
      actions: [{ label: 'Batal' }, { label: 'Masuk', cls: 'primary', fn: () => check() }],
      onClose: () => resolve(ok)
    });
    const inp = $('#pw', md.el);
    setTimeout(() => inp.focus(), 250);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') check().then(r => { if (r !== false) md.close(); }); });
    async function check() {
      const h = await hashPass(m, inp.value);
      if (h === m.pass) { ok = true; sfx('unlock'); return true; }
      sfx('error');
      $('#pwErr', md.el).textContent = 'Password salah, coba lagi.';
      md.el.classList.remove('shake'); void md.el.offsetWidth; md.el.classList.add('shake');
      inp.select();
      return false;
    }
  });
}

// "Siapa yang pakai HP ini?"
export function showMemberPicker({ required = false } = {}) {
  return new Promise(resolve => {
    sfx('open');
    const md = openModal({ noHead: true, dismissable: !required, cls: 'who-modal', body: '', onClose: () => resolve(S.member) });
    const render = () => {
      md.body.innerHTML = `
        <div class="who-hero">
          <div class="logo">${icon('image')}</div>
          <div class="k">KIRANA FAMILY GALLERY</div>
          <h2>Siapa yang pakai HP ini?</h2>
          <p>Pilih profil kamu. Semua foto & aktivitas akan tercatat atas nama profil ini.</p>
        </div>
        <div class="member-cards">
          ${S.members.map(m => `
            <button class="mcard ${S.member?.id === m.id ? 'current' : ''}" data-id="${m.id}">
              <span class="ed" data-edit="${m.id}" role="button" aria-label="Edit">${icon('edit')}</span>
              ${m.pass ? `<span class="lk">${icon('lock')}</span>` : ''}
              ${avatarHTML(m)}<b>${esc(m.name)}</b>
            </button>`).join('')}
          <button class="mcard add" data-add>${`<span class="avatar">${icon('plus')}</span>`}<b>Tambah</b></button>
        </div>
        ${!required ? '' : '<p class="hint" style="text-align:center;margin:10px 0 4px">Profil bisa diubah kapan saja dari Pengaturan.</p>'}`;
      $$('[data-id]', md.body).forEach(b => b.addEventListener('click', async e => {
        if (e.target.closest('[data-edit]')) return;
        const m = S.members.find(x => x.id === b.dataset.id);
        sfx('tap');
        if (!(await verifyMemberPassword(m, `Password untuk ${m.name}`))) return;
        setCurrentMember(m);
        sfx('success');
        toast(`Halo, ${m.name} ${m.emoji || ''}`, { type: 'success' });
        md.close();
      }));
      $$('[data-edit]', md.body).forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation(); sfx('tap');
        const m = S.members.find(x => x.id === b.dataset.edit);
        if (await editMember(m)) render();
      }));
      $('[data-add]', md.body).onclick = async () => { sfx('tap'); if (await editMember(null)) render(); };
    };
    render();
  });
}

// Create (m=null) or edit a member. Requires the password first if set.
export async function editMember(m) {
  if (m && !(await verifyMemberPassword(m, 'Masukkan password untuk mengedit profil'))) return false;
  const isNew = !m;
  const draft = m ? { ...m } : { id: uid(), name: '', emoji: '🙂', color: COLORS[S.members.length % COLORS.length], avatar: '', pass: '', createdAt: Date.now() };
  return new Promise(resolve => {
    let saved = false;
    sfx('open');
    const md = openModal({
      title: isNew ? 'Tambah Anggota' : 'Edit Profil',
      body: `
        <div class="avatar-edit">
          <span id="avPrev"></span>
          <div style="display:flex;flex-direction:column;gap:8px;flex:1">
            <button class="btn sm" id="avPick">${icon('camera', 'sm')} Foto profil</button>
            <button class="btn sm ghost" id="avClear" ${draft.avatar ? '' : 'hidden'}>Hapus foto</button>
          </div>
        </div>
        <div class="field"><label for="mName">Nama</label><input class="input" id="mName" maxlength="30" value="${esc(draft.name)}" placeholder="mis. Ayah, Kak Rani" /></div>
        <div class="field"><label>Emoji</label><div class="emoji-grid" id="emo">${EMOJIS.map(e => `<button data-e="${e}" class="${e === draft.emoji ? 'active' : ''}">${e}</button>`).join('')}</div>
          <input class="input" id="emoIn" maxlength="4" value="${esc(draft.emoji)}" placeholder="atau ketik emoji" style="margin-top:6px" /></div>
        <div class="field"><label>Warna</label><div class="swatches" style="padding:2px 0" id="cols">${COLORS.map(c => `<button class="swatch ${c === draft.color ? 'active' : ''}" style="--c:${c}" data-c="${c}"></button>`).join('')}
          <label class="swatch picker" style="--c:${esc(draft.color)}"><input type="color" id="colIn" value="${esc(draft.color)}"></label></div></div>
        <div class="field"><label for="mPass">${m?.pass ? 'Password baru (kosongkan = tidak berubah)' : 'Password (opsional)'}</label>
          <input class="input" id="mPass" type="password" autocomplete="new-password" placeholder="${m?.pass ? '••••••' : 'Tanpa password'}" />
          ${m?.pass ? `<label style="display:flex;gap:8px;align-items:center;font-weight:650;margin-top:6px"><input type="checkbox" id="mNoPass"> Hapus password</label>` : '<div class="hint">Jika diisi, profil ini butuh password saat dipilih & diedit.</div>'}
        </div>
        <div class="err" id="mErr"></div>`,
      actions: [{ label: 'Batal' }, { label: 'Simpan', cls: 'primary', fn: save }],
      onClose: () => resolve(saved)
    });
    const prev = () => { $('#avPrev', md.el).innerHTML = avatarHTML(draft, 'lg'); $('#avClear', md.el).hidden = !draft.avatar; };
    prev();
    $$('#emo button', md.el).forEach(b => b.onclick = () => {
      draft.emoji = b.dataset.e; $('#emoIn', md.el).value = draft.emoji; sfx('tap');
      $$('#emo button', md.el).forEach(x => x.classList.toggle('active', x === b)); prev();
    });
    $('#emoIn', md.el).oninput = e => { draft.emoji = e.target.value.trim() || '🙂'; prev(); };
    $$('#cols [data-c]', md.el).forEach(b => b.onclick = () => {
      draft.color = b.dataset.c; sfx('tap');
      $$('#cols .swatch', md.el).forEach(x => x.classList.toggle('active', x === b)); prev();
    });
    $('#colIn', md.el).oninput = e => { draft.color = e.target.value; $$('#cols .swatch', md.el).forEach(x => x.classList.remove('active')); prev(); };
    $('#avPick', md.el).onclick = async () => {
      const [f] = await pickFiles('avatarInput', { accept: 'image/*', multiple: false });
      if (!f) return;
      try { draft.avatar = await squareAvatar(f); prev(); }
      catch { toast('Gambar tidak bisa dibaca', { type: 'error' }); }
    };
    $('#avClear', md.el).onclick = () => { draft.avatar = ''; prev(); };
    setTimeout(() => { if (isNew) $('#mName', md.el).focus(); }, 250);

    async function save() {
      const name = $('#mName', md.el).value.trim();
      if (!name) { $('#mErr', md.el).textContent = 'Nama wajib diisi.'; sfx('error'); return false; }
      draft.name = name;
      const pw = $('#mPass', md.el).value;
      if ($('#mNoPass', md.el)?.checked) draft.pass = '';
      else if (pw) draft.pass = await hashPass(draft, pw);
      await saveMember(draft);
      if (S.member?.id === draft.id) S.member = draft;
      await addLog(isNew ? 'member-add' : 'member-edit', isNew ? `menambahkan anggota “${draft.name}”` : `mengedit profil “${draft.name}”`);
      saved = true; sfx('success');
      toast(isNew ? 'Anggota ditambahkan' : 'Profil disimpan', { type: 'success' });
      emit('member');
      return true;
    }
  });
}

export async function deleteMember(m) {
  if (S.members.length <= 1) { toast('Minimal harus ada satu anggota', { type: 'error' }); return false; }
  if (!(await verifyMemberPassword(m, 'Masukkan password untuk menghapus profil'))) return false;
  if (!(await confirmDialog(`Hapus anggota “${m.name}”? Foto yang sudah diunggah tetap ada.`, { title: 'Hapus anggota', okLabel: 'Hapus', danger: true }))) return false;
  await deleteRecords('members', [m.id]);
  await addLog('member-delete', `menghapus anggota “${m.name}”`);
  sfx('delete');
  toast('Anggota dihapus');
  if (S.member?.id === m.id) { S.member = null; setSetting('memberId', ''); await showMemberPicker({ required: true }); }
  emit('member');
  return true;
}

async function squareAvatar(file) {
  const img = await decodeImage(file);
  const s = Math.min(img.width, img.height);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
  return blobToDataURL(await canvasToBlob(c, 'image/jpeg', 0.85));
}

// ----------------------------- App lock PIN --------------------------
const pinHash = pin => sha256('kfg-pin:' + pin);
let lockOpen = false;

function pinPad({ title, sub, onDone, cancellable = false, onCancel }) {
  let pin = '';
  const scr = el(`<div class="lock-screen">
      <div class="logo">${icon('lock', 'xl')}</div>
      <h2>${esc(title)}</h2><p>${esc(sub)}</p>
      <div class="pin-dots">${'<i></i>'.repeat(4)}</div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="key" data-k="${n}">${n}</button>`).join('')}
        <button class="key blank"></button><button class="key" data-k="0">0</button><button class="key fn" data-k="del">${icon('backspace')}</button></div>
      ${cancellable ? '<button class="cancel">Batal</button>' : ''}
    </div>`);
  document.body.appendChild(scr);
  const dots = $$('.pin-dots i', scr);
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const api = {
    el: scr,
    reset(msg) {
      pin = ''; paint();
      if (msg) { $('p', scr).textContent = msg; }
      const d = $('.pin-dots', scr); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
    },
    setText(t, s) { $('h2', scr).textContent = t; $('p', scr).textContent = s; pin = ''; paint(); },
    close() { scr.remove(); document.removeEventListener('keydown', kd, true); unBack(); }
  };
  const press = k => {
    if (k === 'del') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += k;
    sfx('tap'); paint();
    if (pin.length === 4) setTimeout(() => onDone(pin, api), 120);
  };
  $$('[data-k]', scr).forEach(b => b.onclick = () => press(b.dataset.k));
  const kd = e => {
    if (/^\d$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); press('del'); }
    else if (e.key === 'Escape') { e.stopPropagation(); if (cancellable) { api.close(); onCancel && onCancel(); } }
  };
  document.addEventListener('keydown', kd, true);
  const unBack = native.onBack(() => { if (cancellable) { api.close(); onCancel && onCancel(); } return true; });
  if (cancellable) $('.cancel', scr).onclick = () => { api.close(); onCancel && onCancel(); };
  return api;
}

export function lockApp() {
  if (!S.settings.pin || lockOpen) return Promise.resolve();
  lockOpen = true;
  return new Promise(resolve => {
    let tries = 0;
    pinPad({
      title: 'Aplikasi Terkunci', sub: 'Masukkan PIN 4 digit',
      onDone: async (pin, api) => {
        if (await pinHash(pin) === S.settings.pin) { sfx('unlock'); api.close(); lockOpen = false; resolve(); }
        else { tries++; sfx('error'); api.reset(tries >= 3 ? 'PIN salah. Lupa PIN? Hapus data aplikasi di pengaturan Android.' : 'PIN salah, coba lagi'); }
      }
    });
  });
}

export function setupPin() {
  return new Promise(resolve => {
    let first = '';
    pinPad({
      title: 'Buat PIN', sub: 'Masukkan 4 digit PIN baru', cancellable: true, onCancel: () => resolve(false),
      onDone: async (pin, api) => {
        if (!first) { first = pin; api.setText('Ulangi PIN', 'Masukkan PIN yang sama sekali lagi'); return; }
        if (pin !== first) { first = ''; sfx('error'); api.setText('Buat PIN', 'PIN tidak sama. Ulangi dari awal'); api.reset(); return; }
        setSetting('pin', await pinHash(pin));
        api.close(); sfx('success'); toast('PIN aplikasi aktif', { type: 'success' }); resolve(true);
      }
    });
  });
}

export function verifyPin(sub = 'Masukkan PIN saat ini') {
  return new Promise(resolve => {
    pinPad({
      title: 'Konfirmasi PIN', sub, cancellable: true, onCancel: () => resolve(false),
      onDone: async (pin, api) => {
        if (await pinHash(pin) === S.settings.pin) { api.close(); resolve(true); }
        else { sfx('error'); api.reset('PIN salah'); }
      }
    });
  });
}
