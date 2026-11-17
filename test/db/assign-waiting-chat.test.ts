import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/config/db.js";
import { assignWaitingChat, getMaxWaitingMinutes } from "../../src/services/crmChatService.js";
import { cleanupTestChats, getChat, hasDb, insertChat, insertMessage } from "./helpers.js";

after(() => pool.end());

describe("assignWaitingChat", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  let max = 0;

  before(async () => {
    await cleanupTestChats();
    max = await getMaxWaitingMinutes();
  });
  after(cleanupTestChats);

  test("pending chat without admin reply is assigned", async () => {
    const id = await insertChat({ tag: "pending" });
    await insertMessage(id, "user", "test-awc-pending", 5);
    assert.equal(await assignWaitingChat(id, "100063", "CS A"), true);
    assert.deepEqual(await getChat(id), { status: "active", admin_id: "100063", admin_name: "CS A" });
  });

  test("active chat with a recent admin reply is not taken over", async () => {
    const id = await insertChat({ tag: "recent", status: "active", adminId: "A1", adminName: "CS A" });
    await insertMessage(id, "admin", "A1", 1);
    assert.equal(await assignWaitingChat(id, "B2", "CS B"), false);
    assert.equal((await getChat(id)).admin_id, "A1");
  });

  test("active chat whose last admin reply is older than the threshold is taken over", async () => {
    const id = await insertChat({
      tag: "stale",
      status: "active",
      adminId: "A1",
      adminName: "CS A",
      minutesAgo: max + 10,
    });
    await insertMessage(id, "admin", "A1", max + 5);
    assert.equal(await assignWaitingChat(id, "B2", "CS B"), true);
    assert.equal((await getChat(id)).admin_id, "B2");
  });

  test("chat in another category is not assigned", async () => {
    const id = await insertChat({ tag: "promo", categoryId: 2, status: "active" });
    assert.equal(await assignWaitingChat(id, "100063", "CS A"), false);
    assert.equal((await getChat(id)).admin_id, null);
  });

  test("closed chat is not reopened", async () => {
    const id = await insertChat({ tag: "closed", status: "closed" });
    assert.equal(await assignWaitingChat(id, "100063", "CS A"), false);
    assert.equal((await getChat(id)).status, "closed");
  });

  test("unknown chat id returns false", async () => {
    assert.equal(await assignWaitingChat(999999999, "100063", "CS A"), false);
  });
});
