# Catat — Catatan Pintar Offline

Aplikasi pencatat pribadi berbasis **Progressive Web App (PWA)** yang bekerja 100% offline. Tidak ada server, tidak ada akun, tidak ada bundler — murni HTML/CSS/JavaScript (ES Modules) yang disajikan lewat Service Worker, dengan seluruh data tersimpan di perangkat pengguna lewat IndexedDB.

> Deskripsi dari `manifest.webmanifest`: *"Catatan offline lengkap dengan kategori, checklist/bullet/nomor, kunci per-catatan, voice note, wiki-link, graph view, dan banyak lagi."*

## ✨ Fitur

### 📝 Menulis & Mengedit
- Rich text editor: bold, italic, underline, strikethrough, heading
- Checklist, bullet list, dan numbered list dengan penomoran ulang otomatis
- Tabel (tambah baris/kolom on the fly)
- Wiki-link antar catatan (`[[judul catatan]]`) lengkap dengan **backlink** otomatis dan penanda link yang putus
- Rumus matematika via **KaTeX** dan diagram via **Mermaid** (dimuat dari CDN hanya saat dipakai)
- 9 pilihan font per catatan (Default, Nunito, Poppins, Serif, Playfair Display, Caveat, Bebas Neue, Quicksand, Mono) plus ukuran teks, highlight, dan warna teks
- Emoji picker, label warna per catatan, pin & favorite, duplikasi catatan
- **Riwayat versi** (snapshot) dengan kemampuan restore
- Undo/redo dengan pengelompokan perubahan cepat (flood window)
- Find-in-note (cari di dalam catatan yang sedang dibuka)
- Toolbar mengambang yang bisa digeser & posisinya diingat antar sesi
- Pengingat (reminder) bertanggal per catatan dengan notifikasi

### 📎 Lampiran
- Gambar, video, audio, dan file umum
- Rekam suara langsung dari editor (voice note)
- Scan dokumen lewat kamera + crop
- Gambar bebas / kanvas coret-coret (drawing)

### 🗂️ Organisasi
- Kategori/folder bertingkat (nested) dengan warna kustom & emoji, plus opsi kunci per-kategori
- Tag bebas per catatan (terpisah dari kategori)
- Template catatan cepat (kelola & urutkan)
- Pencarian dengan filter
- 6 mode urutan: terakhir diubah, terlama diubah, terbaru dibuat, terlama dibuat, judul A–Z / Z–A
- Dua bentuk tampilan daftar: kotak (grid card) atau memanjang (list)
- Arsip catatan + Sampah dengan auto-purge setelah 30 hari

### 🕸️ Graph View
- Visualisasi jaringan wiki-link antar catatan, mode **2D** dan **3D**
- Simulasi force-directed penuh (gaya tolak-menolak, tarikan wiki-link, gravitasi ke pusat) di kedua mode
- Kamera auto-fit supaya semua node selalu terlihat di layar, plus zoom/pan manual

### 🔗 Berbagi & Ekspor per Catatan
Lewat sheet "Bagikan Catatan", satu catatan bisa diekspor sebagai:
- **Gambar (JPG)** — cocok dibagikan ke chat
- **Dokumen (PDF)** — lewat jsPDF, rapi untuk dicetak
- **Teks polos (TXT)**
- **QR & Tautan Cepat** — QR code + deep-link (`#/note/:id`) untuk membuka ulang catatan yang sama **di perangkat/browser yang sama** (bukan mekanisme berbagi lintas perangkat, karena semua data bersifat lokal)
- **Baca Nyaring** (text-to-speech) via Web Speech API

### 🔒 Keamanan & Privasi
- 100% offline — tidak ada request ke server manapun untuk data pengguna
- Enkripsi **AES-256-GCM** dengan kunci turunan **PBKDF2** (150.000 iterasi, SHA-256) saat Kunci Aplikasi diaktifkan
- Satu PIN (4 digit) dipakai bersama untuk: kunci seluruh aplikasi, kunci per-kategori, dan kunci per-catatan
- Opsi buka dengan sidik jari lewat **WebAuthn**, sebagai pintasan di atas PIN (bukan pengganti)
- Auto re-lock otomatis jika aplikasi disembunyikan (background) lebih dari 5 menit

### 🏆 Gamifikasi
- Streak harian menulis (ring progress + penghitung 🔥)
- 10 lencana pencapaian: Penulis Pemula, Kolektor, Pustakawan, 3/7/30 Hari Beruntun, Arsitek Wiki, Rapi Sekali, Pencerita, dan 10K Kata
- Statistik: total catatan, total kata, checklist tertunda, favorit, dan lainnya

### 🎨 Tampilan
- 8 tema: Light, Dark, AMOLED, Cyberpunk, Paper, Forest, Anime, Minimal
- Bahasa visual bergaya iOS (font sistem SF Pro/SF Mono, safe-area inset, dsb.)
- Animasi transisi halaman via View Transitions API (otomatis nonaktif jika `prefers-reduced-motion`)

### 📲 PWA & Offline
- Installable di Android, iOS, dan Desktop — lengkap dengan splash screen iOS & ikon maskable Android
- App shortcuts: Catatan Baru, Cari Catatan, Kelola Kategori
- Service Worker: cache-first untuk shell aplikasi, stale-while-revalidate untuk aset CDN
- Kerangka push notification & background sync sudah tersedia (menunggu backend, jika suatu saat ditambahkan)

## 🧱 Teknologi

| Bagian | Teknologi |
|---|---|
| Bahasa | Vanilla JavaScript (ES Modules) — tanpa framework, tanpa bundler/build step |
| Penyimpanan | IndexedDB (data utama) + `localStorage` (hanya mirror tema, untuk anti-FOUC) |
| Enkripsi | Web Crypto API — AES-256-GCM + PBKDF2 |
| Autentikasi biometrik | Web Authentication API (WebAuthn) |
| Offline & caching | Service Worker (Cache API) |
| Rumus matematika | [KaTeX](https://katex.org) 0.16.9 (cdnjs, lazy) |
| Diagram | [Mermaid](https://mermaid.js.org) 10.x (jsDelivr, lazy) |
| Ekspor PDF | [jsPDF](https://github.com/parallax/jsPDF) 2.5.2 (jsDelivr, lazy) |
| QR Code | [qrcode](https://github.com/soldair/node-qrcode) 1.5.3 (jsDelivr, lazy) |
| Font kustom | Google Fonts (di-preload saat boot, lalu di-cache) |

Semua dependency CDN di atas hanya diambil **saat pertama kali dipakai**, lalu dicache oleh Service Worker untuk pemakaian offline berikutnya — fitur inti (menulis, checklist, kategori, kunci, dst.) tidak butuh koneksi internet sama sekali.

## 📁 Struktur Proyek

```
catat-pwa/
├── index.html              # Shell HTML, meta PWA/iOS, preconnect font
├── manifest.webmanifest    # Manifest PWA (ikon, shortcuts, tema)
├── sw.js                   # Service Worker (cache-first + stale-while-revalidate)
├── CHANGELOG.md
├── css/
│   ├── base.css        # Reset & custom property dasar, tipografi
│   ├── themes.css      # 8 definisi tema (custom properties)
│   ├── components.css  # Komponen UI (card, sheet, tombol, dst.)
│   └── animations.css  # Keyframes & transisi
├── js/
│   ├── main.js           # Boot, router hash, lock screen, reminder daemon
│   ├── db.js             # Lapisan IndexedDB + enkripsi (semua akses data lewat sini)
│   ├── ui.js             # Helper DOM, toast, sheet/modal, ikon SVG, dst.
│   ├── views.js          # Dashboard, Browse, Search, Graph, Settings, dst.
│   ├── editor.js         # Editor catatan (rich text, wiki-link, math, tabel)
│   ├── categories.js     # Manajemen kategori/folder
│   ├── attachments.js    # Lampiran, rekam suara, scan dokumen, gambar bebas
│   ├── richlist.js       # Logika checklist/bullet/numbered list
│   ├── fontpanel.js      # Panel & preload font kustom
│   ├── vtoolbar.js       # Toolbar mengambang yang bisa digeser
│   ├── share.js          # Ekspor gambar/PDF/teks/QR + baca nyaring
│   ├── auth.js           # Gerbang PIN bersama (app/kategori/catatan)
│   └── history.js        # Mesin undo/redo generik
└── icons/                  # Ikon PWA, favicon, apple-touch-icon, splash iOS
```

## 🗄️ Model Data (IndexedDB)

Database: `catat_db` (versi skema saat ini: `1`). Semua akses lewat `db.js` — modul lain tidak pernah menyentuh IndexedDB secara langsung.

| Object Store | Index | Isi |
|---|---|---|
| `notes` | `folderId`, `updatedAt`, `favorite`, `createdAt` | Catatan: judul, konten HTML, tag, warna, status pin/favorit/arsip, dst. |
| `folders` | `parentId` | Kategori bertingkat |
| `attachments` | `noteId` | Blob lampiran (gambar/audio/video/file) |
| `versions` | `noteId` | Snapshot riwayat versi catatan |
| `reminders` | `noteId`, `datetime` | Pengingat bertanggal |
| `timeline` | `noteId`, `timestamp` | Log aktivitas per catatan |
| `settings` | — | Key-value pengaturan (tema, bentuk catatan, streak, dll.) |
| `keystore` | — | Salt & metadata kunci enkripsi (bukan PIN mentah) |

## 🚀 Menjalankan Secara Lokal

Karena memakai Service Worker & ES Modules, membuka `index.html` langsung lewat `file://` **tidak akan bekerja penuh** (Service Worker butuh secure context: `https://` atau `localhost`). Jalankan lewat server statis sederhana, misalnya:

```bash
# Python
python3 -m http.server 8000

# atau Node.js
npx serve .
```

Lalu buka `http://localhost:8000`.

Untuk deploy, unggah semua file apa adanya ke hosting statis mana pun (GitHub Pages, Netlify, Vercel, Cloudflare Pages, dst.) — tidak ada langkah build sama sekali.

> ⚠️ **Penting:** setiap kali kode di-deploy ulang, naikkan `CACHE_VERSION` di `sw.js` (mis. `catat-v2.1.1` → `catat-v2.1.2`). Tanpa ini, pengguna yang sudah pernah membuka app akan terus mendapat versi lama dari cache karena strategi cache-first — ini sudah beberapa kali jadi sumber bug, lihat [`CHANGELOG.md`](./CHANGELOG.md).

## 📲 Instalasi sebagai Aplikasi (PWA)

- **Android (Chrome):** banner "Tambahkan ke layar Utama" muncul otomatis, atau lewat menu ⋮ → *Instal aplikasi*.
- **iOS (Safari):** tombol Bagikan → *Tambah ke Layar Utama* (Safari tidak memakai `manifest.webmanifest` untuk ikon Home Screen, karena itu ikon Apple touch & splash screen didaftarkan manual di `index.html`).
- **Desktop (Chrome/Edge):** ikon instal di address bar.

## 💾 Backup & Pemulihan Data

Karena semua data hidup di IndexedDB perangkat (tidak ada sinkronisasi cloud), gunakan **Pengaturan → Ekspor Backup** untuk mengunduh seluruh data (catatan, kategori, versi, pengingat, timeline, dan lampiran ter-encode base64) sebagai satu file `.json`. Pulihkan lewat **Pengaturan → Impor Backup** — bisa memilih mode gabung (merge) dengan data yang ada atau menggantikan seluruhnya.

## ⚠️ Keterbatasan yang Diketahui

- Belum ada alur **"lupa PIN"** — jika PIN kunci aplikasi lupa, satu-satunya jalan saat ini adalah menghapus site data di browser, dan catatan yang sudah terenkripsi akan ikut tidak bisa dipulihkan. Lihat `CHANGELOG.md`.
- KaTeX, Mermaid, ekspor PDF, QR code, dan Google Font baru butuh koneksi internet saat pertama kali dipakai (sesudahnya dicache untuk offline).
- QR & Tautan Cepat hanya untuk membuka kembali catatan di perangkat/browser yang sama — bukan mekanisme berbagi lintas perangkat.
- Tidak ada sinkronisasi multi-perangkat/cloud bawaan — pemindahan data antar perangkat dilakukan manual lewat ekspor/impor `.json`.

## 📝 Changelog

Riwayat perubahan detail ada di [`CHANGELOG.md`](./CHANGELOG.md).

## 🔖 Versi

Kode saat ini melaporkan dirinya sebagai **v2.1.1** (lihat `CACHE_VERSION` di `sw.js` dan footer di halaman Pengaturan). Nama paket ini (`catat-pwa-v2_1_4-sortfix.zip`) menyiratkan sudah ada penyesuaian lanjutan pada logika pengurutan catatan sejak v2.1.1 — bila iya, jangan lupa naikkan juga `CACHE_VERSION` & label versi di atas sebelum deploy, sesuai catatan pentingnya sendiri di `CHANGELOG.md`.

## 📄 Lisensi

Belum ditentukan. Tambahkan file `LICENSE` bila proyek ini akan dibagikan atau di-open-source-kan.
