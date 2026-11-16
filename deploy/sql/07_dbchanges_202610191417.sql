-- ============================================================================
-- 07_dbchanges_202610191417.sql - One inside sales chat (category_id = 3) per user
-- Applies to: databases that ALREADY ran 01_schema.sql .. 06_dbchanges_*.sql
-- (for an existing handover, run sql/dbchanges_202610191417.sql instead).
-- New deployments: no manual run needed - docker-entrypoint-initdb.d applies
-- 01 -> 07 in order.
-- One-time only: not idempotent (plain ALTER TABLE, CREATE TEMPORARY TABLE).
--
-- What it does:
--   1) removes inside sales chats duplicated by two "ensure" requests that
--      ran at the same time (messages and admin history are moved to the
--      oldest chat first),
--   2) adds a unique index so the race cannot happen again.
-- ============================================================================

USE `maxco_chat_im`;

-- 1) Oldest (kept) inside sales chat per user.
CREATE TEMPORARY TABLE tmp_sales_chat_keep (
  user_id VARCHAR(100) NOT NULL,
  keep_id BIGINT NOT NULL,
  PRIMARY KEY (user_id)
);

INSERT INTO tmp_sales_chat_keep (user_id, keep_id)
SELECT user_id, MIN(id) FROM list_chats WHERE category_id = 3 GROUP BY user_id;

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

-- 5) Database-level lock: one row per user for category 3. The generated
--    column is NULL for every other category, and MySQL/MariaDB do not treat
--    NULL as a duplicate, so categories 1 and 2 may still have many rows
--    per user.
ALTER TABLE list_chats
  ADD COLUMN sales_chat_key VARCHAR(100)
GENERATED ALWAYS AS (CASE WHEN category_id = 3 THEN user_id ELSE NULL END) STORED;

ALTER TABLE list_chats
  ADD UNIQUE KEY uq_list_chats_sales_chat (sales_chat_key);
