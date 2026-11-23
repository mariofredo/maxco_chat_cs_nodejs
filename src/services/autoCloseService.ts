import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../config/db.js";
import { getIO } from "../sockets/io.js";
import {
  AUTO_CLOSE_WINDOW_MINUTES,
  DEFAULT_AUTO_CLOSE_MESSAGE,
  SYSTEM_SENDER_ID,
  SYSTEM_SENDER_NAME,
  parseAutoCloseMinutes,
  renderAutoCloseMessage,
} from "../utils/autoClose.js";
import { getChatById } from "./chatService.js";
import { sendChatPush } from "./pushService.js";
import { CS_PUSH_TITLE } from "../utils/pushTitle.js";

/**
 * Idle rule of a Customer Support chat, shared by the candidate query and the
 * guarded UPDATE so the two cannot drift apart. Bind values:
 * [minutes, minutes + AUTO_CLOSE_WINDOW_MINUTES].
 *
 * The chat waits on the user: its latest message is from an admin, nothing
 * was written in the last `minutes`, and that admin message is not older than
 * the window (see AUTO_CLOSE_WINDOW_MINUTES).
 */
const IDLE_CHAT_CONDITIONS = `
  lc.category_id = 1
  AND lc.status IN ('pending', 'active')
  AND (
    SELECT m.sender_type FROM list_messages m
    WHERE m.chat_id = lc.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM list_messages m
    WHERE m.chat_id = lc.id
      AND m.created_at > NOW() - INTERVAL ? MINUTE
  )
  AND EXISTS (
    SELECT 1 FROM list_messages m
    WHERE m.chat_id = lc.id
      AND m.sender_type = 'admin'
      AND m.created_at >= NOW() - INTERVAL ? MINUTE
  )`;

function idleBindings(minutes: number): number[] {
  return [minutes, minutes + AUTO_CLOSE_WINDOW_MINUTES];
}

async function readChatConfig(key: string): Promise<string | undefined> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT config_value FROM list_chat_config WHERE config_key = ? LIMIT 1",
    [key],
  );
  const value = rows[0]?.config_value;
  return value === undefined || value === null ? undefined : String(value);
}

/** `auto_close_minutes`; 0 (off) when missing, invalid or unreadable. */
export async function getAutoCloseMinutes(): Promise<number> {
  try {
    return parseAutoCloseMinutes(await readChatConfig("auto_close_minutes"));
  } catch (err) {
    console.warn("Failed to read chat config 'auto_close_minutes', auto-close is off for this pass.", err);
    return 0;
  }
}

/** `auto_close_message`; the default text when missing, blank or unreadable. */
export async function getAutoCloseTemplate(): Promise<string> {
  try {
    const value = await readChatConfig("auto_close_message");
    return value && value.trim() ? value : DEFAULT_AUTO_CLOSE_MESSAGE;
  } catch (err) {
    console.warn("Failed to read chat config 'auto_close_message', using the default text.", err);
    return DEFAULT_AUTO_CLOSE_MESSAGE;
  }
}

/** Ids of the Customer Support chats that match the idle rule now. */
export async function findAutoCloseCandidates(minutes: number): Promise<number[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT lc.id FROM list_chats lc WHERE ${IDLE_CHAT_CONDITIONS}`,
    idleBindings(minutes),
  );
  return rows.map((row) => Number(row.id));
}

/**
 * Closes one chat if it still matches the idle rule, stores the automated
 * message, tells the chat room and pushes the message to the user.
 *
 * The close is one guarded UPDATE: a user message that arrived in the
 * meantime, or a second process, makes it a no-op (false), so the automated
 * message is never stored twice. The close and the automated message are one
 * transaction (a chat is never left closed without its message), and the
 * message carries the close time as created_at, so it sorts before the
 * "ticket closed" marker the app draws at closed_at.
 */
export async function closeIdleChat(chatId: number, minutes: number, template: string): Promise<boolean> {
  const metadata = { type: "auto_close" };
  let text: string;
  let messageId: number;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query<ResultSetHeader>(
      `UPDATE list_chats lc
       SET lc.status = 'closed', lc.closed_at = NOW()
       WHERE lc.id = ? AND ${IDLE_CHAT_CONDITIONS}`,
      [chatId, ...idleBindings(minutes)],
    );
    if (result.affectedRows !== 1) {
      await conn.rollback();
      return false;
    }

    const [chatRows] = await conn.query<RowDataPacket[]>(
      "SELECT user_name FROM list_chats WHERE id = ?",
      [chatId],
    );
    text = renderAutoCloseMessage(template, { name: chatRows[0]?.user_name, minutes });

    const [inserted] = await conn.query<ResultSetHeader>(
      `INSERT INTO list_messages
         (chat_id, sender_id, sender_type, sender_name, message, content_type, content_url, metadata, created_at)
       SELECT lc.id, ?, 'system', ?, ?, 1, NULL, ?, lc.closed_at
       FROM list_chats lc WHERE lc.id = ?`,
      [SYSTEM_SENDER_ID, SYSTEM_SENDER_NAME, text, JSON.stringify(metadata), chatId],
    );
    messageId = inserted.insertId;
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const chatData = await getChatById(String(chatId));
  const io = getIO();
  io.to(`chat_${chatId}`).emit("new_message", {
    id: messageId,
    chat_id: chatId,
    sender_id: SYSTEM_SENDER_ID,
    sender_type: "system",
    sender_name: SYSTEM_SENDER_NAME,
    content_type: 1,
    message: text,
    content_url: null,
    metadata,
    // Same value as the stored created_at (the close time).
    created_at: chatData?.closed_at ?? new Date(),
    is_just_assigned: false,
    chat_data: chatData,
    previous_chat_id: null,
    is_new_ticket: false,
  });
  io.to(`chat_${chatId}`).emit("chat_closed", { chatId, chatData, reason: "auto_no_reply" });

  const userId = chatData?.user_id;
  if (userId) {
    void sendChatPush({
      userId: String(userId),
      chatId: String(chatId),
      title: CS_PUSH_TITLE,
      body: text,
    });
  }
  return true;
}

/**
 * One pass of the auto-close job. Reads the settings every time, so a change
 * in list_chat_config applies without a restart. Returns how many chats it
 * closed.
 */
export async function runAutoClose(): Promise<number> {
  const minutes = await getAutoCloseMinutes();
  if (minutes <= 0) return 0;

  const template = await getAutoCloseTemplate();
  const candidates = await findAutoCloseCandidates(minutes);
  let closed = 0;
  for (const chatId of candidates) {
    try {
      if (await closeIdleChat(chatId, minutes, template)) closed++;
    } catch (err) {
      console.error(`auto-close: failed to close chat ${chatId}:`, err);
    }
  }
  if (closed > 0) {
    console.log(`auto-close: closed ${closed} idle chat(s)`);
  }
  return closed;
}
