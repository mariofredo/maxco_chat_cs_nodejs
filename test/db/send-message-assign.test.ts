import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "socket.io";
import { pool } from "../../src/config/db.js";
import { setIO } from "../../src/sockets/io.js";
import { sendMessage } from "../../src/services/chatService.js";
import { fetchPendingChats } from "../../src/services/crmChatService.js";
import { cleanupTestChats, hasDb, insertChat, insertMessage } from "./helpers.js";

after(() => pool.end());

type Emitted = { room: string; event: string; payload: unknown };
const emitted: Emitted[] = [];
setIO({
  to: (room: string) => ({
    emit: (event: string, payload: unknown) => {
      emitted.push({ room, event, payload });
      return true;
    },
  }),
} as unknown as Server);

function adminReply(chatId: number, adminId: string, adminName: string) {
  return sendMessage({
    chat_id: chatId,
    sender_id: adminId,
    sender_type: "admin",
    sender_name: adminName,
    content_type: 1,
    message: "halo",
  });
}

describe("sendMessage assigns waiting chats", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);
  beforeEach(() => {
    emitted.length = 0;
  });

  test("admin reply assigns a waiting chat beyond row 20 of the waiting list", async () => {
    const ids: number[] = [];
    for (let i = 1; i <= 25; i++) {
      const id = await insertChat({ tag: `row${i}`, minutesAgo: 60 - i });
      await insertMessage(id, "user", `test-awc-row${i}`, 60 - i);
      ids.push(id);
    }
    const target = ids[24]!;
    const all = await fetchPendingChats(1, 1000);
    assert.ok(all.findIndex((c) => c.id === target) + 1 > 20, "precondition: target beyond row 20");
    assert.ok(!(await fetchPendingChats()).some((c) => c.id === target), "precondition: not on page 1");

    const res = await adminReply(target, "100063", "CS A");

    assert.equal(res.is_just_assigned, true);
    assert.equal(res.chat_data?.status, "active");
    assert.equal(res.chat_data?.admin_id, "100063");
    assert.deepEqual(emitted, [
      {
        room: `chat_${target}`,
        event: "assigned_admin_chat",
        payload: { chatId: target, adminId: "100063", adminName: "CS A" },
      },
    ]);
  });

  test("user message does not assign", async () => {
    const id = await insertChat({ tag: "user" });
    const res = await sendMessage({
      chat_id: id,
      sender_id: "test-awc-user",
      sender_type: "user",
      sender_name: "U",
      content_type: 1,
      message: "halo",
    });
    assert.equal(res.is_just_assigned, false);
    assert.equal(res.chat_data?.status, "pending");
    assert.equal(res.chat_data?.admin_id, null);
    assert.deepEqual(emitted, []);
  });

  test("second reply of the same admin is not a new assignment", async () => {
    const id = await insertChat({ tag: "twice" });
    assert.equal((await adminReply(id, "100063", "CS A")).is_just_assigned, true);
    emitted.length = 0;
    assert.equal((await adminReply(id, "100063", "CS A")).is_just_assigned, false);
    assert.deepEqual(emitted, []);
  });

  test("another admin replying to a recently answered chat does not take it over", async () => {
    const id = await insertChat({ tag: "other", status: "active", adminId: "A1", adminName: "CS A" });
    await insertMessage(id, "admin", "A1", 1);
    const res = await adminReply(id, "B2", "CS B");
    assert.equal(res.is_just_assigned, false);
    assert.equal(res.chat_data?.admin_id, "A1");
    assert.deepEqual(emitted, []);
  });
});
