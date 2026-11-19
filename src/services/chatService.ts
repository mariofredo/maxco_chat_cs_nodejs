import { randomInt } from "crypto";
import { pool } from "../config/db.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { randomNumericString } from "../utils/helper.js";
import { validateUpload, writeChatFile } from "../utils/chatFileStorage.js";
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
  categoryIds: number[] = [],
): Promise<UserChatsPage> {
  const paginated = page !== undefined || pageSize !== undefined;
  const limit = Math.max(1, Number(pageSize) || 20);
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;
  // Optional category filter ([] = every category), on the list and the count.
  const categorySql =
    categoryIds.length > 0
      ? ` AND category_id IN (${categoryIds.map(() => "?").join(", ")})`
      : "";

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM list_chats WHERE user_id = ?${categorySql}`,
    [userId, ...categoryIds]
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
        WHERE chat_id IN (SELECT id FROM list_chats WHERE user_id = ?${categorySql})
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
    WHERE lc.user_id = ?${categorySql.replace("category_id", "lc.category_id")}
    ORDER BY
        lc.category_id DESC,
        (lm.created_at IS NULL) ASC,
        lm.created_at DESC,
        lc.created_at DESC,
        lc.id DESC
    ${paginated ? "LIMIT ? OFFSET ?" : ""};`,
    paginated
      ? [userId, ...categoryIds, userId, ...categoryIds, limit, offset]
      : [userId, ...categoryIds, userId, ...categoryIds]
  );

  return {
    chats: rows as RowDataPacket[],
    total,
    page: currentPage,
    pageSize: limit,
    hasMore: paginated ? offset + rows.length < total : false,
  };
}

// Calls of createNewChat per user, chained. Two requests for the same user at
// once (a double send to a closed ticket, or POST /api/chats racing it) would
// both pass the "no open chat" check and create two tickets; chained, the
// second one runs after the first and finds the first one's chat.
const supportChatQueues = new Map<string, Promise<unknown>>();

type NewChatResult = { chat: RowDataPacket | undefined; isNew: boolean };

/**
 * The user's open Customer Support chat (pending / active), or a new one with
 * a new ticket number when there is none. Serialized per user.
 */
export async function createNewChat(
  userId: string,
  userName: string,
  userReferrer: string = "",
): Promise<NewChatResult> {
  const previous = supportChatQueues.get(userId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => createNewChatUnlocked(userId, userName, userReferrer));
  supportChatQueues.set(userId, current);
  try {
    return await current;
  } finally {
    if (supportChatQueues.get(userId) === current) {
      supportChatQueues.delete(userId);
    }
  }
}

async function createNewChatUnlocked(
  userId: string,
  userName: string,
  userReferrer: string,
): Promise<NewChatResult> {
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

/** An admin message was sent to a Customer Support ticket that is closed. */
export class ChatClosedError extends Error {
  readonly chatId: number | string;

  constructor(chatId: number | string) {
    super(`Chat ${chatId} is closed`);
    this.name = "ChatClosedError";
    this.chatId = chatId;
  }
}

/** Customer Support (list_chat_category 1): the only category with tickets. */
const SUPPORT_CATEGORY_ID = 1;

export type MessageRow = {
  chat_id: number | string;
  sender_id: string;
  sender_type: string;
  sender_name: string | null;
  message: string | null;
  content_type: number;
  content_url: string | null;
  metadata: string | null;
};

/**
 * Stores a message unless its chat is a closed Customer Support ticket (or
 * does not exist). Check and insert are one statement, so a ticket closed
 * by the auto-close between routing and storing cannot receive the message.
 * Returns the new message id, or null when nothing was stored.
 */
export async function insertMessageIfOpen(row: MessageRow): Promise<number | null> {
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO list_messages
       (chat_id, sender_id, sender_type, sender_name, message, content_type, content_url, metadata)
     SELECT lc.id, ?, ?, ?, ?, ?, ?, ?
     FROM list_chats lc
     WHERE lc.id = ? AND NOT (lc.category_id = ? AND lc.status = 'closed')`,
    [
      row.sender_id,
      row.sender_type,
      row.sender_name,
      row.message,
      row.content_type,
      row.content_url,
      row.metadata,
      row.chat_id,
      SUPPORT_CATEGORY_ID,
    ]
  );
  return result.affectedRows === 1 ? result.insertId : null;
}

type MessageRoute = {
  /** The chat the message goes to. */
  chatId: number | string;
  /** The closed ticket the message was addressed to, when it was moved. */
  previousChatId: number | null;
  isNewTicket: boolean;
};

/**
 * Where a message addressed to [chatId] is stored.
 *
 * A closed Customer Support ticket takes no more messages: a message from
 * the ticket's own user goes to that user's open ticket (created when there
 * is none); an admin message is rejected (ChatClosedError), and so is a user
 * message from anyone else than the ticket's user.
 */
async function routeMessage(
  chatId: number | string,
  senderId: string,
  senderType: string,
  senderName: string | null,
): Promise<MessageRoute> {
  const chat = await getChatById(String(chatId));
  if (
    !chat ||
    Number(chat.category_id) !== SUPPORT_CATEGORY_ID ||
    chat.status !== "closed"
  ) {
    return { chatId, previousChatId: null, isNewTicket: false };
  }
  if (senderType === "admin") {
    throw new ChatClosedError(chatId);
  }
  if (String(senderId) !== String(chat.user_id)) {
    throw new Error(`Sender ${senderId} does not own chat ${chat.id}`);
  }
  const { chat: openChat, isNew } = await createNewChat(
    String(chat.user_id),
    chat.user_name || senderName || "",
    chat.user_referrer_id ?? "",
  );
  if (!openChat) {
    throw new Error(`Could not open a new ticket for chat ${chatId}`);
  }
  return { chatId: Number(openChat.id), previousChatId: Number(chat.id), isNewTicket: isNew };
}

export async function sendMessage(input: SendMessageInput) {
  const {
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

  // 'system' messages are written by the server only (auto-close).
  if (sender_type !== "user" && sender_type !== "admin") {
    throw new Error("Invalid sender_type");
  }

  // A file is checked before anything else happens, so a refused file opens
  // no ticket, assigns no PIC and sends no event.
  let upload: ReturnType<typeof validateUpload> | null = null;
  if (content_type === 2 && !content_url) {
    if (!file_name || !file_data) {
      throw new Error("Invalid file payload");
    }
    upload = validateUpload(file_name, file_data);
  }

  let route = await routeMessage(input.chat_id, sender_id, sender_type, sender_name);
  let chat_id = route.chatId;

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
    if (upload) {
      const fileResult = await writeChatFile(upload.safeName, upload.data, file_name ?? upload.safeName);
      contentUrl = fileResult.contentUrl;
      metadataValue = fileResult.metadata;
      finalMessage = null;
    } else {
     // Already uploaded (CRM REST upload): the URL is used as is.
     contentUrl = content_url ?? null;
     metadataValue = input.metadata || null;
     finalMessage = null;
    }
    
    
  }

  const row: MessageRow = {
    chat_id,
    sender_id,
    sender_type,
    sender_name,
    message: finalMessage,
    content_type,
    content_url: contentUrl,
    metadata: metadataValue != null ? JSON.stringify(metadataValue) : null,
  };
  let insertId = await insertMessageIfOpen(row);
  if (insertId === null) {
    // The ticket closed after routing (auto-close in the same moment), or the
    // chat does not exist: route once more and store it where it belongs.
    const retry = await routeMessage(chat_id, sender_id, sender_type, sender_name);
    if (retry.previousChatId === null) {
      throw new Error(`Chat ${chat_id} not found`);
    }
    route = {
      chatId: retry.chatId,
      previousChatId: route.previousChatId ?? retry.previousChatId,
      isNewTicket: route.isNewTicket || retry.isNewTicket,
    };
    chat_id = route.chatId;
    insertId = await insertMessageIfOpen({ ...row, chat_id });
    if (insertId === null) {
      throw new Error(`Could not store the message in chat ${chat_id}`);
    }
  }

  const [chatRows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM list_chats WHERE id = ?",
    [chat_id]
  );
  const chatData = (chatRows[0] || null) as ChatDataInfo | null;
  // The stored time, so live and loaded messages carry the same value.
  const [messageRows] = await pool.query<RowDataPacket[]>(
    "SELECT created_at FROM list_messages WHERE id = ?",
    [insertId]
  );

  return {
    id: insertId,
    chat_id,
    sender_id,
    sender_type,
    sender_name,
    content_type,
    message: finalMessage,
    content_url: contentUrl,
    metadata: metadataValue,
    created_at: (messageRows[0]?.created_at as string | undefined) ?? null,
    is_just_assigned: justAssigned,
    chat_data: chatData,
    // Set when the message was addressed to a closed ticket and stored in the
    // user's open ticket instead (chat_id / chat_data are that open ticket).
    previous_chat_id: route.previousChatId,
    is_new_ticket: route.isNewTicket
  };
}

// A chat that is already closed keeps its closed_at and is not announced again.
export async function closeChat(chatId: string) {
  const [result] = await pool.query(
    "UPDATE list_chats SET status = 'closed', closed_at = NOW() WHERE id = ? AND status <> 'closed'",
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
