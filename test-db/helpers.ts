// Helpers for tests that run against a real MySQL database (`npm run test:db`).
// This folder sits outside test/ on purpose: `npm test` must never reach a DB,
// even when a root .env fills MYSQLDATABASE.
// They only touch rows whose chat_ticket starts with TEST-AWC-.
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";

/** The DB suites skip themselves when no database is configured. */
export const hasDb = Boolean(process.env.MYSQLDATABASE);

export async function cleanupTestChats(): Promise<void> {
  await pool.query(
    `DELETE m FROM list_messages m
     JOIN list_chats c ON c.id = m.chat_id
     WHERE c.chat_ticket LIKE 'TEST-AWC-%'`,
  );
  await pool.query("DELETE FROM list_chats WHERE chat_ticket LIKE 'TEST-AWC-%'");
}

export async function insertChat(opts: {
  tag: string;
  categoryId?: number;
  status?: "pending" | "active" | "closed";
  adminId?: string | null;
  adminName?: string | null;
  minutesAgo?: number;
}): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO list_chats
       (chat_ticket, category_id, user_id, user_name, admin_id, admin_name, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? MINUTE)`,
    [
      `TEST-AWC-${opts.tag}`,
      opts.categoryId ?? 1,
      `test-awc-${opts.tag}`,
      `Test ${opts.tag}`,
      opts.adminId ?? null,
      opts.adminName ?? null,
      opts.status ?? "pending",
      opts.minutesAgo ?? 0,
    ],
  );
  return result.insertId;
}

export async function insertMessage(
  chatId: number,
  senderType: "user" | "admin",
  senderId: string,
  minutesAgo: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO list_messages
       (chat_id, sender_type, sender_id, sender_name, message, content_type, created_at)
     VALUES (?, ?, ?, ?, 'test message', 1, NOW() - INTERVAL ? MINUTE)`,
    [chatId, senderType, senderId, senderId, minutesAgo],
  );
}

export async function getChat(
  chatId: number,
): Promise<{ status: string; admin_id: string | null; admin_name: string | null }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT status, admin_id, admin_name FROM list_chats WHERE id = ?",
    [chatId],
  );
  const row = rows[0];
  if (!row) throw new Error(`chat ${chatId} not found`);
  return { status: row.status, admin_id: row.admin_id, admin_name: row.admin_name };
}
