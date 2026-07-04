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

export function createVerticalToolbar(hostEl, { primary, secondary = [], onAction, storageKey = 'vtbPos' }) {
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

  /* The toolbar can be dragged freely in both directions (not just up/down
   * along a fixed right edge like before), but stays clamped to the same
   * safe on-screen region shown in the app's own reference layout: below
   * the topbar, above the bottom safe-area inset, and never past the left
   * or right edges. `left`/`top` (not `right`) are what's actually
   * persisted and restored, since free 2D dragging needs both axes. */
  const EDGE_MARGIN = 10;
  const safeLeftPx = () => EDGE_MARGIN + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-l')) || 0);
  const safeRightPx = () => EDGE_MARGIN + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-r')) || 0);
  const safeBottomPx = () => 12 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-b')) || 0);
  function clamp(left, top) {
    const w = wrap.offsetWidth || 54, h = wrap.offsetHeight || 54;
    const minLeft = safeLeftPx();
    const maxLeft = Math.max(minLeft, window.innerWidth - w - safeRightPx());
    const minTop = 72;
    const maxTop = Math.max(minTop, viewportHeight() - h - safeBottomPx());
    return { left: Math.max(minLeft, Math.min(left, maxLeft)), top: Math.max(minTop, Math.min(top, maxTop)) };
  }

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch {}
  const defaultTop = Math.round(viewportHeight() * 0.30);
  const defaultLeft = window.innerWidth - (wrap.offsetWidth || 54) - safeRightPx();
  const initial = clamp(saved?.left ?? defaultLeft, saved?.top ?? defaultTop);
  wrap.style.left = initial.left + 'px';
  wrap.style.top = initial.top + 'px';

  requestAnimationFrame(() => wrap.classList.add('show'));

  const handle = $('#vtbHandle', wrap);
  let collapsed = false;
  let dragMoved = false;
  let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0, pid = null;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true; dragMoved = false; startX = e.clientX; startY = e.clientY; pid = e.pointerId;
    const rect = wrap.getBoundingClientRect();
    startLeft = rect.left; startTop = rect.top;
    try { handle.setPointerCapture(pid); } catch {}
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
    const pos = clamp(startLeft + dx, startTop + dy);
    wrap.style.left = pos.left + 'px';
    wrap.style.top = pos.top + 'px';
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(pid); } catch {}
    if (dragMoved) {
      hapticTap(6);
      sessionStorage.setItem(storageKey, JSON.stringify({ left: parseFloat(wrap.style.left) || 0, top: parseFloat(wrap.style.top) || 0 }));
    } else {
      collapsed = !collapsed;
      wrap.classList.toggle('collapsed', collapsed);
      hapticTap(8);
    }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // Re-clamp on viewport resize (e.g. rotation, keyboard show/hide) so the
  // toolbar can never end up stranded off-screen.
  const onResize = () => {
    const pos = clamp(parseFloat(wrap.style.left) || 0, parseFloat(wrap.style.top) || 0);
    wrap.style.left = pos.left + 'px';
    wrap.style.top = pos.top + 'px';
  };
  window.addEventListener('resize', onResize);

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
    destroy: () => { window.removeEventListener('resize', onResize); wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 220); },
    setActive: (id, isActive) => { const b = wrap.querySelector(`[data-action="${id}"]`); if (b) b.classList.toggle('active', !!isActive); },
  };
}
