-- ============================================================================
-- schema.sql - Maxco Chat CS database structure
-- Server : MySQL 8.0 (also runs on MariaDB 10.4+)
-- Creates: database `maxco_chat_im`, its 7 tables, and the reference rows the
--          app needs (content types, chat categories, config).
-- Run    : mysql -h <host> -u <user> -p < schema.sql
--          Run it on a server that does not have these tables yet: it never
--          drops anything, so it stops with "Table ... already exists" there.
-- Column meanings and rules for importing data: DATABASE.md
-- ============================================================================

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `maxco_chat_im` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;

USE `maxco_chat_im`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `list_chat_admin_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `chat_id` bigint NOT NULL,
  `admin_id` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `assigned_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `unassigned_at` timestamp NULL DEFAULT NULL,
  `redirect_to_department_id` int DEFAULT NULL,
  `redirect_date` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_history_chat` (`chat_id`),
  CONSTRAINT `fk_history_chat` FOREIGN KEY (`chat_id`) REFERENCES `list_chats` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `list_chat_category` (
  `category_id` int NOT NULL AUTO_INCREMENT,
  `category_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  PRIMARY KEY (`category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `list_chat_config` (
  `config_key` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `config_value` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `list_chats` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `chat_ticket` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `category_id` int NOT NULL,
  `user_id` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `user_name` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `user_referrer_id` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `user_referrer_name` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `admin_id` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `admin_name` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('pending','active','closed') COLLATE utf8mb4_general_ci DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` timestamp NULL DEFAULT NULL,
  `department_id` int DEFAULT NULL,
  `sales_chat_key` varchar(100) COLLATE utf8mb4_general_ci GENERATED ALWAYS AS ((case when (`category_id` = 3) then `user_id` else NULL end)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_list_chats_sales_chat` (`sales_chat_key`),
  KEY `FK_list_chats_list_chat_category` (`category_id`),
  KEY `idx_list_chats_user_id` (`user_id`),
  CONSTRAINT `FK_list_chats_list_chat_category` FOREIGN KEY (`category_id`) REFERENCES `list_chat_category` (`category_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=46 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `list_content_type` (
  `content_type_id` int NOT NULL AUTO_INCREMENT,
  `content_type_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  PRIMARY KEY (`content_type_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `list_messages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `chat_id` bigint NOT NULL,
  `sender_type` enum('user','admin') COLLATE utf8mb4_general_ci NOT NULL,
  `sender_id` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `sender_name` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `message` text COLLATE utf8mb4_general_ci,
  `content_url` text COLLATE utf8mb4_general_ci,
  `content_type` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `read_at` timestamp NULL DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY (`id`),
  KEY `fk_message_chat` (`chat_id`),
  KEY `FK_list_messages_list_content_type` (`content_type`),
  KEY `idx_list_messages_chat_created` (`chat_id`,`created_at`,`id`),
  CONSTRAINT `FK_list_messages_list_content_type` FOREIGN KEY (`content_type`) REFERENCES `list_content_type` (`content_type_id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_message_chat` FOREIGN KEY (`chat_id`) REFERENCES `list_chats` (`id`),
  CONSTRAINT `list_messages_chk_1` CHECK (json_valid(`metadata`))
) ENGINE=InnoDB AUTO_INCREMENT=211 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `list_user_devices` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `fcm_token` varchar(1024) COLLATE utf8mb4_general_ci NOT NULL,
  `platform` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'android',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_list_user_devices_user` (`user_id`),
  KEY `idx_list_user_devices_token` (`fcm_token`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

LOCK TABLES `list_content_type` WRITE;
/*!40000 ALTER TABLE `list_content_type` DISABLE KEYS */;
INSERT INTO `list_content_type` (`content_type_id`, `content_type_name`) VALUES (1,'Text');
INSERT INTO `list_content_type` (`content_type_id`, `content_type_name`) VALUES (2,'File');
/*!40000 ALTER TABLE `list_content_type` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `list_chat_category` WRITE;
/*!40000 ALTER TABLE `list_chat_category` DISABLE KEYS */;
INSERT INTO `list_chat_category` (`category_id`, `category_name`) VALUES (1,'Customer Service');
INSERT INTO `list_chat_category` (`category_id`, `category_name`) VALUES (2,'Announcement');
INSERT INTO `list_chat_category` (`category_id`, `category_name`) VALUES (3,'Inside Sales');
/*!40000 ALTER TABLE `list_chat_category` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `list_chat_config` WRITE;
/*!40000 ALTER TABLE `list_chat_config` DISABLE KEYS */;
INSERT INTO `list_chat_config` (`config_key`, `config_value`, `description`) VALUES ('max_waiting_minutes','120','Waiting threshold in minutes before an active chat moves to the waiting list');
/*!40000 ALTER TABLE `list_chat_config` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

