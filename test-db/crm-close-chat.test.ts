import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../src/config/db.js";
import { setIO } from "../src/sockets/io.js";
import { crmCloseChat } from "../src/controllers/crmChatController.js";
import { cleanupTestChats, fakeIO, hasDb, insertChat } from "./helpers.js";

after(() => pool.end());

const { io, emitted } = fakeIO();
setIO(io);

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

describe("CRM REST close", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(cleanupTestChats);
  after(cleanupTestChats);
  beforeEach(() => {
    emitted.length = 0;
    sent.status = 200;
    sent.body = null;
  });

  test("REST close emits chat_closed with reason agent", async () => {
    const id = await insertChat({ tag: "cc-ok", status: "active" });
    await crmCloseChat({ body: { chatId: id } } as unknown as Request, res as unknown as Response);
    assert.equal(sent.body.success, true);
    assert.deepEqual(
      emitted.map((e) => [e.rooms, e.event]),
      [[[`chat_${id}`], "chat_closed"]],
    );
    assert.equal(emitted[0]!.payload.chatId, id);
    assert.equal(emitted[0]!.payload.reason, "agent");
    assert.equal(emitted[0]!.payload.chatData.status, "closed");
  });

  test("closing a closed chat keeps closed_at and does not emit again", async () => {
    const id = await insertChat({ tag: "cc-twice", status: "closed", closedMinutesAgo: 30 });
    const before = (await pool.query<RowDataPacket[]>("SELECT closed_at FROM list_chats WHERE id = ?", [id]))[0][0]!.closed_at;
    await crmCloseChat({ body: { chatId: id } } as unknown as Request, res as unknown as Response);
    assert.equal(sent.status, 200);
    assert.equal(sent.body.success, true);
    assert.deepEqual(emitted, []);
    const after = (await pool.query<RowDataPacket[]>("SELECT closed_at FROM list_chats WHERE id = ?", [id]))[0][0]!.closed_at;
    assert.equal(after, before);
  });

  test("unknown chat emits nothing", async () => {
    await crmCloseChat({ body: { chatId: 999999999 } } as unknown as Request, res as unknown as Response);
    assert.equal(sent.status, 404);
    assert.deepEqual(emitted, []);
  });
});
