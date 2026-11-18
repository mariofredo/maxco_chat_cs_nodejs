# CS Ticket Auto-Close and New Ticket in One Thread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customer Support chats waiting on the user close automatically with an automated message, a user message to a closed CS ticket opens a new ticket, and the app can load all CS tickets of a user as one thread.

**Architecture:** A ticket stays one `list_chats` row. A 60-second in-process job closes idle CS chats with one guarded `UPDATE` per chat and stores a `sender_type = 'system'` message. `sendMessage` reroutes a user message sent to a closed CS chat into the user's open CS chat (created if missing, serialized per user), rejects admin messages to closed CS chats, and the socket layer joins the sender to the new room and emits the ticket events. A new client endpoint returns the merged CS thread with ticket markers.

**Tech Stack:** Node 24, TypeScript (NodeNext, ESM, `strict`, `exactOptionalPropertyTypes`), Express 5, mysql2/promise (`dateStrings: true`), Socket.IO 4, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-18-ticket-auto-close-design.md`

## Global Constraints

- Only `category_id = 1` (Customer Support) changes behaviour. Categories 2 (Promotion) and 3 (Inside Sales) behave exactly as today.
- Ticket number format unchanged: `randomNumericString(12)` formatted `XXXX-XXXX-XXXX`.
- System message: `sender_type 'system'`, `sender_id 'system'`, `sender_name 'Maxco Customer Support'`, `content_type 1`, `content_url NULL`, `metadata {"type":"auto_close"}`.
- Config keys in `list_chat_config`, read on every job pass: `auto_close_minutes` (seeded `'0'`; missing, invalid or `<= 0` = off) and `auto_close_message` (template with `{name}` and `{minutes}`, at most 255 characters).
- Default template (exact): `Hi {name}, since we haven't received a reply from you in the last {minutes} minutes, this chat will now be closed. Please contact us again if you have any further questions.`
- Idle rule (N = `auto_close_minutes`): CS chat, `status IN ('pending','active')`, latest message (`ORDER BY created_at DESC, id DESC`) has `sender_type = 'admin'`, and its age is `>= N` and `<= N + 60` minutes. The 60 is a constant in code.
- Event contracts (exact names and fields):
  - `chat_closed` → `{ chatId, chatData, reason: 'auto_no_reply' | 'agent' }` to `chat_<id>`
  - `send_message_error` → `{ chat_id, reason: 'chat_closed' }` to the sending socket only
  - `new_message` payload gains `previous_chat_id: number | null` and `is_new_ticket: boolean`
  - existing `new_user_chatroom` → `{ chatData }` to `user_<userId>`
  - existing `chat_room_created` → `{ id, user_id, chat_ticket, status, created_at, user_name }` to everyone (same as `createChat`)
- Endpoint: `GET /api/client/chat/support-thread/:userId?page=&pageSize=` (defaults 1 / 50), response `{ success, data: { messages, tickets, current }, pagination: { total, page, pageSize, hasMore } }`.
- One process. No new npm dependencies.
- Out of scope, do not touch: the `updated_at` bug in `assignAdminToChat` / `updateChatStatus`, `crmChatService.createNewChat` (the CRM copy), waiting/assigned rules, `test.html`.
- Migration files are one-time, not idempotent, with the same header style as `deploy/sql/09_*`.
- DB tests (`test-db/`) skip when `MYSQLDATABASE` is unset, and touch only rows with `chat_ticket LIKE 'TEST-AWC-%'` or `user_id LIKE 'test-awc-%'`. Never run the auto-close loop (`runAutoClose`) in a test: it scans every chat in the database.
- Unit tests (`test/`) never reach a database.

## Review Focus

- A client sends `sender_type: 'system'` over the socket: it must be rejected, not stored as an automated message (Task 4 test).
- `chat_id` arrives as a string (`"12"`) for a closed CS chat: the reroute still happens (Task 4 test).
- The closed chat has `user_name` NULL: the new ticket takes the sender's name (Task 4 test).
- An admin replies to a closed **Promotion** chat: still stored as today, no rejection (Task 4 test).
- A user who never chatted with CS opens the thread: empty thread with `current: null`, not an error (Task 7 test).

---

### Task 1: Migration and DB test helpers

**Files:**
- Create: `sql/dbchanges_202611181400.sql`
- Create: `deploy/sql/10_dbchanges_202611181400.sql`
- Modify: `docs/panduan-menjalankan-dan-menguji.md` (step that pipes `08` and `09` must include `10`)
- Modify: `test-db/helpers.ts`
- Create: `test-db/migration-10.test.ts`

**Interfaces:**
- Produces (in `test-db/helpers.ts`):
  - `cleanupTestChats()` also removes chats (and their messages) with `user_id LIKE 'test-awc-%'`. Chats created by the code under test get random tickets, so the ticket filter alone misses them.
  - `insertChat(opts)` accepts three new options: `userId?: string` (default `'test-awc-' + tag`), `userName?: string | null` (default `'Test ' + tag`), and `closedMinutesAgo?: number` (sets `closed_at = NOW() - INTERVAL n MINUTE`).
  - `insertMessage(chatId: number, senderType: "user" | "admin" | "system", senderId: string, minutesAgo: number): Promise<void>`
  - `getMessages(chatId: number): Promise<Array<{ id: number; sender_type: string; sender_id: string; sender_name: string | null; message: string | null; metadata: unknown }>>`. Rows are ordered `created_at, id`. A string `metadata` is `JSON.parse`d.
  - `fakeIO(): { io: Server; emitted: Array<{ rooms: string[]; event: string; payload: any }> }`. `io.to(a).to(b).emit(...)` records `rooms: [a, b]`. `io.emit(...)` records `rooms: ["*"]`. The caller passes `io` to `setIO`.

- [ ] **Step 1: Write the migration files**

Both files run these statements. The deploy copy adds the header (pattern of `deploy/sql/09_*`) and `USE \`maxco_chat_im\`;`.
- `ALTER TABLE list_messages MODIFY COLUMN sender_type ENUM('user','admin','system') NOT NULL;`
- `INSERT INTO list_chat_config (config_key, config_value, description)` with two rows:
  - `auto_close_minutes` = `'0'`, description `Minutes without a user reply after an admin message before a Customer Support chat closes automatically. 0 = off`
  - `auto_close_message` = the default template from Global Constraints. Escape the apostrophe as `haven''t`. Description: `Automated message when a chat closes automatically. {name} = user name, {minutes} = auto_close_minutes`

- [ ] **Step 2: Apply the migration to the local DB in `.env.local`**

Run: `"$MYSQL" -u root maxco_chat_im < sql/dbchanges_202611181400.sql` (`$MYSQL` as in `docs/panduan-menjalankan-dan-menguji.md`).
Expected: no output, exit 0.

- [ ] **Step 3: Update the helpers and write `test-db/migration-10.test.ts`**

```ts
test("a system message can be stored", async () => {
  const id = await insertChat({ tag: "mig-system" });
  await insertMessage(id, "system", "system", 0);
  assert.equal((await getMessages(id))[0]?.sender_type, "system");
});

test("auto-close config rows exist", async () => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT config_key, config_value FROM list_chat_config WHERE config_key IN ('auto_close_minutes','auto_close_message')");
  const map = Object.fromEntries(rows.map((r) => [r.config_key, r.config_value]));
  assert.ok(Number.isFinite(Number(map.auto_close_minutes)));
  assert.match(map.auto_close_message, /\{name\}/);
  assert.match(map.auto_close_message, /\{minutes\}/);
  assert.ok(map.auto_close_message.length <= 255);
});
```

Wrap them in `describe(..., { skip: !hasDb && "MYSQLDATABASE not set" })`, with `before`/`after` calling `cleanupTestChats` and a top-level `after(() => pool.end())`, as in `test-db/assign-waiting-chat.test.ts`.

- [ ] **Step 4: Run the DB tests**

Run: `npm run test:db`
Expected: all suites PASS, including the existing `assign-waiting-chat` and `send-message-assign` (helper changes are backwards compatible).

- [ ] **Step 5: Commit**

```bash
git add sql/dbchanges_202611181400.sql deploy/sql/10_dbchanges_202611181400.sql docs/panduan-menjalankan-dan-menguji.md test-db/helpers.ts test-db/migration-10.test.ts
git commit -m "feat(db): system sender type and auto-close config"
```

---

### Task 2: Auto-close helpers (pure)

**Files:**
- Create: `src/utils/autoClose.ts`
- Create: `src/utils/interval.ts`
- Test: `test/auto-close/utils.test.ts`

**Interfaces:**
- Produces (in `src/utils/autoClose.ts`):
  - `DEFAULT_AUTO_CLOSE_MESSAGE: string` (exact template from Global Constraints)
  - `AUTO_CLOSE_WINDOW_MINUTES = 60`
  - `SYSTEM_SENDER_ID = "system"`
  - `SYSTEM_SENDER_NAME = "Maxco Customer Support"`
  - `parseAutoCloseMinutes(raw: unknown): number`. A finite value `> 0` is floored. Anything else returns `0`.
  - `renderAutoCloseMessage(template: string, values: { name: string | null | undefined; minutes: number }): string`. Replaces every `{name}` with the trimmed name, or `there` when the name is empty or missing. Replaces every `{minutes}` with the number.
- Produces (in `src/utils/interval.ts`):
  - `createNonOverlappingRunner(run: () => Promise<unknown>, onError?: (err: unknown) => void): () => Promise<void>`. A call while the previous `run` is still pending is skipped. A rejection goes to `onError` (default `console.error`) and never throws.
  - `startNonOverlappingInterval(run: () => Promise<unknown>, intervalMs: number): () => void`. Uses `setInterval` with the runner, calls `unref()` on the timer, and returns a stop function.

- [ ] **Step 1: Write the failing tests**

```ts
test("parseAutoCloseMinutes", () => {
  assert.equal(parseAutoCloseMinutes("10"), 10);
  assert.equal(parseAutoCloseMinutes("10.7"), 10);
  for (const raw of ["0", "", "abc", "-5", undefined, null, "0.5"]) assert.equal(parseAutoCloseMinutes(raw), 0);
});

test("renderAutoCloseMessage fills every placeholder", () => {
  assert.equal(renderAutoCloseMessage("Hi {name}, {minutes} min. Bye {name}", { name: " Priya ", minutes: 10 }), "Hi Priya, 10 min. Bye Priya");
  assert.equal(renderAutoCloseMessage("Hi {name}", { name: null, minutes: 10 }), "Hi there");
  assert.equal(renderAutoCloseMessage("Hi {name}", { name: "  ", minutes: 10 }), "Hi there");
  assert.ok(DEFAULT_AUTO_CLOSE_MESSAGE.length <= 255);
});

test("runner skips a tick while the previous run is pending", async () => {
  let calls = 0; let release!: () => void;
  const tick = createNonOverlappingRunner(() => { calls++; return new Promise<void>((r) => { release = r; }); });
  const first = tick(); await tick();
  assert.equal(calls, 1);
  release(); await first; await tick();
  assert.equal(calls, 2);
});

test("runner reports a failed run and keeps going", async () => {
  const errors: unknown[] = [];
  let calls = 0;
  const tick = createNonOverlappingRunner(async () => { calls++; throw new Error("boom"); }, (e) => errors.push(e));
  await tick(); await tick();
  assert.equal(calls, 2);
  assert.equal(errors.length, 2);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test test/auto-close/utils.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both files to the interfaces above**

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/autoClose.ts src/utils/interval.ts test/auto-close/utils.test.ts
git commit -m "feat: auto-close message template and non-overlapping interval helpers"
```

---

### Task 3: Auto-close service and job

**Files:**
- Create: `src/services/autoCloseService.ts`
- Modify: `src/app.ts` (start the job right after `setIO(io)`)
- Modify: `docs/integration-guide-app.md`, `docs/integration-guide-crm.md` (new section "Tickets", subsection "Automated close")
- Test: `test-db/auto-close.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces. Also `getIO()`, `sendChatPush(payload)`, and `getChatById(chatId: string)` from `chatService.ts`.
- Produces (in `src/services/autoCloseService.ts`):
  - `getAutoCloseMinutes(): Promise<number>`. Reads the `auto_close_minutes` row and passes it through `parseAutoCloseMinutes`. On a query error it logs a warning and returns `0`.
  - `getAutoCloseTemplate(): Promise<string>`. Reads the `auto_close_message` row. Returns `DEFAULT_AUTO_CLOSE_MESSAGE` when the row is missing, blank, or the query fails.
  - `findAutoCloseCandidates(minutes: number): Promise<number[]>`. Returns the ids of the chats that match the idle rule.
  - `closeIdleChat(chatId: number, minutes: number, template: string): Promise<boolean>`
  - `runAutoClose(): Promise<number>`. Returns `0` right away when minutes `<= 0`. Otherwise it runs `closeIdleChat` on every candidate, logs and skips a failing chat, and returns how many it closed (and logs that count when it is above 0).

- [ ] **Step 1: Write the failing tests** (N = 10, `const { io, emitted } = fakeIO(); setIO(io);` at file top)

```ts
test("candidates follow the idle rule", async () => {
  const idle = await insertChat({ tag: "ac-idle", status: "active" });
  await insertMessage(idle, "user", "test-awc-ac-idle", 15); await insertMessage(idle, "admin", "A1", 11);
  const userLast = await insertChat({ tag: "ac-user" });
  await insertMessage(userLast, "admin", "A1", 30); await insertMessage(userLast, "user", "test-awc-ac-user", 20);
  const fresh = await insertChat({ tag: "ac-fresh" });   await insertMessage(fresh, "admin", "A1", 9);
  const old = await insertChat({ tag: "ac-old" });       await insertMessage(old, "admin", "A1", 75);
  const promo = await insertChat({ tag: "ac-promo", categoryId: 2, status: "active" }); await insertMessage(promo, "admin", "A1", 11);
  const closed = await insertChat({ tag: "ac-closed", status: "closed" }); await insertMessage(closed, "admin", "A1", 11);
  const empty = await insertChat({ tag: "ac-empty" });

  const ids = await findAutoCloseCandidates(10);
  assert.ok(ids.includes(idle));
  for (const id of [userLast, fresh, old, promo, closed, empty]) assert.ok(!ids.includes(id), `chat ${id} must not be a candidate`);
});

test("closeIdleChat closes, stores the automated message and emits", async () => {
  const id = await insertChat({ tag: "ac-close", status: "active" });
  await insertMessage(id, "admin", "A1", 11);
  emitted.length = 0;
  assert.equal(await closeIdleChat(id, 10, "Hi {name}, {minutes} min"), true);
  assert.equal((await getChat(id)).status, "closed");
  const last = (await getMessages(id)).at(-1)!;
  assert.deepEqual(
    { t: last.sender_type, s: last.sender_id, n: last.sender_name, m: last.message, meta: last.metadata },
    { t: "system", s: "system", n: "Maxco Customer Support", m: "Hi Test ac-close, 10 min", meta: { type: "auto_close" } });
  assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [[[`chat_${id}`], "new_message"], [[`chat_${id}`], "chat_closed"]]);
  assert.equal(emitted[0]!.payload.sender_type, "system");
  assert.equal(emitted[1]!.payload.reason, "auto_no_reply");
  assert.equal(emitted[1]!.payload.chatData.status, "closed");
});

test("closeIdleChat twice stores one automated message", async () => {
  const id = await insertChat({ tag: "ac-twice", status: "active" });
  await insertMessage(id, "admin", "A1", 11);
  assert.equal(await closeIdleChat(id, 10, "x"), true);
  assert.equal(await closeIdleChat(id, 10, "x"), false);
  assert.equal((await getMessages(id)).filter((m) => m.sender_type === "system").length, 1);
});

test("closeIdleChat does nothing once the user has replied", async () => {
  const id = await insertChat({ tag: "ac-replied", status: "active" });
  await insertMessage(id, "admin", "A1", 11); await insertMessage(id, "user", "test-awc-ac-replied", 0);
  emitted.length = 0;
  assert.equal(await closeIdleChat(id, 10, "x"), false);
  assert.equal((await getChat(id)).status, "active");
  assert.deepEqual(emitted, []);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/auto-close.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/services/autoCloseService.ts`**

`findAutoCloseCandidates` and the guard `UPDATE` in `closeIdleChat` share one SQL fragment for the idle rule, so the two cannot drift apart. Bind values: `[minutes, minutes + AUTO_CLOSE_WINDOW_MINUTES]`.

```sql
lc.category_id = 1
AND lc.status IN ('pending', 'active')
AND (SELECT m.sender_type FROM list_messages m WHERE m.chat_id = lc.id
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = 'admin'
AND NOT EXISTS (SELECT 1 FROM list_messages m WHERE m.chat_id = lc.id
                AND m.created_at > NOW() - INTERVAL ? MINUTE)
AND EXISTS (SELECT 1 FROM list_messages m WHERE m.chat_id = lc.id AND m.sender_type = 'admin'
            AND m.created_at >= NOW() - INTERVAL ? MINUTE)
```

`closeIdleChat` runs these steps in order:
1. `UPDATE list_chats lc SET lc.status = 'closed', lc.closed_at = NOW() WHERE lc.id = ? AND <fragment>`. Return `false` when `affectedRows` is not 1.
2. Read the chat. Render the template with `user_name` and `minutes`.
3. Insert the system message (values from Global Constraints).
4. Read the chat again for `chatData`.
5. Emit `new_message` to `chat_<id>`. Use the same field set as the `sendMessage` result, with `is_just_assigned: false`, `previous_chat_id: null`, `is_new_ticket: false`.
6. Emit `chat_closed` `{ chatId, chatData, reason: "auto_no_reply" }` to `chat_<id>`.
7. Call `void sendChatPush({ userId, chatId: String(id), title: SYSTEM_SENDER_NAME, body: text })`.
8. Return `true`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/auto-close.test.ts`
Expected: PASS.

- [ ] **Step 5: Start the job in `src/app.ts`**

Add `startNonOverlappingInterval(runAutoClose, 60_000);` right after `setIO(io);`.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Document the contract**

Add to both guides:
- `sender_type: 'system'` messages and how to render them ("Automated message"), with `metadata.type === 'auto_close'`.
- `chat_closed.reason` values.
- The idle rule and window.
- The config keys, and that `auto_close_minutes` ships as `0` and is turned on after the app and CRM releases.

- [ ] **Step 7: Commit**

```bash
git add src/services/autoCloseService.ts src/app.ts test-db/auto-close.test.ts docs/integration-guide-app.md docs/integration-guide-crm.md
git commit -m "feat: auto-close idle Customer Support chats with an automated message"
```

---

### Task 4: Ticket routing in `sendMessage`

**Files:**
- Modify: `src/services/chatService.ts` (`createNewChat` ~line 98, `sendMessage` ~line 212)
- Modify: `src/utils/dataModel.ts` (`ChatDataInfo`)
- Test: `test-db/ticket-routing.test.ts`

**Interfaces:**
- Produces (in `src/utils/dataModel.ts`): `ChatDataInfo` now matches the real `list_chats` row. The pool uses `dateStrings: true`. Fields:
  - `id: number`, `chat_ticket: string`, `category_id: number`, `user_id: string`, `status: string`
  - `user_name`, `user_referrer_id`, `user_referrer_name`, `admin_id`, `admin_name`: all `string | null`
  - `created_at: string`, `closed_at: string | null`

  The old `created_date` / `closed_date` were wrong names. The only user of the type is the cast in `sendMessage`.
- Produces (in `src/services/chatService.ts`):
  - `export class ChatClosedError extends Error`, with `readonly chatId: number | string` and `name = "ChatClosedError"`.
  - `createNewChat(userId, userName, userReferrer = "")`. Signature unchanged. It is now serialized per `userId`.
  - `sendMessage(input)` result changes in three ways:
    - gains `previous_chat_id: number | null` (the closed chat the message was addressed to),
    - gains `is_new_ticket: boolean`,
    - `chat_id` and `chat_data` now describe the chat the message was stored in.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests** (`fakeIO` + `setIO`, user `test-awc-rt-*`)

```ts
const userMsg = (chatId: number | string, userId: string, name: string | null = "Priya") =>
  sendMessage({ chat_id: chatId as number, sender_id: userId, sender_type: "user", sender_name: name, content_type: 1, message: "hi again" });

test("user message to a closed CS chat opens a new ticket", async () => {
  const old = await insertChat({ tag: "rt-new", status: "closed", closedMinutesAgo: 60 });
  await pool.query("UPDATE list_chats SET user_referrer_id = 'REF1' WHERE id = ?", [old]);
  const res = await userMsg(old, "test-awc-rt-new");
  assert.notEqual(res.chat_id, old);
  assert.equal(res.previous_chat_id, old);
  assert.equal(res.is_new_ticket, true);
  assert.equal(res.chat_data?.status, "pending");
  assert.match(String(res.chat_data?.chat_ticket), /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal((res.chat_data as any).user_referrer_id, "REF1");
  assert.equal((await getChat(old)).status, "closed");
  assert.equal((await getMessages(old)).length, 0);
  assert.equal((await getMessages(Number(res.chat_id))).length, 1);
});

test("string chat_id is rerouted too", async () => {
  const old = await insertChat({ tag: "rt-str", status: "closed" });
  assert.equal((await userMsg(String(old), "test-awc-rt-str")).previous_chat_id, old);
});

test("an open CS chat of the user is reused", async () => {
  const old = await insertChat({ tag: "rt-reuse-a", userId: "test-awc-rt-reuse", status: "closed" });
  const open = await insertChat({ tag: "rt-reuse-b", userId: "test-awc-rt-reuse", status: "active" });
  const res = await userMsg(old, "test-awc-rt-reuse");
  assert.equal(Number(res.chat_id), open);
  assert.equal(res.is_new_ticket, false);
});

test("two messages at once open one ticket", async () => {
  const old = await insertChat({ tag: "rt-race", status: "closed" });
  const [a, b] = await Promise.all([userMsg(old, "test-awc-rt-race"), userMsg(old, "test-awc-rt-race")]);
  assert.equal(a.chat_id, b.chat_id);
  assert.equal([a, b].filter((r) => r.is_new_ticket).length, 1);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM list_chats WHERE user_id = 'test-awc-rt-race' AND category_id = 1 AND status IN ('pending','active')");
  assert.equal(Number(rows[0]!.n), 1);
});

test("new ticket takes the sender name when the old chat has none", async () => {
  const old = await insertChat({ tag: "rt-noname", status: "closed", userName: null });
  assert.equal((await userMsg(old, "test-awc-rt-noname", "Priya")).chat_data?.user_name, "Priya");
});

test("admin message to a closed CS chat is rejected and not stored", async () => {
  const id = await insertChat({ tag: "rt-admin", status: "closed" });
  await assert.rejects(
    sendMessage({ chat_id: id, sender_id: "A1", sender_type: "admin", sender_name: "CS", content_type: 1, message: "late" }),
    ChatClosedError);
  assert.equal((await getMessages(id)).length, 0);
});

test("admin message to a closed Promotion chat is stored as today", async () => {
  const id = await insertChat({ tag: "rt-promo", categoryId: 2, status: "closed" });
  const res = await sendMessage({ chat_id: id, sender_id: "A1", sender_type: "admin", sender_name: "CS", content_type: 1, message: "promo" });
  assert.equal(Number(res.chat_id), id);
  assert.equal(res.previous_chat_id, null);
});

test("user message to a closed Inside Sales chat stays in that chat", async () => {
  const id = await insertChat({ tag: "rt-sales", categoryId: 3, status: "closed" });
  assert.equal(Number((await userMsg(id, "test-awc-rt-sales")).chat_id), id);
});

test("user message to an open CS chat is unchanged", async () => {
  const id = await insertChat({ tag: "rt-open", status: "active" });
  const res = await userMsg(id, "test-awc-rt-open");
  assert.deepEqual([Number(res.chat_id), res.previous_chat_id, res.is_new_ticket], [id, null, false]);
});

test("a client cannot send a system message", async () => {
  const id = await insertChat({ tag: "rt-forge", status: "active" });
  await assert.rejects(
    sendMessage({ chat_id: id, sender_id: "x", sender_type: "system", sender_name: "x", content_type: 1, message: "fake" }),
    /Invalid sender_type/);
  assert.equal((await getMessages(id)).length, 0);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/ticket-routing.test.ts`
Expected: FAIL (`ChatClosedError` not exported, and the reroute assertions fail).

- [ ] **Step 3: Serialize `createNewChat` per user**

Move the current body into an unexported `createNewChatUnlocked`. `createNewChat` chains each call behind the previous pending call for the same `userId`, using a module-level `Map<string, Promise<unknown>>`. The second caller's existence check therefore sees the first caller's row. Remove the map entry when the latest call settles. `POST /api/chats` gets the lock automatically.

- [ ] **Step 4: Route in `sendMessage`**

Before the existing assign step:
1. Throw `new Error("Invalid sender_type")` unless `sender_type` is `"user"` or `"admin"`.
2. Read the chat with `getChatById(String(chat_id))`.
3. If the chat exists, `Number(category_id) === 1` and `status === "closed"`:
   - for an admin sender, throw `new ChatClosedError(chat_id)`;
   - for a user sender, call `createNewChat(chat.user_id, chat.user_name || sender_name || "", chat.user_referrer_id ?? "")`, store the message in the returned chat, and set `previous_chat_id = Number(chat.id)` and `is_new_ticket = isNew`.
4. Otherwise behave as today, with `previous_chat_id: null` and `is_new_ticket: false`.

The assign step, the file handling, and the `chat_data` read all use the target chat id.

- [ ] **Step 5: Run the DB tests and confirm they pass**

Run: `npm run test:db`
Expected: all PASS, including the existing `send-message-assign`.

- [ ] **Step 6: Commit**

```bash
git add src/services/chatService.ts src/utils/dataModel.ts test-db/ticket-routing.test.ts
git commit -m "feat: user message to a closed CS ticket opens a new ticket"
```

---

### Task 5: Socket delivery of ticket events

**Files:**
- Create: `src/sockets/messageDelivery.ts`
- Modify: `src/sockets/chatSocket.ts` (`send_message` handler ~line 22, `close_chat` handler ~line 64)
- Modify: `docs/integration-guide-app.md`, `docs/integration-guide-crm.md` (subsection "New ticket")
- Test: `test/chat/message-delivery.test.ts`

**Interfaces:**
- Consumes: `sendMessage` result and `ChatClosedError` (Task 4).
- Produces (in `src/sockets/messageDelivery.ts`, no DB imports):
  - `type SentMessage = { chat_id: number | string; previous_chat_id: number | null; is_new_ticket: boolean; chat_data: { id: number; user_id: string; user_name?: string | null; chat_ticket: string; status: string; created_at: unknown } | null; [key: string]: unknown }`
  - `deliverSentMessage(io: Pick<Server, "to" | "emit">, socket: Pick<Socket, "join">, msg: SentMessage): void`

- [ ] **Step 1: Write the failing tests**

Use a local fake with chained `to()`, the same shape as `fakeIO` but without `pool`. The socket fake records `join` calls.

```ts
test("normal message goes to its chat room only", () => {
  const { io, emitted, socket, joined } = setup();
  deliverSentMessage(io, socket, { chat_id: 5, previous_chat_id: null, is_new_ticket: false, chat_data: chat(5) });
  assert.deepEqual(joined, []);
  assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [[["chat_5"], "new_message"]]);
});

test("new ticket: join, deliver to new room and user channel, announce", () => {
  const { io, emitted, socket, joined } = setup();
  const data = chat(11);
  deliverSentMessage(io, socket, { chat_id: 11, previous_chat_id: 10, is_new_ticket: true, chat_data: data });
  assert.deepEqual(joined, ["chat_11"]);
  assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [
    [["chat_11", "user_u1"], "new_message"],
    [["user_u1"], "new_user_chatroom"],
    [["*"], "chat_room_created"],
  ]);
  assert.deepEqual(emitted[1]!.payload, { chatData: data });
  assert.deepEqual(emitted[2]!.payload, { id: 11, user_id: "u1", chat_ticket: data.chat_ticket, status: "pending", created_at: data.created_at, user_name: "Priya" });
});

test("reroute to an existing open ticket does not announce a new room", () => {
  const { io, emitted, socket } = setup();
  deliverSentMessage(io, socket, { chat_id: 12, previous_chat_id: 10, is_new_ticket: false, chat_data: chat(12) });
  assert.ok(!emitted.some((e) => e.event === "chat_room_created"));
});
```

`chat(id)` returns `{ id, user_id: "u1", user_name: "Priya", chat_ticket: "AAAA-BBBB-CCCC", status: "pending", created_at: "2026-11-18 10:02:00" }`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test test/chat/message-delivery.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `deliverSentMessage`**

- `previous_chat_id === null`: one `new_message` emit to `chat_<chat_id>`, as today.
- `previous_chat_id !== null`, in this order:
  1. `socket.join` the new room.
  2. One `new_message` emit to `chat_<new>` plus `user_<user_id>`, chained so each socket receives it once.
  3. `new_user_chatroom` to `user_<user_id>`.
  4. `chat_room_created` to everyone, only when `is_new_ticket`.
- If `chat_data` is null, fall back to the chat-room emit only.

- [ ] **Step 4: Wire `chatSocket.ts`**

- `send_message`: call `deliverSentMessage(io, socket, payload)` in place of the direct `new_message` emit. The push block stays as it is.
- In the `catch`: for an `instanceof ChatClosedError` error, call `socket.emit("send_message_error", { chat_id: data?.chat_id, reason: "chat_closed" })` and return. Other errors keep logging.
- `close_chat`: add `reason: "agent"` to the `chat_closed` payload.

- [ ] **Step 5: Run the tests and the type check**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Document the contract**

- **App guide:**
  - always send to the current CS chat id, even when it is closed, and keep input enabled;
  - on `new_message` with `is_new_ticket` or a `chat_id` different from the current one, switch to the new chat and draw "New ticket opened";
  - `new_user_chatroom`.
- **CRM guide:**
  - a new ticket arrives via `chat_room_created`;
  - `send_message_error` with `reason: 'chat_closed'` (disable input in closed CS chats);
  - `chat_closed.reason`.

- [ ] **Step 7: Commit**

```bash
git add src/sockets/messageDelivery.ts src/sockets/chatSocket.ts test/chat/message-delivery.test.ts docs/integration-guide-app.md docs/integration-guide-crm.md
git commit -m "feat: deliver new-ticket events and reject replies to closed CS chats"
```

---

### Task 6: CRM REST close notifies the chat room

**Files:**
- Modify: `src/controllers/crmChatController.ts` (`crmCloseChat` ~line 157)
- Modify: `docs/integration-guide-crm.md` (`chat_closed` now also follows the REST close)
- Test: `test-db/crm-close-chat.test.ts`

**Interfaces:**
- Consumes: `getIO()`. `fakeIO` from Task 1.

- [ ] **Step 1: Write the failing tests** (fake `req = { body: { chatId } }`, and a fake `res` with `status()` returning itself and `json()` recording its body)

```ts
test("REST close emits chat_closed with reason agent", async () => {
  const id = await insertChat({ tag: "cc-ok", status: "active" });
  emitted.length = 0;
  await crmCloseChat({ body: { chatId: id } } as any, res as any);
  assert.equal(sent.body.success, true);
  assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [[[`chat_${id}`], "chat_closed"]]);
  assert.equal(emitted[0]!.payload.reason, "agent");
  assert.equal(emitted[0]!.payload.chatData.status, "closed");
});

test("unknown chat emits nothing", async () => {
  emitted.length = 0;
  await crmCloseChat({ body: { chatId: 999999999 } } as any, res as any);
  assert.equal(sent.status, 404);
  assert.deepEqual(emitted, []);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/crm-close-chat.test.ts`
Expected: FAIL, nothing is emitted.

- [ ] **Step 3: Emit after a successful close**

After `fetchChatById`, emit `getIO().to(\`chat_${chatId}\`).emit("chat_closed", { chatId, chatData: data, reason: "agent" })`. The response body stays the same.

- [ ] **Step 4: Run the tests and confirm they pass, then update the CRM guide**

Run: `npm run test:db`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/crmChatController.ts test-db/crm-close-chat.test.ts docs/integration-guide-crm.md
git commit -m "fix: CRM REST close tells the chat room the chat is closed"
```

---

### Task 7: Support thread endpoint and unread counts

**Files:**
- Modify: `src/services/clientChatService.ts`
- Modify: `src/controllers/clientChatController.ts`
- Modify: `src/routes/clientRoutes.ts`
- Modify: `docs/integration-guide-app.md` (subsection "Support thread")
- Test: `test-db/support-thread.test.ts`

**Interfaces:**
- Produces (in `src/services/clientChatService.ts`):
  - `type SupportTicket = { chat_id: number; chat_ticket: string; status: string; created_at: string; closed_at: string | null }`
  - `type SupportThreadPage = { messages: RowDataPacket[]; tickets: SupportTicket[]; current: { chat_id: number; chat_ticket: string; status: string } | null; total: number; page: number; pageSize: number; hasMore: boolean }`
  - `fetchSupportThread(userId: string, page = 1, pageSize = 50): Promise<SupportThreadPage>`
    - `messages`: from every `category_id = 1` chat of the user. The page is taken with `created_at DESC, id DESC` and returned oldest-first, the same convention as `fetchChatMessagesPage`.
    - `tickets`: the chats that have messages in this page.
    - `current`: the user's latest CS chat (`created_at DESC, id DESC`).
- Produces (in `src/controllers/clientChatController.ts`): `getSupportThread(req, res)`. Validates `userId` like `getUnread` does. Reads `page`/`pageSize` from the query (defaults 1 and 50, minimum 1). Responds with the shape in Global Constraints.
- Produces (in `src/routes/clientRoutes.ts`): the route `clientRoutes.get("/chat/support-thread/:userId", ClientChat.getSupportThread)`.
- Changes `getClientChatUnread` to count `sender_type IN ('admin', 'system')`.

- [ ] **Step 1: Write the failing tests**

```ts
async function seedThread(u: string) {
  const a = await insertChat({ tag: "th-a", userId: u, status: "closed", minutesAgo: 600, closedMinutesAgo: 500 });
  await insertMessage(a, "user", u, 590); await insertMessage(a, "admin", "A1", 580);
  const b = await insertChat({ tag: "th-b", userId: u, status: "active", minutesAgo: 100 });
  await insertMessage(b, "user", u, 90); await insertMessage(b, "admin", "A1", 80);
  const c = await insertChat({ tag: "th-c", userId: u, categoryId: 3, status: "active" });
  await insertMessage(c, "admin", "S1", 70);
  return { a, b };
}

test("thread merges CS tickets in time order and skips other categories", async () => {
  const { a, b } = await seedThread("test-awc-th1");
  const t = await fetchSupportThread("test-awc-th1");
  assert.deepEqual(t.messages.map((m) => m.chat_id), [a, a, b, b]);
  assert.deepEqual(t.tickets.map((x) => [x.chat_id, x.status]).sort(), [[a, "closed"], [b, "active"]].sort());
  assert.ok(t.tickets.find((x) => x.chat_id === a)!.closed_at);
  assert.deepEqual(t.current && [t.current.chat_id, t.current.status], [b, "active"]);
  assert.deepEqual([t.total, t.hasMore], [4, false]);
});

test("paging walks back without duplicates", async () => {
  await seedThread("test-awc-th2");
  const p1 = await fetchSupportThread("test-awc-th2", 1, 3);
  const p2 = await fetchSupportThread("test-awc-th2", 2, 3);
  assert.deepEqual([p1.messages.length, p1.hasMore, p2.messages.length, p2.hasMore], [3, true, 1, false]);
  const ids = [...p2.messages, ...p1.messages].map((m) => m.id);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
});

test("user without CS chats gets an empty thread", async () => {
  const t = await fetchSupportThread("test-awc-th-none");
  assert.deepEqual([t.messages, t.tickets, t.current, t.total], [[], [], null, 0]);
});

test("unread counts automated messages", async () => {
  const id = await insertChat({ tag: "th-unread", status: "closed" });
  await insertMessage(id, "system", "system", 0);
  const s = await getClientChatUnread("test-awc-th-unread");
  assert.equal(s.chats.find((c) => c.chatId === String(id))?.unread, 1);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/support-thread.test.ts`
Expected: FAIL (`fetchSupportThread` not exported, and the unread count is 0).

- [ ] **Step 3: Implement `fetchSupportThread`, the unread change, the controller and the route**

- [ ] **Step 4: Run the full verification**

Run: `npm test && npm run test:db && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Document the endpoint in the app guide**

Cover:
- the request and response,
- divider placement by `tickets[].created_at` / `closed_at`,
- "Send a message to open a new ticket." only when `current.status === 'closed'`,
- send to `current.chat_id`, or use `POST /api/chats` when `current` is null,
- join `chat_<current.chat_id>` and `user_<userId>`.

- [ ] **Step 6: Commit**

```bash
git add src/services/clientChatService.ts src/controllers/clientChatController.ts src/routes/clientRoutes.ts test-db/support-thread.test.ts docs/integration-guide-app.md
git commit -m "feat: support thread endpoint for the app and unread count for automated messages"
```
