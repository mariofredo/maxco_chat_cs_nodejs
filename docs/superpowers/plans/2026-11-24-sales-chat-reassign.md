# Sales Chat Reassign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client can have many inside sales chats (category 3) over time but only one active. The CRM moves a client to another sales person through a new endpoint, the app sees only the active sales chat, and closed sales chats refuse messages. Nothing is deleted.

**Architecture:** The database unique key on `sales_chat_key` becomes "one *active* sales chat per user" (new idempotent SQL file 12; file 11 stops merging once its index exists). A new `src/services/salesChatService.ts` owns every sales chat creation under one per-user lock: the CRM reassign (close + create in a transaction, socket events), the app path (`source: "app"`: create when none active, report a mismatch, never switch to another sales person) and the old path moved over from `chatService.ts`. `fetchUserChats` gains an "active sales only" option; `routeMessage` / `insertMessageIfOpen` refuse closed sales chats.

**Tech Stack:** Node.js, TypeScript (ESM, `.js` import suffix), Express 5, mysql2, Socket.IO, `node:test` + `tsx`, MySQL 8.0 / MariaDB.

**Spec:** `docs/superpowers/specs/2026-11-24-sales-chat-reassign-design.md`

## Global Constraints

- Sales chat = `category_id` 3. MySQL rows may carry ids and `category_id` as number or string: compare with `String()` / `Number()`.
- Chats and messages are never deleted by this feature (file 11's merge must not touch a database that has the unique index).
- CS (category 1) and Promotion (category 2) behave exactly as today.
- `POST /api/chats/user` without `source` exactly `"app"` behaves exactly as today: no filter, no `salesMismatch`, no switch.
- The app path never moves a client to a different, non-empty sales person. Only `reassign_sales_chat` does that (the app may only replace a chat that has no sales person).
- Endpoint: `POST /api/chats/crm/reassign_sales_chat`, body `user_id`, `user_name`, `user_referrer_id`, `user_referrer_name`. Missing `user_id` or `user_referrer_id` → 400 with message exactly `user_id and user_referrer_id are required`.
- Response field `salesMismatch: { sent, currentReferrerId, currentReferrerName }`, left out (not `null`) when there is no mismatch.
- Socket: `chat_closed` payload `{ chatId, chatData, reason: "sales_changed" }` to room `chat_<old id>` (same shape as `crmCloseChat`); `new_user_chatroom` payload `{ chatData }`.
- Sales person ids and names are trimmed before they are compared or stored.
- SQL files: idempotent, run by hand on MySQL 8.0 and MariaDB. `deploy/` docs describe the structure only: no change history, no "known issues" notes.
- DB tests live in `test-db/` (`npm run test:db`, needs `.env.local` with `MYSQLDATABASE`); their rows use user ids starting with `test-awc-`. From Task 1 on, the local database must have file 12 applied (Task 1 applies it).

## Review Focus

- `userReferrerId` sent as a number (`123`) while the chat stores `"123"`: same sales person, no mismatch. Test in Task 3.
- Spaces around a sales id (`" sales-b "`) from the app or the CRM: same sales person, no new chat, no mismatch. Tests in Tasks 2 and 3.
- Reassign for a client whose only sales chat is **closed**: a new active chat for B, the closed one untouched (status, `closed_at`, messages). Test in Task 2.
- Pagination with the active-only filter: `pagination.total` and `hasMore` count only what the app can see. Test in Task 3.
- A client message that reaches a sales chat closed a moment earlier (after routing, before insert): refused, stored nowhere. Test in Task 4 (`insertMessageIfOpen`).

---

### Task 1: Database — one active sales chat per user

**Files:**
- Create: `sql/dbchanges_202611241200.sql`
- Create: `deploy/sql/12_dbchanges_202611241200.sql` (same SQL; header in the style of `deploy/sql/11_…`)
- Modify: `sql/dbchanges_202611161515.sql` and `deploy/sql/11_dbchanges_202611161515.sql` (step 1 guard, step 5 count, header lines on step 1)
- Modify: `deploy/run-sql.sh` (header comment and the `11_*` case in the plan loop)
- Modify: `deploy/schema.sql:75` (generated expression)
- Modify: `deploy/DATABASE.md` (`sales_chat_key` row, `uq_list_chats_sales_chat` line, §4 rule 2)
- Modify: `deploy/DEPLOYMENT.md` (§5 run-sql description, idempotent note, `03..11` comment, a bullet for 12, troubleshooting row "two inside sales chats")
- Modify: `docs/panduan-menjalankan-dan-menguji.md:31,40` (files `01` to `12`, expected output of 12)
- Modify: `test-db/helpers.ts` (add `runSqlFile`)
- Test: `test-db/migration-12.test.ts`

**Interfaces:**
- Produces: `export async function runSqlFile(relPath: string): Promise<RowDataPacket | undefined>` in `test-db/helpers.ts`. It runs a repo SQL file on a dedicated `mysql2/promise` connection with `multipleStatements: true` (same env settings as `src/config/db.ts`), with its ``USE `…`;`` line removed so the test database is used, closes the connection, and returns the first row of the file's last result set that has rows.
- Produces (database): `sales_chat_key` = `user_id` only when `category_id = 3 AND status = 'active'`.

- [ ] **Step 1: Add `runSqlFile` and write the failing test** `test-db/migration-12.test.ts`:

```ts
const MIGRATION_12 = "sql/dbchanges_202611241200.sql";
const MIGRATION_11 = "sql/dbchanges_202611161515.sql";
const salesChatCount = async (userId: string) =>
  Number((await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM list_chats WHERE user_id = ? AND category_id = 3", [userId]))[0][0]!.n);

describe("migration 12: one active sales chat per user", { skip: !hasDb && "MYSQLDATABASE not set" }, () => {
  before(async () => { await cleanupTestChats(); await runSqlFile(MIGRATION_12); });
  after(cleanupTestChats);

  test("runs again and reports the active-only key", async () => {
    const result = await runSqlFile(MIGRATION_12);
    assert.equal(Number(result?.sales_chat_key_active_only), 1);
    assert.equal(Number(result?.unique_index), 1);
    assert.equal(Number(result?.users_with_two_active_sales_chats), 0);
  });

  test("a closed and an active sales chat of one user coexist", async () => {
    await insertChat({ tag: "m12-both-a", userId: "test-awc-m12-both", categoryId: 3, status: "closed", closedMinutesAgo: 5 });
    await insertChat({ tag: "m12-both-b", userId: "test-awc-m12-both", categoryId: 3, status: "active" });
    assert.equal(await salesChatCount("test-awc-m12-both"), 2);
  });

  test("a second active sales chat is refused", async () => {
    await insertChat({ tag: "m12-dup-a", userId: "test-awc-m12-dup", categoryId: 3, status: "active" });
    await assert.rejects(
      insertChat({ tag: "m12-dup-b", userId: "test-awc-m12-dup", categoryId: 3, status: "active" }),
      { code: "ER_DUP_ENTRY" },
    );
  });

  test("re-running 11 keeps the closed and the active sales chat apart", async () => {
    const user = "test-awc-m12-rerun";
    const oldChat = await insertChat({ tag: "m12-rerun-a", userId: user, categoryId: 3, status: "closed", minutesAgo: 60, closedMinutesAgo: 5 });
    const newChat = await insertChat({ tag: "m12-rerun-b", userId: user, categoryId: 3, status: "active" });
    await insertMessage(oldChat, "admin", "sales-a", 30);
    await insertMessage(newChat, "admin", "sales-b", 1);

    const result11 = await runSqlFile(MIGRATION_11);

    assert.equal(await salesChatCount(user), 2);
    assert.equal((await getMessages(oldChat)).length, 1);
    assert.equal((await getMessages(newChat)).length, 1);
    assert.equal(Number(result11?.users_with_duplicate_sales_chats), 0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/migration-12.test.ts`
Expected: FAIL, `ENOENT` for `sql/dbchanges_202611241200.sql`.

- [ ] **Step 3: Write `sql/dbchanges_202611241200.sql`**

Header in English like `sql/dbchanges_202611181400.sql` (what it does, applies to databases that ran 01..11, idempotent). Body:
1. ``USE `maxco_chat_im`;``
2. When the column `sales_chat_key` exists and its `information_schema.COLUMNS.GENERATION_EXPRESSION` does not contain `active` (prepared statement, `DO 0` otherwise, as in file 11): `ALTER TABLE list_chats MODIFY COLUMN sales_chat_key VARCHAR(100) GENERATED ALWAYS AS (CASE WHEN category_id = 3 AND status = 'active' THEN user_id ELSE NULL END) STORED`. Name no collation (file 11 names none). When the column is missing, nothing happens; the result row shows it.
3. Result `SELECT` with columns `sales_chat_key_active_only` (1 when the expression contains `active`), `unique_index` (1 when `uq_list_chats_sales_chat` exists), `users_with_two_active_sales_chats` (users with more than one category 3 chat in `status = 'active'`). Expected `1, 1, 0`.

Copy it to `deploy/sql/12_dbchanges_202611241200.sql`; only the header differs (new deployments get it through `docker-entrypoint-initdb.d` after 11).

- [ ] **Step 4: Run the test**

Run: same as Step 2.
Expected: the first three tests PASS; "re-running 11 …" FAILS (11 merges the two chats: count 1, or the old chat's message moved).

- [ ] **Step 5: Guard file 11 (both copies)**

Before step 1 of the file: `SET @merge_sales := (SELECT COUNT(*) = 0 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'list_chats' AND INDEX_NAME = 'uq_list_chats_sales_chat');` and add `AND @merge_sales = 1` to the `WHERE` of the `INSERT INTO tmp_sales_chat_keep … SELECT` (the `UPDATE` / `DELETE` join that table, so they do nothing). Step 5's `users_with_duplicate_sales_chats` counts users with more than one category 3 chat **in `status = 'active'`**. Header comment of step 1: "only while the unique index is missing".

- [ ] **Step 6: Run the test to verify it passes**

Run: same as Step 2.
Expected: PASS, 4 tests.

- [ ] **Step 7: Deploy files and docs**

- `deploy/run-sql.sh`: on an existing database, `12_*` runs like `11_*` ("safe to repeat"); header comment says "then 11 and 12 (safe to repeat)".
- `deploy/schema.sql`: generated expression of `sales_chat_key` becomes ``(case when ((`category_id` = 3) and (`status` = _utf8mb4'active')) then `user_id` else NULL end)``.
- `deploy/DATABASE.md`: `sales_chat_key` = `user_id` when `category_id = 3` and `status = 'active'`; its unique key allows one **active** Inside Sales chat per member, closed ones are kept as history; §4 rule 2 becomes "one active chat per member" (import old ones as `closed`, at most one `active` per member; a closed one no longer blocks a new one).
- `deploy/DEPLOYMENT.md`: run-sql description "then 11 and 12 (safe to repeat)"; "Except 11 and 12, no file is idempotent"; comment `03..12_dbchanges`; one bullet saying what `12_dbchanges_202611241200.sql` does and that it is required for databases that already run the app; troubleshooting row: a user shows two **active** inside sales chats → run 11 then 12.
- `docs/panduan-menjalankan-dan-menguji.md`: files `01` to `12`; the last line printed by `12_*.sql` must be `1  1  0`.

- [ ] **Step 8: Run everything**

Run: `npm test` then `npm run test:db`
Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add sql/ deploy/sql/ deploy/run-sql.sh deploy/schema.sql deploy/DATABASE.md deploy/DEPLOYMENT.md docs/panduan-menjalankan-dan-menguji.md test-db/helpers.ts test-db/migration-12.test.ts
git commit -m "feat(sql): one active inside sales chat per user; 11 stops merging once its index exists"
```

---

### Task 2: CRM reassign endpoint

**Files:**
- Create: `src/services/salesChatService.ts`
- Modify: `src/controllers/crmChatController.ts` (new handler `reassignSalesChat`)
- Modify: `src/routes/chatRoutes.ts` (route next to `open_inside_sales_chat`)
- Modify: `test-db/helpers.ts` (`insertChat` gains `referrerId?: string | null; referrerName?: string | null` → `user_referrer_id`, `user_referrer_name`, default `null`)
- Modify: `docs/integration-guide-crm.md`, `docs/live-chat-update-crm.md` (new section + REST/socket table rows)
- Modify: `docs/panduan-menjalankan-dan-menguji.md` (section 7.5/7.6: `curl` for reassign and what to expect)
- Modify: `test.html` (CRM button `Pindah sales`, `data-act="reassignSales"`, next to `Buka inside sales`)
- Test: `test-db/sales-chat-reassign.test.ts`

**Interfaces:**
- Consumes: `findAnyActiveInsideSalesChat(userId: string)` and `fetchChatById(chatId: string)` from `src/services/crmChatService.ts`; `getIO()`; `randomNumericString` (ticket format `XXXX-XXXX-XXXX`, as `createSalesChatIfMissing` builds it).
- Produces, in `src/services/salesChatService.ts`:
  - `export type SalesPerson = { id: string; name: string }`
  - `export type ReassignResult = { chat: RowDataPacket; closedChatId: number | null }`
  - `export function withSalesChatLock<T>(userId: string, task: () => Promise<T>): Promise<T>`: runs tasks of one user one after another (chained like `supportChatQueues` in `chatService.ts`; a failed task does not block the next).
  - `export async function replaceSalesChat(userId: string, userName: string, sales: SalesPerson, current: RowDataPacket | null, notifyUser: boolean): Promise<ReassignResult>`: caller holds the lock. In one transaction: close `current` (`status = 'closed'`, `closed_at = NOW()`, only while `status = 'active'`) when given, insert the new active chat (`user_referrer_id`/`user_referrer_name` and `admin_id`/`admin_name` = sales; `user_name` = `userName` or else `current.user_name`). On `ER_DUP_ENTRY`: roll back and return the active chat that won, `closedChatId: null`, no events. After commit: `chat_closed` (when something closed), then `new_user_chatroom` to `user_<sales.id>` (when `sales.id` is not empty, as today), then to `user_<userId>` when `notifyUser`.
  - `export async function reassignSalesChat(userId: string, userName: string, sales: SalesPerson): Promise<ReassignResult>`: under the lock; trims ids and names; active chat already owned by `sales.id` → `{ chat: current, closedChatId: null }`, no events; otherwise `replaceSalesChat(…, current, true)`.
- Produces: controller `export async function reassignSalesChat(req: Request, res: Response)` in `crmChatController.ts` (import the service one as `reassignSalesChatService`); 200 `{ success: true, data: { chat, closedChatId }, message }`.

- [ ] **Step 1: Extend `insertChat` and write the failing test** `test-db/sales-chat-reassign.test.ts` (fake IO and `res` stub as in `crm-close-chat.test.ts`; `beforeEach` clears `emitted` and `sent`; imports: controller `reassignSalesChat` from `crmChatController.js`, service `reassignSalesChat as reassignSalesChatService` from `salesChatService.js`):

```ts
const call = (body: Record<string, unknown>) =>
  reassignSalesChat({ body } as unknown as Request, res as unknown as Response);
const B = { user_referrer_id: "sales-b", user_referrer_name: "Sales B" };
const salesChats = async (userId: string) =>
  (await pool.query<RowDataPacket[]>(
    "SELECT id, status, user_referrer_id FROM list_chats WHERE user_id = ? AND category_id = 3 ORDER BY id", [userId]))[0];

test("moves the client: A's chat closes, B gets a new active chat", async () => {
  const user = "test-awc-rs-move";
  const old = await insertChat({ tag: "rs-move", userId: user, categoryId: 3, status: "active", referrerId: "sales-a", referrerName: "Sales A" });
  await insertMessage(old, "admin", "sales-a", 5);

  await call({ user_id: user, user_name: "Budi", ...B });

  assert.equal(sent.status, 200);
  assert.equal(sent.body.data.closedChatId, old);
  const chat = sent.body.data.chat;
  assert.notEqual(Number(chat.id), old);
  assert.equal(chat.status, "active");
  assert.equal(Number(chat.category_id), 3);
  assert.equal(chat.user_name, "Budi");
  assert.equal(chat.user_referrer_id, "sales-b");
  assert.equal(chat.user_referrer_name, "Sales B");
  assert.equal(chat.admin_id, "sales-b");
  assert.equal(chat.admin_name, "Sales B");
  assert.equal((await getChat(old)).status, "closed");
  assert.equal((await getMessages(old)).length, 1);
  assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [
    [[`chat_${old}`], "chat_closed"],
    [["user_sales-b"], "new_user_chatroom"],
    [[`user_${user}`], "new_user_chatroom"],
  ]);
  assert.equal(emitted[0]!.payload.reason, "sales_changed");
  assert.equal(Number(emitted[0]!.payload.chatId), old);
  assert.equal(emitted[0]!.payload.chatData.status, "closed");
  assert.equal(Number(emitted[1]!.payload.chatData.id), Number(chat.id));
});

test("no sales chat yet: creates B's chat", async () => {
  const user = "test-awc-rs-none";
  await call({ user_id: user, user_name: "Ani", ...B });
  assert.equal(sent.body.data.closedChatId, null);
  assert.equal(sent.body.data.chat.user_referrer_id, "sales-b");
  assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [
    [["user_sales-b"], "new_user_chatroom"],
    [[`user_${user}`], "new_user_chatroom"],
  ]);
});

test("only a closed sales chat: B gets a new one, the closed one is untouched", async () => {
  const user = "test-awc-rs-closed";
  const old = await insertChat({ tag: "rs-closed", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 30, referrerId: "sales-a" });
  const closedAt = async () => (await pool.query<RowDataPacket[]>("SELECT closed_at FROM list_chats WHERE id = ?", [old]))[0][0]!.closed_at;
  const before = await closedAt();
  await call({ user_id: user, user_name: "Citra", ...B });
  assert.equal(sent.body.data.closedChatId, null);
  assert.equal(await closedAt(), before);
  assert.deepEqual((await salesChats(user)).map((c) => [c.status, c.user_referrer_id]), [["closed", "sales-a"], ["active", "sales-b"]]);
});

test("already B (new name, spaces around the id): nothing changes", async () => {
  const user = "test-awc-rs-same";
  const current = await insertChat({ tag: "rs-same", userId: user, categoryId: 3, status: "active", referrerId: "sales-b", referrerName: "Sales B" });
  await call({ user_id: user, user_name: "Dewi", user_referrer_id: " sales-b ", user_referrer_name: "Sales B (new)" });
  assert.equal(sent.body.data.closedChatId, null);
  assert.equal(Number(sent.body.data.chat.id), current);
  assert.deepEqual(emitted, []);
  assert.equal((await salesChats(user)).length, 1);
});

test("missing user_id or user_referrer_id → 400", async () => {
  await call({ user_name: "X", ...B });
  assert.equal(sent.status, 400);
  assert.equal(sent.body.message, "user_id and user_referrer_id are required");
  await call({ user_id: "test-awc-rs-bad", user_referrer_id: "  " });
  assert.equal(sent.status, 400);
  assert.deepEqual(emitted, []);
});

test("two reassigns at once leave one active chat", async () => {
  const user = "test-awc-rs-race";
  await insertChat({ tag: "rs-race", userId: user, categoryId: 3, status: "active", referrerId: "sales-a" });
  const sales = { id: "sales-b", name: "Sales B" };
  await Promise.all([reassignSalesChatService(user, "Eka", sales), reassignSalesChatService(user, "Eka", sales)]);
  assert.deepEqual((await salesChats(user)).map((c) => [c.status, c.user_referrer_id]), [["closed", "sales-a"], ["active", "sales-b"]]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/sales-chat-reassign.test.ts`
Expected: FAIL, cannot find module `src/services/salesChatService.js` / no export `reassignSalesChat` in the controller.

- [ ] **Step 3: Implement `salesChatService.ts` (lock, `replaceSalesChat`, `reassignSalesChat`), the controller and the route `crmRoutes.post("/reassign_sales_chat", CrmChat.reassignSalesChat)`**

The controller accepts string or number ids (`String()`), trims them; empty after trim → the 400. `user_name` / `user_referrer_name` default to `""`.

- [ ] **Step 4: Run it to verify it passes**

Run: same as Step 2.
Expected: PASS, 6 tests.

- [ ] **Step 5: Docs and test page**

- `docs/integration-guide-crm.md`: section "Moving a client to another sales person": call `POST /api/chats/crm/reassign_sales_chat` right after the move succeeds; body; response; what A's and B's CRM receive (`chat_closed` with `reason: "sales_changed"`, `new_user_chatroom`); safe to repeat; **one-time step right after the release: call it once for every client that has a sales person.** Add rows to its REST / socket tables.
- `docs/live-chat-update-crm.md`: the same in its short style, plus table rows.
- `docs/panduan-menjalankan-dan-menguji.md`: a `curl` example for `reassign_sales_chat` and what to expect (old chat closed, new chat for the new sales person, repeat → `closedChatId: null`).
- `test.html`: `reassignSales: () => api('crm', 'POST', '/api/chats/crm/reassign_sales_chat', { user_id: identity('app').id, user_name: identity('app').name, user_referrer_id: val('referrerId'), user_referrer_name: val('referrerName') })`, button title `POST /api/chats/crm/reassign_sales_chat (user di panel App)`.

- [ ] **Step 6: Run everything and type-check**

Run: `npx tsc --noEmit`, `npm test`, `npm run test:db`
Expected: no type errors; both suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/salesChatService.ts src/controllers/crmChatController.ts src/routes/chatRoutes.ts test-db/helpers.ts test-db/sales-chat-reassign.test.ts docs/integration-guide-crm.md docs/live-chat-update-crm.md docs/panduan-menjalankan-dan-menguji.md test.html
git commit -m "feat(crm): reassign_sales_chat closes the old sales chat and opens one for the new sales person"
```

---

### Task 3: App path — `source: "app"`, active-only list, `salesMismatch`

**Files:**
- Modify: `src/services/salesChatService.ts` (add `ensureAppSalesChat`; move `ensureUserSalesChat` + `createSalesChatIfMissing` here from `src/services/chatService.ts:503-605`, under `withSalesChatLock` instead of `pendingSalesChatEnsures`)
- Modify: `src/services/chatService.ts` (remove the moved code; `fetchUserChats` option)
- Modify: `src/controllers/chatController.ts` (`getUserSalesChat`, imports)
- Modify: `docs/integration-guide-app.md`, `docs/live-chat-update-app.md`
- Modify: `docs/panduan-menjalankan-dan-menguji.md` (7.5: `source: "app"` example and expectations)
- Modify: `test.html:924` (`ensureSales` sends `source: 'app'`)
- Test: `test-db/sales-chat-app.test.ts`

**Interfaces:**
- Consumes: `withSalesChatLock`, `replaceSalesChat`, `reassignSalesChat`, `SalesPerson` (Task 2); `findAnyActiveInsideSalesChat` (crmChatService).
- Produces, in `src/services/salesChatService.ts`:
  - `export type SalesMismatch = { sent: string; currentReferrerId: string; currentReferrerName: string | null }`
  - `export async function ensureAppSalesChat(userId: string, userName: string, sales: SalesPerson): Promise<SalesMismatch | null>`: under the lock, ids/names trimmed. No active sales chat → `replaceSalesChat(…, null, false)`; active chat with `user_referrer_id` NULL or empty and non-empty `sales.id` → `replaceSalesChat(…, current, true)`; same id, or empty `sales.id` → `null`; different non-empty id → `console.warn` (user id, sent id, chat id, current id) and return the mismatch; never changes anything in that case.
  - `export async function ensureUserSalesChat(userId: string, userName: string, userReferrerId: string, userReferrerName: string): Promise<void>`: moved, same behavior as today (any category 3 chat of any status → nothing), now under `withSalesChatLock`.
- Produces, in `src/services/chatService.ts`: `fetchUserChats(userId: string, page?: number, pageSize?: number, categoryIds: number[] = [], options: { activeSalesOnly?: boolean } = {})`; with `activeSalesOnly`, category 3 rows not in `status = 'active'` are left out of the rows **and** the count.
- Controller: `source === "app"` → `ensureAppSalesChat` + `activeSalesOnly: true` + `salesMismatch` when not null; otherwise today's path. `userReferrerId` / `userReferrerName`: string → trimmed, number → `String()`, anything else → `""`.

- [ ] **Step 1: Write the failing test** `test-db/sales-chat-app.test.ts` (fake IO, `res` stub, `beforeEach` reset as in Task 2; imports: controller `getUserSalesChat` from `chatController.js`, `ensureAppSalesChat` and `reassignSalesChat` (service) from `salesChatService.js`):

```ts
const load = (body: Record<string, unknown>) =>
  getUserSalesChat({ body } as unknown as Request, res as unknown as Response);
const app = (userId: string, userReferrerId: unknown, extra: Record<string, unknown> = {}) =>
  load({ userId, userName: "Budi", userReferrerId, userReferrerName: "Sales", source: "app", ...extra });
const salesRows = () => sent.body.data.filter((c: any) => Number(c.category_id) === 3);
const salesChats = async (userId: string) =>
  (await pool.query<RowDataPacket[]>(
    "SELECT id, status, user_referrer_id FROM list_chats WHERE user_id = ? AND category_id = 3 ORDER BY id", [userId]))[0];

test("same sales person: the active chat, no salesMismatch", async () => {
  const user = "test-awc-ap-same";
  const b = await insertChat({ tag: "ap-same", userId: user, categoryId: 3, status: "active", referrerId: "sales-b" });
  await app(user, "sales-b");
  assert.deepEqual(salesRows().map((c: any) => Number(c.id)), [b]);
  assert.equal("salesMismatch" in sent.body, false);
});

test("different sales person: active chat kept, salesMismatch, nothing changed", async () => {
  const user = "test-awc-ap-diff";
  const b = await insertChat({ tag: "ap-diff", userId: user, categoryId: 3, status: "active", referrerId: "sales-b", referrerName: "Sales B" });
  await app(user, "sales-a");
  assert.equal(sent.status, 200);
  assert.deepEqual(salesRows().map((c: any) => Number(c.id)), [b]);
  assert.deepEqual(sent.body.salesMismatch, { sent: "sales-a", currentReferrerId: "sales-b", currentReferrerName: "Sales B" });
  assert.deepEqual((await salesChats(user)).map((c) => c.status), ["active"]);
  assert.deepEqual(emitted, []);
});

test("empty, numeric or padded userReferrerId is not a mismatch", async () => {
  const user = "test-awc-ap-forms";
  await insertChat({ tag: "ap-forms", userId: user, categoryId: 3, status: "active", referrerId: "123" });
  for (const sentId of ["", 123, " 123 "]) {
    await app(user, sentId);
    assert.equal("salesMismatch" in sent.body, false, `sent ${JSON.stringify(sentId)}`);
  }
  assert.equal((await salesChats(user)).length, 1);
});

test("no active sales chat: one is created for the app's sales person, only that sales person is told", async () => {
  const user = "test-awc-ap-new";
  await insertChat({ tag: "ap-new-old", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 10, referrerId: "sales-x" });
  await app(user, "sales-a");
  assert.deepEqual(salesRows().map((c: any) => [c.status, c.user_referrer_id]), [["active", "sales-a"]]);
  assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [[["user_sales-a"], "new_user_chatroom"]]);
});

test("active sales chat without a sales person is replaced", async () => {
  const user = "test-awc-ap-ownerless";
  const old = await insertChat({ tag: "ap-ownerless", userId: user, categoryId: 3, status: "active" });
  await app(user, "sales-a");
  assert.equal((await getChat(old)).status, "closed");
  assert.deepEqual(salesRows().map((c: any) => c.user_referrer_id), ["sales-a"]);
  assert.equal("salesMismatch" in sent.body, false);
  assert.deepEqual(emitted.map((e) => [e.rooms, e.event]), [
    [[`chat_${old}`], "chat_closed"],
    [["user_sales-a"], "new_user_chatroom"],
    [[`user_${user}`], "new_user_chatroom"],
  ]);
});

test("closed sales chats are hidden, CS tickets are not, and the count follows", async () => {
  const user = "test-awc-ap-list";
  await insertChat({ tag: "ap-list-s1", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 60, referrerId: "sales-a" });
  const b = await insertChat({ tag: "ap-list-s2", userId: user, categoryId: 3, status: "active", referrerId: "sales-b" });
  await insertChat({ tag: "ap-list-c1", userId: user, categoryId: 1, status: "closed", closedMinutesAgo: 60 });
  await insertChat({ tag: "ap-list-c2", userId: user, categoryId: 1, status: "active" });
  await app(user, "sales-b");
  assert.deepEqual(salesRows().map((c: any) => Number(c.id)), [b]);
  assert.equal(sent.body.data.length, 3);
  await app(user, "sales-b", { page: 1, pageSize: 2 });
  assert.equal(sent.body.pagination.total, 3);
  assert.equal(sent.body.pagination.hasMore, true);
  await app(user, "sales-b", { page: 2, pageSize: 2 });
  assert.equal(sent.body.data.length, 1);
  assert.equal(sent.body.pagination.hasMore, false);
});

test("without source: today's behavior", async () => {
  const user = "test-awc-ap-legacy";
  await insertChat({ tag: "ap-legacy-a", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 60, referrerId: "sales-a" });
  await insertChat({ tag: "ap-legacy-b", userId: user, categoryId: 3, status: "active", referrerId: "sales-b" });
  await load({ userId: user, userName: "Budi", userReferrerId: "sales-x", userReferrerName: "X" });
  assert.equal(salesRows().length, 2);
  assert.equal("salesMismatch" in sent.body, false);
  assert.equal((await salesChats(user)).length, 2);
  assert.deepEqual(emitted, []);
});

test("app load and reassign at once leave one active chat", async () => {
  const user = "test-awc-ap-race";
  await Promise.all([
    ensureAppSalesChat(user, "Budi", { id: "sales-a", name: "A" }),
    reassignSalesChat(user, "Budi", { id: "sales-b", name: "B" }),
  ]);
  assert.equal((await salesChats(user)).filter((c) => c.status === "active").length, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/sales-chat-app.test.ts`
Expected: FAIL, no export `ensureAppSalesChat`; the list tests fail because closed sales chats are listed and `salesMismatch` is missing.

- [ ] **Step 3: Implement** `ensureAppSalesChat`, the move of `ensureUserSalesChat`, the `fetchUserChats` option and the controller change, as in Interfaces.

- [ ] **Step 4: Run it to verify it passes**

Run: same as Step 2.
Expected: PASS, 8 tests.

- [ ] **Step 5: Docs and test page**

- `docs/integration-guide-app.md` (near the user chat list section, line ~289) and `docs/live-chat-update-app.md`: send `"source": "app"` on `POST /api/chats/user`; with it, closed Inside Sales chats are not listed; `salesMismatch` means the app's sales person is out of date (the list still holds the active chat; refreshing the user's data is optional); on `chat_closed` with `reason: "sales_changed"`, drop that chat and use the one from `new_user_chatroom`. Without `source` nothing changes.
- `docs/panduan-menjalankan-dan-menguji.md` 7.5: the `POST` example gains `"source":"app"`; a second call with another `userReferrerId` returns the same chat plus `salesMismatch`.
- `test.html:924`: `ensureSales` adds `source: 'app'`.

- [ ] **Step 6: Run everything and type-check**

Run: `npx tsc --noEmit`, `npm test`, `npm run test:db`
Expected: no type errors; both suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/salesChatService.ts src/services/chatService.ts src/controllers/chatController.ts test-db/sales-chat-app.test.ts docs/integration-guide-app.md docs/live-chat-update-app.md docs/panduan-menjalankan-dan-menguji.md test.html
git commit -m "feat(app): source app lists only the active sales chat and reports a sales mismatch"
```

---

### Task 4: Closed sales chats refuse messages

**Files:**
- Modify: `src/services/chatService.ts` (`routeMessage`, `insertMessageIfOpen`, `ChatClosedError` doc comment)
- Modify: `docs/integration-guide-crm.md:222`, `docs/live-chat-update-crm.md:74`, `docs/integration-guide-app.md`, `docs/live-chat-update-app.md` (closed Inside Sales chats refuse messages; Promotion unchanged)
- Test: `test-db/sales-chat-closed-send.test.ts`

**Interfaces:**
- Consumes: `sendMessage`, `insertMessageIfOpen`, `ChatClosedError` (existing, `chatService.ts`).
- Produces: no new names. `routeMessage` throws `ChatClosedError` for any sender when the chat is category 3 and `closed`; `insertMessageIfOpen` stores nothing in a closed category 1 **or 3** chat. The socket already turns `ChatClosedError` into `send_message_error` `{ chat_id, reason: "chat_closed" }`, and no push is sent.

- [ ] **Step 1: Write the failing test** `test-db/sales-chat-closed-send.test.ts` (fake IO as in `ticket-routing.test.ts`):

```ts
const send = (chatId: number, senderType: "user" | "admin", senderId: string) =>
  sendMessage({ chat_id: chatId, sender_id: senderId, sender_type: senderType, sender_name: senderId, content_type: 1, message: "hello" });

test("the old sales person cannot write in a closed sales chat", async () => {
  const chat = await insertChat({ tag: "cs-admin", userId: "test-awc-cs-admin", categoryId: 3, status: "closed", closedMinutesAgo: 5, referrerId: "sales-a" });
  await assert.rejects(send(chat, "admin", "sales-a"), ChatClosedError);
  assert.equal((await getMessages(chat)).length, 0);
});

test("the client cannot write in a closed sales chat, and no chat is opened for it", async () => {
  const user = "test-awc-cs-user";
  const chat = await insertChat({ tag: "cs-user", userId: user, categoryId: 3, status: "closed", closedMinutesAgo: 5, referrerId: "sales-a" });
  await assert.rejects(send(chat, "user", user), ChatClosedError);
  assert.equal((await getMessages(chat)).length, 0);
  const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM list_chats WHERE user_id = ?", [user]);
  assert.equal(Number(rows[0]!.n), 1);
});

test("an active sales chat takes messages", async () => {
  const user = "test-awc-cs-active";
  const chat = await insertChat({ tag: "cs-active", userId: user, categoryId: 3, status: "active", referrerId: "sales-b" });
  const res = await send(chat, "user", user);
  assert.equal(Number(res.chat_id), chat);
  assert.equal((await getMessages(chat)).length, 1);
});

test("a closed Promotion chat still takes messages", async () => {
  const chat = await insertChat({ tag: "cs-promo", userId: "test-awc-cs-promo", categoryId: 2, status: "closed", closedMinutesAgo: 5 });
  await send(chat, "admin", "promo-1");
  assert.equal((await getMessages(chat)).length, 1);
});

test("insertMessageIfOpen stores nothing in a closed sales chat", async () => {
  const chat = await insertChat({ tag: "cs-race", userId: "test-awc-cs-race", categoryId: 3, status: "closed", closedMinutesAgo: 1 });
  const id = await insertMessageIfOpen({
    chat_id: chat, sender_id: "test-awc-cs-race", sender_type: "user", sender_name: "x",
    message: "late", content_type: 1, content_url: null, metadata: null,
  });
  assert.equal(id, null);
  assert.equal((await getMessages(chat)).length, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --env-file=.env.local --test --test-concurrency=1 test-db/sales-chat-closed-send.test.ts`
Expected: FAIL on the first two tests and the last one (messages are stored today); the other two PASS.

- [ ] **Step 3: Implement** the `routeMessage` check (before the CS-only branch, using the category 3 constant) and the `insertMessageIfOpen` condition (`NOT (lc.category_id IN (1, 3) AND lc.status = 'closed')` with parameters); update the `ChatClosedError` comment to "a closed Customer Support ticket or a closed Inside Sales chat".

- [ ] **Step 4: Run it to verify it passes**

Run: same as Step 2.
Expected: PASS, 5 tests.

- [ ] **Step 5: Docs**

`integration-guide-crm.md:222` and `live-chat-update-crm.md:74`: closed Inside Sales chats now refuse messages (`send_message_error`, `reason: "chat_closed"`), so disable their input like CS; closed Promotion chats are unchanged. `integration-guide-app.md` / `live-chat-update-app.md`: the same for the app side.

- [ ] **Step 6: Run everything and type-check**

Run: `npx tsc --noEmit`, `npm test`, `npm run test:db`
Expected: no type errors; both suites PASS (including `ticket-routing.test.ts`, whose CS behavior must not change).

- [ ] **Step 7: Commit**

```bash
git add src/services/chatService.ts test-db/sales-chat-closed-send.test.ts docs/integration-guide-crm.md docs/live-chat-update-crm.md docs/integration-guide-app.md docs/live-chat-update-app.md
git commit -m "feat(chat): closed inside sales chats refuse messages"
```

---

Release (image version, `.env.example`, tars) is not part of this plan; it follows as its own release PR, as for 1.1.2.
