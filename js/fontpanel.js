/* ==========================================================================
   CATAT — fontpanel.js
   The "Aa" sheet: bold/italic/underline/strike, a size stepper, highlight +
   text color, and a curated font-family gallery. Stays open across multiple
   taps (unlike the single-shot emoji/math sheets) so people can layer a few
   changes on the same selection before dismissing it.
   ========================================================================== */

import { $, $$, icon, openSheet, showToast, escapeHtml } from './ui.js';

const HIGHLIGHT_COLORS = ['#FFB4A8', '#FFE066', '#D6F24B', '#8CF0DA', '#C9B6FF'];
const TEXT_COLORS = ['#1C1C1E', '#3B6EF5', '#E5484D', '#F5871F', '#2FAE5C', '#12B4D9'];

/* All entries work fully offline out of the box; the ones with a `cdn`
   also get a nicer, more distinct rendering once fetched (once, then cached
   by the service worker) — matching the visual variety in the reference
   app's font gallery without hard-depending on the network for any of it.
   Each entry ALSO carries local-only style hints (weight/style/spacing/
   case) that don't need any font file at all. Google Fonts can fail to
   load silently — blocked network, slow connection, offline first-run
   before the service worker has cached them — and when that happens the
   browser falls back to the same system font for every "Jenis Font" card,
   making the whole gallery look identical. Applying these hints as real
   inline styles (not just relying on font-family) means every option still
   looks distinct with zero network involved, and layers on top of the
   actual web font whenever that *does* load. */
const FONT_FAMILIES = [
  { id: 'default', label: 'Default', css: 'var(--font-sans)', cdn: null },
  { id: 'rounded', label: 'Bulat', css: '"Nunito", ui-rounded, var(--font-sans)', cdn: { name: 'Nunito', weights: '400;700;800' }, weight: 800 },
  { id: 'poppins', label: 'Ramah', css: '"Poppins", var(--font-sans)', cdn: { name: 'Poppins', weights: '400;600;700' }, weight: 500, spacing: '0.2px' },
  { id: 'serif', label: 'Serif', css: 'var(--font-serif)', cdn: null },
  { id: 'playfair', label: 'Elegan', css: '"Playfair Display", var(--font-serif)', cdn: { name: 'Playfair+Display', weights: '500;700' }, style: 'italic', spacing: '0.3px' },
  { id: 'caveat', label: 'Tulisan Tangan', css: '"Caveat", cursive', cdn: { name: 'Caveat', weights: '500;700' }, style: 'italic', weight: 600 },
  { id: 'bebas', label: 'Tegas', css: '"Bebas Neue", sans-serif', cdn: { name: 'Bebas+Neue', weights: '400' }, weight: 700, caps: true, spacing: '1px' },
  { id: 'quicksand', label: 'Playful', css: '"Quicksand", var(--font-sans)', cdn: { name: 'Quicksand', weights: '500;700' }, weight: 600, spacing: '0.2px' },
  { id: 'mono', label: 'Mono', css: 'var(--font-mono)', cdn: null },
];

/** Builds the full inline style string (font-family + the local-only
 *  weight/style/spacing/case hints above) for a FONT_FAMILIES entry. Used
 *  both for the gallery card previews and for the actual applied style. */
function fontStyleString(fam) {
  const parts = [`font-family:${fam.css}`];
  if (fam.weight) parts.push(`font-weight:${fam.weight}`);
  if (fam.style) parts.push(`font-style:${fam.style}`);
  if (fam.spacing) parts.push(`letter-spacing:${fam.spacing}`);
  if (fam.caps) parts.push('text-transform:uppercase');
  return parts.join(';');
}

const _loadedFonts = new Set();
function loadGoogleFont(cdn) {
  if (!cdn || _loadedFonts.has(cdn.name)) return;
  _loadedFonts.add(cdn.name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${cdn.name}:wght@${cdn.weights}&display=swap`;
  document.head.appendChild(link);
}

/** Eagerly fetches every curated Google Font as soon as the app boots (see
 *  main.js), instead of waiting for its card in the gallery below to be
 *  tapped. Loading them on-demand only, as this used to do, caused two
 *  real problems:
 *   1. A note saved with a custom font only rendered correctly in the same
 *      session where the font panel happened to be opened and that exact
 *      font clicked. Reopen the app and the @font-face was never
 *      requested, so the browser silently fell back to the default font —
 *      any note using a custom font looked "unloaded" after every restart.
 *   2. The font file was never cached by the service worker's
 *      stale-while-revalidate handler until that first manual click, so it
 *      needed a live network round-trip the very first time it was
 *      actually needed.
 *  Firing all six requests at boot lets them race in the background (they're
 *  a different origin from the app's own assets, so they don't compete with
 *  same-origin app files for a connection) and get cached for instant,
 *  offline-ready use well before anyone opens the font panel. `link`
 *  elements fetch asynchronously, so this never blocks first paint. */
export function preloadAllFonts() {
  FONT_FAMILIES.forEach(f => { if (f.cdn) loadGoogleFont(f.cdn); });
}

function wrapRange(range, styleText) {
  const wrapper = document.createElement('span');
  if (styleText) wrapper.setAttribute('style', styleText);
  try {
    range.surroundContents(wrapper);
  } catch {
    const frag = range.extractContents();
    wrapper.appendChild(frag);
    range.insertNode(wrapper);
  }
  return wrapper;
}

/** @param {HTMLElement} contentEl - the contenteditable note body
 *  @param {Range} savedRange - selection captured right before the sheet opened
 *  @param {(forceBreak?: boolean) => void} commit - autosave + history hook */
export function openFontPanel(contentEl, savedRange, commit) {
  if (!savedRange || savedRange.collapsed) {
    showToast('Pilih teks dulu untuk mengatur font');
    return;
  }
  let workingRange = savedRange.cloneRange();
  let activeWrapper = null;
  let fontSize = 16;
  try {
    const node = workingRange.startContainer.nodeType === 3 ? workingRange.startContainer.parentElement : workingRange.startContainer;
    const cs = node ? getComputedStyle(node) : null;
    if (cs && cs.fontSize) fontSize = Math.round(parseFloat(cs.fontSize)) || 16;
  } catch {}

  function ensureWrapper() {
    if (activeWrapper && activeWrapper.isConnected) return activeWrapper;
    activeWrapper = wrapRange(workingRange, '');
    workingRange = document.createRange();
    workingRange.selectNodeContents(activeWrapper);
    return activeWrapper;
  }

  const html = `
    <div class="fp-header">
      <span class="fp-header-title">Font</span>
      <button class="icon-btn plain" id="fpCloseBtn" aria-label="Selesai">${icon('check', 20)}</button>
    </div>
    <div class="fp-row">
      <div class="fp-bius">
        <button class="fp-bius-btn" data-fp="bold" aria-label="Tebal"><b>B</b></button>
        <button class="fp-bius-btn" data-fp="italic" aria-label="Miring"><i>I</i></button>
        <button class="fp-bius-btn" data-fp="underline" aria-label="Garis bawah"><u>U</u></button>
        <button class="fp-bius-btn" data-fp="strikeThrough" aria-label="Coret"><s>S</s></button>
      </div>
      <div class="fp-size">
        ${icon('type', 16)}
        <button class="fp-size-btn" data-fp="size-dec" aria-label="Perkecil">−</button>
        <span class="fp-size-val" id="fpSizeVal">${fontSize}</span>
        <button class="fp-size-btn" data-fp="size-inc" aria-label="Perbesar">+</button>
      </div>
    </div>

    <div class="field-label" style="margin-top:16px">Warna Sorot</div>
    <div class="fp-swatch-row">
      <button class="fp-swatch fp-swatch-none active" data-bg="" aria-label="Tanpa sorot">${icon('close', 12)}</button>
      ${HIGHLIGHT_COLORS.map(c => `<button class="fp-swatch" data-bg="${c}" style="background:${c}" aria-label="Sorot ${c}"></button>`).join('')}
      <label class="fp-swatch fp-swatch-rainbow" aria-label="Warna sorot kustom">
        <input type="color" data-bg-custom value="#ffe066">
      </label>
    </div>

    <div class="field-label" style="margin-top:16px">Warna Teks</div>
    <div class="fp-swatch-row">
      ${TEXT_COLORS.map((c, i) => `<button class="fp-swatch${i === 0 ? ' active' : ''}" data-fg="${c}" style="background:${c}" aria-label="Teks ${c}"></button>`).join('')}
      <label class="fp-swatch fp-swatch-rainbow" aria-label="Warna teks kustom">
        <input type="color" data-fg-custom value="#1c1c1e">
      </label>
    </div>

    <div class="field-label" style="margin-top:16px">Jenis Font</div>
    <div class="fp-font-grid">
      ${FONT_FAMILIES.map((f, i) => `<button class="fp-font-card${i === 0 ? ' active' : ''}" data-font="${f.id}" style="${escapeHtml(fontStyleString(f))}">${escapeHtml(f.label)}</button>`).join('')}
    </div>
  `;

  const { el, close } = openSheet(html);
  $('#fpCloseBtn', el).onclick = () => close();

  $$('[data-fp]', el).forEach(btn => btn.onclick = () => {
    const cmd = btn.dataset.fp;
    if (['bold', 'italic', 'underline', 'strikeThrough'].includes(cmd)) {
      contentEl.focus();
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(workingRange);
      document.execCommand(cmd);
      if (sel.rangeCount) workingRange = sel.getRangeAt(0).cloneRange();
      commit(true);
      return;
    }
    if (cmd === 'size-dec' || cmd === 'size-inc') {
      fontSize = Math.max(10, Math.min(48, fontSize + (cmd === 'size-inc' ? 2 : -2)));
      $('#fpSizeVal', el).textContent = fontSize;
      ensureWrapper().style.fontSize = fontSize + 'px';
      commit(true);
    }
  });

  $$('[data-bg]', el).forEach(b => b.onclick = () => {
    $$('[data-bg]', el).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    ensureWrapper().style.backgroundColor = b.dataset.bg || '';
    commit(true);
  });
  const bgCustom = $('[data-bg-custom]', el);
  bgCustom.oninput = () => {
    $$('[data-bg]', el).forEach(x => x.classList.remove('active'));
    ensureWrapper().style.backgroundColor = bgCustom.value;
    commit(true);
  };

  $$('[data-fg]', el).forEach(b => b.onclick = () => {
    $$('[data-fg]', el).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    ensureWrapper().style.color = b.dataset.fg;
    commit(true);
  });
  const fgCustom = $('[data-fg-custom]', el);
  fgCustom.oninput = () => {
    $$('[data-fg]', el).forEach(x => x.classList.remove('active'));
    ensureWrapper().style.color = fgCustom.value;
    commit(true);
  };

  $$('[data-font]', el).forEach(b => b.onclick = () => {
    $$('[data-font]', el).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const fam = FONT_FAMILIES.find(f => f.id === b.dataset.font);
    if (fam?.cdn) loadGoogleFont(fam.cdn);
    const wrapper = ensureWrapper();
    wrapper.style.fontFamily = fam.css;
    wrapper.style.fontWeight = fam.weight || '';
    wrapper.style.fontStyle = fam.style || '';
    wrapper.style.letterSpacing = fam.spacing || '';
    wrapper.style.textTransform = fam.caps ? 'uppercase' : '';
    commit(true);
  });
}

/** Same "Aa" sheet as openFontPanel above, but for styling a whole
 *  single-line element (the note title) rather than a rich-text selection
 *  inside a contenteditable body. The title is a plain `<input>`, and a
 *  native input can only ever hold one uniform style for its entire value
 *  — it has no way to hold a `<span>` wrapping part of the text — so
 *  every control here reads/writes the element's own inline style
 *  directly instead of wrapping a Range.
 *  @param {HTMLElement} el - the element to style (e.g. the title input)
 *  @param {() => void} persist - called after every change so the caller
 *    can save the element's resulting style (autosave + undo history) */
export function openFontPanelForElement(el, persist) {
  let fontSize = Math.round(parseFloat(getComputedStyle(el).fontSize)) || 16;
  const deco = new Set((el.style.textDecorationLine || el.style.textDecoration || '').split(' ').filter(Boolean));
  let isBold = /^(bold|[7-9]00)$/.test(el.style.fontWeight || '');
  let isItalic = el.style.fontStyle === 'italic';

  const html = `
    <div class="fp-header">
      <span class="fp-header-title">Font Judul</span>
      <button class="icon-btn plain" id="fpCloseBtn" aria-label="Selesai">${icon('check', 20)}</button>
    </div>
    <div class="fp-row">
      <div class="fp-bius">
        <button class="fp-bius-btn${isBold ? ' active' : ''}" data-fp="bold" aria-label="Tebal"><b>B</b></button>
        <button class="fp-bius-btn${isItalic ? ' active' : ''}" data-fp="italic" aria-label="Miring"><i>I</i></button>
        <button class="fp-bius-btn${deco.has('underline') ? ' active' : ''}" data-fp="underline" aria-label="Garis bawah"><u>U</u></button>
        <button class="fp-bius-btn${deco.has('line-through') ? ' active' : ''}" data-fp="strikeThrough" aria-label="Coret"><s>S</s></button>
      </div>
      <div class="fp-size">
        ${icon('type', 16)}
        <button class="fp-size-btn" data-fp="size-dec" aria-label="Perkecil">−</button>
        <span class="fp-size-val" id="fpSizeVal">${fontSize}</span>
        <button class="fp-size-btn" data-fp="size-inc" aria-label="Perbesar">+</button>
      </div>
    </div>

    <div class="field-label" style="margin-top:16px">Warna Sorot</div>
    <div class="fp-swatch-row">
      <button class="fp-swatch fp-swatch-none${!el.style.backgroundColor ? ' active' : ''}" data-bg="" aria-label="Tanpa sorot">${icon('close', 12)}</button>
      ${HIGHLIGHT_COLORS.map(c => `<button class="fp-swatch" data-bg="${c}" style="background:${c}" aria-label="Sorot ${c}"></button>`).join('')}
      <label class="fp-swatch fp-swatch-rainbow" aria-label="Warna sorot kustom">
        <input type="color" data-bg-custom value="#ffe066">
      </label>
    </div>

    <div class="field-label" style="margin-top:16px">Warna Teks</div>
    <div class="fp-swatch-row">
      <button class="fp-swatch fp-swatch-none${!el.style.color ? ' active' : ''}" data-fg="" aria-label="Warna default">${icon('close', 12)}</button>
      ${TEXT_COLORS.map(c => `<button class="fp-swatch" data-fg="${c}" style="background:${c}" aria-label="Teks ${c}"></button>`).join('')}
      <label class="fp-swatch fp-swatch-rainbow" aria-label="Warna teks kustom">
        <input type="color" data-fg-custom value="#1c1c1e">
      </label>
    </div>

    <div class="field-label" style="margin-top:16px">Jenis Font</div>
    <div class="fp-font-grid">
      ${FONT_FAMILIES.map((f) => `<button class="fp-font-card" data-font="${f.id}" style="${escapeHtml(fontStyleString(f))}">${escapeHtml(f.label)}</button>`).join('')}
    </div>
  `;

  const { el: sheetEl, close } = openSheet(html);
  $('#fpCloseBtn', sheetEl).onclick = () => close();

  function applyDeco() { el.style.textDecoration = [...deco].join(' '); }

  $$('[data-fp]', sheetEl).forEach(btn => btn.onclick = () => {
    const cmd = btn.dataset.fp;
    if (cmd === 'bold') { isBold = btn.classList.toggle('active'); el.style.fontWeight = isBold ? '800' : ''; persist(); return; }
    if (cmd === 'italic') { isItalic = btn.classList.toggle('active'); el.style.fontStyle = isItalic ? 'italic' : ''; persist(); return; }
    if (cmd === 'underline') { btn.classList.toggle('active') ? deco.add('underline') : deco.delete('underline'); applyDeco(); persist(); return; }
    if (cmd === 'strikeThrough') { btn.classList.toggle('active') ? deco.add('line-through') : deco.delete('line-through'); applyDeco(); persist(); return; }
    if (cmd === 'size-dec' || cmd === 'size-inc') {
      fontSize = Math.max(12, Math.min(40, fontSize + (cmd === 'size-inc' ? 2 : -2)));
      $('#fpSizeVal', sheetEl).textContent = fontSize;
      el.style.fontSize = fontSize + 'px';
      persist();
    }
  });

  $$('[data-bg]', sheetEl).forEach(b => b.onclick = () => {
    $$('[data-bg]', sheetEl).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    el.style.backgroundColor = b.dataset.bg || '';
    persist();
  });
  const bgCustom = $('[data-bg-custom]', sheetEl);
  bgCustom.oninput = () => {
    $$('[data-bg]', sheetEl).forEach(x => x.classList.remove('active'));
    el.style.backgroundColor = bgCustom.value;
    persist();
  };

  $$('[data-fg]', sheetEl).forEach(b => b.onclick = () => {
    $$('[data-fg]', sheetEl).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    el.style.color = b.dataset.fg || '';
    persist();
  });
  const fgCustom = $('[data-fg-custom]', sheetEl);
  fgCustom.oninput = () => {
    $$('[data-fg]', sheetEl).forEach(x => x.classList.remove('active'));
    el.style.color = fgCustom.value;
    persist();
  };

  $$('[data-font]', sheetEl).forEach(b => b.onclick = () => {
    $$('[data-font]', sheetEl).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const fam = FONT_FAMILIES.find(f => f.id === b.dataset.font);
    if (fam?.cdn) loadGoogleFont(fam.cdn);
    el.style.fontFamily = fam.css;
    el.style.letterSpacing = fam.spacing || '';
    el.style.textTransform = fam.caps ? 'uppercase' : '';
    // Font-family choice doesn't fight the standalone bold/italic toggles
    // above — only fill in a weight/style from the preset if the person
    // hasn't already set one of their own.
    if (!isBold && fam.weight) el.style.fontWeight = fam.weight;
    if (!isItalic && fam.style) el.style.fontStyle = fam.style;
    persist();
  });
}
