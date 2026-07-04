/* ==========================================================================
   CATAT — ui.js
   Shared, dependency-free UI primitives. No native alert()/confirm()/prompt()
   is used anywhere in this app — they break the native-app feel — this file
   is what replaces them with sheets/modals that match the design system.
   ========================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

export function debounce(fn, ms) {
  let t, lastArgs;
  const wrapped = (...args) => { lastArgs = args; clearTimeout(t); t = setTimeout(() => { t = null; fn(...lastArgs); }, ms); };
  wrapped.flush = () => { if (t) { clearTimeout(t); t = null; fn(...lastArgs); } };
  wrapped.cancel = () => { clearTimeout(t); t = null; };
  return wrapped;
}

export function fmtRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Baru saja';
  if (diff < 3600000) return Math.round(diff / 60000) + ' menit lalu';
  if (diff < 86400000) return Math.round(diff / 3600000) + ' jam lalu';
  if (diff < 172800000) return 'Kemarin';
  if (diff < 604800000) return Math.round(diff / 86400000) + ' hari lalu';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtClock(iso) { return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); }
export function fmtDateLong(iso) { return new Date(iso).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
export function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/* ---------------- Icon library (inline SVG, no external deps) ---------------- */
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  browse: '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="15" width="7" height="5" rx="1.5"/><rect x="14" y="15" width="7" height="5" rx="1.5"/>',
  graph: '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="18" r="2.6"/><line x1="8" y1="7.2" x2="10.2" y2="16"/><line x1="16" y1="7.2" x2="13.8" y2="16"/><line x1="8.3" y1="6" x2="15.7" y2="6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="20" y1="20" x2="15.3" y2="15.3"/>',
  settings: '<line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.2"/><line x1="4" y1="14" x2="20" y2="14"/><circle cx="16" cy="14" r="2.2"/><line x1="4" y1="20" x2="20" y2="20"/><circle cx="11" cy="20" r="2.2"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  star: '<polygon points="12,3 14.6,9 21,9.5 16,13.8 17.6,20 12,16.6 6.4,20 8,13.8 3,9.5 9.4,9"/>',
  chevronRight: '<polyline points="9,5 16,12 9,19"/>',
  chevronDown: '<polyline points="5,9 12,16 19,9"/>',
  chevronLeft: '<polyline points="15,5 8,12 15,19"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  check: '<polyline points="5,13 10,18 19,7"/>',
  trash: '<polyline points="4,7 20,7"/><path d="M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 16l-5.5-5.5L7 19"/>',
  link: '<path d="M9 15 15 9"/><path d="M11 6.5 13 4.5a3.6 3.6 0 0 1 5 5L16 11.5"/><path d="M13 17.5 11 19.5a3.6 3.6 0 0 1-5-5L8 12.5"/>',
  attach: '<path d="M16.5 6.5 8 15a3 3 0 0 0 4.2 4.2l8-8a5 5 0 0 0-7-7l-8 8a7 7 0 0 0 9.9 9.9"/>',
  highlight: '<path d="M3 21l3-1 11-11-2-2L4 18l-1 3Z"/><line x1="14.5" y1="6.5" x2="17.5" y2="9.5"/>',
  checklist: '<rect x="3" y="4" width="6" height="6" rx="1.4"/><polyline points="4.4,7 5.6,8.4 7.8,5.6"/><line x1="11" y1="6.8" x2="21" y2="6.8"/><rect x="3" y="14" width="6" height="6" rx="1.4"/><line x1="11" y1="16.8" x2="21" y2="16.8"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="15.5" x2="21" y2="15.5"/><line x1="9.5" y1="4" x2="9.5" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/>',
  quote: '<path d="M7 7h4v4c0 2.5-1.5 4-4 4"/><path d="M14 7h4v4c0 2.5-1.5 4-4 4"/>',
  emoji: '<circle cx="12" cy="12" r="9"/><circle cx="8.7" cy="10" r="1.1"/><circle cx="15.3" cy="10" r="1.1"/><path d="M8 14.5c1 1.4 2.4 2 4 2s3-.6 4-2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 7.4-2.1"/>',
  fingerprint: '<path d="M12 3a7 7 0 0 1 7 7c0 3.5-.5 6.5-2 9"/><path d="M12 3a7 7 0 0 0-7 7c0 2 .3 4 1 6"/><path d="M12 7a4 4 0 0 1 4 4c0 4-1.5 6.5-3 8.5"/><path d="M12 7a4 4 0 0 0-4 4c0 1.8.2 3.4.6 4.8"/><line x1="12" y1="11" x2="12" y2="13"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 2-1 2-2 0-.6-.3-1-.6-1.4-.3-.3-.4-.7-.4-1.1 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4 9 9 0 0 0-9-7.7Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="9.5" cy="7" r="1.2"/><circle cx="14.5" cy="7" r="1.2"/><circle cx="16.5" cy="11" r="1.2"/>',
  download: '<path d="M12 3v12"/><polyline points="7,11 12,16 17,11"/><line x1="5" y1="20" x2="19" y2="20"/>',
  upload: '<path d="M12 21V9"/><polyline points="7,13 12,8 17,13"/><line x1="5" y1="20" x2="19" y2="20"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2Z"/><path d="M20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 16,14"/>',
  bell: '<path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  pencil: '<path d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20Z"/><line x1="13.3" y1="6.7" x2="16.8" y2="10.2"/>',
  draw: '<path d="M3 17c2-4 3-9 5-9s2 6 4 6 2-7 4-7 1.5 6 5 6"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M4 16v3a1 1 0 0 0 1 1h3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><line x1="4" y1="12" x2="20" y2="12"/>',
  sigma: '<path d="M16 4H6l6 8-6 8h10"/>',
  diagram: '<rect x="3" y="3" width="6" height="5" rx="1.2"/><rect x="15" y="3" width="6" height="5" rx="1.2"/><rect x="9" y="16" width="6" height="5" rx="1.2"/><path d="M6 8v3a2 2 0 0 0 2 2h2"/><path d="M18 8v3a2 2 0 0 1-2 2h-2"/>',
  code: '<polyline points="8,7 3,12 8,17"/><polyline points="16,7 21,12 16,17"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3Z"/>',
  file: '<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/>',
  play: '<polygon points="6,4 20,12 6,20"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>',
  templates: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
  flame: '<path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c0-1-1-1.5-1-2.5 1.5 1 3 3 3 5.5a5 5 0 0 1-10 0C7 9 9 6 12 2Z"/>',
  cube3d: '<polygon points="12,2 20,7 20,17 12,22 4,17 4,7"/><polyline points="4,7 12,12 20,7"/><line x1="12" y1="12" x2="12" y2="22"/>',
  shuffle: '<polyline points="16,3 21,3 21,8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21,16 21,21 16,21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  zip: '<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><line x1="11" y1="9" x2="13" y2="9"/><line x1="11" y1="12" x2="13" y2="12"/><line x1="11" y1="15" x2="13" y2="15"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3,3 3,9 9,9"/><polyline points="12,7 12,12 16,14"/>',
  badge: '<path d="M12 2l2.5 5 5.5.8-4 4 1 5.5L12 14.7 7 17.3l1-5.5-4-4 5.5-.8Z"/>',
  layers: '<polygon points="12,3 21,8 12,13 3,8"/><polyline points="3,13 12,18 21,13"/><polyline points="3,17.5 12,22.5 21,17.5"/>',
  reader: '<path d="M3 5a2 2 0 0 1 2-2h6v18H5a2 2 0 0 1-2-2Z"/><path d="M21 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2Z"/><line x1="6" y1="6.5" x2="9" y2="6.5"/><line x1="6" y1="9" x2="9" y2="9"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6Z"/>',
  type: '<polyline points="5,7 5,4 19,4 19,7"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="20" x2="15" y2="20"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21,3 21,8 16,8"/>',
  /* ---- Added for the v2 feature set (undo/redo, categories, lists, share, etc.) ---- */
  undo: '<path d="M7 7 3 11l4 4"/><path d="M3 11h11.5a5.5 5.5 0 0 1 0 11H12"/>',
  redo: '<path d="M17 7l4 4-4 4"/><path d="M21 11H9.5a5.5 5.5 0 0 0 0 11H12"/>',
  pin: '<path d="M9 4.5h6l-.8 5.8L18 14v2H6v-2l3.8-3.7Z"/><line x1="12" y1="16" x2="12" y2="21.5"/>',
  pinOff: '<path d="M9 4.5h6l-.8 5.8L18 14v2h-3"/><line x1="12" y1="16" x2="12" y2="21.5"/><line x1="4" y1="3" x2="20" y2="21"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.6"/><path d="M5 9.3V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.3"/><line x1="10" y1="13.2" x2="14" y2="13.2"/>',
  archiveRestore: '<rect x="3" y="4" width="18" height="5" rx="1.6"/><path d="M5 9.3V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.3"/><polyline points="9.3,15.5 12,12.7 14.7,15.5"/><line x1="12" y1="12.7" x2="12" y2="19"/>',
  grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  moreVert: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  shareIcon: '<path d="M12 3v12"/><polyline points="8,7 12,3 16,7"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.2"/><circle cx="12" cy="7.6" r="1.05" fill="currentColor" stroke="none"/>',
  qrcode: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14.5" y="14.5" width="2.6" height="2.6" rx="0.5"/><rect x="18.4" y="14.5" width="2.6" height="2.6" rx="0.5"/><rect x="14.5" y="18.4" width="2.6" height="2.6" rx="0.5"/><rect x="18.4" y="18.4" width="2.6" height="2.6" rx="0.5"/>',
  speaker: '<path d="M4 9.2v5.6h3.6l4.7 3.7V5.5L7.6 9.2Z"/><path d="M16.6 9.3a4 4 0 0 1 0 5.4"/><path d="M19.3 6.8a8 8 0 0 1 0 10.4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.2"/><path d="M5 15H4.6A1.6 1.6 0 0 1 3 13.4V4.6A1.6 1.6 0 0 1 4.6 3h8.8A1.6 1.6 0 0 1 15 4.6V6"/>',
  listBullet: '<circle cx="4.6" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="18" r="1.3" fill="currentColor" stroke="none"/><line x1="9.2" y1="6" x2="20.5" y2="6"/><line x1="9.2" y1="12" x2="20.5" y2="12"/><line x1="9.2" y1="18" x2="20.5" y2="18"/>',
  listNumber: '<line x1="9.2" y1="6" x2="20.5" y2="6"/><line x1="9.2" y1="12" x2="20.5" y2="12"/><line x1="9.2" y1="18" x2="20.5" y2="18"/><text x="1.6" y="8.4" font-size="7.4" fill="currentColor" stroke="none" font-weight="800" font-family="sans-serif">1</text><text x="1.6" y="14.4" font-size="7.4" fill="currentColor" stroke="none" font-weight="800" font-family="sans-serif">2</text><text x="1.6" y="20.4" font-size="7.4" fill="currentColor" stroke="none" font-weight="800" font-family="sans-serif">3</text>',
  chevronUp: '<polyline points="5,15 12,8 19,15"/>',
  category: '<path d="M11 3.3 3.3 11a2 2 0 0 0 0 2.8l6.9 6.9a2 2 0 0 0 2.8 0l7.7-7.7a2 2 0 0 0 .6-1.4V5.3a2 2 0 0 0-2-2h-6.1a2 2 0 0 0-1.2.4Z"/><circle cx="8.6" cy="8.6" r="1.35" fill="currentColor" stroke="none"/>',
  dotsGrid: '<circle cx="7" cy="7" r="1.3"/><circle cx="12" cy="7" r="1.3"/><circle cx="17" cy="7" r="1.3"/><circle cx="7" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="17" cy="12" r="1.3"/><circle cx="7" cy="17" r="1.3"/><circle cx="12" cy="17" r="1.3"/><circle cx="17" cy="17" r="1.3"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8Z"/>',
  bold: '<path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7Z"/><path d="M7 12h7a3.7 3.7 0 0 1 0 7.4H7Z"/>',
  italic: '<line x1="13" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="19" y2="4"/><line x1="5" y1="20" x2="9" y2="20"/>',
  underline: '<path d="M6 4v7a6 6 0 0 0 12 0V4"/><line x1="5" y1="20.5" x2="19" y2="20.5"/>',
  strike: '<path d="M6.5 8c0-2.5 2.2-4 5.5-4s5.5 1.4 5.5 3.6"/><path d="M8 20c1 .5 2.5.8 4 .8 3.3 0 5.5-1.5 5.5-4"/><line x1="3.5" y1="12" x2="20.5" y2="12"/>',
  hash: '<line x1="9" y1="3" x2="7" y2="21"/><line x1="17" y1="3" x2="15" y2="21"/><line x1="4" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="20" y2="15"/>',
};
export function icon(name, size = 20, extra = '') {
  const body = ICONS[name] || ICONS.file;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
}

/* ---------------- Toast ---------------- */
export function showToast(message, opts = {}) {
  let stack = $('#toastStack');
  if (!stack) { stack = document.createElement('div'); stack.id = 'toastStack'; stack.className = 'toast-stack'; document.body.appendChild(stack); }
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = (opts.icon ? icon(opts.icon, 15) : '') + `<span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 280); }, opts.duration || 2200);
}

/* ---------------- Bottom sheet ---------------- */
export function openSheet(innerHTML, { title = '', onClose } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet">
    <div class="sheet-handle"></div>
    ${title ? `<div class="sheet-title">${escapeHtml(title)}</div>` : ''}
    <div class="sheet-body">${innerHTML}</div>
  </div>`;
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 320);
    onClose?.();
  };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  return { el: backdrop, close };
}

export function sheetMenu(items, { title } = {}) {
  return new Promise((resolve) => {
    const html = items.map((it, i) => `<button class="sheet-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? icon(it.icon) : ''}<span>${escapeHtml(it.label)}</span></button>`).join('');
    const { el, close } = openSheet(html, { title });
    $$('.sheet-item', el).forEach((btn, i) => btn.onclick = () => { close(); resolve(items[i].value ?? items[i].label); });
    el.addEventListener('click', (e) => { if (e.target === el) resolve(null); });
  });
}

/* ---------------- Modal ---------------- */
export function openModal(innerHTML) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">${innerHTML}</div>`;
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  const close = () => { backdrop.classList.remove('show'); setTimeout(() => backdrop.remove(), 240); };
  return { el: backdrop, close };
}

export function confirmDialog(message, { title = 'Konfirmasi', okLabel = 'Ya', cancelLabel = 'Batal', danger = false } = {}) {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-soft btn-block" data-act="cancel">${escapeHtml(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" data-act="ok">${escapeHtml(okLabel)}</button>
      </div>`);
    $('[data-act="cancel"]', el).onclick = () => { close(); resolve(false); };
    $('[data-act="ok"]', el).onclick = () => { close(); resolve(true); };
  });
}

export function promptDialog(message, { title = 'Masukkan teks', placeholder = '', value = '', okLabel = 'Simpan' } = {}) {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <h3>${escapeHtml(title)}</h3>
      ${message ? `<p class="muted" style="margin-bottom:10px">${escapeHtml(message)}</p>` : ''}
      <input class="field" id="promptInput" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" autocomplete="off">
      <div class="modal-actions">
        <button class="btn btn-soft btn-block" data-act="cancel">Batal</button>
        <button class="btn btn-primary btn-block" data-act="ok">${escapeHtml(okLabel)}</button>
      </div>`);
    const input = $('#promptInput', el);
    setTimeout(() => input.focus(), 260);
    const submit = () => { const v = input.value; close(); resolve(v); };
    $('[data-act="cancel"]', el).onclick = () => { close(); resolve(null); };
    $('[data-act="ok"]', el).onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

/* ── Numeric-only PIN keypad (shared) ──────────────────────────────────────
 * A purpose-built on-screen 0–9 keypad, reused by every PIN entry point in
 * the app (app-wide lock screen, "Kunci Aplikasi" setup, and the per-note /
 * per-category PIN flows in auth.js). It deliberately does NOT use a native
 * <input>: there is no text field for the OS to attach a keyboard to at
 * all, so there is no dependence on the device switching to a numeric
 * keyboard (inputmode="numeric"/pattern are only ever hints — some mobile
 * browsers ignore them and show a full QWERTY keyboard anyway). With only
 * digit buttons on screen, typing anything other than 0–9 is physically
 * impossible, which also guarantees any PIN created here can always be
 * re-typed on the app-wide lock screen later (see renderLockScreen in
 * main.js), which uses this exact same component. */
export function pinKeypadHTML(id, length = 4) {
  const dots = Array.from({ length }, () => `<span class="d"></span>`).join('');
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫']
    .map(k => `<button type="button" class="key-btn" data-k="${k}" ${k === '' ? 'style="background:none;cursor:default"' : ''}>${k}</button>`)
    .join('');
  return `
    <div class="pin-dots" id="${id}Dots" style="justify-content:center;margin-bottom:var(--space-5)">${dots}</div>
    <div class="keypad" id="${id}Keys" style="margin:0 auto">${keys}</div>`;
}

/** Wires up a pinKeypadHTML() block already inserted into `root`. Calls
 *  onFilled(pin) each time exactly `length` digits have been entered.
 *  Returns { getValue, clear, shakeAndClear } — call shakeAndClear() to
 *  reject a wrong/mismatched PIN (shakes the dots, then clears them). */
export function attachPinKeypad(root, id, { length = 4, onFilled } = {}) {
  let value = '';
  const dotsEl = root.querySelector(`#${id}Dots`);
  const dots = [...dotsEl.querySelectorAll('.d')];
  const update = () => dots.forEach((d, i) => d.classList.toggle('filled', i < value.length));
  root.querySelectorAll(`#${id}Keys .key-btn`).forEach(btn => btn.onclick = () => {
    const k = btn.dataset.k;
    if (k === '') return;
    if (k === '⌫') { value = value.slice(0, -1); update(); return; }
    if (value.length >= length) return;
    value += k; update();
    if (value.length === length) onFilled?.(value);
  });
  return {
    getValue: () => value,
    clear: () => { value = ''; update(); },
    shakeAndClear: () => {
      dotsEl.classList.add('shake');
      setTimeout(() => { dotsEl.classList.remove('shake'); value = ''; update(); }, 420);
    },
  };
}

/** Purpose-built PIN prompt used wherever the app asks someone to create,
 *  confirm, or verify their app-wide lock PIN (Pengaturan). Uses the same
 *  digit-only on-screen keypad as the lock screen itself — no native text
 *  input is involved, so there's nothing for a device keyboard to get
 *  wrong. Auto-resolves with the 4-digit string as soon as it's filled, or
 *  resolves null if the user cancels. */
export function promptPin(message, { title = 'Masukkan PIN' } = {}) {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <h3 style="text-align:center">${escapeHtml(title)}</h3>
      ${message ? `<p class="muted" style="margin-bottom:14px;text-align:center">${escapeHtml(message)}</p>` : ''}
      <div style="display:flex;flex-direction:column;align-items:center">${pinKeypadHTML('promptPin')}</div>
      <div class="modal-actions">
        <button class="btn btn-soft btn-block" data-act="cancel">Batal</button>
      </div>`);
    $('[data-act="cancel"]', el).onclick = () => { close(); resolve(null); };
    attachPinKeypad(el, 'promptPin', {
      onFilled: (pin) => { close(); resolve(pin); },
    });
  });
}

/** Small inline color/icon picker grid used by folder & tag editors. */
export const FOLDER_COLORS = ['#5E5CE6', '#FF6FB5', '#FF9F0A', '#34C759', '#0A84FF', '#FF453A', '#AD6A2C', '#64748B', '#12B4D9', '#D6336C', '#7C3AED', '#2FAE5C'];
export const FOLDER_EMOJI = ['📁', '🎒', '🧪', '🌏', '➗', '📚', '📖', '🎵', '🖼️', '🎮', '💡', '📌', '🗂️', '🧠', '🏆', '💼'];

/* ==========================================================================
   Install App (PWA) — Android/Chrome via beforeinstallprompt, iOS via a
   manual bottom-sheet guide, generic fallback for other browsers.
   The banner auto-hides when already running standalone (installed).
   Patterns adapted from reference jadwal-sekolah-pwa implementation.
   ========================================================================== */
let _deferredInstallPrompt = null;
let _installDismissed = false;

export function isStandaloneDisplay() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
}
export function isIOSDevice() {
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function isAndroidChrome() {
  return /android/i.test(navigator.userAgent) && /chrome/i.test(navigator.userAgent);
}

export function initInstallPrompt() {
  try { _installDismissed = localStorage.getItem('catat-install-dismissed') === '1'; } catch {}
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    refreshInstallCardIfMounted();
  });
  window.addEventListener('appinstalled', () => {
    _deferredInstallPrompt = null;
    document.getElementById('installCard')?.remove();
  });
}
export function canShowInstallCard() { return !isStandaloneDisplay() && !_installDismissed; }
function dismissInstallCard() {
  _installDismissed = true;
  try { localStorage.setItem('catat-install-dismissed', '1'); } catch {}
}

export function installCardHTML() {
  if (!canShowInstallCard()) return '';
  const sub = isIOSDevice()
    ? 'Buka Safari → Share → Add to Home Screen'
    : 'Instal sekali, pakai offline selamanya';
  return `
  <div class="install-card card-tap" id="installCard" role="complementary" aria-label="Banner install aplikasi">
    <button class="install-dismiss icon-btn plain" id="installDismissBtn" aria-label="Tutup banner install">${icon('close', 15)}</button>
    <button class="install-action" id="installActionBtn">
      <span class="install-icon-wrap">${icon('download', 22)}</span>
      <span class="install-text">
        <b>Install Aplikasi</b>
        <span>${sub}</span>
      </span>
      ${icon('chevronRight', 18)}
    </button>
  </div>`;
}

export function wireInstallCard(scope = document) {
  const card = $('#installCard', scope);
  if (!card) return;
  $('#installDismissBtn', scope).onclick = (e) => {
    e.stopPropagation();
    dismissInstallCard();
    card.style.transition = 'opacity .25s,transform .25s';
    card.style.opacity = '0'; card.style.transform = 'translateY(-8px)';
    setTimeout(() => card.remove(), 260);
  };
  $('#installActionBtn', scope).onclick = async () => {
    if (_deferredInstallPrompt) {
      /* Android / Chrome: native mini-infobar install */
      _deferredInstallPrompt.prompt();
      try {
        const { outcome } = await _deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') { card.remove(); }
      } catch {}
      _deferredInstallPrompt = null;
    } else if (isIOSDevice()) {
      /* iOS Safari: step-by-step guide */
      openSheet(`
        <div class="install-steps-wrap">
          <p class="muted" style="margin-bottom:16px">Safari tidak mendukung instal otomatis — ikuti langkah berikut:</p>
          <ol class="install-steps">
            <li>
              <span class="step-num">1</span>
              <span>Tap ikon <b>Bagikan</b> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0-12l-4 4m4-4l4 4M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg> di bar bawah Safari</span>
            </li>
            <li>
              <span class="step-num">2</span>
              <span>Gulir ke bawah, pilih <b>"Tambahkan ke Layar Utama"</b></span>
            </li>
            <li>
              <span class="step-num">3</span>
              <span>Tap <b>Tambahkan</b> di pojok kanan atas</span>
            </li>
          </ol>
          <div style="margin-top:16px;padding:12px;background:var(--accent-soft);border-radius:var(--r-md);font-size:13px">
            💡 Setelah diinstal, Catat berjalan penuh offline tanpa perlu buka browser.
          </div>
        </div>`, { title: 'Cara Install di iPhone / iPad' });
    } else {
      /* Generic fallback (Firefox, Edge, Samsung Internet, dll) */
      openSheet(`
        <p class="muted">Buka menu browser kamu (ikon ⋮ atau ⋯), lalu cari opsi:</p>
        <ul style="margin:12px 0;display:flex;flex-direction:column;gap:8px">
          <li><b>"Install App"</b></li>
          <li><b>"Tambahkan ke Layar Utama"</b></li>
          <li><b>"Add to Home Screen"</b></li>
        </ul>
        <div style="margin-top:8px;padding:12px;background:var(--accent-soft);border-radius:var(--r-md);font-size:13px">
          💡 Di Chrome / Edge: pastikan URL bar terlihat — ikon instal (⊕) kadang muncul di sana.
        </div>`, { title: 'Install Aplikasi' });
    }
  };
}

function refreshInstallCardIfMounted() {
  const slot = $('#installCardSlot');
  if (!slot) return;
  slot.innerHTML = installCardHTML();
  wireInstallCard(slot);
}

/* Keeps Android status-bar / task-switcher chrome synced to active theme. */
export function updateThemeColorMeta(hex) {
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) {
    m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m);
  }
  m.content = hex;
}

/* ==========================================================================
   Haptics — silent no-op on iOS Safari / desktop (feature-detected).
   ========================================================================== */
export function hapticTap(ms = 10) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}

/* ==========================================================================
   Generic pointer-based drag-to-reorder for a vertical list of sibling
   elements. Used by the checklist/bullet/number engine and the category
   manager. No external dependency, touch + mouse via Pointer Events.
   ========================================================================== */
export function makeSortable(listEl, { handleSelector = null, itemSelector, onReorder, onDragStart, onDragEnd } = {}) {
  let dragEl = null, startY = 0, startTop = 0, placeholder = null, listRect = null;

  function itemsOf() { return $$(itemSelector, listEl); }

  function onDown(e) {
    const handle = handleSelector ? e.target.closest(handleSelector) : e.target;
    if (!handle || !listEl.contains(handle)) return;
    const item = e.target.closest(itemSelector);
    if (!item) return;
    e.preventDefault();
    dragEl = item;
    const r = item.getBoundingClientRect();
    listRect = listEl.getBoundingClientRect();
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    startTop = r.top;
    placeholder = document.createElement('div');
    placeholder.className = 'sortable-placeholder';
    placeholder.style.height = r.height + 'px';
    item.after(placeholder);
    item.classList.add('dragging');
    item.style.position = 'fixed';
    item.style.left = r.left + 'px';
    item.style.top = r.top + 'px';
    item.style.width = r.width + 'px';
    item.style.zIndex = 999;
    item.style.pointerEvents = 'none';
    hapticTap(8);
    onDragStart?.(item);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function onMove(e) {
    if (!dragEl) return;
    e.preventDefault();
    const y = e.clientY;
    const dy = y - startY;
    let newTop = startTop + dy;
    newTop = Math.max(listRect.top - 20, Math.min(newTop, listRect.bottom - dragEl.offsetHeight + 20));
    dragEl.style.top = newTop + 'px';
    const midY = newTop + dragEl.offsetHeight / 2;
    const siblings = itemsOf().filter(x => x !== dragEl);
    let target = null;
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      if (midY < r.top + r.height / 2) { target = sib; break; }
    }
    if (target) { if (target !== placeholder.nextSibling) target.before(placeholder); }
    else if (siblings.length) { siblings[siblings.length - 1].after(placeholder); }
    else { listEl.appendChild(placeholder); }
  }

  function onUp() {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl.style.position = '';
    dragEl.style.left = ''; dragEl.style.top = ''; dragEl.style.width = ''; dragEl.style.zIndex = ''; dragEl.style.pointerEvents = '';
    placeholder.replaceWith(dragEl);
    placeholder = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    hapticTap(6);
    onDragEnd?.(dragEl);
    onReorder?.(itemsOf());
    dragEl = null;
  }

  listEl.addEventListener('pointerdown', onDown);
  return { destroy: () => listEl.removeEventListener('pointerdown', onDown) };
}

/* ==========================================================================
   Swipe-to-reveal actions on a row (iOS Mail / Gmail style). Expects markup:
   <div class="swipe-row"><div class="swipe-actions-bg">...buttons...</div>
   <div class="swipe-content">...tap target...</div></div>
   ========================================================================== */
let _activeSwipeCloser = null;
let _swipeOutsideListenerBound = false;

export function wireSwipeRows(container, onAction) {
  let openRow = null;
  const closeOpen = () => { if (openRow) { openRow.querySelector('.swipe-content').style.transform = ''; openRow.classList.remove('swiped'); openRow = null; } };

  $$('.swipe-row', container).forEach(row => {
    const content = $('.swipe-content', row);
    const bg = $('.swipe-actions-bg', row);
    if (!content || !bg) return;
    const maxReveal = () => bg.offsetWidth || 168;
    let sx = 0, sy = 0, dragging = null, baseX = 0;

    content.addEventListener('pointerdown', (e) => {
      sx = e.clientX; sy = e.clientY; dragging = null;
      baseX = row.classList.contains('swiped') ? -maxReveal() : 0;
    });
    content.addEventListener('pointermove', (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (dragging === null) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.4) dragging = true;
        else if (Math.abs(dy) > 8) dragging = false;
        else return;
      }
      if (!dragging) return;
      e.preventDefault();
      if (openRow && openRow !== row) closeOpen();
      let x = baseX + (e.clientX - sx);
      x = Math.max(-maxReveal() - 10, Math.min(0, x));
      content.style.transform = `translateX(${x}px)`;
      content.style.transition = 'none';
    });
    const settle = (e) => {
      if (!dragging) { dragging = null; return; }
      const dx = e.clientX - sx;
      content.style.transition = '';
      const finalX = baseX + dx;
      if (finalX < -maxReveal() * 0.45) {
        content.style.transform = `translateX(${-maxReveal()}px)`;
        row.classList.add('swiped'); openRow = row; hapticTap(8);
      } else {
        content.style.transform = ''; row.classList.remove('swiped');
        if (openRow === row) openRow = null;
      }
      dragging = null;
    };
    content.addEventListener('pointerup', settle);
    content.addEventListener('pointercancel', settle);

    $$('.swipe-act', bg).forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      hapticTap(12);
      onAction?.(row.dataset.noteId, btn.dataset.swipeAct, row);
      closeOpen();
    });
  });

  // Setiap render ulang, daftar sebagai "penutup swipe aktif" saat ini alih-alih
  // menumpuk listener document baru (yang lama otomatis tergantikan di sini).
  _activeSwipeCloser = { isOutside: (target) => openRow && !openRow.contains(target), close: closeOpen };

  if (!_swipeOutsideListenerBound) {
    _swipeOutsideListenerBound = true;
    document.addEventListener('pointerdown', (e) => {
      if (_activeSwipeCloser?.isOutside(e.target)) _activeSwipeCloser.close();
    });
  }
}
