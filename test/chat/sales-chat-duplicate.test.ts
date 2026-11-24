import { test } from "node:test";
import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";
import { isOtherWriterWinner } from "../../src/services/salesChatService.js";

const chat = (id: number | string) => ({ id }) as RowDataPacket;

// replaceSalesChat gets ER_DUP_ENTRY, rolls back and looks up the active chat.
// Who holds it tells a lost race apart from a database whose unique index is
// still the old one (sql/dbchanges_202611241200.sql not run).

test("another chat holds the active slot: another writer won", () => {
  assert.equal(isOtherWriterWinner(chat(5), chat(9)), true);
  assert.equal(isOtherWriterWinner(null, chat(9)), true);
});

test("the chat we tried to close still holds it: the old index is in place", () => {
  assert.equal(isOtherWriterWinner(chat(5), chat(5)), false);
  // MySQL may return ids as number or string.
  assert.equal(isOtherWriterWinner(chat(5), chat("5")), false);
  assert.equal(isOtherWriterWinner(chat("5"), chat(5)), false);
});

test("no active chat at all: a closed chat blocks the insert, the old index is in place", () => {
  assert.equal(isOtherWriterWinner(chat(5), null), false);
  assert.equal(isOtherWriterWinner(null, null), false);
});
