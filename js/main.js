/* ==========================================================================
   CATAT — main.js
   Router, app-shell bootstrap, lock screen, reminder notification daemon.
   ========================================================================== */

import { initDB, getSetting, setSetting, isLocked, getLockConfig,
         verifyUnlock, unlockWithFingerprint, lockApp, createNote,
         getAllReminders, markReminderNotified } from './db.js';
import { $, $$, icon, escapeHtml, openSheet, showToast, updateThemeColorMeta, isStandaloneDisplay, initInstallPrompt } from './ui.js';
import {
  renderDashboard, renderBrowse, renderSearch,
  renderGraph, renderSettings, renderReader,
} from './views.js';
import { renderNoteView } from './editor.js';

/* ── constants ── */
const THEME_BG_MAP = {
  light:'#F2F2F7', dark:'#131316', amoled:'#000000', cyberpunk:'#0A0414',
  paper:'#F3EBDA', forest:'#0E1812', anime:'#FFF3F8', minimal:'#FAFAFA',
};

/* ── minimal view cache so switching tabs feels instant ── */
let _currentRoute = null;
let _cleanupFn = null;

/* ── Hash router ── */
function parseRoute(hash) {
  const h = (hash || window.location.hash || '#/').replace(/^#/, '');
  const parts = h.split('/').filter(Boolean);
  const route = parts[0] || '';
  const params = {};
  if (route === 'note' && parts[1]) {
    params.id = parts[1];
    if (parts[2] === 'reader') params.reader = true;
  }
  if (route === 'browse' && parts[1]) params.folderId = parts[1];
  if (route === 'reader' && parts[1]) params.id = parts[1];
  if (route === 'graph' && parts[1] === '3d') params.mode = '3d';
  return { route: route || 'home', params };
}

async function navigate(hash) {
  if (isLocked()) return;
  const prev = window.location.hash;
  if (hash !== prev) window.history.pushState(null, '', hash);
  await render(parseRoute(hash));
  window.scrollTo(0, 0);
}
function back() { window.history.back(); }

async function render({ route, params }) {
  if (isLocked()) { renderLockScreen(); return; }
  if (_cleanupFn) { _cleanupFn(); _cleanupFn = null; }

  const viewEl = document.getElementById('mainView');
  viewEl.innerHTML = '';

  // Tab bar highlight
  $$('.tab-btn').forEach(b => b.classList.remove('active'));
  const tabMap = { home: 'tabHome', browse: 'tabBrowse', search: 'tabSearch', graph: 'tabGraph', settings: 'tabSettings' };
  const activeTab = document.getElementById(tabMap[route]);
  if (activeTab) activeTab.classList.add('active');
  // Nested note routes still highlight browse
  if (route === 'note') document.getElementById('tabBrowse')?.classList.add('active');

  const ctx = { navigate, back, rerender: () => render({ route, params }) };

  switch (route) {
    case 'home':
    case '':
      await renderDashboard(viewEl, params, ctx); break;
    case 'browse':
      await renderBrowse(viewEl, params, ctx); break;
    case 'search':
      await renderSearch(viewEl, params, ctx); break;
    case 'graph':
      await renderGraph(viewEl, params, ctx); break;
    case 'settings':
      await renderSettings(viewEl, params, ctx); break;
    case 'note':
      if (params.id === 'new') {
        const freshNote = await createNote({ title: '', content: '' });
        await navigate('#/note/' + freshNote.id);
        return;
      }
      if (params.reader) {
        await renderReader(viewEl, params, ctx);
      } else {
        _cleanupFn = await renderNoteView(viewEl, params, ctx) || null;
      }
      break;
    case 'reader':
      await renderReader(viewEl, params, ctx); break;
    default:
      await renderDashboard(viewEl, {}, ctx);
  }
  _currentRoute = { route, params };
}

/* ── App Shell HTML (injected into body before first render) ── */
function buildShell() {
  document.body.innerHTML = `
  <div id="app" data-theme="">
    <div id="mainView" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden"></div>
    <nav class="tabbar" role="tablist" aria-label="Navigasi utama">
      <button class="tab-btn" id="tabHome" role="tab" aria-label="Beranda" data-nav="#/">
        ${icon('home', 24)}<span>Beranda</span>
      </button>
      <button class="tab-btn" id="tabBrowse" role="tab" aria-label="Catatan" data-nav="#/browse">
        ${icon('browse', 24)}<span>Catatan</span>
      </button>
      <button class="tab-btn" id="tabSearch" role="tab" aria-label="Cari" data-nav="#/search">
        ${icon('search', 24)}<span>Cari</span>
      </button>
      <button class="tab-btn" id="tabGraph" role="tab" aria-label="Graf" data-nav="#/graph">
        ${icon('graph', 24)}<span>Graf</span>
      </button>
      <button class="tab-btn" id="tabSettings" role="tab" aria-label="Pengaturan" data-nav="#/settings">
        ${icon('settings', 24)}<span>Setelan</span>
      </button>
    </nav>
    <button class="fab" id="fabNew" aria-label="Catatan baru">${icon('plus', 26)}</button>
  </div>
  <div id="toastStack" class="toast-stack"></div>`;
}

/* ── Lock screen (drawn inside #mainView, no tab/fab visible) ── */
function renderLockScreen() {
  const viewEl = document.getElementById('mainView');
  // Hide FAB + tabbar while locked
  document.getElementById('fabNew').style.display = 'none';
  document.querySelector('.tabbar').style.display = 'none';

  viewEl.innerHTML = `
  <div class="lock-screen view-enter">
    <div class="lock-icon">${icon('lock', 32)}</div>
    <h2 style="font-size:22px;font-weight:800;margin-bottom:4px">Catat Terkunci</h2>
    <p class="muted" style="text-align:center;max-width:260px;font-size:14px">Masukkan PIN kamu untuk melanjutkan</p>
    <div class="pin-dots" id="pinDots">
      <span class="d"></span><span class="d"></span>
      <span class="d"></span><span class="d"></span>
    </div>
    <div class="keypad" id="lockKeypad">
      ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => `<button class="key-btn" data-k="${k}" ${k==='' ? 'style="background:none;cursor:default"' : ''}>${k}</button>`).join('')}
    </div>
    <div id="fpSection" style="margin-top:8px"></div>
  </div>`;

  let pin = '';
  const dots = $$('.d', viewEl);
  const updateDots = () => dots.forEach((d, i) => d.classList.toggle('filled', i < pin.length));

  function shakeAndClear() {
    const dotsEl = $('#pinDots', viewEl);
    dotsEl.classList.add('shake');
    setTimeout(() => { dotsEl.classList.remove('shake'); pin = ''; updateDots(); }, 420);
  }

  $$('.key-btn', viewEl).forEach(btn => btn.onclick = async () => {
    const k = btn.dataset.k;
    if (k === '⌫') { pin = pin.slice(0, -1); updateDots(); return; }
    if (k === '') return;
    pin += k; updateDots();
    if (pin.length === 4) {
      const ok = await verifyUnlock(pin);
      if (ok) {
        document.getElementById('fabNew').style.display = '';
        document.querySelector('.tabbar').style.display = '';
        await render(parseRoute(window.location.hash));
      } else { shakeAndClear(); showToast('PIN salah', { icon: 'close' }); }
    }
  });

  // Fingerprint option
  getLockConfig().then(async cfg => {
    if (cfg?.fingerprint) {
      const fpSec = $('#fpSection', viewEl);
      fpSec.innerHTML = `<button class="btn btn-soft" id="fpUnlockBtn">${icon('fingerprint', 18)} Buka dengan Sidik Jari</button>`;
      $('#fpUnlockBtn', viewEl).onclick = async () => {
        try {
          await unlockWithFingerprint();
          document.getElementById('fabNew').style.display = '';
          document.querySelector('.tabbar').style.display = '';
          await render(parseRoute(window.location.hash));
        } catch { showToast('Sidik jari gagal — coba PIN', { icon: 'fingerprint' }); }
      };
    }
  });
}

/* ── Reminder daemon (polls every 30 s while tab visible) ── */
let _reminderInterval = null;
async function tickReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reminders = await getAllReminders();
  const now = Date.now();
  for (const r of reminders) {
    if (r.notified) continue;
    if (new Date(r.datetime).getTime() <= now) {
      new Notification(r.title || 'Pengingat Catat', { body: 'Saatnya: ' + r.title, icon: 'icons/icon-192.png', tag: r.id });
      await markReminderNotified(r.id);
    }
  }
}
function startReminderDaemon() {
  clearInterval(_reminderInterval);
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  _reminderInterval = setInterval(tickReminders, 30000);
  tickReminders();
}

/* ── Splash screen removal ── */
function removeSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('splash-out');
  setTimeout(() => splash.remove(), 460);
}

/* ── Bootstrap ── */
async function boot() {
  // 1. Ensure DB is ready
  await initDB();

  // 2. Build shell (empties body except splash)
  buildShell();

  // 3. Apply saved theme
  const theme = await getSetting('theme', 'dark');
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('app').setAttribute('data-theme', theme);
  updateThemeColorMeta(THEME_BG_MAP[theme] || '#131316');

  // 4. Init PWA install prompt listener early
  initInstallPrompt();

  // 5. Check lock
  const lockCfg = await getLockConfig();
  if (lockCfg && lockCfg.enabled) {
    lockApp();
    renderLockScreen();
  } else {
    // 6. Route
    await render(parseRoute(window.location.hash));
  }

  // 7. Wire FAB
  document.getElementById('fabNew').onclick = async () => {
    const note = await createNote({ title: '', content: '' });
    navigate('#/note/' + note.id);
  };

  // 8. Wire tab bar
  $$('[data-nav]').forEach(btn => btn.onclick = () => navigate(btn.dataset.nav));

  // 9. Browser back/forward
  window.addEventListener('popstate', () => {
    const { route, params } = parseRoute(window.location.hash);
    render({ route, params });
  });

  // 10. Remove splash
  removeSplash();

  // 11. Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // 12. Start reminder daemon
  startReminderDaemon();

  // 13. Periodic lock: if user sets lock and navigates away > 5 min, re-lock
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') return;
    const cfg = await getLockConfig();
    if (cfg?.enabled) {
      // mark hide time
      sessionStorage.setItem('_catat_hide', String(Date.now()));
    }
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const hideTs = sessionStorage.getItem('_catat_hide');
    if (!hideTs) return;
    const elapsed = Date.now() - Number(hideTs);
    const cfg = await getLockConfig();
    if (cfg?.enabled && elapsed > 5 * 60 * 1000) {
      lockApp();
      renderLockScreen();
    }
  });
}

boot().catch((err) => {
  console.error('[Catat] Boot failed:', err);
  // Never leave the splash frozen with no feedback — show a visible,
  // dismissable error instead of hanging forever with nothing clickable.
  const splash = document.getElementById('splash');
  if (splash) {
    splash.insertAdjacentHTML('beforeend', `
      <div style="margin-top:22px;padding:0 32px;text-align:center">
        <p style="color:#ff6b6b;font-size:13px;font-weight:600;margin-bottom:10px">Gagal memuat aplikasi</p>
        <p style="color:rgba(255,255,255,.6);font-size:12px;line-height:1.5;margin-bottom:16px">${escapeHtml(err?.message || String(err))}</p>
        <button onclick="location.reload()" style="background:#5E5CE6;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:700">Coba Lagi</button>
      </div>`);
  }
});
