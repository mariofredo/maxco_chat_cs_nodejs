# Catatan Perubahan: Status Online dan Typing Indicator

Tanggal: 2026-11-10. Cakupan: semua yang ditambah atau diubah di project `maxco_chat_cs_nodejs` pada pekerjaan ini. Folder ini bukan repo git, jadi daftar di bawah adalah satu-satunya riwayat perubahan; sebaiknya `git init` dan commit awal sebelum pekerjaan berikutnya.

## 1. Ringkasan

Dua fitur baru di backend, tanpa perubahan skema database dan tanpa mengubah event atau endpoint yang sudah ada:

1. **Status online (presence).** User di app mobile melihat apakah tim Customer Support dan Sales online. CS dan Sales di CRM melihat apakah user sedang berada di layar Live Chat.
2. **Typing indicator.** Relay "sedang mengetik" antara user dan CS di dalam room chat.

Disertai: tes otomatis (46 tes), halaman uji `test.html` yang ditulis ulang, dua dokumen desain dan rencana, dan panduan menjalankan serta menguji.

## 2. Fitur baru dan kontraknya

### 2.1 Status online

Presence dicatat di memori satu proses (tanpa tabel baru). Dua tim: `customer_support` dan `sales`. Untuk saat ini setiap CS dianggap juga berperan sebagai sales, jadi CRM mendaftarkan kedua tim sekaligus.

Event socket, client ke server:

| Event | Dikirim oleh | Payload | Efek |
|---|---|---|---|
| `presence_register` | CRM, saat masuk menu live chat dan setiap reconnect | `{ adminId: string, teams: ("customer_support"\|"sales")[] }` | Mendaftarkan socket sebagai admin; masuk room `presence_admins`. Panggilan ulang menimpa daftar tim. |
| `presence_leave` | CRM, saat keluar menu | `{}` | Melepas socket itu seketika. |
| `presence_subscribe` | App mobile, saat layar Live Chat dibuka | `{ teams?: Team[] }` (default kedua tim) | Masuk room `presence_<team>`. Server langsung membalas `presence_changed` berisi status terkini tiap tim ke socket itu saja. |
| `presence_unsubscribe` | App mobile | `{ teams?: Team[] }` | Keluar dari room tim. |
| `presence_user_register` | App mobile, saat masuk alur Live Chat | `{ userId: string }` | Menandai user online. |
| `presence_user_leave` | App mobile, saat keluar dari alur Live Chat | `{}` | Melepas socket itu seketika. |

Event socket, server ke client:

- `presence_changed { team, online }` ke room `presence_<team>`, hanya saat status tim berubah.
- `presence_user_changed { userId, online }` ke room `presence_admins` (hanya socket CRM yang terdaftar), hanya saat status user berubah.

REST (keduanya di belakang middleware API key yang sudah ada):

- `GET /api/client/presence` membalas `{ success: true, data: { customer_support: boolean, sales: boolean } }`.
- `GET /api/chats/crm/presence?userIds=a,b,c` membalas `{ success: true, data: { "<userId>": boolean } }`. Mendukung string dengan koma maupun kunci berulang, mengabaikan spasi dan duplikat. `400` jika kosong atau lebih dari 100 id.

Aturan: satu admin atau user boleh punya banyak socket dan tetap online selama masih ada satu. `presence_leave` dan `presence_user_leave` melepas socket seketika. Koneksi yang putus dilepas setelah masa tunggu (grace) supaya reconnect singkat tidak membuat status berkedip. Payload yang salah bentuk diabaikan tanpa error. Id harus berupa string.

### 2.2 Typing indicator

Event `typing { chatId, isTyping, senderId, senderType: "user"|"admin", senderName? }` dari client diteruskan sebagai event `typing` dengan payload yang sama (`chatId` jadi string, `senderName` jadi `null` bila kosong) ke anggota lain room `chat_<chatId>`, tidak ke pengirim. Diabaikan jika payload tidak valid atau socket pengirim belum `join_chat` ke room itu. Server tidak menyimpan status dan tidak punya timer: client mengirim ulang `isTyping: true` sekitar tiap 3 detik dan menyembunyikan indikator setelah 5 detik tanpa pembaruan.

## 3. Perubahan per berkas

### Dibuat baru

| Berkas | Isi |
|---|---|
| `src/services/presenceService.ts` | `PresenceRegistry` (admin per tim, user, masa tunggu, emit hanya saat status berubah), `TEAMS`, `teamRoom`, `ADMINS_ROOM`, `getGraceMs`. Tanpa import Socket.IO, jadi bisa diuji sendiri. |
| `src/services/presenceRuntime.ts` | `getPresence()`: registry bersama yang disambungkan ke timer asli dan Socket.IO. |
| `src/utils/presenceInput.ts` | `parseTeams`, `parseUserIds`, `MAX_USER_IDS` (100). |
| `src/sockets/presenceSocket.ts` | Handler event presence untuk satu socket, termasuk hook `disconnect`. |
| `src/sockets/typingSocket.ts` | Relay typing. |
| `test/presence/*.ts`, `test/typing/socket.test.ts` | 8 berkas tes (harness dengan jam palsu, registry, user, parser, runtime, handler socket, REST, typing). |

### Diubah

| Berkas | Perubahan |
|---|---|
| `src/app.ts` | Dua import dan dua panggilan di handler `connection`: `registerPresenceSocket(socket)` dan `registerTypingSocket(socket)`. `chatSocket.ts` tidak disentuh. |
| `src/controllers/clientChatController.ts` | Menambah `getClientPresence`. |
| `src/controllers/crmChatController.ts` | Menambah `getCrmUsersPresence`. |
| `src/routes/clientRoutes.ts` | Menambah `GET /presence`. |
| `src/routes/chatRoutes.ts` | Menambah `GET /crm/presence`. |
| `package.json` | `scripts.test` sekarang `node --import tsx --test "test/**/*.test.ts"` (sebelumnya placeholder). Tanpa dependensi baru. |
| `.env.example`, `deploy/.env.example` | Menambah `PRESENCE_GRACE_SECONDS=10`. |
| `deploy/DEPLOYMENT.md` | Baris env `PRESENCE_GRACE_SECONDS`; endpoint dan event baru di daftar endpoint dan event Socket.IO. |
| `.gitignore` | Menambah `*firebase-adminsdk*.json` (kredensial service account Firebase di root project) dan `.superpowers/`. |

### Halaman uji `test.html` (ditulis ulang)

- Tata letak dua sisi: **App (user)** dan **CRM (CS)** berdampingan dengan koneksi masing-masing, plus satu log kejadian dengan filter.
- Kotak **Langkah berikutnya** yang berubah mengikuti keadaan (connect, buat chat, masuk room, siap) dan punya tombol untuk langkah itu; menjadi merah saat koneksi gagal.
- Tombol redup dengan alasan saat syaratnya belum terpenuhi; tidak ada lagi Chat ID default `1`.
- Header percakapan dengan nama, status Online/Offline, dan "sedang mengetik…", plus gelembung titik-titik bergerak. Typing dikirim otomatis saat mengetik.
- Semua panggilan REST chat (buat chat, daftar CRM, riwayat, tandai dibaca, inside sales, promotion, file) dan aksi socket (tugaskan admin, tutup chat) punya tombol.
- Peringatan jika pesan tidak kembali dari server dalam 3 detik. Log memakai teks biasa (bukan `innerHTML`), skrip CDN dikunci dengan SRI, nilai isian tersimpan di browser.
- Sebelum ditulis ulang, ada perbaikan: event `connection` diganti `connect`, `send_message` mengirim `content_type` dan `sender_name`, dan pilihan `bot` dihapus.

### Dokumen baru

- `docs/superpowers/specs/2026-11-10-presence-status-design.md`: desain (salinan dokumen Claude Docs).
- `docs/superpowers/plans/2026-11-10-presence-status.md`: rencana implementasi 8 task.
- `docs/panduan-menjalankan-dan-menguji.md`: panduan dari database kosong sampai uji semua fitur.
- `docs/integration-guide-app.md` dan `docs/integration-guide-crm.md`: panduan integrasi untuk tim app mobile dan tim CRM (bahasa Inggris, contoh Dart yang belum dikompilasi).
- `docs/perubahan-presence-typing.md`: dokumen ini.

## 4. Database

- **Tidak ada berkas skema atau migrasi di repo yang diubah.**
- Di database lokal `maxco_chat_im`, migrasi dijalankan manual. File `07_dbchanges_202610191417.sql` gagal di MySQL 8.0 (`ERROR 1215`), karena kolom generated `sales_chat_key` bentrok dengan foreign key `FK_list_chats_list_chat_category` yang memakai `ON UPDATE CASCADE`. Sebagai gantinya foreign key itu dihapus, kolom dan unique key ditambah, lalu foreign key dibuat ulang tanpa `ON UPDATE CASCADE` (SQL-nya ada di panduan, bagian 2). Hasil akhir: 7 tabel dan kolom `sales_chat_key` ada. **Masalah yang sama masih ada di berkas `02_migrations.sql` dan `07_...` di repo**, jadi database baru di MySQL 8.0 akan gagal di `07` tanpa penggantinya.

## 5. Konfigurasi baru

`PRESENCE_GRACE_SECONDS`, opsional, default `10`. Detik menunggu sebelum socket yang terputus dianggap offline; `0` berarti tanpa menunggu. Nilai kosong atau tidak valid kembali ke 10.

## 6. Bukti pengujian

- `npm test`: 46 tes, 46 lulus. `npx tsc --noEmit`: tanpa error.
- Uji end-to-end ke server asli dengan klien Socket.IO (grace 2 detik): 20 dari 20 lulus tanpa API key, 22 dari 22 dengan `CHAT_API_KEY=secret`.
- `test.html` diuji di browser (Playwright): bar petunjuk, status online, typing, filter log, dan peringatan pesan tidak terkirim. Server uji tidak terhubung ke database, jadi alur yang butuh database (buat chat, pesan masuk, riwayat) belum pernah dijalankan oleh saya.
- Review akhir oleh reviewer terpisah: tidak ada temuan Critical, dua temuan Important sudah diperbaiki.

## 7. Selisih dengan spec dan temuan terbuka

- **Status awal saat subscribe.** Setelah review, `presence_subscribe` juga membalas `presence_changed` status terkini ke socket itu. Ini menghilangkan kewajiban urutan "subscribe dulu, baru `GET`" di sisi client. Hanya dicatat di `DEPLOYMENT.md`, belum di spec bagian 4.
- **Ditunda (minor):**
  - Bungkus callback emit di `presenceRuntime.ts` dengan try/catch (throw di dalam timer akan menjatuhkan proses).
  - Batasi panjang dan trim `senderName` dan `senderId` di relay typing (batas buffer socket 50 MB).
  - Buat tiap tes di `rest.test.ts` mandiri (sekarang bergantung pada state tes sebelumnya).
  - Registry O(n) per perubahan; pakai hitungan referensi bila jumlah user membesar.
  - Spec bagian 6: status user terbaca oleh siapa pun yang memegang API key lewat `GET /api/chats/crm/presence`, bukan hanya admin.
- **Keterbatasan yang diterima di v1:** registry di memori satu proses (butuh Redis bila lebih dari satu instance); `adminId` dan `userId` tidak diverifikasi; semua admin yang sedang di menu menerima status semua user; typing tanpa pembatasan laju.
- **Temuan di kode lama, tidak diubah:** `send_message` ke chat yang tidak ada hanya mencatat error di log server dan client tidak diberi tahu; `chat_room_created` dikirim ke semua socket; `fileName` upload tidak disanitasi; query daftar CRM menghitung `ROW_NUMBER()` atas seluruh `list_messages`; `express.json` terpasang dua kali di `app.ts`.
- **Berkas rahasia di root project:** `maxco-807ff-firebase-adminsdk-...json` sudah masuk `.gitignore`. Jika file itu pernah dibagikan atau di-commit, buat ulang kuncinya di Firebase console.

## 8. Yang masih harus dikerjakan di luar repo ini

- **CRM:** kirim `presence_register` (kedua tim) saat masuk menu live chat dan setiap reconnect, `presence_leave` saat keluar; dengarkan `presence_user_changed`; ambil kondisi awal lewat `GET /api/chats/crm/presence`; kirim dan tampilkan typing.
- **App mobile:** `presence_subscribe` saat layar Live Chat dibuka, `presence_user_register` sekali saat masuk alur Live Chat dan `presence_user_leave` hanya saat keluar dari seluruh alur (bukan saat pindah tab atau membuka percakapan); tampilkan status di agent bar dan header sesuai desain; kirim ulang register saat reconnect; kirim dan tampilkan typing dengan debounce.
- Status Sales per sales member (per referrer) ditunda; butuh id referrer di kontrak dan pemetaan antara id admin di CRM dengan `user_referrer_id`.

## 9. Sisa artefak di mesin ini

- Dua server uji masih berjalan di port 3100 (API) dan 8088 (halaman uji); matikan dari Task Manager.
- Folder `.superpowers/` (mockup brainstorming) ada di root project dan sudah masuk `.gitignore`.
