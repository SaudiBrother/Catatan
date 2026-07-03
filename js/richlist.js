/* ==========================================================================
   CATAT — richlist.js
   A single unified "list item" element that can be a checklist, a bullet or
   a number — exactly like the reference app, where the same line toggles
   between ☐ / • / 1. via the toolbar. Each item has a drag handle and a
   delete button. Styling (font/size/color from fontpanel.js) lives on
   .li-text and is untouched by any of this, so it always survives.
   ========================================================================== */

import { $, $$, icon, makeSortable, hapticTap } from './ui.js';

/* ---------------- Element factory ---------------- */
export function createListItemEl(type, innerHTML = '', checked = false) {
  const div = document.createElement('div');
  div.className = 'list-item';
  div.dataset.listType = type;
  if (type === 'checklist') div.dataset.checked = checked ? 'true' : 'false';
  div.innerHTML =
    `<span class="li-handle" contenteditable="false" aria-hidden="true">${icon('grip', 15)}</span>` +
    `<span class="li-marker" contenteditable="false"></span>` +
    `<span class="li-text">${innerHTML || ''}</span>` +
    `<button class="li-delete" contenteditable="false" aria-label="Hapus item" tabindex="-1">${icon('close', 12)}</button>`;
  return div;
}

/** Converts notes saved by the older single-purpose checklist (before this
 *  module existed) into the new unified structure, in place. Safe to call
 *  on every note load — it's a no-op once migrated. */
export function migrateLegacyChecklist(container) {
  $$('.checklist-item', container).forEach((old) => {
    const checked = old.dataset.checked === 'true';
    const textEl = old.querySelector('.ctext');
    const html = textEl ? textEl.innerHTML : (old.textContent || '');
    old.replaceWith(createListItemEl('checklist', html, checked));
  });
}

/* ---------------- Caret helpers (scoped to a single .li-text) ---------------- */
function placeCaretAtStart(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
}
function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
}
function placeCaretAtOffset(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let node, count = 0;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (count + len >= offset) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, offset - count));
      range.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      return;
    }
    count += len;
  }
  placeCaretAtEnd(el);
}
function isCaretAtStart(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return false;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length === 0;
}
/** Cuts everything after the caret out of `el` (mutating it) and returns
 *  that trailing HTML as a string — used to split one item into two on Enter. */
function splitTextAtCaret(el) {
  const sel = window.getSelection();
  const range = sel.getRangeAt(0).cloneRange();
  range.setEndAfter(el.lastChild || el);
  const frag = range.extractContents();
  const wrap = document.createElement('div');
  wrap.appendChild(frag);
  return wrap.innerHTML;
}
function getCaretListItem(contentEl) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  node = node.nodeType === 3 ? node.parentElement : node;
  const li = node && node.closest ? node.closest('.list-item') : null;
  return (li && contentEl.contains(li)) ? li : null;
}

/* ---------------- Numbering ---------------- */
export function renumberLists(contentEl) {
  const items = $$('.list-item', contentEl);
  let counter = 0;
  items.forEach((item) => {
    if (item.dataset.listType !== 'number') { counter = 0; return; }
    const prev = item.previousElementSibling;
    const continuesRun = !!(prev && prev.classList && prev.classList.contains('list-item') && prev.dataset.listType === 'number');
    counter = continuesRun ? counter + 1 : 1;
    const marker = item.querySelector('.li-marker');
    if (marker) marker.dataset.num = String(counter);
  });
}

/* ---------------- Trailing "+ Tambah item" affordance ---------------- */
export function refreshAddItemAffordance(contentEl) {
  $$('.li-add-btn', contentEl).forEach((b) => b.remove());
  const items = $$('.list-item', contentEl);
  if (!items.length) return;
  const last = items[items.length - 1];
  const btn = document.createElement('button');
  btn.className = 'li-add-btn';
  btn.contentEditable = 'false';
  btn.dataset.addAfterType = last.dataset.listType;
  btn.innerHTML = `<span class="li-add-plus">${icon('plus', 13)}</span><span>Tambah item</span>`;
  last.after(btn);
}

/* ---------------- Toolbar entry point: toggle/convert at caret ---------------- */
export function toggleListType(contentEl, type) {
  const li = getCaretListItem(contentEl);

  if (li) {
    if (li.dataset.listType === type) {
      const textEl = li.querySelector('.li-text');
      const p = document.createElement('p');
      p.innerHTML = textEl.innerHTML.trim() ? textEl.innerHTML : '<br>';
      li.replaceWith(p);
      placeCaretAtStart(p);
    } else {
      li.dataset.listType = type;
      if (type === 'checklist' && li.dataset.checked === undefined) li.dataset.checked = 'false';
      placeCaretAtEnd(li.querySelector('.li-text'));
    }
    renumberLists(contentEl);
    refreshAddItemAffordance(contentEl);
    return;
  }

  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);

  if (!sel.isCollapsed) {
    let block = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    while (block && block.parentElement && block.parentElement !== contentEl) block = block.parentElement;
    const frag = range.extractContents();
    const wrap = document.createElement('div');
    wrap.appendChild(frag);
    const newLi = createListItemEl(type, wrap.innerHTML);
    range.insertNode(newLi);
    if (block && contentEl.contains(block) && block !== contentEl && block.textContent.trim() === '' && !block.querySelector('.list-item')) block.remove();
    placeCaretAtEnd(newLi.querySelector('.li-text'));
    renumberLists(contentEl);
    refreshAddItemAffordance(contentEl);
    return;
  }

  let block = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  while (block && block.parentElement && block.parentElement !== contentEl) block = block.parentElement;
  const isOwnLine = !!(block && contentEl.contains(block) && block !== contentEl);

  if (isOwnLine && block.textContent.trim() === '') {
    const newLi = createListItemEl(type, '');
    block.replaceWith(newLi);
    placeCaretAtStart(newLi.querySelector('.li-text'));
  } else if (isOwnLine) {
    const newLi = createListItemEl(type, block.innerHTML);
    block.replaceWith(newLi);
    placeCaretAtEnd(newLi.querySelector('.li-text'));
  } else {
    const newLi = createListItemEl(type, '');
    range.insertNode(newLi);
    placeCaretAtStart(newLi.querySelector('.li-text'));
  }
  renumberLists(contentEl);
  refreshAddItemAffordance(contentEl);
}

/* ---------------- Wiring: Enter/Backspace, checkbox tap, delete, drag ---------------- */
export function wireListEvents(contentEl, { commit, onStructural } = {}) {
  const touch = () => { renumberLists(contentEl); refreshAddItemAffordance(contentEl); onStructural?.(); commit(true); };

  contentEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'Backspace') return;
    const li = getCaretListItem(contentEl);
    if (!li) return;
    const textEl = li.querySelector('.li-text');

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const isEmpty = textEl.textContent.trim() === '';
      if (isEmpty) {
        const p = document.createElement('p'); p.innerHTML = '<br>';
        li.replaceWith(p);
        placeCaretAtStart(p);
      } else {
        const afterHTML = splitTextAtCaret(textEl);
        const newLi = createListItemEl(li.dataset.listType, afterHTML);
        if (li.dataset.listType === 'checklist') newLi.dataset.checked = 'false';
        li.after(newLi);
        placeCaretAtStart(newLi.querySelector('.li-text'));
      }
      touch();
      return;
    }

    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (!sel.isCollapsed) return;
      if (!isCaretAtStart(textEl)) return;
      e.preventDefault();
      const prev = li.previousElementSibling;
      if (prev && prev.classList.contains('list-item')) {
        const prevText = prev.querySelector('.li-text');
        const mergeOffset = prevText.textContent.length;
        prevText.innerHTML = (prevText.innerHTML || '') + (textEl.innerHTML || '');
        li.remove();
        placeCaretAtOffset(prevText, mergeOffset);
      } else {
        const p = document.createElement('p');
        p.innerHTML = textEl.innerHTML.trim() ? textEl.innerHTML : '<br>';
        li.replaceWith(p);
        placeCaretAtStart(p);
      }
      touch();
    }
  });

  contentEl.addEventListener('click', (e) => {
    const marker = e.target.closest('.list-item[data-list-type="checklist"] > .li-marker');
    if (marker) {
      const li = marker.closest('.list-item');
      li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
      hapticTap(8);
      onStructural?.();
      commit(true);
      return;
    }
    const delBtn = e.target.closest('.li-delete');
    if (delBtn) {
      const li = delBtn.closest('.list-item');
      const next = li.nextElementSibling;
      li.remove();
      if (next) {
        const t = next.classList?.contains('list-item') ? next.querySelector('.li-text') : null;
        if (t) placeCaretAtStart(t);
      }
      touch();
      return;
    }
    const addBtn = e.target.closest('.li-add-btn');
    if (addBtn) {
      const type = addBtn.dataset.addAfterType;
      const newLi = createListItemEl(type, '');
      if (type === 'checklist') newLi.dataset.checked = 'false';
      addBtn.before(newLi);
      placeCaretAtStart(newLi.querySelector('.li-text'));
      hapticTap(8);
      touch();
    }
  });

  makeSortable(contentEl, {
    handleSelector: '.li-handle',
    itemSelector: '.list-item',
    onReorder: touch,
  });
}
