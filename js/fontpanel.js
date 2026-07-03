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
   app's font gallery without hard-depending on the network for any of it. */
const FONT_FAMILIES = [
  { id: 'default', label: 'Default', css: 'var(--font-sans)', cdn: null },
  { id: 'rounded', label: 'Bulat', css: '"Nunito", ui-rounded, var(--font-sans)', cdn: { name: 'Nunito', weights: '400;700;800' } },
  { id: 'poppins', label: 'Ramah', css: '"Poppins", var(--font-sans)', cdn: { name: 'Poppins', weights: '400;600;700' } },
  { id: 'serif', label: 'Serif', css: 'var(--font-serif)', cdn: null },
  { id: 'playfair', label: 'Elegan', css: '"Playfair Display", var(--font-serif)', cdn: { name: 'Playfair+Display', weights: '500;700' } },
  { id: 'caveat', label: 'Tulisan Tangan', css: '"Caveat", cursive', cdn: { name: 'Caveat', weights: '500;700' } },
  { id: 'bebas', label: 'Tegas', css: '"Bebas Neue", sans-serif', cdn: { name: 'Bebas+Neue', weights: '400' } },
  { id: 'quicksand', label: 'Playful', css: '"Quicksand", var(--font-sans)', cdn: { name: 'Quicksand', weights: '500;700' } },
  { id: 'mono', label: 'Mono', css: 'var(--font-mono)', cdn: null },
];

const _loadedFonts = new Set();
function loadGoogleFont(cdn) {
  if (!cdn || _loadedFonts.has(cdn.name)) return;
  _loadedFonts.add(cdn.name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${cdn.name}:wght@${cdn.weights}&display=swap`;
  document.head.appendChild(link);
}
// CATATAN: font CDN sengaja TIDAK dimuat eager di sini. fontpanel.js diimpor
// oleh editor.js sejak boot aplikasi, jadi memuat semua 6 Google Font di sini
// berarti 6 request jaringan pada SETIAP kali app dibuka — bahkan jika panel
// font tidak pernah dibuka — bertentangan dgn janji "offline-first" di
// index.html. loadGoogleFont() sudah dipanggil per-font tepat saat kartu
// fontnya diklik di galeri (lihat renderFontGallery di bawah), jadi baris
// preview tetap lazy dan hanya memicu network saat benar-benar dibutuhkan.

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
      ${FONT_FAMILIES.map((f, i) => `<button class="fp-font-card${i === 0 ? ' active' : ''}" data-font="${f.id}" style="font-family:${f.css}">${escapeHtml(f.label)}</button>`).join('')}
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
    ensureWrapper().style.fontFamily = fam.css;
    commit(true);
  });
}
