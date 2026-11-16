import type { Request, Response } from "express";
import { getClientChatUnread } from "../services/clientChatService.js";
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
 * GET /api/client/presence
 * -> { success, data: { customer_support: boolean, sales: boolean } }
 */
export function getClientPresence(_req: Request, res: Response) {
  res.json({ success: true, data: getPresence().teamsStatus() });
}
