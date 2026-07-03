/* ==========================================================================
   CATAT — share.js
   Turns a note's rich HTML into three shareable artifacts (JPG / PDF / TXT),
   plus a QR/quick-link card and a text-to-speech reader. jsPDF and the QR
   encoder are fetched from a CDN on first use only (same lazy pattern the
   app already uses for KaTeX/Mermaid) and cached by the service worker for
   offline reuse afterwards.
   ========================================================================== */

import { $, $$, icon, escapeHtml, showToast, openSheet } from './ui.js';

/* ---------------- HTML → structured blocks ---------------- */
export function parseBlocks(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  const blocks = [];
  [...div.children].forEach((child) => {
    if (child.classList?.contains('list-item') || child.classList?.contains('checklist-item')) {
      const isLegacy = child.classList.contains('checklist-item');
      blocks.push({
        type: 'list',
        listType: isLegacy ? 'checklist' : (child.dataset.listType || 'bullet'),
        checked: child.dataset.checked === 'true',
        text: (isLegacy ? child.querySelector('.ctext') : child.querySelector('.li-text'))?.textContent || '',
      });
    } else if (/^H[1-4]$/.test(child.tagName)) {
      blocks.push({ type: 'heading', level: Number(child.tagName[1]), text: child.textContent || '' });
    } else if (child.tagName === 'BLOCKQUOTE') {
      blocks.push({ type: 'quote', text: child.textContent || '' });
    } else if (child.tagName === 'PRE') {
      blocks.push({ type: 'code', text: child.textContent || '' });
    } else if (child.classList?.contains('voice-row') || child.querySelector?.('.voice-row')) {
      blocks.push({ type: 'attachment', text: '🎙️ Rekaman suara' });
    } else if (child.tagName === 'IMG' || child.querySelector?.('img')) {
      blocks.push({ type: 'attachment', text: '🖼️ Gambar' });
    } else if (child.tagName === 'TABLE') {
      const rows = [...child.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).join('  |  '));
      rows.forEach(r => blocks.push({ type: 'p', text: r }));
    } else {
      const text = (child.textContent || '').trim();
      if (text) blocks.push({ type: 'p', text });
    }
  });
  return blocks;
}

export function blocksToText(title, blocks) {
  const lines = [];
  if (title) lines.push(title, '');
  let numCounter = 0;
  blocks.forEach((b, i) => {
    if (b.type === 'list' && b.listType === 'number') {
      const prev = blocks[i - 1];
      numCounter = (prev && prev.type === 'list' && prev.listType === 'number') ? numCounter + 1 : 1;
    }
    if (b.type === 'heading') lines.push('#'.repeat(b.level) + ' ' + b.text);
    else if (b.type === 'list') {
      if (b.listType === 'checklist') lines.push((b.checked ? '☑ ' : '☐ ') + b.text);
      else if (b.listType === 'number') lines.push(numCounter + '. ' + b.text);
      else lines.push('•  ' + b.text);
    } else if (b.type === 'quote') lines.push('“' + b.text + '”');
    else if (b.type === 'code') lines.push(b.text);
    else if (b.type === 'attachment') lines.push('[' + b.text + ']');
    else if (b.text) lines.push(b.text);
  });
  return lines.join('\n');
}

function safeFileName(title) {
  const base = (title || 'Catatan').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
  return base || 'Catatan';
}

function isColorDark(hex) {
  if (!hex) return false;
  const h = hex.replace('#', '');
  if (h.length < 6) return false;
  const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

/** Shares a Blob as a real file via the native share sheet when possible
 *  (WhatsApp, Drive, AirDrop...), otherwise falls back to a plain download. */
async function shareOrDownload(blob, filename, meta = {}) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: meta.title, text: meta.text });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast('Berkas diunduh');
}

/* ---------------- TXT ---------------- */
async function shareAsText(note, blocks) {
  const text = blocksToText(note.title, blocks);
  if (navigator.share) {
    try { await navigator.share({ title: note.title || 'Catatan', text }); return; }
    catch (err) { if (err?.name === 'AbortError') return; }
  }
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  await shareOrDownload(blob, safeFileName(note.title) + '.txt', { title: note.title });
}

/* ---------------- JPG (canvas, no dependency) ---------------- */
async function renderNoteToCanvas(note, blocks) {
  const W = 1080, PAD = 72, contentW = W - PAD * 2;
  const bg = note.color || '#FFFFFF';
  const dark = isColorDark(bg);
  const textColor = dark ? '#F5F5F7' : '#1C1C1E';
  const subColor = dark ? '#C7C7CC' : '#6E6E73';

  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d');
  cvs.width = W;

  const fnt = (weight, size, style = 'normal') => `${style} ${weight} ${size}px -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  function wrap(text, f, maxW) {
    ctx.font = f;
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    lines.push(line);
    return lines;
  }

  const titleF = fnt(800, 46), dateF = fnt(500, 24), bodyF = fnt(400, 30), quoteF = fnt(400, 30, 'italic');
  const codeF = '400 26px ui-monospace, SFMono-Regular, Menlo, monospace';

  const titleLines = note.title ? wrap(note.title, titleF, contentW) : [];
  const dateStr = new Date(note.updatedAt || Date.now()).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  let numCounter = 0;
  const rendered = blocks.map((b, i) => {
    let f = bodyF, prefix = '', indent = 0, lh = 42, color = textColor, strike = false;
    if (b.type === 'heading') { f = fnt(700, 34 - (b.level - 1) * 2); lh = 48; }
    else if (b.type === 'list') {
      indent = 46;
      if (b.listType === 'number') {
        const prev = blocks[i - 1];
        numCounter = (prev && prev.type === 'list' && prev.listType === 'number') ? numCounter + 1 : 1;
        prefix = numCounter + '.  ';
      } else if (b.listType === 'checklist') { prefix = b.checked ? '☑  ' : '☐  '; strike = b.checked; }
      else prefix = '•  ';
    } else if (b.type === 'quote') { f = quoteF; indent = 30; color = subColor; }
    else if (b.type === 'code') { f = codeF; indent = 20; }
    else if (b.type === 'attachment') { f = fnt(400, 28, 'italic'); color = subColor; }
    const lines = wrap(prefix + b.text, f, contentW - indent);
    return { lines, font: f, indent, lh, color, strike };
  });

  let y = 76 + titleLines.length * 56 + (titleLines.length ? 6 : 0) + 52;
  rendered.forEach((b) => { y += b.lines.length * b.lh + 8; });
  y += 80;
  cvs.height = Math.max(640, Math.round(y));

  ctx.fillStyle = bg; ctx.fillRect(0, 0, cvs.width, cvs.height);
  ctx.textBaseline = 'alphabetic';

  let cy = 76;
  ctx.fillStyle = textColor;
  titleLines.forEach((l) => { ctx.font = titleF; ctx.fillText(l, PAD, cy + 40); cy += 56; });
  if (titleLines.length) cy += 6;
  ctx.font = dateF; ctx.fillStyle = subColor;
  ctx.fillText(dateStr, PAD, cy + 20);
  cy += 52;

  rendered.forEach((b) => {
    ctx.font = b.font; ctx.fillStyle = b.color;
    b.lines.forEach((l) => {
      ctx.fillText(l, PAD + b.indent, cy + 22);
      if (b.strike) {
        const w = ctx.measureText(l).width;
        ctx.strokeStyle = b.color; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(PAD + b.indent, cy + 15); ctx.lineTo(PAD + b.indent + w, cy + 15); ctx.stroke();
      }
      cy += b.lh;
    });
    cy += 8;
  });

  ctx.font = fnt(600, 22); ctx.fillStyle = subColor;
  ctx.fillText('Dibuat dengan Catat', PAD, cvs.height - 40);
  return cvs;
}

async function shareAsImage(note, blocks) {
  showToast('Menyiapkan gambar…');
  const canvas = await renderNoteToCanvas(note, blocks);
  canvas.toBlob(async (blob) => {
    if (!blob) { showToast('Gagal membuat gambar'); return; }
    await shareOrDownload(blob, safeFileName(note.title) + '.jpg', { title: note.title });
  }, 'image/jpeg', 0.92);
}

/* ---------------- PDF (lazy-loaded jsPDF) ---------------- */
let _jspdfPromise = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  if (!_jspdfPromise) {
    _jspdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
      s.onload = () => resolve(window.jspdf);
      s.onerror = () => reject(new Error('jspdf load failed'));
      document.head.appendChild(s);
    });
  }
  return _jspdfPromise;
}

async function shareAsPdf(note, blocks) {
  showToast('Menyiapkan PDF…');
  try {
    const { jsPDF } = await loadJsPdf();
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginX = 48;
    let y = 64;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - marginX * 2;
    const ensureSpace = (h) => { if (y + h > pageHeight - 56) { doc.addPage(); y = 64; } };

    if (note.title) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
      doc.splitTextToSize(note.title, maxWidth).forEach((l) => { ensureSpace(26); doc.text(l, marginX, y); y += 26; });
      y += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(140);
      doc.text(new Date(note.updatedAt || Date.now()).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }), marginX, y);
      doc.setTextColor(20);
      y += 22;
    }

    let numCounter = 0;
    blocks.forEach((b, i) => {
      if (b.type === 'list' && b.listType === 'number') {
        const prev = blocks[i - 1];
        numCounter = (prev && prev.type === 'list' && prev.listType === 'number') ? numCounter + 1 : 1;
      }
      let prefix = '', size = 11, style = 'normal', indent = 0, isCode = false;
      if (b.type === 'heading') { size = 15 - (b.level - 1); style = 'bold'; }
      if (b.type === 'list') {
        indent = 16;
        prefix = b.listType === 'checklist' ? (b.checked ? '[x] ' : '[ ] ') : b.listType === 'number' ? `${numCounter}. ` : '-  ';
      }
      if (b.type === 'quote') { style = 'italic'; indent = 10; }
      if (b.type === 'code') isCode = true;
      doc.setFont(isCode ? 'courier' : 'helvetica', style);
      doc.setFontSize(size);
      doc.splitTextToSize(prefix + (b.text || ''), maxWidth - indent).forEach((l) => {
        ensureSpace(size + 6); doc.text(l, marginX + indent, y); y += size + 6;
      });
      y += 3;
    });

    doc.setFontSize(8); doc.setTextColor(150);
    doc.text('Dibuat dengan Catat', marginX, pageHeight - 28);

    const blob = doc.output('blob');
    await shareOrDownload(blob, safeFileName(note.title) + '.pdf', { title: note.title });
  } catch (err) {
    console.error(err);
    showToast('Gagal membuat PDF. Perlu koneksi internet saat pertama kali dipakai.');
  }
}

/* ---------------- QR + quick link ("Tambahkan Widget") ---------------- */
let _qrPromise = null;
function loadQr() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (!_qrPromise) {
    _qrPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
      s.onload = () => resolve(window.QRCode);
      s.onerror = () => reject(new Error('qrcode load failed'));
      document.head.appendChild(s);
    });
  }
  return _qrPromise;
}

export function openQuickLink(note) {
  const url = location.origin + location.pathname + '#/note/' + note.id;
  const html = `
    <div class="fp-header"><span class="fp-header-title">QR &amp; Tautan Cepat</span></div>
    <p class="muted" style="margin:0 0 16px">Pindai untuk membuka catatan ini lagi dengan cepat. Catat menyimpan data secara lokal, jadi tautan ini hanya berfungsi di perangkat/peramban yang sama.</p>
    <div class="qr-holder" id="qrHolder"><div class="skeleton" style="width:190px;height:190px;border-radius:16px;margin:0 auto"></div></div>
    <div class="link-row">
      <input class="field" id="qrLinkField" readonly value="${escapeHtml(url)}">
      <button class="btn btn-primary" id="qrCopyBtn">${icon('copy', 16)}<span>Salin</span></button>
    </div>`;
  const { el } = openSheet(html);
  $('#qrCopyBtn', el).onclick = async () => {
    try { await navigator.clipboard.writeText(url); showToast('Tautan disalin'); }
    catch { const f = $('#qrLinkField', el); f.select(); document.execCommand('copy'); showToast('Tautan disalin'); }
  };
  loadQr().then((QRCode) => {
    const holder = $('#qrHolder', el);
    holder.innerHTML = '';
    const canvas = document.createElement('canvas');
    holder.appendChild(canvas);
    return QRCode.toCanvas(canvas, url, { width: 190, margin: 1, color: { dark: '#1c1c1e', light: '#00000000' } });
  }).catch(() => {
    $('#qrHolder', el).innerHTML = '<p class="muted" style="text-align:center">QR butuh koneksi internet saat pertama kali dipakai.</p>';
  });
}

/* ---------------- Text-to-speech ("Baca Catatan") ---------------- */
export function stopSpeaking() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }

function speakNote(note, blocks) {
  if (!('speechSynthesis' in window)) { showToast('Perangkat tidak mendukung baca-keras'); return; }
  stopSpeaking();
  const text = [note.title, blocksToText('', blocks)].filter(Boolean).join('. ');
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const idVoice = voices.find((v) => /id[-_]ID/i.test(v.lang));
  if (idVoice) u.voice = idVoice;
  u.lang = idVoice ? idVoice.lang : 'id-ID';
  u.rate = 1;
  speechSynthesis.speak(u);
}

export function openReadAloudSheet(note, blocks) {
  const html = `
    <div class="fp-header"><span class="fp-header-title">Baca Catatan</span></div>
    <div class="tts-controls">
      <button class="tts-btn" id="ttsPlay" aria-label="Putar">${icon('play', 24)}</button>
      <button class="tts-btn" id="ttsPause" aria-label="Jeda">${icon('pause', 24)}</button>
      <button class="tts-btn" id="ttsStop" aria-label="Berhenti">${icon('close', 20)}</button>
    </div>
    <p class="muted" style="text-align:center;margin-top:12px">Memakai suara bawaan perangkat.</p>`;
  const { el } = openSheet(html);
  $('#ttsPlay', el).onclick = () => speakNote(note, blocks);
  $('#ttsPause', el).onclick = () => {
    if (!('speechSynthesis' in window)) return;
    if (speechSynthesis.speaking && !speechSynthesis.paused) speechSynthesis.pause();
    else if (speechSynthesis.paused) speechSynthesis.resume();
  };
  $('#ttsStop', el).onclick = () => stopSpeaking();
}

/* ---------------- Entry sheet ---------------- */
export function openShareSheet(note) {
  const blocks = parseBlocks(note.content);
  const html = `
    <div class="fp-header"><span class="fp-header-title">Bagikan Catatan</span></div>
    <div class="share-options">
      <button class="share-opt" data-fmt="image">
        <span class="share-opt-ic" style="background:#FF9F0A22;color:#FF9F0A">${icon('image', 21)}</span>
        <span class="share-opt-text"><b>Gambar (JPG)</b><small>Cocok dibagikan ke chat</small></span>
      </button>
      <button class="share-opt" data-fmt="pdf">
        <span class="share-opt-ic" style="background:#FF453A22;color:#FF453A">${icon('file', 21)}</span>
        <span class="share-opt-text"><b>Dokumen (PDF)</b><small>Rapi untuk dicetak atau disimpan</small></span>
      </button>
      <button class="share-opt" data-fmt="text">
        <span class="share-opt-ic" style="background:#30D15822;color:#30D158">${icon('type', 21)}</span>
        <span class="share-opt-text"><b>Teks Saja (TXT)</b><small>Ringan, gampang ditempel ke mana saja</small></span>
      </button>
      <button class="share-opt" data-fmt="link">
        <span class="share-opt-ic" style="background:#5E5CE622;color:#5E5CE6">${icon('qrcode', 21)}</span>
        <span class="share-opt-text"><b>QR &amp; Tautan Cepat</b><small>Buka lagi catatan ini dalam sekejap</small></span>
      </button>
    </div>`;
  const { el, close } = openSheet(html);
  $$('.share-opt', el).forEach((btn) => btn.onclick = async () => {
    const fmt = btn.dataset.fmt;
    close();
    if (fmt === 'text') await shareAsText(note, blocks);
    else if (fmt === 'image') await shareAsImage(note, blocks);
    else if (fmt === 'pdf') await shareAsPdf(note, blocks);
    else if (fmt === 'link') openQuickLink(note);
  });
}
