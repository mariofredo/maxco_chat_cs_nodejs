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

// Semua tiket Customer Support milik user sebagai satu thread (tiket baru
// setelah tiket lama closed tetap tampil menyambung di bawahnya)
clientRoutes.get("/chat/support-thread/:userId", ClientChat.getSupportThread);

// Online status of the Customer Support and Sales teams
clientRoutes.get("/presence", ClientChat.getClientPresence);

export default clientRoutes;
