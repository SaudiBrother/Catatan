/* ==========================================================================
   CATAT — editor.js
   The full-screen note editor: two-row topbar (back/undo/redo/fav/share/
   more + date/category), title, floating vertical toolbar, contenteditable
   body with unified checklist/bullet/number lists, attachments, voice notes,
   backlinks, autosave + granular undo/redo + periodic version snapshots.
   ========================================================================== */

import {
  getNote, updateNote, deleteNote, toggleFavorite, togglePin, toggleArchive,
  toggleNoteLock, duplicateNote, getAllFolders, folderPath, isFolderLocked,
  getMasterKey, getAttachmentsByNote, deleteAttachment, getAttachment,
  getVersions, restoreVersion, saveVersion, getAllNotes, findNoteByTitle,
  createNote, addReminder, countWords, extractChecklist,
} from './db.js';
import {
  $, $$, icon, escapeHtml, debounce, fmtRelative, fmtDateLong,
  openSheet, promptDialog, confirmDialog, showToast, hapticTap,
  FOLDER_COLORS,
} from './ui.js';
import { pickFiles, openVoiceRecorder, openScanFlow, openDrawCanvas, openAttachMenu, attachmentPreviewHTML } from './attachments.js';
import { createHistory } from './history.js';
import { migrateLegacyChecklist, toggleListType, renumberLists, refreshAddItemAffordance, wireListEvents } from './richlist.js';
import { openFontPanel } from './fontpanel.js';
import { createVerticalToolbar } from './vtoolbar.js';
import { openShareSheet, openQuickLink, openReadAloudSheet, stopSpeaking, parseBlocks } from './share.js';
import { openCategoryPicker, guardCategoryAccess } from './categories.js';
import { ensureAuthenticated } from './auth.js';

let _objectUrls = [];
let _savedRange = null;
let _katexLoaded = false;
let _mermaidLoaded = false;

/* ---------------- Selection helpers ---------------- */
function saveSelection() {
  const sel = window.getSelection();
  if (sel.rangeCount) _savedRange = sel.getRangeAt(0).cloneRange();
}
function restoreSelection(contentEl) {
  contentEl.focus();
  if (!_savedRange) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(_savedRange);
}
function wrapSelection(tagName, className) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const wrapper = document.createElement(tagName);
  if (className) wrapper.className = className;
  try {
    range.surroundContents(wrapper);
  } catch {
    const frag = range.extractContents();
    wrapper.appendChild(frag);
    range.insertNode(wrapper);
  }
  sel.removeAllRanges();
  const r2 = document.createRange();
  r2.selectNodeContents(wrapper);
  r2.collapse(false);
  sel.addRange(r2);
  return true;
}

/* ---------------- Wiki links ---------------- */
export function linkifyAllWikiSyntax(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest('.wiki-link, .math-inline, .mermaid-block, pre, code')) continue;
    const text = node.textContent;
    if (!/\[\[[^[\]]+\]\]/.test(text)) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    const re = /\[\[([^[\]]+)\]\]/g;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const a = document.createElement('a');
      a.className = 'wiki-link'; a.href = '#'; a.dataset.wiki = m[1].trim(); a.contentEditable = 'false';
      a.textContent = m[1].trim();
      frag.appendChild(a);
      last = re.lastIndex;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}
async function markBrokenLinks(container) {
  const links = $$('.wiki-link', container);
  for (const a of links) {
    const target = await findNoteByTitle(a.dataset.wiki);
    a.classList.toggle('broken', !target);
  }
}
function convertWikiNearCaret(contentEl) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const text = node.textContent;
  const offset = range.startOffset;
  const before = text.slice(0, offset);
  const m = before.match(/\[\[([^[\]]{1,80})\]\]$/);
  if (!m) return;
  const title = m[1].trim();
  if (!title) return;
  const start = m.index;
  const a = document.createElement('a');
  a.className = 'wiki-link'; a.href = '#'; a.dataset.wiki = title; a.contentEditable = 'false';
  a.textContent = title;
  const spacer = document.createTextNode('\u00A0');
  const r = document.createRange();
  r.setStart(node, start); r.setEnd(node, offset);
  r.deleteContents();
  r.insertNode(spacer);
  r.insertNode(a);
  const r2 = document.createRange();
  r2.setStartAfter(spacer); r2.collapse(true);
  sel.removeAllRanges(); sel.addRange(r2);
  findNoteByTitle(title).then(t => a.classList.toggle('broken', !t));
}

/* ---------------- Math (KaTeX, lazy CDN) ---------------- */
async function loadKatex() {
  if (_katexLoaded || window.katex) { _katexLoaded = true; return; }
  await new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css';
    document.head.appendChild(link);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  _katexLoaded = true;
}
export async function renderMath(container) {
  const spans = $$('.math-inline[data-latex]:not([data-rendered])', container);
  if (!spans.length) return;
  try { await loadKatex(); } catch { return; }
  for (const el of spans) {
    try {
      window.katex.render(el.dataset.latex, el, { throwOnError: false, displayMode: el.dataset.display === 'true' });
      el.dataset.rendered = 'true';
    } catch { /* leave raw text on failure */ }
  }
}

/* ---------------- Diagrams (Mermaid, lazy CDN) ---------------- */
async function loadMermaid() {
  if (_mermaidLoaded || window.mermaid) { _mermaidLoaded = true; return; }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.type = 'module';
    s.textContent = `import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs'; window.mermaid = mermaid; mermaid.initialize({ startOnLoad:false, theme:'neutral' }); window.dispatchEvent(new Event('mermaid-ready'));`;
    window.addEventListener('mermaid-ready', resolve, { once: true });
    s.onerror = reject;
    document.head.appendChild(s);
    setTimeout(resolve, 4000);
  });
  _mermaidLoaded = true;
}
export async function renderDiagrams(container) {
  const blocks = $$('.mermaid-block[data-code]:not([data-rendered])', container);
  if (!blocks.length) return;
  try { await loadMermaid(); } catch { return; }
  for (const el of blocks) {
    try {
      const id = 'mmd-' + Math.random().toString(36).slice(2);
      const { svg } = await window.mermaid.render(id, el.dataset.code);
      el.innerHTML = svg;
      el.dataset.rendered = 'true';
    } catch { el.innerHTML = `<pre>${escapeHtml(el.dataset.code)}</pre>`; el.dataset.rendered = 'true'; }
  }
}

/* ---------------- Attachment hydration ---------------- */
export async function hydrateAttachments(container) {
  const els = $$('[data-attachment-id]', container);
  for (const el of els) {
    const id = el.dataset.attachmentId;
    if (el.src && el.src.startsWith('blob:')) continue;
    const att = await getAttachment(id);
    if (!att) { el.replaceWith(Object.assign(document.createElement('span'), { className: 'tertiary', textContent: '[lampiran hilang]' })); continue; }
    const url = URL.createObjectURL(att.blob);
    _objectUrls.push(url);
    el.src = url;
  }
}
function revokeObjectUrls() { _objectUrls.forEach(u => URL.revokeObjectURL(u)); _objectUrls = []; }

/** What actually gets persisted to IndexedDB: a clone with runtime-only bits
 *  stripped out — blob: src attributes (session-specific, would 404 after a
 *  reload) and any leftover find-in-note highlight marks. */
function getCleanContentHTML(contentEl) {
  const clone = contentEl.cloneNode(true);
  $$('[data-attachment-id]', clone).forEach((el) => { if (el.hasAttribute('src')) el.removeAttribute('src'); });
  $$('.find-hit', clone).forEach((span) => { span.replaceWith(document.createTextNode(span.textContent)); });
  $$('.li-add-btn', clone).forEach((btn) => btn.remove());
  return clone.innerHTML;
}

/* ---------------- Table helpers ---------------- */
function closestTable(contentEl) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  node = node.nodeType === 3 ? node.parentElement : node;
  return node?.closest && contentEl.contains(node) ? node.closest('table') : null;
}
function addTableRow(table) {
  if (!table) return;
  const cols = table.rows[0]?.cells.length || 2;
  const row = table.insertRow(-1);
  for (let i = 0; i < cols; i++) row.insertCell(-1).innerHTML = '\u00A0';
}
function addTableCol(table) {
  if (!table) return;
  for (const row of table.rows) {
    const cell = row.insertCell(-1);
    cell.innerHTML = '\u00A0';
    if (row.parentElement.tagName === 'THEAD' || row === table.rows[0]) cell.style.fontWeight = '700';
  }
}

/* ---------------- Vertical toolbar config ---------------- */
const VTB_PRIMARY = [
  { id: 'font', icon: 'type', label: 'Font' },
  { id: 'checklist', icon: 'checklist', label: 'Checklist' },
  { id: 'voice', icon: 'mic', label: 'Rekam suara' },
  { id: 'draw', icon: 'draw', label: 'Coret-coret' },
  { id: 'image', icon: 'image', label: 'Gambar' },
  { id: 'emoji', icon: 'emoji', label: 'Emoji' },
  { id: 'highlight', icon: 'highlight', label: 'Sorot' },
  { id: 'bulletlist', icon: 'listBullet', label: 'Bullet' },
  { id: 'numberlist', icon: 'listNumber', label: 'Nomor' },
  { id: 'attach', icon: 'attach', label: 'Lampirkan' },
];
const VTB_SECONDARY = [
  { id: 'table', icon: 'table', label: 'Tabel' },
  { id: 'quote', icon: 'quote', label: 'Kutipan' },
  { id: 'code', icon: 'code', label: 'Kode' },
  { id: 'math', icon: 'sigma', label: 'Rumus' },
  { id: 'diagram', icon: 'diagram', label: 'Diagram' },
  { id: 'link', icon: 'link', label: 'Tautan' },
  { id: 'scan', icon: 'scan', label: 'Pindai dokumen' },
  { id: 'addrow', icon: 'table', label: 'Tambah baris' },
  { id: 'addcol', icon: 'table', label: 'Tambah kolom' },
];

const EMOJI_SETS = {
  'Sering': ['😀', '😂', '🥰', '😎', '🤔', '👍', '🙏', '🔥', '✨', '🎉', '❤️', '✅'],
  'Belajar': ['📚', '✏️', '🧪', '🔬', '➗', '🧠', '💡', '📐', '🧮', '🎓', '📝', '🗂️'],
  'Game & Hobi': ['🎮', '🕹️', '👾', '🎲', '🎨', '🎵', '🎬', '📷', '🏀', '⚽', '🚴', '🏆'],
  'Objek': ['📌', '📎', '🔗', '💾', '🔒', '⏰', '📅', '🗓️', '📦', '💬', '⭐', '🚀'],
};

/* ---------------- Backlinks ---------------- */
async function computeBacklinks(noteTitle, selfId) {
  const all = await getAllNotes();
  return all.filter(n => n.id !== selfId && new RegExp(`\\[\\[\\s*${noteTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]\\]`, 'i').test(n.content || ''));
}

/* ---------------- Version history sheet ---------------- */
async function openVersionHistory(noteId, ctx) {
  const versions = await getVersions(noteId);
  const html = versions.length
    ? versions.map(v => `
      <div class="note-row" data-vid="${v.id}">
        <div class="body">
          <div class="title-line">${escapeHtml(v.title || 'Tanpa judul')}</div>
          <div class="meta">${fmtRelative(v.timestamp)} · ${countWords(v.content)} kata</div>
        </div>
        <button class="btn btn-sm btn-soft" data-restore="${v.id}">Pulihkan</button>
      </div>`).join('')
    : `<div class="empty-state"><div class="e-icon">♻️</div><div class="e-title">Belum ada versi tersimpan</div><p>Snapshot otomatis dibuat secara berkala selagi kamu mengedit catatan ini.</p></div>`;
  const { el, close } = openSheet(`<div class="row-list">${html}</div>`, { title: 'Riwayat Versi' });
  $$('[data-restore]', el).forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog('Versi ini akan menggantikan isi catatan saat ini.', { title: 'Pulihkan versi?', okLabel: 'Pulihkan' });
    if (!ok) return;
    await restoreVersion(b.dataset.restore);
    close();
    showToast('Versi dipulihkan', { icon: 'history' });
    ctx.rerender();
  });
}

/* ---------------- Note detail sheet ---------------- */
async function openNoteDetailSheet(note, contentEl, folders) {
  const html = contentEl.innerHTML;
  const words = countWords(html);
  const chars = (contentEl.textContent || '').length;
  const readMins = Math.max(1, Math.round(words / 200));
  const checklist = extractChecklist(html);
  const attachments = await getAttachmentsByNote(note.id);
  const rows = [
    ['Kategori', escapeHtml(folderPath(folders, note.folderId) || 'Tanpa Kategori')],
    ['Dibuat', escapeHtml(fmtDateLong(note.createdAt))],
    ['Diperbarui', escapeHtml(fmtRelative(note.updatedAt))],
    ['Jumlah kata', String(words)],
    ['Jumlah karakter', String(chars)],
    ['Estimasi baca', `${readMins} menit`],
  ];
  if (checklist.length) rows.push(['Checklist', `${checklist.filter(c => c.done).length}/${checklist.length} selesai`]);
  if (attachments.length) rows.push(['Lampiran', `${attachments.length} berkas`]);
  rows.push(['Status kunci', note.locked ? '🔒 Dikunci' : 'Tidak dikunci']);
  const html2 = `
    <div class="fp-header"><span class="fp-header-title">Detail Catatan</span></div>
    <div class="detail-grid">
      ${rows.map(([k, v]) => `<div class="detail-row"><span>${k}</span><b>${v}</b></div>`).join('')}
    </div>`;
  openSheet(html2);
}

/* ---------------- Find-in-note ---------------- */
function openFindBar(container, contentEl) {
  if ($('#findBar', container)) { $('#findInput', container).focus(); return; }
  const bar = document.createElement('div');
  bar.className = 'find-bar';
  bar.id = 'findBar';
  bar.innerHTML = `
    ${icon('search', 15)}
    <input type="text" id="findInput" placeholder="Cari dalam catatan…" autocomplete="off">
    <span class="find-count" id="findCount"></span>
    <button class="icon-btn plain" id="findPrev" aria-label="Sebelumnya">${icon('chevronUp', 16)}</button>
    <button class="icon-btn plain" id="findNext" aria-label="Berikutnya">${icon('chevronDown', 16)}</button>
    <button class="icon-btn plain" id="findClose" aria-label="Tutup">${icon('close', 16)}</button>
  `;
  const main = $('main', container);
  container.insertBefore(bar, main);
  requestAnimationFrame(() => bar.classList.add('show'));

  let matches = [], idx = -1;
  function clearHighlights() {
    $$('.find-hit', contentEl).forEach((span) => { span.replaceWith(document.createTextNode(span.textContent)); });
    contentEl.normalize();
  }
  function goTo(i) {
    if (!matches.length) return;
    if (idx >= 0 && matches[idx]) matches[idx].classList.remove('active');
    idx = ((i % matches.length) + matches.length) % matches.length;
    matches[idx].classList.add('active');
    matches[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('#findCount', bar).textContent = `${idx + 1}/${matches.length}`;
  }
  function runSearch(q) {
    clearHighlights();
    matches = []; idx = -1;
    const term = q.trim();
    if (!term) { $('#findCount', bar).textContent = ''; return; }
    const lowerQ = term.toLowerCase();
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) { if (!n.parentElement?.closest('.find-hit')) textNodes.push(n); }
    textNodes.forEach((node) => {
      const text = node.textContent;
      const lower = text.toLowerCase();
      const positions = [];
      let start = 0, pos;
      while ((pos = lower.indexOf(lowerQ, start)) !== -1) { positions.push(pos); start = pos + lowerQ.length; }
      if (!positions.length) return;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      positions.forEach((p) => {
        if (p > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, p)));
        const mark = document.createElement('span');
        mark.className = 'find-hit';
        mark.textContent = text.slice(p, p + term.length);
        frag.appendChild(mark);
        matches.push(mark);
        cursor = p + term.length;
      });
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      node.parentNode.replaceChild(frag, node);
    });
    $('#findCount', bar).textContent = matches.length ? '' : 'Tidak ditemukan';
    if (matches.length) goTo(0);
  }
  const input = $('#findInput', bar);
  input.addEventListener('input', () => runSearch(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') goTo(idx + (e.shiftKey ? -1 : 1)); if (e.key === 'Escape') closeBar(); });
  $('#findNext', bar).onclick = () => goTo(idx + 1);
  $('#findPrev', bar).onclick = () => goTo(idx - 1);
  function closeBar() {
    clearHighlights();
    bar.classList.remove('show');
    setTimeout(() => bar.remove(), 200);
  }
  $('#findClose', bar).onclick = closeBar;
  setTimeout(() => input.focus(), 260);
}

/* ---------------- Small input sheets ---------------- */
function openEmojiSheet(contentEl, commit) {
  const html = Object.entries(EMOJI_SETS).map(([cat, list]) => `
    <div class="tertiary" style="font-size:11px;font-weight:700;text-transform:uppercase;margin:10px 0 6px">${cat}</div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">
      ${list.map(e => `<button class="icon-btn plain" style="font-size:22px;height:42px" data-emoji="${e}">${e}</button>`).join('')}
    </div>`).join('');
  const { el, close } = openSheet(html, { title: 'Emoji' });
  $$('[data-emoji]', el).forEach(b => b.onclick = () => {
    restoreSelection(contentEl);
    document.execCommand('insertText', false, b.dataset.emoji);
    commit(true);
    close();
  });
}
function openMathSheet(contentEl, commit) {
  const { el, close } = openSheet(`
    <textarea class="field" id="latexInput" rows="2" placeholder="contoh: E = mc^2  atau  \\frac{a}{b}"></textarea>
    <div id="mathPreview" style="min-height:40px;margin:12px 0;font-size:18px"></div>
    <button class="btn btn-primary btn-block" id="insertMath">Sisipkan Rumus</button>
  `, { title: 'Rumus Matematika' });
  const input = $('#latexInput', el);
  const preview = $('#mathPreview', el);
  loadKatex().then(() => {
    input.addEventListener('input', () => { try { window.katex.render(input.value, preview, { throwOnError: false }); } catch {} });
  });
  $('#insertMath', el).onclick = () => {
    if (!input.value.trim()) { close(); return; }
    restoreSelection(contentEl);
    const latex = escapeHtml(input.value).replace(/"/g, '&quot;');
    document.execCommand('insertHTML', false, `<span class="math-inline" contenteditable="false" data-latex="${input.value.replace(/"/g, '&quot;')}">${latex}</span>&nbsp;`);
    renderMath(contentEl);
    commit(true);
    close();
  };
}
function openDiagramSheet(contentEl, commit) {
  const { el, close } = openSheet(`
    <p class="muted" style="margin-bottom:8px">Sintaks Mermaid — flowchart, mindmap sederhana, dsb.</p>
    <textarea class="field" id="mmdInput" rows="6" placeholder="graph TD\nA[Mulai] --> B{Keputusan}\nB -->|Ya| C[Selesai]\nB -->|Tidak| A"></textarea>
    <button class="btn btn-primary btn-block" style="margin-top:12px" id="insertMmd">Sisipkan Diagram</button>
  `, { title: 'Diagram' });
  $('#insertMmd', el).onclick = () => {
    const code = $('#mmdInput', el).value.trim();
    if (!code) { close(); return; }
    restoreSelection(contentEl);
    document.execCommand('insertHTML', false, `<div class="mermaid-block" contenteditable="false" data-code="${escapeHtml(code)}"><pre>${escapeHtml(code)}</pre></div><p><br></p>`);
    renderDiagrams(contentEl);
    commit(true);
    close();
  };
}
function openLinkSheet(contentEl, commit) {
  const { el, close } = openSheet(`
    <input class="field" id="linkText" placeholder="Teks tautan" style="margin-bottom:8px">
    <input class="field" id="linkUrl" placeholder="https://...">
    <button class="btn btn-primary btn-block" style="margin-top:12px" id="insertLink">Sisipkan Tautan</button>
  `, { title: 'Tautan' });
  $('#insertLink', el).onclick = () => {
    const url = $('#linkUrl', el).value.trim();
    if (!url) { close(); return; }
    const text = $('#linkText', el).value.trim() || url;
    restoreSelection(contentEl);
    document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>&nbsp;`);
    commit(true);
    close();
  };
}
async function openTagEditor(note, ctx) {
  const v = await promptDialog('Pisahkan dengan koma', { title: 'Edit Tag', value: (note.tags || []).join(', '), placeholder: 'sekolah, penting, revisi' });
  if (v === null) return;
  note.tags = v.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
  await updateNote(note.id, { tags: note.tags }, 'Tag diubah');
  ctx.rerender();
}
async function openColorPicker(note, ctx) {
  const html = `<div class="chip-row">
    <span class="swatch swatch-none${!note.color ? ' active' : ''}" data-color="">${icon('close', 12)}</span>
    ${FOLDER_COLORS.map(c => `<span class="swatch${note.color === c ? ' active' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}
  </div>`;
  const { el, close } = openSheet(html, { title: 'Warna catatan' });
  $$('[data-color]', el).forEach(s => s.onclick = async () => {
    note.color = s.dataset.color || null;
    await updateNote(note.id, { color: note.color }, 'Warna diubah');
    close();
    ctx.rerender();
  });
}
async function openReminderSheet(note) {
  const { el, close } = openSheet(`
    <input class="field" id="remTitle" placeholder="Judul pengingat" value="${escapeHtml(note.title || '')}" style="margin-bottom:8px">
    <input class="field" id="remTime" type="datetime-local">
    <button class="btn btn-primary btn-block" style="margin-top:12px" id="saveRem">Pasang Pengingat</button>
    <p class="muted" style="margin-top:10px;font-size:12px">Notifikasi tampil lewat browser selama aplikasi berjalan di latar. Untuk hasil terbaik, izinkan notifikasi & jaga tab tetap aktif.</p>
  `, { title: 'Pengingat' });
  $('#saveRem', el).onclick = async () => {
    const dt = $('#remTime', el).value;
    if (!dt) { close(); return; }
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    await addReminder(note.id, $('#remTitle', el).value || note.title, new Date(dt).toISOString());
    showToast('Pengingat dipasang', { icon: 'bell' });
    close();
  };
}
async function openWikiTarget(title, ctx) {
  let target = await findNoteByTitle(title);
  if (!target) { target = await createNote({ title, content: '' }); showToast(`Catatan "${title}" dibuat`, { icon: 'plus' }); }
  ctx.navigate('#/note/' + target.id);
}

/* ---------------- "..." overflow menu (quick row + scrollable list) ---------------- */
function openMoreMenu(note, ctx, handlers) {
  const locked = !!(note._locked || note.locked);
  const quick = [
    ['pin', note.pinned ? 'pinOff' : 'pin', note.pinned ? 'Lepas' : 'Sematkan', note.pinned],
    ['reminder', 'bell', 'Pengingat', false],
    ['lock', locked ? 'lock' : 'unlock', 'Kunci', locked],
  ];
  const list = [
    ['reader', 'reader', 'Mode Membaca'],
    ['tag', 'hash', 'Tambahkan Tag'],
    ['find', 'search', 'Cari dalam Catatan'],
    ['detail', 'info', 'Detail Catatan'],
    ['duplicate', 'copy', 'Duplikat Catatan'],
    ['widget', 'qrcode', 'QR & Tautan Cepat'],
    ['pdf', 'file', 'Ekspor ke PDF'],
    ['speak', 'speaker', 'Baca Catatan'],
    ['fav', 'star', note.favorite ? 'Hapus dari Favorit' : 'Tambahkan ke Favorit'],
    ['history', 'history', 'Riwayat Versi'],
    ['archive', note.archived ? 'archiveRestore' : 'archive', note.archived ? 'Keluarkan dari Arsip' : 'Arsipkan'],
    ['delete', 'trash', 'Hapus Catatan'],
  ];
  const html = `
    <div class="more-quick-row">
      ${quick.map(([act, ic, label, on]) => `
        <button class="more-quick-btn" data-act="${act}">
          <span class="mq-ic${on ? ' on' : ''}">${icon(ic, 21)}</span>
          <span>${escapeHtml(label)}</span>
        </button>`).join('')}
    </div>
    <div class="sheet-list-sep"></div>
    ${list.map(([act, ic, label]) => `<button class="sheet-item${act === 'delete' ? ' danger' : ''}" data-act="${act}">${icon(ic)}<span>${escapeHtml(label)}</span></button>`).join('')}
  `;
  const { el, close } = openSheet(html, { title: note.title || 'Catatan' });
  $$('[data-act]', el).forEach(btn => btn.onclick = () => { close(); handlers[btn.dataset.act]?.(); });
}

/* ---------------- Locked-note placeholder ---------------- */
function renderLockedNotePlaceholder(container, ctx) {
  container.innerHTML = `
    <div class="topbar"><button class="icon-btn plain" id="btnLockedBack">${icon('chevronLeft', 22)}</button><span class="tb-title">Terkunci</span><span style="width:40px"></span></div>
    <div class="empty-state" style="margin-top:90px">
      <div class="e-icon">🔒</div>
      <div class="e-title">Catatan Terkunci</div>
      <p>Masukkan PIN untuk membuka catatan ini.</p>
      <button class="btn btn-primary" id="btnUnlockNote" style="margin-top:16px">${icon('lock', 16)}<span>Buka Kunci</span></button>
    </div>`;
  $('#btnLockedBack', container).onclick = () => ctx.back();
  $('#btnUnlockNote', container).onclick = async () => {
    const ok = await ensureAuthenticated({ reason: 'Masukkan PIN untuk membuka catatan ini' });
    if (ok) ctx.rerender();
  };
}

function fmtNoteDate(iso) {
  const d = new Date(iso || Date.now());
  const now = new Date();
  const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Hari Ini, ${time}`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Kemarin, ${time}`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + `, ${time}`;
}

/* ---------------- Main view ---------------- */
export async function renderNoteView(container, { id }, ctx) {
  revokeObjectUrls();
  stopSpeaking();
  let note = await getNote(id);
  if (!note) { container.innerHTML = `<div class="empty-state"><div class="e-icon">🗒️</div><div class="e-title">Catatan tidak ditemukan</div></div>`; return; }

  const folders = await getAllFolders();

  const folderGateNeeded = isFolderLocked(folders, note.folderId) && !getMasterKey();
  if (note._locked || folderGateNeeded) {
    const ok = await ensureAuthenticated({ reason: 'Catatan ini terkunci. Masukkan PIN untuk membukanya.' });
    if (ok && note._locked) note = await getNote(id);
    if (!ok || note._locked) { renderLockedNotePlaceholder(container, ctx); return; }
  }

  const backlinks = await computeBacklinks(note.title || '', note.id);
  const attachments = await getAttachmentsByNote(note.id);
  const voiceNotes = attachments.filter(a => (a.mime || a.type || '').startsWith('audio/'));
  const fileAttachments = attachments.filter(a => !(a.mime || a.type || '').startsWith('audio/'));
  const folder = folders.find(f => f.id === note.folderId) || null;

  container.innerHTML = `
    <div class="topbar note-tb-row1">
      <button class="icon-btn plain" id="btnBack">${icon('chevronLeft', 22)}</button>
      <button class="icon-btn plain" id="btnUndo" aria-label="Undo">${icon('undo', 19)}</button>
      <button class="icon-btn plain" id="btnRedo" aria-label="Redo">${icon('redo', 19)}</button>
      <span style="flex:1"></span>
      <button class="icon-btn plain" id="btnFav">${icon('star', 20)}</button>
      <button class="icon-btn plain" id="btnShare">${icon('shareIcon', 20)}</button>
      <button class="icon-btn plain" id="btnMore">${icon('moreVert', 20)}</button>
    </div>
    <div class="note-tb-row2">
      <span class="note-meta-date">${fmtNoteDate(note.updatedAt)}</span>
      <button class="cat-chip-topbar" id="categoryChip">
        <span class="cct-ic">${folder ? (folder.icon || '📁') : icon('category', 13)}</span>
        <span>${escapeHtml(folder?.name || 'Tanpa Kategori')}</span>
        ${icon('chevronDown', 13)}
      </button>
    </div>
    <main id="noteScroll" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;position:relative">
      <span class="save-indicator" id="saveIndicator"></span>
      <div class="view-pad view-enter">
        <input class="note-title-input" id="titleInput" placeholder="Judul catatan" value="${escapeHtml(note.title)}">
        <div class="chip-row" style="margin-bottom:14px">
          ${note.pinned ? `<span class="tag tag-static">${icon('pin', 12)} Disematkan</span>` : ''}
          ${(note.tags || []).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}
          <button class="tag" id="tagChip">+ Tag</button>
          <span class="swatch" id="colorChip" style="background:${note.color || 'var(--accent)'}"></span>
        </div>
        <div id="richContent" class="rich-content" contenteditable="true" data-placeholder="Tulis sesuatu... gunakan [[Judul]] untuk wiki-link">${note.content || ''}</div>

        <div id="attachSection" style="margin-top:20px">
          ${fileAttachments.length ? `<div class="section-title" style="margin-top:0">Lampiran</div><div class="attach-grid" id="attachGrid">${fileAttachments.map(attachmentPreviewHTML).join('')}</div>` : ''}
          ${voiceNotes.length ? `<div class="section-title">Voice Note</div><div class="row-list" id="voiceList">${voiceNotes.map((v, i) => voiceRowHTML(v, i)).join('')}</div>` : ''}
        </div>

        ${backlinks.length ? `
        <div class="section-title">Dipakai oleh</div>
        <div class="row-list">${backlinks.map(n => `<button class="note-row" data-open="${n.id}"><span class="dot" style="background:${n.color || 'var(--accent)'}"></span><div class="body"><div class="title-line">${escapeHtml(n.title || 'Tanpa judul')}</div><div class="meta">${fmtRelative(n.updatedAt)}</div></div></button>`).join('')}</div>
        ` : ''}
        <div class="note-footer-stats" id="noteFooterStats"></div>
        <div style="height:100px"></div>
      </div>
    </main>
  `;

  const titleInput = $('#titleInput', container);
  const contentEl = $('#richContent', container);

  linkifyAllWikiSyntax(contentEl);
  migrateLegacyChecklist(contentEl);
  await hydrateAttachments(contentEl);
  renderMath(contentEl);
  renderDiagrams(contentEl);
  markBrokenLinks(contentEl);
  renumberLists(contentEl);
  refreshAddItemAffordance(contentEl);

  /* ---------------- Word-count footer ---------------- */
  function updateFooterStats() {
    const words = countWords(contentEl.innerHTML);
    const mins = Math.max(1, Math.round(words / 200));
    const cl = extractChecklist(contentEl.innerHTML);
    const bits = [`${words} kata`, `${mins} mnt baca`];
    if (cl.length) bits.push(`${cl.filter(c => c.done).length}/${cl.length} selesai`);
    $('#noteFooterStats', container).textContent = bits.join(' · ');
  }
  updateFooterStats();

  /* ---------------- Save indicator ---------------- */
  let saveIndicatorTimer = null;
  function showSaving() {
    const el = $('#saveIndicator', container);
    if (!el) return;
    clearTimeout(saveIndicatorTimer);
    el.textContent = 'Menyimpan…';
    el.classList.add('show');
  }
  function showSaved() {
    const el = $('#saveIndicator', container);
    if (!el) return;
    el.textContent = 'Tersimpan';
    saveIndicatorTimer = setTimeout(() => el.classList.remove('show'), 1100);
  }

  /* ---------------- Autosave + history ---------------- */
  let dirty = false;
  let lastVersionAt = 0;
  const saveToDb = debounce(async () => {
    const title = titleInput.value || '';
    const content = getCleanContentHTML(contentEl);
    note = await updateNote(note.id, { title, content });
    if (Date.now() - lastVersionAt > 120000) { lastVersionAt = Date.now(); saveVersion(note.id, title, content).catch(() => {}); }
    showSaved();
  }, 650);

  const history = createHistory({
    getState: () => ({ title: titleInput.value, html: contentEl.innerHTML }),
    applyState: (state) => {
      titleInput.value = state.title;
      contentEl.innerHTML = state.html;
      hydrateAttachments(contentEl);
      renderMath(contentEl);
      renderDiagrams(contentEl);
      markBrokenLinks(contentEl);
      renumberLists(contentEl);
      refreshAddItemAffordance(contentEl);
      updateFooterStats();
      showSaving();
      saveToDb();
    },
  });

  function refreshUndoRedoUI() {
    const u = $('#btnUndo', container), r = $('#btnRedo', container);
    if (u) u.style.opacity = history.canUndo() ? '1' : '.32';
    if (r) r.style.opacity = history.canRedo() ? '1' : '.32';
  }
  refreshUndoRedoUI();

  function commit(forceBreak = false) {
    dirty = true;
    history.record(forceBreak);
    refreshUndoRedoUI();
    showSaving();
    saveToDb();
    updateFooterStats();
  }

  titleInput.addEventListener('input', (e) => commit(e.inputType !== 'insertText'));
  contentEl.addEventListener('input', (e) => {
    if (e.inputType === 'insertText' && e.data === ']') convertWikiNearCaret(contentEl);
    const isPlainTyping = e.inputType === 'insertText' || e.inputType === 'insertCompositionText';
    commit(!isPlainTyping);
  });

  /* Unified checklist / bullet / number list engine */
  wireListEvents(contentEl, {
    commit,
    onStructural: () => hapticTap(6),
  });

  contentEl.addEventListener('click', (e) => {
    const wikiA = e.target.closest('.wiki-link');
    if (wikiA) { e.preventDefault(); openWikiTarget(wikiA.dataset.wiki, ctx); }
  });
  $$('[data-open]', container).forEach(b => b.onclick = () => ctx.navigate('#/note/' + b.dataset.open));

  /* ---------------- Topbar wiring ---------------- */
  $('#btnBack', container).onclick = () => ctx.back();
  $('#btnUndo', container).onclick = () => { history.undo(); refreshUndoRedoUI(); hapticTap(8); };
  $('#btnRedo', container).onclick = () => { history.redo(); refreshUndoRedoUI(); hapticTap(8); };

  const favBtn = $('#btnFav', container);
  const syncFavIcon = () => { favBtn.style.color = note.favorite ? 'var(--warning)' : ''; };
  syncFavIcon();
  favBtn.onclick = async () => { note = await toggleFavorite(note.id); syncFavIcon(); showToast(note.favorite ? 'Ditambah ke favorit' : 'Dihapus dari favorit', { icon: 'star' }); };

  $('#btnShare', container).onclick = () => openShareSheet(note);

  $('#categoryChip', container).onclick = async () => {
    const target = folder ? folder.id : null;
    const okGate = await guardCategoryAccess(target, folders);
    if (!okGate) return;
    openCategoryPicker(note.folderId, async (newId) => {
      note.folderId = newId;
      await updateNote(note.id, { folderId: newId }, 'Kategori diubah');
      ctx.rerender();
    });
  };
  $('#tagChip', container).onclick = () => openTagEditor(note, ctx);
  $('#colorChip', container).onclick = () => openColorPicker(note, ctx);

  $('#btnMore', container).onclick = () => openMoreMenu(note, ctx, {
    pin: async () => { note = await togglePin(note.id); showToast(note.pinned ? 'Disematkan' : 'Sematan dilepas', { icon: 'pin' }); ctx.rerender(); },
    reminder: () => openReminderSheet(note),
    lock: async () => {
      const wantLock = !(note._locked || note.locked);
      const ok = await ensureAuthenticated({ reason: wantLock ? 'Buat atau masukkan PIN untuk mengunci catatan ini' : 'Masukkan PIN untuk membuka kunci catatan ini' });
      if (!ok) return;
      try { note = await toggleNoteLock(note.id, wantLock); showToast(wantLock ? 'Catatan dikunci' : 'Kunci dibuka', { icon: 'lock' }); ctx.rerender(); }
      catch { showToast('Gagal mengubah kunci catatan'); }
    },
    reader: () => ctx.navigate('#/note/' + note.id + '/reader'),
    tag: () => openTagEditor(note, ctx),
    find: () => openFindBar(container, contentEl),
    detail: () => openNoteDetailSheet(note, contentEl, folders),
    duplicate: async () => { const copy = await duplicateNote(note.id); showToast('Catatan diduplikat', { icon: 'copy' }); ctx.navigate('#/note/' + copy.id); },
    widget: () => openQuickLink(note),
    pdf: () => openShareSheet(note),
    speak: () => openReadAloudSheet(note, parseBlocks(contentEl.innerHTML)),
    fav: async () => { note = await toggleFavorite(note.id); syncFavIcon(); showToast(note.favorite ? 'Ditambah ke favorit' : 'Dihapus dari favorit', { icon: 'star' }); },
    history: () => openVersionHistory(note.id, ctx),
    archive: async () => { note = await toggleArchive(note.id); showToast(note.archived ? 'Diarsipkan' : 'Dikeluarkan dari arsip', { icon: 'archive' }); if (note.archived) ctx.navigate('#/'); },
    delete: async () => {
      const ok = await confirmDialog('Catatan akan dipindah ke Sampah selama 30 hari sebelum terhapus permanen.', { title: 'Hapus catatan?', okLabel: 'Hapus', danger: true });
      if (ok) { await deleteNote(note.id); showToast('Dipindah ke Sampah', { icon: 'trash' }); ctx.navigate('#/'); }
    },
  });

  /* ---------------- Attachments / voice ---------------- */
  function insertInlineImage(att) {
    restoreSelection(contentEl);
    document.execCommand('insertHTML', false, `<img data-attachment-id="${att.id}" alt="${escapeHtml(att.name)}"><p><br></p>`);
    hydrateAttachments(contentEl);
    commit(true);
  }
  async function refreshAttachSection() {
    const atts = await getAttachmentsByNote(note.id);
    const voice = atts.filter(a => (a.mime || a.type || '').startsWith('audio/'));
    const files = atts.filter(a => !(a.mime || a.type || '').startsWith('audio/'));
    const section = $('#attachSection', container);
    section.innerHTML = `
      ${files.length ? `<div class="section-title" style="margin-top:0">Lampiran</div><div class="attach-grid">${files.map(attachmentPreviewHTML).join('')}</div>` : ''}
      ${voice.length ? `<div class="section-title">Voice Note</div><div class="row-list">${voice.map((v, i) => voiceRowHTML(v, i)).join('')}</div>` : ''}
    `;
    wireVoiceRows(section);
    wireAttachDelete(section);
  }
  function wireAttachDelete(scope) {
    $$('[data-del-att]', scope).forEach(b => b.onclick = async () => {
      const ok = await confirmDialog('Hapus lampiran ini?', { okLabel: 'Hapus', danger: true });
      if (!ok) return;
      await deleteAttachment(b.dataset.delAtt);
      refreshAttachSection();
    });
    $$('[data-open-att]', scope).forEach(b => b.onclick = async () => {
      const att = await getAttachment(b.dataset.openAtt);
      if (!att) return;
      const url = URL.createObjectURL(att.blob); _objectUrls.push(url);
      window.open(url, '_blank');
    });
  }
  wireAttachDelete(container);
  wireVoiceRows(container);

  /* ---------------- Floating vertical toolbar ---------------- */
  const vtb = createVerticalToolbar($('main', container), {
    primary: VTB_PRIMARY,
    secondary: VTB_SECONDARY,
    onAction: async (cmd) => {
      if (cmd === 'font') { restoreSelection(contentEl); openFontPanel(contentEl, _savedRange, commit); return; }
      if (cmd === 'checklist') { restoreSelection(contentEl); toggleListType(contentEl, 'checklist'); commit(true); return; }
      if (cmd === 'bulletlist') { restoreSelection(contentEl); toggleListType(contentEl, 'bullet'); commit(true); return; }
      if (cmd === 'numberlist') { restoreSelection(contentEl); toggleListType(contentEl, 'number'); commit(true); return; }
      if (cmd === 'highlight') { restoreSelection(contentEl); if (!wrapSelection('mark')) showToast('Pilih teks dulu untuk disorot'); commit(true); return; }
      if (cmd === 'emoji') return openEmojiSheet(contentEl, commit);
      if (cmd === 'math') return openMathSheet(contentEl, commit);
      if (cmd === 'diagram') return openDiagramSheet(contentEl, commit);
      if (cmd === 'link') return openLinkSheet(contentEl, commit);
      if (cmd === 'image') return pickFiles(note.id, { accept: 'image/*' }).then(atts => { atts.forEach(insertInlineImage); refreshAttachSection(); });
      if (cmd === 'attach') return openAttachMenu(note.id, { onInlineImage: insertInlineImage, onRefresh: refreshAttachSection });
      if (cmd === 'voice') return openVoiceRecorder(note.id, refreshAttachSection);
      if (cmd === 'scan') return openScanFlow(note.id, refreshAttachSection);
      if (cmd === 'draw') return openDrawCanvas(note.id, insertInlineImage);
      if (cmd === 'table') { restoreSelection(contentEl); document.execCommand('insertHTML', false, `<table><tr><th>\u00A0</th><th>\u00A0</th><th>\u00A0</th></tr><tr><td>\u00A0</td><td>\u00A0</td><td>\u00A0</td></tr><tr><td>\u00A0</td><td>\u00A0</td><td>\u00A0</td></tr></table><p><br></p>`); commit(true); return; }
      if (cmd === 'addrow') { restoreSelection(contentEl); addTableRow(closestTable(contentEl)); commit(true); return; }
      if (cmd === 'addcol') { restoreSelection(contentEl); addTableCol(closestTable(contentEl)); commit(true); return; }
      if (cmd === 'quote') { restoreSelection(contentEl); document.execCommand('formatBlock', false, 'blockquote'); commit(true); return; }
      if (cmd === 'code') { restoreSelection(contentEl); document.execCommand('insertHTML', false, `<pre><code>kode di sini</code></pre><p><br></p>`); commit(true); return; }
    },
  });
  vtb.el.addEventListener('pointerdown', (e) => { if (e.target.closest('.vtb-btn')) saveSelection(); });

  return () => {
    saveToDb.flush();
    if (dirty) saveVersion(note.id, titleInput.value || '', getCleanContentHTML(contentEl)).catch(() => {});
    revokeObjectUrls();
    stopSpeaking();
    vtb.destroy();
  };
}

function voiceRowHTML(att, i) {
  return `<div class="voice-row" data-voice-id="${att.id}">
    <button class="voice-play" data-play="${att.id}">${icon('play', 16)}</button>
    <div class="voice-wave">${Array.from({ length: 24 }, () => `<span style="height:${6 + Math.random() * 18}px"></span>`).join('')}</div>
    <span class="tertiary" style="font-size:11px">Rekaman ${i + 1}</span>
    <button class="icon-btn plain" data-del-voice="${att.id}">${icon('trash', 15)}</button>
  </div>`;
}
function wireVoiceRows(scope) {
  $$('[data-play]', scope).forEach(b => b.onclick = async () => {
    const att = await getAttachment(b.dataset.play);
    if (!att) return;
    const url = URL.createObjectURL(att.blob);
    _objectUrls.push(url);
    const audio = new Audio(url);
    audio.play();
  });
  $$('[data-del-voice]', scope).forEach(b => b.onclick = async () => {
    const ok = await confirmDialog('Hapus rekaman ini?', { okLabel: 'Hapus', danger: true });
    if (!ok) return;
    await deleteAttachment(b.dataset.delVoice);
    b.closest('.voice-row').remove();
  });
}

export { computeBacklinks };
