-- ============================================================================
-- dbchanges_202610191417.sql
-- Satu chat inside sales (category_id = 3) per user:
--   1) buang duplikat yang pernah terbuat oleh dua request "ensure" yang
--      berjalan bersamaan (pesan dan history dialihkan ke chat tertua dulu),
--   2) kunci lewat unique index supaya race condition tidak bisa terulang.
-- Jalankan pada database yang SUDAH berjalan (database baru cukup menjalankan
-- deploy/sql/01_schema.sql s.d. deploy/sql/07_dbchanges_202610191417.sql).
-- Tidak idempotent: jalankan sekali.
-- ============================================================================

-- 1) Chat inside sales tertua (yang dipertahankan) untuk tiap user.
CREATE TEMPORARY TABLE tmp_sales_chat_keep (
	user_id VARCHAR(100) NOT NULL,
	keep_id BIGINT NOT NULL,
	PRIMARY KEY (user_id)
);

INSERT INTO tmp_sales_chat_keep (user_id, keep_id)
SELECT user_id, MIN(id) FROM list_chats WHERE category_id = 3 GROUP BY user_id;

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

-- 5) Kunci di level database: satu user hanya boleh punya satu baris kategori 3.
--    Kolom generated bernilai NULL untuk kategori lain, dan MySQL/MariaDB tidak
--    menganggap NULL sebagai duplikat, jadi chat kategori 1 dan 2 tetap boleh
--    lebih dari satu per user.
ALTER TABLE list_chats
	ADD COLUMN sales_chat_key VARCHAR(100)
GENERATED ALWAYS AS (CASE WHEN category_id = 3 THEN user_id ELSE NULL END) STORED;

ALTER TABLE list_chats
	ADD UNIQUE KEY uq_list_chats_sales_chat (sales_chat_key);
