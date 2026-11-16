-- ============================================================================
-- 02_migrations.sql - schema changes applied after clean_slate_20251216
-- Only contains the migrations NOT already in 01_schema.sql, in a safe order.
-- Not idempotent: run once against a fresh database.
-- ============================================================================

USE `maxco_chat_im`;

-- ---- dbchanges_202502061600.sql : sender_name (list_messages), user_name (list_chats)
ALTER TABLE `list_messages`
	ADD COLUMN `sender_name` VARCHAR(100) NULL AFTER `sender_id`;

ALTER TABLE `list_chats`
	ADD COLUMN `user_name` VARCHAR(100) NULL AFTER `user_id`;

-- ---- dbchanges_202602211226.sql : admin_name (list_chats)
ALTER TABLE `list_chats`
	ADD COLUMN `admin_name` VARCHAR(100) NULL DEFAULT NULL AFTER `admin_id`;

-- ---- dbchanges_202603090944.sql : tabel list_chat_category + category_id (list_chats) + seed kategori
CREATE TABLE `list_chat_category` (
	`category_id` INT NOT NULL AUTO_INCREMENT,
	`category_name` VARCHAR(100) NOT NULL,
	PRIMARY KEY (`category_id`)
)
COLLATE='utf8mb4_general_ci'
;

INSERT INTO `list_chat_category` (`category_name`) VALUES ('Customer Service');
INSERT INTO `list_chat_category` (`category_name`) VALUES ('Announcement');


ALTER TABLE `list_chats`
	ADD COLUMN `category_id` INT NOT NULL DEFAULT '1' AFTER `chat_ticket`,
	ADD CONSTRAINT `FK_list_chats_list_chat_category` FOREIGN KEY (`category_id`) REFERENCES `list_chat_category` (`category_id`) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE `list_chats`
	CHANGE COLUMN `category_id` `category_id` INT(11) NOT NULL AFTER `chat_ticket`;
