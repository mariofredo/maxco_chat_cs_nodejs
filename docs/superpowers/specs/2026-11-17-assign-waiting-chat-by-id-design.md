# Assign chat waiting lewat id chat: Desain (pendek)

Repo `maxco_chat_cs_nodejs` · 17 Nov 2026

## Maksud

Saat CS membalas chat waiting dari CRM, CS pertama yang membalas menjadi PIC dan chat pindah ke Assigned (`status = 'active'`, `admin_id` terisi), di posisi berapa pun chat itu berada di daftar waiting.

Bug yang dilaporkan dari preprod: chat 117 (tiket M5CA-68ZB-78E6). CS 100063 membalas (pesan 686 dan 687), tapi chat tetap `pending`, `admin_id` null, dan `is_just_assigned` false. Daftar waiting saat itu berisi 26 baris dan chat 117 ada di baris 23.

## Penyebab

`sendMessage` ([src/services/chatService.ts](../../../src/services/chatService.ts)) memanggil `fetchPendingChats()` tanpa argumen, sehingga memakai nilai default `page = 1, pageSize = 20`. Lalu ia mengecek apakah chat ada di 20 baris itu. Daftar diurutkan dari yang paling lama menunggu, jadi chat di baris 21 ke atas tidak pernah ter-assign.

Ini bukan efek fitur status online atau typing indicator, karena keduanya tidak mengubah `chatSocket.ts` atau `sendMessage`.

Sudah direplikasi di DB lokal dengan 26 chat pending yang di-seed. Chat di baris 24 tidak ter-assign. Chat kontrol di baris 2 ter-assign.

## Tujuan

- Balasan admin ke chat yang memenuhi syarat waiting selalu meng-assign chat itu, berapa pun panjang daftar waiting.
- Syarat waiting sama persis dengan query daftar waiting (`fetchPendingChats`) dengan filter default:
  - `category_id = 1`,
  - `status IN ('pending', 'active')`,
  - tidak ada pesan admin di chat itu yang lebih baru dari `max_waiting_minutes`.
- Isi `is_just_assigned` dan event `assigned_admin_chat` tetap sama seperti sekarang. Bedanya, keduanya kini benar untuk semua posisi.

## Bukan tujuan

- Tidak mengubah aturan pengambilalihan. Chat active yang balasan CS terakhirnya lebih dari 120 menit tetap bisa diambil alih CS lain yang membalas (perilaku sekarang, dipertahankan).
- Tidak mengubah query daftar waiting, daftar active, atau endpoint CRM.
- Tidak menutup race dua CS yang membalas chat yang sama dalam selisih milidetik. Hasilnya tetap seperti sekarang: CS terakhir yang menimpa.

## Pendekatan

| | Cara | Trade-off |
|---|---|---|
| **A (dipilih)** | Cek by id dengan syarat yang sama dengan daftar waiting, digabung dalam satu `UPDATE` | Perilaku sama dengan hari ini tanpa batas 20 baris. Pengambilalihan chat yang lama tidak dibalas tetap jalan. |
| B | Cek by id, hanya `status = 'pending' AND admin_id IS NULL` | PIC permanen, tapi mengubah perilaku chat active lebih dari 120 menit, dan membuat daftar Active (berdasarkan siapa yang terakhir membalas) tidak sejalan dengan `admin_id`. |
| C | Panggil `fetchPendingChats` dengan page size besar | Tetap ada batas, dan menjalankan query berat di setiap pesan. Dibuang. |

Dipilih A, karena memperbaiki bug tanpa mengubah aturan bisnis yang ada.

## Desain

1. Fungsi baru di `src/services/crmChatService.ts`, di sebelah `fetchPendingChats` (keduanya memakai `getMaxWaitingMinutes`):

   ```ts
   // true jika chat ini masih waiting dan sekarang di-assign ke admin ini
   export async function assignWaitingChat(chatId, adminId, adminName): Promise<boolean>
   ```

   Isinya satu `UPDATE` yang atomik:

   ```sql
   UPDATE list_chats lc
   SET lc.status = 'active', lc.admin_id = ?, lc.admin_name = ?
   WHERE lc.id = ?
     AND lc.category_id = 1
     AND lc.status IN ('pending', 'active')
     AND NOT EXISTS (
       SELECT 1 FROM list_messages m
       WHERE m.chat_id = lc.id AND m.sender_type = 'admin'
         AND m.created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
     )
   ```

   Fungsi mengembalikan `affectedRows > 0`. `NOT EXISTS (... > batas)` setara dengan syarat di daftar, yaitu "pesan admin terakhir NULL atau `<=` batas".

2. Perubahan di `sendMessage`:
   - Hapus `fetchPendingChats()` dan `isChatInPending`.
   - Jika `sender_type === "admin"`, panggil `assignWaitingChat(chat_id, sender_id, sender_name)` sebelum INSERT pesan, seperti urutan sekarang. Urutan ini penting: setelah pesan admin tersimpan, chat sudah tidak lagi waiting.
   - Jika hasilnya `true`, kirim `assigned_admin_chat` ke room seperti sekarang.
   - `is_just_assigned` diisi dari hasil tersebut.
   - Pesan dari user tidak lagi menjalankan query daftar waiting.

3. Import `fetchPendingChats` di `chatService.ts` dihapus. Pemanggil lain (controller daftar CRM) tidak berubah.

## Verifikasi

Script replikasi dijalankan ulang terhadap DB lokal (seed 26 chat `REPRO-`, lalu dihapus). Kasus yang dicek:

- Chat di baris lebih dari 20 ter-assign: `is_just_assigned = true`, status `active`, `admin_id` = pengirim, event dikirim.
- Chat di baris 20 ke bawah ter-assign seperti sebelumnya.
- Pesan dari user tidak meng-assign.
- Chat active yang punya balasan admin kurang dari 120 menit tidak diambil alih oleh admin lain: `is_just_assigned = false`, `admin_id` tetap.
- Chat kategori lain (promotion atau inside sales) tidak ter-assign.

Ditambah `npm test` (46 tes yang ada) dan `npx tsc --noEmit`.

## Diserahkan ke pembuat

- Apakah perlu tes otomatis untuk `assignWaitingChat`. Tes yang ada tidak memakai DB, jadi tes ini butuh pool palsu atau DB uji.
