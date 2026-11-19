# Panduan Menjalankan dan Menguji Maxco Chat CS

Panduan dari nol: menyiapkan database, menjalankan server, lalu menguji setiap fitur. Semua perintah memakai Git Bash (Windows) dari folder project. Di PowerShell, ganti `curl` dengan `curl.exe`.

## 0. Fitur yang ada

- **Chat Customer Service** (kategori 1): user membuat chat, CS membalas lewat CRM. Status `pending`, `active`, `closed`. Chat yang belum dibalas, atau balasan CS terakhir lebih tua dari batas waktu (default 120 menit), tampil di daftar **waiting**.
- **Tiket CS**: setiap chat Customer Service adalah tiket. Tiket ditutup oleh CS, atau otomatis (auto-close) bila user tidak membalas `auto_close_minutes` menit (default 10) setelah CS membalas; server lalu menyimpan pesan otomatis (`sender_type: "system"`). Pesan user ke tiket yang sudah ditutup membuka tiket baru. Di app, semua tiket tampil sebagai satu percakapan bersambung.
- **Semua CS** bisa membuka dan membalas semua chat; PIC (`admin_name`) hanya informasi. Nama pengirim tiap balasan ada di `sender_name`.
- **Waktu** dari server selalu UTC, format `YYYY-MM-DD HH:mm:ss` tanpa zona (pengecualian: `created_at` di event socket `new_message` berformat ISO dengan `Z`). App dan CRM mengubahnya ke jam lokal.
- **Chat Promotion** (kategori 2) dan **Inside Sales** (kategori 3, satu chat per user, terikat ke sales lewat `user_referrer_id`).
- **Pesan**: teks dan file (base64), riwayat per halaman, penanda sudah dibaca, ringkasan belum dibaca untuk app mobile.
- **Realtime** lewat Socket.IO: pesan baru, chat ditutup, admin ditugaskan, room chat baru.
- **Push notification** FCM ke app mobile (opsional).
- **Status online** (baru): tim CS dan Sales terlihat online oleh user, dan user yang sedang di layar Live Chat terlihat online oleh CS dan Sales.
- **Typing indicator** (baru): relay "sedang mengetik" di dalam room chat.

## 1. Prasyarat

- Node.js 24 dan npm.
- MySQL 8.0 (atau MariaDB 10.4+), charset `utf8mb4`.
- Browser modern dengan internet (`test.html` memuat Socket.IO dari CDN).

Pasang dependensi sekali:
```bash
npm install
```

## 2. Siapkan database (DB kosong)

Database dibuat oleh `deploy/sql/01_schema.sql` (`maxco_chat_im`). Jalankan semua file SQL sesuai urutan nama, dari `01` sampai `11`. Semua file bisa langsung dijalankan di MySQL 8.0 maupun MariaDB. `07_dbchanges_202610191417.sql` sengaja kosong; perubahannya (satu chat inside sales per user) dibuat oleh `11_dbchanges_202611161515.sql`, yang aman dijalankan berulang kali.

```bash
MYSQL="/c/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe"
export MYSQL_PWD='<password root MySQL>'

for f in deploy/sql/*.sql; do echo "== $f"; "$MYSQL" -u root < "$f" || break; done
```

Baris terakhir yang dicetak `11_*.sql` harus `1  1  RESTRICT  0` (`NO ACTION` di posisi `RESTRICT` sama saja, tidak masalah).

Cek hasilnya:
```bash
"$MYSQL" -u root -e "SHOW TABLES FROM maxco_chat_im;"
```
Harus ada 7 tabel: `list_chats`, `list_messages`, `list_content_type`, `list_chat_category`, `list_chat_admin_history`, `list_user_devices`, `list_chat_config`. Kolom `sales_chat_key` harus ada di `list_chats`.

File SQL tidak idempotent. Kalau gagal di tengah, jalankan `DROP DATABASE maxco_chat_im;` lalu ulangi dari awal. Jangan jalankan ulang pada DB yang sudah terisi.

Pengguna DBeaver/HeidiSQL: buka tiap file dan jalankan sebagai script (Alt+X di DBeaver), dengan urutan yang sama.

## 3. Konfigurasi

Salin `.env.example` menjadi `.env.local`, lalu isi:
```
MYSQLHOST=localhost
MYSQLPORT=3306
MYSQLUSER=root
MYSQLPASSWORD=<password root>
MYSQLDATABASE=maxco_chat_im
PORT=3000
CHAT_API_KEY=            # kosong = semua endpoint terbuka (hanya untuk development)
PRESENCE_GRACE_SECONDS=10
```
`FCM_PUSH_ENABLED` biarkan `false` kecuali menguji push (bagian 12).

## 4. Jalankan server

```bash
npm run dev:tsx
```
Tunggu `Listening on 3000`, lalu cek:
```bash
curl -s http://localhost:3000/healthz        # {"ok":true}
```
Untuk mencoba status online dengan cepat, jalankan dengan grace pendek: `PRESENCE_GRACE_SECONDS=3 npm run dev:tsx`.

## 5. Tes otomatis

```bash
npm test               # tes unit, tanpa database: harus fail 0
npm run test:db        # tes ke database di .env.local (hanya menyentuh baris uji TEST-AWC-* / test-awc-*): harus fail 0
npx tsc --noEmit       # harus tanpa output
```

## 6. Siapkan perintah bantu untuk uji REST

```bash
BASE=http://localhost:3000
KEY=                    # isi sama dengan CHAT_API_KEY; kosongkan jika tidak dipakai
api() { curl -s -H "Content-Type: application/json" -H "X-API-Key: $KEY" "$@"; echo; }
```
Perintah di bagian 7 sampai 9 ditulis dari pembacaan kode (belum dijalankan ulang di sesi penyusunan panduan ini), jadi cocokkan hasilnya dengan yang tertulis.

## 7. Uji chat lewat REST

**7.1 User membuat chat Customer Service**
```bash
api -X POST $BASE/api/chats -d '{"userId":"user123","userName":"Budi"}'
```
Harapan: status `201`, `data.status` = `pending`, ada `chat_ticket` format `1234-5678-9012`. Catat `data.id`, dan pakai di bawah: `CHAT_ID=<id>`. Panggilan kedua mengembalikan chat yang sama dengan status `200`.

**7.2 CRM melihat daftar**
```bash
api "$BASE/api/chats/crm/chat/pending?page=1&pageSize=20"     # chat tadi ada di sini
api "$BASE/api/chats/crm/config"                              # { maxWaitingMinutes: 120 }
```

**7.3 Admin membalas, chat jadi active.** Lakukan lewat `test.html` (bagian 8, langkah 3), lalu:
```bash
api -X POST $BASE/api/chats/crm/chat/active -d '{"adminId":"admin1","page":1,"pageSize":20}'
```
Chat pindah dari pending ke active dan `admin_id` terisi. Jika balasan admin terakhir lebih tua dari `maxWaitingMinutes`, chat kembali muncul di daftar pending (waiting).

**7.4 Riwayat pesan dan penanda dibaca**
```bash
api "$BASE/api/chats/$CHAT_ID/messages?page=1&pageSize=50"
api -X PUT $BASE/api/chats/$CHAT_ID/read -d '{"userId":"user123"}'
api -X POST $BASE/api/chats/crm/messages -d "{\"chatId\":$CHAT_ID,\"updateRead\":true,\"userId\":\"admin1\"}"
api $BASE/api/client/chat/unread/user123          # { total, chats: [{ chatId, unread }] }
```
Halaman 1 berisi pesan terbaru, halaman berikutnya riwayat lebih lama. `pagination.hasMore` menunjukkan masih ada halaman lagi.

Waktu (`created_at`, `last_message_time`, dan lainnya) dalam UTC, apa pun zona waktu server MySQL: pesan yang dikirim jam 13:33 WIB tampil sebagai `"2026-11-19 06:33:..."`.

**7.5 Daftar chat milik user, dan chat Inside Sales otomatis**
```bash
api "$BASE/api/chats/user/user123?page=1&pageSize=20"
api -X POST $BASE/api/chats/user -d '{"userId":"user123","userName":"Budi","userReferrerId":"sales1","userReferrerName":"Sales Satu"}'
```
Panggilan kedua membuat chat kategori 3 jika belum ada. Ulangi beberapa kali: tetap satu chat kategori 3 per user.

**7.6 Chat dari sisi CRM**
```bash
api -X POST $BASE/api/chats/crm/create_service_chat -d '{"user_id":"user456","user_name":"Ani","admin_id":"admin1"}'
api -X POST $BASE/api/chats/crm/current_service_chat -d '{"user_id":"user456"}'
api -X POST $BASE/api/chats/crm/open_promotion_chat -d '{"user_id":"user456","user_name":"Ani"}'
api -X POST $BASE/api/chats/crm/open_inside_sales_chat -d '{"user_id":"user789","user_name":"Dewi","user_referrer_id":"sales1","user_referrer_name":"Sales Satu","admin_id":"admin1","admin_name":"CS Ani"}'
api -X POST $BASE/api/chats/crm/chat/referred -d '{"userReferrerId":"sales1","page":1,"pageSize":20}'
```
Harapan: `create_service_chat` dan panggilan pertama `open_promotion_chat` / `open_inside_sales_chat` membalas `201`. Memanggil `open_promotion_chat` atau `open_inside_sales_chat` lagi membalas `200` (`isNew: false`) dengan chat yang sama. `create_service_chat` yang dipanggil ulang untuk user yang sudah punya chat membalas `200` dengan chat yang sama, untuk `admin_id` mana pun (semua CS boleh membuka chat CS lain). `chat/referred` menampilkan chat milik `sales1`.

**7.7 Upload file**
```bash
api -X POST $BASE/api/chats/crm/chat/upload -d "{\"fileName\":\"test.png\",\"fileDataBase64\":\"$(printf hello | base64)\"}"
api -X POST $BASE/api/chats/crm/chat/upload -d "{\"fileName\":\"test.txt\",\"fileDataBase64\":\"$(printf hello | base64)\"}"
```
Hasil:
- Upload pertama mengembalikan `data.file_url` berbentuk `uploads/chat/<angka>_test.png`. Buka `$BASE/<file_url>` di browser atau lewat `curl`; isinya `hello`.
- Upload kedua ditolak dengan `400`:
  `{ "success": false, "reason": "file_type_not_allowed", "message": "File type not allowed (allowed: jpg, jpeg, png, webp, mp4, mov, pdf)", "maxBytes": 52428800 }`.
  Hanya jpg, jpeg, png, webp, mp4, mov dan pdf yang diterima, dengan ukuran maksimal 50 MB.

**7.8 Menutup chat**
```bash
api -X POST $BASE/api/chats/crm/chat/close -d "{\"chatId\":$CHAT_ID}"
api "$BASE/api/chats/crm/closed?page=1&pageSize=20"
```

## 8. Uji realtime dengan `test.html`

Buka `test.html` **satu kali** di browser. Halaman membagi dua sisi: **App (user)** di kiri dan **CRM (CS)** di kanan, masing-masing dengan koneksi sendiri, plus **Log kejadian** di bawah. Kotak **Langkah berikutnya** di atas selalu menunjukkan apa yang harus dilakukan dan punya tombol untuk langkah itu.

1. Isi Server (`http://localhost:3000`) dan API key bila dipakai, lalu klik tombol di kotak langkah (**Connect keduanya**).
2. Klik **Buat chat** (kolom Chat ID terisi otomatis), lalu **Masuk room (keduanya)**. Kotak langkah berubah hijau: "Semua siap".
3. **CRM:** ketik balasan lalu **Kirim**. Karena pengirimnya admin dan chat masih pending, server mengaktifkan dan meng-assign chat. Kedua sisi menerima pesan (gelembung di kotak Percakapan) dan baris "Admin ditugaskan".
4. **App:** balas. Gelembung muncul di kedua sisi.
5. Tombol lain: **Tugaskan saya**, **Tutup chat**, **Buka promotion**, **Buka inside sales**, **Pending / Active / Closed / Referred / Info chat / Config** (CRM), **Chat saya**, **Belum dibaca**, **Inside sales**, **Muat riwayat**, **Tandai dibaca**, **Kirim file**. Tombol yang belum bisa dipakai tampil redup, dan alasannya muncul saat kursor diarahkan.
6. Hasil REST dan event socket tampil di **Log kejadian**. Klik baris yang panjang untuk melihat lengkapnya, dan pakai filter Chat / Presence / Typing / REST / Error. Kolom **Lanjutan** di kanan atas berisi Referrer ID, halaman, dan jumlah per halaman.
7. Jika pesan tidak kembali dari server dalam 3 detik, halaman menampilkan peringatan (biasanya Chat ID tidak ada di database).

**Tiket CS dan auto-close.** Lanjutkan dari chat yang sudah dibalas CRM:

1. **CRM:** klik **Tutup chat (REST)**. Kedua sisi menampilkan "🔒 Ticket #… is closed (ditutup CS)", dan App menampilkan "Send a message to open a new ticket.".
2. **App:** kirim pesan. Muncul "New ticket #… opened", Chat ID pindah ke tiket baru, dan tiket baru masuk ke daftar Pending di CRM.
3. **CRM:** isi lagi Chat ID tiket lama lalu balas: ditolak dengan "Ditolak: Tiket sudah ditutup".
4. **App:** klik **Thread tiket**: semua tiket tampil sebagai satu percakapan dengan pembatas tiket, dan jamnya jam lokal browser. **CRM:** **Muat riwayat tiket** (kategori Customer Support): satu baris per tiket, dengan PIC.
5. **Auto-close:** perpendek waktunya dulu:

   ```sql
   UPDATE list_chat_config SET config_value = '1' WHERE config_key = 'auto_close_minutes';
   ```

   CRM membalas, lalu App diam. Dalam 1 sampai 2 menit kedua sisi menerima pesan otomatis ("Hi …, since we haven't received a reply…") dan "🔒 Ticket #… is closed". Kembalikan nilainya sesudah itu (`10`, atau `0` untuk mematikan auto-close di development).

## 9. Uji status online (presence)

Server sebaiknya dijalankan dengan `PRESENCE_GRACE_SECONDS=3`. App dan CRM sudah terhubung. Bagian **3. Status online** ada di tiap sisi.

1. **App** otomatis memantau status CS dan Sales begitu terhubung (saklar **Pantau status CS dan Sales** menyala sendiri). Header percakapan App ("Maxco Customer Support") dan lencana di bawahnya menampilkan status tim. Dengan server versi terbaru, status awal `○ Offline` langsung muncul; dengan server lama tetap "Status belum diketahui" sampai ada perubahan atau klik **Cek sekarang**.
2. **CRM:** centang **Saya sedang di menu live chat** (kedua tim terpilih). Header percakapan dan lencana di App berubah menjadi `● Online`.
3. **CRM:** hilangkan centang **Sales** saat menu masih aktif. Lencana Sales di App menjadi `○ offline`, CS tetap online. Hilangkan centang menu live chat: keduanya `○ offline` seketika.
4. **Grace:** CRM nyalakan lagi, lalu klik **Putuskan**. Lencana di App tetap online sekitar 3 detik, lalu offline.
5. **Reconnect tanpa berkedip:** CRM nyalakan, **Putuskan**, cepat klik **Hubungkan ulang** dan nyalakan lagi (dalam 3 detik). Lencana di App tidak boleh sempat offline.
6. **Status user:** biarkan CRM dalam keadaan "di menu live chat". **App:** centang **Saya sedang di layar Live Chat**. Header percakapan CRM ("Budi (user123)") dan lencana "User user123" menjadi `● Online`. Hilangkan centangnya, keduanya menjadi `○ Offline`. Tombol **Cek user** mengambil status lewat REST.
7. **Validasi:** `api "$BASE/api/chats/crm/presence"` tanpa `userIds` membalas `400`, begitu juga lebih dari 100 id.

## 10. Uji typing indicator

1. App dan CRM sudah **Masuk room** untuk Chat ID yang sama (bagian 8, langkah 2).
2. **App:** mulai mengetik di kolom pesan, jangan tekan Kirim. Di header percakapan CRM muncul "Budi sedang mengetik…" dan gelembung titik-titik bergerak di akhir percakapan. Berhenti mengetik 2 detik: keduanya hilang. Pesan dari pihak yang mengetik juga langsung menghilangkannya.
3. Ulangi dari CRM: header App ("Maxco Customer Support") menampilkan "CS Ani sedang mengetik…" dengan titik-titik yang sama.
4. Log menampilkan event `typing` (`isTyping:true`, lalu `false`). Sisi yang mengetik tidak menerima event typing miliknya sendiri.
5. Kalau salah satu sisi belum **Masuk room**, typing tidak dikirim.
6. **Dua CS di satu chat:** buka `test.html` di tab kedua, beri Admin ID dan nama CRM yang berbeda (misalnya `admin2`, "CS Budi"), Connect, lalu **Masuk room** untuk Chat ID yang sama. Mengetik di CRM tab kedua: CRM tab pertama menampilkan "CS Budi sedang mengetik…", dan App menampilkan nama itu juga. Semua CS bisa membalas; tiap gelembung menampilkan nama pengirimnya.

Server tidak menyimpan status typing dan tidak punya timer. Halaman ini meniru client yang benar: mengirim ulang `isTyping:true` tiap sekitar 3 detik selama mengetik, dan menyembunyikan indikator setelah 5 detik tanpa pembaruan.

## 11. Uji API key

1. Isi `CHAT_API_KEY=secret` di `.env.local`, restart server.
2. Di `test.html`, Connect dengan kolom API key kosong: log menampilkan `Gagal terhubung: Invalid API key` dan kotak **Langkah berikutnya** berubah merah. Isi `secret` lalu Connect: berhasil.
3. `curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/client/presence` membalas `401`. Dengan `-H "X-API-Key: secret"` membalas `200`.
4. `/healthz` selalu terbuka tanpa key.

## 12. Uji push notification (opsional)

Butuh service account Firebase (jangan di-commit). Isi di `.env.local`: `FCM_PUSH_ENABLED=true` dan salah satu `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`, `FIREBASE_SERVICE_ACCOUNT_JSON`, atau `FIREBASE_SERVICE_ACCOUNT_FILE`. Restart server.
```bash
api -X POST $BASE/api/chats/devices -d '{"userId":"user123","token":"<token FCM dari app>","platform":"android"}'
```
Kirim pesan sebagai admin ke chat milik `user123` (bagian 8, langkah 3). Log server menampilkan `FCM: chat <id> -> 1/1 delivered`. Push hanya dikirim untuk pesan dari admin. Hapus token dengan `POST /api/chats/devices/unregister` (body `{userId, token}`).

## 13. Masalah umum

- **`Gagal terhubung` atau halaman kosong di `test.html`:** server belum jalan, Server URL salah, API key salah, atau CDN Socket.IO tidak terjangkau (tanpa internet).
- **Peringatan "Pesan belum kembali dari server" atau error `fk_message_chat` di log server:** Chat ID tidak ada di database. Klik **Buat chat** dulu, jangan mengetik Chat ID sembarang.
- **`ER_NO_SUCH_TABLE` atau `ER_BAD_FIELD_ERROR`:** ada file SQL yang belum dijalankan (lihat bagian 2).
- **Pesan terkirim tapi tidak muncul sebagai pesan terakhir di CRM:** pesan harus punya `content_type` 1 (teks) atau 2 (file); `test.html` sudah mengirim 1.
- **Lencana status tidak berubah:** untuk status tim, sisi App harus terhubung dan saklar **Pantau status CS dan Sales** menyala (otomatis saat connect). Untuk status user, sisi CRM harus mencentang **Saya sedang di menu live chat** (itu yang membuat CRM menerima status user).
- **Port 3000 terpakai:** jalankan dengan `PORT=3100 npm run dev:tsx` dan samakan Server URL.
- **Jam pesan di respons REST selisih 7 jam dari WIB:** memang begitu, server mengirim UTC. `test.html` sudah mengubahnya ke jam lokal; app dan CRM juga harus mengubahnya, bukan menampilkan teksnya apa adanya.
- **Status online bertahan agak lama setelah jaringan putus mendadak:** Socket.IO baru mendeteksi koneksi mati setelah sekitar 45 detik (ping), ditambah grace.
