ALTER TABLE `list_messages`
	ADD COLUMN `sender_name` VARCHAR(100) NULL AFTER `sender_id`;

ALTER TABLE `list_chats`
	ADD COLUMN `user_name` VARCHAR(100) NULL AFTER `user_id`;