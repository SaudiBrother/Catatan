/* ==========================================================================
   CATAT — auth.js
   Lightweight PIN gate shared by per-note lock, per-category lock, and
   anything else that wants to reuse the app's existing PIN/master-key
   without forcing the full app-wide "Kunci Aplikasi" lock screen.
   ========================================================================== */

import { getMasterKey, getLockConfig, ensureLockConfig, verifyUnlock } from './db.js';
import { $, $$, icon, openModal, showToast, pinKeypadHTML, attachPinKeypad } from './ui.js';

/** Resolves true once a session master key is available (prompting the user
 *  for a PIN — or to create one — if needed). Resolves false if the user
 *  cancels. Safe to call liberally before any lock-gated action. */
export async function ensureAuthenticated({ reason = 'Masukkan PIN untuk melanjutkan' } = {}) {
  if (getMasterKey()) return true;
  const cfg = await getLockConfig();
  if (!cfg) return openCreatePinFlow();
  return openEnterPinFlow(reason);
}

// Both flows below use the shared on-screen 0–9 keypad (see pinKeypadHTML /
// attachPinKeypad in ui.js) instead of a native text input. There's no
// field for a device keyboard to attach to, so there's no dependence on
// the phone actually switching to a numeric layout — only digit buttons
// exist, so anything other than a 4-digit PIN is physically impossible to
// enter here, which also guarantees it can always be typed back in on the
// app-wide lock screen (main.js), which uses this exact same component.
function openCreatePinFlow() {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <h3 style="text-align:center">Buat PIN Keamanan</h3>
      <p class="muted" style="margin-bottom:14px;text-align:center">PIN ini dipakai untuk mengunci catatan atau kategori tertentu. PIN yang sama juga bisa dipakai untuk mengunci seluruh aplikasi lewat Pengaturan.</p>
      <p class="muted" id="authCreateStep" style="font-size:13px;font-weight:700;text-align:center;margin-bottom:10px">Masukkan 4 angka PIN baru</p>
      <div style="display:flex;flex-direction:column;align-items:center">${pinKeypadHTML('authPin')}</div>
      <div class="modal-actions">
        <button class="btn btn-soft btn-block" data-act="cancel">Batal</button>
      </div>`);
    const stepLabel = $('#authCreateStep', el);
    $('[data-act="cancel"]', el).onclick = () => { close(); resolve(false); };

    let firstPin = null;
    const keypad = attachPinKeypad(el, 'authPin', {
      onFilled: async (pin) => {
        if (firstPin === null) {
          firstPin = pin;
          stepLabel.textContent = 'Ulangi 4 angka PIN yang sama';
          keypad.clear();
          return;
        }
        if (pin !== firstPin) {
          showToast('PIN tidak sama, coba lagi');
          firstPin = null;
          stepLabel.textContent = 'Masukkan 4 angka PIN baru';
          keypad.shakeAndClear();
          return;
        }
        await ensureLockConfig(pin, 'pin');
        close(); resolve(true);
      },
    });
  });
}

function openEnterPinFlow(reason) {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <h3 style="text-align:center">Verifikasi PIN</h3>
      <p class="muted" style="margin-bottom:14px;text-align:center">${reason}</p>
      <div style="display:flex;flex-direction:column;align-items:center">${pinKeypadHTML('authPin')}</div>
      <div class="modal-actions">
        <button class="btn btn-soft btn-block" data-act="cancel">Batal</button>
      </div>`);
    $('[data-act="cancel"]', el).onclick = () => { close(); resolve(false); };
    const keypad = attachPinKeypad(el, 'authPin', {
      onFilled: async (pin) => {
        const ok = await verifyUnlock(pin);
        if (!ok) { showToast('PIN salah', { icon: 'lock' }); keypad.shakeAndClear(); return; }
        close(); resolve(true);
      },
    });
  });
}
