-- ============================================================================
-- dbchanges_202610191417.sql
-- Satu chat inside sales (category_id = 3) per user:
--   1) buang duplikat chat inside sales: per user dipertahankan chat AKTIF
--      terbaru (chat terbaru jika tidak ada yang aktif), pesan chat lain
--      dipindah ke sana, history admin-nya ikut dihapus,
--   2) kunci lewat unique index supaya race condition tidak bisa terulang.
-- Jalankan pada database yang SUDAH berjalan (database baru cukup menjalankan
-- deploy/sql/01_schema.sql s.d. deploy/sql/07_dbchanges_202610191417.sql).
-- Tidak idempotent: jalankan sekali.
-- ============================================================================

-- 1) Chat inside sales yang dipertahankan per user: aktif terbaru, kalau tidak
--    ada maka terbaru - chat yang juga dicari aplikasi (status = 'active',
--    ORDER BY created_at DESC). Collation user_id ditulis eksplisit: database
--    yang dibuat lebih dulu di MySQL 8 memakai utf8mb4_0900_ai_ci (ERROR 1267).
CREATE TEMPORARY TABLE tmp_sales_chat_keep (
	user_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
	keep_id BIGINT NOT NULL,
	PRIMARY KEY (user_id)
);

INSERT INTO tmp_sales_chat_keep (user_id, keep_id)
SELECT c.user_id,
	(SELECT k.id FROM list_chats k
	  WHERE k.user_id = c.user_id AND k.category_id = 3
	  ORDER BY (k.status = 'active') DESC, k.created_at DESC, k.id DESC
	  LIMIT 1)
FROM list_chats c
WHERE c.category_id = 3
GROUP BY c.user_id;

-- 2) Pesan dari chat duplikat dipindahkan ke chat yang dipertahankan
--    (wajib sebelum chat duplikat dihapus: ada foreign key list_messages ->
--    list_chats).
UPDATE list_messages m
	INNER JOIN list_chats d ON d.id = m.chat_id AND d.category_id = 3
	INNER JOIN tmp_sales_chat_keep k ON k.user_id = d.user_id AND k.keep_id <> d.id
	SET m.chat_id = k.keep_id;

-- 3) History admin milik chat duplikat ikut dihapus
DELETE h
	FROM list_chat_admin_history h
	INNER JOIN list_chats d ON d.id = h.chat_id AND d.category_id = 3
	INNER JOIN tmp_sales_chat_keep k ON k.user_id = d.user_id AND k.keep_id <> d.id;

-- 4) Buang chat duplikatnya
DELETE d
	FROM list_chats d
	INNER JOIN tmp_sales_chat_keep k ON k.user_id = d.user_id AND k.keep_id <> d.id
	WHERE d.category_id = 3;

DROP TEMPORARY TABLE tmp_sales_chat_keep;

-- 5a) MySQL 8 (ERROR 1215) dan MariaDB yang lebih baru, mis. 10.11 (ERROR 1901), menolak kolom
--     generated STORED yang kolom dasarnya punya foreign key ON UPDATE CASCADE.
--     category_id adalah kolom dasar di bawah, jadi foreign key-nya dibuat ulang
--     dengan RESTRICT dulu (aplikasi tidak pernah mengubah category id).
--     Database yang sudah gagal di titik ini: jalankan
--     dbchanges_202611161515.sql (aman dijalankan lebih dari sekali).
ALTER TABLE list_chats DROP FOREIGN KEY FK_list_chats_list_chat_category;
ALTER TABLE list_chats
	ADD CONSTRAINT FK_list_chats_list_chat_category FOREIGN KEY (category_id)
	REFERENCES list_chat_category (category_id) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- 5) Kunci di level database: satu user hanya boleh punya satu baris kategori 3.
--    Kolom generated bernilai NULL untuk kategori lain, dan MySQL/MariaDB tidak
--    menganggap NULL sebagai duplikat, jadi chat kategori 1 dan 2 tetap boleh
--    lebih dari satu per user.
ALTER TABLE list_chats
	ADD COLUMN sales_chat_key VARCHAR(100)
GENERATED ALWAYS AS (CASE WHEN category_id = 3 THEN user_id ELSE NULL END) STORED;

ALTER TABLE list_chats
	ADD UNIQUE KEY uq_list_chats_sales_chat (sales_chat_key);
