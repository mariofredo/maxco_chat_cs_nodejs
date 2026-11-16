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