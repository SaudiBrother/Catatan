/* ==========================================================================
   CATAT — vtoolbar.js
   Floating vertical tool rail for the note editor (replaces the old fixed
   horizontal bottom bar). Draggable up/down along the right edge,
   collapsible to a small handle, internally scrollable, with a "Lainnya"
   sheet for secondary/advanced tools. Pure UI — dispatches action ids up to
   the caller via onAction, no knowledge of note/editor internals.
   ========================================================================== */

import { $, $$, icon, escapeHtml, hapticTap, openSheet } from './ui.js';

function viewportHeight() {
  return (window.visualViewport && window.visualViewport.height) || window.innerHeight;
}

export function createVerticalToolbar(hostEl, { primary, secondary = [], onAction, storageKey = 'vtbTop' }) {
  const wrap = document.createElement('div');
  wrap.className = 'vtoolbar';
  wrap.innerHTML = `
    <div class="vtb-handle" id="vtbHandle" aria-label="Geser atau ciutkan toolbar">${icon('grip', 16)}</div>
    <div class="vtb-scroll" id="vtbScroll">
      ${primary.map(b => `<button class="vtb-btn" data-action="${b.id}" title="${escapeHtml(b.label)}" aria-label="${escapeHtml(b.label)}">${icon(b.icon, 20)}</button>`).join('')}
      ${secondary.length ? `<button class="vtb-btn vtb-more" data-action="__more" title="Lainnya" aria-label="Lainnya">${icon('dotsGrid', 18)}</button>` : ''}
    </div>
  `;
  hostEl.appendChild(wrap);

  // Restore last position (best-effort; falls back to vertical center).
  const savedTop = Number(sessionStorage.getItem(storageKey) || 0);
  const initialTop = savedTop || Math.round(viewportHeight() * 0.30);
  wrap.style.top = Math.max(72, Math.min(initialTop, viewportHeight() - 200)) + 'px';

  requestAnimationFrame(() => wrap.classList.add('show'));

  const handle = $('#vtbHandle', wrap);
  let collapsed = false;
  let dragMoved = false;
  let dragging = false, startY = 0, startTop = 0, pid = null;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true; dragMoved = false; startY = e.clientY; pid = e.pointerId;
    startTop = wrap.getBoundingClientRect().top;
    try { handle.setPointerCapture(pid); } catch {}
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4) dragMoved = true;
    let top = startTop + dy;
    const maxTop = viewportHeight() - wrap.offsetHeight - 12;
    top = Math.max(72, Math.min(top, Math.max(72, maxTop)));
    wrap.style.top = top + 'px';
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(pid); } catch {}
    if (dragMoved) {
      hapticTap(6);
      sessionStorage.setItem(storageKey, String(parseFloat(wrap.style.top) || 0));
    } else {
      collapsed = !collapsed;
      wrap.classList.toggle('collapsed', collapsed);
      hapticTap(8);
    }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  $$('.vtb-btn', wrap).forEach((btn) => btn.onclick = () => {
    const action = btn.dataset.action;
    hapticTap(8);
    if (action === '__more') { openMoreSheet(); return; }
    onAction?.(action, btn);
  });

  function openMoreSheet() {
    const html = `<div class="fp-header"><span class="fp-header-title">Lainnya</span></div>
      <div class="more-tools-grid">
        ${secondary.map(b => `<button class="more-tool-btn" data-action="${b.id}">
          <span class="more-tool-ic">${icon(b.icon, 21)}</span>
          <span>${escapeHtml(b.label)}</span>
        </button>`).join('')}
      </div>`;
    const { el, close } = openSheet(html);
    $$('.more-tool-btn', el).forEach((btn) => btn.onclick = () => {
      hapticTap(8);
      close();
      onAction?.(btn.dataset.action, btn);
    });
  }

  return {
    el: wrap,
    destroy: () => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 220); },
    setActive: (id, isActive) => { const b = wrap.querySelector(`[data-action="${id}"]`); if (b) b.classList.toggle('active', !!isActive); },
  };
}
