/* ==========================================================================
   CATAT — auth.js
   Lightweight PIN gate shared by per-note lock, per-category lock, and
   anything else that wants to reuse the app's existing PIN/master-key
   without forcing the full app-wide "Kunci Aplikasi" lock screen.
   ========================================================================== */

import { getMasterKey, getLockConfig, ensureLockConfig, verifyUnlock } from './db.js';
import { $, $$, icon, openModal, showToast } from './ui.js';

/** Resolves true once a session master key is available (prompting the user
 *  for a PIN — or to create one — if needed). Resolves false if the user
 *  cancels. Safe to call liberally before any lock-gated action. */
export async function ensureAuthenticated({ reason = 'Masukkan PIN untuk melanjutkan' } = {}) {
  if (getMasterKey()) return true;
  const cfg = await getLockConfig();
  if (!cfg) return openCreatePinFlow();
  return openEnterPinFlow(reason);
}

function openCreatePinFlow() {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <h3>Buat PIN Keamanan</h3>
      <p class="muted" style="margin-bottom:14px">PIN ini dipakai untuk mengunci catatan atau kategori tertentu. PIN yang sama juga bisa dipakai untuk mengunci seluruh aplikasi lewat Pengaturan.</p>
      <input class="field" id="authPin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="PIN baru (min. 4 digit)" style="margin-bottom:10px" autocomplete="off">
      <input class="field" id="authPin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="Ulangi PIN">
      <div class="modal-actions">
        <button class="btn btn-soft btn-block" data-act="cancel">Batal</button>
        <button class="btn btn-primary btn-block" data-act="ok">Buat PIN</button>
      </div>`);
    setTimeout(() => $('#authPin1', el)?.focus(), 260);
    const submit = async () => {
      const p1 = $('#authPin1', el).value, p2 = $('#authPin2', el).value;
      if (p1.length < 4) { showToast('PIN minimal 4 digit'); return; }
      if (p1 !== p2) { showToast('PIN tidak sama'); return; }
      await ensureLockConfig(p1, 'pin');
      close(); resolve(true);
    };
    $('[data-act="cancel"]', el).onclick = () => { close(); resolve(false); };
    $('[data-act="ok"]', el).onclick = submit;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

function openEnterPinFlow(reason) {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <h3>Verifikasi PIN</h3>
      <p class="muted" style="margin-bottom:14px">${reason}</p>
      <input class="field" id="authPinIn" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="PIN" autocomplete="off">
      <div class="modal-actions">
        <button class="btn btn-soft btn-block" data-act="cancel">Batal</button>
        <button class="btn btn-primary btn-block" data-act="ok">Buka</button>
      </div>`);
    setTimeout(() => $('#authPinIn', el)?.focus(), 260);
    const submit = async () => {
      const pin = $('#authPinIn', el).value;
      if (!pin) return;
      const ok = await verifyUnlock(pin);
      if (!ok) { showToast('PIN salah', { icon: 'lock' }); $('#authPinIn', el).value = ''; return; }
      close(); resolve(true);
    };
    $('[data-act="cancel"]', el).onclick = () => { close(); resolve(false); };
    $('[data-act="ok"]', el).onclick = submit;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}
