# test.html untuk alur tiket, upload, dan akses semua CS: Desain (pendek)

Repo `maxco_chat_cs_nodejs` · 18 Nov 2026

## Maksud

`test.html` adalah halaman uji manual yang memerankan App (user) dan CRM (CS) sekaligus. Halaman ini perlu bisa menguji fitur dari PR #2 (tiket dan auto-close) dan PR #3 (akses semua CS, batas upload 50 MB, filter kategori) tanpa harus menunggu app dan CRM yang asli. Rencana ini sudah disetujui di percakapan.

## Desain

**Sisi App (user)**

- Pesan dengan `sender_type: 'system'` ditampilkan sebagai bubble "Automated message".
- Event `chat_closed` memunculkan garis "Ticket #… is closed" beserta alasannya:
  - "otomatis" untuk `auto_no_reply`,
  - "ditutup CS" untuk `agent`.

  Input tetap aktif. Event `chat_closed` untuk tiket yang bukan tiket aktif hanya dicatat di log.
- `new_message` yang `previous_chat_id`-nya terisi untuk chat Customer Support:
  - Chat ID berpindah ke tiket baru. Server sudah memasukkan socket pengirim ke room baru.
  - Garis "New ticket #… opened" muncul jika `is_new_ticket` bernilai true.
- Tombol "Thread tiket" memanggil `GET /api/client/chat/support-thread/:userId`. Semua tiket digambar sebagai satu thread, dengan urutan:
  - menurut waktu;
  - jika waktunya sama, tiket yang lebih lama didahulukan;
  - di dalam satu tiket: garis opened, lalu pesan, lalu garis closed.

  Jika `current.status = 'closed'`, muncul tambahan "Send a message to open a new ticket.". Chat ID diisi dengan `current.chat_id`.
- Tombol "Chat saya" punya isian kategori (`categoryIds`; kosong berarti semua kategori).
- "Kirim file" mengecek ukuran (maksimal 50 MB) dan ekstensi (jpg, jpeg, png, webp, mp4, mov, pdf) sebelum mengirim, dengan pesan yang sama persis dengan server. Ada opsi "Lewati cek di browser" di pengaturan lanjutan, supaya validasi di server juga bisa diuji.

**Sisi CRM (CS)**

- Pesan `system`, garis closed, dan `send_message_error` tampil di percakapan.
- Tombol "Tutup chat" dipecah menjadi dua: "Tutup chat (socket)" untuk `close_chat`, dan "Tutup chat (REST)" untuk `POST /api/chats/crm/chat/close`.
- Hasil daftar Active ditulis ringkas di log: id, tiket, dan PIC (`admin_name`).

**Kedua sisi**

- `send_message_error` membatalkan peringatan "pesan belum kembali" dan menampilkan `message` dari server. Untuk `chat_closed`, yang ditampilkan adalah "Tiket sudah ditutup; balasan tidak terkirim".

**Dokumen**

- `docs/integration-guide-app.md` §9.3: aturan urutan garis pemisah diganti dengan urutan di atas. Kasus user membalas di detik yang sama dengan auto-close kini benar; ini sudah dibuktikan dengan demo di DB lokal.

## Bukan tujuan

- Memicu auto-close dari browser. Auto-close adalah job di server dan `auto_close_minutes` default-nya 0. Pesan otomatis bisa dilihat lewat "Thread tiket" setelah ada di database.
- Mengubah server atau API.

## Verifikasi

`test.html` dijalankan di browser terhadap server lokal di branch ini. Yang dicek:

- membuat chat;
- balasan CS;
- tutup lewat REST, lalu muncul garis closed di App;
- user membalas, lalu muncul garis tiket baru dan Chat ID berpindah;
- "Thread tiket" (termasuk pesan otomatis yang dibuat lewat `closeIdleChat`);
- file `.exe` ditolak di browser, dan juga ditolak di server saat cek browser dilewati;
- filter kategori;
- tidak ada error di konsol browser.

Data uji memakai user `test-awc-ui` dan dihapus setelah selesai.
