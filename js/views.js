/* ==========================================================================
   CATAT — views.js
   All screen/view renderers. Each export is async (container, params, ctx).
   ctx = { navigate, back, rerender }.
   ========================================================================== */

import {
  getAllNotes, getAllFolders, getFavoriteNotes, getRecentNotes, getTodayReminders,
  computeStats, getStreak, getBadges, getAllActivity, getTodayActivity, getTimelineForNote,
  createNote, deleteFolder, searchNotes, extractChecklist,
  getAllReminders, deleteReminder, getSetting, setSetting, disableLock, setupLock,
  setupFingerprint, isWebAuthnAvailable, exportAllData, importAllData, countWords,
  folderPath, folderDepth, extractWikiLinks, findNoteByTitle, getNotesByFolder,
  _dbAll, deleteNote, toggleFavorite, updateNote, getActiveNotes, getArchivedNotes,
  getTrashedNotes, togglePin, toggleArchive, restoreNote, permanentlyDeleteNote,
  emptyTrash, duplicateNote, isFolderLocked, getMasterKey,
} from './db.js';

import {
  $, $$, icon, escapeHtml, fmtRelative, fmtBytes, openSheet, sheetMenu,
  promptDialog, promptPin, confirmDialog, showToast,
  installCardHTML, wireInstallCard, updateThemeColorMeta, canShowInstallCard,
  wireSwipeRows, hapticTap,
} from './ui.js';
import { openFolderEditorSheet, guardCategoryAccess } from './categories.js';
import { ensureAuthenticated } from './auth.js';

/* ── helpers ── */
const THEMES = ['light', 'dark', 'amoled', 'cyberpunk', 'paper', 'forest', 'anime', 'minimal'];
const THEME_LABELS = { light: 'Light', dark: 'Dark', amoled: 'AMOLED', cyberpunk: 'Cyberpunk', paper: 'Paper', forest: 'Forest', anime: 'Anime', minimal: 'Minimal' };
const THEME_ICONS  = { light: '☀️', dark: '🌙', amoled: '⚫', cyberpunk: '🌆', paper: '📜', forest: '🌲', anime: '🌸', minimal: '◽' };
const COLOR_DOTS = ['#5E5CE6','#FF6FB5','#FF9F0A','#34C759','#0A84FF','#FF453A','#AD6A2C','#30D158'];
const NOTE_COLORS = [...COLOR_DOTS, null];
const THEME_BG_MAP = {
  light:'#F2F2F7', dark:'#131316', amoled:'#000000', cyberpunk:'#0A0414',
  paper:'#F3EBDA', forest:'#0E1812', anime:'#FFF3F8', minimal:'#FAFAFA',
};

function noteColorDot(note) {
  return `<span style="width:9px;height:9px;border-radius:50%;background:${note.color || 'var(--accent)'};flex-shrink:0;display:inline-block;margin-top:5px"></span>`;
}
function checklistBadge(content) {
  const cl = extractChecklist(content);
  if (!cl.length) return '';
  const done = cl.filter(c => c.done).length;
  return `<span class="check-pill">${done}/${cl.length}</span>`;
}
function noteRow(note, ctx, context = 'normal') {
  const locked = note._locked || note.locked;
  const snippet = locked ? 'Konten tersembunyi' : (note.content || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 64);
  const actionsHTML = context === 'archive'
    ? `<button class="swipe-act" data-swipe-act="unarchive" style="background:var(--accent)" aria-label="Keluarkan dari arsip">${icon('archiveRestore', 18)}</button>
       <button class="swipe-act" data-swipe-act="delete" style="background:var(--danger)" aria-label="Hapus">${icon('trash', 18)}</button>`
    : `<button class="swipe-act" data-swipe-act="pin" style="background:var(--warning)" aria-label="Sematkan">${icon(note.pinned ? 'pinOff' : 'pin', 18)}</button>
       <button class="swipe-act" data-swipe-act="archive" style="background:var(--accent)" aria-label="Arsipkan">${icon('archive', 18)}</button>
       <button class="swipe-act" data-swipe-act="delete" style="background:var(--danger)" aria-label="Hapus">${icon('trash', 18)}</button>`;
  return `<div class="swipe-row" data-note-id="${note.id}">
    <div class="swipe-actions-bg">${actionsHTML}</div>
    <button class="note-row swipe-content" data-note-id="${note.id}">
      <span class="dot" style="background:${note.color || 'var(--accent)'}"></span>
      <div class="body">
        <div class="title-line">${note.pinned ? icon('pin', 12) : ''}${locked ? icon('lock', 12) : ''}${note.favorite ? icon('star', 13) : ''}<span class="truncate">${escapeHtml(locked ? (note.title || 'Catatan terkunci') : (note.title || 'Tanpa judul'))}</span></div>
        ${snippet ? `<div class="snippet truncate">${escapeHtml(snippet)}</div>` : ''}
        <div class="meta">${fmtRelative(note.updatedAt)}${(note.tags || []).length ? ' · #' + escapeHtml(note.tags[0]) : ''}</div>
      </div>
      ${checklistBadge(note.content)}
      <span class="chev">${icon('chevronRight', 17)}</span>
    </button>
  </div>`;
}
function wireNoteRows(container, ctx, context = 'normal') {
  $$('.swipe-content[data-note-id]', container).forEach(el => {
    el.onclick = () => ctx.navigate('#/note/' + el.dataset.noteId);
    let pressTimer;
    el.addEventListener('pointerdown', () => { pressTimer = setTimeout(() => openNoteContextMenu(el.dataset.noteId, ctx), 480); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => clearTimeout(pressTimer)));
  });
  // Non-swipeable note cards elsewhere on the page (e.g. the Favorites carousel)
  $$('[data-note-id]', container).forEach(el => {
    if (el.closest('.swipe-row')) return; // already wired above
    el.onclick = () => ctx.navigate('#/note/' + el.dataset.noteId);
  });
  wireSwipeRows(container, async (noteId, action) => {
    if (!noteId) return;
    if (action === 'pin') { await togglePin(noteId); hapticTap(8); ctx.rerender(); }
    else if (action === 'archive' || action === 'unarchive') { await toggleArchive(noteId); showToast(action === 'archive' ? 'Diarsipkan' : 'Dikeluarkan dari arsip', { icon: 'archive' }); ctx.rerender(); }
    else if (action === 'delete') { await deleteNote(noteId); showToast('Dipindah ke Sampah', { icon: 'trash' }); ctx.rerender(); }
  });
}
async function openNoteContextMenu(noteId, ctx) {
  hapticTap(10);
  const all = await getAllNotes();
  const note = all.find(n => n.id === noteId);
  if (!note) return;
  const choice = await sheetMenu([
    { value: 'pin', icon: note.pinned ? 'pinOff' : 'pin', label: note.pinned ? 'Lepas Sematan' : 'Sematkan' },
    { value: 'fav', icon: 'star', label: note.favorite ? 'Hapus dari Favorit' : 'Tambah ke Favorit' },
    { value: 'duplicate', icon: 'copy', label: 'Duplikat' },
    { value: 'archive', icon: note.archived ? 'archiveRestore' : 'archive', label: note.archived ? 'Keluarkan dari Arsip' : 'Arsipkan' },
    { value: 'delete', icon: 'trash', label: 'Hapus', danger: true },
  ], { title: note.title || 'Tanpa judul' });
  if (choice === 'pin') { await togglePin(noteId); ctx.rerender(); }
  else if (choice === 'fav') { await toggleFavorite(noteId); ctx.rerender(); }
  else if (choice === 'duplicate') { const copy = await duplicateNote(noteId); showToast('Catatan diduplikat', { icon: 'copy' }); ctx.navigate('#/note/' + copy.id); }
  else if (choice === 'archive') { await toggleArchive(noteId); ctx.rerender(); }
  else if (choice === 'delete') {
    const ok = await confirmDialog('Catatan akan dipindah ke Sampah selama 30 hari.', { title: 'Hapus catatan?', okLabel: 'Hapus', danger: true });
    if (ok) { await deleteNote(noteId); showToast('Dipindah ke Sampah', { icon: 'trash' }); ctx.rerender(); }
  }
}

/* =====================================================================
   1. DASHBOARD
   ===================================================================== */
export async function renderDashboard(container, params, ctx) {
  const [recentRaw, favs, allNotes, todayRem, stats, streak] = await Promise.all([
    getRecentNotes(8), getFavoriteNotes(), getActiveNotes(), getTodayReminders(),
    computeStats(), getStreak(),
  ]);
  const pinned = allNotes.filter(n => n.pinned).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const recent = recentRaw.filter(n => !n.pinned).slice(0, 6);
  const pendingChecklist = allNotes.flatMap(n => extractChecklist(n.content).filter(c => !c.done).slice(0, 2));
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

  container.innerHTML = `
    <div class="topbar topbar-large" style="flex-direction:column;align-items:stretch;gap:0;padding-bottom:0">
      <div style="display:flex;align-items:center;gap:10px;padding:calc(var(--safe-t) + 6px) var(--space-4) 0">
        <span class="tb-title">Catat</span>
        ${streak.current >= 2 ? `<span class="streak-flame">${icon('flame',14)} ${streak.current} hari</span>` : ''}
        <button class="icon-btn plain" id="searchTopBtn">${icon('search', 20)}</button>
      </div>
      <div class="tb-large-title">${today}</div>
    </div>
    <main id="view" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:calc(86px + var(--safe-b))">
    <div class="view-pad stagger">

      <!-- Install banner slot -->
      <div id="installCardSlot">${installCardHTML()}</div>

      <!-- Stats tiles -->
      <div class="stat-grid">
        <div class="stat-tile"><b>${stats.totalNotes}</b><span>Catatan</span></div>
        <div class="stat-tile"><b>${stats.pendingChecklist}</b><span>Checklist</span></div>
        <div class="stat-tile"><b>${stats.totalFavorite}</b><span>Favorit</span></div>
      </div>

      <!-- Today reminders -->
      ${todayRem.length ? `
      <div class="section-title">Jadwal Hari Ini</div>
      <div class="row-list">
        ${todayRem.map(r => `<div class="note-row" style="cursor:default">
          <span style="font-size:20px;flex-shrink:0">⏰</span>
          <div class="body" style="flex:1;min-width:0">
            <div class="title-line">${escapeHtml(r.title)}</div>
            <div class="meta">${new Date(r.datetime).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</div>
          </div>
          <button class="icon-btn plain" data-del-rem="${r.id}">${icon('trash',15)}</button>
        </div>`).join('')}
      </div>` : ''}

      <!-- Pending checklists across notes -->
      ${pendingChecklist.length ? `
      <div class="section-title">Perlu Diselesaikan</div>
      <div class="card" style="display:flex;flex-direction:column;gap:8px">
        ${pendingChecklist.slice(0,5).map(c => `<div style="display:flex;align-items:center;gap:10px"><span style="width:18px;height:18px;border-radius:5px;border:2px solid var(--text-tertiary);flex-shrink:0"></span><span style="font-size:14px">${escapeHtml(c.text)}</span></div>`).join('')}
      </div>` : ''}

      <!-- Pinned -->
      ${pinned.length ? `
      <div class="section-title">${icon('pin',13)} Disematkan</div>
      <div class="row-list">${pinned.map(n => noteRow(n, ctx)).join('')}</div>` : ''}

      <!-- Favorites -->
      ${favs.length ? `
      <div class="section-title">Favorit</div>
      <div class="scroll-x" style="padding:2px 0 6px">
        ${favs.slice(0,6).map(n => `
          <button data-note-id="${n.id}" class="card card-tap" style="min-width:160px;max-width:180px;flex-shrink:0;text-align:left">
            <div style="font-size:18px;margin-bottom:6px">${n.color ? '🔖' : '⭐'}</div>
            <div style="font-weight:700;font-size:14px;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(n.title || 'Tanpa judul')}</div>
            <div style="color:var(--text-tertiary);font-size:11px">${fmtRelative(n.updatedAt)}</div>
          </button>`).join('')}
      </div>` : ''}

      <!-- Recently edited -->
      <div class="section-title">Terakhir Diedit</div>
      ${recent.length ? `<div class="row-list">${recent.map(n => noteRow(n, ctx)).join('')}</div>`
        : (pinned.length ? '' : `<div class="empty-state"><div class="e-icon">📝</div><div class="e-title">Belum ada catatan</div><p>Ketuk tombol + untuk membuat catatan pertama kamu!</p></div>`)}

    </div>
    </main>`;

  wireInstallCard(container);
  wireNoteRows(container, ctx);
  $$('[data-del-rem]', container).forEach(b => b.onclick = async () => {
    await deleteReminder(b.dataset.delRem); ctx.rerender();
  });
  $('#searchTopBtn', container)?.addEventListener('click', () => ctx.navigate('#/search'));
}

/* =====================================================================
   2. BROWSE (folders + notes list)
   ===================================================================== */
export async function renderBrowse(container, params, ctx) {
  const [allFolders, allNotes] = await Promise.all([getAllFolders(), getActiveNotes()]);
  const folderId = params.folderId || null;
  const folder = folderId ? allFolders.find(f => f.id === folderId) : null;

  if (folder && isFolderLocked(allFolders, folderId) && !getMasterKey()) {
    const ok = await ensureAuthenticated({ reason: `"${folder.name}" terkunci. Masukkan PIN untuk membukanya.` });
    if (!ok) { ctx.back(); return; }
  }

  const notes = folderId ? allNotes.filter(n => n.folderId === folderId) : allNotes.filter(n => !n.folderId);
  const childFolders = allFolders.filter(f => f.parentId === folderId);
  const sorted = [...notes].sort((a, b) => (b.pinned === a.pinned ? 0 : b.pinned ? 1 : -1) || new Date(b.updatedAt) - new Date(a.updatedAt));

  const noteCountOf = (fid) => {
    const count = allNotes.filter(n => n.folderId === fid).length;
    const childCount = allFolders.filter(f => f.parentId === fid).length;
    return `${count} catatan${childCount ? ` · ${childCount} subfolder` : ''}`;
  };

  container.innerHTML = `
    <div class="topbar">
      ${folderId ? `<button class="icon-btn plain" id="btnBrowseBack">${icon('chevronLeft', 22)}</button>` : ''}
      <span class="tb-title">${folder ? escapeHtml(folder.name) : 'Semua Catatan'}</span>
      <button class="icon-btn plain" id="btnManageCategories" aria-label="Kelola Kategori">${icon('category', 19)}</button>
      <button class="icon-btn plain" id="btnNewFolder">${icon('folderPlus', 20)}</button>
      <button class="icon-btn plain" id="btnSortMenu">${icon('shuffle', 20)}</button>
    </div>
    <main style="flex:1;overflow-y:auto;padding-bottom:calc(86px + var(--safe-b))">
    <div class="view-pad stagger">

      ${childFolders.length ? `
      <div class="folder-grid">
        ${childFolders.map(f => `
          <button class="folder-card press-scale" data-folder="${f.id}" style="background:${f.color || '#5E5CE6'}">
            ${f.locked ? `<span class="folder-lock-badge">${icon('lock', 12)}</span>` : ''}
            <span style="font-size:28px">${f.icon || '📁'}</span>
            <div>
              <div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(f.name)}</div>
              <div style="font-size:11px;opacity:.8">${noteCountOf(f.id)}</div>
            </div>
          </button>`).join('')}
      </div>` : ''}

      ${sorted.length ? `
      <div class="section-title" style="${childFolders.length ? '' : 'margin-top:0'}">Catatan</div>
      <div class="row-list">${sorted.map(n => noteRow(n, ctx)).join('')}</div>`
      : `<div class="empty-state" style="margin-top:${childFolders.length ? '20px' : '60px'}">
          <div class="e-icon">📂</div>
          <div class="e-title">${folderId ? 'Kategori ini kosong' : 'Tanpa Kategori kosong'}</div>
          <p>Buat catatan baru atau pindahkan catatan ke sini</p>
        </div>`}

    </div>
    </main>`;

  const btnBrowseBack = $('#btnBrowseBack', container);
  if (btnBrowseBack) btnBrowseBack.onclick = () => ctx.back();
  $('#btnManageCategories', container).onclick = () => ctx.navigate('#/categories');
  $('#btnNewFolder', container).onclick = () => openFolderEditorSheet(null, folderId, ctx);
  $('#btnSortMenu', container).onclick = () => {}; // future: sort options sheet

  $$('[data-folder]', container).forEach(btn => {
    btn.onclick = async () => {
      const f = allFolders.find(x => x.id === btn.dataset.folder);
      const ok = await guardCategoryAccess(f?.id, allFolders);
      if (ok) ctx.navigate('#/browse/' + btn.dataset.folder);
    };
    btn.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const f = allFolders.find(x => x.id === btn.dataset.folder);
      const choice = await sheetMenu([
        { value: 'rename', icon: 'pencil', label: 'Ubah nama/warna/ikon' },
        { value: 'manage', icon: 'category', label: 'Kelola Kategori' },
        { value: 'delete', icon: 'trash', label: 'Hapus kategori', danger: true },
      ], { title: f?.name || 'Kategori' });
      if (choice === 'rename') openFolderEditorSheet(f, f?.parentId ?? null, ctx);
      if (choice === 'manage') ctx.navigate('#/categories');
      if (choice === 'delete') {
        const ok = await confirmDialog('Catatan dalam kategori ini akan dipindah ke Tanpa Kategori.', { title: 'Hapus kategori?', okLabel: 'Hapus', danger: true });
        if (ok) { await deleteFolder(btn.dataset.folder); ctx.rerender(); showToast('Kategori dihapus', { icon: 'trash' }); }
      }
    });
  });
  wireNoteRows(container, ctx);
}

/* =====================================================================
   2b. ARCHIVE
   ===================================================================== */
export async function renderArchive(container, params, ctx) {
  const notes = await getArchivedNotes();
  container.innerHTML = `
    <div class="topbar">
      <button class="icon-btn plain" id="btnArchiveBack">${icon('chevronLeft', 22)}</button>
      <span class="tb-title">Arsip</span>
      <span style="width:40px"></span>
    </div>
    <main style="flex:1;overflow-y:auto;padding-bottom:calc(86px + var(--safe-b))">
    <div class="view-pad stagger">
      ${notes.length ? `<div class="row-list">${notes.map(n => noteRow(n, ctx, 'archive')).join('')}</div>` : `
      <div class="empty-state" style="margin-top:70px">
        <div class="e-icon">🗄️</div>
        <div class="e-title">Arsip kosong</div>
        <p>Geser catatan ke kiri atau pilih "Arsipkan" dari menu "•••" untuk menyingkirkannya dari daftar utama tanpa menghapusnya.</p>
      </div>`}
    </div>
    </main>`;
  $('#btnArchiveBack', container).onclick = () => ctx.back();
  wireNoteRows(container, ctx, 'archive');
}

/* =====================================================================
   2c. TRASH ("Sampah") — soft-deleted notes, auto-purged after 30 days
   ===================================================================== */
function trashRow(note) {
  const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(note.deletedAt).getTime()) / 86400000));
  return `<div class="note-row" data-trash-id="${note.id}" style="display:flex;align-items:flex-start;gap:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--r-lg);padding:12px 14px">
    ${noteColorDot(note)}
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(note.title || 'Tanpa judul')}</div>
      <div style="color:var(--text-tertiary);font-size:12px;margin-top:3px">Dihapus ${fmtRelative(note.deletedAt)} · terhapus permanen dalam ${daysLeft} hari</div>
    </div>
    <button class="icon-btn plain" data-restore="${note.id}" aria-label="Pulihkan">${icon('history', 18)}</button>
    <button class="icon-btn plain" data-purge="${note.id}" aria-label="Hapus permanen">${icon('trash', 18)}</button>
  </div>`;
}
export async function renderTrash(container, params, ctx) {
  const notes = await getTrashedNotes();
  container.innerHTML = `
    <div class="topbar">
      <button class="icon-btn plain" id="btnTrashBack">${icon('chevronLeft', 22)}</button>
      <span class="tb-title">Sampah</span>
      ${notes.length ? `<button class="icon-btn plain" id="btnEmptyTrash" aria-label="Kosongkan Sampah">${icon('close', 20)}</button>` : '<span style="width:40px"></span>'}
    </div>
    <main style="flex:1;overflow-y:auto;padding-bottom:calc(86px + var(--safe-b))">
    <div class="view-pad stagger">
      ${notes.length ? `
      <div class="info-banner" style="margin-bottom:16px">
        ${icon('info', 18)}
        <p>Catatan di sini otomatis terhapus permanen 30 hari setelah dipindahkan.</p>
      </div>
      <div class="row-list">${notes.map(trashRow).join('')}</div>` : `
      <div class="empty-state" style="margin-top:70px">
        <div class="e-icon">🗑️</div>
        <div class="e-title">Sampah kosong</div>
        <p>Catatan yang kamu hapus akan singgah di sini selama 30 hari sebelum benar-benar hilang.</p>
      </div>`}
    </div>
    </main>`;
  $('#btnTrashBack', container).onclick = () => ctx.back();
  $('#btnEmptyTrash', container)?.addEventListener('click', async () => {
    const ok = await confirmDialog('Semua catatan di Sampah akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.', { title: 'Kosongkan Sampah?', okLabel: 'Kosongkan', danger: true });
    if (!ok) return;
    const n = await emptyTrash();
    showToast(`${n} catatan dihapus permanen`, { icon: 'trash' });
    ctx.rerender();
  });
  $$('[data-restore]', container).forEach(b => b.onclick = async () => {
    await restoreNote(b.dataset.restore);
    showToast('Catatan dipulihkan', { icon: 'history' });
    ctx.rerender();
  });
  $$('[data-purge]', container).forEach(b => b.onclick = async () => {
    const ok = await confirmDialog('Catatan ini akan dihapus permanen dan tidak bisa dipulihkan.', { title: 'Hapus permanen?', okLabel: 'Hapus', danger: true });
    if (!ok) return;
    await permanentlyDeleteNote(b.dataset.purge);
    showToast('Dihapus permanen', { icon: 'trash' });
    ctx.rerender();
  });
}

/* Folder create/edit/lock sheets now live in categories.js (openFolderEditorSheet)
   so the Browse view and the "Kelola Kategori" screen share one implementation. */

/* =====================================================================
   3. SEARCH
   ===================================================================== */
export async function renderSearch(container, params, ctx) {
  container.innerHTML = `
    <div class="topbar">
      <button class="icon-btn plain" id="btnSearchBack">${icon('chevronLeft', 22)}</button>
      <div class="search-bar" style="flex:1">
        ${icon('search', 17)}
        <input id="searchInput" placeholder="Cari judul, isi, #tag, folder..." autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <button class="icon-btn plain" id="btnFilterMenu">${icon('settings', 20)}</button>
    </div>
    <div class="view-pad" style="padding-top:8px">
      <div class="scroll-x" id="tagChips" style="margin-bottom:10px;padding-bottom:4px"></div>
    </div>
    <main id="searchResults" style="flex:1;overflow-y:auto;padding:0 var(--space-4) calc(86px + var(--safe-b))"></main>`;

  const input = $('#searchInput', container);
  const results = $('#searchResults', container);
  const tagChips = $('#tagChips', container);

  // Build tag cloud from all notes
  const allNotes = await getAllNotes();
  const tagMap = {};
  allNotes.forEach(n => (n.tags || []).forEach(t => { tagMap[t] = (tagMap[t] || 0) + 1; }));
  const topTags = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 12);
  tagChips.innerHTML = topTags.map(([t]) => `<button class="tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('');
  $$('[data-tag]', tagChips).forEach(b => b.onclick = () => { input.value = '#' + b.dataset.tag; doSearch(); });

  let debounceTimer;
  async function doSearch() {
    const q = input.value.trim();
    const found = await searchNotes(q);
    if (!found.length) {
      results.innerHTML = `<div class="empty-state"><div class="e-icon">🔍</div><div class="e-title">Tidak ada hasil</div><p>Coba kata kunci lain atau hapus filter</p></div>`;
      return;
    }
    results.innerHTML = `<div class="row-list stagger">${found.map(n => noteRow(n, ctx)).join('')}</div>`;
    wireNoteRows(results, ctx);
  }

  input.addEventListener('input', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(doSearch, 280); });
  $('#btnSearchBack', container).onclick = () => ctx.back();
  setTimeout(() => { input.focus(); doSearch(); }, 100);

  $('#btnFilterMenu', container).onclick = async () => {
    const choice = await sheetMenu([
      { value: 'fav', icon: 'star', label: 'Favorit saja' },
      { value: 'cl', icon: 'checklist', label: 'Ada checklist' },
      { value: 'all', icon: 'browse', label: 'Semua catatan' },
    ], { title: 'Filter' });
    if (choice === 'fav') { const f = await getAllNotes(); results.innerHTML = `<div class="row-list stagger">${f.filter(n => n.favorite).map(n => noteRow(n, ctx)).join('')}</div>`; wireNoteRows(results, ctx); }
    if (choice === 'cl') { const f = await getAllNotes(); results.innerHTML = `<div class="row-list stagger">${f.filter(n => extractChecklist(n.content).length > 0).map(n => noteRow(n, ctx)).join('')}</div>`; wireNoteRows(results, ctx); }
    if (choice === 'all') doSearch();
  };
}

/* =====================================================================
   4. GRAPH VIEW (2D force-directed + optional 3D toggle)
   ===================================================================== */
export async function renderGraph(container, params, ctx) {
  const [allNotes, allFolders] = await Promise.all([getAllNotes(), getAllFolders()]);
  const is3D = params.mode === '3d';

  container.innerHTML = `
    <div class="topbar">
      <span class="tb-title">Graf Catatan</span>
      <button class="icon-btn plain" id="btn3DToggle" title="${is3D ? '2D' : '3D'}">${is3D ? '2D' : '3D'}</button>
      <button class="icon-btn plain" id="btnGraphSearch">${icon('search', 20)}</button>
    </div>
    <div style="flex:1;position:relative;overflow:hidden">
      <canvas id="graphCanvas" style="position:absolute;inset:0;width:100%;height:100%;touch-action:none"></canvas>
      <div class="graph-legend">
        <div style="display:flex;gap:8px;font-size:11px;color:var(--text-secondary)">
          <span>● Catatan</span><span style="opacity:.5">● Wiki-link</span>
        </div>
      </div>
      <div class="graph-controls">
        <button class="icon-btn" id="gZoomIn">${icon('plus', 16)}</button>
        <button class="icon-btn" id="gZoomOut" style="font-size:18px;display:grid;place-items:center">−</button>
        <button class="icon-btn" id="gCenter">${icon('crop', 16)}</button>
      </div>
    </div>`;

  const canvas = $('#graphCanvas', container);
  const stopGraph = is3D ? runGraph3D(canvas, allNotes, ctx) : runGraph2D(canvas, allNotes, ctx);

  $('#btn3DToggle', container).onclick = () => ctx.navigate('#/graph' + (is3D ? '' : '/3d'));
  $('#btnGraphSearch', container).onclick = async () => {
    const q = await promptDialog('', { title: 'Cari node', placeholder: 'Judul catatan...' });
    /* highlight handled inside graph engine via custom event */
    if (q) document.dispatchEvent(new CustomEvent('graph:search', { detail: q }));
  };

  /* Dikembalikan ke router (main.js) supaya loop animasi & listener dihentikan
     saat pengguna berpindah dari tampilan Graf ke tampilan lain. */
  return stopGraph;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function graphEmptyStateHTML() {
  return `<div class="empty-state" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
    <div class="e-icon">🕸️</div>
    <div class="e-title">Belum ada catatan</div>
    <p>Buat catatan dulu untuk melihatnya di sini</p>
  </div>`;
}

function runGraph2D(canvas, notes, ctx) {
  const wrap = canvas.parentElement;
  const C = canvas.getContext('2d');
  const W = () => canvas.offsetWidth, H = () => canvas.offsetHeight;
  canvas.width = W(); canvas.height = H();

  if (!notes.length) {
    wrap.insertAdjacentHTML('beforeend', graphEmptyStateHTML());
    return () => {};
  }

  /* Seed positions on a sunflower/phyllotaxis spiral instead of pure
     Math.random(): guarantees minimum spacing between every pair of nodes
     from frame one. Two nodes spawning on (near-)identical coordinates was
     exactly what made the old repulsion formula below explode — division
     by a near-zero distance produced a huge one-tick velocity kick that
     flung a node far outside the canvas before gravity ever got a chance
     to pull it back. */
  const GOLDEN_ANGLE = 2.399963;
  const nodeMap = new Map();
  notes.forEach((n, i) => {
    const rr = 26 * Math.sqrt(i + 1);
    const th = i * GOLDEN_ANGLE;
    nodeMap.set(n.id, {
      id: n.id, title: n.title || '…', color: n.color || null,
      x: W() / 2 + rr * Math.cos(th), y: H() / 2 + rr * Math.sin(th),
      vx: 0, vy: 0, r: 10,
    });
  });
  const edges = [];
  notes.forEach(n => {
    extractWikiLinks(n.content || '').forEach(t => {
      const target = notes.find(m => (m.title || '').toLowerCase() === t.toLowerCase());
      if (target && target.id !== n.id) edges.push({ a: n.id, b: target.id });
    });
  });

  let zoom = 1, panX = 0, panY = 0, dragging = null, highlighted = null;
  let raf, tick = 0, settled = false, userInteracted = false;
  const MAX_SPEED = 40;       // px/tick hard cap — a defensive backstop so no single tick can ever fling a node off-canvas, however large the force
  const MIN_ZOOM = 0.03, MAX_ZOOM = 3; // generous enough that auto-fit can always frame the whole graph, even with 100+ notes

  /* Force simulation */
  function simulate() {
    const nodes = [...nodeMap.values()];
    let maxSpeed = 0;
    // Repulsion — softened at close range (+280 instead of the old +1) so
    // nodes that start out near each other repel gently instead of exploding.
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
      const d2 = dx * dx + dy * dy + 280;
      const f = 1500 / d2;
      nodes[i].vx -= dx * f; nodes[i].vy -= dy * f;
      nodes[j].vx += dx * f; nodes[j].vy += dy * f;
    }
    // Attraction (edges)
    edges.forEach(({ a, b }) => {
      const na = nodeMap.get(a), nb = nodeMap.get(b);
      if (!na || !nb) return;
      const dx = nb.x - na.x, dy = nb.y - na.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - 80) * 0.014;
      na.vx += dx / d * f; na.vy += dy / d * f;
      nb.vx -= dx / d * f; nb.vy -= dy / d * f;
    });
    // Gravity toward center — noticeably stronger relative to the (also
    // softened) repulsion above than the old 2200/0.004 pairing, so a
    // handful of notes settle into a cluster sized for a phone screen
    // instead of a spread many times wider than the canvas.
    const cx = canvas.width / 2, cy = canvas.height / 2;
    nodes.forEach(n => {
      if (dragging && !dragging.pan && dragging.n === n) return; // don't fight the user's own drag
      n.vx += (cx - n.x) * 0.02; n.vy += (cy - n.y) * 0.02;
      n.vx *= 0.78; n.vy *= 0.78;
      const sp = Math.hypot(n.vx, n.vy);
      if (sp > MAX_SPEED) { n.vx = n.vx / sp * MAX_SPEED; n.vy = n.vy / sp * MAX_SPEED; }
      n.x += n.vx; n.y += n.vy;
      maxSpeed = Math.max(maxSpeed, sp);
    });
    return maxSpeed;
  }

  function bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodeMap.forEach(n => { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); });
    return { minX, minY, maxX, maxY };
  }
  /* Always know the pan/zoom that would frame every node — used both to
     continuously ease the camera into view while the layout is settling,
     and to power the "center" button. This is the hard guarantee that the
     graph can never again render with every node sitting off-canvas. */
  function targetFit() {
    const { minX, minY, maxX, maxY } = bounds();
    const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1);
    const pad = 64;
    const tz = clamp(Math.min((canvas.width - pad * 2) / bw, (canvas.height - pad * 2) / bh), MIN_ZOOM, MAX_ZOOM);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { zoom: tz, panX: canvas.width / 2 - cx * tz, panY: canvas.height / 2 - cy * tz };
  }
  { const f = targetFit(); zoom = f.zoom; panX = f.panX; panY = f.panY; } // frame correctly on the very first paint, before simulation even starts

  function draw() {
    const cw = canvas.offsetWidth, ch = canvas.offsetHeight;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;

    if (!settled && tick < 400) {
      const sp = simulate();
      tick++;
      if (tick > 40 && sp < 0.4) settled = true;
    } else {
      settled = true;
    }
    if (!userInteracted) {
      const f = targetFit();
      zoom += (f.zoom - zoom) * 0.08;
      panX += (f.panX - panX) * 0.08;
      panY += (f.panY - panY) * 0.08;
    }

    C.clearRect(0, 0, canvas.width, canvas.height);
    C.save(); C.translate(panX, panY); C.scale(zoom, zoom);
    const rootStyle = getComputedStyle(document.documentElement);
    const accent = rootStyle.getPropertyValue('--accent').trim() || '#5E5CE6';
    const textColor = rootStyle.getPropertyValue('--text').trim() || '#fff';
    // Edges
    edges.forEach(({ a, b }) => {
      const na = nodeMap.get(a), nb = nodeMap.get(b);
      if (!na || !nb) return;
      C.beginPath(); C.moveTo(na.x, na.y); C.lineTo(nb.x, nb.y);
      C.strokeStyle = 'rgba(100,100,120,.2)'; C.lineWidth = 1 / zoom; C.stroke();
    });
    // Nodes
    nodeMap.forEach(n => {
      const isHL = highlighted && n.title.toLowerCase().includes(highlighted.toLowerCase());
      C.beginPath(); C.arc(n.x, n.y, isHL ? n.r * 1.5 : n.r, 0, Math.PI * 2);
      C.fillStyle = n.color || accent; C.fill();
      if (isHL) { C.strokeStyle = '#fff'; C.lineWidth = 2 / zoom; C.stroke(); }
      if (zoom > 0.6) {
        C.font = `${Math.round(11 / zoom)}px -apple-system, sans-serif`;
        C.fillStyle = textColor; // canvas can't resolve var(--text) itself — must pass the resolved color in
        C.fillText(n.title.slice(0, 20), n.x + n.r + 3, n.y + 4);
      }
    });
    C.restore();
    raf = requestAnimationFrame(draw);
  }
  draw();

  function ptWorld(px, py) { return [(px - panX) / zoom, (py - panY) / zoom]; }
  function nodeAt(wx, wy) { for (const n of nodeMap.values()) { const dx = n.x - wx, dy = n.y - wy; if (dx * dx + dy * dy < (n.r + 6) * (n.r + 6)) return n; } return null; }

  canvas.addEventListener('pointerdown', (e) => {
    userInteracted = true;
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = ptWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = nodeAt(wx, wy);
    if (hit) dragging = { n: hit, ox: e.clientX - panX, oy: e.clientY - panY, moved: false };
    else dragging = { pan: true, ox: e.clientX - panX, oy: e.clientY - panY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (dragging.pan) { panX = e.clientX - dragging.ox; panY = e.clientY - dragging.oy; }
    else { dragging.n.x = (e.clientX - panX - (dragging.ox - panX - dragging.n.x * zoom)) / zoom; dragging.moved = true; }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (dragging && !dragging.pan && !dragging.moved) ctx.navigate('#/note/' + dragging.n.id);
    dragging = null;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    userInteracted = true;
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    zoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
  }, { passive: false });

  $('#gZoomIn', wrap).onclick = () => { userInteracted = true; zoom = clamp(zoom * 1.2, MIN_ZOOM, MAX_ZOOM); };
  $('#gZoomOut', wrap).onclick = () => { userInteracted = true; zoom = clamp(zoom * 0.83, MIN_ZOOM, MAX_ZOOM); };
  $('#gCenter', wrap).onclick = () => { userInteracted = false; const f = targetFit(); zoom = f.zoom; panX = f.panX; panY = f.panY; };

  const onGraphSearch = (e) => { highlighted = e.detail; };
  document.addEventListener('graph:search', onGraphSearch);

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('graph:search', onGraphSearch);
  };
}

function runGraph3D(canvas, notes, ctx) {
  /* Real 3-D force graph rendered on a 2-D canvas (no Three.js dependency
     needed for a few dozen nodes). Nodes are simulated in true x/y/z space
     — repulsion, link springs and centering gravity, the same recipe as
     the 2-D graph — then projected through a perspective camera that
     orbits on drag and idles into a slow auto-rotate. A floor grid and
     depth-based fog are what actually sell the "3-D" feeling; a plain
     rotating point cloud reads as flat no matter how correct the math is. */
  const wrap = canvas.parentElement;
  const C = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;

  if (!notes.length) {
    wrap.insertAdjacentHTML('beforeend', graphEmptyStateHTML());
    return () => {};
  }

  const FOCAL = 640;
  const MIN_DIST = 120, MAX_DIST = 2000; // generous enough that auto-fit can always frame the whole graph, even with 100+ notes
  let camDist = 420; // this doubles as "zoom" — distance of the camera from the origin

  /* Seed on a Fibonacci sphere: nodes are evenly spread with a guaranteed
     minimum angular spacing, so — just like the 2-D spiral above — no two
     nodes ever spawn on top of each other. That was the root cause of the
     "everything flies to the edge of the universe" bug: a near-zero
     starting distance produced a near-infinite repulsion force between two
     nodes on the very first tick. It also just looks like a "3-D graph"
     immediately, before the sim or the drag has done anything. */
  const N = notes.length;
  const BASE_R = 90 + Math.min(N, 30) * 3;
  const nodes = notes.map((n, i) => {
    const idx = i + 0.5;
    const phi = Math.acos(1 - (2 * idx) / N);
    const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
    return {
      id: n.id, title: n.title || '…', color: n.color || null,
      x: BASE_R * Math.sin(phi) * Math.cos(theta),
      y: BASE_R * Math.sin(phi) * Math.sin(theta),
      z: BASE_R * Math.cos(phi),
      vx: 0, vy: 0, vz: 0,
    };
  });
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edges = [];
  notes.forEach(n => {
    extractWikiLinks(n.content || '').forEach(t => {
      const target = notes.find(m => (m.title || '').toLowerCase() === t.toLowerCase());
      if (target && target.id !== n.id) edges.push({ a: n.id, b: target.id });
    });
  });

  const DEFAULT_ROT_Y = 0.5, DEFAULT_ROT_X = 0.4;
  let rotY = DEFAULT_ROT_Y, rotX = DEFAULT_ROT_X;
  let isDragging = false, lastX, lastY, downX, downY, moved = false, raf;
  let tick = 0, settled = false, userInteracted = false;
  const MAX_SPEED = 6;

  function simulate() {
    let maxSpeed = 0;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d2 = dx * dx + dy * dy + dz * dz + 250;
      const f = 900 / d2;
      a.vx -= dx * f; a.vy -= dy * f; a.vz -= dz * f;
      b.vx += dx * f; b.vy += dy * f; b.vz += dz * f;
    }
    edges.forEach(({ a, b }) => {
      const na = nodeMap.get(a), nb = nodeMap.get(b);
      if (!na || !nb) return;
      const dx = nb.x - na.x, dy = nb.y - na.y, dz = nb.z - na.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const f = (d - 110) * 0.01;
      na.vx += dx / d * f; na.vy += dy / d * f; na.vz += dz / d * f;
      nb.vx -= dx / d * f; nb.vy -= dy / d * f; nb.vz -= dz / d * f;
    });
    nodes.forEach(n => {
      n.vx += -n.x * 0.08; n.vy += -n.y * 0.08; n.vz += -n.z * 0.08;
      n.vx *= 0.8; n.vy *= 0.8; n.vz *= 0.8;
      const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy + n.vz * n.vz);
      if (sp > MAX_SPEED) { const s = MAX_SPEED / sp; n.vx *= s; n.vy *= s; n.vz *= s; }
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
      maxSpeed = Math.max(maxSpeed, sp);
    });
    return maxSpeed;
  }

  function targetCamDist() {
    let maxR = 10;
    nodes.forEach(n => { maxR = Math.max(maxR, Math.hypot(n.x, n.y, n.z)); });
    return clamp(maxR * 2.15 + 70, MIN_DIST, MAX_DIST);
  }
  camDist = targetCamDist(); // frame correctly on the very first paint

  function project(x, y, z) {
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    // Yaw around Y, then pitch around X — a standard, non-gimbal-locked orbit camera.
    const x1 = x * cosY + z * sinY;
    const z1 = z * cosY - x * sinY;
    const y2 = y * cosX - z1 * sinX;
    const z2 = y * sinX + z1 * cosX;
    const denom = Math.max(camDist + z2, FOCAL * 0.12); // never let a point cross behind the camera and blow the scale up to infinity
    const scale = FOCAL / denom;
    return { sx: x1 * scale + canvas.width / 2, sy: y2 * scale + canvas.height / 2, scale, depth: z2 };
  }

  function drawFloor() {
    const gridY = BASE_R * 1.2;
    const rings = [0.35, 0.7, 1.05].map(f => BASE_R * 1.3 * f);
    C.save();
    C.lineWidth = 1;
    rings.forEach(rad => {
      C.strokeStyle = 'rgba(140,130,255,.12)';
      C.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.0001; a += Math.PI / 28) {
        const p = project(rad * Math.cos(a), gridY, rad * Math.sin(a));
        if (a === 0) C.moveTo(p.sx, p.sy); else C.lineTo(p.sx, p.sy);
      }
      C.stroke();
    });
    const outer = rings[rings.length - 1];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const p1 = project(outer * 0.2 * Math.cos(a), gridY, outer * 0.2 * Math.sin(a));
      const p2 = project(outer * Math.cos(a), gridY, outer * Math.sin(a));
      C.beginPath(); C.moveTo(p1.sx, p1.sy); C.lineTo(p2.sx, p2.sy); C.stroke();
    }
    C.restore();
  }

  function draw() {
    const cw = canvas.offsetWidth, ch = canvas.offsetHeight;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    C.clearRect(0, 0, canvas.width, canvas.height);

    if (!settled && tick < 400) {
      const sp = simulate();
      tick++;
      if (tick > 40 && sp < 0.05) settled = true;
    } else {
      settled = true;
    }
    if (!isDragging) rotY += 0.003;
    if (!userInteracted) camDist += (targetCamDist() - camDist) * 0.08;

    drawFloor();

    const baseScale = FOCAL / camDist;
    edges.forEach(({ a, b }) => {
      const na = nodeMap.get(a), nb = nodeMap.get(b); if (!na || !nb) return;
      const pa = project(na.x, na.y, na.z), pb = project(nb.x, nb.y, nb.z);
      const fog = clamp(((pa.scale + pb.scale) / 2) / baseScale, 0.25, 1);
      C.beginPath(); C.moveTo(pa.sx, pa.sy); C.lineTo(pb.sx, pb.sy);
      C.strokeStyle = `rgba(130,115,220,${(0.28 * fog).toFixed(3)})`; C.lineWidth = 1; C.stroke();
    });

    const rootStyle = getComputedStyle(document.documentElement);
    const accent = rootStyle.getPropertyValue('--accent').trim() || '#7D7AFF';
    const textColor = rootStyle.getPropertyValue('--text').trim() || '#eee'; // resolved here — canvas can't read var(--text) itself
    const sorted = nodes.map(n => ({ n, p: project(n.x, n.y, n.z) })).sort((A, B) => B.p.depth - A.p.depth);
    sorted.forEach(({ n, p }) => {
      const fog = clamp(p.scale / baseScale, 0.32, 1);
      const r = 7 * p.scale;
      C.globalAlpha = fog;
      C.beginPath(); C.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      C.fillStyle = n.color || accent; C.fill();
      if (p.scale > baseScale * 0.8) {
        C.font = `${Math.round(11 * p.scale)}px -apple-system,sans-serif`;
        C.fillStyle = textColor;
        C.fillText(n.title.slice(0, 18), p.sx + r + 2, p.sy + 4);
      }
      C.globalAlpha = 1;
    });

    raf = requestAnimationFrame(draw);
  }
  draw();

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true; userInteracted = true; moved = false;
    lastX = downX = e.clientX; lastY = downY = e.clientY;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    rotY += (e.clientX - lastX) * 0.006;
    rotX = clamp(rotX + (e.clientY - lastY) * 0.006, -1.4, 1.4);
    lastX = e.clientX; lastY = e.clientY;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) moved = true;
  });
  canvas.addEventListener('pointerup', (e) => {
    isDragging = false;
    if (moved) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = null, bestD2 = Infinity;
    nodeMap.forEach(n => {
      const p = project(n.x, n.y, n.z);
      const dx = mx - p.sx, dy = my - p.sy;
      const d2 = dx * dx + dy * dy;
      const hitR2 = (7 * p.scale + 8) ** 2;
      if (d2 < hitR2 && d2 < bestD2) { bestD2 = d2; best = n; }
    });
    if (best) ctx.navigate('#/note/' + best.id);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    userInteracted = true;
    camDist = clamp(camDist * (e.deltaY < 0 ? 0.9 : 1.1), MIN_DIST, MAX_DIST);
  }, { passive: false });

  $('#gZoomIn', wrap).onclick = () => { userInteracted = true; camDist = clamp(camDist * 0.82, MIN_DIST, MAX_DIST); };
  $('#gZoomOut', wrap).onclick = () => { userInteracted = true; camDist = clamp(camDist * 1.22, MIN_DIST, MAX_DIST); };
  $('#gCenter', wrap).onclick = () => { userInteracted = false; rotY = DEFAULT_ROT_Y; rotX = DEFAULT_ROT_X; camDist = targetCamDist(); };

  return () => cancelAnimationFrame(raf);
}

/* =====================================================================
   5. SETTINGS
   ===================================================================== */
export async function renderSettings(container, params, ctx) {
  const [currentTheme, lockCfg, streak, stats, archived, trashed] = await Promise.all([
    getSetting('theme', 'dark'), getSetting('lock'), getStreak(), computeStats(),
    getArchivedNotes(), getTrashedNotes(),
  ]);
  const badges = await getBadges({ ...stats, streak });
  const webAuthnOk = await isWebAuthnAvailable();
  const locked = !!(lockCfg && lockCfg.enabled);

  container.innerHTML = `
    <div class="topbar"><span class="tb-title">Pengaturan</span></div>
    <main style="flex:1;overflow-y:auto;padding-bottom:calc(86px + var(--safe-b))">
    <div class="view-pad stagger">

      <!-- Streak + Badges -->
      <div class="card" style="margin-bottom:var(--space-5)">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <div class="ring-wrap" id="streakRing">
            <svg width="54" height="54" viewBox="0 0 54 54"><circle class="ring-bg" cx="27" cy="27" r="22"/><circle class="ring-fg" id="ringFg" cx="27" cy="27" r="22" stroke-dasharray="138.2" stroke-dashoffset="${138.2 - (Math.min(streak.current, 30) / 30) * 138.2}"/></svg>
            <div class="ring-label">${streak.current}</div>
          </div>
          <div>
            <b style="display:block;font-size:17px">${streak.current} hari beruntun 🔥</b>
            <span class="muted" style="font-size:13px">Terbaik: ${streak.longest} hari · ${stats.totalWords.toLocaleString('id')} kata total</span>
          </div>
        </div>
        <div class="badge-grid">
          ${badges.map(b => `<div class="badge${b.unlocked ? ' unlocked' : ''}" title="${b.label}"><span class="b-emoji">${b.emoji}</span><span class="b-label">${b.label}</span></div>`).join('')}
        </div>
      </div>

      <!-- Theme -->
      <div class="section-title">Tema</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:var(--space-5)">
        ${THEMES.map(t => `
          <button class="template-card" data-theme="${t}" style="padding:10px 6px;${t === currentTheme ? 'border-color:var(--accent)' : ''}">
            <div class="t-icon">${THEME_ICONS[t]}</div>
            <b>${THEME_LABELS[t]}</b>
          </button>`).join('')}
      </div>

      <!-- Organization -->
      <div class="section-title">Organisasi</div>
      <div class="settings-group">
        <div class="settings-row" id="btnGotoCategories">
          <span class="si" style="background:#5E5CE6">${icon('category', 16)}</span>
          <div class="stext"><b>Kelola Kategori</b><span>Urutkan, kunci, ganti nama & warna</span></div>
          ${icon('chevronRight', 18)}
        </div>
        <div class="settings-row" id="btnGotoArchive">
          <span class="si" style="background:#FF9F0A">${icon('archive', 16)}</span>
          <div class="stext"><b>Arsip</b><span>${archived.length} catatan diarsipkan</span></div>
          ${icon('chevronRight', 18)}
        </div>
        <div class="settings-row" id="btnGotoTrash">
          <span class="si" style="background:#8E8E93">${icon('trash', 16)}</span>
          <div class="stext"><b>Sampah</b><span>${trashed.length} catatan · terhapus permanen setelah 30 hari</span></div>
          ${icon('chevronRight', 18)}
        </div>
      </div>

      <!-- Security -->
      <div class="section-title">Keamanan</div>
      <div class="settings-group">
        <div class="settings-row">
          <span class="si" style="background:#FF453A">${icon('lock', 16)}</span>
          <div class="stext"><b>Kunci Aplikasi</b><span>${locked ? 'Aktif — data terenkripsi AES-256' : 'Nonaktif'}</span></div>
          <div class="toggle${locked ? ' on' : ''}" id="lockToggle"><div class="knob"></div></div>
        </div>
        ${locked && webAuthnOk ? `
        <div class="settings-row">
          <span class="si" style="background:#30D158">${icon('fingerprint', 16)}</span>
          <div class="stext"><b>Buka dengan Sidik Jari</b><span>Akses cepat tanpa ketik PIN</span></div>
          <button class="btn btn-sm btn-soft" id="fpBtn">${lockCfg.fingerprint ? 'Sudah diatur' : 'Siapkan'}</button>
        </div>` : ''}
        <p class="muted" style="padding:10px 14px 4px;font-size:12px">PIN terdiri dari 4 angka. PIN yang sama juga dipakai untuk mengunci kategori atau catatan tertentu dari editor, walau Kunci Aplikasi ini nonaktif.</p>
      </div>

      <!-- Data -->
      <div class="section-title">Data</div>
      <div class="settings-group">
        <div class="settings-row" id="btnExport">
          <span class="si" style="background:#0A84FF">${icon('download', 16)}</span>
          <div class="stext"><b>Ekspor Backup</b><span>Unduh semua data sebagai .json</span></div>
          ${icon('chevronRight', 18)}
        </div>
        <div class="settings-row" id="btnImport">
          <span class="si" style="background:#5E5CE6">${icon('upload', 16)}</span>
          <div class="stext"><b>Impor Backup</b><span>Pulihkan dari file .json</span></div>
          ${icon('chevronRight', 18)}
        </div>
      </div>

      <!-- Templates & stats -->
      <div class="section-title">Statistik</div>
      <div class="stat-grid">
        <div class="stat-tile"><b>${stats.totalNotes}</b><span>Catatan</span></div>
        <div class="stat-tile"><b>${stats.totalWords.toLocaleString('id')}</b><span>Total kata</span></div>
        <div class="stat-tile"><b>${stats.photos}</b><span>Foto</span></div>
        <div class="stat-tile"><b>${stats.audio}</b><span>Voice note</span></div>
        <div class="stat-tile"><b>${stats.totalFolders}</b><span>Kategori</span></div>
        <div class="stat-tile"><b>${stats.totalLinks}</b><span>Wiki link</span></div>
      </div>

      <!-- Templates -->
      <div class="section-title">Template Cepat</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:var(--space-5)">
        ${[
          { icon: '📝', label: 'Jurnal Harian', content: '<h2>Jurnal — ' + new Date().toLocaleDateString('id-ID') + '</h2><p>Hari ini aku...</p><h3>Syukur</h3><ul><li>...</li></ul><h3>Hal yang perlu diperbaiki</h3><ul><li>...</li></ul>' },
          { icon: '🧪', label: 'Laporan Praktikum', content: '<h2>Laporan Praktikum</h2><h3>Tujuan</h3><p>...</p><h3>Alat & Bahan</h3><ul><li>...</li></ul><h3>Langkah Kerja</h3><ol><li>...</li></ol><h3>Hasil & Pembahasan</h3><p>...</p><h3>Kesimpulan</h3><p>...</p>' },
          { icon: '🎮', label: 'Ide Game', content: '<h2>Konsep Game</h2><h3>Genre</h3><p>...</p><h3>Cerita Singkat</h3><p>...</p><h3>Mekanik Utama</h3><ul><li>...</li></ul><h3>Referensi</h3><p>...</p>' },
          { icon: '📅', label: 'Planner Proyek', content: '<h2>Proyek: ...</h2><h3>Tujuan</h3><p>...</p><h3>Tugas</h3>' + ['Riset', 'Desain', 'Implementasi', 'Review'].map(t => `<div class="checklist-item" data-checked="false"><span class="cbx"></span><span class="ctext">${t}</span></div>`).join('') + '<h3>Catatan</h3><p>...</p>' },
          { icon: '📖', label: 'Bab Novel', content: '<h2>Bab — </h2><h3>Ringkasan</h3><p>...</p><hr><p>Paragraf pembuka...</p>' },
          { icon: '🔬', label: 'Catatan Riset', content: '<h2>Riset: ...</h2><h3>Pertanyaan Utama</h3><p>...</p><h3>Sumber</h3><ul><li>...</li></ul><h3>Temuan</h3><p>...</p><h3>Kesimpulan Sementara</h3><p>...</p>' },
        ].map(t => `<button class="template-card" data-tpl='${JSON.stringify(t)}'><div class="t-icon">${t.icon}</div><b>${t.label}</b></button>`).join('')}
      </div>

      <!-- App info + install banner at bottom -->
      <div id="installCardSlot">${installCardHTML()}</div>
      <p style="text-align:center;color:var(--text-tertiary);font-size:12px;margin-top:16px">Catat v2.1.1 · Semua data tersimpan di perangkat kamu · Tidak perlu internet</p>
    </div>
    </main>`;

  wireInstallCard(container);

  // Theme selector
  $$('[data-theme]', container).forEach(btn => btn.onclick = async () => {
    const t = btn.dataset.theme;
    await setSetting('theme', t);
    document.documentElement.setAttribute('data-theme', t);
    updateThemeColorMeta(THEME_BG_MAP[t] || '#131316');
    ctx.rerender();
  });

  $('#btnGotoCategories', container).onclick = () => ctx.navigate('#/categories');
  $('#btnGotoArchive', container).onclick = () => ctx.navigate('#/archive');
  $('#btnGotoTrash', container).onclick = () => ctx.navigate('#/trash');

  // Lock toggle
  $('#lockToggle', container)?.addEventListener('click', async () => {
    if (!locked) {
      const pin = await promptPin('Buat 4 angka untuk mengunci aplikasi. PIN yang sama dipakai untuk membuka aplikasi setiap kali terkunci.', { title: 'Buat PIN', okLabel: 'Lanjut' });
      if (!pin) return;
      const confirm = await promptPin('Masukkan ulang 4 angka yang sama', { title: 'Konfirmasi PIN', okLabel: 'Konfirmasi' });
      if (!confirm) return;
      if (pin !== confirm) { showToast('PIN tidak cocok', { icon: 'lock' }); return; }
      await setupLock(pin, 'pin');
      showToast('Kunci diaktifkan', { icon: 'lock' }); ctx.rerender();
    } else {
      const pin = await promptPin('Masukkan 4 angka PIN untuk menonaktifkan kunci', { title: 'Verifikasi PIN', okLabel: 'Nonaktifkan' });
      if (!pin) return;
      const ok = await disableLock(pin);
      if (!ok) { showToast('PIN salah', { icon: 'close' }); return; }
      showToast('Kunci dinonaktifkan'); ctx.rerender();
    }
  });

  // Fingerprint
  $('#fpBtn', container)?.addEventListener('click', async () => {
    const pin = await promptPin('Masukkan 4 angka PIN saat ini untuk konfirmasi', { title: 'Verifikasi PIN', okLabel: 'Konfirmasi' });
    if (!pin) return;
    try { await setupFingerprint(pin); showToast('Sidik jari berhasil diatur', { icon: 'fingerprint' }); }
    catch (e) { showToast('Gagal: ' + (e.message || 'Error'), { icon: 'close' }); }
  });

  // Export
  $('#btnExport', container).onclick = async () => {
    showToast('Menyiapkan backup...', { icon: 'download' });
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `catat-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    showToast('Backup diunduh', { icon: 'download' });
  };

  // Import
  $('#btnImport', container).onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        const ok = await confirmDialog(`Ini akan menimpa SEMUA data saat ini dengan backup dari ${data.exportedAt?.slice(0,10) || '?'}. Lanjutkan?`, { title: 'Impor Backup?', okLabel: 'Impor', danger: true });
        if (!ok) return;
        await importAllData(data);
        showToast('Backup berhasil diimpor', { icon: 'upload' }); ctx.rerender();
      } catch (e) { showToast('File tidak valid: ' + e.message); }
    };
    inp.click();
  };

  // Templates
  $$('[data-tpl]', container).forEach(btn => btn.onclick = async () => {
    const tpl = JSON.parse(btn.dataset.tpl);
    const note = await createNote({ title: tpl.label, content: tpl.content });
    ctx.navigate('#/note/' + note.id);
  });
}

/* =====================================================================
   6. READER MODE
   ===================================================================== */
export async function renderReader(container, params, ctx) {
  const [allNotes, allFolders] = await Promise.all([getAllNotes(), getAllFolders()]);
  const folderId = params.folderId;
  const singleId = params.id;

  let notes;
  let title = 'Reader Mode';
  if (singleId) {
    const n = allNotes.find(x => x.id === singleId);
    notes = n ? [n] : [];
    title = n?.title || 'Catatan';
  } else if (folderId) {
    notes = allNotes.filter(n => n.folderId === folderId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const folder = allFolders.find(f => f.id === folderId);
    title = folder ? `${folder.icon || '📁'} ${folder.name}` : 'Koleksi';
  } else {
    notes = allNotes.filter(n => n.favorite).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    title = '⭐ Favorit — Mode Novel';
  }

  const toc = notes.map((n, i) => `<li><a href="#reader-note-${n.id}" style="color:var(--accent)">Bab ${i + 1}: ${escapeHtml(n.title || 'Tanpa judul')}</a></li>`).join('');

  container.innerHTML = `
    <div class="topbar">
      <button class="icon-btn plain" id="btnReaderBack">${icon('chevronLeft', 22)}</button>
      <span class="tb-title">${escapeHtml(title)}</span>
      <button class="icon-btn plain" id="btnReaderTOC">${icon('layers', 20)}</button>
    </div>
    <main style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:calc(86px + var(--safe-b))">
      <div style="max-width:660px;margin:0 auto;padding:var(--space-5) var(--space-5) var(--space-8)">
        ${toc.length > 1 ? `<div class="card" style="margin-bottom:var(--space-6)"><b style="display:block;margin-bottom:10px;font-size:15px">Daftar Isi</b><ol style="line-height:2">${toc}</ol></div>` : ''}
        ${notes.map((n, i) => `
          <article id="reader-note-${n.id}" style="margin-bottom:var(--space-8)">
            ${notes.length > 1 ? `<p style="color:var(--text-tertiary);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Bab ${i + 1}</p>` : ''}
            <h1 style="font-size:clamp(22px,5vw,32px);font-weight:900;letter-spacing:-.5px;margin-bottom:var(--space-4);font-family:var(--font-serif)">${escapeHtml(n.title || 'Tanpa Judul')}</h1>
            <div style="font-family:var(--font-serif);font-size:clamp(15px,2.5vw,18px);line-height:1.85;color:var(--text)">${n.content || '<p><em>Kosong</em></p>'}</div>
          </article>`).join('<hr style="border:0;border-top:1px solid var(--divider);margin:var(--space-7) 0">')}
      </div>
    </main>`;

  $('#btnReaderBack', container).onclick = () => ctx.back();
  const btnReaderTOC = $('#btnReaderTOC', container);
  if (btnReaderTOC) btnReaderTOC.onclick = () => {
    const html = `<ol style="line-height:2.2">${notes.map((n, i) => `<li><a href="#reader-note-${n.id}" style="color:var(--accent)">${escapeHtml(n.title || 'Bab ' + (i+1))}</a></li>`).join('')}</ol>`;
    openSheet(html, { title: 'Daftar Isi' });
  };
}
