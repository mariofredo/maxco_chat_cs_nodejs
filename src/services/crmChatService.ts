import { pool } from "../config/db.js";
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { CrmChatDataInfo } from "../utils/dataModel.js";
import { randomNumericString } from "../utils/helper.js";
import { getIO } from "../sockets/io.js";

// Chat category of the CRM lists when a request does not ask for any:
// 1 = Customer Service (list_chat_category).
const DEFAULT_CATEGORY_IDS = [1];

/**
 * Normalise a chat category filter coming from a request body / query into a
 * list of ids. Accepts an array, a comma separated string ("1,2") or nothing;
 * an empty or unusable value falls back to the Customer Service category, so
 * the callers of the existing endpoints keep their previous behaviour.
 */
export function normalizeCategoryIds(
  input?: number | string | Array<number | string> | null,
): number[] {
  const raw: Array<number | string> = Array.isArray(input)
    ? input
    : input === undefined || input === null || input === ""
      ? []
      : String(input).split(",");
  const ids = raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return ids.length > 0 ? ids : [...DEFAULT_CATEGORY_IDS];
}

/** `lc.category_id IN (?, ?)` fragment plus its bind values. */
function categoryFilter(categoryIds: number[]) {
  return {
    sql: `lc.category_id IN (${categoryIds.map(() => "?").join(", ")})`,
    values: [...categoryIds],
  };
}

const DEFAULT_MAX_WAITING_MINUTES = 120;
const CONFIG_KEY_MAX_WAITING_MINUTES = "max_waiting_minutes";

/**
 * Reads the configurable waiting threshold (in minutes) from `list_chat_config`.
 *
 * Falls back to [DEFAULT_MAX_WAITING_MINUTES] when the row is missing, the
 * value is not a positive number, or the query fails, so the chat lists keep
 * working even if the config table has not been seeded yet.
 */
export async function getMaxWaitingMinutes(): Promise<number> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT config_value FROM list_chat_config WHERE config_key = ? LIMIT 1",
      [CONFIG_KEY_MAX_WAITING_MINUTES],
    );
    const raw = (rows as RowDataPacket[] | undefined)?.[0]?.config_value;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      console.warn(
        `Invalid or missing chat config '${CONFIG_KEY_MAX_WAITING_MINUTES}', falling back to ${DEFAULT_MAX_WAITING_MINUTES} minutes.`,
      );
      return DEFAULT_MAX_WAITING_MINUTES;
    }
    return Math.floor(value);
  } catch (err) {
    console.warn(
      `Failed to read chat config '${CONFIG_KEY_MAX_WAITING_MINUTES}', falling back to ${DEFAULT_MAX_WAITING_MINUTES} minutes.`,
      err,
    );
    return DEFAULT_MAX_WAITING_MINUTES;
  }
}

export async function fetchActiveChats(
  admin_id: string,
  page: number = 1,
  pageSize: number = 20,
  categoryIds?: number | string | Array<number | string> | null,
  userReferrerId?: string,
) {
  const limit = Math.max(1, Number(pageSize) || 20);
  const offset = Math.max(0, ((Number(page) || 1) - 1) * limit);
  const categories = categoryFilter(normalizeCategoryIds(categoryIds));
  // Optional sales filter: only chats referred by that member.
  const referralFilter = userReferrerId ? " AND lc.user_referrer_id = ?" : "";
  const maxWaitingMinutes = await getMaxWaitingMinutes();
  const [rows] = await pool.query(
    `WITH last_msg_admin AS (
        SELECT
            chat_id,
            message,
            content_type,
            created_at,
            metadata,
            ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
        FROM list_messages
        WHERE sender_type = 'admin' AND sender_id = ?
    ),
    last_msg_chat AS (
        SELECT
            lm.chat_id,
            lm.message,
            lm.content_type,
            lm.created_at,
            lm.read_at,
            lm.metadata,
            lct.content_type_name,
            ROW_NUMBER() OVER (PARTITION BY lm.chat_id ORDER BY lm.created_at DESC) AS rn
        FROM list_messages lm
        JOIN list_content_type lct ON lm.content_type = lct.content_type_id
    )
    SELECT
        lc.*,
        lma.message AS last_message_admin,
        lma.content_type AS last_message_admin_content_type,
        lma.metadata AS last_message_admin_metadata,
        lma.created_at AS last_message_admin_time,
        lmc.message AS last_message,
        lmc.content_type AS last_message_content_type,
        lmc.content_type_name AS last_message_content_type_name,
        lmc.metadata AS last_message_metadata,
        lmc.created_at AS last_message_time,
        lmc.read_at
    FROM list_chats lc
    LEFT JOIN last_msg_admin lma 
        ON lc.id = lma.chat_id AND lma.rn = 1
    LEFT JOIN last_msg_chat lmc
        ON lc.id = lmc.chat_id AND lmc.rn = 1
    WHERE (lc.status IN ('pending', 'active'))
      AND lma.created_at IS NOT NULL
      AND lma.created_at >= DATE_SUB(NOW(), INTERVAL ${maxWaitingMinutes} MINUTE)
        AND ${categories.sql}${referralFilter}
    ORDER BY
        (lma.created_at IS NULL) ASC,
        lc.created_at DESC,
        lma.created_at DESC
    LIMIT ? OFFSET ?`,
        [
          admin_id,
          ...categories.values,
          ...(userReferrerId ? [userReferrerId] : []),
          limit,
          offset,
        ]
  );
  return rows;
}
export async function fetchPendingChats(
  page: number = 1,
  pageSize: number = 20,
  categoryIds?: number | string | Array<number | string> | null,
  userReferrerId?: string,
): Promise<CrmChatDataInfo[]> {
  const limit = Math.max(1, Number(pageSize) || 20);
  const offset = Math.max(0, ((Number(page) || 1) - 1) * limit);
  const categories = categoryFilter(normalizeCategoryIds(categoryIds));
  // Optional sales filter: only chats referred by that member.
  const referralFilter = userReferrerId ? " AND lc.user_referrer_id = ?" : "";
  const maxWaitingMinutes = await getMaxWaitingMinutes();
  const [rows] = await pool.query(
    `WITH last_msg_admin AS (
        SELECT
            chat_id,
            message,
            content_type,
            metadata,
            created_at,
            ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
        FROM list_messages
        WHERE sender_type = 'admin'
    ),
    last_msg_chat AS (
        SELECT
            lm.chat_id,
            lm.message,
            lm.content_type,
            lct.content_type_name,
            lm.metadata,
            lm.created_at,
            ROW_NUMBER() OVER (PARTITION BY lm.chat_id ORDER BY lm.created_at DESC) AS rn
        FROM list_messages lm
        JOIN list_content_type lct ON lm.content_type = lct.content_type_id
    )
    SELECT
        lc.*,
        lmc.message AS last_message,
        lmc.content_type AS last_message_content_type,
        lmc.content_type_name AS last_message_content_type_name,
        lmc.metadata AS last_message_metadata,
        lmc.created_at AS last_message_time,
        lm.message AS last_message_admin,
        lm.content_type AS last_message_admin_content_type,
        lm.metadata AS last_message_admin_metadata,
        lm.created_at AS last_message_admin_time
    FROM list_chats lc
    LEFT JOIN last_msg_admin lm 
        ON lc.id = lm.chat_id AND lm.rn = 1
    LEFT JOIN last_msg_chat lmc
        ON lc.id = lmc.chat_id AND lmc.rn = 1
    WHERE (lc.status IN ('pending', 'active'))
      AND (
        lm.created_at IS NULL
        OR lm.created_at <= DATE_SUB(NOW(), INTERVAL ${maxWaitingMinutes} MINUTE)
      )
        AND ${categories.sql}${referralFilter}
    ORDER BY
        CASE WHEN lm.created_at IS NOT NULL
        THEN lm.created_at
        ELSE lc.created_at
        END ASC,
        lc.created_at DESC
    LIMIT ? OFFSET ?`,
        [
          ...categories.values,
          ...(userReferrerId ? [userReferrerId] : []),
          limit,
          offset,
        ]
  );
  return rows as CrmChatDataInfo[];
}

/**
 * Assigns a chat to the admin who replies to it, when that chat is waiting.
 *
 * "Waiting" is checked on the chat itself, with the same rules as the WHERE
 * of `fetchPendingChats` (default category): Customer Service category,
 * pending or active, and no admin message newer than the waiting threshold.
 * Keep the two in step. The check and the assignment are one UPDATE, so the
 * chat's position in the paged waiting list does not matter.
 *
 * Returns true when the chat was waiting and is now active with this admin.
 */
export async function assignWaitingChat(
  chatId: number | string,
  adminId: string,
  adminName: string | null,
): Promise<boolean> {
  const maxWaitingMinutes = await getMaxWaitingMinutes();
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE list_chats lc
     SET lc.status = 'active', lc.admin_id = ?, lc.admin_name = ?
     WHERE lc.id = ?
       AND lc.category_id = 1
       AND lc.status IN ('pending', 'active')
       AND NOT EXISTS (
         SELECT 1 FROM list_messages m
         WHERE m.chat_id = lc.id
           AND m.sender_type = 'admin'
           AND m.created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
       )`,
    [adminId, adminName, chatId, maxWaitingMinutes],
  );
  return result.affectedRows > 0;
}

export async function fetchClosedChat(
  page: number = 1,
  pageSize: number = 20,
  categoryIds?: number | string | Array<number | string> | null,
  userReferrerId?: string,
) {
  const limit = Math.max(1, Number(pageSize) || 20);
  const offset = Math.max(0, ((Number(page) || 1) - 1) * limit);
  const categories = categoryFilter(normalizeCategoryIds(categoryIds));
  // Optional sales filter: only chats referred by that member.
  const referralFilter = userReferrerId ? " AND lc.user_referrer_id = ?" : "";
  const [rows] = await pool.query(
    `WITH last_msg AS (
        SELECT
            lm.chat_id,
            lm.message,
            lm.content_type,
            lct.content_type_name,
            lm.metadata,
            lm.created_at,
            ROW_NUMBER() OVER (PARTITION BY lm.chat_id ORDER BY lm.created_at DESC) AS rn
        FROM list_messages lm
        JOIN list_content_type lct ON lm.content_type = lct.content_type_id
    )
    SELECT
        lc.*,
        lm.message AS last_message,
        lm.content_type AS last_message_content_type,
        lm.content_type_name AS last_message_content_type_name,
        lm.metadata AS last_message_metadata,
        lm.created_at AS last_message_time
    FROM list_chats lc
    LEFT JOIN last_msg lm 
        ON lc.id = lm.chat_id AND lm.rn = 1
    WHERE lc.status = 'closed' AND ${categories.sql}${referralFilter}
    ORDER BY
        (lm.created_at IS NULL) ASC,
        lm.created_at DESC,
        lc.created_at DESC
    LIMIT ? OFFSET ?`,
        [
          ...categories.values,
          ...(userReferrerId ? [userReferrerId] : []),
          limit,
          offset,
        ]
  );
  return rows as CrmChatDataInfo[];
}

/**
 * Flat list of the chats referred by a sales member: one row per chat of the
 * requested categories whose `user_referrer_id` is that member, newest
 * activity first, regardless of the chat status.
 *
 * Used by the CRM sales view, which shows a single list instead of the
 * Assigned / Waiting / Closed tabs.
 */
export async function fetchReferredChats(
  userReferrerId: string,
  page: number = 1,
  pageSize: number = 20,
  categoryIds?: number | string | Array<number | string> | null,
) {
  const limit = Math.max(1, Number(pageSize) || 20);
  const offset = Math.max(0, ((Number(page) || 1) - 1) * limit);
  const categories = categoryFilter(normalizeCategoryIds(categoryIds));
  const [rows] = await pool.query(
    `WITH last_msg AS (
        SELECT
            lm.chat_id,
            lm.message,
            lm.content_type,
            lct.content_type_name,
            lm.metadata,
            lm.created_at,
            lm.sender_id,
            lm.sender_name,
            lm.read_at,
            ROW_NUMBER() OVER (PARTITION BY lm.chat_id ORDER BY lm.created_at DESC) AS rn
        FROM list_messages lm
        JOIN list_content_type lct ON lm.content_type = lct.content_type_id
    )
    SELECT
        lc.*,
        lm.message AS last_message,
        lm.content_type AS last_message_content_type,
        lm.content_type_name AS last_message_content_type_name,
        lm.metadata AS last_message_metadata,
        lm.created_at AS last_message_time,
        lm.sender_id AS last_message_sender_id,
        lm.sender_name AS last_message_sender_name,
        lm.read_at
    FROM list_chats lc
    LEFT JOIN last_msg lm
        ON lc.id = lm.chat_id AND lm.rn = 1
    WHERE ${categories.sql}
        AND lc.user_referrer_id = ?
    ORDER BY
        (lm.created_at IS NULL) ASC,
        lm.created_at DESC,
        lc.created_at DESC
    LIMIT ? OFFSET ?`,
    [...categories.values, userReferrerId, limit, offset]
  );
  return rows as CrmChatDataInfo[];
}

export async function fetchChatById(chatId: string) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `
        WITH last_msg_chat AS (
            SELECT
                chat_id,
                message,
                content_type,
                metadata,
                created_at,
                ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
            FROM list_messages
        )
        SELECT lc.*, 
        lmc.message AS last_message,
        lmc.content_type AS last_message_content_type,
        lmc.metadata AS last_message_metadata,
        lmc.created_at AS last_message_time
        FROM list_chats lc 
        LEFT JOIN last_msg_chat lmc ON lc.id = lmc.chat_id AND lmc.rn = 1
        WHERE lc.id = ?
    `,
      [chatId]
    );
    return rows[0];
}

// A chat that is already closed keeps its closed_at (the app draws the
// "ticket closed" marker there), so a second close changes nothing.
export async function closeChatById(chatId: string) {
    const [result] = await pool.query(
      "UPDATE list_chats SET status = 'closed', closed_at = NOW() WHERE id = ? AND status <> 'closed'",
      [chatId]
    );
    return (result as any).affectedRows > 0;
}

export async function assignedUserChatData(userId: string) {
    const maxWaitingMinutes = await getMaxWaitingMinutes();
    const [rows] = await pool.query<RowDataPacket[]>(
        `WITH last_msg_admin AS (
            SELECT
                chat_id,
                message,
                created_at,
                ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
            FROM list_messages
            WHERE sender_type = 'admin'
        ),
        last_msg_chat AS (
            SELECT
                chat_id,
                message,
                created_at,
                ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
            FROM list_messages
        )
        SELECT
            lc.*,
            lma.message AS last_message_admin,
            lma.created_at AS last_message_admin_time,
            lmc.message AS last_message,
            lmc.created_at AS last_message_time
        FROM list_chats lc
        LEFT JOIN last_msg_admin lma 
            ON lc.id = lma.chat_id AND lma.rn = 1
        LEFT JOIN last_msg_chat lmc
            ON lc.id = lmc.chat_id AND lmc.rn = 1
        WHERE (lc.status IN ('pending', 'active'))
        AND lma.created_at IS NOT NULL
        AND lma.created_at >= DATE_SUB(NOW(), INTERVAL ${maxWaitingMinutes} MINUTE)
        AND lc.category_id = 1
        AND lc.user_id = ?
        ORDER BY
            (lma.created_at IS NULL) ASC,
            lma.created_at DESC,
            lc.created_at DESC;`,
        [userId]
    );
    return rows[0];
}

export async function waitingUserChatData(userId: string) {
    const maxWaitingMinutes = await getMaxWaitingMinutes();
    const [rows] = await pool.query<RowDataPacket[]>(
        `WITH last_msg_admin AS (
        SELECT
            chat_id,
            message,
            created_at,
            ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
        FROM list_messages
        WHERE sender_type = 'admin'
    ),
    last_msg_chat AS (
        SELECT
            chat_id,
            message,
            created_at,
            ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
        FROM list_messages
    )
    SELECT
        lc.*,
        lmc.message AS last_message,
        lmc.created_at AS last_message_time,
        lm.message AS last_message_admin,
        lm.created_at AS last_message_admin_time
    FROM list_chats lc
    LEFT JOIN last_msg_admin lm 
        ON lc.id = lm.chat_id AND lm.rn = 1
    LEFT JOIN last_msg_chat lmc
        ON lc.id = lmc.chat_id AND lmc.rn = 1
    WHERE (lc.status IN ('pending', 'active'))
        AND (
            lm.created_at IS NULL
            OR lm.created_at <= DATE_SUB(NOW(), INTERVAL ${maxWaitingMinutes} MINUTE)
        )
        AND lc.user_id = ?
        AND lc.category_id = 1
    ORDER BY
        CASE WHEN lm.created_at IS NOT NULL
        THEN lm.created_at
        ELSE lc.created_at
        END ASC,
        lc.created_at DESC;`,
        [userId]
    );
    return rows[0];
}

export async function createNewChat(userId: string, userName: string, userReferrerId: string = "") {
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
    [finalRandString, userId, userName, userReferrerId]
  );

  // Get the created chat
  const [newChat] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM list_chats WHERE id = ?",
    [result.insertId]
  );

  return { chat: newChat[0], isNew: true };
}

export async function userPromotionChatData(userId: string, userName: string) {
    if (userName == "" || userId == "") {
        throw new Error("Invalid userId or userName");
    }
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM list_chats WHERE user_id = ? AND category_id = 2`,
        [userId]
    );
    if (rows.length > 0) {
        return rows[0];
    }
    // if no promotion chat exists, create a new one
    const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO list_chats (chat_ticket, category_id, user_id, user_name, status, created_at) VALUES ('Promotion', 2, ?, ?, 'active', NOW())",
        [userId, userName]
    );
    const [newChat] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM list_chats WHERE id = ?",
        [result.insertId]
    );

    const chatData = newChat[0];

    const io = getIO();
    io.to(`user_${userId}`).emit("new_user_chatroom", { chatData });
    return chatData;
}

// ============================================================================
// PROMOTION CHAT (category_id = 2) - used by the CRM
// ============================================================================

/**
 * The active promotion chat of [userId], if there is one.
 *
 * Only status 'active' counts: a closed promotion chat must not be reopened,
 * so a new one is created instead.
 */
export async function findActivePromotionChat(userId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM list_chats
     WHERE user_id = ? AND category_id = 2 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Opens the promotion chat for [userId]: reuses the active promotion chat
 * when there is one, otherwise creates a new one.
 *
 * [isNew] is true when the chat was just created (used to decide whether the
 * client has to be notified over the socket).
 */
export async function openPromotionChat(userId: string, userName: string) {
  const existing = await findActivePromotionChat(userId);
  if (existing) {
    return { chat: existing, isNew: false };
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO list_chats
       (chat_ticket, category_id, user_id, user_name, status, created_at)
     VALUES ('Promotion', 2, ?, ?, 'active', NOW())`,
    [userId, userName]
  );
  const [newChat] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM list_chats WHERE id = ?",
    [result.insertId]
  );
  const chat = newChat[0];

  // The client is notified too, so the chat shows up in their list.
  const io = getIO();
  io.to(`user_${userId}`).emit("new_user_chatroom", { chatData: chat });

  return { chat, isNew: true };
}

// ============================================================================
// INSIDE SALES CHAT (category_id = 3) - used by the CRM ("Chat with Client")
// ============================================================================

/**
 * The active inside sales chat of [userId] for [userReferrerId].
 *
 * Three conditions must hold:
 *   - category_id = 3 (inside sales)
 *   - user_referrer_id = the sales member who is logged in
 *   - status = 'active'
 *
 * There is only one inside sales chat per user (unique index
 * uq_list_chats_sales_chat), so this check is enough to tell whether the chat
 * already exists.
 */
export async function findActiveInsideSalesChat(
  userId: string,
  userReferrerId: string
) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM list_chats
     WHERE user_id = ? AND category_id = 3 AND status = 'active'
       AND user_referrer_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [userId, userReferrerId]
  );
  return rows[0] ?? null;
}

/**
 * The active inside sales chat of [userId], without the referrer condition.
 *
 * Used as a fallback: the unique index uq_list_chats_sales_chat allows only
 * ONE inside sales chat per user, so an existing chat (even one owned by
 * another sales member) is still that user's only inside sales chat.
 */
export async function findAnyActiveInsideSalesChat(userId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM list_chats
     WHERE user_id = ? AND category_id = 3 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Opens the inside sales chat for [userId]: reuses the existing chat (when
 * its status is still active and it belongs to the same sales member),
 * otherwise creates a new one.
 *
 * [userReferrerId] = member id of the sales member who is logged in (stored in
 * `user_referrer_id`), [adminId] / [adminName] = the admin opening the chat.
 */
export async function openInsideSalesChat(
  userId: string,
  userName: string,
  userReferrerId: string,
  userReferrerName: string,
  adminId: string,
  adminName: string
) {
  const existing = await findActiveInsideSalesChat(userId, userReferrerId);
  if (existing) {
    return { chat: existing, isNew: false };
  }

  const randString = randomNumericString(12);
  const finalRandString = `${randString.slice(0, 4)}-${randString.slice(4, 8)}-${randString.slice(8, 12)}`;

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO list_chats (
         chat_ticket, user_id, user_name, user_referrer_id, user_referrer_name,
         status, category_id, admin_id, admin_name, created_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 3, ?, ?, NOW())`,
      [
        finalRandString,
        userId,
        userName,
        userReferrerId,
        userReferrerName,
        adminId,
        adminName,
      ]
    );
    const [newChat] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM list_chats WHERE id = ?",
      [result.insertId]
    );
    const chat = newChat[0];

    // The client is notified too, so the chat shows up in their list.
    const io = getIO();
    io.to(`user_${userId}`).emit("new_user_chatroom", { chatData: chat });
    // Notify the referenced sales member (user_referrer_id) as well, so their
    // CRM socket can join the new room even while the chat page is closed.
    // Scoped to that member only: the channel is per member id.
    if (userReferrerId) {
      io.to(`user_${userReferrerId}`).emit("new_user_chatroom", { chatData: chat });
    }

    return { chat, isNew: true };
  } catch (err) {
    // Unique index uq_list_chats_sales_chat: a user may only have one inside
    // sales chat. This error means another request created the chat first, so
    // the existing chat is used instead.
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ER_DUP_ENTRY"
    ) {
      // A chat owned by the same sales member is used first.
      const chat = await findActiveInsideSalesChat(userId, userReferrerId);
      if (chat) {
        return { chat, isNew: false };
      }
      // The chat belongs to another sales member: the database only allows
      // one inside sales chat per user, so that chat is opened (owned by the
      // other sales member) instead of creating one that is bound to fail.
      const anyChat = await findAnyActiveInsideSalesChat(userId);
      if (anyChat) {
        return { chat: anyChat, isNew: false };
      }
    }
    throw err;
  }
}
