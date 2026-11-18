-- ============================================================================
-- 07_dbchanges_202610191417.sql - One inside sales chat (category_id = 3) per user
-- Applies to: databases that ALREADY ran 01_schema.sql .. 06_dbchanges_*.sql
-- (for an existing handover, run sql/dbchanges_202610191417.sql instead).
-- New deployments: no manual run needed - docker-entrypoint-initdb.d applies
-- 01 -> 07 in order.
-- One-time only: not idempotent (plain ALTER TABLE, CREATE TEMPORARY TABLE).
--
-- What it does:
--   1) removes duplicated inside sales chats: per user the newest ACTIVE chat
--      is kept (the newest chat when none is active), the messages of the
--      others move to it, and their admin history is deleted with them,
--   2) adds a unique index so the race cannot happen again.
-- ============================================================================

USE `maxco_chat_im`;

-- 1) Kept inside sales chat per user: newest active, else newest - the chat
--    the app itself looks up (status = 'active', ORDER BY created_at DESC).
--    user_id carries the list_chats collation explicitly: a database created
--    beforehand on MySQL 8 defaults to utf8mb4_0900_ai_ci (ERROR 1267).
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

-- 2) Move the messages of the duplicates to the kept chat first
--    (required before deleting them: list_messages.chat_id has a foreign key).
UPDATE list_messages m
  INNER JOIN list_chats d ON d.id = m.chat_id AND d.category_id = 3
  INNER JOIN tmp_sales_chat_keep k ON k.user_id = d.user_id AND k.keep_id <> d.id
  SET m.chat_id = k.keep_id;

-- 3) Admin history rows of the duplicates are dropped with them
DELETE h
  FROM list_chat_admin_history h
  INNER JOIN list_chats d ON d.id = h.chat_id AND d.category_id = 3
  INNER JOIN tmp_sales_chat_keep k ON k.user_id = d.user_id AND k.keep_id <> d.id;

-- 4) Delete the duplicate chats
DELETE d
  FROM list_chats d
  INNER JOIN tmp_sales_chat_keep k ON k.user_id = d.user_id AND k.keep_id <> d.id
  WHERE d.category_id = 3;

DROP TEMPORARY TABLE tmp_sales_chat_keep;

-- 5a) MySQL 8 (ERROR 1215) and newer MariaDB, e.g. 10.11 (ERROR 1901), refuse a STORED
--     generated column whose base column has a foreign key with ON UPDATE
--     CASCADE. category_id is the base column below, so its foreign key is
--     re-created with RESTRICT first (the app never changes category ids).
--     Databases where this file already stopped here: run
--     11_dbchanges_202611161515.sql (safe to run more than once).
ALTER TABLE list_chats DROP FOREIGN KEY FK_list_chats_list_chat_category;
ALTER TABLE list_chats
  ADD CONSTRAINT FK_list_chats_list_chat_category FOREIGN KEY (category_id)
  REFERENCES list_chat_category (category_id) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- 5) Database-level lock: one row per user for category 3. The generated
--    column is NULL for every other category, and MySQL/MariaDB do not treat
--    NULL as a duplicate, so categories 1 and 2 may still have many rows
--    per user.
ALTER TABLE list_chats
  ADD COLUMN sales_chat_key VARCHAR(100)
GENERATED ALWAYS AS (CASE WHEN category_id = 3 THEN user_id ELSE NULL END) STORED;

ALTER TABLE list_chats
  ADD UNIQUE KEY uq_list_chats_sales_chat (sales_chat_key);
