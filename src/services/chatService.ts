import { randomInt } from "crypto";
import { pool } from "../config/db.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { randomNumericString } from "../utils/helper.js";
import { saveChatFile } from "../utils/chatFileStorage.js";
import type { SendMessageInput, ChatDataInfo } from "../utils/dataModel.js";
import { assignWaitingChat } from "./crmChatService.js";
import { getIO } from "../sockets/io.js";

export async function fetchActiveChats() {
  const [rows] = await pool.query(
    "SELECT * FROM list_chats WHERE status = 'active' ORDER BY created_at DESC"
  );
  return rows;
}

export type UserChatsPage = {
  chats: RowDataPacket[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

/**
 * Chats of one user, one page at a time.
 *
 * Pagination is opt-in: when neither `page` nor `pageSize` is given every
 * chat of the user is returned (the previous behaviour), so the existing
 * callers keep working. The client app sends both so a member with a long
 * chat history does not pull every row at once.
 *
 * The window function is restricted to the chats of that user: the result is
 * the same, but the server does not have to rank the messages of every chat
 * in the database.
 */
export async function fetchUserChats(
  userId: string,
  page?: number,
  pageSize?: number,
): Promise<UserChatsPage> {
  const paginated = page !== undefined || pageSize !== undefined;
  const limit = Math.max(1, Number(pageSize) || 20);
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const [countRows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM list_chats WHERE user_id = ?",
    [userId]
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await pool.query<RowDataPacket[]>(
    `WITH last_msg AS (
        SELECT
            chat_id,
            sender_id,
            message,
            created_at,
            content_type,
            metadata,
            ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
        FROM list_messages
        WHERE chat_id IN (SELECT id FROM list_chats WHERE user_id = ?)
    )
    SELECT
        lc.*,
        lm.message AS last_message,
        lm.sender_id AS last_message_sender_id,
        lm.created_at AS last_message_time,
        lm.content_type AS last_message_content_type,
        lm.metadata AS last_message_metadata
    FROM list_chats lc
    LEFT JOIN last_msg lm 
        ON lc.id = lm.chat_id AND lm.rn = 1
    WHERE lc.user_id = ?
    ORDER BY
        lc.category_id DESC,
        (lm.created_at IS NULL) ASC,
        lm.created_at DESC,
        lc.created_at DESC,
        lc.id DESC
    ${paginated ? "LIMIT ? OFFSET ?" : ""};`,
    paginated
      ? [userId, userId, limit, offset]
      : [userId, userId]
  );

  return {
    chats: rows as RowDataPacket[],
    total,
    page: currentPage,
    pageSize: limit,
    hasMore: paginated ? offset + rows.length < total : false,
  };
}

export async function createNewChat(userId: string, userName: string, userReferrer: string = "") {
  // Check if user already has an active/waiting chat
  const [existingChats] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM list_chats WHERE user_id = ? AND status IN ('active', 'pending') AND category_id = 1 ORDER BY created_at DESC LIMIT 1",
    [userId]
  );

  // If user already has an active chat, return it
  if (existingChats.length > 0) {
    return { chat: existingChats[0], isNew: false };
  }
  const randString = randomNumericString(12);
  const finalRandString = `${randString.slice(0, 4)}-${randString.slice(4, 8)}-${randString.slice(8, 12)}`;
  // Create new chat
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO list_chats (chat_ticket,user_id, user_name, user_referrer_id, status, category_id, created_at) VALUES (?, ?, ?, ?, 'pending', 1, NOW())",
    [finalRandString, userId, userName, userReferrer]
  );

  // Get the created chat
  const [newChat] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM list_chats WHERE id = ?",
    [result.insertId]
  );

  return { chat: newChat[0], isNew: true };
}

export async function getChatById(chatId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM list_chats WHERE id = ?",
    [chatId]
  );
  return rows[0] || null;
}

export async function updateChatStatus(chatId: string, status: 'active' | 'pending' | 'closed') {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE list_chats SET status = ?, updated_at = NOW() WHERE id = ?",
    [status, chatId]
  );
  return result.affectedRows > 0;
}

export async function assignAdminToChat(chatId: string, adminId: string, adminName: string) {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE list_chats SET admin_id = ?, admin_name = ?, status = 'active', updated_at = NOW() WHERE id = ?",
    [adminId, adminName, chatId]
  );
  return result.affectedRows > 0;
}

export type ChatMessagesPage = {
  messages: RowDataPacket[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

/**
 * Messages of one chat, one page at a time.
 *
 * Page 1 is the newest messages (the chat opens at the bottom), the next
 * pages walk backwards through the history. The rows of a page are returned
 * oldest-first so the caller can append them as they are.
 *
 * `id` is the tiebreaker of the ordering: `created_at` has a one second
 * precision, so messages sent in the same second would otherwise swap places
 * between two pages and be duplicated or skipped.
 */
export async function fetchChatMessagesPage(
  chatId: string,
  page: number = 1,
  pageSize: number = 50,
): Promise<ChatMessagesPage> {
  const limit = Math.max(1, Number(pageSize) || 50);
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const [countRows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM list_messages WHERE chat_id = ?",
    [chatId]
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM (
       SELECT * FROM list_messages WHERE chat_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
     ) t ORDER BY created_at ASC, id ASC`,
    [chatId, limit, offset]
  );

  return {
    messages: rows,
    total,
    page: currentPage,
    pageSize: limit,
    hasMore: offset + rows.length < total,
  };
}

/**
 * Messages of one chat, newest page first and without the paging metadata.
 *
 * Used by the CRM, which keeps its own paging logic.
 */
export async function fetchChatMessages(
  chatId: string,
  page: number = 1,
  pageSize: number = 50,
) {
  const { messages } = await fetchChatMessagesPage(chatId, page, pageSize);
  return messages;
}

export async function sendMessage(input: SendMessageInput) {
  const {
    chat_id,
    sender_id,
    sender_type,
    sender_name,
    content_type,
    message,
    file_name,
    file_data,
    content_url,
    metadata
  } = input;
  // An admin reply to a waiting chat assigns it to that admin. Checked on the
  // chat itself, before the message is stored (a stored admin message ends
  // the waiting state).
  const justAssigned =
    sender_type === "admin"
      ? await assignWaitingChat(chat_id, sender_id, sender_name)
      : false;

  if (justAssigned) {
    const io = getIO();
    io.to(`chat_${chat_id}`).emit("assigned_admin_chat", {
      chatId: chat_id,
      adminId: sender_id,
      adminName: sender_name
    });
  }

  let contentUrl: string | null = null;
  let finalMessage: string | null = message ?? null;
  let metadataValue: any = null;

  if (content_type === 2) {
    if (!content_url) {
       if (!file_name || !file_data) {
        throw new Error("Invalid file payload");
      }
      const fileResult = await saveChatFile(file_name, file_data);
      contentUrl = fileResult.contentUrl;
      metadataValue = fileResult.metadata;
      finalMessage = null;
    } else {
     contentUrl = content_url;
     metadataValue = input.metadata || null;
     finalMessage = null;
    }
    
    
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO list_messages 
        (chat_id, sender_id, sender_type, sender_name, message, content_type, content_url, metadata) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      chat_id,
      sender_id,
      sender_type,
      sender_name,
      finalMessage,
      content_type,
      contentUrl,
      metadataValue != null ? JSON.stringify(metadataValue) : null
    ]
  );

  const [chatRows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM list_chats WHERE id = ?",
    [chat_id]
  );
  const chatData = (chatRows[0] || null) as ChatDataInfo | null;

  return {
    id: result.insertId,
    chat_id,
    sender_id,
    sender_type,
    sender_name,
    content_type,
    message: finalMessage,
    content_url: contentUrl,
    metadata: metadataValue,
    created_at: new Date(),
    is_just_assigned: justAssigned,
    chat_data: chatData
  };
}

export async function closeChat(chatId: string) {
  const [result] = await pool.query(
    "UPDATE list_chats SET status = 'closed', closed_at = NOW() WHERE id = ?",
    [chatId]
  );
  return (result as any).affectedRows > 0;
}

export async function markUpdateReadAt(chatId: string, userId: string) {
  const [result] = await pool.query(
    "UPDATE list_messages SET read_at = NOW() WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL",
    [chatId, userId]
  );
  return (result as any).affectedRows > 0;
}

export async function markRead(chatId: string, userId: string) {
  const [result] = await pool.query(
    "UPDATE list_messages SET read_at = NOW() WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL",
    [chatId, userId]
  );
  return (result as any).affectedRows > 0;
}


// In-flight "ensure" calls per user. The client can send the same POST twice
// at once (room list load racing a socket-triggered refresh), and a plain
// check-then-insert lets both requests insert an inside sales chat. The
// second request now waits for the first one instead of racing it.
const pendingSalesChatEnsures = new Map<string, Promise<void>>();

export async function ensureUserSalesChat(
  userId: string,
  userName: string,
  userReferrerId: string,
  userReferrerName: string
): Promise<void> {
  if (!userId) return;

  console.log(`ensure inside sales chat user Id: ${userId}, username: ${userName}, userReferrerId: ${userReferrerId}, userReferrerName: ${userReferrerName}`)

  const pending = pendingSalesChatEnsures.get(userId);
  if (pending) {
    // Same user is already being ensured: wait for that one instead of
    // running a second check-then-insert in parallel with it.
    return pending;
  }

  const ensure = createSalesChatIfMissing(
    userId,
    userName,
    userReferrerId,
    userReferrerName
  ).finally(() => {
    if (pendingSalesChatEnsures.get(userId) === ensure) {
      pendingSalesChatEnsures.delete(userId);
    }
  });

  pendingSalesChatEnsures.set(userId, ensure);
  return ensure;
}

async function createSalesChatIfMissing(
  userId: string,
  userName: string,
  userReferrerId: string,
  userReferrerName: string
): Promise<void> {
  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM list_chats WHERE user_id = ? AND category_id = 3 LIMIT 1",
    [userId]
  );

  if (existing.length > 0) {
    return;
  }

  const randString = randomNumericString(12);
  const finalRandString = `${randString.slice(0, 4)}-${randString.slice(4, 8)}-${randString.slice(8, 12)}`;

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO list_chats (
         chat_ticket, user_id, user_name, user_referrer_id, user_referrer_name, status,
         category_id, admin_id, admin_name, created_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 3, ?, ?, NOW())`,
      [
        finalRandString,
        userId,
        userName,
        userReferrerId,
        userReferrerName,
        userReferrerId,
        userReferrerName,
      ]
    );
    // Tell the referenced sales member (user_referrer_id) about the new
    // inside-sales room so their CRM socket can join it even while the chat
    // page is closed. Scoped to that member only: the channel is per member id.
    if (userReferrerId) {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM list_chats WHERE id = ?",
        [result.insertId]
      );
      const chat = rows[0];
      if (chat) {
        const io = getIO();
        io.to(`user_${userReferrerId}`).emit("new_user_chatroom", { chatData: chat });
      }
    }
  } catch (err) {
    // The unique index on the inside sales chat (sql/dbchanges_202610191417.sql)
    // turns a lost race into ER_DUP_ENTRY: another request already created
    // the chat, which is exactly what this function was about to create.
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ER_DUP_ENTRY"
    ) {
      return;
    }
    throw err;
  }
}
