import { pool } from "../config/db.js";
import type { RowDataPacket } from "mysql2";

export type ClientChatUnread = {
  chatId: string;
  unread: number;
};

export type ClientUnreadSummary = {
  total: number;
  chats: ClientChatUnread[];
};

/**
 * Ringkasan pesan belum dibaca KHUSUS app client mobile.
 *
 * Terpisah dari fetchUserChats() di chatService.ts — endpoint itu juga dipakai
 * CRM (lib/services/live_chat_service.dart), jadi jangan diubah untuk keperluan
 * badge client.
 *
 * Aturan hitung: pesan dari admin/CRM yang read_at IS NULL.
 * Semua chat milik user ikut dikembalikan (unread 0) supaya client bisa
 * join room socket-nya.
 */
export async function getClientChatUnread(
  userId: string
): Promise<ClientUnreadSummary> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
        c.id AS chat_id,
        (
            SELECT COUNT(*)
            FROM list_messages m
            WHERE m.chat_id = c.id
              AND m.read_at IS NULL
              AND m.sender_type = 'admin'
        ) AS unread
     FROM list_chats c
     WHERE c.user_id = ?
     ORDER BY c.created_at DESC;`,
    [userId]
  );

  const chats: ClientChatUnread[] = rows.map((row) => ({
    chatId: String(row.chat_id),
    unread: Number(row.unread ?? 0),
  }));

  const total = chats.reduce((sum, chat) => sum + chat.unread, 0);
  return { total, chats };
}
