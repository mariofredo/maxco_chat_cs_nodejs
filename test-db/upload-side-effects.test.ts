// A refused file must change nothing: no new ticket, no PIC, no event.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { setIO } from "../src/sockets/io.js";
import { sendMessage } from "../src/services/chatService.js";
import { FileUploadError } from "../src/utils/chatFileStorage.js";
import { cleanupTestChats, fakeIO, getChat, getMessages, hasDb, insertChat } from "./helpers.js";

after(() => pool.end());

const { io, emitted } = fakeIO();
setIO(io);

const refusedFile = (chatId: number, senderId: string, senderType: "user" | "admin") =>
  sendMessage({
    chat_id: chatId,
    sender_id: senderId,
    sender_type: senderType,
    sender_name: "X",
    content_type: 2,
    file_name: "setup.exe",
    file_data: "AAAA",
  });

describe("a refused file has no side effects", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);
  beforeEach(() => {
    emitted.length = 0;
  });

  test("a refused file to a closed ticket opens no new ticket", async () => {
    const id = await insertChat({ tag: "se-closed", status: "closed" });
    await assert.rejects(refusedFile(id, "test-awc-se-closed", "user"), FileUploadError);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM list_chats WHERE user_id = 'test-awc-se-closed'",
    );
    assert.equal(Number(rows[0]!.n), 1);
    assert.deepEqual(emitted, []);
  });

  test("a refused file from CS does not make it the PIC of a waiting chat", async () => {
    const id = await insertChat({ tag: "se-waiting" });
    await assert.rejects(refusedFile(id, "A1", "admin"), FileUploadError);
    const chat = await getChat(id);
    assert.deepEqual([chat.status, chat.admin_id], ["pending", null]);
    assert.equal((await getMessages(id)).length, 0);
    assert.deepEqual(emitted, []);
  });
});
