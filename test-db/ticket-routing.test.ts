import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { setIO } from "../src/sockets/io.js";
import { ChatClosedError, insertMessageIfOpen, sendMessage } from "../src/services/chatService.js";
import { cleanupTestChats, fakeIO, getChat, getMessages, hasDb, insertChat } from "./helpers.js";

after(() => pool.end());

const { io } = fakeIO();
setIO(io);

const userMsg = (chatId: number | string, userId: string, name: string | null = "Priya") =>
  sendMessage({
    chat_id: chatId as number,
    sender_id: userId,
    sender_type: "user",
    sender_name: name,
    content_type: 1,
    message: "hi again",
  });

describe("ticket routing in sendMessage", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);

  test("user message to a closed CS chat opens a new ticket", async () => {
    const old = await insertChat({ tag: "rt-new", status: "closed", closedMinutesAgo: 60 });
    await pool.query("UPDATE list_chats SET user_referrer_id = 'REF1' WHERE id = ?", [old]);

    const res = await userMsg(old, "test-awc-rt-new");

    assert.notEqual(Number(res.chat_id), old);
    assert.equal(res.previous_chat_id, old);
    assert.equal(res.is_new_ticket, true);
    assert.equal(res.chat_data?.status, "pending");
    assert.match(String(res.chat_data?.chat_ticket), /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(res.chat_data?.user_id, "test-awc-rt-new");
    assert.equal(res.chat_data?.user_referrer_id, "REF1");
    assert.equal((await getChat(old)).status, "closed");
    assert.equal((await getMessages(old)).length, 0);
    assert.equal((await getMessages(Number(res.chat_id))).length, 1);
  });

  test("string chat_id is rerouted too", async () => {
    const old = await insertChat({ tag: "rt-str", status: "closed" });
    assert.equal((await userMsg(String(old), "test-awc-rt-str")).previous_chat_id, old);
  });

  test("an open CS chat of the user is reused", async () => {
    const old = await insertChat({ tag: "rt-reuse-a", userId: "test-awc-rt-reuse", status: "closed" });
    const open = await insertChat({ tag: "rt-reuse-b", userId: "test-awc-rt-reuse", status: "active" });
    const res = await userMsg(old, "test-awc-rt-reuse");
    assert.equal(Number(res.chat_id), open);
    assert.equal(res.is_new_ticket, false);
    assert.equal(res.previous_chat_id, old);
  });

  test("two messages at once open one ticket", async () => {
    const old = await insertChat({ tag: "rt-race", status: "closed" });
    const [a, b] = await Promise.all([userMsg(old, "test-awc-rt-race"), userMsg(old, "test-awc-rt-race")]);
    assert.equal(a.chat_id, b.chat_id);
    assert.equal([a, b].filter((r) => r.is_new_ticket).length, 1);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM list_chats
       WHERE user_id = 'test-awc-rt-race' AND category_id = 1 AND status IN ('pending', 'active')`,
    );
    assert.equal(Number(rows[0]!.n), 1);
  });

  test("new ticket takes the sender name when the old chat has none", async () => {
    const old = await insertChat({ tag: "rt-noname", status: "closed", userName: null });
    assert.equal((await userMsg(old, "test-awc-rt-noname", "Priya")).chat_data?.user_name, "Priya");
  });

  test("admin message to a closed CS chat is rejected and not stored", async () => {
    const id = await insertChat({ tag: "rt-admin", status: "closed" });
    await assert.rejects(
      sendMessage({ chat_id: id, sender_id: "A1", sender_type: "admin", sender_name: "CS", content_type: 1, message: "late" }),
      ChatClosedError,
    );
    assert.equal((await getMessages(id)).length, 0);
  });

  test("admin message to a closed Promotion chat is stored as today", async () => {
    const id = await insertChat({ tag: "rt-promo", categoryId: 2, status: "closed" });
    const res = await sendMessage({
      chat_id: id,
      sender_id: "A1",
      sender_type: "admin",
      sender_name: "CS",
      content_type: 1,
      message: "promo",
    });
    assert.equal(Number(res.chat_id), id);
    assert.equal(res.previous_chat_id, null);
    assert.equal((await getMessages(id)).length, 1);
  });

  test("user message to a closed Inside Sales chat is refused, not rerouted", async () => {
    const id = await insertChat({ tag: "rt-sales", categoryId: 3, status: "closed" });
    await assert.rejects(userMsg(id, "test-awc-rt-sales"), ChatClosedError);
    assert.equal((await getMessages(id)).length, 0);
  });

  test("user message to an open CS chat is unchanged", async () => {
    const id = await insertChat({ tag: "rt-open", status: "active" });
    const res = await userMsg(id, "test-awc-rt-open");
    assert.deepEqual([Number(res.chat_id), res.previous_chat_id, res.is_new_ticket], [id, null, false]);
  });

  test("a user cannot open a ticket from another user's closed chat", async () => {
    const victim = await insertChat({ tag: "rt-owner", status: "closed" });
    await assert.rejects(userMsg(victim, "test-awc-rt-intruder"), /does not own/);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM list_chats WHERE user_id = 'test-awc-rt-owner'",
    );
    assert.equal(Number(rows[0]!.n), 1, "no new ticket for the owner");
    assert.equal((await getMessages(victim)).length, 0);
  });

  test("owner id sent as a number still opens the new ticket", async () => {
    const old = await insertChat({ tag: "rt-numid", userId: "777001", status: "closed" });
    try {
      const res = await sendMessage({
        chat_id: old,
        sender_id: 777001 as unknown as string,
        sender_type: "user",
        sender_name: "N",
        content_type: 1,
        message: "hi",
      });
      assert.equal(res.previous_chat_id, old);
    } finally {
      await pool.query(
        "DELETE m FROM list_messages m JOIN list_chats c ON c.id = m.chat_id WHERE c.user_id = '777001'",
      );
      await pool.query("DELETE FROM list_chats WHERE user_id = '777001'");
    }
  });

  test("insert step refuses a CS ticket that closed after routing", async () => {
    const id = await insertChat({ tag: "rt-gap", status: "closed" });
    const row = {
      chat_id: id,
      sender_id: "test-awc-rt-gap",
      sender_type: "user",
      sender_name: "U",
      message: "late reply",
      content_type: 1,
      content_url: null,
      metadata: null,
    };
    assert.equal(await insertMessageIfOpen(row), null);
    assert.equal((await getMessages(id)).length, 0);

    const open = await insertChat({ tag: "rt-gap-open", status: "active" });
    assert.ok(await insertMessageIfOpen({ ...row, chat_id: open }));
    const promo = await insertChat({ tag: "rt-gap-promo", categoryId: 2, status: "closed" });
    assert.ok(await insertMessageIfOpen({ ...row, chat_id: promo }), "only CS tickets are gated");
  });

  test("a client cannot send a system message", async () => {
    const id = await insertChat({ tag: "rt-forge", status: "active" });
    await assert.rejects(
      sendMessage({ chat_id: id, sender_id: "x", sender_type: "system", sender_name: "x", content_type: 1, message: "fake" }),
      /Invalid sender_type/,
    );
    assert.equal((await getMessages(id)).length, 0);
  });
});
