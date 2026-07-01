/* ==========================================================================
   CATAT — db.js
   IndexedDB data layer + WebCrypto encryption. No external dependencies.
   Every other module reads/writes data exclusively through this file.
   ========================================================================== */

const DB_NAME = 'catat_db';
const DB_VERSION = 1;
let _db = null;

/** In-memory only — never persisted as raw bytes. Cleared on lock/reload. */
let _masterKey = null;
let _locked = false;

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
export const nowISO = () => new Date().toISOString();

/* --------------------------------------------------------------------------
   Low-level open / generic CRUD
   -------------------------------------------------------------------------- */

export function initDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('notes')) {
        const s = db.createObjectStore('notes', { keyPath: 'id' });
        s.createIndex('folderId', 'folderId');
        s.createIndex('updatedAt', 'updatedAt');
        s.createIndex('favorite', 'favorite');
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('folders')) {
        const s = db.createObjectStore('folders', { keyPath: 'id' });
        s.createIndex('parentId', 'parentId');
      }
      if (!db.objectStoreNames.contains('attachments')) {
        const s = db.createObjectStore('attachments', { keyPath: 'id' });
        s.createIndex('noteId', 'noteId');
      }
      if (!db.objectStoreNames.contains('versions')) {
        const s = db.createObjectStore('versions', { keyPath: 'id' });
        s.createIndex('noteId', 'noteId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('reminders')) {
        const s = db.createObjectStore('reminders', { keyPath: 'id' });
        s.createIndex('noteId', 'noteId');
        s.createIndex('datetime', 'datetime');
      }
      if (!db.objectStoreNames.contains('timeline')) {
        const s = db.createObjectStore('timeline', { keyPath: 'id' });
        s.createIndex('noteId', 'noteId');
        s.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains('keystore')) {
        db.createObjectStore('keystore', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(store, value) { return wrap(tx(store, 'readwrite').put(value)); }
async function dbGet(store, key) { return wrap(tx(store).get(key)); }
async function dbDelete(store, key) { return wrap(tx(store, 'readwrite').delete(key)); }
async function dbAll(store) { return wrap(tx(store).getAll()); }
async function dbAllByIndex(store, index, query) { return wrap(tx(store).index(index).getAll(query)); }

/* --------------------------------------------------------------------------
   Crypto primitives (AES-256-GCM, PBKDF2)
   -------------------------------------------------------------------------- */

function randBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

async function deriveKeyFromPassphrase(passphrase, saltB64) {
  const salt = b64ToBuf(saltB64);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function aesEncrypt(plainText, key) {
  const iv = randBytes(12);
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainText));
  return { iv: bufToB64(iv), data: bufToB64(buf) };
}
async function aesDecrypt(payload, key) {
  const iv = b64ToBuf(payload.iv);
  const data = b64ToBuf(payload.data);
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(buf);
}

/* --------------------------------------------------------------------------
   Lock / Encryption lifecycle
   -------------------------------------------------------------------------- */

export async function getLockConfig() {
  return (await dbGet('settings', 'lock')) || null;
}
export function isLocked() { return _locked; }
export function getMasterKey() { return _masterKey; }
export function lockApp() { _masterKey = null; _locked = true; }

/** First-time setup: derive a key from PIN/password, store a verification
 *  payload (never the password itself), then re-encrypt every existing note. */
export async function setupLock(passphrase, mode = 'pin') {
  const salt = bufToB64(randBytes(16));
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const verify = await aesEncrypt('catat-verify-ok', key);
  await dbPut('settings', { key: 'lock', value: { mode, salt, verify, enabled: true, fingerprint: false } });
  _masterKey = key;
  _locked = false;

  // Migrate existing notes to encrypted form.
  const notes = await dbAll('notes');
  for (const n of notes) {
    if (n.encrypted) continue;
    const encTitle = await aesEncrypt(n.title || '', key);
    const encContent = await aesEncrypt(n.content || '', key);
    n.title = encTitle; n.content = encContent; n.encrypted = true;
    await dbPut('notes', n);
  }
  return true;
}

export async function disableLock(passphrase) {
  const cfg = await getLockConfig();
  if (!cfg) return true;
  const key = await deriveKeyFromPassphrase(passphrase, cfg.salt);
  try { await aesDecrypt(cfg.verify, key); } catch { return false; }
  const notes = await dbAll('notes');
  for (const n of notes) {
    if (!n.encrypted) continue;
    n.title = await aesDecrypt(n.title, key);
    n.content = await aesDecrypt(n.content, key);
    n.encrypted = false;
    await dbPut('notes', n);
  }
  await dbDelete('settings', 'lock');
  await dbDelete('keystore', 'deviceKey');
  await dbDelete('keystore', 'wrappedKey');
  _masterKey = null; _locked = false;
  return true;
}

export async function verifyUnlock(passphrase) {
  const cfg = await getLockConfig();
  if (!cfg) return true;
  try {
    const key = await deriveKeyFromPassphrase(passphrase, cfg.salt);
    await aesDecrypt(cfg.verify, key);
    _masterKey = key; _locked = false;
    return true;
  } catch { return false; }
}

/** Convenience biometric unlock: a non-extractable AES key (deviceKey) is
 *  generated and stored directly as a CryptoKey object in IndexedDB. It
 *  wraps (encrypts) the raw master key bytes. WebAuthn gates *access* to
 *  that wrapped copy — it proves user presence, it does not itself supply
 *  key material. This is documented plainly in Settings: fingerprint is a
 *  convenience gate, the PIN/password remains the true cryptographic root. */
export async function isWebAuthnAvailable() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

export async function setupFingerprint(currentPassphrase) {
  const cfg = await getLockConfig();
  if (!cfg) throw new Error('Set up a PIN/password first.');
  const key = await deriveKeyFromPassphrase(currentPassphrase, cfg.salt);
  await aesDecrypt(cfg.verify, key); // throws if wrong

  const challenge = randBytes(32);
  const userId = randBytes(16);
  await navigator.credentials.create({
    publicKey: {
      challenge, rp: { name: 'Catat' },
      user: { id: userId, name: 'catat-user', displayName: 'Catat' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    }
  }).then(async (cred) => {
    const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const rawMaster = await crypto.subtle.exportKey('raw', key);
    const iv = randBytes(12);
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, deviceKey, rawMaster);
    await dbPut('keystore', { key: 'deviceKey', value: deviceKey });
    await dbPut('keystore', { key: 'wrappedKey', value: { iv: bufToB64(iv), data: bufToB64(wrapped) } });
    await dbPut('settings', { key: 'lock', value: { ...cfg, fingerprint: true, credentialId: bufToB64(cred.rawId) } });
  });
  return true;
}

export async function unlockWithFingerprint() {
  const cfg = await getLockConfig();
  if (!cfg || !cfg.fingerprint) throw new Error('Fingerprint unlock not set up.');
  await navigator.credentials.get({
    publicKey: {
      challenge: randBytes(32),
      allowCredentials: [{ id: b64ToBuf(cfg.credentialId), type: 'public-key' }],
      userVerification: 'required', timeout: 60000,
    }
  });
  const deviceKeyRow = await dbGet('keystore', 'deviceKey');
  const wrappedRow = await dbGet('keystore', 'wrappedKey');
  if (!deviceKeyRow || !wrappedRow) throw new Error('Device key missing.');
  const iv = b64ToBuf(wrappedRow.value.iv);
  const data = b64ToBuf(wrappedRow.value.data);
  const rawMaster = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, deviceKeyRow.value, data);
  _masterKey = await crypto.subtle.importKey('raw', rawMaster, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  _locked = false;
  return true;
}

async function maybeDecryptNote(n) {
  if (!n) return n;
  if (!n.encrypted) return n;
  if (!_masterKey) { return { ...n, title: '🔒 Terkunci', content: '', _locked: true }; }
  return {
    ...n,
    title: await aesDecrypt(n.title, _masterKey),
    content: await aesDecrypt(n.content, _masterKey),
  };
}
async function maybeEncryptForSave(n) {
  const cfg = await getLockConfig();
  if (!cfg || !cfg.enabled || !_masterKey) return { ...n, encrypted: false };
  return {
    ...n,
    title: await aesEncrypt(n.title || '', _masterKey),
    content: await aesEncrypt(n.content || '', _masterKey),
    encrypted: true,
  };
}

/* --------------------------------------------------------------------------
   Notes
   -------------------------------------------------------------------------- */

export async function createNote(partial = {}) {
  const note = {
    id: uid(),
    title: partial.title || '',
    content: partial.content || '',
    folderId: partial.folderId || null,
    tags: partial.tags || [],
    favorite: false,
    color: partial.color || null,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    encrypted: false,
  };
  await dbPut('notes', await maybeEncryptForSave(note));
  await logActivity(note.id, 'create', 'Catatan dibuat');
  await bumpStreak();
  return note;
}

export async function updateNote(id, patch, activityLabel = 'Diedit') {
  const raw = await dbGet('notes', id);
  if (!raw) return null;
  const current = await maybeDecryptNote(raw);
  const merged = { ...current, ...patch, id, updatedAt: nowISO() };
  delete merged._locked;
  await dbPut('notes', await maybeEncryptForSave(merged));
  await logActivity(id, 'edit', activityLabel);
  await bumpStreak();
  return merged;
}

export async function getNote(id) {
  const raw = await dbGet('notes', id);
  return maybeDecryptNote(raw);
}
export async function getAllNotes() {
  const raw = await dbAll('notes');
  return Promise.all(raw.map(maybeDecryptNote));
}
export async function getNotesByFolder(folderId) {
  const all = await getAllNotes();
  return all.filter(n => n.folderId === folderId);
}
export async function getFavoriteNotes() {
  const all = await getAllNotes();
  return all.filter(n => n.favorite).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}
export async function getRecentNotes(n = 5) {
  const all = await getAllNotes();
  return all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, n);
}
export async function toggleFavorite(id) {
  const n = await getNote(id);
  if (!n) return null;
  return updateNote(id, { favorite: !n.favorite }, n.favorite ? 'Dihapus dari favorit' : 'Ditambah ke favorit');
}
export async function deleteNote(id) {
  await dbDelete('notes', id);
  const atts = await dbAllByIndex('attachments', 'noteId', id);
  for (const a of atts) await dbDelete('attachments', a.id);
  const vers = await dbAllByIndex('versions', 'noteId', id);
  for (const v of vers) await dbDelete('versions', v.id);
}
export async function findNoteByTitle(title) {
  const all = await getAllNotes();
  return all.find(n => (n.title || '').trim().toLowerCase() === title.trim().toLowerCase());
}

/* --------------------------------------------------------------------------
   Folders (unlimited nesting via parentId)
   -------------------------------------------------------------------------- */

export async function createFolder({ name, parentId = null, color = '#5E5CE6', icon = '📁' }) {
  const folder = { id: uid(), name, parentId, color, icon, order: Date.now() };
  await dbPut('folders', folder);
  return folder;
}
export async function updateFolder(id, patch) {
  const f = await dbGet('folders', id);
  if (!f) return null;
  const merged = { ...f, ...patch };
  await dbPut('folders', merged);
  return merged;
}
export async function getAllFolders() { return dbAll('folders'); }
export async function getFolder(id) { return dbGet('folders', id); }
export async function deleteFolder(id, { reparentChildren = true } = {}) {
  const all = await getAllFolders();
  const children = all.filter(f => f.parentId === id);
  for (const c of children) {
    if (reparentChildren) await updateFolder(c.id, { parentId: null });
    else await deleteFolder(c.id, { reparentChildren });
  }
  const notes = await getNotesByFolder(id);
  for (const n of notes) await updateNote(n.id, { folderId: null }, 'Folder dihapus');
  await dbDelete('folders', id);
}
export function folderPath(folders, id) {
  const map = new Map(folders.map(f => [f.id, f]));
  const parts = [];
  let cur = map.get(id);
  while (cur) { parts.unshift(cur.name); cur = cur.parentId ? map.get(cur.parentId) : null; }
  return parts.join(' / ');
}
export function folderDepth(folders, id) {
  const map = new Map(folders.map(f => [f.id, f]));
  let depth = 0, cur = map.get(id);
  while (cur && cur.parentId) { depth++; cur = map.get(cur.parentId); }
  return depth;
}

/* --------------------------------------------------------------------------
   Attachments (any file type, stored as Blob — fully offline)
   -------------------------------------------------------------------------- */

export async function addAttachment(noteId, file, kind) {
  const att = {
    id: uid(), noteId, name: file.name || 'file', type: kind || file.type || 'application/octet-stream',
    mime: file.type || '', size: file.size || (file.byteLength ?? 0), blob: file, createdAt: nowISO(),
  };
  await dbPut('attachments', att);
  await logActivity(noteId, 'attachment', `Tambah lampiran: ${att.name}`);
  return att;
}
export async function getAttachmentsByNote(noteId) { return dbAllByIndex('attachments', 'noteId', noteId); }
export async function getAttachment(id) { return dbGet('attachments', id); }
export async function deleteAttachment(id) { return dbDelete('attachments', id); }

/* --------------------------------------------------------------------------
   Version history
   -------------------------------------------------------------------------- */

export async function saveVersion(noteId, title, content) {
  const v = { id: uid(), noteId, title, content, timestamp: nowISO() };
  await dbPut('versions', v);
  const all = await getVersions(noteId);
  if (all.length > 30) {
    const sorted = all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    await dbDelete('versions', sorted[0].id);
  }
  return v;
}
export async function getVersions(noteId) {
  const v = await dbAllByIndex('versions', 'noteId', noteId);
  return v.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}
export async function restoreVersion(versionId) {
  const v = await dbGet('versions', versionId);
  if (!v) return null;
  return updateNote(v.noteId, { title: v.title, content: v.content }, 'Versi dipulihkan');
}

/* --------------------------------------------------------------------------
   Settings (generic key/value)
   -------------------------------------------------------------------------- */

export async function getSetting(key, fallback = null) {
  const r = await dbGet('settings', key);
  return r ? r.value : fallback;
}
export async function setSetting(key, value) {
  await dbPut('settings', { key, value });
  // Mirror theme to localStorage so the synchronous anti-FOUC snippet
  // in index.html can read it without waiting for IndexedDB.
  if (key === 'theme') {
    try { localStorage.setItem('catat_theme_mirror', value); } catch {}
  }
  return value;
}

/* --------------------------------------------------------------------------
   Reminders
   -------------------------------------------------------------------------- */

export async function addReminder(noteId, title, datetime, repeat = 'none') {
  const r = { id: uid(), noteId, title, datetime, repeat, notified: false };
  await dbPut('reminders', r);
  return r;
}
export async function getAllReminders() {
  const r = await dbAll('reminders');
  return r.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}
export async function deleteReminder(id) { return dbDelete('reminders', id); }
export async function markReminderNotified(id) {
  const r = await dbGet('reminders', id);
  if (!r) return;
  r.notified = true;
  await dbPut('reminders', r);
}
export async function getTodayReminders() {
  const all = await getAllReminders();
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  return all.filter(r => { const d = new Date(r.datetime); return d >= today && d < tomorrow; });
}

/* --------------------------------------------------------------------------
   Timeline / activity log
   -------------------------------------------------------------------------- */

export async function logActivity(noteId, type, description) {
  const entry = { id: uid(), noteId, type, description, timestamp: nowISO() };
  await dbPut('timeline', entry);
  return entry;
}
export async function getTimelineForNote(noteId) {
  const t = await dbAllByIndex('timeline', 'noteId', noteId);
  return t.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}
export async function getAllActivity(limit = 100) {
  const t = await dbAll('timeline');
  return t.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
}
export async function getTodayActivity() {
  const all = await getAllActivity(500);
  const today = new Date(); today.setHours(0,0,0,0);
  return all.filter(e => new Date(e.timestamp) >= today);
}

/* --------------------------------------------------------------------------
   Gamification — streaks & badges
   -------------------------------------------------------------------------- */

function dayKey(d = new Date()) { return d.toISOString().slice(0, 10); }

export async function bumpStreak() {
  const data = (await getSetting('streak')) || { lastDay: null, current: 0, longest: 0, days: [] };
  const today = dayKey();
  if (data.lastDay === today) return data;
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  data.current = data.lastDay === yesterday ? data.current + 1 : 1;
  data.longest = Math.max(data.longest, data.current);
  data.lastDay = today;
  data.days = [...new Set([...(data.days || []), today])].slice(-365);
  await setSetting('streak', data);
  return data;
}
export async function getStreak() {
  return (await getSetting('streak')) || { lastDay: null, current: 0, longest: 0, days: [] };
}

const BADGE_DEFS = [
  { id: 'first_note', emoji: '✍️', label: 'Penulis Pemula', test: (s) => s.totalNotes >= 1 },
  { id: 'ten_notes', emoji: '📚', label: 'Kolektor', test: (s) => s.totalNotes >= 10 },
  { id: 'fifty_notes', emoji: '🏛️', label: 'Pustakawan', test: (s) => s.totalNotes >= 50 },
  { id: 'streak3', emoji: '🔥', label: '3 Hari Beruntun', test: (s) => s.streak.longest >= 3 },
  { id: 'streak7', emoji: '⚡', label: '7 Hari Beruntun', test: (s) => s.streak.longest >= 7 },
  { id: 'streak30', emoji: '🏆', label: 'Maraton 30 Hari', test: (s) => s.streak.longest >= 30 },
  { id: 'linker', emoji: '🕸️', label: 'Arsitek Wiki', test: (s) => s.totalLinks >= 5 },
  { id: 'organizer', emoji: '🗂️', label: 'Rapi Sekali', test: (s) => s.totalFolders >= 5 },
  { id: 'voice', emoji: '🎙️', label: 'Pencerita', test: (s) => s.totalVoice >= 1 },
  { id: 'wordsmith', emoji: '💬', label: '10K Kata', test: (s) => s.totalWords >= 10000 },
];
export async function getBadges(statsForBadges) {
  return BADGE_DEFS.map(b => ({ ...b, unlocked: !!b.test(statsForBadges) }));
}

/* --------------------------------------------------------------------------
   Statistics
   -------------------------------------------------------------------------- */

export function countWords(html) {
  const text = (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
  return text ? text.split(/\s+/).length : 0;
}
export function extractChecklist(html) {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  return [...div.querySelectorAll('.checklist-item')].map(el => ({
    text: el.querySelector('.ctext')?.textContent || '',
    done: el.dataset.checked === 'true',
  }));
}
export function extractWikiLinks(html) {
  if (!html) return [];
  const matches = [...html.matchAll(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g)];
  return matches.map(m => m[1].trim());
}

export async function computeStats() {
  const notes = await getAllNotes();
  const allAtt = await dbAll('attachments');
  const folders = await getAllFolders();
  let totalWords = 0, totalChecklist = 0, doneChecklist = 0, totalLinks = 0;
  const tagCount = {};
  const dayCount = {};
  for (const n of notes) {
    totalWords += countWords(n.content);
    const cl = extractChecklist(n.content);
    totalChecklist += cl.length;
    doneChecklist += cl.filter(c => c.done).length;
    totalLinks += extractWikiLinks(n.content).length;
    (n.tags || []).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });
    const d = (n.createdAt || '').slice(0, 10);
    if (d) dayCount[d] = (dayCount[d] || 0) + 1;
  }
  const photos = allAtt.filter(a => (a.mime || a.type || '').startsWith('image/')).length;
  const audio = allAtt.filter(a => (a.mime || a.type || '').startsWith('audio/')).length;
  const videos = allAtt.filter(a => (a.mime || a.type || '').startsWith('video/')).length;
  const docs = allAtt.length - photos - audio - videos;
  const streak = await getStreak();
  const stats = {
    totalNotes: notes.length, totalWords, totalChecklist, doneChecklist,
    pendingChecklist: totalChecklist - doneChecklist, totalFavorite: notes.filter(n => n.favorite).length,
    totalFolders: folders.length, totalAttachments: allAtt.length, photos, audio, videos, docs,
    totalLinks, tagCount, dayCount, streak, totalVoice: audio,
  };
  return stats;
}

/* --------------------------------------------------------------------------
   Search
   -------------------------------------------------------------------------- */

export async function searchNotes(query, filters = {}) {
  const all = await getAllNotes();
  const folders = await getAllFolders();
  let q = (query || '').trim().toLowerCase();
  let results = all;

  if (q.startsWith('#')) {
    const tagQ = q.slice(1);
    results = results.filter(n => (n.tags || []).some(t => t.toLowerCase().includes(tagQ)));
  } else if (q) {
    results = results.filter(n => {
      const cl = extractChecklist(n.content).map(c => c.text).join(' ');
      const hay = [n.title, (n.content || '').replace(/<[^>]+>/g, ' '), (n.tags || []).join(' '), cl, folderPath(folders, n.folderId)]
        .join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  if (filters.folderId) results = results.filter(n => n.folderId === filters.folderId);
  if (filters.favoriteOnly) results = results.filter(n => n.favorite);
  if (filters.hasChecklist) results = results.filter(n => extractChecklist(n.content).length > 0);
  if (filters.color) results = results.filter(n => n.color === filters.color);
  return results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/* --------------------------------------------------------------------------
   Backup / restore
   -------------------------------------------------------------------------- */

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
function b64ToBlob(b64, mime) {
  const bytes = b64ToBuf(b64);
  return new Blob([bytes], { type: mime });
}

export async function exportAllData({ includeAttachments = true } = {}) {
  const [notes, folders, versions, reminders, timeline, attachments] = await Promise.all([
    dbAll('notes'), dbAll('folders'), dbAll('versions'), dbAll('reminders'), dbAll('timeline'), dbAll('attachments'),
  ]);
  const lock = await getLockConfig();
  let attPacked = [];
  if (includeAttachments) {
    attPacked = await Promise.all(attachments.map(async a => ({
      ...a, blob: undefined, blobB64: await blobToB64(a.blob), blobType: a.blob.type,
    })));
  }
  return {
    app: 'catat', version: DB_VERSION, exportedAt: nowISO(),
    encrypted: !!(lock && lock.enabled),
    notes, folders, versions, reminders, timeline,
    attachments: attPacked,
  };
}

export async function importAllData(json, { merge = false } = {}) {
  if (!merge) {
    for (const store of ['notes', 'folders', 'attachments', 'versions', 'reminders', 'timeline']) {
      const all = await dbAll(store);
      for (const r of all) await dbDelete(store, r.id);
    }
  }
  for (const f of json.folders || []) await dbPut('folders', f);
  for (const n of json.notes || []) await dbPut('notes', n);
  for (const v of json.versions || []) await dbPut('versions', v);
  for (const r of json.reminders || []) await dbPut('reminders', r);
  for (const t of json.timeline || []) await dbPut('timeline', t);
  for (const a of json.attachments || []) {
    const blob = b64ToBlob(a.blobB64, a.blobType);
    await dbPut('attachments', { ...a, blob, blobB64: undefined });
  }
  return true;
}

export { dbAll as _dbAll, dbGet as _dbGet, dbPut as _dbPut, dbDelete as _dbDelete };
