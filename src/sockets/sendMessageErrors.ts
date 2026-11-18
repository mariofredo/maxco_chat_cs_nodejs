import { ChatClosedError } from "../services/chatService.js";
import { FileUploadError } from "../utils/chatFileStorage.js";

export type SendMessageErrorPayload = {
  chat_id: unknown;
  reason: string;
  message?: string;
  maxBytes?: number;
};

/**
 * The `send_message_error` payload for an error the sender must be told
 * about, or null for an error that is only logged on the server.
 */
export function sendMessageErrorPayload(err: unknown, chatId: unknown): SendMessageErrorPayload | null {
  if (err instanceof ChatClosedError) {
    return { chat_id: chatId, reason: "chat_closed" };
  }
  if (err instanceof FileUploadError) {
    return { chat_id: chatId, reason: err.reason, message: err.message, maxBytes: err.maxBytes };
  }
  return null;
}
