import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server, Socket } from "socket.io";
import { deliverSentMessage } from "../../src/sockets/messageDelivery.js";

type Emitted = { rooms: string[]; event: string; payload: any };

function setup() {
  const emitted: Emitted[] = [];
  const joined: string[] = [];
  const operator = (rooms: string[]) => ({
    to: (room: string) => operator([...rooms, room]),
    emit: (event: string, payload: unknown) => {
      emitted.push({ rooms, event, payload });
      return true;
    },
  });
  const io = {
    to: (room: string) => operator([room]),
    emit: (event: string, payload: unknown) => {
      emitted.push({ rooms: ["*"], event, payload });
      return true;
    },
  } as unknown as Server;
  const socket = {
    join: (room: string) => {
      joined.push(room);
    },
  } as unknown as Socket;
  return { io, socket, emitted, joined };
}

function chat(id: number) {
  return {
    id,
    user_id: "u1",
    user_name: "Priya",
    chat_ticket: "AAAA-BBBB-CCCC",
    status: "pending",
    created_at: "2026-11-18 10:02:00",
  };
}

test("normal message goes to its chat room only", () => {
  const { io, socket, emitted, joined } = setup();
  deliverSentMessage(io, socket, { chat_id: 5, previous_chat_id: null, is_new_ticket: false, chat_data: chat(5) });
  assert.deepEqual(joined, []);
  assert.deepEqual(
    emitted.map((e) => [e.rooms, e.event]),
    [[["chat_5"], "new_message"]],
  );
});

test("new ticket: join, deliver to new room and user channel, announce", () => {
  const { io, socket, emitted, joined } = setup();
  const data = chat(11);
  const msg = { chat_id: 11, previous_chat_id: 10, is_new_ticket: true, chat_data: data, message: "hi again" };
  deliverSentMessage(io, socket, msg);
  assert.deepEqual(joined, ["chat_11"]);
  assert.deepEqual(
    emitted.map((e) => [e.rooms, e.event]),
    [
      [["chat_11", "user_u1"], "new_message"],
      [["user_u1"], "new_user_chatroom"],
      [["*"], "chat_room_created"],
    ],
  );
  assert.equal(emitted[0]!.payload, msg);
  assert.deepEqual(emitted[1]!.payload, { chatData: data });
  assert.deepEqual(emitted[2]!.payload, {
    id: 11,
    user_id: "u1",
    chat_ticket: "AAAA-BBBB-CCCC",
    status: "pending",
    created_at: "2026-11-18 10:02:00",
    user_name: "Priya",
  });
});

test("reroute to an existing open ticket does not announce a new room", () => {
  const { io, socket, emitted, joined } = setup();
  deliverSentMessage(io, socket, { chat_id: 12, previous_chat_id: 10, is_new_ticket: false, chat_data: chat(12) });
  assert.deepEqual(joined, ["chat_12"]);
  assert.ok(!emitted.some((e) => e.event === "chat_room_created"));
});

test("reroute without chat data falls back to the chat room", () => {
  const { io, socket, emitted } = setup();
  deliverSentMessage(io, socket, { chat_id: 13, previous_chat_id: 10, is_new_ticket: true, chat_data: null });
  assert.deepEqual(
    emitted.map((e) => [e.rooms, e.event]),
    [[["chat_13"], "new_message"]],
  );
});
