import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerTypingSocket,
  type TypingSocket,
} from "../../src/sockets/typingSocket.js";

type Handler = (payload?: unknown) => void;
type Recorded = { room: string; event: string; payload: unknown };

function setup() {
  const handlers: Record<string, Handler> = {};
  const rooms = new Set<string>();
  const recorded: Recorded[] = [];
  const socket = {
    id: "sock1",
    rooms,
    on(event: string, fn: Handler) {
      handlers[event] = fn;
      return socket;
    },
    // socket.to(room) is Socket.IO's "everyone in the room except me"
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          recorded.push({ room, event, payload });
          return true;
        },
      };
    },
  };
  registerTypingSocket(socket as unknown as TypingSocket);
  return { handlers, rooms, recorded };
}

test("registers exactly one listener: typing", () => {
  const { handlers } = setup();
  assert.deepEqual(Object.keys(handlers), ["typing"]);
});

test("relays to chat_<id> through socket.to (sender excluded)", () => {
  const { handlers, rooms, recorded } = setup();
  rooms.add("chat_7");
  handlers.typing!({
    chatId: 7,
    isTyping: true,
    senderId: "a1",
    senderType: "admin",
    senderName: "CS Ani",
  });
  assert.deepEqual(recorded, [
    {
      room: "chat_7",
      event: "typing",
      payload: {
        chatId: "7",
        isTyping: true,
        senderId: "a1",
        senderType: "admin",
        senderName: "CS Ani",
      },
    },
  ]);
});

test("senderName defaults to null", () => {
  const { handlers, rooms, recorded } = setup();
  rooms.add("chat_7");
  handlers.typing!({ chatId: "7", isTyping: false, senderId: "u1", senderType: "user" });
  assert.equal((recorded[0]!.payload as { senderName: unknown }).senderName, null);
});

test("ignored when the socket is not in the chat room", () => {
  const { handlers, recorded } = setup();
  handlers.typing!({ chatId: 7, isTyping: true, senderId: "a1", senderType: "admin" });
  assert.equal(recorded.length, 0);
});

test("ignores malformed payloads without throwing", () => {
  const { handlers, rooms, recorded } = setup();
  rooms.add("chat_7");
  const bad: unknown[] = [
    undefined,
    null,
    {},
    { chatId: "", isTyping: true, senderId: "a", senderType: "user" },
    { chatId: 7, isTyping: "yes", senderId: "a", senderType: "user" },
    { chatId: 7, isTyping: true, senderId: "", senderType: "user" },
    { chatId: 7, isTyping: true, senderId: "a", senderType: "bot" },
    { chatId: { id: 7 }, isTyping: true, senderId: "a", senderType: "user" },
  ];
  for (const payload of bad) {
    assert.doesNotThrow(() => handlers.typing!(payload));
  }
  assert.equal(recorded.length, 0);
});
