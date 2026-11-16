ALTER TABLE `list_chats`
	ADD COLUMN `admin_name` VARCHAR(100) NULL DEFAULT NULL AFTER `admin_id`;