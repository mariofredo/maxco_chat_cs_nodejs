# Semua CS bisa melihat dan membalas chat, serta batas upload 50 MB: Desain (pendek)

Repo `maxco_chat_cs_nodejs` · 18 Nov 2026

## Maksud

Dua masukan dari review live chat:

- **(c) PIC hanya formalitas.** Setiap CS harus bisa melihat dan membalas chat mana pun, termasuk chat yang sedang dipegang CS lain.
- **(d) Upload gambar/video dibatasi 50 MB.** Kalau melewati batas, pesan error harus jelas. Sekarang server tidak memvalidasi apa pun, dan app hanya menampilkan "something went wrong".

## Kondisi sekarang

**(c)** Backend sebenarnya sudah mengizinkan CS mana pun membaca chat (`crm/messages`) dan membalasnya. Balasan dari CS lain tidak mengambil alih chat dalam jendela `max_waiting_minutes`. Ada dua hal yang menghalangi:

- Daftar Assigned (`fetchActiveChats`, `crmChatService.ts`) hanya berisi chat yang balasan admin terakhirnya dari CS yang sedang login (`sender_id = adminId`). Akibatnya, chat yang sedang dipegang CS A tidak muncul untuk CS B, baik di Assigned maupun di Waiting.
- `POST /api/chats/crm/create_service_chat` mengembalikan `401 "Chat already assigned to another admin"` kalau chat itu dipegang admin lain.

**(d)**
- `saveChatFile` menulis file dengan ukuran dan jenis apa pun.
- File dikirim sebagai base64, yang ukurannya sekitar +33% dari file aslinya.
- Batas socket `maxHttpBufferSize: 5e7` berarti 50 MB base64, setara file sekitar 37,5 MB. Kalau lewat, Socket.IO memutus koneksi tanpa pesan apa pun.
- Lewat REST (`/crm/chat/upload`), express membalas 413 dengan halaman error bawaan, bukan JSON.
- `fileName` langsung dipakai di path file, sehingga nama seperti `../x` bisa menulis file di luar `uploads/chat`.

## Pendekatan

**(c)** Daftar Assigned menampilkan semua chat yang sedang ditangani CS mana pun. Kolom `admin_id` / `admin_name` (PIC) sudah ikut di setiap baris. Opsi lain adalah tab "All" terpisah, tetapi itu butuh endpoint dan UI baru di CRM; kami pilih yang tidak mengubah UI.

**(d)** Validasi dilakukan di server di satu tempat, yaitu `saveChatFile`. Validasi ini dipakai oleh dua jalur: socket `send_message` dan REST `/crm/chat/upload`. Batas buffer dinaikkan secukupnya agar file 50 MB dalam bentuk base64 bisa lewat. App dan CRM tetap perlu mengecek ukuran sebelum encode, karena payload yang jauh melebihi batas tetap diputus oleh Socket.IO.

## Desain

**(c)**

1. `fetchActiveChats`: hapus filter `sender_id = adminId`. Ukurannya menjadi balasan admin terakhir dari CS mana pun dalam jendela `max_waiting_minutes`. Ini aturan yang sama dengan sisi "assigned" di `assignedUserChatData`.
   - Kolom `last_message_admin*` sekarang berarti balasan terakhir dari CS mana pun.
   - Parameter `adminId` tetap diterima tetapi tidak lagi memfilter, supaya CRM lama tidak error.
2. `createUserServiceChat`: hapus cabang 401. Chat yang sudah ada dikembalikan ke admin mana pun.
3. Aturan assign dan pengambilalihan (`assignWaitingChat`) tidak berubah.

**(d)**

1. Konstanta `MAX_UPLOAD_BYTES = 50 * 1024 * 1024`.
2. Ekstensi yang diizinkan: `jpg`, `jpeg`, `png`, `webp`, `mp4`, `mov`, ditambah **`pdf`**. PDF ditambahkan karena mockup app meminta bukti transfer "A photo or PDF both work". Pemeriksaannya tidak membedakan huruf besar/kecil.
3. `saveChatFile` melakukan pengecekan berikut:
   - Membuang path dari nama file (memakai basename dan hanya mengizinkan karakter `[A-Za-z0-9._-]`).
   - Menolak ekstensi yang tidak diizinkan.
   - Memperkirakan ukuran dari panjang base64 sebelum decode, lalu mengecek ukuran asli setelah decode.
   - Jika gagal, melempar `FileUploadError` dengan `reason` `'file_too_large'` atau `'file_type_not_allowed'`.
4. Socket `send_message`: kalau terjadi `FileUploadError`, kirim `send_message_error { chat_id, reason, maxBytes }` hanya ke socket pengirim. Pesan tidak disimpan. Ini event yang sama dengan PR #2.
5. REST `/crm/chat/upload`: kalau terjadi `FileUploadError`, balas 400 dengan `{ success: false, reason, message, maxBytes }`. Kalau body melebihi batas express, balas 413 dalam bentuk JSON dengan `reason: 'file_too_large'`, lewat middleware error.
6. Batas transport:
   - Socket `maxHttpBufferSize` dan `express.json` dinaikkan ke 72 MiB, cukup untuk 50 MiB dalam base64 (sekitar 66,7 MiB) plus field JSON.
   - Baris `express.json` dan `urlencoded` yang duplikat di `app.ts` dirapikan.
7. Tes:
   - Unit test untuk validasi nama file, jenis, dan ukuran.
   - DB test untuk `fetchActiveChats`: chat yang dibalas CS lain ikut muncul.
   - DB test: `create_service_chat` tidak lagi 401.

## Tambahan: filter kategori di daftar chat user

`GET /api/chats/user/:userId` dan `POST /api/chats/user` mengembalikan semua chat milik user dari semua kategori, termasuk setiap tiket CS yang sudah closed. App yang ingin menampilkan daftar tiket CS harus menyaringnya sendiri.

- Tambahkan parameter opsional `categoryIds`:
  - GET: lewat query string, misalnya `?categoryIds=1` atau `?categoryIds=1,2`.
  - POST: lewat body, sebagai string `"1,2"` atau array `[1, 2]`.
- Kalau parameter ini tidak dikirim, kosong, atau tidak valid, semua kategori dikembalikan (perilaku sekarang). Jadi pemanggil lama tidak berubah.
- Filter berlaku untuk daftar chat sekaligus untuk `pagination.total`.

## Dampak ke app dan CRM

- **CRM:**
  - Tab Assigned sekarang berisi chat milik semua CS. Tampilkan nama PIC (`admin_name`).
  - Jangan kunci input berdasarkan PIC, kalau sekarang CRM melakukannya.
  - Tangani `send_message_error` untuk `file_too_large` dan `file_type_not_allowed`.
- **App:** cek ukuran (maks 50 MB) dan jenis file sebelum encode base64, lalu tampilkan pesan yang jelas. Tangani juga `send_message_error`.

## Bukan tujuan

- Mengganti upload base64 dengan multipart. Ini lebih baik untuk jangka panjang, tetapi mengubah kontrak.
- Memeriksa isi file (magic bytes). Saat ini cek hanya berdasarkan ekstensi.
- Masalah timing (a). Menunggu data dari preprod.
