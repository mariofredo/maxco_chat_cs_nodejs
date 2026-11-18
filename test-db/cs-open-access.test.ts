import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { pool } from "../src/config/db.js";
import { fetchActiveChats, getMaxWaitingMinutes } from "../src/services/crmChatService.js";
import { createUserServiceChat } from "../src/controllers/crmChatController.js";
import { cleanupTestChats, hasDb, insertChat, insertMessage } from "./helpers.js";

after(() => pool.end());

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

describe("every CS sees and opens handled chats", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);
  beforeEach(() => {
    sent.status = 200;
    sent.body = null;
  });

  test("a chat handled by CS A is in CS B's assigned list, with its PIC", async () => {
    const id = await insertChat({ tag: "oa-handled", status: "active", adminId: "A1", adminName: "CS A" });
    await insertMessage(id, "user", "test-awc-oa-handled", 10);
    await insertMessage(id, "admin", "A1", 5);
    const rows = (await fetchActiveChats("B2", 1, 1000)) as any[];
    const row = rows.find((r) => r.id === id);
    assert.ok(row, "visible to another CS");
    assert.equal(row.admin_name, "CS A");
    assert.equal(row.last_message_admin, "test message");
  });

  test("a chat whose last CS reply is older than the window stays out of the assigned list", async () => {
    const max = await getMaxWaitingMinutes();
    const id = await insertChat({ tag: "oa-stale", status: "active", adminId: "A1" });
    await insertMessage(id, "admin", "A1", max + 5);
    assert.ok(!((await fetchActiveChats("B2", 1, 1000)) as any[]).some((r) => r.id === id));
  });

  test("create_service_chat returns the chat to another CS instead of 401", async () => {
    const id = await insertChat({ tag: "oa-open", status: "active", adminId: "A1", adminName: "CS A" });
    await createUserServiceChat(
      { body: { user_id: "test-awc-oa-open", user_name: "U", admin_id: "B2" } } as unknown as Request,
      res as unknown as Response,
    );
    assert.equal(sent.status, 200);
    assert.equal(sent.body.success, true);
    assert.equal(sent.body.chatData.id, id);
  });
});
