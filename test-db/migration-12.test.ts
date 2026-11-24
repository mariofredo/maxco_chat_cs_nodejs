import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { cleanupTestChats, getMessages, hasDb, insertChat, insertMessage, runSqlFile } from "./helpers.js";

after(() => pool.end());

const MIGRATION_12 = "sql/dbchanges_202611241200.sql";
const MIGRATION_11 = "sql/dbchanges_202611161515.sql";
const salesChatCount = async (userId: string) =>
  Number((await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM list_chats WHERE user_id = ? AND category_id = 3", [userId]))[0][0]!.n);

describe("migration 12: one active sales chat per user", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(async () => { await cleanupTestChats(); await runSqlFile(MIGRATION_12); });
  after(cleanupTestChats);

  test("runs again and reports the active-only key", async () => {
    const result = await runSqlFile(MIGRATION_12);
    assert.equal(Number(result?.sales_chat_key_active_only), 1);
    assert.equal(Number(result?.unique_index), 1);
    assert.equal(Number(result?.users_with_two_active_sales_chats), 0);
  });

  test("a closed and an active sales chat of one user coexist", async () => {
    await insertChat({ tag: "m12-both-a", userId: "test-awc-m12-both", categoryId: 3, status: "closed", closedMinutesAgo: 5 });
    await insertChat({ tag: "m12-both-b", userId: "test-awc-m12-both", categoryId: 3, status: "active" });
    assert.equal(await salesChatCount("test-awc-m12-both"), 2);
  });

  test("a second active sales chat is refused", async () => {
    await insertChat({ tag: "m12-dup-a", userId: "test-awc-m12-dup", categoryId: 3, status: "active" });
    await assert.rejects(
      insertChat({ tag: "m12-dup-b", userId: "test-awc-m12-dup", categoryId: 3, status: "active" }),
      { code: "ER_DUP_ENTRY" },
    );
  });

  test("re-running 11 keeps the closed and the active sales chat apart", async () => {
    const user = "test-awc-m12-rerun";
    const oldChat = await insertChat({ tag: "m12-rerun-a", userId: user, categoryId: 3, status: "closed", minutesAgo: 60, closedMinutesAgo: 5 });
    const newChat = await insertChat({ tag: "m12-rerun-b", userId: user, categoryId: 3, status: "active" });
    await insertMessage(oldChat, "admin", "sales-a", 30);
    await insertMessage(newChat, "admin", "sales-b", 1);

    const result11 = await runSqlFile(MIGRATION_11);

    assert.equal(await salesChatCount(user), 2);
    assert.equal((await getMessages(oldChat)).length, 1);
    assert.equal((await getMessages(newChat)).length, 1);
    assert.equal(Number(result11?.users_with_duplicate_sales_chats), 0);
  });
});
