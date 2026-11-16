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

-- Dumping data for table maxco_chat_im.list_chats: ~15 rows (approximately)
INSERT INTO `list_chats` (`id`, `chat_ticket`, `user_id`, `admin_id`, `status`, `created_at`, `closed_at`, `department_id`) VALUES
	(1, '343534523452345', 'user123', NULL, 'active', '2025-09-26 03:25:57', NULL, NULL),
	(2, '657456754675464', 'user123', NULL, 'active', '2025-09-26 06:49:36', NULL, NULL),
	(3, '34523426542', 'user456', NULL, 'active', '2025-09-26 06:49:44', NULL, NULL),
	(4, '435634563456', 'user123', NULL, 'active', '2025-09-29 08:06:03', NULL, NULL),
	(5, '234534524355432', 'user123', NULL, 'active', '2025-11-13 09:50:18', NULL, NULL),
	(6, '5467654786867', 'user123', NULL, 'active', '2025-11-13 09:51:30', NULL, NULL),
	(7, '34563456245', 'user34232423', NULL, 'active', '2025-11-13 09:51:34', NULL, NULL),
	(8, '2423454326537', '974120', NULL, '', '2025-11-14 04:05:37', NULL, NULL),
	(9, '12343254354654', 'user123', NULL, 'active', '2025-11-14 04:13:43', NULL, NULL),
	(10, '84675463345634', 'user123', NULL, 'active', '2025-11-14 04:14:52', NULL, NULL),
	(11, '5436576845676', '974120', NULL, '', '2025-11-14 04:19:42', NULL, NULL),
	(12, '34565765335', '974120', NULL, 'closed', '2025-11-14 04:19:45', NULL, NULL),
	(37, '5437687658657', '974120', NULL, 'closed', '2025-11-26 09:00:21', NULL, NULL),
	(44, '942939621198941', '974120', NULL, 'pending', '2025-12-02 02:49:48', NULL, NULL),
	(45, '142416645872294', '974120', NULL, 'pending', '2025-12-02 03:30:58', NULL, NULL);

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

-- Dumping data for table maxco_chat_im.list_chat_admin_history: ~0 rows (approximately)

-- Dumping structure for table maxco_chat_im.list_content_type
CREATE TABLE IF NOT EXISTS `list_content_type` (
  `content_type_id` int(11) NOT NULL AUTO_INCREMENT,
  `content_type_name` varchar(100) NOT NULL,
  PRIMARY KEY (`content_type_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Dumping data for table maxco_chat_im.list_content_type: ~2 rows (approximately)
INSERT INTO `list_content_type` (`content_type_id`, `content_type_name`) VALUES
	(1, 'Text'),
	(2, 'File');

-- Dumping structure for table maxco_chat_im.list_messages
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

-- Dumping data for table maxco_chat_im.list_messages: ~115 rows (approximately)
INSERT INTO `list_messages` (`id`, `chat_id`, `sender_type`, `sender_id`, `message`, `content_url`, `content_type`, `created_at`, `read_at`, `metadata`) VALUES
	(3, 1, 'user', 'user123', 'aadsa', NULL, NULL, '2025-09-26 03:35:39', NULL, NULL),
	(4, 1, 'user', 'user456', 'faadd', NULL, NULL, '2025-09-26 06:49:54', NULL, NULL),
	(5, 1, 'user', 'user123', 'halo bang', NULL, NULL, '2025-09-26 06:50:15', NULL, NULL),
	(6, 1, 'user', 'user456', 'saya sappol', NULL, NULL, '2025-09-26 06:50:35', NULL, NULL),
	(7, 1, 'user', 'user456', 'hbsdfgsda', NULL, NULL, '2025-09-26 08:58:03', NULL, NULL),
	(8, 1, 'user', 'user456', 'sdnalfnasd', NULL, NULL, '2025-09-26 08:58:05', NULL, NULL),
	(9, 1, 'user', 'user456', 'aaas', NULL, NULL, '2025-09-26 08:58:10', NULL, NULL),
	(10, 1, 'user', 'user456', 's', NULL, NULL, '2025-09-26 08:58:12', NULL, NULL),
	(11, 1, 'user', 'user456', 'aaafafasfa', NULL, NULL, '2025-09-26 08:59:06', NULL, NULL),
	(12, 1, 'admin', 'user123', 'tes', NULL, NULL, '2025-11-13 09:50:40', NULL, NULL),
	(13, 1, 'admin', 'user123', 'test', NULL, NULL, '2025-11-13 09:51:59', NULL, NULL),
	(15, 8, 'user', 'user123', 'test', NULL, NULL, '2025-11-14 04:16:17', NULL, NULL),
	(16, 8, 'user', '974120', 'test', NULL, NULL, '2025-11-14 04:19:19', NULL, NULL),
	(18, 12, 'user', '974120', 'halo', NULL, NULL, '2025-11-14 04:21:05', NULL, NULL),
	(19, 12, 'admin', 'admin123', 'Halo saya admin', NULL, NULL, '2025-11-14 04:26:53', NULL, NULL),
	(20, 12, 'admin', 'admin123', 'Ada yang bisa dibantu?', NULL, NULL, '2025-11-14 04:27:08', NULL, NULL),
	(21, 12, 'user', '974120', 'Test min chat cs', NULL, NULL, '2025-11-14 04:28:16', NULL, NULL),
	(22, 12, 'admin', 'admin123', 'boleeee', NULL, NULL, '2025-11-14 09:09:53', NULL, NULL),
	(23, 12, 'user', '974120', 'halo', NULL, NULL, '2025-11-14 09:10:49', NULL, NULL),
	(24, 12, 'user', '974120', 'tes', NULL, NULL, '2025-11-14 09:15:39', NULL, NULL),
	(25, 12, 'user', '974120', 'tes', NULL, NULL, '2025-11-14 09:16:04', NULL, NULL),
	(26, 12, 'user', '974120', 'test lagi', NULL, NULL, '2025-11-14 09:49:01', NULL, NULL),
	(27, 12, 'user', '974120', 'lagi', NULL, NULL, '2025-11-14 09:49:40', NULL, NULL),
	(28, 12, 'user', '974120', 'tes', NULL, NULL, '2025-11-14 10:06:53', NULL, NULL),
	(29, 12, 'user', '974120', 'tes', NULL, NULL, '2025-11-21 02:41:54', NULL, NULL),
	(30, 12, 'user', '974120', 'cek', NULL, NULL, '2025-11-21 03:40:38', NULL, NULL),
	(31, 12, 'user', '974120', 'test', NULL, NULL, '2025-11-21 03:42:12', NULL, NULL),
	(33, 12, 'user', '974120', 'halo', NULL, NULL, '2025-11-25 04:04:49', NULL, NULL),
	(34, 12, 'user', '974120', 'cek', NULL, NULL, '2025-11-25 04:36:06', NULL, NULL),
	(35, 12, 'user', '974120', 'yreter', NULL, NULL, '2025-11-25 04:38:33', NULL, NULL),
	(36, 12, 'user', '974120', 'tes', NULL, NULL, '2025-11-25 04:44:30', NULL, NULL),
	(126, 12, 'admin', 'adminmaxco', 'tes', NULL, NULL, '2025-11-27 06:46:05', NULL, NULL),
	(127, 12, 'admin', 'adminmaxco', 'halo bang', NULL, NULL, '2025-11-27 06:49:27', NULL, NULL),
	(128, 12, 'admin', 'adminmaxco', 'bolee', NULL, NULL, '2025-11-27 06:49:58', NULL, NULL),
	(129, 12, 'user', '974120', 'test lagi', NULL, NULL, '2025-11-27 08:13:08', NULL, NULL),
	(130, 12, 'admin', 'adminmaxco', 'tes', NULL, NULL, '2025-11-27 08:13:58', NULL, NULL),
	(131, 12, 'user', '974120', 'test', NULL, NULL, '2025-11-27 08:14:46', NULL, NULL),
	(132, 12, 'user', '974120', 'cek lagi', NULL, NULL, '2025-11-27 08:17:23', NULL, NULL),
	(133, 12, 'admin', 'adminmaxco', 'tes admin', NULL, NULL, '2025-11-27 08:19:07', NULL, NULL),
	(134, 12, 'user', '974120', 'tes cs', NULL, NULL, '2025-11-27 08:52:10', NULL, NULL),
	(135, 12, 'admin', 'adminmaxco', 'tes lagi', NULL, NULL, '2025-11-27 08:56:55', NULL, NULL),
	(136, 12, 'admin', 'adminmaxco', 'cek', NULL, NULL, '2025-11-27 08:57:02', NULL, NULL),
	(137, 12, 'admin', 'adminmaxco', 'test lagiii', NULL, NULL, '2025-11-27 08:57:43', NULL, NULL),
	(138, 12, 'admin', 'adminmaxco', 'nah bids', NULL, NULL, '2025-11-27 08:57:48', NULL, NULL),
	(139, 12, 'admin', 'adminmaxco', 'cek jam', NULL, NULL, '2025-11-27 08:58:08', NULL, NULL),
	(140, 12, 'user', '974120', 'sudah saatnya', NULL, NULL, '2025-11-27 08:58:16', NULL, NULL),
	(141, 8, 'admin', 'adminmaxco', 'halo bang', NULL, NULL, '2025-11-27 08:59:39', NULL, NULL),
	(142, 8, 'admin', 'adminmaxco', 'nah kan', NULL, NULL, '2025-11-27 09:00:01', NULL, NULL),
	(143, 8, 'admin', 'adminmaxco', 'jam berapa?', NULL, NULL, '2025-11-27 09:03:15', NULL, NULL),
	(144, 8, 'user', '974120', 'jam segini bang', NULL, NULL, '2025-11-28 02:44:49', NULL, NULL),
	(145, 8, 'admin', 'adminsatunya', 'ada apa bang', NULL, NULL, '2025-11-28 02:46:36', NULL, NULL),
	(146, 8, 'admin', 'adminsatunya', 'gini bang', NULL, NULL, '2025-11-28 03:33:37', NULL, NULL),
	(147, 8, 'admin', 'adminsatunya', 'kok masih gabisa', NULL, NULL, '2025-11-28 03:35:52', NULL, NULL),
	(148, 8, 'admin', 'adminsatunya', 'cek', NULL, NULL, '2025-11-28 03:42:54', NULL, NULL),
	(149, 8, 'admin', 'adminsatunya', 'tes', NULL, NULL, '2025-11-28 03:46:01', NULL, NULL),
	(150, 8, 'admin', 'adminsatunya', 'cek', NULL, NULL, '2025-11-28 03:54:12', NULL, NULL),
	(151, 8, 'admin', 'adminsatunya', 'cek', NULL, NULL, '2025-11-28 03:55:26', NULL, NULL),
	(152, 8, 'admin', 'adminsatunya', 'asada', NULL, NULL, '2025-11-28 04:17:49', NULL, NULL),
	(153, 37, 'admin', 'adminmaxco', 'test', NULL, NULL, '2025-11-29 09:04:45', NULL, NULL),
	(154, 37, 'admin', 'adminmaxco', 'loh masuk jir', NULL, NULL, '2025-11-29 09:05:15', NULL, NULL),
	(155, 37, 'user', '974120', 'kenapa bang', NULL, NULL, '2025-11-29 09:05:45', NULL, NULL),
	(156, 37, 'admin', 'adminmaxco', 'hee', NULL, NULL, '2025-11-29 09:07:42', NULL, NULL),
	(157, 12, 'admin', 'adminmaxco', 'tes juga bang', NULL, NULL, '2025-11-29 09:08:00', NULL, NULL),
	(158, 12, 'user', '974120', 'kok lagi bang', NULL, NULL, '2025-11-29 09:12:03', NULL, NULL),
	(159, 12, 'admin', 'adminmaxco', 'nah gituy', NULL, NULL, '2025-11-29 09:16:33', NULL, NULL),
	(160, 12, 'admin', 'adminmaxco', 'kenapa bang', NULL, NULL, '2025-11-29 09:16:47', NULL, NULL),
	(161, 12, 'admin', 'adminmaxco', 'jashgdfilukwhgesofiuwe', NULL, NULL, '2025-11-29 09:16:49', NULL, NULL),
	(162, 12, 'admin', 'adminmaxco', 'jdrsfhgiuhwerilugkhweliurhvgnwiuergw', NULL, NULL, '2025-11-29 09:16:51', NULL, NULL),
	(163, 12, 'admin', 'adminmaxco', 'ehsrdligvuhdroigvunhsrdoiughvn oisdurhcgiuhrdsiuogvcnuidrnhvgcuisrdhnuivrs', NULL, NULL, '2025-11-29 09:16:55', NULL, NULL),
	(164, 12, 'admin', 'adminmaxco', 'tes', NULL, NULL, '2025-11-29 09:18:36', NULL, NULL),
	(165, 12, 'admin', 'adminmaxco', 'cek', NULL, NULL, '2025-11-29 09:18:46', NULL, NULL),
	(166, 12, 'admin', 'adminmaxco4', 'baru2 ini', NULL, NULL, '2025-12-01 01:19:16', NULL, NULL),
	(167, 11, 'admin', 'adminmaxco4', 'tes', NULL, NULL, '2025-12-01 01:23:10', NULL, NULL),
	(168, 11, 'user', '974120', 'cek bang', NULL, NULL, '2025-12-01 01:28:06', NULL, NULL),
	(169, 12, 'user', '974120', 'cek', NULL, 1, '2025-12-01 04:54:36', NULL, 'null'),
	(170, 12, 'user', '974120', 'tererere', NULL, 1, '2025-12-01 04:57:44', NULL, 'null'),
	(171, 12, 'user', '974120', 'tes dsdf', NULL, 1, '2025-12-01 04:59:06', NULL, 'null'),
	(172, 12, 'user', '974120', 'cek', NULL, 1, '2025-12-01 04:59:18', NULL, 'null'),
	(173, 12, 'user', '974120', 'hai', NULL, 1, '2025-12-01 04:59:35', NULL, 'null'),
	(174, 12, 'user', '974120', 'asdasdasdad', NULL, 1, '2025-12-01 04:59:56', NULL, 'null'),
	(175, 12, 'user', '974120', 'DCFSDFSDF', NULL, 1, '2025-12-01 06:42:50', NULL, 'null'),
	(176, 12, 'user', '974120', 'FGDSFGD', NULL, 1, '2025-12-01 06:51:55', NULL, 'null'),
	(177, 12, 'user', '974120', 'CASDASD', NULL, 1, '2025-12-01 06:52:20', NULL, 'null'),
	(178, 12, 'user', '974120', 'sadasda', NULL, 1, '2025-12-01 07:03:32', NULL, 'null'),
	(179, 12, 'user', '974120', 'fdsdfdsf', NULL, 1, '2025-12-01 07:05:43', NULL, 'null'),
	(180, 12, 'user', '974120', 'aaa', NULL, 1, '2025-12-01 07:06:09', NULL, 'null'),
	(181, 12, 'user', '974120', 'fgfdgdf', NULL, 1, '2025-12-01 07:09:40', NULL, 'null'),
	(182, 12, 'user', '974120', 'fgfg', NULL, 1, '2025-12-01 07:09:52', NULL, 'null'),
	(183, 12, 'user', '974120', 'fgdfgd', NULL, 1, '2025-12-01 07:12:06', NULL, 'null'),
	(184, 12, 'user', '974120', 'gfhgfhf', NULL, 1, '2025-12-01 07:12:29', NULL, 'null'),
	(185, 12, 'user', '974120', 'utyughghrt', NULL, 1, '2025-12-01 07:13:56', NULL, 'null'),
	(186, 12, 'user', '974120', 'vdvfd', NULL, 1, '2025-12-01 07:14:17', NULL, 'null'),
	(187, 12, 'user', '974120', 'asdsad', NULL, 1, '2025-12-01 07:23:13', NULL, 'null'),
	(188, 12, 'user', '974120', 'gfdgd', NULL, 1, '2025-12-01 07:23:26', NULL, 'null'),
	(189, 12, 'user', '974120', 'hjgjgh', NULL, 1, '2025-12-01 07:23:42', NULL, 'null'),
	(190, 12, 'user', '974120', 'yryryryrtrgf', NULL, 1, '2025-12-01 07:24:06', NULL, 'null'),
	(191, 12, 'user', '974120', 'vfbfghfdfgfdg', NULL, 1, '2025-12-01 07:26:03', NULL, 'null'),
	(192, 12, 'user', '974120', NULL, 'uploads/chat/1764574151063_andrew-_IBhDwV6PgI-unsplash.jpg', 2, '2025-12-01 07:29:11', NULL, '{"fileName":"andrew-_IBhDwV6PgI-unsplash.jpg","size":972654}'),
	(193, 12, 'user', '974120', NULL, 'uploads/chat/1764578882708_andrew-_IBhDwV6PgI-unsplash.jpg', 2, '2025-12-01 08:48:02', NULL, '{"fileName":"andrew-_IBhDwV6PgI-unsplash.jpg","size":972654}'),
	(194, 12, 'user', '974120', 'cek', NULL, 1, '2025-12-01 08:49:37', NULL, 'null'),
	(196, 12, 'user', '974120', 'te', NULL, 1, '2025-12-02 01:26:35', NULL, 'null'),
	(197, 44, 'user', '974120', 'asdasda', NULL, 1, '2025-12-02 02:51:57', NULL, 'null'),
	(198, 44, 'admin', 'adminmaxco4', 'halo', NULL, NULL, '2025-12-02 02:59:36', NULL, 'null'),
	(199, 44, 'user', '974120', 'cek', NULL, 1, '2025-12-02 03:00:31', NULL, 'null'),
	(200, 44, 'user', '974120', NULL, 'uploads/chat/1764644442523_IMG_20251202_092406.jpg', 2, '2025-12-02 03:00:42', NULL, '{"fileName":"IMG_20251202_092406.jpg","size":116465}'),
	(201, 44, 'user', '974120', NULL, 'uploads/chat/1764644454342_andrew-_IBhDwV6PgI-unsplash.jpg', 2, '2025-12-02 03:00:54', NULL, '{"fileName":"andrew-_IBhDwV6PgI-unsplash.jpg","size":972654}'),
	(202, 12, 'user', '974120', 'cek', NULL, 1, '2025-12-02 03:13:17', NULL, NULL),
	(203, 12, 'user', '974120', 'gfdgdg', NULL, 1, '2025-12-02 03:13:28', NULL, NULL),
	(204, 12, 'user', '974120', 'tes', NULL, 1, '2025-12-02 03:15:05', NULL, NULL),
	(205, 12, 'user', '974120', 'lklklklklk', NULL, 1, '2025-12-02 03:22:06', NULL, NULL),
	(206, 12, 'user', '974120', NULL, 'uploads/chat/1764645744547_andrew-_IBhDwV6PgI-unsplash.jpg', 2, '2025-12-02 03:22:24', NULL, '{"fileName":"andrew-_IBhDwV6PgI-unsplash.jpg","size":972654}'),
	(207, 44, 'user', '974120', 'cek', NULL, 1, '2025-12-02 03:28:17', NULL, NULL),
	(208, 45, 'admin', 'adminmaxco4', 'halo', NULL, NULL, '2025-12-02 03:31:23', NULL, NULL),
	(209, 45, 'user', '974120', NULL, 'uploads/chat/1764646375157_IMG_20251202_092406.jpg', 2, '2025-12-02 03:32:55', NULL, '{"fileName":"IMG_20251202_092406.jpg","size":116465}'),
	(210, 45, 'user', '974120', 'gomana', NULL, 1, '2025-12-02 03:33:27', NULL, NULL);

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;
