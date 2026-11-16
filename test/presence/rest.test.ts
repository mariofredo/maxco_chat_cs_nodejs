import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Server } from "socket.io";
import { setIO } from "../../src/sockets/io.js";
import { getPresence } from "../../src/services/presenceRuntime.js";
import { getClientPresence } from "../../src/controllers/clientChatController.js";
import { getCrmUsersPresence } from "../../src/controllers/crmChatController.js";

setIO({ to: () => ({ emit: () => {} }) } as unknown as Server);

function call(
  handler: (req: Request, res: Response) => unknown,
  query: Record<string, unknown> = {},
) {
  const result: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      result.status = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
      return res;
    },
  };
  handler({ query } as unknown as Request, res as unknown as Response);
  return result;
}

test("GET /api/client/presence reports both teams", () => {
  assert.deepEqual(call(getClientPresence).body, {
    success: true,
    data: { customer_support: false, sales: false },
  });
  getPresence().registerAdmin("s1", "a1", ["sales"]);
  assert.deepEqual(call(getClientPresence).body, {
    success: true,
    data: { customer_support: false, sales: true },
  });
});

test("GET /api/chats/crm/presence returns one boolean per requested id", () => {
  getPresence().registerUser("su1", "u1");
  const result = call(getCrmUsersPresence, { userIds: "u1,u2" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, data: { u1: true, u2: false } });
});

test("userIds accepts a repeated key and collapses blanks and duplicates", () => {
  const expected = { success: true, data: { u1: true, u2: false } };
  assert.deepEqual(call(getCrmUsersPresence, { userIds: ["u1", "u2"] }).body, expected);
  assert.deepEqual(call(getCrmUsersPresence, { userIds: " u1 ,u1,, u2" }).body, expected);
});

test("userIds missing or empty returns 400", () => {
  for (const userIds of [undefined, "", " , "]) {
    const result = call(getCrmUsersPresence, userIds === undefined ? {} : { userIds });
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { success: false, message: "userIds is required" });
  }
});

test("userIds over the limit returns 400; exactly 100 returns 200", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`).join(",");
  const tooMany = call(getCrmUsersPresence, { userIds: ids(101) });
  assert.equal(tooMany.status, 400);
  assert.deepEqual(tooMany.body, {
    success: false,
    message: "userIds supports at most 100 ids",
  });
  const ok = call(getCrmUsersPresence, { userIds: ids(100) });
  assert.equal(ok.status, 200);
  assert.equal(Object.keys((ok.body as { data: object }).data).length, 100);
});
