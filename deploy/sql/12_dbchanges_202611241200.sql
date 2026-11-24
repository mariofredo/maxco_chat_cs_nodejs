-- ============================================================================
-- 12_dbchanges_202611241200.sql - One ACTIVE inside sales chat (category_id = 3) per user
-- The unique index uq_list_chats_sales_chat (made by 11) counts only chats with
-- status = 'active': a closed inside sales chat stays as history next to a new
-- active one (the same member with another sales person).
-- Applies to: ANY database that ran 01_schema.sql .. 11_dbchanges_*.sql
-- (for an existing handover, run sql/dbchanges_202611241200.sql instead).
-- New deployments: no manual run needed - docker-entrypoint-initdb.d applies
-- 01 -> 12 in order.
-- Idempotent: safe to run more than once. It deletes nothing, but it rebuilds
-- list_chats once (writes to it wait until done): stop the app while it runs.
--
-- What it does (only when needed):
--   1) changes the generated column sales_chat_key to
--      user_id WHEN category_id = 3 AND status = 'active' (NULL otherwise), so the
--      unique index on it no longer counts closed or pending chats. Existing rows
--      already satisfy this index. Nothing happens when the column is missing
--      (11 creates it); the result below shows it,
--   2) prints the resulting state (expected: 1, 1, 0).
-- ============================================================================
USE `maxco_chat_im`;

-- 1) sales_chat_key: user_id only for ACTIVE category 3 chats. No collation is
--    named, as in 11.
SET @needs_change := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
    AND COLUMN_NAME = 'sales_chat_key'
    AND GENERATION_EXPRESSION NOT LIKE '%active%');
SET @s := IF(@needs_change > 0,
  'ALTER TABLE list_chats MODIFY COLUMN sales_chat_key VARCHAR(100) GENERATED ALWAYS AS (CASE WHEN category_id = 3 AND status = ''active'' THEN user_id ELSE NULL END) STORED',
  'DO 0');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Result. Expected: sales_chat_key_active_only = 1, unique_index = 1,
--    users_with_two_active_sales_chats = 0.
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
      AND COLUMN_NAME = 'sales_chat_key'
      AND GENERATION_EXPRESSION LIKE '%active%') AS sales_chat_key_active_only,
  (SELECT COUNT(*) > 0 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats'
      AND INDEX_NAME = 'uq_list_chats_sales_chat') AS unique_index,
  (SELECT COUNT(*) FROM (
     SELECT user_id FROM list_chats WHERE category_id = 3 AND status = 'active'
     GROUP BY user_id HAVING COUNT(*) > 1) dup) AS users_with_two_active_sales_chats;
