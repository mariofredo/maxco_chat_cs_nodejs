import type { Request, Response } from "express";
import { fetchSupportThread, getClientChatUnread } from "../services/clientChatService.js";
import { getPresence } from "../services/presenceRuntime.js";

/**
 * GET /api/client/chat/unread/:userId
 * -> { success, data: { total, chats: [{ chatId, unread }] } }
 */
export async function getUnread(req: Request, res: Response) {
  const userId = req.params.userId;
  if (typeof userId !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "Invalid userId parameter" });
  }
  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "Missing userId parameter" });
  }

  try {
    const summary = await getClientChatUnread(userId);
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error("Error reading client unread summary:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * GET /api/client/chat/support-thread/:userId?page=1&pageSize=50
 * -> { success, data: { messages, tickets, current }, pagination: { total, page, pageSize, hasMore } }
 *
 * Every Customer Support ticket of the user as one thread (newest page first).
 */
export async function getSupportThread(req: Request, res: Response) {
  const userId = req.params.userId;
  if (typeof userId !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "Invalid userId parameter" });
  }
  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "Missing userId parameter" });
  }

  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.max(1, Number(req.query.pageSize ?? 50) || 50);
  try {
    const thread = await fetchSupportThread(userId, page, pageSize);
    res.json({
      success: true,
      data: {
        messages: thread.messages,
        tickets: thread.tickets,
        current: thread.current,
      },
      pagination: {
        total: thread.total,
        page: thread.page,
        pageSize: thread.pageSize,
        hasMore: thread.hasMore,
      },
    });
  } catch (err) {
    console.error("Error reading support thread:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * GET /api/client/presence
 * -> { success, data: { customer_support: boolean, sales: boolean } }
 */
export function getClientPresence(_req: Request, res: Response) {
  res.json({ success: true, data: getPresence().teamsStatus() });
}
