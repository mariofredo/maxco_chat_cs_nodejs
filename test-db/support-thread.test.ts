import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/config/db.js";
import { fetchSupportThread, getClientChatUnread } from "../src/services/clientChatService.js";
import { cleanupTestChats, hasDb, insertChat, insertMessage } from "./helpers.js";

after(() => pool.end());

/** Closed CS ticket A (2 messages), open CS ticket B (2), Inside Sales chat C (1). */
async function seedThread(u: string) {
  const a = await insertChat({ tag: `${u}-a`, userId: u, status: "closed", minutesAgo: 600, closedMinutesAgo: 500 });
  await insertMessage(a, "user", u, 590);
  await insertMessage(a, "admin", "A1", 580);
  const b = await insertChat({ tag: `${u}-b`, userId: u, status: "active", minutesAgo: 100 });
  await insertMessage(b, "user", u, 90);
  await insertMessage(b, "admin", "A1", 80);
  const c = await insertChat({ tag: `${u}-c`, userId: u, categoryId: 3, status: "active" });
  await insertMessage(c, "admin", "S1", 70);
  return { a, b };
}

describe("support thread", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);

  test("thread merges CS tickets in time order and skips other categories", async () => {
    const { a, b } = await seedThread("test-awc-th1");
    const t = await fetchSupportThread("test-awc-th1");
    assert.deepEqual(t.messages.map((m) => Number(m.chat_id)), [a, a, b, b]);
    assert.deepEqual(
      t.tickets.map((x) => [x.chat_id, x.status]).sort(),
      [
        [a, "closed"],
        [b, "active"],
      ].sort(),
    );
    assert.ok(t.tickets.find((x) => x.chat_id === a)!.closed_at, "closed ticket has closed_at");
    assert.deepEqual(t.current && [t.current.chat_id, t.current.status], [b, "active"]);
    assert.deepEqual([t.total, t.hasMore], [4, false]);
  });

  test("paging walks back without duplicates", async () => {
    await seedThread("test-awc-th2");
    const p1 = await fetchSupportThread("test-awc-th2", 1, 3);
    const p2 = await fetchSupportThread("test-awc-th2", 2, 3);
    assert.deepEqual([p1.messages.length, p1.hasMore, p2.messages.length, p2.hasMore], [3, true, 1, false]);
    const ids = [...p2.messages, ...p1.messages].map((m) => Number(m.id));
    assert.equal(new Set(ids).size, 4);
    assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
  });

  test("user without CS chats gets an empty thread", async () => {
    const t = await fetchSupportThread("test-awc-th-none");
    assert.deepEqual([t.messages, t.tickets, t.current, t.total], [[], [], null, 0]);
  });

  test("unread counts automated messages", async () => {
    const id = await insertChat({ tag: "th-unread", status: "closed" });
    await insertMessage(id, "system", "system", 0);
    const s = await getClientChatUnread("test-awc-th-unread");
    assert.equal(s.chats.find((c) => c.chatId === String(id))?.unread, 1);
  });

  test("unread leaves out a closed Inside Sales chat, keeps the active one", async () => {
    const u = "test-awc-th-unread-sales";
    const closed = await insertChat({ tag: "th-unread-s1", userId: u, categoryId: 3, status: "closed", closedMinutesAgo: 60, referrerId: "sales-a" });
    await insertMessage(closed, "admin", "sales-a", 30);
    const active = await insertChat({ tag: "th-unread-s2", userId: u, categoryId: 3, status: "active", referrerId: "sales-b" });

    const first = await getClientChatUnread(u);
    assert.equal(first.total, 0);
    assert.deepEqual(first.chats.map((c) => c.chatId), [String(active)]);

    await insertMessage(active, "admin", "sales-b", 10);
    const second = await getClientChatUnread(u);
    assert.equal(second.total, 1);
    assert.deepEqual(second.chats, [{ chatId: String(active), unread: 1 }]);
  });

  test("unread still counts a closed CS ticket", async () => {
    const u = "test-awc-th-unread-cs";
    const closed = await insertChat({ tag: "th-unread-c1", userId: u, categoryId: 1, status: "closed", closedMinutesAgo: 60 });
    await insertMessage(closed, "admin", "A1", 30);
    const s = await getClientChatUnread(u);
    assert.deepEqual(s.chats, [{ chatId: String(closed), unread: 1 }]);
  });
});
