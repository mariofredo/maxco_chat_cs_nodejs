-- ============================================================================
-- 03_dbchanges_202610051115.sql - FCM device-token table for live-chat push
-- Applies to: databases that ALREADY ran 01_schema.sql + 02_migrations.sql
-- (do NOT run 03 on top of an older handover that lacks it, without checking first).
-- New deployments: no manual run needed - docker-entrypoint-initdb.d applies
-- 01 -> 02 -> 03 in order.
-- One-time only: not idempotent (plain CREATE TABLE).
-- ============================================================================

USE `maxco_chat_im`;

CREATE TABLE `list_user_devices` (
	`id` BIGINT NOT NULL AUTO_INCREMENT,
	`user_id` VARCHAR(100) NOT NULL,
	`fcm_token` VARCHAR(1024) NOT NULL,
	`platform` VARCHAR(20) NOT NULL DEFAULT 'android',
	`created_at` TIMESTAMP NOT NULL DEFAULT current_timestamp(),
	`updated_at` TIMESTAMP NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
	PRIMARY KEY (`id`),
	KEY `idx_list_user_devices_user` (`user_id`),
	KEY `idx_list_user_devices_token` (`fcm_token`(191))
)
COLLATE='utf8mb4_general_ci'
;
