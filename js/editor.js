/* ==========================================================================
   CATAT — editor.js
   The full-screen note editor: title, toolbar, contenteditable body,
   attachments, voice notes, backlinks, autosave + version snapshots.
   ========================================================================== */

import {
  getNote, updateNote, deleteNote, toggleFavorite, getAllFolders, folderPath,
  getAttachmentsByNote, deleteAttachment, getAttachment, getVersions, restoreVersion,
  saveVersion, getAllNotes, findNoteByTitle, createNote, addReminder, countWords,
  extractChecklist,
} from './db.js';
import { $, $$, icon, escapeHtml, debounce, fmtRelative, fmtBytes, openSheet, sheetMenu, promptDialog, confirmDialog, showToast, FOLDER_COLORS } from './ui.js';
import { pickFiles, openVoiceRecorder, openScanFlow, openDrawCanvas, attachmentPreviewHTML } from './attachments.js';

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

/* ---------------- Toolbar markup ---------------- */
function toolbarHTML() {
  const btn = (cmd, ic, label) => `<button class="et-btn" data-cmd="${cmd}" title="${label}" aria-label="${label}">${ic}</button>`;
  return `
    <button class="et-btn" data-cmd="bold" title="Tebal"><b>B</b></button>
    <button class="et-btn" data-cmd="italic" title="Miring"><i>I</i></button>
    <button class="et-btn" data-cmd="underline" title="Garis bawah"><u>U</u></button>
    ${btn('highlight', icon('highlight', 18), 'Sorot')}
    <div class="et-sep"></div>
    ${btn('checklist', icon('checklist', 18), 'Checklist')}
    ${btn('table', icon('table', 18), 'Tabel')}
    ${btn('quote', icon('quote', 18), 'Kutipan')}
    ${btn('code', icon('code', 18), 'Kode')}
    <div class="et-sep"></div>
    ${btn('emoji', icon('emoji', 18), 'Emoji')}
    ${btn('math', icon('sigma', 18), 'Rumus')}
    ${btn('diagram', icon('diagram', 18), 'Diagram')}
    <div class="et-sep"></div>
    ${btn('link', icon('link', 18), 'Tautan')}
    ${btn('image', icon('image', 18), 'Gambar')}
    ${btn('attach', icon('attach', 18), 'Lampiran')}
    ${btn('voice', icon('mic', 18), 'Rekam suara')}
    ${btn('scan', icon('scan', 18), 'Scan dokumen')}
    ${btn('draw', icon('draw', 18), 'Coret-coret')}
    <div class="et-sep"></div>
    ${btn('addrow', '+▭', 'Tambah baris')}
    ${btn('addcol', '▯+', 'Tambah kolom')}
  `;
}

const EMOJI_SETS = {
  'Sering': ['😀','😂','🥰','😎','🤔','👍','🙏','🔥','✨','🎉','❤️','✅'],
  'Belajar': ['📚','✏️','🧪','🔬','➗','🧠','💡','📐','🧮','🎓','📝','🗂️'],
  'Game & Hobi': ['🎮','🕹️','👾','🎲','🎨','🎵','🎬','📷','🏀','⚽','🚴','🏆'],
  'Objek': ['📌','📎','🔗','💾','🔒','⏰','📅','🗓️','📦','💬','⭐','🚀'],
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
    : `<div class="empty-state"><div class="e-icon">♻️</div><div class="e-title">Belum ada versi tersimpan</div><p>Snapshot otomatis dibuat setiap kamu selesai mengedit catatan ini.</p></div>`;
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

/* ---------------- Main view ---------------- */
export async function renderNoteView(container, { id }, ctx) {
  revokeObjectUrls();
  let note = await getNote(id);
  if (!note) { container.innerHTML = `<div class="empty-state"><div class="e-icon">🗒️</div><div class="e-title">Catatan tidak ditemukan</div></div>`; return; }

  const folders = await getAllFolders();
  const backlinks = await computeBacklinks(note.title || '', note.id);
  const attachments = await getAttachmentsByNote(note.id);
  const voiceNotes = attachments.filter(a => (a.mime || a.type || '').startsWith('audio/'));
  const fileAttachments = attachments.filter(a => !(a.mime || a.type || '').startsWith('audio/'));

  container.innerHTML = `
    <div class="topbar">
      <button class="icon-btn plain" id="btnBack">${icon('chevronLeft', 22)}</button>
      <span class="tb-title">${escapeHtml(folderPath(folders, note.folderId) || 'Tanpa folder')}</span>
      <button class="icon-btn plain" id="btnFav">${icon('star', 20)}</button>
      <button class="icon-btn plain" id="btnMore">${icon('settings', 20)}</button>
    </div>
    <main id="noteScroll" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;">
      <div class="view-pad view-enter">
        <input class="note-title-input" id="titleInput" placeholder="Judul catatan" value="${escapeHtml(note.title)}">
        <div class="chip-row" style="margin-bottom:14px">
          <button class="tag" id="folderChip">${icon('browse',12)} ${escapeHtml(folderPath(folders, note.folderId) || 'Pilih folder')}</button>
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
        <div style="height:24px"></div>
      </div>
    </main>
    <div class="edit-toolbar">${toolbarHTML()}</div>
  `;

  const titleInput = $('#titleInput', container);
  const contentEl = $('#richContent', container);

  linkifyAllWikiSyntax(contentEl);
  await hydrateAttachments(contentEl);
  renderMath(contentEl);
  renderDiagrams(contentEl);
  markBrokenLinks(contentEl);

  const initialSnapshot = JSON.stringify({ t: note.title, c: note.content });

  const commit = debounce(async () => {
    const tags = note.tags || [];
    note = await updateNote(note.id, {
      title: titleInput.value || '',
      content: contentEl.innerHTML,
      tags, folderId: note.folderId, color: note.color,
    });
  }, 650);

  titleInput.addEventListener('input', commit);
  contentEl.addEventListener('input', (e) => {
    if (e.inputType === 'insertText' && e.data === ']') convertWikiNearCaret(contentEl);
    commit();
  });

  contentEl.addEventListener('click', (e) => {
    const cbx = e.target.closest('.cbx');
    if (cbx) {
      const item = cbx.closest('.checklist-item');
      item.dataset.checked = item.dataset.checked === 'true' ? 'false' : 'true';
      commit();
      return;
    }
    const wikiA = e.target.closest('.wiki-link');
    if (wikiA) {
      e.preventDefault();
      openWikiTarget(wikiA.dataset.wiki, ctx);
    }
  });

  $('#btnBack', container).onclick = () => ctx.back();
  $('#btnFav', container).onclick = async () => { note = await toggleFavorite(note.id); $('#btnFav', container).style.color = note.favorite ? 'var(--warning)' : ''; showToast(note.favorite ? 'Ditambah ke favorit' : 'Dihapus dari favorit'); };
  if (note.favorite) $('#btnFav', container).style.color = 'var(--warning)';

  $('#folderChip', container).onclick = () => openFolderPicker(note, folders, ctx, container);
  $('#tagChip', container).onclick = () => openTagEditor(note, ctx);
  $('#colorChip', container).onclick = () => openColorPicker(note, ctx);

  $('#btnMore', container).onclick = async () => {
    const choice = await sheetMenu([
      { value: 'history', icon: 'history', label: 'Riwayat Versi' },
      { value: 'reminder', icon: 'bell', label: 'Pasang Pengingat' },
      { value: 'reader', icon: 'reader', label: 'Mode Reader' },
      { value: 'export', icon: 'download', label: 'Bagikan sebagai file teks' },
      { value: 'delete', icon: 'trash', label: 'Hapus Catatan', danger: true },
    ], { title: note.title || 'Catatan' });
    if (choice === 'history') openVersionHistory(note.id, ctx);
    if (choice === 'reminder') openReminderSheet(note);
    if (choice === 'reader') ctx.navigate('#/note/' + note.id + '/reader');
    if (choice === 'export') exportNoteAsText(note);
    if (choice === 'delete') {
      const ok = await confirmDialog('Catatan ini akan dihapus permanen.', { title: 'Hapus catatan?', okLabel: 'Hapus', danger: true });
      if (ok) { await deleteNote(note.id); showToast('Catatan dihapus', { icon: 'trash' }); ctx.navigate('#/'); }
    }
  };

  /* Toolbar wiring */
  const toolbar = $('.edit-toolbar', container);
  toolbar.addEventListener('pointerdown', (e) => { if (e.target.closest('.et-btn')) saveSelection(); });
  toolbar.addEventListener('click', async (e) => {
    const b = e.target.closest('.et-btn');
    if (!b) return;
    const cmd = b.dataset.cmd;
    restoreSelection(contentEl);
    if (['bold', 'italic', 'underline'].includes(cmd)) { document.execCommand(cmd); commit(); return; }
    if (cmd === 'highlight') { if (!wrapSelection('mark')) showToast('Pilih teks dulu untuk disorot'); commit(); return; }
    if (cmd === 'checklist') { document.execCommand('insertHTML', false, `<div class="checklist-item" data-checked="false"><span class="cbx" contenteditable="false"></span><span class="ctext">&#8203;</span></div>`); commit(); return; }
    if (cmd === 'table') { document.execCommand('insertHTML', false, `<table><tr><th>\u00A0</th><th>\u00A0</th><th>\u00A0</th></tr><tr><td>\u00A0</td><td>\u00A0</td><td>\u00A0</td></tr><tr><td>\u00A0</td><td>\u00A0</td><td>\u00A0</td></tr></table><p><br></p>`); commit(); return; }
    if (cmd === 'addrow') { addTableRow(closestTable(contentEl)); commit(); return; }
    if (cmd === 'addcol') { addTableCol(closestTable(contentEl)); commit(); return; }
    if (cmd === 'quote') { document.execCommand('formatBlock', false, 'blockquote'); commit(); return; }
    if (cmd === 'code') { document.execCommand('insertHTML', false, `<pre><code>kode di sini</code></pre><p><br></p>`); commit(); return; }
    if (cmd === 'emoji') return openEmojiSheet(contentEl, commit);
    if (cmd === 'math') return openMathSheet(contentEl, commit);
    if (cmd === 'diagram') return openDiagramSheet(contentEl, commit);
    if (cmd === 'link') return openLinkSheet(contentEl, commit);
    if (cmd === 'image') return pickFiles(note.id, { accept: 'image/*' }).then(atts => { atts.forEach(a => insertInlineImage(contentEl, a)); commit(); refreshAttachSection(container, note.id); });
    if (cmd === 'attach') return pickFiles(note.id, {}).then(() => refreshAttachSection(container, note.id));
    if (cmd === 'voice') return openVoiceRecorder(note.id, () => refreshAttachSection(container, note.id));
    if (cmd === 'scan') return openScanFlow(note.id, () => refreshAttachSection(container, note.id));
    if (cmd === 'draw') return openDrawCanvas(note.id, (att) => { insertInlineImage(contentEl, att); commit(); });
  });

  function insertInlineImage(contentEl, att) {
    restoreSelection(contentEl);
    document.execCommand('insertHTML', false, `<img data-attachment-id="${att.id}" alt="${escapeHtml(att.name)}"><p><br></p>`);
    hydrateAttachments(contentEl);
  }

  return () => { revokeObjectUrls(); };
}

function voiceRowHTML(att, i) {
  return `<div class="voice-row" data-voice-id="${att.id}">
    <button class="voice-play" data-play="${att.id}">${icon('play', 16)}</button>
    <div class="voice-wave">${Array.from({ length: 24 }, () => `<span style="height:${6 + Math.random() * 18}px"></span>`).join('')}</div>
    <span class="tertiary" style="font-size:11px">Rekaman ${i + 1}</span>
    <button class="icon-btn plain" data-del-voice="${att.id}">${icon('trash', 15)}</button>
  </div>`;
}

async function refreshAttachSection(container, noteId) {
  const attachments = await getAttachmentsByNote(noteId);
  const voiceNotes = attachments.filter(a => (a.mime || a.type || '').startsWith('audio/'));
  const fileAttachments = attachments.filter(a => !(a.mime || a.type || '').startsWith('audio/'));
  const section = $('#attachSection', container);
  section.innerHTML = `
    ${fileAttachments.length ? `<div class="section-title" style="margin-top:0">Lampiran</div><div class="attach-grid">${fileAttachments.map(attachmentPreviewHTML).join('')}</div>` : ''}
    ${voiceNotes.length ? `<div class="section-title">Voice Note</div><div class="row-list">${voiceNotes.map((v, i) => voiceRowHTML(v, i)).join('')}</div>` : ''}
  `;
  wireVoiceRows(section);
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
    commit();
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
    input.addEventListener('input', () => {
      try { window.katex.render(input.value, preview, { throwOnError: false }); } catch {}
    });
  });
  $('#insertMath', el).onclick = () => {
    if (!input.value.trim()) { close(); return; }
    restoreSelection(contentEl);
    const latex = escapeHtml(input.value).replace(/"/g, '&quot;');
    document.execCommand('insertHTML', false, `<span class="math-inline" contenteditable="false" data-latex="${input.value.replace(/"/g, '&quot;')}">${latex}</span>&nbsp;`);
    renderMath(contentEl);
    commit();
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
    commit();
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
    commit();
    close();
  };
}

async function openFolderPicker(note, folders, ctx, container) {
  const items = [{ value: '', icon: 'browse', label: 'Tanpa folder' }, ...folders.map(f => ({ value: f.id, icon: 'browse', label: folderPath(folders, f.id) }))];
  const choice = await sheetMenu(items, { title: 'Pindahkan ke folder' });
  if (choice === null) return;
  note.folderId = choice || null;
  await updateNote(note.id, { folderId: note.folderId }, 'Folder diubah');
  ctx.rerender();
}
async function openTagEditor(note, ctx) {
  const v = await promptDialog('Pisahkan dengan koma', { title: 'Edit Tag', value: (note.tags || []).join(', '), placeholder: 'sekolah, penting, revisi' });
  if (v === null) return;
  note.tags = v.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
  await updateNote(note.id, { tags: note.tags }, 'Tag diubah');
  ctx.rerender();
}
async function openColorPicker(note, ctx) {
  const html = `<div class="chip-row">${FOLDER_COLORS.map(c => `<span class="swatch" data-color="${c}" style="background:${c}"></span>`).join('')}</div>`;
  const { el, close } = openSheet(html, { title: 'Warna catatan' });
  $$('[data-color]', el).forEach(s => s.onclick = async () => {
    note.color = s.dataset.color;
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
function exportNoteAsText(note) {
  const text = note.title + '\n\n' + (note.content || '').replace(/<[^>]+>/g, '');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (note.title || 'catatan') + '.txt';
  a.click();
}

export { computeBacklinks };
