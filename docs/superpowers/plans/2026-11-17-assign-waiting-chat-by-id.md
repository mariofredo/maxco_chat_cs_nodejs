# Assign Waiting Chat by Id Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin reply assigns a waiting chat by checking that chat's own state, so chats beyond the first 20 rows of the waiting list are assigned too.

**Architecture:** A new `assignWaitingChat` in `crmChatService.ts` runs one atomic `UPDATE ... WHERE id = ?` carrying the same waiting rules as `fetchPendingChats` (category 1, status pending/active, no admin message newer than `max_waiting_minutes`). `sendMessage` calls it for admin messages only, before inserting the message, and drives `is_just_assigned` and the `assigned_admin_chat` emit from its result.

**Tech Stack:** Node 24, TypeScript (NodeNext, ESM), mysql2/promise, Socket.IO 4, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-17-assign-waiting-chat-by-id-design.md`

## Global Constraints

- Waiting rule must equal `fetchPendingChats` with default filter: `category_id = 1`, `status IN ('pending', 'active')`, no `list_messages` row with `sender_type = 'admin'` and `created_at > DATE_SUB(NOW(), INTERVAL <max_waiting_minutes> MINUTE)`.
- Threshold comes from `getMaxWaitingMinutes()` (config key `max_waiting_minutes`, default 120). Never hard-code 120.
- The assign `UPDATE` runs before the message `INSERT` in `sendMessage` (after the insert, the chat is no longer waiting).
- Payload shape of `sendMessage` result and of the `assigned_admin_chat` event (`{ chatId, adminId, adminName }`, room `chat_<id>`) stays unchanged.
- No change to `fetchPendingChats`, `fetchActiveChats`, controllers, routes, or schema.
- Takeover of an active chat whose last admin reply is older than the threshold stays allowed (current behaviour).
- DB tests must skip (not fail) when `MYSQLDATABASE` is unset, so plain `npm test` stays green without a database.
- DB tests touch only rows they create, tagged `chat_ticket LIKE 'TEST-AWC-%'`, and delete them before and after.

## Review Focus

- Same admin replies twice in a row: second reply must report `is_just_assigned = false` and emit nothing (Task 2 test).
- Admin reply to a `closed` chat: must not reopen or assign it (Task 1 test).
- Stale active chat (last admin reply older than threshold) replied by another admin: must be taken over, as today (Task 1 test).
- `chat_id` arriving as a number (socket payload) instead of a string: assignment still works (Task 2 test sends a number).
- Non-existent chat id: `assignWaitingChat` returns `false` without throwing (Task 1 test).

---

### Task 1: `assignWaitingChat` in the CRM chat service

**Files:**
- Modify: `src/services/crmChatService.ts` (add the function right after `fetchPendingChats`, ~line 213)
- Create: `test/db/helpers.ts`
- Create: `test/db/assign-waiting-chat.test.ts`
- Modify: `package.json` (add script `test:db`)

**Interfaces:**
- Produces: `export async function assignWaitingChat(chatId: number | string, adminId: string, adminName: string | null): Promise<boolean>` in `src/services/crmChatService.ts`. `true` = the chat was waiting and is now `status = 'active'` with this admin. `false` = not waiting, wrong category, closed, or not found.
- Produces (test helpers, `test/db/helpers.ts`):
  - `export const hasDb: boolean` (`Boolean(process.env.MYSQLDATABASE)`)
  - `export async function cleanupTestChats(): Promise<void>` deletes `list_messages` then `list_chats` rows whose `chat_ticket LIKE 'TEST-AWC-%'`
  - `export async function insertChat(opts: { tag: string; categoryId?: number; status?: "pending" | "active" | "closed"; adminId?: string | null; adminName?: string | null; minutesAgo?: number }): Promise<number>` returns the new id; `chat_ticket = 'TEST-AWC-' + tag`, `user_id = 'test-awc-' + tag`, `created_at = NOW() - INTERVAL minutesAgo MINUTE` (default 0), defaults category 1, `pending`, admin null
  - `export async function insertMessage(chatId: number, senderType: "user" | "admin", senderId: string, minutesAgo: number): Promise<void>` text message, `content_type = 1`
  - `export async function getChat(chatId: number): Promise<{ status: string; admin_id: string | null; admin_name: string | null }>`

- [ ] **Step 1: Write the helpers and the failing tests**

`test/db/helpers.ts` uses `pool` from `src/config/db.ts`. In `test/db/assign-waiting-chat.test.ts`: `describe("assignWaitingChat", { skip: !hasDb && "MYSQLDATABASE not set" }, ...)`, `before`/`after` call `cleanupTestChats()`, top-level `after(() => pool.end())`. Let `max = await getMaxWaitingMinutes()`. Tests:

```ts
test("pending chat without admin reply is assigned", async () => {
  const id = await insertChat({ tag: "pending" });
  await insertMessage(id, "user", "test-awc-pending", 5);
  assert.equal(await assignWaitingChat(id, "100063", "CS A"), true);
  assert.deepEqual(await getChat(id), { status: "active", admin_id: "100063", admin_name: "CS A" });
});

test("active chat with a recent admin reply is not taken over", async () => {
  const id = await insertChat({ tag: "recent", status: "active", adminId: "A1", adminName: "CS A" });
  await insertMessage(id, "admin", "A1", 1);
  assert.equal(await assignWaitingChat(id, "B2", "CS B"), false);
  assert.equal((await getChat(id)).admin_id, "A1");
});

test("active chat whose last admin reply is older than the threshold is taken over", async () => {
  const id = await insertChat({ tag: "stale", status: "active", adminId: "A1", adminName: "CS A", minutesAgo: max + 10 });
  await insertMessage(id, "admin", "A1", max + 5);
  assert.equal(await assignWaitingChat(id, "B2", "CS B"), true);
  assert.equal((await getChat(id)).admin_id, "B2");
});

test("chat in another category is not assigned", async () => {
  const id = await insertChat({ tag: "promo", categoryId: 2, status: "active" });
  assert.equal(await assignWaitingChat(id, "100063", "CS A"), false);
  assert.equal((await getChat(id)).admin_id, null);
});

test("closed chat is not reopened", async () => {
  const id = await insertChat({ tag: "closed", status: "closed" });
  assert.equal(await assignWaitingChat(id, "100063", "CS A"), false);
  assert.equal((await getChat(id)).status, "closed");
});

test("unknown chat id returns false", async () => {
  assert.equal(await assignWaitingChat(999999999, "100063", "CS A"), false);
});
```

Add to `package.json` scripts: `"test:db": "node --import tsx --env-file=.env.local --test --test-concurrency=1 \"test/db/**/*.test.ts\""`. Concurrency 1 is required: both DB test files clean up the same `TEST-AWC-%` rows, so running them in parallel would delete each other's data.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:db`
Expected: FAIL, `assignWaitingChat` is not exported from `crmChatService.js`.

- [ ] **Step 3: Implement `assignWaitingChat`**

One `pool.query<ResultSetHeader>` with the `UPDATE list_chats lc SET ... WHERE lc.id = ? AND lc.category_id = 1 AND lc.status IN ('pending','active') AND NOT EXISTS (SELECT 1 FROM list_messages m WHERE m.chat_id = lc.id AND m.sender_type = 'admin' AND m.created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE))` from the spec. Bind the threshold as a parameter. Return `result.affectedRows > 0`. Add a short doc comment that it must stay in step with the `WHERE` of `fetchPendingChats`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:db`
Expected: 6 tests pass.
Run: `npm test`
Expected: all existing tests pass; the `assignWaitingChat` suite shows as skipped.

- [ ] **Step 5: Commit**

```bash
git add src/services/crmChatService.ts test/db/helpers.ts test/db/assign-waiting-chat.test.ts package.json
git commit -m "feat: assignWaitingChat assigns a waiting chat by its id"
```

---

### Task 2: `sendMessage` assigns through `assignWaitingChat`

**Files:**
- Modify: `src/services/chatService.ts:7` (import), `:214-303` (`sendMessage`)
- Create: `test/db/send-message-assign.test.ts`

**Interfaces:**
- Consumes: `assignWaitingChat(chatId, adminId, adminName): Promise<boolean>` from Task 1; test helpers from `test/db/helpers.ts`.
- Produces: no new exports. `sendMessage` result keeps all fields; `is_just_assigned` now equals the `assignWaitingChat` result for admin messages and `false` for user messages.

- [ ] **Step 1: Write the failing tests**

`test/db/send-message-assign.test.ts`, same skip/cleanup/`pool.end()` pattern as Task 1. Before the tests, call `setIO` with a stub `{ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) }` and reset `emitted` in `beforeEach`. Tests:

```ts
test("admin reply assigns a waiting chat beyond row 20 of the waiting list", async () => {
  const ids = [];
  for (let i = 1; i <= 25; i++) {
    const id = await insertChat({ tag: `row${i}`, minutesAgo: 60 - i });
    await insertMessage(id, "user", `test-awc-row${i}`, 60 - i);
    ids.push(id);
  }
  const target = ids[24];
  const all = await fetchPendingChats(1, 1000);
  assert.ok(all.findIndex((c) => c.id === target) + 1 > 20, "precondition: target beyond row 20");
  assert.ok(!(await fetchPendingChats()).some((c) => c.id === target), "precondition: not on page 1");

  const res = await sendMessage({ chat_id: target, sender_id: "100063", sender_type: "admin", sender_name: "CS A", content_type: 1, message: "halo" });

  assert.equal(res.is_just_assigned, true);
  assert.equal(res.chat_data?.status, "active");
  assert.equal(res.chat_data?.admin_id, "100063");
  assert.deepEqual(emitted, [{ room: `chat_${target}`, event: "assigned_admin_chat", payload: { chatId: target, adminId: "100063", adminName: "CS A" } }]);
});

test("user message does not assign", async () => {
  const id = await insertChat({ tag: "user" });
  const res = await sendMessage({ chat_id: id, sender_id: "test-awc-user", sender_type: "user", sender_name: "U", content_type: 1, message: "halo" });
  assert.equal(res.is_just_assigned, false);
  assert.equal(res.chat_data?.status, "pending");
  assert.equal(res.chat_data?.admin_id, null);
  assert.deepEqual(emitted, []);
});

test("second reply of the same admin is not a new assignment", async () => {
  const id = await insertChat({ tag: "twice" });
  const msg = { chat_id: id, sender_id: "100063", sender_type: "admin", sender_name: "CS A", content_type: 1, message: "halo" };
  assert.equal((await sendMessage(msg)).is_just_assigned, true);
  emitted.length = 0;
  assert.equal((await sendMessage(msg)).is_just_assigned, false);
  assert.deepEqual(emitted, []);
});

test("another admin replying to a recently answered chat does not take it over", async () => {
  const id = await insertChat({ tag: "other", status: "active", adminId: "A1", adminName: "CS A" });
  await insertMessage(id, "admin", "A1", 1);
  const res = await sendMessage({ chat_id: id, sender_id: "B2", sender_type: "admin", sender_name: "CS B", content_type: 1, message: "halo" });
  assert.equal(res.is_just_assigned, false);
  assert.equal(res.chat_data?.admin_id, "A1");
  assert.deepEqual(emitted, []);
});
```

`chat_id` is passed as a number on purpose (socket payload shape).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:db`
Expected: "admin reply assigns a waiting chat beyond row 20" FAILS with `is_just_assigned` `false` (the bug). The other three may pass already.

- [ ] **Step 3: Change `sendMessage`**

Drop the `fetchPendingChats` import and the `pendingCrmChat` / `isChatInPending` block. At the same spot (before the file handling and the `INSERT`): `const justAssigned = sender_type === "admin" ? await assignWaitingChat(chat_id, sender_id, sender_name) : false;`. If `justAssigned`, emit `assigned_admin_chat` exactly as today. Return `is_just_assigned: justAssigned`. Remove `CrmChatDataInfo` from the type import if it is no longer used.

- [ ] **Step 4: Run all checks**

Run: `npm run test:db`
Expected: 10 tests pass (6 from Task 1, 4 from Task 2).
Run: `npm test`
Expected: all existing tests pass, DB suites skipped.
Run: `npx tsc --noEmit`
Expected: no output, exit code 0.
Run: `node --import tsx --env-file=.env.local "C:/Users/ASUS/AppData/Local/Temp/claude/2aaeb07ec755cf33/65fea897-75ed-4fb6-a63b-8f80b94a9bb7/scratchpad/repro-pending-page.mts"`
Expected: the `TARGET` line now shows `is_just_assigned=true, status=active, admin_id=100063, assigned_admin_chat emitted=true`, and `cleanup: REPRO rows left=0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/chatService.ts test/db/send-message-assign.test.ts
git commit -m "fix: assign a waiting chat on admin reply wherever it sits in the waiting list"
```
