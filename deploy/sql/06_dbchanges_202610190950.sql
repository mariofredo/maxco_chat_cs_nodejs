-- ============================================================================
-- 06_dbchanges_202610190950.sql - user_referrer_name (list_chats)
-- Applies to: databases that ALREADY ran 01_schema.sql .. 05_dbchanges_*.sql
-- (for an existing handover, run sql/dbchanges_202610190950.sql instead).
-- New deployments: no manual run needed - docker-entrypoint-initdb.d applies
-- 01 -> 06 in order.
-- One-time only: not idempotent (plain ALTER TABLE).
-- ============================================================================

USE `maxco_chat_im`;

ALTER TABLE list_chats ADD user_referrer_name varchar(100) DEFAULT NULL NULL;
ALTER TABLE list_chats CHANGE user_referrer_name user_referrer_name varchar(100) DEFAULT NULL NULL AFTER user_referrer_id;
