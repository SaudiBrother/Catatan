/* ==========================================================================
   CATAT — attachments.js
   File picker, voice recorder, document scanner (crop + B&W), drawing canvas.
   All blobs stored via db.addAttachment, fully offline — no server involved.
   ========================================================================== */

import { addAttachment, getAttachment, deleteAttachment } from './db.js';
import { $, $$, icon, openSheet, openModal, confirmDialog, showToast, fmtBytes, escapeHtml } from './ui.js';

/* --------------------------------------------------------------------------
   File picker (any file type)
   -------------------------------------------------------------------------- */
export function pickFiles(noteId, { accept = '*/*', multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.onchange = async () => {
      const files = [...input.files];
      const atts = [];
      for (const f of files) {
        const kind = f.type.startsWith('image/') ? 'image'
          : f.type.startsWith('video/') ? 'video'
          : f.type.startsWith('audio/') ? 'audio'
          : f.type === 'application/pdf' ? 'pdf'
          : 'file';
        const att = await addAttachment(noteId, f, kind);
        atts.push(att);
      }
      showToast(`${atts.length} file ditambahkan`, { icon: 'attach' });
      resolve(atts);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/* --------------------------------------------------------------------------
   Attachment preview card HTML (inline inside editor / attach section)
   -------------------------------------------------------------------------- */
export function attachmentPreviewHTML(att) {
  const isImage = (att.mime || att.type || '').startsWith('image/');
  const isVideo = (att.mime || att.type || '').startsWith('video/');
  const isPDF = (att.mime || att.type || '') === 'application/pdf';
  const isAudio = (att.mime || att.type || '').startsWith('audio/');
  const emoji = isImage ? '🖼️' : isVideo ? '🎬' : isPDF ? '📄' : isAudio ? '🎵' : '📎';
  return `
  <div class="attach-chip" data-att-id="${att.id}">
    <span class="ai">${isImage
      ? `<img data-attachment-id="${att.id}" alt="${escapeHtml(att.name)}" style="width:34px;height:34px;object-fit:cover;border-radius:7px">`
      : `<span style="font-size:18px">${emoji}</span>`}
    </span>
    <span style="flex:1;min-width:0">
      <b style="display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(att.name)}</b>
      <span style="font-size:11px;color:var(--text-tertiary)">${fmtBytes(att.size)}</span>
    </span>
    <button class="icon-btn plain" data-open-att="${att.id}" aria-label="Buka">${icon('eye', 16)}</button>
    <button class="icon-btn plain" data-del-att="${att.id}" aria-label="Hapus">${icon('trash', 15)}</button>
  </div>`;
}

/* Wire open/delete on an attach-grid container */
export function wireAttachGrid(scope, onDelete) {
  $$('[data-open-att]', scope).forEach(b => b.onclick = () => openAttachmentViewer(b.dataset.openAtt));
  $$('[data-del-att]', scope).forEach(b => b.onclick = async () => {
    const ok = await confirmDialog('Hapus lampiran ini?', { okLabel: 'Hapus', danger: true });
    if (!ok) return;
    await deleteAttachment(b.dataset.delAtt);
    b.closest('.attach-chip')?.remove();
    onDelete?.();
  });
}

async function openAttachmentViewer(id) {
  const att = await getAttachment(id);
  if (!att) { showToast('File tidak ditemukan'); return; }
  const url = URL.createObjectURL(att.blob);
  const mime = att.mime || att.type || '';
  let inner = '';
  if (mime.startsWith('image/')) {
    inner = `<img src="${url}" style="width:100%;border-radius:var(--r-md);margin-bottom:12px" alt="${escapeHtml(att.name)}">`;
  } else if (mime.startsWith('video/')) {
    inner = `<video src="${url}" controls style="width:100%;border-radius:var(--r-md);margin-bottom:12px"></video>`;
  } else if (mime.startsWith('audio/')) {
    inner = `<audio src="${url}" controls style="width:100%;margin-bottom:12px"></audio>`;
  } else if (mime === 'application/pdf') {
    inner = `<iframe src="${url}" style="width:100%;height:60vh;border:0;border-radius:var(--r-md);margin-bottom:12px"></iframe>`;
  } else {
    inner = `<div class="empty-state"><div class="e-icon">📎</div><div class="e-title">${escapeHtml(att.name)}</div><p>${fmtBytes(att.size)}</p></div>`;
  }
  const { el, close } = openSheet(`
    ${inner}
    <a class="btn btn-primary btn-block" download="${escapeHtml(att.name)}" href="${url}" target="_blank">
      ${icon('download', 16)} Unduh File
    </a>`, { title: att.name });
  el.addEventListener('remove', () => URL.revokeObjectURL(url));
}

/* --------------------------------------------------------------------------
   Voice recorder  (MediaRecorder API)
   -------------------------------------------------------------------------- */
export function openVoiceRecorder(noteId, onSave) {
  let mediaRecorder = null;
  let chunks = [];
  let startTime = 0;
  let timerInterval = null;
  let stream = null;

  const { el, close } = openSheet(`
    <div style="text-align:center;padding:16px 0">
      <div id="recStatus" style="font-size:40px;margin-bottom:8px">🎙️</div>
      <div id="recTime" style="font-size:22px;font-weight:800;letter-spacing:1px;margin-bottom:20px">00:00</div>
      <div style="display:flex;justify-content:center;gap:16px">
        <button class="btn btn-primary" id="recStartBtn">${icon('mic', 18)} Mulai Rekam</button>
        <button class="btn btn-soft" id="recStopBtn" disabled>${icon('pause', 18)} Berhenti</button>
      </div>
      <div id="recSaveArea" style="margin-top:16px;display:none">
        <button class="btn btn-primary btn-block" id="recSaveBtn">${icon('check', 16)} Simpan Rekaman</button>
      </div>
      <p class="muted" style="margin-top:12px;font-size:12px">Izinkan akses mikrofon ketika diminta browser</p>
    </div>`, { title: 'Voice Note' });

  const timeEl = $('#recTime', el);
  const statusEl = $('#recStatus', el);
  const startBtn = $('#recStartBtn', el);
  const stopBtn = $('#recStopBtn', el);
  const saveArea = $('#recSaveArea', el);
  const saveBtn = $('#recSaveBtn', el);

  function tick() {
    const secs = Math.floor((Date.now() - startTime) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    timeEl.textContent = `${m}:${s}`;
  }

  startBtn.onclick = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showToast('Tidak dapat mengakses mikrofon', { icon: 'mic' });
      return;
    }
    chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const ext = mimeType.includes('webm') ? 'webm' : 'ogg';
      blob.name = `rekaman-${Date.now()}.${ext}`;
      blob.lastModified = Date.now();
      saveArea.style.display = '';
      statusEl.textContent = '✅';
      saveBtn.dataset.blob = 'ready';
      saveBtn._blob = blob;
    };
    mediaRecorder.start(200);
    startTime = Date.now();
    timerInterval = setInterval(tick, 500);
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.innerHTML = '<span class="rec-dot" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--danger);animation:pulse-dot 1.1s ease-in-out infinite"></span>';
  };

  stopBtn.onclick = () => {
    mediaRecorder?.stop();
    stream?.getTracks().forEach(t => t.stop());
    clearInterval(timerInterval);
    stopBtn.disabled = true;
  };

  saveBtn.onclick = async () => {
    const blob = saveBtn._blob;
    if (!blob) return;
    const att = await addAttachment(noteId, blob, 'audio');
    showToast('Voice note disimpan', { icon: 'mic' });
    close();
    onSave?.(att);
  };
}

/* --------------------------------------------------------------------------
   Document scanner — camera capture + 4-point crop + optional B&W filter
   -------------------------------------------------------------------------- */
export function openScanFlow(noteId, onSave) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    openCropUI(file, noteId, onSave);
  };
  input.click();
}

function openCropUI(file, noteId, onSave) {
  const url = URL.createObjectURL(file);
  const { el, close } = openSheet(`
    <p class="muted" style="margin-bottom:10px;font-size:13px">Seret sudut untuk memotong dokumen, lalu pilih filter.</p>
    <div class="crop-stage" id="cropStage" style="max-height:55vh;overflow:hidden">
      <img id="cropImg" src="${url}" style="width:100%;display:block;user-select:none;-webkit-user-drag:none" draggable="false">
      <svg class="crop-svg" id="cropSvg"><polygon id="cropPoly" fill="rgba(94,92,230,.18)" stroke="#5E5CE6" stroke-width="2"/></svg>
      <div class="crop-handle" id="h0"></div>
      <div class="crop-handle" id="h1"></div>
      <div class="crop-handle" id="h2"></div>
      <div class="crop-handle" id="h3"></div>
    </div>
    <div class="segmented" style="margin:14px 0 10px">
      <button class="active" data-filter="none">Original</button>
      <button data-filter="bw">Hitam Putih</button>
      <button data-filter="enhance">Enhance</button>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-soft" style="flex:1" id="scanRetake">📷 Ulangi</button>
      <button class="btn btn-primary" style="flex:1" id="scanSave">Simpan Scan</button>
    </div>`, { title: 'Scan Dokumen' });

  const img = $('#cropImg', el);
  const stage = $('#cropStage', el);
  const poly = $('#cropPoly', el);
  const handles = [0, 1, 2, 3].map(i => $(`#h${i}`, el));
  let filter = 'none';

  img.onload = () => { initHandles(img, stage, handles, poly); };
  if (img.complete) initHandles(img, stage, handles, poly);

  $$('[data-filter]', el).forEach(b => b.onclick = () => {
    filter = b.dataset.filter;
    $$('[data-filter]', el).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
  $('#scanRetake', el).onclick = () => { close(); URL.revokeObjectURL(url); openScanFlow(noteId, onSave); };
  $('#scanSave', el).onclick = async () => {
    showToast('Memproses...', { icon: 'scan' });
    const blob = await cropAndFilter(img, handles, stage, filter);
    blob.name = `scan-${Date.now()}.jpg`;
    blob.lastModified = Date.now();
    const att = await addAttachment(noteId, blob, 'image');
    close();
    URL.revokeObjectURL(url);
    showToast('Scan disimpan', { icon: 'camera' });
    onSave?.(att);
  };
}

function initHandles(img, stage, handles, poly) {
  const W = img.offsetWidth, H = img.offsetHeight;
  const margin = Math.min(W, H) * 0.07;
  const pts = [
    [margin, margin], [W - margin, margin],
    [W - margin, H - margin], [margin, H - margin],
  ];
  handles.forEach((h, i) => {
    Object.assign(h.style, { left: pts[i][0] + 'px', top: pts[i][1] + 'px' });
    makeDraggable(h, stage, (x, y) => { pts[i] = [x, y]; updatePoly(poly, pts, stage); });
  });
  updatePoly(poly, pts, stage);
}
function updatePoly(poly, pts, stage) {
  const { width: W, height: H } = stage.getBoundingClientRect();
  poly.setAttribute('points', pts.map(([x, y]) => `${x},${y}`).join(' '));
  Object.assign(poly.closest('svg').style, { width: W + 'px', height: H + 'px', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' });
}
function makeDraggable(el, container, onMove) {
  let startX, startY, ox, oy;
  const getPos = (e) => e.touches ? e.touches[0] : e;
  const down = (e) => {
    e.preventDefault();
    const p = getPos(e), rect = container.getBoundingClientRect();
    startX = p.clientX; startY = p.clientY;
    ox = parseFloat(el.style.left); oy = parseFloat(el.style.top);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  const move = (e) => {
    const p = getPos(e);
    const nx = ox + (p.clientX - startX), ny = oy + (p.clientY - startY);
    el.style.left = nx + 'px'; el.style.top = ny + 'px';
    onMove(nx, ny);
  };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
  el.addEventListener('pointerdown', down);
}

async function cropAndFilter(img, handles, stage, filter) {
  const stageRect = stage.getBoundingClientRect();
  const scaleX = img.naturalWidth / img.offsetWidth;
  const scaleY = img.naturalHeight / img.offsetHeight;
  const pts = handles.map(h => [parseFloat(h.style.left) * scaleX, parseFloat(h.style.top) * scaleY]);

  // Simple bounding-box crop (perspective correction needs WebGL — out of scope)
  const minX = Math.max(0, Math.min(...pts.map(p => p[0])));
  const minY = Math.max(0, Math.min(...pts.map(p => p[1])));
  const maxX = Math.min(img.naturalWidth, Math.max(...pts.map(p => p[0])));
  const maxY = Math.min(img.naturalHeight, Math.max(...pts.map(p => p[1])));
  const cw = maxX - minX, ch = maxY - minY;

  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, minX, minY, cw, ch, 0, 0, cw, ch);

  if (filter === 'bw') {
    const imd = ctx.getImageData(0, 0, cw, ch);
    for (let i = 0; i < imd.data.length; i += 4) {
      const g = imd.data[i] * 0.299 + imd.data[i + 1] * 0.587 + imd.data[i + 2] * 0.114;
      imd.data[i] = imd.data[i + 1] = imd.data[i + 2] = g;
    }
    ctx.putImageData(imd, 0, 0);
  } else if (filter === 'enhance') {
    const imd = ctx.getImageData(0, 0, cw, ch);
    for (let i = 0; i < imd.data.length; i += 4) {
      imd.data[i] = Math.min(255, imd.data[i] * 1.15 + 10);
      imd.data[i + 1] = Math.min(255, imd.data[i + 1] * 1.1 + 5);
      imd.data[i + 2] = Math.min(255, imd.data[i + 2] * 1.05);
    }
    ctx.putImageData(imd, 0, 0);
  }
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

/* --------------------------------------------------------------------------
   Drawing canvas (finger / stylus — basic brush + shapes + eraser)
   -------------------------------------------------------------------------- */
export function openDrawCanvas(noteId, onSave) {
  const TOOLS = ['brush', 'eraser', 'line', 'rect', 'circle'];
  const COLORS = ['#1C1C1E', '#FF3B30', '#FF9F0A', '#34C759', '#5E5CE6', '#FFFFFF'];
  const SIZES = [3, 6, 12, 22];
  let tool = 'brush', color = '#1C1C1E', size = 6, drawing = false, snapshot = null;
  let sx = 0, sy = 0;

  const { el, close } = openSheet(`
    <div class="draw-toolbar" id="drawToolbar">
      <div class="segmented" style="flex:0 0 auto">
        ${TOOLS.map(t => `<button data-tool="${t}" title="${t}">${t === 'brush' ? '🖌️' : t === 'eraser' ? '🧹' : t === 'line' ? '⟍' : t === 'rect' ? '▭' : '○'}</button>`).join('')}
      </div>
      <div class="color-pill-bar">
        ${COLORS.map(c => `<span class="color-dot" data-color="${c}" style="background:${c}"></span>`).join('')}
        <input type="color" id="customColor" style="width:26px;height:26px;border-radius:50%;overflow:hidden;border:none;cursor:pointer;background:none;padding:0">
      </div>
      <div style="display:flex;gap:4px;align-items:center">
        ${SIZES.map(s => `<button class="size-btn" data-size="${s}" style="width:${s + 10}px;height:${s + 10}px;border-radius:50%;background:var(--text);opacity:.6;flex-shrink:0"></button>`).join('')}
      </div>
    </div>
    <div class="draw-canvas-wrap" style="height:55vmax;max-height:65vh">
      <canvas id="drawCanvas"></canvas>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-soft" id="drawClear" style="flex:0 0 auto">🗑️ Bersihkan</button>
      <button class="btn btn-primary" id="drawSave" style="flex:1">Simpan Gambar</button>
    </div>`, { title: 'Papan Coretan' });

  const canvas = $('#drawCanvas', el);
  const wrap = canvas.parentElement;
  const ctx = canvas.getContext('2d');

  const resize = () => {
    canvas.width = wrap.offsetWidth;
    canvas.height = wrap.offsetHeight;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  setTimeout(resize, 50);

  function ptFromEvent(e, canvas) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return [(src.clientX - r.left) * (canvas.width / r.width), (src.clientY - r.top) * (canvas.height / r.height)];
  }

  function startDraw(e) {
    drawing = true;
    [sx, sy] = ptFromEvent(e, canvas);
    if (['line', 'rect', 'circle'].includes(tool)) snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.beginPath(); ctx.moveTo(sx, sy);
  }
  function draw(e) {
    if (!drawing) return;
    const [cx, cy] = ptFromEvent(e, canvas);
    if (tool === 'brush' || tool === 'eraser') {
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineTo(cx, cy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, cy);
    } else if (snapshot) {
      ctx.putImageData(snapshot, 0, 0);
      ctx.strokeStyle = color; ctx.lineWidth = size;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      if (tool === 'line') { ctx.moveTo(sx, sy); ctx.lineTo(cx, cy); ctx.stroke(); }
      else if (tool === 'rect') { ctx.strokeRect(sx, sy, cx - sx, cy - sy); }
      else if (tool === 'circle') {
        const r = Math.hypot(cx - sx, cy - sy);
        ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  function endDraw() { drawing = false; snapshot = null; }

  canvas.addEventListener('pointerdown', startDraw);
  canvas.addEventListener('pointermove', draw);
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointercancel', endDraw);
  canvas.style.touchAction = 'none';

  // Toolbar wiring
  $$('[data-tool]', el).forEach(b => b.onclick = () => {
    tool = b.dataset.tool;
    $$('[data-tool]', el).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
  $$('[data-color]', el).forEach(s => s.onclick = () => { color = s.dataset.color; });
  $$('[data-size]', el).forEach(b => b.onclick = () => { size = +b.dataset.size; });
  $('#customColor', el).onchange = (e) => { color = e.target.value; };
  $('#drawClear', el).onclick = () => { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height); };
  $('#drawSave', el).onclick = () => {
    canvas.toBlob(async (blob) => {
      blob.name = `gambar-${Date.now()}.png`;
      blob.lastModified = Date.now();
      const att = await addAttachment(noteId, blob, 'image');
      close();
      showToast('Gambar disimpan', { icon: 'image' });
      onSave?.(att);
    }, 'image/png');
  };
}
