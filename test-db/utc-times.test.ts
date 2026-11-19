import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { setIO } from "../src/sockets/io.js";
import { sendMessage } from "../src/services/chatService.js";
import { cleanupTestChats, fakeIO, hasDb, insertChat } from "./helpers.js";

after(() => pool.end());

const { io } = fakeIO();
setIO(io);

// Times keep the MySQL format, without a zone; the value is UTC.
const RAW_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const parseUtc = (value: string) => Date.parse(`${value.replace(" ", "T")}Z`);

describe("times are UTC whatever the MySQL server time zone", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);

  test("every pool connection runs in UTC", async () => {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT @@session.time_zone AS tz");
    assert.equal(rows[0]!.tz, "+00:00");

    const conn = await pool.getConnection();
    try {
      const [own] = await conn.query<RowDataPacket[]>("SELECT @@session.time_zone AS tz");
      assert.equal(own[0]!.tz, "+00:00");
    } finally {
      conn.release();
    }
  });

  test("NOW() comes out as UTC in the MySQL format", async () => {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT NOW() AS now_, UTC_TIMESTAMP() AS utc");
    assert.match(String(rows[0]!.now_), RAW_TIME);
    assert.equal(rows[0]!.now_, rows[0]!.utc);
  });

  test("a stored chat time reads back as the real instant", async () => {
    const id = await insertChat({ tag: "utc-row" });
    const [rows] = await pool.query<RowDataPacket[]>("SELECT created_at FROM list_chats WHERE id = ?", [id]);
    const createdAt = String(rows[0]!.created_at);
    assert.match(createdAt, RAW_TIME);
    assert.ok(Math.abs(parseUtc(createdAt) - Date.now()) < 10_000, `${createdAt} is now in UTC`);
  });

  test("sendMessage sends chat_data times in UTC", async () => {
    const id = await insertChat({ tag: "utc-send", status: "active" });
    const res = await sendMessage({
      chat_id: id,
      sender_id: "test-awc-utc-send",
      sender_type: "user",
      sender_name: "Priya",
      content_type: 1,
      message: "what time is it",
    });
    const createdAt = String(res.chat_data?.created_at);
    assert.match(createdAt, RAW_TIME);
    assert.ok(Math.abs(parseUtc(createdAt) - Date.now()) < 10_000, `${createdAt} is now in UTC`);
  });
});
