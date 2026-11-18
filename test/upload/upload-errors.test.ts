// No DB, no disk: only rejected uploads reach saveChatFile here.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { FileUploadError } from "../../src/utils/chatFileStorage.js";
import { ChatClosedError } from "../../src/services/chatService.js";
import { sendMessageErrorPayload } from "../../src/sockets/sendMessageErrors.js";
import { jsonBodyErrorHandler } from "../../src/middleware/bodyErrors.js";
import { uploadChatFile } from "../../src/controllers/crmChatController.js";

function fakeRes() {
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
  return { res: res as unknown as Response, sent };
}

test("file errors become send_message_error payloads", () => {
  const err = new FileUploadError("file_too_large");
  assert.deepEqual(sendMessageErrorPayload(err, 7), {
    chat_id: 7,
    reason: "file_too_large",
    message: "File is larger than 50 MB",
    maxBytes: 52428800,
  });
  assert.equal(sendMessageErrorPayload(new Error("db down"), 7), null);
});

test("a closed ticket keeps its send_message_error payload", () => {
  assert.deepEqual(sendMessageErrorPayload(new ChatClosedError(9), 9), { chat_id: 9, reason: "chat_closed" });
});

test("oversized body becomes a JSON 413", () => {
  const { res, sent } = fakeRes();
  let nextCalled = false;
  jsonBodyErrorHandler({ type: "entity.too.large" }, {} as Request, res, () => {
    nextCalled = true;
  });
  assert.equal(sent.status, 413);
  assert.deepEqual([sent.body.success, sent.body.reason, sent.body.maxBytes], [false, "file_too_large", 52428800]);
  assert.equal(sent.body.message, "File is larger than 50 MB");
  assert.equal(nextCalled, false);
});

test("other errors pass through", () => {
  const { res } = fakeRes();
  let passed: unknown;
  jsonBodyErrorHandler(new Error("x"), {} as Request, res, (e?: unknown) => {
    passed = e;
  });
  assert.ok(passed instanceof Error);
});

test("REST upload of a wrong type answers 400 JSON", async () => {
  const { res, sent } = fakeRes();
  await uploadChatFile({ body: { fileName: "x.exe", fileDataBase64: "AAAA" } } as Request, res);
  assert.equal(sent.status, 400);
  assert.deepEqual([sent.body.success, sent.body.reason], [false, "file_type_not_allowed"]);
  assert.equal(sent.body.maxBytes, 52428800);
});
