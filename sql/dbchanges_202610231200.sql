-- ============================================================================
-- dbchanges_202610231200.sql - Chat waiting threshold config (key-value)
-- Stores the configurable "max waiting before move" threshold used by both the
-- CRM Flutter app and the chat server (active vs. pending split).
-- Applies to: databases that ALREADY ran 01_schema.sql .. 08_dbchanges_*.sql
-- (for an existing handover, run sql/dbchanges_202610231200.sql instead).
-- New deployments: no manual run needed - docker-entrypoint-initdb.d applies
-- 01 -> 09 in order.
-- One-time only: not idempotent (plain CREATE TABLE / INSERT).
-- ============================================================================

CREATE TABLE `list_chat_config` (
	`config_key` VARCHAR(100) NOT NULL,
	`config_value` VARCHAR(255) NOT NULL,
	`description` VARCHAR(255) NULL DEFAULT NULL,
	`updated_at` TIMESTAMP NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
	PRIMARY KEY (`config_key`)
)
COLLATE='utf8mb4_general_ci'
;

INSERT INTO `list_chat_config` (`config_key`, `config_value`, `description`)
VALUES ('max_waiting_minutes', '120', 'Waiting threshold in minutes before an active chat moves to the waiting list');