import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { cleanupTestChats, getMessages, hasDb, insertChat, insertMessage } from "./helpers.js";

after(() => pool.end());

describe("migration 10: system sender and auto-close config", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);

  test("a system message can be stored", async () => {
    const id = await insertChat({ tag: "mig-system" });
    await insertMessage(id, "system", "system", 0);
    assert.equal((await getMessages(id))[0]?.sender_type, "system");
  });

  test("auto-close config rows exist", async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT config_key, config_value FROM list_chat_config WHERE config_key IN ('auto_close_minutes', 'auto_close_message')",
    );
    const map = Object.fromEntries(rows.map((r) => [r.config_key, r.config_value]));
    assert.ok(Number.isFinite(Number(map.auto_close_minutes)), "auto_close_minutes is a number");
    assert.match(map.auto_close_message, /\{name\}/);
    assert.match(map.auto_close_message, /\{minutes\}/);
    assert.ok(map.auto_close_message.length <= 255);
  });
});
