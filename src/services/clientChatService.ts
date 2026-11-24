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
 * Aturan hitung: pesan dari admin/CRM atau pesan otomatis (system) yang
 * read_at IS NULL.
 * Semua chat milik user ikut dikembalikan (unread 0) supaya client bisa
 * join room socket-nya, kecuali chat Inside Sales (category 3) yang tidak
 * aktif (sudah ditutup): chat itu tidak tampil di app dan tidak bisa dibalas,
 * jadi tidak masuk daftar maupun total.
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
              AND m.sender_type IN ('admin', 'system')
        ) AS unread
     FROM list_chats c
     WHERE c.user_id = ?
       AND (c.category_id <> 3 OR c.status = 'active')
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

export type SupportTicket = {
  chat_id: number;
  chat_ticket: string;
  status: string;
  created_at: string;
  closed_at: string | null;
};

export type SupportThreadPage = {
  messages: RowDataPacket[];
  tickets: SupportTicket[];
  current: { chat_id: number; chat_ticket: string; status: string } | null;
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

/** Customer Support (list_chat_category 1): the category made of tickets. */
const SUPPORT_CATEGORY_ID = 1;

/**
 * Every Customer Support ticket of a user as one thread, one page at a time.
 *
 * Same paging convention as fetchChatMessagesPage: page 1 is the newest
 * messages, a page is returned oldest-first, and `id` breaks ties of
 * `created_at` (one second precision). `tickets` describes the tickets whose
 * messages are on this page (the app draws the "opened" / "closed" markers
 * from their created_at / closed_at), `current` is the user's latest
 * Customer Support chat: the one the app sends to.
 */
export async function fetchSupportThread(
  userId: string,
  page: number = 1,
  pageSize: number = 50,
): Promise<SupportThreadPage> {
  const limit = Math.max(1, Math.floor(Number(pageSize)) || 50);
  const currentPage = Math.max(1, Math.floor(Number(page)) || 1);
  const offset = (currentPage - 1) * limit;
  const userChats =
    "SELECT id FROM list_chats WHERE user_id = ? AND category_id = ?";

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM list_messages WHERE chat_id IN (${userChats})`,
    [userId, SUPPORT_CATEGORY_ID]
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [messages] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM (
       SELECT * FROM list_messages
       WHERE chat_id IN (${userChats})
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?
     ) t ORDER BY created_at ASC, id ASC`,
    [userId, SUPPORT_CATEGORY_ID, limit, offset]
  );

  const chatIds = [...new Set(messages.map((m) => Number(m.chat_id)))];
  let tickets: SupportTicket[] = [];
  if (chatIds.length > 0) {
    const [ticketRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, chat_ticket, status, created_at, closed_at
       FROM list_chats WHERE id IN (?)
       ORDER BY created_at ASC, id ASC`,
      [chatIds]
    );
    tickets = ticketRows.map((row) => ({
      chat_id: Number(row.id),
      chat_ticket: row.chat_ticket,
      status: row.status,
      created_at: row.created_at,
      closed_at: row.closed_at ?? null,
    }));
  }

  const [currentRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, chat_ticket, status FROM list_chats
     WHERE user_id = ? AND category_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [userId, SUPPORT_CATEGORY_ID]
  );
  const latest = currentRows[0];
  const current = latest
    ? { chat_id: Number(latest.id), chat_ticket: latest.chat_ticket, status: latest.status }
    : null;

  return {
    messages,
    tickets,
    current,
    total,
    page: currentPage,
    pageSize: limit,
    hasMore: offset + messages.length < total,
  };
}
