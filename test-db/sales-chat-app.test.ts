import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { setIO } from "../src/sockets/io.js";
import { getUserSalesChat } from "../src/controllers/chatController.js";
import { ensureAppSalesChat, reassignSalesChat } from "../src/services/salesChatService.js";
import { cleanupTestChats, fakeIO, getChat, hasDb, insertChat } from "./helpers.js";

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

const load = (body: Record<string, unknown>) =>
  getUserSalesChat({ body } as unknown as Request, res as unknown as Response);
const app = (userId: string, userReferrerId: unknown, extra: Record<string, unknown> = {}) =>
  load({ userId, userName: "Budi", userReferrerId, userReferrerName: "Sales", source: "app", ...extra });
const salesRows = () => sent.body.data.filter((c: any) => Number(c.category_id) === 3);
const salesChats = async (userId: string) =>
  (await pool.query<RowDataPacket[]>(
    "SELECT id, status, user_referrer_id FROM list_chats WHERE user_id = ? AND category_id = 3 ORDER BY id", [userId]))[0];

describe("app sales chat (source: app)", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);
  beforeEach(() => {
    emitted.length = 0;
    sent.status = 200;
    sent.body = null;
  });

  test("same sales person: the active chat, no salesMismatch", async () => {
    const user = "test-awc-ap-same";
    const b = await insertChat({ tag: "ap-same", userId: user, categoryId: 3, status: "active", referrerId: "sales-b" });
    await app(user, "sales-b");
    assert.deepEqual(salesRows().map((c: any) => Number(c.id)), [b]);
    assert.equal("salesMismatch" in sent.body, false);
  });

  test("different sales person: active chat kept, salesMismatch, nothing changed", async () => {
    const user = "test-awc-ap-diff";
    const b = await insertChat({ tag: "ap-diff", userId: user, categoryId: 3, status: "active", referrerId: "sales-b", referrerName: "Sales B" });
    await app(user, "sales-a");
    assert.equal(sent.status, 200);
    assert.deepEqual(salesRows().map((c: any) => Number(c.id)), [b]);
    assert.deepEqual(sent.body.salesMismatch, { sent: "sales-a", currentReferrerId: "sales-b", currentReferrerName: "Sales B" });
    assert.deepEqual((await salesChats(user)).map((c) => c.status), ["active"]);
    assert.deepEqual(emitted, []);
  });

  test("empty, numeric or padded userReferrerId is not a mismatch", async () => {
    const user = "test-awc-ap-forms";
    await insertChat({ tag: "ap-forms", userId: user, categoryId: 3, status: "active", referrerId: "123" });
    for (const sentId of ["", 123, " 123 "]) {
      await app(user, sentId);
      assert.equal("salesMismatch" in sent.body, false, `sent ${JSON.stringify(sentId)}`);
    }
    assert.equal((await salesChats(user)).length, 1);
  });

  test("no active sales chat: one is created for the app's sales person, only that sales person is told", async () => {
    const user = "test-awc-ap-new";
    await insertChat({ tag: "ap-new-old", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 10, referrerId: "sales-x" });
    await app(user, "sales-a");
    assert.deepEqual(salesRows().map((c: any) => [c.status, c.user_referrer_id]), [["active", "sales-a"]]);
    assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [[["user_sales-a"], "new_user_chatroom"]]);
  });

  test("active sales chat without a sales person is replaced", async () => {
    const user = "test-awc-ap-ownerless";
    const old = await insertChat({ tag: "ap-ownerless", userId: user, categoryId: 3, status: "active" });
    await app(user, "sales-a");
    assert.equal((await getChat(old)).status, "closed");
    assert.deepEqual(salesRows().map((c: any) => c.user_referrer_id), ["sales-a"]);
    assert.equal("salesMismatch" in sent.body, false);
    assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [
      [[`chat_${old}`], "chat_closed"],
      [["user_sales-a"], "new_user_chatroom"],
      [[`user_${user}`], "new_user_chatroom"],
    ]);
  });

  test("closed sales chats are hidden, CS tickets are not, and the count follows", async () => {
    const user = "test-awc-ap-list";
    await insertChat({ tag: "ap-list-s1", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 60, referrerId: "sales-a" });
    const b = await insertChat({ tag: "ap-list-s2", userId: user, categoryId: 3, status: "active", referrerId: "sales-b" });
    await insertChat({ tag: "ap-list-c1", userId: user, categoryId: 1, status: "closed", closedMinutesAgo: 60 });
    await insertChat({ tag: "ap-list-c2", userId: user, categoryId: 1, status: "active" });
    await app(user, "sales-b");
    assert.deepEqual(salesRows().map((c: any) => Number(c.id)), [b]);
    assert.equal(sent.body.data.length, 3);
    await app(user, "sales-b", { page: 1, pageSize: 2 });
    assert.equal(sent.body.pagination.total, 3);
    assert.equal(sent.body.pagination.hasMore, true);
    await app(user, "sales-b", { page: 2, pageSize: 2 });
    assert.equal(sent.body.data.length, 1);
    assert.equal(sent.body.pagination.hasMore, false);
  });

  test("without source: today's behavior", async () => {
    const user = "test-awc-ap-legacy";
    await insertChat({ tag: "ap-legacy-a", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 60, referrerId: "sales-a" });
    await insertChat({ tag: "ap-legacy-b", userId: user, categoryId: 3, status: "active", referrerId: "sales-b" });
    await load({ userId: user, userName: "Budi", userReferrerId: "sales-x", userReferrerName: "X" });
    assert.equal(salesRows().length, 2);
    assert.equal("salesMismatch" in sent.body, false);
    assert.equal((await salesChats(user)).length, 2);
    assert.deepEqual(emitted, []);
  });

  test("without source, no sales chat yet: one active chat for the sent sales person, only that sales person is told", async () => {
    const user = "test-awc-ap-legacy-new";
    await load({ userId: user, userName: "Budi", userReferrerId: "sales-l", userReferrerName: "L" });
    assert.equal(sent.status, 200);
    const chats = await salesChats(user);
    assert.deepEqual(chats.map((c) => [c.status, c.user_referrer_id]), [["active", "sales-l"]]);
    assert.deepEqual(salesRows().map((c: any) => [c.status, c.user_referrer_id]), [["active", "sales-l"]]);
    assert.equal("salesMismatch" in sent.body, false);
    assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [[["user_sales-l"], "new_user_chatroom"]]);
  });

  test("app load and reassign at once leave one active chat", async () => {
    const user = "test-awc-ap-race";
    await Promise.all([
      ensureAppSalesChat(user, "Budi", { id: "sales-a", name: "A" }),
      reassignSalesChat(user, "Budi", { id: "sales-b", name: "B" }),
    ]);
    assert.equal((await salesChats(user)).filter((c) => c.status === "active").length, 1);
  });
});
