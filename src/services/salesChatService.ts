import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../config/db.js";
import { randomNumericString } from "../utils/helper.js";
import { getIO } from "../sockets/io.js";
import { fetchChatById, findAnyActiveInsideSalesChat } from "./crmChatService.js";

// The sales person a client's inside sales chat (category_id = 3) belongs to.
export type SalesPerson = { id: string; name: string };

export type ReassignResult = {
  chat: RowDataPacket;
  // The chat that was closed to make room for the new one, null when none was.
  closedChatId: number | null;
};

// Sales chat changes per user, chained. A reassign and any other change of the
// same user's sales chat must not interleave: both would read "no active chat"
// or the same owner and act on stale data. Chained, the second one runs after
// the first and sees its result. Same pattern as supportChatQueues.
const salesChatQueues = new Map<string, Promise<unknown>>();

/**
 * Runs [task] after the earlier tasks of [userId]. A failed task does not
 * block the next one.
 */
export async function withSalesChatLock<T>(
  userId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = salesChatQueues.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  salesChatQueues.set(userId, current);
  try {
    return await current;
  } finally {
    if (salesChatQueues.get(userId) === current) {
      salesChatQueues.delete(userId);
    }
  }
}

function isDuplicateEntry(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "ER_DUP_ENTRY"
  );
}

function newSalesTicket(): string {
  const randString = randomNumericString(12);
  return `${randString.slice(0, 4)}-${randString.slice(4, 8)}-${randString.slice(8, 12)}`;
}

// The transaction of replaceSalesChat: closes [current] (only while it is still
// active) and inserts the new chat. Its connection is released before the
// caller does anything else.
async function closeAndInsert(
  userId: string,
  userName: string,
  sales: SalesPerson,
  current: RowDataPacket | null,
): Promise<{ closedChatId: number | null; newChatId: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      let closedChatId: number | null = null;
      if (current) {
        const [closed] = await conn.query<ResultSetHeader>(
          "UPDATE list_chats SET status = 'closed', closed_at = NOW() WHERE id = ? AND status = 'active'",
          [current.id],
        );
        if (closed.affectedRows > 0) {
          closedChatId = Number(current.id);
        }
      }
      const [inserted] = await conn.query<ResultSetHeader>(
        `INSERT INTO list_chats (
           chat_ticket, user_id, user_name, user_referrer_id, user_referrer_name,
           status, category_id, admin_id, admin_name, created_at
         ) VALUES (?, ?, ?, ?, ?, 'active', 3, ?, ?, NOW())`,
        [
          newSalesTicket(),
          userId,
          userName || current?.user_name || "",
          sales.id,
          sales.name,
          sales.id,
          sales.name,
        ],
      );
      await conn.commit();
      return { closedChatId, newChatId: inserted.insertId };
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  } finally {
    conn.release();
  }
}

/**
 * Closes [current] (when given) and opens a new active inside sales chat owned
 * by [sales], in one transaction, then announces both. The caller holds
 * withSalesChatLock for [userId].
 *
 * The unique index uq_list_chats_sales_chat allows one ACTIVE inside sales
 * chat per user. When another request created that chat first (ER_DUP_ENTRY)
 * nothing is changed and that chat is returned, with no events.
 *
 * Events, after the commit: chat_closed to the old room (A's CRM and any open
 * screen of the client), new_user_chatroom to the new sales person's CRM and,
 * with [notifyUser], to the client's app.
 */
export async function replaceSalesChat(
  userId: string,
  userName: string,
  sales: SalesPerson,
  current: RowDataPacket | null,
  notifyUser: boolean,
): Promise<ReassignResult> {
  let changed: { closedChatId: number | null; newChatId: number };
  try {
    changed = await closeAndInsert(userId, userName, sales, current);
  } catch (err) {
    if (isDuplicateEntry(err)) {
      // Another request already opened the active chat: it is the answer.
      const winner = await findAnyActiveInsideSalesChat(userId);
      if (winner) {
        return { chat: winner, closedChatId: null };
      }
    }
    throw err;
  }
  const { closedChatId, newChatId } = changed;

  const chat = await fetchChatById(String(newChatId));
  if (!chat) {
    throw new Error(`Sales chat ${newChatId} not found after it was created`);
  }

  const io = getIO();
  if (closedChatId !== null) {
    const closedChat = await fetchChatById(String(closedChatId));
    io.to(`chat_${closedChatId}`).emit("chat_closed", {
      chatId: closedChatId,
      chatData: closedChat,
      reason: "sales_changed",
    });
  }
  // The channel is per member id, so only that sales person's CRM gets it.
  if (sales.id) {
    io.to(`user_${sales.id}`).emit("new_user_chatroom", { chatData: chat });
  }
  if (notifyUser) {
    io.to(`user_${userId}`).emit("new_user_chatroom", { chatData: chat });
  }

  return { chat, closedChatId };
}

/**
 * Moves the inside sales chat of [userId] to [sales] (the CRM's reassign).
 *
 *   - active chat already owned by [sales]: nothing changes;
 *   - active chat owned by someone else: it is closed (kept, with its
 *     messages) and a new active chat is created for [sales];
 *   - no active chat: one is created for [sales].
 */
export async function reassignSalesChat(
  userId: string,
  userName: string,
  sales: SalesPerson,
): Promise<ReassignResult> {
  const id = userId.trim();
  const name = userName.trim();
  const salesPerson = { id: sales.id.trim(), name: sales.name.trim() };

  return withSalesChatLock(id, async () => {
    const current = await findAnyActiveInsideSalesChat(id);
    if (current && String(current.user_referrer_id ?? "").trim() === salesPerson.id) {
      return { chat: current, closedChatId: null };
    }
    return replaceSalesChat(id, name, salesPerson, current, true);
  });
}
