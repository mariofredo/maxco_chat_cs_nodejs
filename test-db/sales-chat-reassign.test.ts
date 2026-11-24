import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { setIO } from "../src/sockets/io.js";
import { reassignSalesChat } from "../src/controllers/crmChatController.js";
import { reassignSalesChat as reassignSalesChatService, replaceSalesChat } from "../src/services/salesChatService.js";
import { cleanupTestChats, fakeIO, getChat, getMessages, hasDb, insertChat, insertMessage } from "./helpers.js";

after(() => pool.end());

const { io, emitted } = fakeIO();
setIO(io);

const sent: { status: number; body: any } = { status: 200, body: null };
const res = {
  status(code: number) {
    sent.status = code;
    return res;
  },
  json(body: unknown) {
    sent.body = body;
    return res;
  },
};

const call = (body: Record<string, unknown>) =>
  reassignSalesChat({ body } as unknown as Request, res as unknown as Response);
const B = { user_referrer_id: "sales-b", user_referrer_name: "Sales B" };
const salesChats = async (userId: string) =>
  (await pool.query<RowDataPacket[]>(
    "SELECT id, status, user_referrer_id FROM list_chats WHERE user_id = ? AND category_id = 3 ORDER BY id", [userId]))[0];

describe("CRM reassign sales chat", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);
  beforeEach(() => {
    emitted.length = 0;
    sent.status = 200;
    sent.body = null;
  });

  test("moves the client: A's chat closes, B gets a new active chat", async () => {
    const user = "test-awc-rs-move";
    const old = await insertChat({ tag: "rs-move", userId: user, categoryId: 3, status: "active", referrerId: "sales-a", referrerName: "Sales A" });
    await insertMessage(old, "admin", "sales-a", 5);

    await call({ user_id: user, user_name: "Budi", ...B });

    assert.equal(sent.status, 200);
    assert.equal(sent.body.data.closedChatId, old);
    const chat = sent.body.data.chat;
    assert.notEqual(Number(chat.id), old);
    assert.equal(chat.status, "active");
    assert.equal(Number(chat.category_id), 3);
    assert.equal(chat.user_name, "Budi");
    assert.equal(chat.user_referrer_id, "sales-b");
    assert.equal(chat.user_referrer_name, "Sales B");
    assert.equal(chat.admin_id, "sales-b");
    assert.equal(chat.admin_name, "Sales B");
    assert.equal((await getChat(old)).status, "closed");
    assert.equal((await getMessages(old)).length, 1);
    assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [
      [[`chat_${old}`], "chat_closed"],
      [["user_sales-b"], "new_user_chatroom"],
      [[`user_${user}`], "new_user_chatroom"],
    ]);
    assert.equal(emitted[0]!.payload.reason, "sales_changed");
    assert.equal(Number(emitted[0]!.payload.chatId), old);
    assert.equal(emitted[0]!.payload.chatData.status, "closed");
    assert.equal(Number(emitted[1]!.payload.chatData.id), Number(chat.id));
  });

  test("no sales chat yet: creates B's chat", async () => {
    const user = "test-awc-rs-none";
    await call({ user_id: user, user_name: "Ani", ...B });
    assert.equal(sent.body.data.closedChatId, null);
    assert.equal(sent.body.data.chat.user_referrer_id, "sales-b");
    assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [
      [["user_sales-b"], "new_user_chatroom"],
      [[`user_${user}`], "new_user_chatroom"],
    ]);
  });

  test("only a closed sales chat: B gets a new one, the closed one is untouched", async () => {
    const user = "test-awc-rs-closed";
    const old = await insertChat({ tag: "rs-closed", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 30, referrerId: "sales-a" });
    const closedAt = async () => (await pool.query<RowDataPacket[]>("SELECT closed_at FROM list_chats WHERE id = ?", [old]))[0][0]!.closed_at;
    const before = await closedAt();
    await call({ user_id: user, user_name: "Citra", ...B });
    assert.equal(sent.body.data.closedChatId, null);
    assert.equal(await closedAt(), before);
    assert.deepEqual((await salesChats(user)).map((c) => [c.status, c.user_referrer_id]), [["closed", "sales-a"], ["active", "sales-b"]]);
  });

  test("already B (new name, spaces around the id): nothing changes", async () => {
    const user = "test-awc-rs-same";
    const current = await insertChat({ tag: "rs-same", userId: user, categoryId: 3, status: "active", referrerId: "sales-b", referrerName: "Sales B" });
    await call({ user_id: user, user_name: "Dewi", user_referrer_id: " sales-b ", user_referrer_name: "Sales B (new)" });
    assert.equal(sent.body.data.closedChatId, null);
    assert.equal(Number(sent.body.data.chat.id), current);
    assert.deepEqual(emitted, []);
    assert.equal((await salesChats(user)).length, 1);
  });

  test("missing user_id or user_referrer_id → 400", async () => {
    await call({ user_name: "X", ...B });
    assert.equal(sent.status, 400);
    assert.equal(sent.body.message, "user_id and user_referrer_id are required");
    await call({ user_id: "test-awc-rs-bad", user_referrer_id: "  " });
    assert.equal(sent.status, 400);
    assert.deepEqual(emitted, []);
  });

  test("two reassigns at once leave one active chat", async () => {
    const user = "test-awc-rs-race";
    await insertChat({ tag: "rs-race", userId: user, categoryId: 3, status: "active", referrerId: "sales-a" });
    const sales = { id: "sales-b", name: "Sales B" };
    await Promise.all([reassignSalesChatService(user, "Eka", sales), reassignSalesChatService(user, "Eka", sales)]);
    assert.deepEqual((await salesChats(user)).map((c) => [c.status, c.user_referrer_id]), [["closed", "sales-a"], ["active", "sales-b"]]);
  });

  test("an active chat that appeared meanwhile wins: nothing changes, no events", async () => {
    const user = "test-awc-rs-dup";
    const winner = await insertChat({ tag: "rs-dup", userId: user, categoryId: 3, status: "active", referrerId: "sales-c" });
    const result = await replaceSalesChat(user, "Fani", { id: "sales-b", name: "Sales B" }, null, true);
    assert.equal(result.closedChatId, null);
    assert.equal(Number(result.chat.id), winner);
    assert.deepEqual(emitted, []);
    assert.deepEqual((await salesChats(user)).map((c) => [c.status, c.user_referrer_id]), [["active", "sales-c"]]);
  });
});
