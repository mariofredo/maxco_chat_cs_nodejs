// Helpers for tests that run against a real MySQL database (`npm run test:db`).
// This folder sits outside test/ on purpose: `npm test` must never reach a DB,
// even when a root .env fills MYSQLDATABASE.
// They only touch rows whose chat_ticket starts with TEST-AWC- or whose
// user_id starts with test-awc- (chats created by the code under test get a
// random ticket number, so the user id is what marks them).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Server } from "socket.io";
import { pool } from "../src/config/db.js";

/** The DB suites skip themselves when no database is configured. */
export const hasDb = Boolean(process.env.MYSQLDATABASE);

const TEST_CHATS = "(c.chat_ticket LIKE 'TEST-AWC-%' OR c.user_id LIKE 'test-awc-%')";

export async function cleanupTestChats(): Promise<void> {
  await pool.query(
    `DELETE m FROM list_messages m
     JOIN list_chats c ON c.id = m.chat_id
     WHERE ${TEST_CHATS}`,
  );
  await pool.query(`DELETE c FROM list_chats c WHERE ${TEST_CHATS}`);
}

/**
 * Runs a repo SQL file (path relative to the repo root) on its own connection
 * that allows several statements, against the test database: the file's
 * USE `...`; line is dropped so MYSQLDATABASE is the one used. Returns the first
 * row of the last result set that has rows (the file's closing SELECT).
 */
export async function runSqlFile(relPath: string): Promise<RowDataPacket | undefined> {
  const file = fileURLToPath(new URL(`../${relPath}`, import.meta.url));
  const sql = (await readFile(file, "utf8")).replace(/^USE\s+`[^`]+`;[ \t]*\r?\n/m, "");
  const connection = await mysql.createConnection({
    host: process.env.MYSQLHOST!,
    port: Number(process.env.MYSQLPORT) || 3306,
    user: process.env.MYSQLUSER!,
    password: process.env.MYSQLPASSWORD!,
    database: process.env.MYSQLDATABASE!,
    multipleStatements: true,
    timezone: "Z",
    dateStrings: true,
  });
  try {
    const [results] = await connection.query(sql);
    const withRows = (results as unknown[]).filter(
      (r): r is RowDataPacket[] => Array.isArray(r) && r.length > 0,
    );
    return withRows.at(-1)?.[0];
  } finally {
    await connection.end();
  }
}

export async function insertChat(opts: {
  tag: string;
  categoryId?: number;
  status?: "pending" | "active" | "closed";
  adminId?: string | null;
  adminName?: string | null;
  minutesAgo?: number;
  userId?: string;
  userName?: string | null;
  closedMinutesAgo?: number;
}): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO list_chats
       (chat_ticket, category_id, user_id, user_name, admin_id, admin_name, status, created_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? MINUTE,
             IF(? IS NULL, NULL, NOW() - INTERVAL ? MINUTE))`,
    [
      `TEST-AWC-${opts.tag}`,
      opts.categoryId ?? 1,
      opts.userId ?? `test-awc-${opts.tag}`,
      opts.userName === undefined ? `Test ${opts.tag}` : opts.userName,
      opts.adminId ?? null,
      opts.adminName ?? null,
      opts.status ?? "pending",
      opts.minutesAgo ?? 0,
      opts.closedMinutesAgo ?? null,
      opts.closedMinutesAgo ?? 0,
    ],
  );
  return result.insertId;
}

export async function insertMessage(
  chatId: number,
  senderType: "user" | "admin" | "system",
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

export type TestMessage = {
  id: number;
  sender_type: string;
  sender_id: string;
  sender_name: string | null;
  message: string | null;
  metadata: unknown;
};

/** Messages of one chat, oldest first; a JSON string metadata is parsed. */
export async function getMessages(chatId: number): Promise<TestMessage[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, sender_type, sender_id, sender_name, message, metadata
     FROM list_messages WHERE chat_id = ? ORDER BY created_at, id`,
    [chatId],
  );
  return rows.map((row) => ({
    id: row.id,
    sender_type: row.sender_type,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    message: row.message,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? null),
  }));
}

export type Emitted = { rooms: string[]; event: string; payload: any };

/**
 * Socket.IO server stand-in that records every emit. `io.to(a).to(b).emit()`
 * records rooms [a, b]; `io.emit()` (everyone) records ["*"]. Pass `io` to setIO.
 */
export function fakeIO(): { io: Server; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const operator = (rooms: string[]) => ({
    to: (room: string) => operator([...rooms, room]),
    emit: (event: string, payload: unknown) => {
      emitted.push({ rooms, event, payload });
      return true;
    },
  });
  const io = {
    to: (room: string) => operator([room]),
    emit: (event: string, payload: unknown) => {
      emitted.push({ rooms: ["*"], event, payload });
      return true;
    },
  };
  return { io: io as unknown as Server, emitted };
}
