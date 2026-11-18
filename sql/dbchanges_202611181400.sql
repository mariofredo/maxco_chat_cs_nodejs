-- ============================================================================
-- dbchanges_202611181400.sql - automated (system) messages + auto-close config
-- Lets the server store the automated message it sends when it closes an idle
-- Customer Support chat, and adds the two settings of that auto-close.
-- Applies to: databases that ALREADY ran 01_schema.sql .. 09_dbchanges_*.sql
-- (deploy/sql/10_dbchanges_202611181400.sql is the same change for new deployments).
-- One-time only: not idempotent (plain ALTER TABLE / INSERT).
--
-- auto_close_minutes starts at 0 (off). Set it to 10 once the app and the CRM
-- that show automated messages are released; no restart is needed.
-- ============================================================================

ALTER TABLE list_messages
  MODIFY COLUMN sender_type ENUM('user','admin','system') NOT NULL;

INSERT INTO `list_chat_config` (`config_key`, `config_value`, `description`)
VALUES
  ('auto_close_minutes', '0',
   'Minutes without a user reply after an admin message before a Customer Support chat closes automatically. 0 = off'),
  ('auto_close_message',
   'Hi {name}, since we haven''t received a reply from you in the last {minutes} minutes, this chat will now be closed. Please contact us again if you have any further questions.',
   'Automated message when a chat closes automatically. {name} = user name, {minutes} = auto_close_minutes');
