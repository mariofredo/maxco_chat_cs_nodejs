import type { Request, Response } from "express";
import { createNewChat, fetchActiveChats, fetchUserChats, getChatById, fetchChatMessages, fetchChatMessagesPage, updateChatStatus, markRead, ensureUserSalesChat } from "../services/chatService.js";
import { getIO } from "../sockets/io.js";

export async function getActiveChats(req: Request, res: Response) {
  console.log("Fetching active chats");
  try {
    const chats = await fetchActiveChats();
    res.json({ success: true, data: chats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getUserChats(req: Request, res: Response) {
  console.log("Fetching chats for user");
  const userId = req.params.userId;
  if (typeof userId !== "string") {
      return res.status(400).json({ success: false, message: "Invalid chat ID" });
    }
  if (!userId) {
    return res.status(400).json({ success: false, message: "Missing userId parameter" });
  }
  try {
    // Pagination is opt-in: without page/pageSize every chat is returned.
    const { page, pageSize } = readPaging(req.query);
    const result = await fetchUserChats(userId, page, pageSize);
    res.json({
      success: true,
      data: result.chats,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getUserSalesChat(req: Request, res: Response) {
  console.log("Fetching chats for user with category 3 ensured");
  const { userId, userName, userReferrerId, userReferrerName } = req.body;
  if (typeof userId !== "string" || !userId) {
    return res.status(400).json({ success: false, message: "Missing user ID" });
  }

  try {
    await ensureUserSalesChat(userId, userName ?? "", userReferrerId ?? "", userReferrerName ?? "");
    // Pagination is opt-in: without page/pageSize every chat is returned.
    const { page, pageSize } = readPaging(req.body);
    const result = await fetchUserChats(userId, page, pageSize);
    res.json({
      success: true,
      data: result.chats,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Reads the paging parameters of a request.
 *
 * Returns undefined for both values when the request asks for no paging at
 * all, which is the signal for the service to return every row.
 */
function readPaging(source: Record<string, unknown>): {
  page?: number;
  pageSize?: number;
} {
  const rawPage = source.page;
  const rawPageSize = source.pageSize;
  if (rawPage === undefined && rawPageSize === undefined) {
    return {};
  }
  return {
    page: Number(rawPage ?? 1) || 1,
    pageSize: Number(rawPageSize ?? 20) || 20,
  };
}

export const createChat = async (req: Request, res: Response) => {
  try {
    const { userId, userName, userReferrerId } = req.body;
    console.log("create chat (client)");
    console.log(req.body);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required"
      });
    }

    const { chat, isNew } = await createNewChat(userId, userName, userReferrerId);

    if (!chat) {
      console.error("createNewChat returned no chat for user", userId);
      return res.status(500).json({
        success: false,
        message: "Failed to create or find chat"
      });
    }

    if (isNew) {
      const io = getIO();
      io.emit("chat_room_created", {
        id: chat.id,
        user_id: chat.user_id,
        chat_ticket: chat.chat_ticket,
        status: chat.status,
        created_at: chat.created_at,
        user_name: chat.user_name
      });
    }

    res.status(isNew ? 201 : 200).json({
      success: true,
      data: chat,
      message: isNew ? "Chat created successfully" : "Returning existing active chat"
    });

  } catch (error) {
    console.error("Error creating chat:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create chat",
      error: error
    });
  }
};

export async function getChatMessages (req: Request, res: Response) {
  console.log(`Fetching messages for chat ${req.params.chatId}`);
  const chatId = req.params.chatId;
  if (typeof chatId !== "string") {
    return res.status(400).json({ success: false, message: "Invalid chat ID" });
  }
  if (!chatId) {
    return res.status(400).json({success: false, message: "Missing chatId paramseter"});
  }
  try {
    const chat = await getChatById(chatId);
    if (!chat) {
      return res.status(404).json({success: false, message: "Chat not found"});
    }
    // Page 1 is the newest messages; the next pages walk back through the
    // history so the client can show older messages when scrolling up.
    const { page, pageSize } = readPaging(req.query);
    const result = await fetchChatMessagesPage(chatId, page ?? 1, pageSize ?? 50);
    res.json({
      success: true,
      data: result.messages,
      pagination: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({success: false, message: "Internal server error"});
  }
}

export async function editChatStatus (req: Request, res: Response) {
  console.log("Updating chat status");
  const chatId = req.body.chatId;
  const status = req.body.status;
  if (!chatId && !status) {
    return res.status(400).json({success: false, message: `Missing some parameters: chatId = ${chatId}, status = ${status}`});
  }
  try {
    const chat = await getChatById(chatId);
    if (!chat) {
      return res.status(404).json({success: false, message: "Chat not found"});
    }
    const successUpdate = await updateChatStatus(chatId, status);
    res.json({success: successUpdate});

  } catch (error) {
    console.error(error);
    res.status(500).json({success: false, message: "Internal server error"});
  }
}

export async function updateReadMessages (req: Request, res: Response) {
  console.log("Updating read messages");
  const chatId = req.params.chatId;
  const userId = req.body.userId;
  if (typeof chatId !== "string") {
      return res.status(400).json({ success: false, message: "Invalid chat ID" });
    }
  if (!chatId && !userId) {
    return res.status(400).json({success: false, message: `Missing some parameters: chatId = ${chatId}, userId = ${userId}`});
  }
  try {
    const chat = await getChatById(chatId!);
    if (!chat) {
      return res.status(404).json({success: false, message: "Chat not found"});
    }
    const successUpdate = await markRead(chatId!, userId!);
    res.json({success: successUpdate});
  } catch (error) {
    console.error(error);
    res.status(500).json({success: false, message: "Internal server error"});
  }
}
