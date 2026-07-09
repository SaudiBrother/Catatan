# Catat v2.1.7 — Panel Font Tanpa Keyboard, Tombol Zoom Graf Diperbesar

`CACHE_VERSION` di `sw.js` dinaikkan ke `catat-v2.1.7` — **wajib** seperti biasa, kalau tidak pengguna lama tetap dapat `ui.js`/`editor.js`/`fontpanel.js`/`views.js` dari cache.

## ⌨️ Panel Font ("Aa"): keyboard hilang, teks yang ditandai tetap kelihatan tersorot

Sebelumnya, menandai teks lalu ketuk tombol "Aa" di toolbar melayang memanggil `restoreSelection(contentEl)` — fungsi ini isinya `contentEl.focus()`, jadi persis saat panel/sheet font muncul, keyboard bawaan HP ikut kebuka lagi (padahal sebelumnya sempat tertutup wajar begitu jari menyentuh tombol toolbar), rebutan tempat dengan sheet yang butuh ruang untuk deretan warna & galeri font.

**Perbaikan di `editor.js`:** panggilan `restoreSelection(contentEl)` sebelum `openFontPanel(...)` dihapus. `openFontPanel` sendiri sudah menerima `_savedRange` (hasil `saveSelection()` yang jalan lebih dulu di `pointerdown` toolbar, sebelum blur terjadi) langsung sebagai argumen, jadi tidak pernah butuh fokus hidup untuk tahu teks mana yang sedang diedit.

**Supaya teksnya tetap kelihatan tersorot walau keyboard hilang (`fontpanel.js`):** begitu panel dibuka, seleksi langsung dibungkus `<span>` (lewat `ensureWrapper()` yang sebelumnya baru jalan pas ada perubahan gaya pertama) dan diberi class `fp-editing-sel` — warna aksen tipis (`components.css`) yang berfungsi gantiin sorotan seleksi biru bawaan browser, yang otomatis hilang begitu elemen tidak fokus lagi. Class ini murni visual sementara:
- **Tidak boleh ikut kesimpan** — `getCleanContentHTML()` sekarang ikut men-strip class ini sebelum ditulis ke database.
- **Tidak boleh ikut kesimpan di riwayat undo/redo juga** — ditambah helper kecil `stripEditingSelClass()`, dipakai di `getState()` milik `history`. Tanpa ini, kalau pengguna sempat undo balik ke salah satu langkah "tengah" (persis saat panel font masih terbuka), span itu bisa nyangkut tersorot permanen tanpa ada panel yang lagi kebuka buat beresinnya.
- **Dibuang bersih saat panel ditutup** — lewat `onClose` di `openSheet()` (bukan cuma di tombol ✓, supaya kena juga kalau ditutup lewat tap backdrop / tombol back). Kalau ternyata pengguna buka panel tapi gak ubah apa-apa (atau semua perubahan di-reset balik ke kosong), `<span>`-nya langsung dibongkar total — bukan cuma dikosongin class-nya — biar gak ninggalin `<span style="">` kosong nempel di catatan.

**Efek samping yang ikut dibereskan sekalian:** tombol Bold/Italic/Underline/Strikethrough di panel ini sebelumnya pakai `document.execCommand(cmd)`, yang JUGA butuh `contentEl.focus()` + seleksi browser yang hidup buat jalan — jadi kalau cuma dihapus `restoreSelection`-nya, keempat tombol ini bakal berhenti berfungsi. Diganti total ke pola yang sama seperti size/warna/font (langsung set `style.fontWeight`/`fontStyle`/`textDecoration` ke `ensureWrapper()`, gak nyentuh `execCommand` atau seleksi browser sama sekali) — persis mekanisme yang sudah dipakai `openFontPanelForElement` (panel font utk judul) sebelumnya, cuma sekarang disamakan ke versi seleksi-body juga. Bonus: keempat tombol ini sekarang mendeteksi status aktualnya saat panel dibuka (kalau teks yang ditandai sudah tebal/miring, tombolnya langsung kelihatan aktif — sebelumnya gak pernah dicek sama sekali), dan dapat CSS `.fp-bius-btn.active` yang baru (sebelumnya cuma ada gaya `:active` sesaat waktu ditekan, gak ada tampilan "sedang menyala" yang menetap).

Satu potensi konflik ikut ketangkap & dibetulkan waktu penyatuan ini: handler pemilih Jenis Font sebelumnya selalu nimpa `fontWeight`/`fontStyle` tanpa syarat sesuai preset font-nya — dulu aman karena Bold/Italic jalan lewat mekanisme `execCommand` yang terpisah, tapi begitu keduanya disatukan ke `<span>` yang sama, pilih font tanpa preset weight/style bisa diam-diam membatalkan toggle Bold/Italic yang barusan dipilih. Dijaga dengan aturan yang sama seperti di `openFontPanelForElement`: preset font cuma dipakai kalau pengguna belum menyalakan toggle-nya sendiri.

## 🔍 Tombol Zoom Graf — diperbesar & dipindah ke atas

`.graph-controls` sebelumnya `bottom: 12px` tanpa `z-index` sama sekali — persis di area yang ditumpuki `.tabbar` (fixed, `z-index: 40`), jadi tombol paling bawah di tumpukan (Center) sebagian ketutup/ketumpuk tabbar, susah kena tap tepat.

- `bottom` diubah ke `calc(90px + var(--safe-b))` + `z-index: var(--z-tabbar)` — pola yang sama persis dengan `.fab` (tombol tambah catatan) yang sudah lama terbukti aman dari tabbar.
- Ukuran tombol naik dari 38px → 48px, ikon dari 16px → 22px (glyph "−" di tombol Zoom Out ikut disesuaikan ke 24px), jarak antar tombol 8px → 10px, plus bayangan tipis biar tombolnya lebih kebaca terpisah dari graf di belakangnya.

---

# Catat v2.1.6 — Mode Layar Penuh (Immersive)

Permintaan: status bar (jam/baterai/sinyal) dan navigation/gesture bar Android tidak lagi tampil saat memakai app — kompatibel iOS & Android. `CACHE_VERSION` di `sw.js` dinaikkan ke `catat-v2.1.6` — **wajib**, kalau tidak pengguna yang sudah pernah membuka app ini akan terus mendapat `index.html`/`manifest.webmanifest`/`ui.js`/`main.js` lama dari cache, walau file sumbernya sudah diperbaiki.

## 📱 Status bar & navigation bar disembunyikan

Sebelumnya `manifest.webmanifest` cuma minta `display: "standalone"` — ini menyembunyikan address bar browser saat di-install, tapi status bar & navigation bar bawaan OS tetap tampil di atas/bawahnya, persis seperti di dua screenshot yang kamu kirim.

**Android — sekarang beneran full-screen:**
- `display` di manifest diubah ke `"fullscreen"`, dengan `display_override: ["fullscreen", "standalone", "minimal-ui"]` sebagai rantai fallback kalau ada browser yang belum dukung nilai `fullscreen`.
- Fungsi baru `initImmersiveMode()` (`ui.js`), dipanggil dari `boot()` (`main.js`): minta Fullscreen API (`requestFullscreen()`, dengan fallback `webkitRequestFullscreen` untuk WebView/Chromium lama) begitu app dibuka. Kalau percobaan pertama ditolak browser karena belum ada gesture pengguna (perilaku standar semua browser demi mencegah situs maksa fullscreen diam-diam — bukan sesuatu yang bisa/boleh dilewati dari kode), dicoba ulang otomatis di ketukan pertama di mana pun dalam app. Sekali granted, status bar & nav/gesture bar Android hilang total, cuma muncul sesaat kalau layar di-swipe dari tepi. Jalan baik baik app di-install ke Home Screen maupun cuma dibuka langsung di tab Chrome — tidak wajib install dulu.
- `isStandaloneDisplay()` ikut disesuaikan supaya juga mengenali `display-mode: fullscreen` sebagai "sudah ter-install" (sebelumnya cuma cek `standalone`) — kalau tidak disesuaikan, banner "Install App" akan salah terus nongol padahal app sudah jalan fullscreen.
- CSS `.topbar` di `index.html` dapat aturan baru khusus `(display-mode: fullscreen)`: tidak lagi memaksa padding-top minimum 20px seperti di mode standalone (yang sengaja menyisakan ruang untuk status bar) — di fullscreen sungguhan tidak ada status bar yang perlu disisakan ruangnya, jadi cukup ikuti `env(safe-area-inset-top)` apa adanya (0px di hampir semua perangkat, atau setinggi notch/punch-hole kamera kalau ada).

**iOS — ini batasan platform, bukan bug:** Safari/WebKit tidak punya API web sama sekali untuk menyembunyikan status bar iPhone atau home-indicator di bawah layar (`requestFullscreen()` di iOS cuma didukung di iPad, tidak pernah di iPhone) — berlaku untuk *semua* web app di iOS, bukan cuma Catat, dan tidak ada workaround dari sisi kode apa pun untuk ini. Yang sudah ada di `index.html` (`apple-mobile-web-app-status-bar-style: black-translucent` + `viewport-fit=cover` + padding `safe-area-inset-top`) itu sendiri sudah pendekatan terbaik yang diizinkan iOS: status bar jadi transparan dan konten app mengalir penuh sampai ke belakangnya, jadi ikon jam/baterai/sinyal tetap kelihatan tapi melebur di atas warna topbar alih-alih jadi bar solid terpisah. Tidak ada perubahan di sisi iOS karena bagian ini memang sudah dikonfigurasi optimal untuk platform tersebut sebelum perbaikan ini.

## 📌 Yang Perlu Kamu Lakukan
Untuk pengguna yang **sudah pernah install** PWA-nya di Android: mode fullscreen di manifest kadang baru ter-terapkan otomatis setelah Chrome mendeteksi manifest-nya berubah (biasanya dalam beberapa hari / beberapa kali buka), atau bisa dipercepat dengan uninstall lalu Add to Home Screen ulang — ini batasan cara Android men-generate WebAPK, bukan sesuatu yang bisa dipaksa dari sisi web app. Bagian `requestFullscreen()` di JS tidak kena batasan ini — itu langsung aktif di kunjungan berikutnya begitu file baru ke-cache, install ulang atau tidak.

---

# Catat v2.1.1 — Perbaikan Lanjutan

Tiga masalah yang dilaporkan setelah rilis v2.1, plus satu isu keamanan yang ditemukan sambil menelusuri salah satunya. `CACHE_VERSION` di `sw.js` dinaikkan ke `catat-v2.1.1` — **wajib**, kalau tidak pengguna yang sudah pernah membuka app ini akan terus mendapat JS lama (dengan bug-bug di bawah ini) dari cache, walau file sumbernya sudah diperbaiki.

## 🔤 Font tidak termuat untuk catatan yang sudah diberi font kustom
`fontpanel.js` memuat 6 Google Font secara *lazy* — baru diambil saat kartu fontnya diklik di panel Font. Ini sebenarnya perubahan yang **disengaja** di optimisasi v2.1 (lihat poin #7 di bawah) demi mengurangi request jaringan saat boot. Masalahnya: kalau sebuah catatan sudah memakai font kustom (mis. "Poppins") dan app dibuka ulang tanpa sempat membuka panel Font sesi itu, `@font-face`-nya tidak pernah diminta browser, jadi tampilannya diam-diam jatuh balik ke font default — persis seperti "font tidak termuat sama sekali". Sekarang `preloadAllFonts()` dipanggil di awal `boot()` (`main.js`), memuat ke-6 font begitu app dibuka — bukan lagi menunggu panel Font diklik — sekaligus langsung memicu cache Service Worker (`stale-while-revalidate`) untuk pemakaian offline berikutnya. `<link>` tag diambil browser secara asinkron, jadi ini tidak menunda tampilan pertama.

## 🕸️ Graf Catatan: node terpencar ke luar layar & 3D terasa datar
Tiga bug berbeda di `views.js` yang bersama-sama menyebabkan graf tampak kosong total meski sudah ada catatan:
- **Ledakan gaya tolak-menolak** — rumus repulsion 2D & 3D punya "epsilon" (pemberi jarak minimum) yang terlalu kecil (`+1`). Kalau dua catatan kebetulan muncul berdekatan (lumrah terjadi karena posisi awal dulu murni `Math.random()`), gaya tolaknya bisa melonjak jadi ratusan piksel per frame dalam satu tick — inilah "terpencar sangat cepat ke segala arah". Diperbaiki dengan epsilon yang jauh lebih besar + batas kecepatan maksimum per tick, dan posisi awal sekarang memakai pola spiral/bola (bukan acak murni) sehingga dua node tidak pernah muncul di titik yang (nyaris) sama.
- **Tidak ada jaminan semua node masuk ke layar** — sebelumnya zoom/pan graf 2D selalu mulai dari nilai tetap (`zoom=1, pan=0`), dan graf 3D bahkan tidak punya kontrol zoom sama sekali (tombol +/- di pojok kiri bawah tidak tersambung ke apa pun untuk mode 3D!). Kalau posisi node hasil simulasi lebih lebar dari layar, tidak ada mekanisme apa pun yang menariknya kembali ke pandangan. Sekarang kedua mode punya "auto-fit": kamera otomatis & terus-menerus menyesuaikan supaya semua node selalu masuk layar (dengan sedikit padding), sampai kamu menggeser/zoom manual. Tombol +/- dan "center" 3D sekarang benar-benar berfungsi.
- **Mode 3D tidak benar-benar terasa 3D** — tidak ada simulasi sama sekali di mode 3D lama (variabel `vx/vy/vz` dideklarasikan tapi tak pernah dipakai); node cuma titik acak statis yang kameranya berputar. Sekarang mode 3D punya simulasi gaya penuh di ruang x/y/z (sama seperti 2D: tolak-menolak, tarikan wiki-link, gravitasi ke pusat), ditambah kabut kedalaman (node/garis makin pudar makin jauh dari kamera), grid lantai melingkar yang ikut berputar bersama scene, dan sudut kamera awal yang lebih miring — semuanya untuk memberi isyarat kedalaman yang meyakinkan, bukan sekadar titik-titik yang berputar datar.
- Sekalian dirapikan: label teks di kedua graf memakai `fillStyle = 'var(--text)'`, padahal Canvas 2D tidak bisa menerjemahkan custom property CSS seperti itu (nilainya diam-diam diabaikan) — sekarang warnanya diambil lewat `getComputedStyle` seperti variabel `--accent` di baris atasnya. Graf kosong (0 catatan) sekarang menampilkan pesan "Belum ada catatan" alih-alih kanvas hitam kosong, supaya jelas beda antara "kosong" dan "rusak".

## 🔒 PIN bisa dibuat dengan format yang tidak bisa dipakai untuk membuka app lagi
Ditemukan saat menelusuri laporan soal font: layar kunci aplikasi (`renderLockScreen` di `main.js`) **hanya** punya keypad angka 0–9 dan otomatis submit tepat di 4 digit — tidak ada cara mengetik huruf atau digit ke-5 di situ sama sekali. Tapi alur *pembuatan* PIN di Pengaturan (`views.js`, lewat `promptDialog` bebas) dan alur kunci catatan/kategori per-item (`auth.js`) sama sekali tidak membatasi format — bisa diisi huruf, simbol, atau lebih dari 4 karakter, dan hanya mensyaratkan *minimal* 4 digit. Kalau PIN yang tersimpan bukan 4 digit angka persis, layar kunci aplikasi **tidak akan pernah bisa cocok** dengannya — karena keypad-nya cuma bisa merakit string angka 4 digit — sehingga menonaktifkan layar kunci pun tidak mungkin tanpa menghapus data. Sekarang ketiganya (buat PIN, nonaktifkan kunci, verifikasi untuk sidik jari, plus alur kunci catatan/kategori) memakai dialog PIN baru (`promptPin` di `ui.js`) yang memfilter input jadi angka saja & maksimal 4 digit secara real-time (bukan cuma lewat atribut `pattern`/`maxlength` yang tidak ditegakkan browser tanpa `<form>` asli), dan menolak submit kalau belum tepat 4 digit.

> **Kalau kamu sendiri sudah sempat membuat PIN dengan huruf/lebih dari 4 digit sebelum perbaikan ini** (kedengarannya begitu, dari laporanmu) — PIN lama itu sudah tersimpan di IndexedDB perangkatmu dan perbaikan kode ini tidak otomatis mengubahnya. Kalau app sudah terlanjur terkunci dan tidak bisa dibuka, satu-satunya jalan saat ini adalah menghapus data situs (site data/storage) untuk app ini di browser kamu, yang berarti catatan yang sudah dienkripsi ikut tidak bisa dipulihkan. App ini belum punya alur "lupa PIN" — di luar cakupan perbaikan kali ini, tapi kabari kalau kamu mau itu ditambahkan.

---

# Catat v2.1 — Changelog Optimisasi

Audit menyeluruh terhadap seluruh 13 file JS, 4 file CSS, `index.html`, `manifest.webmanifest`, dan `sw.js`. Semua perbaikan di bawah sudah diverifikasi (cek sintaks otomatis + beberapa diuji langsung dengan skrip Node) dan tidak mengubah fitur/alur yang sudah berjalan benar.

## 🎨 Ganti Ikon
- `icons/icon.svg` diganti dengan desain glassmorphism baru yang kamu kirim.
- Semua ukuran PNG di-generate ulang dari SVG itu: `favicon-16/32`, `icon-120/152`, `apple-touch-icon` (180), `icon-192/512`, plus **maskable 192/512** dan **3 splash screen iOS** dengan ikon + wordmark baru.
- Versi *maskable* dibuat terpisah (bukan sekadar resize): latar diperluas penuh tanpa sudut membulat, dan konten (kartu catatan + badge AI) diperkecil & dipusatkan supaya tidak terpotong saat Android menerapkan mask bentuk apa pun (lingkaran, squircle, dll).
- `apple-touch-icon.png`, `icon-120.png`, `icon-152.png` di-flatten jadi RGB solid (sebelumnya `icon-120`/`icon-152` transparan, tidak konsisten dengan `apple-touch-icon.png` — transparansi di ikon Home Screen iOS bisa muncul jadi kotak hitam).
- File `icon-16.png` & `icon-32.png` lama dihapus — tidak pernah direferensikan di mana pun (duplikat `favicon-16/32.png` di bawah nama berbeda).

## 🐛 Bug yang Diperbaiki

1. **Undo/redo error setiap dipakai** (`history.js`) — ada assignment ke variabel `lastWasFlood` yang tak pernah dideklarasikan. Karena modul JS berjalan di strict mode, ini melempar `ReferenceError` di *setiap* pemanggilan undo/redo, membuat indikator tombol undo/redo & haptic feedback berhenti sinkron. Sudah dites ulang dengan skrip — sekarang bersih tanpa error.
2. **Graph View bocor selamanya** (`views.js`) — animasi force-graph (2D & 3D) mencoba membersihkan diri lewat `canvas.addEventListener('remove', ...)`, padahal `'remove'` bukan event asli di DOM (tidak pernah terpicu). Akibatnya, setiap kali membuka tab Graf, sebuah `requestAnimationFrame` loop terus berjalan selamanya di background — bahkan setelah pindah tab — dan **menumpuk lagi** setiap kunjungan berikutnya, menguras baterai & CPU. Sekarang `renderGraph` mengembalikan fungsi cleanup asli yang dipanggil router saat berpindah halaman.
3. **Listener menumpuk di Dashboard/Browse/Search/Arsip/Trash** (`ui.js`) — `wireSwipeRows` memasang listener `pointerdown` baru ke `document` di *setiap* render, tak pernah dilepas. Karena hampir semua navigasi utama memanggil ulang fungsi ini, listener menumpuk tanpa batas sepanjang sesi. Sekarang hanya dipasang sekali seumur aplikasi.
4. **Mikrofon bisa tetap aktif di background** (`attachments.js`) — jika sheet perekam suara ditutup dengan mengetuk di luar (bukan menekan tombol "Berhenti"), stream mikrofon & interval timer tidak pernah dihentikan. Sekarang perekaman otomatis dihentikan dengan cara apa pun sheet ditutup.
5. **Kebocoran blob URL di penampil lampiran** (`attachments.js`) — masalah serupa #2 (event `'remove'` palsu); URL objek gambar/video/audio tak pernah di-*revoke*. Diperbaiki lewat mekanisme `onClose` baru di `openSheet`.
6. **Kebocoran blob URL di alur Scan Dokumen** — jika sheet crop ditutup tanpa menekan "Ulangi"/"Simpan", blob file hasil foto tak pernah dilepas. Diperbaiki dengan mekanisme yang sama.
7. **6 Google Font dimuat di setiap kali app dibuka** (`fontpanel.js`) — ada baris yang eager-load 6 font CDN saat modul pertama kali dimuat (yaitu setiap boot aplikasi), padahal `index.html` sendiri mendokumentasikan bahwa font-font ini harusnya lazy-load saat panel font dibuka. Ini bertentangan dengan janji "offline-first" app & menambah request jaringan yang tidak perlu di setiap sesi. Baris eager-load dihapus; pemilihan font tetap bekerja seperti biasa (lazy per font saat dipilih).
8. **Entri linimasa (timeline) menumpuk selamanya** (`db.js`) — `permanentlyDeleteNote` sudah membersihkan lampiran/versi/reminder milik catatan yang dihapus permanen, tapi lupa membersihkan entri `timeline`-nya. Sekarang ikut dibersihkan, konsisten dengan store lain.
9. Rapikan kecil: dua listener `visibilitychange` terpisah di `main.js` digabung jadi satu; `ensureAuthenticated` di `auth.js` disederhanakan dari `new Promise(async ...)` (anti-pattern) jadi `async function` biasa; teks footer Pengaturan yang masih bilang "v1.0" disamakan jadi "v2.1".

## ⚙️ Service Worker & Cache
- `CACHE_VERSION` dinaikkan ke `catat-v2.1.0` — **ini penting**: tanpa menaikkan versi ini, pengguna yang sudah pernah install PWA-nya akan terus melihat cache lama (ikon lama + bug lama) karena strategi cache-first. Dengan versi baru, service worker otomatis membersihkan cache lama & mengambil semua aset baru saat pertama kali dibuka lagi.
- `SHELL_ASSETS` dilengkapi: sebelumnya `icon-120.png`, `icon-152.png`, dan ketiga splash screen belum ikut di-precache, jadi belum 100% tersedia offline sejak instalasi pertama. Sekarang semua ikut.

## ✅ Yang Sudah Dicek Tapi Tidak Diubah
- Seluruh CSS (4 file, 1118 baris) — brace seimbang, semua CSS custom property terpakai sudah terdefinisi di ke-8 tema tanpa ada yang "bolong".
- Seluruh JS lolos `node --check` (tidak ada syntax error) sebelum & sesudah perubahan.
- Tidak ditemukan `console.log`/`debugger` tersisa maupun komentar TODO/FIXME yang terlupakan.
- Tidak ada dependency/build tool (proyek ini murni HTML/CSS/JS tanpa bundler), jadi minifikasi sengaja tidak dilakukan — akan menyulitkan maintenance ke depan tanpa manfaat nyata untuk app sekecil ini yang sudah disajikan lewat Service Worker cache-first.

## 📌 Yang Perlu Kamu Lakukan
Karena `manifest.webmanifest` dan nama-nama file ikon **tidak berubah** (hanya isinya), kamu tinggal deploy ulang seperti biasa. Untuk pengguna yang sudah install PWA-nya, ikon Home Screen biasanya baru ter-update setelah mereka uninstall+install ulang (ini batasan OS, bukan sesuatu yang bisa diperbaiki dari sisi web app) — tapi semua perbaikan bug & konten baru lainnya akan otomatis masuk lewat update service worker begitu mereka membuka app dengan koneksi internet sekali saja.
