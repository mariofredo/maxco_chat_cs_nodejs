-- ============================================================================
-- dbchanges_202610051115.sql
-- Tabel device token FCM untuk push notification live chat client.
-- Jalankan pada database yang SUDAH berjalan (database baru cukup menjalankan
-- deploy/sql/01_schema.sql lalu deploy/sql/02_migrations.sql).
-- ============================================================================

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
