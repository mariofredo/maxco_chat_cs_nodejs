import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { setIO } from "../src/sockets/io.js";
import { ChatClosedError, insertMessageIfOpen, sendMessage } from "../src/services/chatService.js";
import { cleanupTestChats, fakeIO, getMessages, hasDb, insertChat } from "./helpers.js";

after(() => pool.end());

const { io } = fakeIO();
setIO(io);

const send = (chatId: number, senderType: "user" | "admin", senderId: string) =>
  sendMessage({ chat_id: chatId, sender_id: senderId, sender_type: senderType, sender_name: senderId, content_type: 1, message: "hello" });

describe("closed inside sales chats in sendMessage", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);

  test("the old sales person cannot write in a closed sales chat", async () => {
    const chat = await insertChat({ tag: "cs-admin", userId: "test-awc-cs-admin", categoryId: 3, status: "closed", closedMinutesAgo: 5, referrerId: "sales-a" });
    await assert.rejects(send(chat, "admin", "sales-a"), ChatClosedError);
    assert.equal((await getMessages(chat)).length, 0);
  });

  test("the client cannot write in a closed sales chat, and no chat is opened for it", async () => {
    const user = "test-awc-cs-user";
    const chat = await insertChat({ tag: "cs-user", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 5, referrerId: "sales-a" });
    await assert.rejects(send(chat, "user", user), ChatClosedError);
    assert.equal((await getMessages(chat)).length, 0);
    const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM list_chats WHERE user_id = ?", [user]);
    assert.equal(Number(rows[0]!.n), 1);
  });

  test("an active sales chat takes messages", async () => {
    const user = "test-awc-cs-active";
    const chat = await insertChat({ tag: "cs-active", userId: user, categoryId: 3, status: "active", referrerId: "sales-b" });
    const res = await send(chat, "user", user);
    assert.equal(Number(res.chat_id), chat);
    assert.equal((await getMessages(chat)).length, 1);
  });

  test("a closed Promotion chat still takes messages", async () => {
    const chat = await insertChat({ tag: "cs-promo", userId: "test-awc-cs-promo", categoryId: 2, status: "closed", closedMinutesAgo: 5 });
    await send(chat, "admin", "promo-1");
    assert.equal((await getMessages(chat)).length, 1);
  });

  test("insertMessageIfOpen stores nothing in a closed sales chat", async () => {
    const chat = await insertChat({ tag: "cs-race", userId: "test-awc-cs-race", categoryId: 3, status: "closed", closedMinutesAgo: 1 });
    const id = await insertMessageIfOpen({
      chat_id: chat, sender_id: "test-awc-cs-race", sender_type: "user", sender_name: "x",
      message: "late", content_type: 1, content_url: null, metadata: null,
    });
    assert.equal(id, null);
    assert.equal((await getMessages(chat)).length, 0);
  });
});
