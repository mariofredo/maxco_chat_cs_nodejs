import type { Request, Response } from "express";
import { fetchPendingChats, fetchClosedChat, fetchChatById, fetchActiveChats, fetchReferredChats, closeChatById, assignedUserChatData, waitingUserChatData, createNewChat, userPromotionChatData, openPromotionChat as openPromotionChatService, openInsideSalesChat as openInsideSalesChatService, getMaxWaitingMinutes } from "../services/crmChatService.js";
import { FileUploadError, saveChatFile } from "../utils/chatFileStorage.js";
import { getIO } from "../sockets/io.js";
import { fetchChatMessages, getChatById, markUpdateReadAt } from "../services/chatService.js";
import { getPresence } from "../services/presenceRuntime.js";
import { parseUserIds, MAX_USER_IDS } from "../utils/presenceInput.js";

export async function getCrmChatConfig(req: Request, res: Response) {
  console.log("Fetching chat config");
  try {
    const maxWaitingMinutes = await getMaxWaitingMinutes();
    res.json({ success: true, data: { maxWaitingMinutes } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getCrmPendingChat(req: Request, res: Response) {
  console.log("Fetching pending chats");
  // Load only one page from DB instead of every pending chat.
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 20);
  // Optional filters: chat categories ("1,2" or [1, 2]) and the sales member
  // whose referred chats are wanted. Nothing sent = old behaviour (category 1).
  const categoryIds = asCategoryInput(req.query.categoryIds);
  const userReferrerId = asOptionalString(req.query.userReferrerId);
  try {
    const chats = await fetchPendingChats(page, pageSize, categoryIds, userReferrerId);
    res.json({ success: true, data: chats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getCrmClosedChat(req: Request, res: Response) {
  console.log("Fetching closed chats");
  // Load only one page from DB instead of every closed chat.
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 20);
  const categoryIds = asCategoryInput(req.query.categoryIds);
  const userReferrerId = asOptionalString(req.query.userReferrerId);
  try {
    const chats = await fetchClosedChat(page, pageSize, categoryIds, userReferrerId);
    res.json({ success: true, data: chats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getCrmActiveChat(req: Request, res: Response) {
  console.log("Fetching active chats");
  const { adminId, page, pageSize, categoryIds, userReferrerId } = req.body;
  try {
    const chats = await fetchActiveChats(
      adminId ?? "",
      Number(page ?? 1),
      Number(pageSize ?? 20),
      categoryIds ?? null,
      asOptionalString(userReferrerId),
    );
    res.json({ success: true, data: chats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Single (flat) list of the chats referred by a sales member. The CRM sales
 * view has no Assigned / Waiting / Closed tabs: it only shows this list, so
 * the server filters by `user_referrer_id` and returns every status.
 */
export async function getCrmReferredChat(req: Request, res: Response) {
  const { userReferrerId, page, pageSize, categoryIds } = req.body;
  console.log(`Fetching referred chats for sales ${userReferrerId ?? ""}`);
  if (!asOptionalString(userReferrerId)) {
    return res.status(400).json({
      success: false,
      message: "userReferrerId is required",
    });
  }
  try {
    const chats = await fetchReferredChats(
      String(userReferrerId),
      Number(page ?? 1),
      Number(pageSize ?? 20),
      categoryIds ?? null,
    );
    res.json({ success: true, data: chats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/** Empty string / null / undefined -> undefined, so the SQL filter stays off. */
function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

/**
 * Query-string shape of a category filter ("1,2", repeated keys or nothing).
 * An unexpected shape (nested query object) is ignored, which keeps the SQL
 * filter at its default.
 */
function asCategoryInput(value: unknown): string | string[] | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") return value;
  return null;
}

export async function getChatInfo(req: Request, res: Response) {
  const { chatId } = req.params;
  console.log(`Fetching info for chat ID: ${chatId}`);
  try {
    // Assuming a service function fetchChatById exists
    if (typeof chatId !== "string") {
      return res.status(400).json({ success: false, message: "Invalid chat ID" });
    }
    const chat = await fetchChatById(chatId ?? "0");
    if (chat) {
      res.json({ success: true, data: chat });
    } else {
      res.status(404).json({ success: false, message: "Chat not found" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function uploadChatFile(req: Request, res: Response) {
  // Implementation for file upload handling
  console.log("Uploading chat file");
  try {
    const checkUpload = await saveChatFile(req.body.fileName, req.body.fileDataBase64);
    const fullUrl = `${checkUpload.contentUrl}`;
    res.json({ success: true, message: "File uploaded successfully", data: {file_url : fullUrl} });
  } catch (err) {
    if (err instanceof FileUploadError) {
      return res.status(400).json({
        success: false,
        reason: err.reason,
        message: err.message,
        maxBytes: err.maxBytes,
      });
    }
    console.error(err);
    return res.status(500).json({ success: false, message: "File upload failed" });
  }
}

export async function crmCloseChat(req: Request, res: Response) {
  const { chatId } = req.body;
  console.log(`Closing chat ID: ${chatId}`);
  try {
    // Assuming a service function closeChatById exists
    const success = await closeChatById(chatId);
    if (success) {
      const data = await fetchChatById(chatId);
      // Tell the room (the user's app included), same as the socket close_chat.
      getIO().to(`chat_${chatId}`).emit("chat_closed", { chatId, chatData: data, reason: "agent" });
      res.json({ success: true, message: "Chat closed successfully", data: data });
    } else {
      // Already closed (for example by the automated close): same success
      // for the CRM, nothing changed and nothing is announced again.
      const existing = await fetchChatById(chatId);
      if (existing && existing.status === "closed") {
        res.json({ success: true, message: "Chat already closed", data: existing });
      } else {
        res.status(404).json({ success: false, message: "Chat not found or could not be closed" });
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getCurrentServiceChat(req: Request, res: Response) {
  console.log("Fetching current service chat");
  try {
    const { user_id } = req.body;
    const chatData = await assignedUserChatData(user_id ?? "");
    if (chatData != null) {
      res.json({ success: true, data: {chatData: chatData, isAssigned: true} });
    } else {
      const userWaitingChat = await waitingUserChatData(user_id ?? "");
      if (userWaitingChat != null) {
        res.json({ success: true, data: {chatData: userWaitingChat, isAssigned: false} });
      } else {
        res.json({ success: true, data: { chatData: null, isAssigned: false } });
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export const createUserServiceChat = async (req: Request, res: Response) => {
  try {
    const { user_id, user_name, admin_id, user_referrer_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required"
      });
    }

    const { chat, isNew } = await createNewChat(user_id, user_name, user_referrer_id);

    if (!chat) {
      console.error("createNewChat returned no chat for user", user_id);
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
        created_at: chat.created_at
      });
    }
    // Any CS may open a chat handled by another CS (the PIC is informative).

    const dataChat = await fetchChatById(chat.id.toString());

    res.status(isNew ? 201 : 200).json({
      success: true,
      chatData: dataChat,
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

export async function getCrmChatMessages (req: Request, res: Response) {
  console.log(`Fetching crm chat messages for chat ${req.body.chatId}`);
  const { chatId, updateRead, userId, page, pageSize } = req.body;
  if (!chatId) {
    return res.status(400).json({success: false, message: "Missing chatId paramseter"});
  }
  try {
    const chat = await getChatById(chatId);
    if (!chat) {
      return res.status(404).json({success: false, message: "Chat not found"});
    }
    if (updateRead) {
      await markUpdateReadAt(chatId, userId);
    }
    // Pagination is DB-side so a room with a long history does not pull every message.
    const messages = await fetchChatMessages(
      chatId,
      Number(page ?? 1),
      Number(pageSize ?? 50),
    );
    
    res.json({success: true, data: messages});

  } catch (err) {
    console.error(err);
    res.status(500).json({success: false, message: "Internal server error"});
  }
}

export async function getCurrentPromotionChat(req: Request, res: Response) {
  console.log("Fetching current promotion chat");
  try {
    const { user_id, user_name } = req.body;
    if (!user_id || !user_name) {
      return res.status(400).json({ success: false, message: "Invalid selected user" });
    }
    const chatData = await userPromotionChatData(user_id ?? "", user_name ?? "");
    res.json({ success: true, data: chatData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Opens the promotion chat (category_id = 2) for the selected user.
 *
 * When the user already has an active promotion chat, that existing chat is
 * opened (no new chat is created). When there is none, it is created.
 */
export async function openPromotionChat(req: Request, res: Response) {
  console.log("Opening promotion chat");
  try {
    const { user_id, user_name } = req.body;
    if (!user_id || !user_name) {
      return res.status(400).json({ success: false, message: "Invalid selected user" });
    }
    const { chat, isNew } = await openPromotionChatService(
      user_id ?? "",
      user_name ?? ""
    );
    res.status(isNew ? 201 : 200).json({
      success: true,
      data: chat,
      isNew,
      message: isNew
        ? "Promotion chat created"
        : "Returning existing promotion chat",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Opens the inside sales chat (category_id = 3) for the selected user.
 *
 * When the user already has an active inside sales chat for the sales member
 * who is logged in, that existing chat is opened (no new chat is created).
 * When there is none, it is created.
 */
export async function openInsideSalesChat(req: Request, res: Response) {
  console.log("Opening inside sales chat");
  try {
    const {
      user_id,
      user_name,
      user_referrer_id,
      user_referrer_name,
      admin_id,
      admin_name,
    } = req.body;
    if (!user_id || !user_name || !user_referrer_id) {
      return res.status(400).json({
        success: false,
        message: "user_id, user_name and user_referrer_id are required",
      });
    }
    const { chat, isNew } = await openInsideSalesChatService(
      user_id ?? "",
      user_name ?? "",
      user_referrer_id ?? "",
      user_referrer_name ?? "",
      admin_id ?? "",
      admin_name ?? ""
    );
    res.status(isNew ? 201 : 200).json({
      success: true,
      data: chat,
      isNew,
      message: isNew
        ? "Inside sales chat created"
        : "Returning existing inside sales chat",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * GET /api/chats/crm/presence?userIds=a,b,c
 * -> { success, data: { "<userId>": boolean } }
 *
 * Initial online state of the users shown in the CRM; later changes arrive as
 * the `presence_user_changed` socket event.
 */
export function getCrmUsersPresence(req: Request, res: Response) {
  const userIds = parseUserIds(req.query.userIds);
  if (userIds.length === 0) {
    return res.status(400).json({ success: false, message: "userIds is required" });
  }
  if (userIds.length > MAX_USER_IDS) {
    return res.status(400).json({
      success: false,
      message: `userIds supports at most ${MAX_USER_IDS} ids`,
    });
  }
  res.json({ success: true, data: getPresence().usersStatus(userIds) });
}
