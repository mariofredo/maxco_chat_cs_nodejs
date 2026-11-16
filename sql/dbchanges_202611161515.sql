-- ============================================================================
-- dbchanges_202611161515.sql
-- Perbaikan: satu chat inside sales (category_id = 3) per user.
-- Untuk database yang SUDAH berjalan, terutama yang gagal di
-- dbchanges_202610191417.sql (baris ALTER TABLE ... ADD COLUMN sales_chat_key) dengan
--   ERROR 1215 (HY000): Cannot add foreign key constraint            (MySQL 8)
--   ERROR 1901 (HY000): Function or expression 'category_id' cannot be used ...
-- Database baru cukup menjalankan deploy/sql/01_schema.sql s.d.
-- deploy/sql/10_dbchanges_202611161515.sql (file ini lalu tidak mengubah apa pun).
-- Idempotent: aman dijalankan lebih dari sekali. Backup dulu (mysqldump):
-- langkah 1 menghapus chat inside sales duplikat setelah pesannya dipindahkan.
--
-- Langkah (masing-masing hanya jika perlu):
--   1) buang duplikat chat kategori 3 yang terbuat selama unique index belum ada;
--      per user dipertahankan chat AKTIF terbaru (chat terbaru jika tidak ada
--      yang aktif), pesan chat lain dipindah ke sana, history admin-nya ikut
--      dihapus (sama seperti dbchanges_202610191417.sql),
--   2) foreign key FK_list_chats_list_chat_category dibuat ulang dengan
--      ON UPDATE RESTRICT jika masih CASCADE, dan ditambahkan lagi jika hilang
--      (mis. eksekusi sebelumnya berhenti di antara dua perintahnya),
--   3) tambah kolom generated sales_chat_key,
--   4) tambah unique index uq_list_chats_sales_chat,
--   5) tampilkan hasilnya (harapan: 1, 1, RESTRICT, 0).
-- ============================================================================
USE `maxco_chat_im`;

-- 1) De-duplicate inside sales chats (no-op when there are no duplicates).
--    Kept chat per user: newest active, else newest - the chat the app itself
--    looks up (status = 'active', ORDER BY created_at DESC).
--    user_id carries the list_chats collation explicitly: a database created
--    beforehand on MySQL 8 defaults to utf8mb4_0900_ai_ci (ERROR 1267).
DROP TEMPORARY TABLE IF EXISTS tmp_sales_chat_keep;
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

UPDATE list_messages m
  INNER JOIN list_chats d ON d.id = m.chat_id AND d.category_id = 3
  INNER JOIN tmp_sales_chat_keep k ON k.user_id = d.user_id AND k.keep_id <> d.id
  SET m.chat_id = k.keep_id;

DELETE h
  FROM list_chat_admin_history h
  INNER JOIN list_chats d ON d.id = h.chat_id AND d.category_id = 3
  INNER JOIN tmp_sales_chat_keep k ON k.user_id = d.user_id AND k.keep_id <> d.id;

DELETE d
  FROM list_chats d
  INNER JOIN tmp_sales_chat_keep k ON k.user_id = d.user_id AND k.keep_id <> d.id
  WHERE d.category_id = 3;

DROP TEMPORARY TABLE tmp_sales_chat_keep;

-- 2) Category foreign key: RESTRICT instead of CASCADE / SET NULL / SET DEFAULT.
--    2a) drop it when it still cascades,
SET @fk_needs_fix := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
    AND CONSTRAINT_NAME = 'FK_list_chats_list_chat_category'
    AND UPDATE_RULE IN ('CASCADE', 'SET NULL', 'SET DEFAULT'));
SET @s := IF(@fk_needs_fix > 0,
  'ALTER TABLE list_chats DROP FOREIGN KEY FK_list_chats_list_chat_category',
  'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
--    2b) (re-)add it whenever it is missing - checked again after 2a, so a run
--        that stopped between 2a and 2b is completed by the next run.
SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
    AND CONSTRAINT_NAME = 'FK_list_chats_list_chat_category');
SET @s := IF(@has_fk = 0,
  'ALTER TABLE list_chats ADD CONSTRAINT FK_list_chats_list_chat_category FOREIGN KEY (category_id) REFERENCES list_chat_category (category_id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Generated column: user_id for category 3, NULL otherwise.
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
    AND COLUMN_NAME = 'sales_chat_key');
SET @s := IF(@has_col = 0,
  'ALTER TABLE list_chats ADD COLUMN sales_chat_key VARCHAR(100) GENERATED ALWAYS AS (CASE WHEN category_id = 3 THEN user_id ELSE NULL END) STORED',
  'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Unique index: one inside sales chat per user (NULLs are not duplicates).
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
    AND INDEX_NAME = 'uq_list_chats_sales_chat');
SET @s := IF(@has_idx = 0,
  'ALTER TABLE list_chats ADD UNIQUE KEY uq_list_chats_sales_chat (sales_chat_key)',
  'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) Result. Expected: sales_chat_key_column = 1, unique_index = 1,
--    category_fk_on_update = RESTRICT, users_with_duplicate_sales_chats = 0.
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
      AND COLUMN_NAME = 'sales_chat_key') AS sales_chat_key_column,
  (SELECT COUNT(*) > 0 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
      AND INDEX_NAME = 'uq_list_chats_sales_chat') AS unique_index,
  (SELECT UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
      AND CONSTRAINT_NAME = 'FK_list_chats_list_chat_category') AS category_fk_on_update,
  (SELECT COUNT(*) FROM (
     SELECT user_id FROM list_chats WHERE category_id = 3
     GROUP BY user_id HAVING COUNT(*) > 1) dup) AS users_with_duplicate_sales_chats;
