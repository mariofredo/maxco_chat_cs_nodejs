-- ============================================================================
-- 10_dbchanges_202611181400.sql - automated (system) messages + auto-close config
-- Applies to: databases that ALREADY ran 01_schema.sql .. 09_dbchanges_*.sql
-- (for an existing handover, run sql/dbchanges_202611181400.sql instead).
-- New deployments: no manual run needed - docker-entrypoint-initdb.d applies
-- 01 -> 10 in order.
-- One-time only: not idempotent (plain ALTER TABLE / INSERT).
--
-- What it does:
--   1) list_messages.sender_type also accepts 'system' (the automated message
--      stored when an idle Customer Support chat is closed automatically),
--   2) adds the auto-close settings to list_chat_config:
--        auto_close_minutes  - 0 = off (the shipped value); set it to 10 once
--                              the app and the CRM show automated messages
--        auto_close_message  - message template, {name} and {minutes}
-- ============================================================================

USE `maxco_chat_im`;

ALTER TABLE list_messages
  MODIFY COLUMN sender_type ENUM('user','admin','system') NOT NULL;

INSERT INTO `list_chat_config` (`config_key`, `config_value`, `description`)
VALUES
  ('auto_close_minutes', '0',
   'Minutes without a user reply after an admin message before a Customer Support chat closes automatically. 0 = off'),
  ('auto_close_message',
   'Hi {name}, since we haven''t received a reply from you in the last {minutes} minutes, this chat will now be closed. Please contact us again if you have any further questions.',
   'Automated message when a chat closes automatically. {name} = user name, {minutes} = auto_close_minutes');
