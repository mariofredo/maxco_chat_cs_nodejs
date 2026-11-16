-- ============================================================================
-- 08_dbchanges_202610221020.sql - indexes for the client app pagination
-- Applies to: databases that ALREADY ran 01_schema.sql .. 07_dbchanges_*.sql
-- (for an existing handover, run sql/dbchanges_202610221020.sql instead).
-- New deployments: no manual run needed - docker-entrypoint-initdb.d applies
-- 01 -> 08 in order.
-- One-time only: not idempotent (plain CREATE INDEX).
--
-- Why:
--   The client app (mobile / web for the client) now loads its chat list and
--   its chat messages page by page. Without these indexes every page of the
--   list scans the whole list_chats table, and the message query sorts the
--   whole history of the chat before cutting out one page.
--
-- What it does:
--   1) idx_list_chats_user_id        - the chat list of one member
--                                       (WHERE user_id = ?)
--   2) idx_list_messages_chat_created - the messages of one chat, newest
--                                       first (WHERE chat_id = ? ORDER BY
--                                       created_at DESC, id DESC)
-- ============================================================================

-- 1) Chat list of one member (client app list + CRM user chats).
ALTER TABLE list_chats
  ADD KEY idx_list_chats_user_id (user_id);

-- 2) Messages of one chat, newest first. `id` is the tiebreaker of the
--    ordering (created_at has a one second precision).
ALTER TABLE list_messages
  ADD KEY idx_list_messages_chat_created (chat_id, created_at, id);
