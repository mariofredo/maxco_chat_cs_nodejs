# All-CS Chat Access and 50 MB Upload Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every CS sees and can reply to any chat being handled, and chat file uploads are limited to 50 MB of allowed types, with a clear error instead of a dropped connection.

**Architecture:**
- The Assigned list stops filtering by the requesting admin, and `create_service_chat` stops returning 401.
- Upload validation lives in one pure function in `chatFileStorage.ts`. Both upload paths use it:
  - socket `send_message`, which reports a rejected file as `send_message_error`;
  - REST `/crm/chat/upload`, which returns a JSON 400.
- A body-parser error middleware turns an oversized request into a JSON 413.

**Tech Stack:** Node 24, TypeScript (NodeNext, ESM), Express 5, mysql2, Socket.IO 4, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-18-cs-open-access-upload-limit-design.md`

## Global Constraints

- `MAX_UPLOAD_BYTES = 50 * 1024 * 1024` (52 428 800). This is the decoded file size.
- Allowed extensions, case-insensitive: `jpg`, `jpeg`, `png`, `webp`, `mp4`, `mov`, `pdf`.
- Transport limit is 72 MiB (`75 497 472` bytes), for both socket `maxHttpBufferSize` and `express.json` / `urlencoded`.
- Rejection reasons, exact strings: `file_too_large`, `file_type_not_allowed`.
- Messages, exact text:
  - `File is larger than 50 MB`
  - `File type not allowed (allowed: jpg, jpeg, png, webp, mp4, mov, pdf)`
- Socket error: `send_message_error` → `{ chat_id, reason, message, maxBytes }`, sent to the sending socket only. Same event name as PR #2.
- REST upload error: HTTP 400 `{ success: false, reason, message, maxBytes }`.
- Oversized body: HTTP 413 `{ success: false, reason: "file_too_large", message, maxBytes }`.
- Stored file name: `uploads/chat/<Date.now()>_<safe name>`, where the safe name has no path and only `[A-Za-z0-9._-]`.
- Assign and takeover rules (`assignWaitingChat`, `max_waiting_minutes`) stay unchanged.
- `fetchActiveChats` keeps its signature. `adminId` is accepted but no longer filters.
- DB tests skip without `MYSQLDATABASE`, and touch only `TEST-AWC-%` rows. Unit tests never reach a DB and never write files.

## Review Focus

- Uppercase extension (`PHOTO.JPG`) must be accepted (Task 2 test).
- A file name with a path (`../../etc/x.png`, `..\\a.png`) must be stored inside `uploads/chat` (Task 2 test).
- Exactly the limit must be accepted, and the limit plus one byte rejected (Task 2 test, small `maxBytes`).
- A name without an extension (`README`), or a double extension (`x.png.exe`), must be rejected as `file_type_not_allowed` (Task 2 test).
- The CRM still sends `adminId` to the active list: it must get every handled chat, not an error (Task 1 test).

---

### Task 1: Every CS sees and opens handled chats

**Files:**
- Modify: `src/services/crmChatService.ts` (`fetchActiveChats`, the `last_msg_admin` CTE ~line 96)
- Modify: `src/controllers/crmChatController.ts` (`createUserServiceChat` ~line 221)
- Modify: `docs/integration-guide-crm.md` (new section "Assigned list and PIC")
- Test: `test-db/cs-open-access.test.ts`

**Interfaces:**
- Produces: `fetchActiveChats(admin_id, page, pageSize, categoryIds?, userReferrerId?)`. Same signature. It now returns chats with an admin reply by **any** CS inside `max_waiting_minutes`. `last_message_admin*` is that reply.
- Produces: `createUserServiceChat` returns 200 with the existing chat whatever its `admin_id`.

- [ ] **Step 1: Write the failing tests**

Use `describe(..., { skip: !hasDb && "MYSQLDATABASE not set" })`, `cleanupTestChats` before and after, and a top-level `after(() => pool.end())`. For the controller, use a fake `res` with `status()` returning itself and `json()` recording the body.

```ts
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
    { body: { user_id: "test-awc-oa-open", user_name: "U", admin_id: "B2" } } as any, res as any);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.success, true);
  assert.equal(sent.body.chatData.id, id);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/cs-open-access.test.ts`
Expected:
- FAIL: "visible to another CS".
- FAIL: status 401 ≠ 200.
- The stale-window test PASSes. It is a guard, not a RED.

- [ ] **Step 3: Implement**

- In the `last_msg_admin` CTE of `fetchActiveChats`, drop `AND sender_id = ?` and its `admin_id` bind value.
- In `createUserServiceChat`, remove the `else if (admin_id != chat.admin_id)` 401 branch.

- [ ] **Step 4: Run the DB suite**

Run: `npm run test:db`
Expected: all PASS.

- [ ] **Step 5: Document in the CRM guide**

- The Assigned tab now lists every chat any CS is handling. Show the PIC from `admin_name`.
- Any CS may open and reply.
- `create_service_chat` no longer returns 401.
- The `adminId` parameter is accepted but no longer filters.

- [ ] **Step 6: Commit**

```bash
git add src/services/crmChatService.ts src/controllers/crmChatController.ts test-db/cs-open-access.test.ts docs/integration-guide-crm.md
git commit -m "feat: every CS sees and can open chats handled by another CS"
```

---

### Task 2: Upload validation

**Files:**
- Modify: `src/utils/chatFileStorage.ts`
- Test: `test/upload/chat-file-storage.test.ts`

**Interfaces:**
- Produces, in `src/utils/chatFileStorage.ts`:
  - `MAX_UPLOAD_BYTES = 52428800`
  - `ALLOWED_UPLOAD_EXTENSIONS: readonly string[]` (lowercase, no dot)
  - `type FileUploadReason = "file_too_large" | "file_type_not_allowed"`
  - `class FileUploadError extends Error { readonly reason: FileUploadReason; readonly maxBytes: number }`, built with `new FileUploadError(reason: FileUploadReason, maxBytes = MAX_UPLOAD_BYTES)`. `message` is the exact text from Global Constraints, picked by `reason`. `name = "FileUploadError"`.
  - `safeFileName(fileName: string): string`
    - Takes the last segment after `/` or `\`.
    - Replaces every character outside `[A-Za-z0-9._-]` with `_`.
    - Returns `"file"` when the result is empty.
  - `validateUpload(fileName: string, fileDataBase64: string, maxBytes = MAX_UPLOAD_BYTES): { safeName: string; data: Buffer }`
    - Rejects the extension first (last `.` segment of the safe name, lowercased).
    - Then rejects when the size estimated from the base64 length (`floor(len * 3 / 4)` minus `=` padding) is over `maxBytes`. No decode happens in this case.
    - Then decodes and rejects when `data.length > maxBytes`.
    - Every rejection throws `FileUploadError`.
  - `saveChatFile(fileName, fileDataBase64)` calls `validateUpload`, then writes `uploads/chat/<Date.now()>_<safeName>`. Return shape unchanged: `{ contentUrl, metadata: { fileName, size } }`, where `metadata.fileName` is the original name.

- [ ] **Step 1: Write the failing tests** (no disk, no DB)

```ts
const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");

test("limit is 50 MiB", () => assert.equal(MAX_UPLOAD_BYTES, 52428800));

test("accepts allowed types in any case", () => {
  for (const name of ["a.jpg", "b.JPEG", "PHOTO.JPG", "c.png", "d.webp", "e.mp4", "f.MOV", "receipt.pdf"]) {
    assert.equal(validateUpload(name, b64(3)).data.length, 3, name);
  }
});

test("rejects other types", () => {
  for (const name of ["x.exe", "README", "x.png.exe", "x."]) {
    assert.throws(() => validateUpload(name, b64(3)),
      (e: any) => e instanceof FileUploadError && e.reason === "file_type_not_allowed", name);
  }
});

test("exactly the limit passes, one byte more is too large", () => {
  assert.equal(validateUpload("a.png", b64(10), 10).data.length, 10);
  assert.throws(() => validateUpload("a.png", b64(11), 10),
    (e: any) => e instanceof FileUploadError && e.reason === "file_too_large" && e.maxBytes === 10);
});

test("error messages are the agreed text", () => {
  assert.throws(() => validateUpload("a.png", b64(11), 10), { message: "File is larger than 50 MB" });
  assert.throws(() => validateUpload("a.exe", b64(1)),
    { message: "File type not allowed (allowed: jpg, jpeg, png, webp, mp4, mov, pdf)" });
});

test("safeFileName strips paths and odd characters", () => {
  assert.equal(safeFileName("../../etc/x.png"), "x.png");
  assert.equal(safeFileName("..\\a.png"), "a.png");
  assert.equal(safeFileName("my photo (1).jpg"), "my_photo__1_.jpg");
  assert.equal(safeFileName("/"), "file");
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test test/upload/chat-file-storage.test.ts`
Expected: FAIL. The new exports are missing.

- [ ] **Step 3: Implement to the interface above**

- [ ] **Step 4: Run the unit suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/chatFileStorage.ts test/upload/chat-file-storage.test.ts
git commit -m "feat: validate chat uploads (50 MB, image/video/pdf) and sanitize file names"
```

---

### Task 3: Report upload errors to clients and raise transport limits

**Files:**
- Create: `src/sockets/sendMessageErrors.ts`
- Create: `src/middleware/bodyErrors.ts`
- Modify: `src/sockets/chatSocket.ts` (`send_message` catch)
- Modify: `src/controllers/crmChatController.ts` (`uploadChatFile`)
- Modify: `src/app.ts`:
  - dedupe the body parsers and set the limit to `"72mb"`,
  - `maxHttpBufferSize: 72 * 1024 * 1024`,
  - register the error middleware after the routes.
- Modify: `docs/integration-guide-app.md`, `docs/integration-guide-crm.md` (section "File uploads")
- Test: `test/upload/upload-errors.test.ts`

**Interfaces:**
- Consumes: `FileUploadError`, `MAX_UPLOAD_BYTES` (Task 2).
- Produces:
  - `sendMessageErrorPayload(err: unknown, chatId: unknown): { chat_id: unknown; reason: string; message: string; maxBytes?: number } | null`, in `src/sockets/sendMessageErrors.ts`. Returns `null` for errors that are not reported to the client. When PR #2 merges, its `ChatClosedError` mapping moves here.
  - `jsonBodyErrorHandler(err, req, res, next)`, in `src/middleware/bodyErrors.ts`. For `err.type === "entity.too.large"` it responds 413 JSON (Global Constraints). Otherwise it calls `next(err)`.

- [ ] **Step 1: Write the failing tests** (no DB, no disk)

```ts
test("file errors become send_message_error payloads", () => {
  const err = new FileUploadError("file_too_large");
  assert.deepEqual(sendMessageErrorPayload(err, 7),
    { chat_id: 7, reason: "file_too_large", message: "File is larger than 50 MB", maxBytes: 52428800 });
  assert.equal(sendMessageErrorPayload(new Error("db down"), 7), null);
});

test("oversized body becomes a JSON 413", () => {
  const { res, sent } = fakeRes();
  let nextCalled = false;
  jsonBodyErrorHandler({ type: "entity.too.large" }, {} as any, res, () => { nextCalled = true; });
  assert.equal(sent.status, 413);
  assert.deepEqual([sent.body.success, sent.body.reason, sent.body.maxBytes], [false, "file_too_large", 52428800]);
  assert.equal(nextCalled, false);
});

test("other errors pass through", () => {
  const { res } = fakeRes();
  let passed: unknown;
  jsonBodyErrorHandler(new Error("x"), {} as any, res, (e?: unknown) => { passed = e; });
  assert.ok(passed instanceof Error);
});

test("REST upload of a wrong type answers 400 JSON", async () => {
  const { res, sent } = fakeRes();
  await uploadChatFile({ body: { fileName: "x.exe", fileDataBase64: "AAAA" } } as any, res);
  assert.equal(sent.status, 400);
  assert.deepEqual([sent.body.success, sent.body.reason], [false, "file_type_not_allowed"]);
});
```

`FileUploadError` takes `(reason, maxBytes = MAX_UPLOAD_BYTES)`; Task 2 sets the message text. `fakeRes()` returns a response whose `status()` returns itself and whose `json()` records the body.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test test/upload/upload-errors.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement both modules and wire them**

- `chatSocket.ts` `send_message` catch:

  ```ts
  const payload = sendMessageErrorPayload(err, data?.chat_id);
  if (payload) {
    socket.emit("send_message_error", payload);
    return;
  }
  console.error(...);
  ```

- `uploadChatFile`: a `FileUploadError` answers 400 JSON (Global Constraints). Any other error keeps the existing 500.
- `app.ts`:
  - one `express.json({ limit: "72mb" })`,
  - one `express.urlencoded({ extended: true, limit: "72mb" })`,
  - `maxHttpBufferSize: 72 * 1024 * 1024`,
  - `app.use(jsonBodyErrorHandler)` after the routes.

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run test:db && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Document "File uploads" in both guides**

- 50 MB maximum, measured on the real file.
- The allowed types.
- Check size and type **before** base64-encoding. A payload far above the limit still makes Socket.IO drop the connection.
- The error shapes:
  - `send_message_error` with `reason`, `message`, `maxBytes`;
  - REST 400 / 413.
- Show `message` to the user.

- [ ] **Step 6: Commit**

```bash
git add src/sockets/sendMessageErrors.ts src/middleware/bodyErrors.ts src/sockets/chatSocket.ts src/controllers/crmChatController.ts src/app.ts test/upload/upload-errors.test.ts docs/integration-guide-app.md docs/integration-guide-crm.md
git commit -m "feat: clear errors for rejected uploads and room for 50 MB files"
```

---

### Task 4: Category filter on the user's chat list

**Files:**
- Create: `src/utils/categoryIds.ts`
- Modify: `src/services/chatService.ts` (`fetchUserChats`)
- Modify: `src/controllers/chatController.ts` (`getUserChats` reads `req.query.categoryIds`, `getUserSalesChat` reads `req.body.categoryIds`)
- Modify: `docs/integration-guide-app.md` (section "Chat list filter")
- Test: `test/chat/category-ids.test.ts`, `test-db/user-chats-filter.test.ts`

**Interfaces:**
- Produces:
  - `parseCategoryIds(input: unknown): number[]` in `src/utils/categoryIds.ts`. It accepts:
    - an array,
    - a comma-separated string,
    - a number.

    It keeps only finite whole numbers `> 0` and removes duplicates. Anything else returns `[]`, which means **no filter**. This is unlike `normalizeCategoryIds` in `crmChatService.ts`, which defaults to `[1]`. Leave that function as it is.
  - `fetchUserChats(userId: string, page?: number, pageSize?: number, categoryIds: number[] = [])`. A non-empty `categoryIds` adds `AND category_id IN (...)` to both the list query and the count.

- [ ] **Step 1: Write the failing tests**

`test/chat/category-ids.test.ts`:

```ts
test("parseCategoryIds reads strings, arrays and numbers", () => {
  assert.deepEqual(parseCategoryIds("1"), [1]);
  assert.deepEqual(parseCategoryIds("1, 2,2"), [1, 2]);
  assert.deepEqual(parseCategoryIds(["3", 1]), [3, 1]);
  assert.deepEqual(parseCategoryIds(2), [2]);
});

test("parseCategoryIds means no filter for empty or invalid input", () => {
  for (const raw of [undefined, null, "", "abc", "0", "-1", "1.5", {}, []]) {
    assert.deepEqual(parseCategoryIds(raw), [], String(raw));
  }
});
```

`test-db/user-chats-filter.test.ts` seeds one user (`userId: "test-awc-uf"`) with chats in categories 1 (closed), 1 (active), 2 and 3:

```ts
test("no filter returns every category", async () => {
  const r = await fetchUserChats("test-awc-uf");
  assert.equal(r.chats.length, 4);
});

test("categoryIds [1] returns only the Customer Support tickets, total included", async () => {
  const r = await fetchUserChats("test-awc-uf", 1, 20, [1]);
  assert.deepEqual(r.chats.map((c) => c.category_id), [1, 1]);
  assert.equal(r.total, 2);
});

test("controller reads ?categoryIds", async () => {
  await getUserChats({ params: { userId: "test-awc-uf" }, query: { categoryIds: "2,3" } } as any, res as any);
  assert.deepEqual(sent.body.data.map((c: any) => c.category_id).sort(), [2, 3]);
  assert.equal(sent.body.pagination.total, 2);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test test/chat/category-ids.test.ts`
Expected: FAIL, the module is missing.

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/user-chats-filter.test.ts`
Expected: the filter tests FAIL (4 rows come back instead of 2). The "no filter" test PASSes. It is a guard.

- [ ] **Step 3: Implement the parser, the service parameter and the two controller reads**

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run test:db && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Document in the app guide**

Cover:
- `?categoryIds=1` on `GET /api/chats/user/:userId`, and `categoryIds` in the body of `POST /api/chats/user`;
- the accepted forms;
- no value means every category;
- `pagination.total` follows the filter.

- [ ] **Step 6: Commit**

```bash
git add src/utils/categoryIds.ts src/services/chatService.ts src/controllers/chatController.ts test/chat/category-ids.test.ts test-db/user-chats-filter.test.ts docs/integration-guide-app.md
git commit -m "feat: optional category filter on the user's chat list"
```
