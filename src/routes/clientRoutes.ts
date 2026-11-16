import { Router } from "express";
import * as ClientChat from "../controllers/clientChatController.js";

/**
 * Route khusus app client mobile — dipisah dari /api/chats (yang dipakai CRM
 * dan client bersama) supaya perubahan untuk client tidak pernah menyentuh
 * kode CRM.
 */
const clientRoutes = Router();

// Ringkasan pesan belum dibaca (badge sidebar)
clientRoutes.get("/chat/unread/:userId", ClientChat.getUnread);

// Online status of the Customer Support and Sales teams
clientRoutes.get("/presence", ClientChat.getClientPresence);

export default clientRoutes;
