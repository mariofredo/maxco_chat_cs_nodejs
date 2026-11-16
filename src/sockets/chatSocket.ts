import { Server, Socket } from "socket.io";
import * as chatService from "../services/chatService.js";
import { sendChatPush } from "../services/pushService.js";

/** Isi notifikasi push: teks pesan, atau label untuk pesan berupa file. */
function buildPushBody(contentType: number, message: string | null): string {
  if (contentType === 1 && message) {
    return message.length > 200 ? `${message.slice(0, 197)}...` : message;
  }
  return "Sent you an attachment";
}

export function registerChatSocket(io: Server, socket: Socket) {
  // user join chat
  socket.on("join_chat", async (data) => {
    const { chatId, userId } = data;
    // await pool.query(
    //   "INSERT INTO list_chats (user_id, status) VALUES (?, 'active')",
    //   [userId]
    // )
    socket.join(`chat_${chatId}`);
    console.log(`User ${userId} join room chat_${chatId}`);
  });

  socket.on("send_message", async (data) => {
    try {
      console.log("Received message:", data);
      const newMessagePayload = await chatService.sendMessage(data);

      // broadcast ke member
      io.to(`chat_${newMessagePayload.chat_id}`).emit(
        "new_message",
        newMessagePayload
      );

      // Push notification ke device client — hanya pesan dari CRM/admin,
      // bukan balasan client sendiri. Fire-and-forget: push tidak boleh
      // menunda broadcast chat.
      if (newMessagePayload.sender_type !== "user") {
        const chatUserId = newMessagePayload.chat_data?.user_id;
        if (chatUserId) {
          void sendChatPush({
            userId: String(chatUserId),
            chatId: String(newMessagePayload.chat_id),
            title: newMessagePayload.sender_name || "Customer Support",
            body: buildPushBody(
              Number(newMessagePayload.content_type),
              newMessagePayload.message
            ),
          });
        }
      }
    } catch (err) {
      console.error("Error handling send_message:", err);
    }
  });


  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });

  socket.on("close_chat", async (data) => {
    const { chatId } = data;
    console.log(`Closing chat ID: ${chatId}`);
    try {
      const success = await chatService.closeChat(chatId);
      const chatData = await chatService.getChatById(chatId);
      if (success) {
        io.to(`chat_${chatId}`).emit("chat_closed", { chatId, chatData });
        console.log(`Chat ${chatId} closed successfully.`);
      } else {
        console.log(`Chat ${chatId} not found or already closed.`);
      } 
    } catch (err) {
      console.error("Error closing chat:", err);
    }
  });

  socket.on("assigned_admin_chat", async (data) => {
    const { chatId, adminId, adminName } = data;
    console.log(`Assigning admin ${adminName} to chat ID: ${chatId}`);

    try {
      const updated = await chatService.assignAdminToChat(chatId, adminId, adminName);
      if (updated) {
        io.to(`chat_${chatId}`).emit("assigned_admin_chat", { chatId, adminId, adminName });
      }
    } catch (err) {
      console.error("Error assigning admin to chat:", err);
    }
  });

  socket.on("join_user", (data) => {
    const { userId } = data;
    socket.join(`user_${userId}`);
    console.log(`User (ID: ${userId}) joined channel user_${userId}`);
  })
}
