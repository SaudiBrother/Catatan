/* ==========================================================================
   CATAT — categories.js
   Everything "Kategori": the quick picker used from the note editor's chip,
   the unified create/edit sheet (name, color incl. custom wheel, icon,
   per-category lock), and the full "Kelola Kategori" screen with
   drag-to-reorder, lock toggles and a 3-dot menu per row.
   ========================================================================== */

import {
  getAllFolders, createFolder, updateFolder, deleteFolder, getAllNotes,
  isFolderLocked, getMasterKey, getSetting, setSetting, reorderFolders,
} from './db.js';
import {
  $, $$, icon, escapeHtml, openSheet, sheetMenu, promptDialog, confirmDialog,
  showToast, makeSortable, hapticTap, FOLDER_COLORS, FOLDER_EMOJI,
} from './ui.js';
import { ensureAuthenticated } from './auth.js';

/* ---------------- Access gate for locked categories ---------------- */
export async function guardCategoryAccess(folderId, folders) {
  if (!isFolderLocked(folders, folderId)) return true;
  if (getMasterKey()) return true;
  return ensureAuthenticated({ reason: 'Kategori ini terkunci. Masukkan PIN untuk membukanya.' });
}

/* ---------------- Quick picker (used from the editor's category chip) ---------------- */
export async function openCategoryPicker(currentFolderId, onSelect) {
  const folders = await getAllFolders();
  const rows = [{ id: null, name: 'Tanpa Kategori', icon: '', color: null }, ...folders];
  const html = `
    <div class="fp-header"><span class="fp-header-title">Pilih Kategori</span></div>
    <div class="cat-picker-list">
      ${rows.map((f) => `
        <button class="cat-picker-row" data-id="${f.id ?? ''}">
          <span class="cat-picker-ic" style="background:${f.color ? f.color + '22' : 'var(--fill-2)'}">${f.icon ? f.icon : icon('category', 15)}</span>
          <span class="cat-picker-name">${escapeHtml(f.name)}${f.locked ? ' 🔒' : ''}</span>
          ${(f.id ?? null) === (currentFolderId ?? null) ? `<span class="cat-picker-check">${icon('check', 18)}</span>` : ''}
        </button>`).join('')}
    </div>
    <button class="btn btn-soft btn-block" id="catPickerNew" style="margin-top:14px">${icon('plus', 16)}<span>Kategori Baru</span></button>
    <button class="btn btn-ghost btn-block" id="catPickerManage" style="margin-top:8px">${icon('category', 16)}<span>Kelola Kategori</span></button>
  `;
  const { el, close } = openSheet(html);
  $$('.cat-picker-row', el).forEach((btn) => btn.onclick = async () => {
    const id = btn.dataset.id || null;
    const folder = folders.find((f) => f.id === id);
    if (folder?.locked && !getMasterKey()) {
      const ok = await ensureAuthenticated({ reason: `"${folder.name}" terkunci. Masukkan PIN untuk memindahkan catatan ke sini.` });
      if (!ok) return;
    }
    close(); onSelect(id);
  });
  $('#catPickerNew', el).onclick = async () => {
    const name = await promptDialog('Nama kategori baru', { title: 'Kategori Baru', placeholder: 'cth. Belanja', okLabel: 'Buat' });
    if (!name || !name.trim()) return;
    const color = FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)];
    const icon2 = FOLDER_EMOJI[Math.floor(Math.random() * FOLDER_EMOJI.length)];
    const folder = await createFolder({ name: name.trim(), color, icon: icon2 });
    close(); onSelect(folder.id);
    showToast(`Kategori "${name.trim()}" dibuat`, { icon: 'category' });
  };
  $('#catPickerManage', el).onclick = () => { close(); location.hash = '#/categories'; };
}

/* ---------------- Unified create/edit sheet ---------------- */
export function openFolderEditorSheet(folder, parentId, ctx) {
  const isEdit = !!folder;
  const initialColor = folder?.color || FOLDER_COLORS[0];
  const initialEmoji = folder?.icon || FOLDER_EMOJI[0];
  const html = `
    <div class="fp-header"><span class="fp-header-title">${isEdit ? 'Edit Kategori' : 'Kategori Baru'}</span></div>
    <input class="field" id="cfName" placeholder="Nama kategori" value="${escapeHtml(folder?.name || '')}" autocomplete="off" style="margin:2px 0 16px">
    <div class="field-label">Warna</div>
    <div class="color-pill-bar" id="cfColors">
      ${FOLDER_COLORS.map((c) => `<span class="color-dot${c === initialColor ? ' active' : ''}" data-fc="${c}" style="background:${c}"></span>`).join('')}
      <label class="color-dot color-dot-custom" aria-label="Warna kustom">
        <input type="color" id="cfColorCustom" value="${/^#[0-9a-f]{6}$/i.test(initialColor) ? initialColor : '#5E5CE6'}">
      </label>
    </div>
    <div class="field-label" style="margin-top:16px">Ikon</div>
    <div class="emoji-grid" id="cfEmoji">
      ${FOLDER_EMOJI.map((e) => `<button class="icon-btn${e === initialEmoji ? ' active' : ''}" data-fe="${e}">${e}</button>`).join('')}
    </div>
    <label class="settings-row" style="margin-top:18px;padding:0" id="cfLockRow">
      <span class="si" style="background:#0A84FF22;color:#0A84FF">${icon('lock', 17)}</span>
      <span style="flex:1">Kunci kategori ini</span>
      <div class="toggle${folder?.locked ? ' on' : ''}" id="cfLockSwitch"><div class="knob"></div></div>
    </label>
    <button class="btn btn-primary btn-block" id="cfSave" style="margin-top:20px">${isEdit ? 'Simpan Perubahan' : 'Buat Kategori'}</button>
  `;
  const { el, close } = openSheet(html);

  let selColor = initialColor, selEmoji = initialEmoji, wantLock = !!folder?.locked;

  $$('[data-fc]', el).forEach((s) => s.onclick = () => {
    selColor = s.dataset.fc;
    $$('[data-fc]', el).forEach((x) => x.classList.remove('active'));
    s.classList.add('active');
  });
  $('#cfColorCustom', el).oninput = (e) => {
    selColor = e.target.value;
    $$('[data-fc]', el).forEach((x) => x.classList.remove('active'));
  };
  $$('[data-fe]', el).forEach((b) => b.onclick = () => {
    selEmoji = b.dataset.fe;
    $$('[data-fe]', el).forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });

  const lockSwitch = $('#cfLockSwitch', el);
  $('#cfLockRow', el).onclick = async () => {
    if (!wantLock) {
      const ok = await ensureAuthenticated({ reason: 'Buat atau masukkan PIN untuk mengunci kategori ini' });
      if (!ok) return;
    }
    wantLock = !wantLock;
    lockSwitch.classList.toggle('on', wantLock);
    hapticTap(8);
  };

  setTimeout(() => $('#cfName', el).focus(), 280);
  $('#cfSave', el).onclick = async () => {
    const name = $('#cfName', el).value.trim();
    if (!name) { showToast('Nama kategori tidak boleh kosong'); return; }
    if (isEdit) await updateFolder(folder.id, { name, color: selColor, icon: selEmoji, locked: wantLock });
    else await createFolder({ name, parentId, color: selColor, icon: selEmoji, locked: wantLock });
    close();
    ctx?.rerender?.();
    showToast(isEdit ? 'Kategori diperbarui' : `Kategori "${name}" dibuat`, { icon: 'category' });
  };
}

/* ---------------- Full "Kelola Kategori" screen ---------------- */
function catRowHTML(f, count) {
  return `<div class="cat-mgr-row" data-id="${f.id}">
    <span class="cat-mgr-handle" contenteditable="false">${icon('grip', 15)}</span>
    <span class="cat-mgr-ic" style="background:${f.color || '#5E5CE6'}22">${f.icon || '📁'}</span>
    <span class="cat-mgr-name">${escapeHtml(f.name)}</span>
    <span class="cat-mgr-count">(${count})</span>
    <button class="icon-btn plain cat-mgr-lock" data-lock="${f.id}" aria-label="${f.locked ? 'Buka kunci kategori' : 'Kunci kategori'}">${icon(f.locked ? 'lock' : 'unlock', 18)}</button>
    <button class="icon-btn plain cat-mgr-menu" data-menu="${f.id}" aria-label="Menu kategori">${icon('moreVert', 18)}</button>
  </div>`;
}

export async function renderCategoryManager(container, params, ctx) {
  const [folders, allNotes] = await Promise.all([getAllFolders(), getAllNotes()]);
  const active = allNotes.filter((n) => !n.deletedAt);
  const countFor = (fid) => active.filter((n) => n.folderId === fid).length;
  const totalCount = active.length;
  const uncatCount = countFor(null);
  const bannerDismissed = await getSetting('catManagerBannerDismissed', false);

  container.innerHTML = `
    <div class="topbar">
      <button class="icon-btn plain" id="btnCatBack">${icon('chevronLeft', 22)}</button>
      <span class="tb-title">Kelola Kategori</span>
      <span style="width:40px"></span>
    </div>
    <main style="flex:1;overflow-y:auto;padding-bottom:calc(110px + var(--safe-b))">
    <div class="view-pad stagger">
      ${bannerDismissed ? '' : `
      <div class="info-banner" id="catBanner">
        ${icon('info', 18)}
        <p>Anda dapat mengurutkan ulang, mengunci, mengganti nama, atau menghapus kategori di sini.</p>
        <button class="icon-btn plain" id="catBannerClose" aria-label="Tutup">${icon('close', 15)}</button>
      </div>`}

      <div class="cat-manager-card">
        <button class="cat-mgr-row cat-mgr-row-fixed" id="catNavAll">
          <span class="cat-mgr-name">Semua</span>
          <span class="cat-mgr-count">(${totalCount})</span>
        </button>
        <div class="cat-mgr-sep"></div>
        <button class="cat-mgr-row cat-mgr-row-fixed" id="catNavUncat">
          <span class="cat-mgr-name">Tanpa Kategori</span>
          <span class="cat-mgr-count">(${uncatCount})</span>
        </button>
      </div>

      <div class="cat-manager-card" id="catList" style="margin-top:16px">
        ${folders.length ? folders.map((f) => catRowHTML(f, countFor(f.id))).join('') :
          `<div class="empty-state" style="padding:28px 12px">
            <div class="e-icon">🗂️</div>
            <div class="e-title">Belum ada kategori</div>
            <p>Ketuk "Tambah Kategori" di bawah</p>
          </div>`}
      </div>
    </div>
    </main>
    <div class="cat-mgr-footer">
      <button class="btn btn-primary btn-block" id="btnAddCategory">${icon('plus', 18)}<span>Tambah Kategori</span></button>
    </div>
  `;

  $('#btnCatBack', container).onclick = () => ctx.back();
  const banner = $('#catBanner', container);
  if (banner) $('#catBannerClose', container).onclick = async () => { await setSetting('catManagerBannerDismissed', true); banner.remove(); };
  $('#catNavAll', container).onclick = () => ctx.navigate('#/browse');
  $('#catNavUncat', container).onclick = () => ctx.navigate('#/browse');
  $('#btnAddCategory', container).onclick = () => openFolderEditorSheet(null, null, ctx);

  const listEl = $('#catList', container);
  if (folders.length) {
    makeSortable(listEl, {
      handleSelector: '.cat-mgr-handle',
      itemSelector: '.cat-mgr-row[data-id]',
      onReorder: async (items) => {
        await reorderFolders(items.map((it) => it.dataset.id));
      },
    });
  }

  $$('[data-lock]', container).forEach((btn) => btn.onclick = async (e) => {
    e.stopPropagation();
    const id = btn.dataset.lock;
    const f = folders.find((x) => x.id === id);
    if (!f) return;
    if (!f.locked) {
      const ok = await ensureAuthenticated({ reason: 'Buat atau masukkan PIN untuk mengunci kategori ini' });
      if (!ok) return;
    }
    await updateFolder(id, { locked: !f.locked });
    hapticTap(8);
    ctx.rerender();
  });

  $$('[data-menu]', container).forEach((btn) => btn.onclick = async (e) => {
    e.stopPropagation();
    const id = btn.dataset.menu;
    const f = folders.find((x) => x.id === id);
    if (!f) return;
    const choice = await sheetMenu([
      { value: 'edit', icon: 'pencil', label: 'Ganti nama, warna & ikon' },
      { value: 'delete', icon: 'trash', label: 'Hapus kategori', danger: true },
    ], { title: f.name });
    if (choice === 'edit') openFolderEditorSheet(f, f.parentId, ctx);
    if (choice === 'delete') {
      const ok = await confirmDialog(`Catatan dalam "${f.name}" akan dipindah ke Tanpa Kategori.`, { title: 'Hapus kategori?', okLabel: 'Hapus', danger: true });
      if (ok) { await deleteFolder(id); ctx.rerender(); showToast('Kategori dihapus', { icon: 'trash' }); }
    }
  });

  $$('.cat-mgr-row[data-id]', container).forEach((row) => row.addEventListener('click', (e) => {
    if (e.target.closest('[data-lock],[data-menu],.cat-mgr-handle')) return;
    ctx.navigate('#/browse/' + row.dataset.id);
  }));
}
