import type { Socket } from "socket.io";

export type TypingSocket = Pick<Socket, "id" | "on" | "rooms" | "to">;

/** chatId as a trimmed string; numbers are accepted, everything else is "". */
function normalizeChatId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Typing indicator relay (stateless).
 *
 * `typing { chatId, isTyping, senderId, senderType: "user" | "admin", senderName? }`
 * is forwarded as `typing` to everyone else in room `chat_<chatId>` (the sender
 * is excluded by `socket.to`). The sender must already be in that room
 * (`join_chat`); malformed payloads are ignored silently.
 *
 * No server timer: clients re-send `isTyping: true` while typing and hide the
 * indicator when no refresh arrives, so a dropped socket never leaves it stuck.
 */
export function registerTypingSocket(socket: TypingSocket): void {
  socket.on("typing", (payload: unknown) => {
    if (typeof payload !== "object" || payload === null) return;
    const data = payload as Record<string, unknown>;

    const chatId = normalizeChatId(data.chatId);
    const senderId = nonEmptyString(data.senderId);
    const { isTyping, senderType } = data;
    if (chatId === "" || senderId === "") return;
    if (typeof isTyping !== "boolean") return;
    if (senderType !== "user" && senderType !== "admin") return;

    const room = `chat_${chatId}`;
    if (!socket.rooms.has(room)) return;

    const senderName =
      typeof data.senderName === "string" && data.senderName.trim() !== ""
        ? data.senderName
        : null;
    socket.to(room).emit("typing", { chatId, isTyping, senderId, senderType, senderName });
  });
}
