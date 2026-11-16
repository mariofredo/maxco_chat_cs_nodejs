-- ============================================================================
-- 01_schema.sql - Maxco Chat CS base schema
-- Source  : sql/clean_slate_20251216.sql (schema dump, 16 Dec 2025)
-- Target  : MySQL 8.0 / MariaDB 10.4+
-- Purpose : create the database + the 4 base tables from an empty state.
-- Run     : mysql -h <host> -u <user> -p < 01_schema.sql
--           (the database name must match MYSQLDATABASE in .env)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `maxco_chat_im`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `maxco_chat_im`;

-- --------------------------------------------------------
-- Host:                         127.0.0.1
-- Server version:               10.4.32-MariaDB - mariadb.org binary distribution
-- Server OS:                    Win64
-- HeidiSQL Version:             12.5.0.6677
-- --------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

-- Dumping structure for table maxco_chat_im.list_chats
CREATE TABLE IF NOT EXISTS `list_chats` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `chat_ticket` varchar(50) DEFAULT NULL,
  `user_id` varchar(100) NOT NULL,
  `admin_id` varchar(100) DEFAULT NULL,
  `status` enum('pending','active','closed') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `closed_at` timestamp NULL DEFAULT NULL,
  `department_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=46 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Data exporting was unselected.

-- Dumping structure for table maxco_chat_im.list_chat_admin_history
CREATE TABLE IF NOT EXISTS `list_chat_admin_history` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `chat_id` bigint(20) NOT NULL,
  `admin_id` varchar(100) NOT NULL,
  `assigned_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `unassigned_at` timestamp NULL DEFAULT NULL,
  `redirect_to_department_id` int(11) DEFAULT NULL,
  `redirect_date` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_history_chat` (`chat_id`),
  CONSTRAINT `fk_history_chat` FOREIGN KEY (`chat_id`) REFERENCES `list_chats` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Data exporting was unselected.

-- Dumping structure for table maxco_chat_im.list_content_type
CREATE TABLE IF NOT EXISTS `list_content_type` (
  `content_type_id` int(11) NOT NULL AUTO_INCREMENT,
  `content_type_name` varchar(100) NOT NULL,
  PRIMARY KEY (`content_type_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- REQUIRED seed: the application uses content_type_id 1 = Text, 2 = File.
-- Without these rows, INSERT into list_messages fails (foreign key) and the CRM
-- message list stays empty (INNER JOIN).
INSERT INTO `list_content_type` (`content_type_id`, `content_type_name`) VALUES (1, 'Text'), (2, 'File');

CREATE TABLE IF NOT EXISTS `list_messages` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `chat_id` bigint(20) NOT NULL,
  `sender_type` enum('user','admin') NOT NULL,
  `sender_id` varchar(100) NOT NULL,
  `message` text DEFAULT NULL,
  `content_url` text DEFAULT NULL,
  `content_type` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `read_at` timestamp NULL DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  PRIMARY KEY (`id`),
  KEY `fk_message_chat` (`chat_id`),
  KEY `FK_list_messages_list_content_type` (`content_type`),
  CONSTRAINT `FK_list_messages_list_content_type` FOREIGN KEY (`content_type`) REFERENCES `list_content_type` (`content_type_id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_message_chat` FOREIGN KEY (`chat_id`) REFERENCES `list_chats` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=211 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Data exporting was unselected.

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;

