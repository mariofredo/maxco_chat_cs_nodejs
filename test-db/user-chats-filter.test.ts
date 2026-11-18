import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { pool } from "../src/config/db.js";
import { fetchUserChats } from "../src/services/chatService.js";
import { getUserChats } from "../src/controllers/chatController.js";
import { cleanupTestChats, hasDb, insertChat } from "./helpers.js";

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

const USER = "test-awc-uf";

describe("category filter on the user's chat list", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(async () => {
    await cleanupTestChats();
    await insertChat({ tag: "uf-cs-old", userId: USER, categoryId: 1, status: "closed", minutesAgo: 60 });
    await insertChat({ tag: "uf-cs-new", userId: USER, categoryId: 1, status: "active" });
    await insertChat({ tag: "uf-promo", userId: USER, categoryId: 2, status: "active" });
    await insertChat({ tag: "uf-sales", userId: USER, categoryId: 3, status: "active" });
  });
  after(cleanupTestChats);

  test("no filter returns every category", async () => {
    const r = await fetchUserChats(USER);
    assert.equal(r.chats.length, 4);
  });

  test("categoryIds [1] returns only the Customer Support tickets, total included", async () => {
    const r = await fetchUserChats(USER, 1, 20, [1]);
    assert.deepEqual(
      r.chats.map((c) => c.category_id),
      [1, 1],
    );
    assert.equal(r.total, 2);
  });

  test("controller reads ?categoryIds", async () => {
    await getUserChats(
      { params: { userId: USER }, query: { categoryIds: "2,3" } } as unknown as Request,
      res as unknown as Response,
    );
    assert.deepEqual(sent.body.data.map((c: any) => c.category_id).sort(), [2, 3]);
    assert.equal(sent.body.pagination.total, 2);
  });
});
