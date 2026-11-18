// Never calls runAutoClose(): it scans every chat in the database. The tests
// only look at, and only close, the chats they create.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { setIO } from "../src/sockets/io.js";
import { closeIdleChat, findAutoCloseCandidates } from "../src/services/autoCloseService.js";
import { cleanupTestChats, fakeIO, getChat, getMessages, hasDb, insertChat, insertMessage } from "./helpers.js";

after(() => pool.end());

const { io, emitted } = fakeIO();
setIO(io);

describe("auto-close of idle Customer Support chats", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);
  beforeEach(() => {
    emitted.length = 0;
  });

  test("candidates follow the idle rule", async () => {
    const idle = await insertChat({ tag: "ac-idle", status: "active" });
    await insertMessage(idle, "user", "test-awc-ac-idle", 15);
    await insertMessage(idle, "admin", "A1", 11);
    const userLast = await insertChat({ tag: "ac-user" });
    await insertMessage(userLast, "admin", "A1", 30);
    await insertMessage(userLast, "user", "test-awc-ac-user", 20);
    const fresh = await insertChat({ tag: "ac-fresh" });
    await insertMessage(fresh, "admin", "A1", 9);
    const old = await insertChat({ tag: "ac-old" });
    await insertMessage(old, "admin", "A1", 75);
    const promo = await insertChat({ tag: "ac-promo", categoryId: 2, status: "active" });
    await insertMessage(promo, "admin", "A1", 11);
    const closed = await insertChat({ tag: "ac-closed", status: "closed" });
    await insertMessage(closed, "admin", "A1", 11);
    const empty = await insertChat({ tag: "ac-empty" });

    const ids = await findAutoCloseCandidates(10);
    assert.ok(ids.includes(idle), "idle chat is a candidate");
    for (const id of [userLast, fresh, old, promo, closed, empty]) {
      assert.ok(!ids.includes(id), `chat ${id} must not be a candidate`);
    }
  });

  test("closeIdleChat closes, stores the automated message and emits", async () => {
    const id = await insertChat({ tag: "ac-close", status: "active" });
    await insertMessage(id, "admin", "A1", 11);
    emitted.length = 0;

    assert.equal(await closeIdleChat(id, 10, "Hi {name}, {minutes} min"), true);

    assert.equal((await getChat(id)).status, "closed");
    const last = (await getMessages(id)).at(-1)!;
    assert.deepEqual(
      { t: last.sender_type, s: last.sender_id, n: last.sender_name, m: last.message, meta: last.metadata },
      { t: "system", s: "system", n: "Maxco Customer Support", m: "Hi Test ac-close, 10 min", meta: { type: "auto_close" } },
    );
    assert.deepEqual(
      emitted.map((e) => [e.rooms, e.event]),
      [
        [[`chat_${id}`], "new_message"],
        [[`chat_${id}`], "chat_closed"],
      ],
    );
    assert.equal(emitted[0]!.payload.sender_type, "system");
    assert.equal(emitted[0]!.payload.chat_id, id);
    assert.equal(emitted[1]!.payload.chatId, id);
    assert.equal(emitted[1]!.payload.reason, "auto_no_reply");
    assert.equal(emitted[1]!.payload.chatData.status, "closed");
  });

  test("automated message is stamped with the close time", async () => {
    const id = await insertChat({ tag: "ac-stamp", status: "active" });
    await insertMessage(id, "admin", "A1", 11);
    assert.equal(await closeIdleChat(id, 10, "x"), true);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.closed_at, m.created_at FROM list_chats c
       JOIN list_messages m ON m.chat_id = c.id AND m.sender_type = 'system'
       WHERE c.id = ?`,
      [id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.created_at, rows[0]!.closed_at);
  });

  test("closeIdleChat twice stores one automated message", async () => {
    const id = await insertChat({ tag: "ac-twice", status: "active" });
    await insertMessage(id, "admin", "A1", 11);
    assert.equal(await closeIdleChat(id, 10, "x"), true);
    assert.equal(await closeIdleChat(id, 10, "x"), false);
    assert.equal((await getMessages(id)).filter((m) => m.sender_type === "system").length, 1);
  });

  test("closeIdleChat does nothing once the user has replied", async () => {
    const id = await insertChat({ tag: "ac-replied", status: "active" });
    await insertMessage(id, "admin", "A1", 11);
    await insertMessage(id, "user", "test-awc-ac-replied", 0);
    emitted.length = 0;
    assert.equal(await closeIdleChat(id, 10, "x"), false);
    assert.equal((await getChat(id)).status, "active");
    assert.deepEqual(emitted, []);
  });
});
