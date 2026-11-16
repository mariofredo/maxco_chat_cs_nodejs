# Status Online Customer Service: Desain

Repo `maxco_chat_cs_nodejs` (backend chat: Node 24, TypeScript, Express 5, Socket.IO 4, mysql2) · Nov 10, 2026

## 1. Latar belakang dan tujuan

Tugas: menambah status online antara user (member di app mobile) dan customer service (CS).

Prototype desain app mobile (maxco-app-ui, slide 24 dari 43, area Live chat, layar Customer Support) sudah menampilkan:

- subtitle header “Customer Support & Sales available”;
- dua tab: **Customer Support** dan **Sales**;
- agent bar bernama “Maxco Customer Support” dengan label hijau **Online**.

Backend saat ini tidak punya konsep presence. Socket hanya masuk room (`join_user`, `join_chat`) dan tidak mencatat siapa yang terhubung.

**Tujuan:** begitu minimal satu CS membuka menu live chat di CRM, user melihat “Online” di app mobile. Begitu tidak ada CS yang berada di menu itu, status kembali offline.

**Tujuan kedua:** begitu user membuka layar Live Chat di app mobile, CS dan Sales melihat user itu online di CRM. Begitu user menutup layar atau koneksi putus, statusnya kembali offline.

Catatan tafsiran: permintaan awal terpotong (“ketika customer service memasuki menu ...”). Tafsiran yang dipakai: “menu” = menu live chat di CRM, dan efeknya terlihat di app mobile (lihat bagian 8 dan pertanyaan terbuka 5).

## 2. Goals, non-goals, anti-goals

**Goals**

- User melihat status online tim CS dan tim Sales secara realtime di app mobile, termasuk saat layar Live Chat baru dibuka (sebelum masuk room chat mana pun).
- Status benar ketika CS keluar menu, menutup tab, koneksi putus, atau server restart.
- Hanya mengirim event saat status tim berubah, bukan tiap koneksi.
- CS dan Sales melihat status online user di CRM secara realtime, dan bisa mengambil kondisi awal untuk banyak user sekaligus.

**Non-goals (versi pertama)**

- “Terakhir dilihat” (butuh kolom DB), “Average response under 2 minutes” (typing indicator sekarang masuk tugas ini, lihat bagian 10).
- Tampilan status di CRM (daftar chat, header room, atau keduanya): ditentukan tim CRM; backend hanya menyediakan data.
- Status Sales per sales member (per referrer): ditunda, lihat pertanyaan terbuka 1.
- Menyimpan status ke DB, mendukung lebih dari satu instance server (Redis), memverifikasi identitas admin.
- Menampilkan status per orang ke user: yang tampil adalah status tim.

**Anti-goals** (gagal walau secara teknis jalan)

- Status berkedip online/offline saat koneksi CS putus-sambung singkat.
- Status “Online” tersangkut padahal tidak ada CS di menu.
- Mengubah event atau endpoint yang sudah dipakai CRM dan app mobile.

## 3. Definisi “online”

Tim T online jika minimal satu admin terdaftar ke tim T dan masih punya minimal satu socket hidup (atau baru putus dan masih dalam masa tunggu).

- Tim: `customer_support` (chat kategori 1) dan `sales` (chat kategori 3, inside sales). Keduanya cocok dengan dua tab di desain.
- **Untuk saat ini setiap CS dianggap juga berperan sebagai sales** (keputusan user). Jadi CRM mengirim `teams: [customer_support, sales]` ketika CS masuk menu live chat, dan kedua tim online serta offline bersamaan. Status Sales = ada CS atau sales yang sedang di menu.
- Admin “terdaftar” setelah CRM mengirim `presence_register` saat masuk menu live chat, dan tidak terdaftar lagi setelah `presence_leave` (keluar menu) atau socket putus.
- Satu admin boleh punya banyak socket (banyak tab atau device). Admin tetap online selama masih ada satu socket.
- Keluar menu (`presence_leave`): socket itu langsung dilepas dari registry tanpa masa tunggu. Admin dianggap pergi hanya jika tidak ada socket lain yang masih terdaftar. Koneksi putus: socket itu dilepas setelah masa tunggu 10 detik, supaya reconnect singkat tidak membuat status berkedip (pilihan saya, diperjelas setelah tinjauan builder).
- **Status online user:** user online jika app mobile membuka layar Live Chat dan minimal satu socket user itu masih terdaftar (atau baru putus dan masih dalam masa tunggu 10 detik). Aturannya sama dengan CS: `presence_user_leave` melepas socket itu seketika, dan satu user boleh punya banyak device.
- **Cakupan layar Live Chat (user):** seluruh alur Live Chat, yaitu tab Customer Support dan Sales beserta percakapannya (di desain slide 24, daftar tab dan percakapan ada di satu layar). App mobile mengirim `presence_user_register` sekali saat masuk alur itu dan `presence_user_leave` hanya saat keluar dari seluruh alur, bukan saat berpindah tab atau membuka percakapan. Backend tidak menganggap `join_chat` atau `join_user` sebagai tanda online (pilihan saya setelah tinjauan builder).
- **Sales untuk v1 diturunkan dari CS** (pilihan saya setelah tinjauan builder): admin yang mendaftar dengan tim sales dihitung online untuk tab Sales, tidak harus CS. Layar sales yang sudah ada di CRM boleh mendaftar dengan `teams: [sales]` tanpa perubahan di backend; admin sales murni ikut masuk `presence_admins` dan menerima status semua user (diterima di bagian 5).

## 4. Rancangan backend

**Registry di memori** (service baru, satu proses): peta admin ke `{ teams, sockets, timer masa tunggu }`. Setiap perubahan membandingkan status tim sebelum dan sesudah; event hanya dikirim jika berubah.

**Event socket, client ke server**

| Event | Dikirim oleh | Payload | Efek |
|---|---|---|---|
| `presence_register` | CRM, saat masuk menu live chat dan setiap `connect` ulang selama masih di menu | `{ adminId: string, teams: array berisi customer_support dan/atau sales }` | Mendaftarkan socket ini. Idempotent; daftar ulang menimpa tim. |
| `presence_leave` | CRM, saat keluar menu | `{}` | Melepas socket ini dari registry tanpa masa tunggu. |
| `presence_subscribe` | App mobile, saat layar Live Chat dibuka | `{ teams?: array }` (default kedua tim) | Socket masuk room `presence_<team>`. |
| `presence_unsubscribe` | App mobile, saat layar ditutup | sama | Keluar dari room tersebut. |

**Event socket, server ke client:** `presence_changed { team, online }`, dikirim ke room `presence_<team>` hanya saat status tim berubah.

**REST:** `GET /api/client/presence` mengembalikan `{ success: true, data: { customer_support: boolean, sales: boolean } }`. Dilindungi API key seperti route lain di `/api/client`. Dipakai untuk kondisi awal.

**Urutan di app mobile:** `presence_subscribe` dulu, baru `GET /api/client/presence`, supaya tidak ada perubahan yang terlewat di antara keduanya.

**Hook disconnect:** handler `disconnect` di `src/sockets/chatSocket.ts` (sekarang hanya log) memanggil registry.

**Konfigurasi baru:** `PRESENCE_GRACE_SECONDS` (default 10). Tambahkan ke `.env.example`, `deploy/.env.example`, dan tabel env di `deploy/DEPLOYMENT.md`.

**Kontrak terbuka untuk perluasan:** field yang tidak dikenal di payload diabaikan. Status Sales per referrer (nanti) cukup menambah `referrerId` opsional pada `presence_register`, `presence_subscribe`, `GET /api/client/presence`, dan `presence_changed`, tanpa mengubah kontrak di atas (pilihan saya).

**Status online user (untuk CS dan Sales)**

- `presence_user_register { userId }`: dikirim app mobile saat layar Live Chat dibuka dan setiap `connect` ulang selama layar masih terbuka. Idempotent.
- `presence_user_leave {}`: dikirim saat layar ditutup; melepas socket itu seketika.
- Socket CRM yang sudah `presence_register` sebagai admin otomatis masuk room `presence_admins`, dan keluar saat `presence_leave` atau disconnect.
- `presence_user_changed { userId, online }`: server ke room `presence_admins`, hanya saat status user berubah. Event terpisah dari `presence_changed` supaya bentuk payload jelas.
- `GET /api/chats/crm/presence?userIds=a,b,c` mengembalikan `{ success: true, data: { <userId>: boolean } }` sebagai kondisi awal untuk daftar chat atau room. Dilindungi API key lewat route `/api/chats`. Batas jumlah id per request ditentukan builder (saran 100). Endpoint lama tidak berubah.
- Urutan di CRM: `presence_register` dulu (masuk `presence_admins`), baru GET kondisi awal.
- Registry memisahkan kunci user dan admin; masa tunggu dan multi-socket memakai mekanisme yang sama.

**Alur (status CS ke user):**

1. App mobile membuka Live Chat, subscribe, lalu GET presence dan menampilkan hasilnya.
2. CS masuk menu, CRM mengirim `presence_register`. Status berubah dari false ke true, server mengirim `presence_changed`, app memperbarui label.
3. CS keluar menu atau menutup tab. Status kembali false (langsung untuk leave bila itu socket terakhir, setelah 10 detik untuk putus koneksi), server mengirim `presence_changed`.

[Diagram urutan, 3 pihak (app mobile, server, CRM), 7 langkah: subscribe, GET kondisi awal, status awal, presence_register, presence_changed true, presence_leave atau socket putus (tunggu 10 detik), presence_changed false.]

App mobile subscribe lalu mengambil status awal; server mengirim presence_changed hanya saat CS pertama masuk atau CS terakhir keluar.

## 5. Keputusan

**Disetujui user**

- Presence berbasis koneksi Socket.IO, disimpan di memori, tanpa tabel baru dan tanpa polling (user menjawab “oke” pada rekomendasi).
- CS dianggap online saat berada di menu live chat; tampilan mengikuti desain slide 24.
- Untuk saat ini CS juga dianggap berperan sebagai sales, jadi status Sales berlaku untuk seluruh tim dan bukan per referrer.
- Status online user ditambahkan supaya CS atau Sales tahu user sedang berada di menu Live Chat.

**Pilihan saya, belum dibahas dengan user** (periksa bagian ini)

- Nama event dan bentuk payload di bagian 4.
- Masa tunggu 10 detik dan nama env `PRESENCE_GRACE_SECONDS`.
- Status per tim, bukan per orang; tim `customer_support` dan `sales`.
- Endpoint REST untuk kondisi awal dan urutan subscribe lalu GET.
- Kontrak dibuat terbuka untuk `referrerId` opsional di masa depan.
- Status hanya boolean; teks untuk kondisi offline ditentukan UI (desain hanya menunjukkan kondisi Online).
- Event `presence_user_register`, `presence_user_leave`, `presence_user_changed`, room `presence_admins`, dan endpoint kondisi awal `GET /api/chats/crm/presence`.
- Backend menyediakan event realtime dan kondisi awal sekaligus, karena belum disebut di mana CRM menampilkannya (daftar chat, header room, atau keduanya).
- Semua admin yang sedang di menu live chat menerima perubahan status semua user; pembatasan per referrer ditunda bersama pertanyaan terbuka 1.
- Cakupan status user = seluruh alur Live Chat (tab dan percakapan), dan tim Sales di v1 diturunkan dari CS: layar sales yang sudah ada di CRM boleh mendaftar sebagai tim sales (lihat bagian 3).

## 6. Batasan dan risiko

- **Satu instance.** Registry ada di memori satu proses. Jika server dijalankan lebih dari satu instance, status akan tidak konsisten dan perlu Redis adapter. Deployment sekarang satu container.
- **Restart server** mengosongkan registry. CRM wajib mengirim ulang `presence_register` pada setiap event `connect` selama masih di menu. Sebelum itu status tampil offline.
- **Identitas tidak diverifikasi.** `adminId` dan tim datang dari payload, sama seperti `sender_id` di `send_message` sekarang. Pemegang API key bisa memalsukan status online. Diterima untuk v1.
- Socket app mobile di background bisa putus. Ini tidak memengaruhi status CS.
- **Volume event.** Setiap user yang masuk atau keluar layar Live Chat mengirim satu event ke semua admin di menu. Cukup untuk skala sekarang; jika jumlah user bertambah besar, ganti ke room per chat atau per referrer.
- **userId tidak diverifikasi.** Pemegang API key bisa menandai user mana pun online. Status user hanya dikirim ke admin, tidak ke user lain.

## 7. Diserahkan ke builder

- Letak kode. Saran: `src/services/presenceService.ts` (registry, masa tunggu, deteksi perubahan), handler di `src/sockets/chatSocket.ts`, endpoint di `src/controllers/clientChatController.ts` dan `src/routes/clientRoutes.ts`. Emit lewat `getIO()` di `src/sockets/io.ts`.
- Strategi tes. Repo belum punya test runner (`npm test` masih placeholder). Saran: buat registry mudah diuji dengan timer dan fungsi emit yang bisa disuntikkan, lalu uji dengan `node:test`; sisanya manual dengan dua klien Socket.IO (`test.html` di root bisa diperluas).
- Verifikasi manual minimal: register admin dengan `teams: [customer_support, sales]` lalu subscriber menerima `presence_changed` true untuk kedua tim; `presence_leave` lalu false; tutup tab lalu false setelah sekitar 10 detik; dua socket untuk admin yang sama, tutup satu, tetap true; `GET /api/client/presence` konsisten; berjalan dengan `CHAT_API_KEY` terisi dan kosong.
- Tes tambahan untuk user: `presence_user_register` lalu admin di `presence_admins` menerima `presence_user_changed` true; `presence_user_leave` lalu false; dua device untuk user yang sama, tutup satu, tetap true; tutup koneksi lalu false setelah sekitar 10 detik; `GET /api/chats/crm/presence` konsisten dengan event.
- Tes tim sales: admin yang mendaftar dengan `teams: [sales]` saja membuat tim sales online sementara `customer_support` tetap offline; admin dengan kedua tim mengubah keduanya. Di sisi app mobile: pindah tab atau membuka percakapan tidak boleh mengirim `presence_user_leave`.

## 8. Perubahan di luar repo ini

Dikerjakan di project lain (kemungkinan Flutter, dilihat dari komentar `lib/services/live_chat_service.dart` di `src/services/clientChatService.ts`):

- **CRM:** kirim `presence_register` dengan kedua tim saat CS masuk menu live chat dan setiap reconnect, `presence_leave` saat keluar.
- **App mobile:** subscribe, GET kondisi awal, tampilkan label di agent bar dan subtitle header sesuai desain.
- **App mobile (tambahan):** kirim `presence_user_register` saat layar Live Chat dibuka dan setiap reconnect selama layar terbuka, `presence_user_leave` saat ditutup.
- **CRM (tambahan):** setelah `presence_register`, ambil kondisi awal lewat `GET /api/chats/crm/presence`, dengarkan `presence_user_changed`, dan tampilkan status di tempat yang dipilih tim CRM.
- **App mobile (cakupan):** kirim register sekali saat masuk alur Live Chat dan leave hanya saat keluar dari seluruh alur, bukan saat pindah tab atau membuka percakapan; register ulang saat reconnect.
- **CRM (layar sales yang sudah ada):** boleh mengirim `presence_register` dengan `teams: [sales]`.

## 9. Pertanyaan terbuka

1. **Ditunda:** jika kelak sales dipisah dari CS, apakah tab Sales harus menunjukkan status sales yang menjadi referrer user (`user_referrer_id`)? Itu butuh id referrer di kontrak (lihat bagian 4) dan pemetaan antara id admin di CRM dengan `user_referrer_id` (belum diketahui apakah nilainya sama).
2. Layar sales yang sudah ada di CRM (daftar chat referred, POST /api/chats/crm/chat/referred) boleh mengirim `presence_register` untuk tim sales. Kontrak backend tidak berubah; admin sales murni ikut menerima status semua user. Keputusan apakah layar itu mendaftar ada di tim CRM.
3. Di CRM, status online user ditampilkan di daftar chat, di header room, atau keduanya? Backend mendukung ketiganya; keputusan tampilan ada di tim CRM.
4. Typing indicator sudah masuk tugas ini (bagian 10); apakah “Average response” masuk tugas ini?
5. Konfirmasi tafsiran bagian 1: “menu” memang menu live chat di CRM.

## 10. Typing indicator (tambahan)

Menjawab pertanyaan terbuka 4: typing indicator masuk tugas ini; “Average response” tidak. Desain slide 24 menyebut “a typing indicator shows while the agent replies”.

- **Relay tanpa state** ke room `chat_<chatId>` (pilihan saya). Client mengirim satu event dua arah `typing { chatId, isTyping, senderId, senderType, senderName? }` dengan `senderType` berupa `user` atau `admin`. Server meneruskan event `typing` dengan payload yang sama ke anggota room lain, tidak ke socket pengirim.
- Hanya diteruskan jika payload valid dan socket pengirim sudah berada di room chat itu (sudah `join_chat`). Selain itu diabaikan tanpa error.
- **Tanpa timer di server.** Pengirim mengulang `isTyping: true` sekitar tiap 3 detik selama mengetik dan mengirim `isTyping: false` saat berhenti; penerima menyembunyikan indikator setelah 5 detik tanpa pembaruan, supaya indikator tidak tersangkut kalau socket pengirim putus. Angka 3 dan 5 detik adalah pilihan saya.
- Arah: user ke CS dan CS ke user.
- **Di luar repo ini:** CRM dan app mobile mengirim event dan menampilkan indikator; client wajib melakukan debounce.
- **Risiko:** tidak ada pembatasan laju di server, jadi client yang mengirim tiap ketukan akan membanjiri room. `senderId` tidak diverifikasi, sama seperti pesan.
