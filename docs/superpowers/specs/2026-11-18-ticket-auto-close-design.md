# Tiket CS: auto-close dan tiket baru dalam satu thread: Desain

Repo `maxco_chat_cs_nodejs` · 18 Nov 2026

## Maksud

Ada pertanyaan dari luar tim: fitur apa yang belum ada di live chat CS, misalnya ticketing dan logika close chat. Jawabannya berupa alur di app user, digambarkan dalam dua mockup:

1. CS membalas, lalu user tidak membalas selama 10 menit. Chat tertutup otomatis dengan bubble **Automated message**: "Hi Ms. Priya, since we haven't received a reply from you in the last 10 minutes, this chat will now be closed. Please contact us again if you have any further questions."
2. Di bawahnya muncul garis "Ticket #… is closed" dengan teks "Send a message to open a new ticket."
3. Saat user menulis lagi (bisa keesokan harinya), muncul "New ticket #… opened" dan pesan itu masuk ke tiket baru. History tiket lama tetap terlihat di atasnya, dalam thread yang sama.
4. CS membalas di tiket baru.

Kondisi sekarang:

- Setiap baris `list_chats` sudah punya `chat_ticket`, `status` (`pending`, `active`, `closed`) dan `closed_at`. Satu baris adalah satu tiket.
- Close hanya manual, lewat REST `POST /api/chats/crm/chat/close` atau socket `close_chat`. Tidak ada scheduler.
- Close lewat REST tidak mengirim `chat_closed`, jadi user tidak tahu chatnya ditutup. Event itu hanya dikirim oleh jalur socket.
- Pesan yang dikirim ke chat `closed` tetap disimpan di chat itu (`sendMessage` tidak mengecek status).

## Tujuan

- Chat Customer Support yang menunggu balasan user ditutup otomatis setelah N menit. N bisa diatur, dan nilai yang dipakai di mockup adalah 10.
- Pesan otomatis tersimpan sebagai pesan, lalu tampil di app dan CRM.
- User yang menulis ke tiket tertutup otomatis membuka tiket baru, dan pesan itu masuk ke tiket baru.
- App bisa menampilkan semua tiket CS milik user sebagai satu thread, dengan penanda kapan tiket dibuka dan ditutup.
- Close dari CRM lewat REST juga memberi tahu user.

## Bukan tujuan

- Ticketing lengkap: subject, prioritas, SLA, tag, catatan internal, alasan close, siapa yang menutup, rating/CSAT, transfer ke agent atau department lain, dan laporan.
- Kategori Promotion (2) dan Inside Sales (3) tidak berubah: tidak ada auto-close dan tidak ada tiket baru.
- Format nomor tiket tetap `XXXX-XXXX-XXXX`. `#MX-240318` di mockup hanya contoh.
- "Average response under 2 minutes" di header mockup tidak dihitung oleh server.
- Aturan waiting dan assigned tidak berubah (`max_waiting_minutes`, `assignWaitingChat`).
- Bug `updated_at` di `assignAdminToChat` (kolom itu tidak ada di `list_chats`) diperbaiki terpisah.
- Riwayat tiket sebelumnya di CRM, saat user kembali dengan tiket baru, belum masuk rilis ini. Backend sudah mendukungnya lewat `GET /api/chats/user/:userId` dan `crm/messages`, jadi yang tersisa hanya pekerjaan UI CRM.
- Kode UI app dan CRM ada di repo lain. Dokumen ini berisi kontrak backend. Yang harus diubah di sisi app dan CRM dicatat di bagian "Dampak ke app dan CRM".

## Pendekatan

| | Cara | Trade-off |
|---|---|---|
| **A (dipilih)** | Satu tiket tetap satu baris `list_chats`. Ditambah: job auto-close, pesan `system`, pengalihan pesan user dari tiket tertutup ke tiket baru, dan endpoint thread yang menggabungkan pesan semua tiket CS milik user. | Perubahan paling kecil. Tab Assigned/Waiting/Closed di CRM, `assignWaitingChat`, dan aturan waiting tetap jalan. Thread di app butuh query lintas chat dan penanda tiket. Estimasi backend sekitar 1,5 sampai 2 hari, belum termasuk UI app. |
| B | Satu percakapan permanen per user, ditambah tabel tiket baru, dan setiap pesan diberi `ticket_id`. | Thread menyambung dengan sendirinya. Tetapi semua daftar CRM, `assignWaitingChat`, dan aturan waiting dibangun di atas `list_chats`, sehingga harus ditulis ulang. Data lama juga harus dimigrasi. Estimasi backend 5 hari lebih, ditambah perubahan CRM. Baru sepadan kalau nanti ada subject, prioritas, dan SLA. |

Dipilih A, karena memenuhi mockup dengan perubahan terkecil dan CRM hampir tidak tersentuh.

## Desain

### 1. Skema (migrasi baru)

File `sql/dbchanges_20261118HHMM.sql`, dan salinannya `deploy/sql/10_dbchanges_20261118HHMM.sql`. Header mengikuti format file 03 sampai 09: sekali jalan, tidak idempotent.

- `list_messages.sender_type`: `ENUM('user','admin')` menjadi `ENUM('user','admin','system')`.
- Dua baris baru di `list_chat_config`:
  - `auto_close_minutes` = `'0'`. Nilai 0 berarti mati. Nilai ini dinaikkan ke `10` setelah app versi baru rilis (lihat Rollout).
  - `auto_close_message` = `Hi {name}, since we haven't received a reply from you in the last {minutes} minutes, this chat will now be closed. Please contact us again if you have any further questions.` Kolom `config_value` bertipe `VARCHAR(255)`, jadi template harus muat dalam 255 karakter.

Mengapa `system` dan bukan `admin`: semua query waiting/assigned memfilter `sender_type = 'admin'`. Kalau pesan otomatis disimpan sebagai `admin`, ia akan terhitung sebagai balasan CS.

### 2. Job auto-close

Modul baru `src/services/autoCloseService.ts` dengan fungsi `runAutoClose()` yang menjalankan satu putaran. Fungsi ini dipanggil dari `src/app.ts` dengan `setInterval` setiap 60 detik. Timer di-`unref()`. Jika putaran sebelumnya belum selesai, putaran berikutnya dilewati.

- `auto_close_minutes` dibaca di setiap putaran, sehingga perubahan nilai berlaku tanpa restart. Nilai kosong, tidak valid, atau `<= 0` berarti job mati.
- Chat menjadi kandidat jika memenuhi semua syarat:
  - `category_id = 1`,
  - `status IN ('pending','active')`,
  - pesan terakhir (urut `created_at DESC, id DESC`) punya `sender_type = 'admin'`,
  - pesan terakhir itu lebih lama dari N menit, tetapi tidak lebih lama dari N + 60 menit.

  Artinya, yang ditutup hanya chat yang menunggu balasan user. Chat yang menunggu CS (pesan terakhir dari user, atau belum ada balasan admin) tidak pernah ditutup otomatis. Chat tanpa pesan sama sekali juga tidak.

  Batas atas N + 60 menit ada karena dua hal:
  - Saat fitur pertama kali dinyalakan, kemungkinan sudah ada banyak chat CS yang masih terbuka padahal balasan admin terakhirnya berumur berhari-hari.
  - Setelah server mati cukup lama, terkumpul chat yang balasan admin terakhirnya sudah lewat jauh dari N menit.

  Tanpa batas ini, semua chat tersebut akan ditutup sekaligus dengan pesan "no reply in the last 10 minutes" disertai push, padahal pesan itu tidak benar untuk mereka. Chat yang lewat batas tidak disentuh oleh job dan tetap seperti sekarang. CS menutupnya secara manual, atau lewat satu `UPDATE` SQL sekali jalan tanpa pesan. Angka 60 ditulis tetap di kode.
- Setiap kandidat ditutup dengan satu `UPDATE ... SET status='closed', closed_at=NOW()` per id. Klausa `WHERE`-nya mengulang syarat kandidat. Langkah berikutnya hanya dijalankan jika `affectedRows = 1`. Dengan cara ini, pesan user yang masuk di detik yang sama, atau dua proses yang berjalan bersamaan, tidak menghasilkan close ganda maupun pesan otomatis ganda.
- Setelah chat tertutup:
  1. INSERT pesan otomatis ke `list_messages` dengan nilai:
     - `sender_type 'system'`,
     - `sender_id 'system'`,
     - `content_type 1`,
     - `metadata {"type":"auto_close"}`,
     - teks dari template: `{name}` diisi `list_chats.user_name`, `{minutes}` diisi N.
  2. Emit `new_message` ke `chat_{id}`, dengan bentuk payload yang sama seperti hasil `sendMessage`.
  3. Emit `chat_closed` `{ chatId, chatData, reason: 'auto_no_reply' }` ke `chat_{id}`.
  4. Push FCM ke user lewat `sendChatPush`, dengan isi teks pesan otomatis. Fire-and-forget.
- Error pada satu chat dicatat di log, lalu job lanjut ke chat berikutnya.

### 3. Pesan user ke tiket tertutup membuka tiket baru

Di jalur socket `send_message` (`chatSocket.ts` dan `chatService.sendMessage`):

- Berlaku jika `sender_type = 'user'`, chat tujuan `category_id = 1`, dan `status = 'closed'`.
- Server mengambil chat CS yang masih terbuka milik user itu, atau membuatnya jika belum ada. Logikanya sama dengan `createNewChat`: chat `pending`/`active` yang ada dipakai ulang, dan jika tidak ada, dibuat baris baru dengan nilai berikut:
  - `status 'pending'`,
  - nomor tiket baru,
  - `user_name` dari chat lama,
  - `user_referrer_id` disalin dari chat lama.
- Duplikat dicegah dengan kunci in-process per user, pola yang sama dengan `ensureUserSalesChat`. Dua pesan cepat ke tiket tertutup hanya membuat satu tiket. Kunci yang sama dipakai juga oleh `POST /api/chats`. Asumsinya tetap satu proses, sama seperti presence.
- Pesan disimpan di chat baru. Payload `new_message` berisi:
  - `chat_id` = id baru,
  - `previous_chat_id` = id lama,
  - `is_new_ticket` = `true` jika barisnya baru dibuat.
- Socket pengirim di-`join` ke `chat_{newId}` oleh server.
- Emit:
  - `new_message` ke `chat_{newId}` dan `user_{userId}` dalam satu emit, yaitu `io.to(a).to(b)`, supaya tiap socket hanya menerima sekali. Dengan begitu device lain milik user ikut menerima.
  - `new_user_chatroom` `{ chatData }` ke `user_{userId}`. Event ini sudah ada dan dipakai app untuk join room.
  - Jika `is_new_ticket`, `chat_room_created` ke semua socket (event yang sudah ada, payload sama dengan `createChat`), supaya tiket baru masuk ke daftar Waiting di CRM.
- Pesan user ke chat tertutup di kategori 2 dan 3 tidak berubah.
- Pemicunya ada di server (keputusan pemilik produk). App tidak memanggil endpoint khusus. App cukup mengirim ke `current.chat_id`, lalu mengikuti `chat_id` baru yang dikirim server.
- Risiko pada app versi lama: jika app lama mengizinkan user mengetik di chat yang sudah closed, pesannya tersimpan di tiket baru yang `chat_id`-nya berbeda. App lama mungkin tidak menampilkannya di layar chat lama. Risiko ini diterima, karena tidak ada mekanisme versi klien di server.

### 4. Pesan admin ke tiket CS tertutup

- Jika `sender_type = 'admin'`, `category_id = 1`, dan `status = 'closed'`, pesan **ditolak**: tidak disimpan dan tidak dibroadcast.
- Hanya socket pengirim yang menerima `send_message_error` `{ chat_id, reason: 'chat_closed' }`.
- Alasannya: balasan ke tiket lama akan muncul di bawah garis "Ticket closed" di thread user dan tidak diproses sebagai tiket.

### 5. Close dari CRM

- `crmCloseChat` (REST): setelah berhasil, emit `chat_closed` `{ chatId, chatData, reason: 'agent' }` ke `chat_{id}`, sama dengan jalur socket.
- Socket `close_chat` juga menambahkan `reason: 'agent'`. Field ini tambahan, jadi tidak merusak penerima lama.
- Close manual tidak mengirim push dan tidak menyimpan pesan otomatis.

### 6. Endpoint thread CS untuk app

`GET /api/client/chat/support-thread/:userId?page=1&pageSize=50`. Endpoint ini ada di `clientRoutes`, route khusus app, dan wajib memakai `X-API-Key`.

```json
{
  "success": true,
  "data": {
    "messages": [ { "id": 1, "chat_id": 10, "sender_type": "system", "...": "kolom list_messages" } ],
    "tickets": [ { "chat_id": 10, "chat_ticket": "1234-5678-9012", "status": "closed", "created_at": "...", "closed_at": "..." } ],
    "current": { "chat_id": 11, "chat_ticket": "...", "status": "pending" }
  },
  "pagination": { "total": 120, "page": 1, "pageSize": 50, "hasMore": true }
}
```

- `messages`: pesan dari semua chat dengan `user_id = :userId AND category_id = 1`.
  - Halaman diambil dengan urutan `created_at DESC, id DESC`, lalu isinya dikembalikan dari yang paling lama ke yang paling baru.
  - Konvensinya sama dengan `GET /api/chats/:chatId/messages`: halaman 1 adalah pesan terbaru.
- `tickets`: semua tiket yang pesannya muncul di halaman itu.
- `current`: chat CS terbaru milik user (urut `created_at DESC, id DESC`), atau `null` jika user belum pernah chat dengan CS.
- Cara app memakai data ini:
  - Penanda tiket ditempatkan menurut waktu, bukan menurut pesan pertama atau terakhir:
    - "New ticket #X opened" di posisi `tickets[].created_at`,
    - "Ticket #X is closed" di posisi `tickets[].closed_at`.
  - Teks "Send a message to open a new ticket." hanya muncul jika `current.status = 'closed'`.
  - Data lama berisi pesan yang dikirim ke tiket setelah tiket itu closed, karena sampai sekarang close lewat REST tidak memberi tahu app. Pesan seperti itu tampil sesuai waktunya, sesudah penanda closed. Data lama tidak dibersihkan.
- App selalu mengirim pesan ke `current.chat_id`. Jika tiket itu sudah tertutup, server membuka tiket baru (bagian 3). Jika `current` bernilai `null`, app memakai `POST /api/chats` seperti sekarang.

### 7. Lain-lain

- `getClientChatUnread` (`clientChatService.ts`) menghitung `sender_type IN ('admin','system')`, supaya pesan otomatis ikut tercatat sebagai pesan belum dibaca.
- Perbarui `docs/integration-guide-app.md` dan `docs/integration-guide-crm.md` dengan:
  - `sender_type 'system'`,
  - endpoint thread,
  - pengalihan ke tiket baru,
  - `send_message_error`,
  - `reason` di `chat_closed`.

## Dampak ke app dan CRM (repo lain)

App:

- Render `sender_type 'system'` sebagai bubble "Automated message".
- Ambil thread CS dari endpoint baru, lalu gambar penanda tiket dibuka dan ditutup.
- Saat menerima `new_message` dengan `chat_id` berbeda dan `is_new_ticket`:
  - jadikan chat itu `current`,
  - gambar "New ticket opened".
- Saat menerima `chat_closed`, tampilkan penanda closed dan teks petunjuk. Input tetap aktif.

CRM:

- Render pesan `system`. Jika parser CRM menolak nilai `sender_type` yang tidak dikenal, ini wajib diubah.
- Tangani `send_message_error` dengan `reason: 'chat_closed'`, misalnya input dimatikan di chat yang sudah closed.
- Tiket baru masuk lewat `chat_room_created` yang sudah ada.

## Rollout

1. Rilis CRM dan app yang sudah mendukung kontrak baru. Perubahan di keduanya aman dijalankan dengan backend lama, karena backend lama tidak pernah mengirim pesan `system`, `is_new_ticket`, atau `send_message_error`.
2. Deploy backend dan migrasi, dengan `auto_close_minutes = 0` (mati). Bagian 3, 4, dan 5 langsung berlaku. Karena CRM baru sudah terpasang, penolakan di bagian 4 tidak membuang balasan CS tanpa pemberitahuan.
3. Ubah `auto_close_minutes` menjadi `10` di `list_chat_config`. Tidak perlu restart.

Pengguna yang belum memperbarui app tetap terkena risiko yang dijelaskan di bagian 3. Risiko ini diterima.

## Verifikasi

Tes DB (`test-db/`, `npm run test:db`):

- Auto-close:
  - menutup chat jika pesan terakhir dari admin dan lebih lama dari N menit,
  - tidak menutup jika pesan terakhir dari user,
  - tidak menutup jika pesan admin terakhir lebih baru dari N menit,
  - tidak menutup jika pesan admin terakhir lebih lama dari N + 60 menit,
  - tidak menyentuh kategori 2 dan 3 maupun chat yang sudah closed,
  - tidak melakukan apa pun jika N = 0,
  - putaran kedua tidak membuat pesan otomatis ganda.
- Tiket baru:
  - pesan user ke chat tertutup membuat baris `pending` baru, pesan tersimpan di sana, dan chat lama tidak berubah,
  - dua pesan bersamaan hanya membuat satu tiket,
  - jika user masih punya chat terbuka, chat itu dipakai ulang.
- Pesan admin ke chat CS tertutup tidak tersimpan.
- Endpoint thread:
  - urutan lintas tiket benar,
  - paging tidak menggandakan atau melewatkan pesan,
  - isi `tickets` dan `current` benar.

Unit test (`test/`): pengisian template pesan otomatis.

Ditambah `npm test` dan `npx tsc --noEmit`.

## Diserahkan ke pembuat

- SQL persis untuk kandidat dan untuk guard `UPDATE`.
- Bentuk kunci per user, dan apakah `createNewChat` yang sekarang duplikat (di `chatService.ts` dan `crmChatService.ts`) disatukan.
- `sender_name` untuk pesan `system`, misalnya "Maxco Customer Support".
- Pengganti `{name}` jika `user_name` kosong.
- Apakah `test.html` diperbarui untuk menampilkan pesan `system` dan perpindahan tiket.
