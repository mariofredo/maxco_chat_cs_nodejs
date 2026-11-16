ALTER TABLE `list_messages`
	ADD COLUMN `content_url` TEXT NULL DEFAULT NULL AFTER `message`;

INSERT INTO `list_content_type` (`content_type_name`) VALUES ('Text');
INSERT INTO `list_content_type` (`content_type_name`) VALUES ('File');

ALTER TABLE `list_messages`
	ADD COLUMN `metadata` JSON NULL DEFAULT NULL AFTER `read_at`;

ALTER TABLE `list_messages`
	CHANGE COLUMN `message` `message` TEXT NULL COLLATE 'utf8mb4_general_ci' AFTER `sender_id`;