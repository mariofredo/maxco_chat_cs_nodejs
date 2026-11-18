import type { Server, Socket } from "socket.io";

/** The fields of a `sendMessage` result that decide how it is delivered. */
export type SentMessage = {
  chat_id: number | string;
  previous_chat_id: number | null;
  is_new_ticket: boolean;
  chat_data: {
    id: number;
    user_id: string;
    user_name?: string | null;
    chat_ticket: string;
    status: string;
    created_at: unknown;
  } | null;
  [key: string]: unknown;
};

/**
 * Broadcasts a stored message.
 *
 * A normal message goes to its chat room. A message that was addressed to a
 * closed ticket and stored in the user's open ticket (`previous_chat_id` set)
 * also moves the sender into that ticket's room, reaches the user's other
 * devices through `user_<id>` (once per socket: the rooms are chained), tells
 * the user's sockets to join the room (`new_user_chatroom`) and, for a ticket
 * that was just created, puts it in the CRM waiting list (`chat_room_created`).
 */
export function deliverSentMessage(
  io: Pick<Server, "to" | "emit">,
  socket: Pick<Socket, "join">,
  msg: SentMessage,
): void {
  const chatRoom = `chat_${msg.chat_id}`;
  const chat = msg.chat_data;
  if (msg.previous_chat_id === null || !chat) {
    io.to(chatRoom).emit("new_message", msg);
    return;
  }

  const userRoom = `user_${chat.user_id}`;
  void socket.join(chatRoom);
  io.to(chatRoom).to(userRoom).emit("new_message", msg);
  io.to(userRoom).emit("new_user_chatroom", { chatData: chat });
  if (msg.is_new_ticket) {
    io.emit("chat_room_created", {
      id: chat.id,
      user_id: chat.user_id,
      chat_ticket: chat.chat_ticket,
      status: chat.status,
      created_at: chat.created_at,
      user_name: chat.user_name,
    });
  }
}
