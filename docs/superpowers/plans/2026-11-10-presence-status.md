# Online Presence Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the mobile app see whether Customer Support / Sales is online, and let CS and Sales in the CRM see whether a user is on the Live Chat screen. Also relay typing indicators between user and CS inside a chat room.

**Architecture:** An in-memory `PresenceRegistry` (single process) tracks registered admin sockets (per team) and registered user sockets. A socket that disconnects is released after a grace period; every mutation diffs the status before and after and emits only on a flip. A thin Socket.IO layer maps events to registry calls and rooms; two REST endpoints serve the initial state. No database change. Typing indicators (Task 8) are a stateless relay to the chat room and do not use the registry.

**Tech Stack:** Node 24, TypeScript ESM (`NodeNext`), Express 5, Socket.IO 4, `node:test` + `tsx` for tests (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-11-10-presence-status-design.md` (also at https://claude.ai/artifact/Sp9uKQq5BfkL8f3TqEcZhL). Read it together with this plan.

## Execution notes

- This folder is not a git repo yet. Each task ends with a Commit step: do it only if `git init` has been done, otherwise skip it.
- Imports in `src/` use the `.js` extension (`NodeNext`). `tsconfig.json` has `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax` (use `import type` for types).
- Tests live in `test/` (outside `tsconfig` `include: ["src"]`, so they never reach `dist/` or the Docker image). Run one file with `node --import tsx --test test/presence/<file>.test.ts`.
- Out of scope here: the CRM and mobile app changes (spec sections 8 and 10), "last seen", "Average response", Redis.

## Global Constraints

- Teams are exactly `customer_support` and `sales`. Both are online or offline together while every CS counts as sales (spec section 3).
- Grace period: env `PRESENCE_GRACE_SECONDS`, default `10` seconds. `presence_leave` / `presence_user_leave` release the socket immediately; a disconnect releases it after the grace period.
- Client to server events: `presence_register { adminId: string, teams: Team[] }`, `presence_leave {}`, `presence_subscribe { teams?: Team[] }`, `presence_unsubscribe { teams?: Team[] }`, `presence_user_register { userId: string }`, `presence_user_leave {}`.
- Server to client events: `presence_changed { team, online }` to room `presence_<team>`; `presence_user_changed { userId, online }` to room `presence_admins`. Both are emitted only when the status flips.
- A socket that sent a valid `presence_register` joins room `presence_admins`; `presence_leave` leaves it.
- REST: `GET /api/client/presence` returns `{ success: true, data: { customer_support: boolean, sales: boolean } }`. `GET /api/chats/crm/presence?userIds=a,b,c` returns `{ success: true, data: { "<userId>": boolean } }`. Both sit behind the existing API key middleware.
- Existing events, rooms and endpoints must not change.
- Typing (Task 8 only): client to server event `typing { chatId: string | number, isTyping: boolean, senderId: string, senderType: "user" | "admin", senderName?: string }`; the server relays event `typing { chatId: string, isTyping, senderId, senderType, senderName }` (`senderName` is `null` when absent) to room `chat_<chatId>`, excluding the sender socket. It is ignored unless the payload is valid and the sender socket is already in that room. No server state, no timers. Client convention (outside this repo): re-emit `isTyping: true` about every 3 seconds while typing, hide the indicator after 5 seconds without a refresh.

## Review Focus

1. A CS socket drops and the CRM reconnects within the grace period: the team must not flicker offline (Task 1).
2. `presence_leave` arrives for a socket whose disconnect timer is already pending: one offline event, no second event when the timer would have fired (Task 1).
3. Malformed payloads (non-string ids, `teams` not an array, unknown team names, blank ids, `undefined`): ignored, no throw, no state change (Task 4).
4. `userIds` query in every shape the CRM may send: comma string, repeated key, blanks, duplicates, empty, more than 100 (Tasks 3 and 5).
5. The same socket registers twice, or re-registers with different teams: no duplicate event, last call wins (Tasks 1 and 2).
6. A socket that never registered disconnects: no timer is left behind (Task 1).
7. A `typing` event with a malformed payload, or from a socket that never joined the chat room: ignored, no throw, nothing relayed (Task 8).
8. The sender never receives its own `typing` event back (Task 8).

---

## File Structure

- Create `src/services/presenceService.ts`: `PresenceRegistry`, `TEAMS`, `Team`, `teamRoom`, `ADMINS_ROOM`, `getGraceMs`. No Socket.IO import, so it is unit-testable.
- Create `src/utils/presenceInput.ts`: `parseTeams`, `parseUserIds`, `MAX_USER_IDS`.
- Create `src/services/presenceRuntime.ts`: `getPresence()` singleton that wires registry callbacks to `getIO()`.
- Create `src/sockets/presenceSocket.ts`: `registerPresenceSocket`.
- Create `src/sockets/typingSocket.ts`: `registerTypingSocket` (Task 8).
- Modify `src/app.ts`, `src/controllers/clientChatController.ts`, `src/routes/clientRoutes.ts`, `src/controllers/crmChatController.ts`, `src/routes/chatRoutes.ts`, `package.json`, `.env.example`, `deploy/.env.example`, `deploy/DEPLOYMENT.md`, `test.html`.
- Create `test/presence/harness.ts` and the test files named in each task.

---

### Task 1: Registry core (admin teams, grace period) and test runner

**Files:**
- Create: `src/services/presenceService.ts`
- Create: `test/presence/harness.ts`
- Test: `test/presence/registry.test.ts`
- Modify: `package.json` (`scripts.test`)

**Interfaces:**
- Produces (used by Tasks 2 to 5):
  ```ts
  export const TEAMS = ["customer_support", "sales"] as const;
  export type Team = (typeof TEAMS)[number];
  export type PresenceDeps = {
    graceMs: number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
    onTeamChange: (team: Team, online: boolean) => void;
    onUserChange: (userId: string, online: boolean) => void;
  };
  export class PresenceRegistry {
    constructor(deps: PresenceDeps);
    registerAdmin(socketId: string, adminId: string, teams: readonly Team[]): void;
    leaveAdmin(socketId: string): void;
    disconnect(socketId: string): void;
    isTeamOnline(team: Team): boolean;
    teamsStatus(): Record<Team, boolean>;
  }
  export function teamRoom(team: Team): string;   // "presence_<team>"
  export const ADMINS_ROOM = "presence_admins";
  export function getGraceMs(env?: Record<string, string | undefined>): number;
  ```
- `test/presence/harness.ts` produces `createHarness(graceMs?: number)` returning `{ registry, events, advance(ms), pendingTimers() }`. `events` holds strings `team:<team>:<bool>` and `user:<id>:<bool>` in emission order.

- [ ] **Step 1: Add the test script** to `package.json`: `"test": "node --import tsx --test \"test/**/*.test.ts\""`.

- [ ] **Step 2: Write `test/presence/harness.ts`** (fake clock, exact event format the tests assert on):

```ts
import { PresenceRegistry } from "../../src/services/presenceService.js";

export function createHarness(graceMs = 10_000) {
  const events: string[] = [];
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let now = 0;
  let nextId = 1;
  const registry = new PresenceRegistry({
    graceMs,
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
    onTeamChange: (team, online) => events.push(`team:${team}:${online}`),
    onUserChange: (userId, online) => events.push(`user:${userId}:${online}`),
  });
  return {
    registry, events,
    pendingTimers: () => timers.length,
    advance(ms: number) {
      now += ms;
      for (const t of timers.filter((x) => x.at <= now).sort((a, b) => a.at - b.at)) {
        const i = timers.indexOf(t);
        if (i >= 0) { timers.splice(i, 1); t.fn(); }
      }
    },
  };
}
```

- [ ] **Step 3: Write the failing tests** in `test/presence/registry.test.ts` (`node:test` + `node:assert/strict`):

```ts
test("registerAdmin turns the listed teams online, one event per flip", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", ["customer_support", "sales"]);
  assert.deepEqual(h.events, ["team:customer_support:true", "team:sales:true"]);
  assert.deepEqual(h.registry.teamsStatus(), { customer_support: true, sales: true });
});
test("a second admin on an online team emits nothing", () => { /* register s1 then s2 same teams; events length stays 2 */ });
test("re-registering the same socket is idempotent; last teams win", () => {
  // s1 [customer_support, sales] then s1 [sales] -> events end with "team:customer_support:false"; sales stays true; no duplicate sales event
});
test("leaveAdmin releases immediately when it is the last socket", () => { /* offline events at once, no timers */ });
test("leaveAdmin keeps the team online while another socket is registered", () => { /* no offline event */ });
test("disconnect keeps the team online until the grace period ends", () => {
  // register s1; disconnect s1; advance(9_999) -> still online, no offline event; advance(1) -> exactly one "team:...:false" per team
});
test("reconnect inside the grace period never emits offline", () => {
  // register s1; disconnect s1; register s2 (same teams); advance(60_000) -> events only the initial online ones; teams still online
});
test("leaveAdmin cancels a pending grace timer", () => {
  // register s1; disconnect s1; leaveAdmin s1 -> offline emitted once; pendingTimers() === 0; advance(60_000) -> no new events
});
test("disconnect of a socket that never registered schedules nothing", () => { /* pendingTimers() === 0 */ });
test("disconnect twice does not restart the timer", () => { /* disconnect, advance(6_000), disconnect, advance(4_000) -> offline */ });
test("getGraceMs reads PRESENCE_GRACE_SECONDS", () => {
  // {} -> 10000; {PRESENCE_GRACE_SECONDS:"5"} -> 5000; "0" -> 0; "abc" | "-3" | "" -> 10000
});
test("room names", () => {
  assert.equal(teamRoom("sales"), "presence_sales");
  assert.equal(ADMINS_ROOM, "presence_admins");
});
```

- [ ] **Step 4: Run to verify failure.** Run: `npm test` (or the single file). Expected: FAIL, cannot find module `presenceService.js`.

- [ ] **Step 5: Implement `src/services/presenceService.ts`** to the interface above. Decisions the tests do not fix: state is socket-keyed (`Map<socketId, { adminId: string; teams: Set<Team> }>` plus `Map<socketId, handle>` for grace timers); one private snapshot/diff helper wraps every mutation (take `teamsStatus()` before, run the mutation, emit `onTeamChange` in `TEAMS` order for each team that differs); `disconnect` is a no-op when the socket has no entry or already has a pending timer, removes synchronously when `graceMs <= 0`, and otherwise schedules removal through `setTimer`; `leaveAdmin` also clears the socket's pending timer. `adminId` is stored but does not affect team status. Also export `teamRoom` and `ADMINS_ROOM` from this file.

- [ ] **Step 6: Run `npm test`.** Expected: all registry tests PASS. Then `npx tsc --noEmit`: no errors.

- [ ] **Step 7: Commit** (if git exists): `git add package.json src/services/presenceService.ts test/presence && git commit -m "feat: presence registry for admin teams with grace period"`.

---

### Task 2: Registry user presence

**Files:**
- Modify: `src/services/presenceService.ts`
- Test: `test/presence/registry-user.test.ts`

**Interfaces:**
- Consumes: `PresenceRegistry`, `createHarness` from Task 1.
- Produces:
  ```ts
  registerUser(socketId: string, userId: string): void;
  leaveUser(socketId: string): void;
  isUserOnline(userId: string): boolean;
  usersStatus(userIds: readonly string[]): Record<string, boolean>;
  ```
  `disconnect(socketId)` now also releases that socket's user entry.

- [ ] **Step 1: Write the failing tests** in `test/presence/registry-user.test.ts`:

```ts
test("registerUser emits online once and usersStatus reflects it", () => {
  const h = createHarness();
  h.registry.registerUser("s1", "u1");
  h.registry.registerUser("s1", "u1");               // idempotent
  assert.deepEqual(h.events, ["user:u1:true"]);
  assert.deepEqual(h.registry.usersStatus(["u1", "u2"]), { u1: true, u2: false });
});
test("a second device keeps the user online when the first leaves", () => { /* s1+s2 for u1; leaveUser(s1) -> no event; leaveUser(s2) -> "user:u1:false" */ });
test("leaveUser on the last socket goes offline immediately", () => {});
test("disconnect applies the grace period to user sockets; reconnect inside it emits nothing", () => {});
test("user ids and admin ids are separate key spaces", () => {
  // registerAdmin("s1","u1",["sales"]); isUserOnline("u1") === false
});
test("one disconnect releases both the admin and the user entry of a socket", () => {
  // same socket registered as admin and user; disconnect; advance(10_000) -> both offline events
});
```

- [ ] **Step 2: Run** `node --import tsx --test test/presence/registry-user.test.ts`. Expected: FAIL (`registerUser is not a function`).

- [ ] **Step 3: Implement** the four methods and extend `disconnect` and the snapshot/diff helper so a mutation also reports `onUserChange(userId, online)` for each affected user whose status flipped. State: `Map<socketId, userId>`; online means at least one entry for that user id (entries in grace still count).

- [ ] **Step 4: Run `npm test`** (all files). Expected: PASS. `npx tsc --noEmit`: no errors.

- [ ] **Step 5: Commit** (if git exists): `feat: presence registry for user sockets`.

---

### Task 3: Input parsers and runtime wiring

**Files:**
- Create: `src/utils/presenceInput.ts`
- Create: `src/services/presenceRuntime.ts`
- Test: `test/presence/input.test.ts`, `test/presence/runtime.test.ts`

**Interfaces:**
- Consumes: `Team`, `TEAMS`, `PresenceRegistry`, `getGraceMs`, `teamRoom`, `ADMINS_ROOM` (Tasks 1 and 2); `getIO`, `setIO` from `src/sockets/io.ts`.
- Produces:
  ```ts
  // src/utils/presenceInput.ts
  export const MAX_USER_IDS = 100;
  export function parseTeams(input: unknown): Team[];       // valid unique teams in TEAMS order; [] if none
  export function parseUserIds(input: unknown): string[];   // trimmed, unique, non-empty, first-seen order
  // src/services/presenceRuntime.ts
  export function getPresence(): PresenceRegistry;          // lazy singleton, real timers, graceMs = getGraceMs()
  ```

- [ ] **Step 1: Write the failing tests.**

`test/presence/input.test.ts`:
```ts
test("parseTeams keeps valid unique teams in TEAMS order", () => {
  assert.deepEqual(parseTeams(["sales", "customer_support", "sales"]), ["customer_support", "sales"]);
  assert.deepEqual(parseTeams(["x", 5, null]), []);
  for (const bad of [undefined, null, "sales", {}, 7]) assert.deepEqual(parseTeams(bad), []);
});
test("parseUserIds accepts a comma string, an array, or both", () => {
  assert.deepEqual(parseUserIds("a, b,,a"), ["a", "b"]);
  assert.deepEqual(parseUserIds(["a", "b,c", "a"]), ["a", "b", "c"]);
  assert.deepEqual(parseUserIds(["a", 5, {}]), ["a"]);
  for (const bad of [undefined, null, "", "  ,, ", {}, 7]) assert.deepEqual(parseUserIds(bad), []);
});
```
`test/presence/runtime.test.ts` (one process per test file, so the singleton is clean): call `setIO(fake)` where `fake.to(room)` returns `{ emit(event, payload) }` and records `{ room, event, payload }`. Then:
```ts
getPresence().registerAdmin("s1", "a1", ["sales"]);
// recorded: { room: "presence_sales", event: "presence_changed", payload: { team: "sales", online: true } }
getPresence().registerUser("s2", "u1");
// recorded: { room: "presence_admins", event: "presence_user_changed", payload: { userId: "u1", online: true } }
getPresence().registerAdmin("s3", "a2", ["sales"]);   // no new record (no flip)
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** `parseTeams`, `parseUserIds` (string input is split on commas; array items that are strings are split the same way; everything else is ignored) and `getPresence()` (`onTeamChange` emits `presence_changed { team, online }` to `teamRoom(team)`; `onUserChange` emits `presence_user_changed { userId, online }` to `ADMINS_ROOM`; `getIO()` is called at emit time, not at construction).

- [ ] **Step 4: Run `npm test`.** Expected: PASS. `npx tsc --noEmit`: no errors.

- [ ] **Step 5: Commit** (if git exists): `feat: presence input parsers and Socket.IO wiring`.

---

### Task 4: Socket handlers

**Files:**
- Create: `src/sockets/presenceSocket.ts`
- Modify: `src/app.ts` (connection handler, currently lines 57-60)
- Test: `test/presence/socket.test.ts`

**Interfaces:**
- Consumes: `PresenceRegistry`, `ADMINS_ROOM`, `teamRoom`, `TEAMS` (Tasks 1 and 2); `parseTeams` (Task 3); `getPresence` (Task 3).
- Produces:
  ```ts
  export type PresenceSocket = Pick<Socket, "id" | "on" | "join" | "leave">;
  export function registerPresenceSocket(socket: PresenceSocket, registry?: PresenceRegistry): void; // registry defaults to getPresence()
  ```

- [ ] **Step 1: Write the failing tests.** Use a fake socket: `id`, an `on(event, fn)` that stores handlers in a map, and `join`/`leave` that record room names. Use `createHarness()` for the registry.

```ts
test("registers exactly the seven presence listeners", () => {
  assert.deepEqual(Object.keys(handlers).sort(), [
    "disconnect", "presence_leave", "presence_register", "presence_subscribe",
    "presence_unsubscribe", "presence_user_leave", "presence_user_register",
  ]);
});
test("presence_register with valid payload registers the admin and joins presence_admins", () => {
  handlers.presence_register({ adminId: "a1", teams: ["customer_support", "sales"] });
  // registry.teamsStatus() both true; joined includes "presence_admins"
});
test("presence_register ignores malformed payloads without throwing", () => {
  for (const bad of [undefined, {}, { adminId: 1, teams: ["sales"] }, { adminId: "a", teams: "sales" },
                     { adminId: "a", teams: ["x"] }, { adminId: "  ", teams: ["sales"] }]) {
    assert.doesNotThrow(() => handlers.presence_register(bad));
  }
  // teamsStatus() all false; nothing joined
});
test("presence_leave releases the admin immediately and leaves presence_admins", () => {});
test("presence_subscribe joins both team rooms by default, or only the listed valid ones", () => {
  // undefined / {} / { teams: ["x"] } -> presence_customer_support and presence_sales
  // { teams: ["sales"] } -> only presence_sales
});
test("presence_unsubscribe leaves the same rooms presence_subscribe would join", () => {});
test("presence_user_register registers a trimmed non-empty string userId; others are ignored", () => {
  // { userId: " u1 " } -> isUserOnline("u1"); undefined, {}, { userId: 5 }, { userId: "" } -> no change
});
test("presence_user_leave releases the user immediately", () => {});
test("disconnect starts the grace period for admin and user entries", () => {
  // register admin + user on the socket; handlers.disconnect(); still online; advance(10_000) -> offline
});
```

- [ ] **Step 2: Run** `node --import tsx --test test/presence/socket.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `registerPresenceSocket`** to the contract in Global Constraints. Valid `presence_register` needs a non-empty trimmed string `adminId` and `parseTeams(payload?.teams)` non-empty; otherwise return silently. `presence_subscribe` / `presence_unsubscribe` use `parseTeams(...)` and fall back to `TEAMS` when empty. Handlers never throw on any payload (read fields defensively from `unknown`).

- [ ] **Step 4: Wire it in `src/app.ts`**: import `registerPresenceSocket` and call `registerPresenceSocket(socket)` right after `registerChatSocket(io, socket)` in the `connection` handler. Do not touch `chatSocket.ts`.

- [ ] **Step 5: Run `npm test`** (all files). Expected: PASS. `npx tsc --noEmit`: no errors.

- [ ] **Step 6: Commit** (if git exists): `feat: presence socket events`.

---

### Task 5: REST endpoints

**Files:**
- Modify: `src/controllers/clientChatController.ts`, `src/routes/clientRoutes.ts`
- Modify: `src/controllers/crmChatController.ts`, `src/routes/chatRoutes.ts`
- Test: `test/presence/rest.test.ts`

**Interfaces:**
- Consumes: `getPresence` (Task 3); `parseUserIds`, `MAX_USER_IDS` (Task 3).
- Produces:
  ```ts
  // clientChatController.ts
  export function getClientPresence(req: Request, res: Response): void;
  // crmChatController.ts
  export function getCrmUsersPresence(req: Request, res: Response): void;
  ```
  Handlers read `getPresence()` directly (Express passes `next` as a third argument, so no injected default parameter).

- [ ] **Step 1: Write the failing tests.** Fake `res` with `status(code)` (returns itself) and `json(body)` recording the last status (default 200) and body. Call `setIO(fakeIo)` first (as in `runtime.test.ts`) and populate state through `getPresence()`.

```ts
test("GET /api/client/presence reports both teams", () => {
  // initially { success: true, data: { customer_support: false, sales: false } }
  // after registerAdmin("s1","a1",["sales"]) -> sales true, customer_support false
});
test("GET /api/chats/crm/presence returns one boolean per requested id", () => {
  // registerUser("s1","u1"); query { userIds: "u1,u2" } -> data { u1: true, u2: false }
});
test("userIds accepts a repeated key and collapses blanks and duplicates", () => {
  // { userIds: ["u1", "u2"] } and { userIds: " u1 ,u1,, u2" } -> same keys u1, u2
});
test("userIds missing or empty returns 400", () => {
  // undefined, "", " , " -> status 400, { success: false, message: "userIds is required" }
});
test("userIds over the limit returns 400; exactly 100 returns 200", () => {
  // 101 ids -> 400 { success: false, message: "userIds supports at most 100 ids" }; 100 ids -> 200
});
```

- [ ] **Step 2: Run** `node --import tsx --test test/presence/rest.test.ts`. Expected: FAIL (handlers missing).

- [ ] **Step 3: Implement the handlers and routes.** `clientRoutes.get("/presence", ClientChat.getClientPresence)` (mounted under `/api/client`); inside `crmRoutes` in `chatRoutes.ts` add `crmRoutes.get("/presence", CrmChat.getCrmUsersPresence)` (final path `/api/chats/crm/presence`). The limit 100 is `MAX_USER_IDS`; it is this plan's choice (the spec leaves it to the builder).

- [ ] **Step 4: Run `npm test`** (all files). Expected: PASS. `npx tsc --noEmit`: no errors.

- [ ] **Step 5: Commit** (if git exists): `feat: presence REST endpoints`.

---

### Task 6: Configuration and deployment docs

**Files:**
- Modify: `.env.example`, `deploy/.env.example`, `deploy/DEPLOYMENT.md`

- [ ] **Step 1: Add `PRESENCE_GRACE_SECONDS`** to `.env.example` and `deploy/.env.example` as an optional setting: a comment (seconds to wait before a disconnected CRM or app socket counts as offline, default 10; `0` = no grace) plus `PRESENCE_GRACE_SECONDS=10`. `deploy/docker-compose.yml` already uses `env_file: .env`, so no compose change is needed.

- [ ] **Step 2: Add a row** to the environment table in `deploy/DEPLOYMENT.md` section 6: `PRESENCE_GRACE_SECONDS`, required `no`, example `10`, note "seconds before a disconnected CRM/app socket is shown offline".

- [ ] **Step 3: Verify.** Run: `grep -rn PRESENCE_GRACE_SECONDS .env.example deploy src`. Expected: one hit in each of the three docs/config files plus the `getGraceMs` use in `src/services/presenceService.ts`.

- [ ] **Step 4: Commit** (if git exists): `docs: document PRESENCE_GRACE_SECONDS`.

---

### Task 7: Manual end-to-end check with `test.html`

**Files:**
- Modify: `test.html`

- [ ] **Step 1: Extend `test.html`.** Add an optional API key input used as `io(url, { auth: { api_key } })` when filled (and as the `X-API-Key` header for the fetch calls below), plus a "Presence" panel with buttons that emit: `presence_register` (adminId input + checkboxes for the two teams), `presence_leave`, `presence_subscribe`, `presence_unsubscribe`, `presence_user_register` (userId input), `presence_user_leave`; and two fetch buttons for `GET /api/client/presence` and `GET /api/chats/crm/presence?userIds=<input>` that log the JSON. The existing `socket.onAny` already logs `presence_changed` and `presence_user_changed`.

- [ ] **Step 2: Start the server** with `npm run dev:tsx` (presence does not touch the database). Expected log: `Listening on 3000`.

- [ ] **Step 3: Run the checks with two browser tabs** (A = "CRM", B = "app"; connect both, B subscribes first, then fetches). Expected results:
  1. A registers `a1` with both teams: B logs `presence_changed` `customer_support` true and `sales` true; B's `GET /api/client/presence` shows both true.
  2. A leaves: B logs both false immediately.
  3. A registers again, then closes the tab: B logs both false after about 10 seconds, not before.
  4. A registers, then reloads the tab and registers again within 10 seconds: B logs no offline event.
  5. Open a third tab A2 and register `a2`; close A: B stays online; close A2 (after the grace period): B logs offline.
  6. B registers user `u1`, A registers an admin: A logs `presence_user_changed` `u1` true; `GET /api/chats/crm/presence?userIds=u1,u2` shows `{u1:true,u2:false}`; B leaves: A logs false immediately.
  7. Restart with `CHAT_API_KEY=secret` set and repeat 1 and 6: connections without the key fail with `connect_error`; with the key everything behaves as above; fetch without the header returns 401.

- [ ] **Step 4: Commit** (if git exists): `chore: presence panel in test.html`.

---

### Task 8: Typing indicator relay

Independent of Tasks 1 to 7 (no registry). Spec section 10.

**Files:**
- Create: `src/sockets/typingSocket.ts`
- Modify: `src/app.ts` (call it in the `connection` handler)
- Modify: `test.html` (typing control)
- Test: `test/typing/socket.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TypingSocket = Pick<Socket, "id" | "on" | "rooms" | "to">;
  export function registerTypingSocket(socket: TypingSocket): void;
  ```
  The contract of the `typing` event is in Global Constraints.

- [ ] **Step 1: Write the failing tests** in `test/typing/socket.test.ts`. Use a fake socket with `id`, `rooms: Set<string>`, an `on(event, fn)` that stores handlers, and `to(room)` returning `{ emit(event, payload) }` that records `{ room, event, payload }`.

```ts
test("registers exactly one listener: typing", () => {
  assert.deepEqual(Object.keys(handlers), ["typing"]);
});
test("relays to chat_<id> through socket.to (sender excluded)", () => {
  rooms.add("chat_7");
  handlers.typing({ chatId: 7, isTyping: true, senderId: "a1", senderType: "admin", senderName: "CS Ani" });
  assert.deepEqual(recorded, [{ room: "chat_7", event: "typing",
    payload: { chatId: "7", isTyping: true, senderId: "a1", senderType: "admin", senderName: "CS Ani" } }]);
});
test("senderName defaults to null", () => { /* payload.senderName === null */ });
test("ignored when the socket is not in the chat room", () => { /* rooms empty -> recorded.length === 0 */ });
test("ignores malformed payloads without throwing", () => {
  for (const bad of [undefined, {}, { chatId: "", isTyping: true, senderId: "a", senderType: "user" },
    { chatId: 7, isTyping: "yes", senderId: "a", senderType: "user" },
    { chatId: 7, isTyping: true, senderId: "", senderType: "user" },
    { chatId: 7, isTyping: true, senderId: "a", senderType: "bot" }]) {
    assert.doesNotThrow(() => handlers.typing(bad));
  }
  // recorded.length === 0
});
```

- [ ] **Step 2: Run** `node --import tsx --test test/typing/socket.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `registerTypingSocket`.** Normalize `chatId` with `String(...).trim()` (must be non-empty), require `isTyping` to be a boolean, `senderId` a non-empty trimmed string, `senderType` exactly `user` or `admin`; read the payload defensively from `unknown`. Relay with `socket.to(`chat_${chatId}`).emit("typing", payload)` only when `socket.rooms.has(`chat_${chatId}`)`.

- [ ] **Step 4: Wire in `src/app.ts`:** import it and call `registerTypingSocket(socket)` right after `registerPresenceSocket(socket)`.

- [ ] **Step 5: Run `npm test`** (all files). Expected: PASS. `npx tsc --noEmit`: no errors.

- [ ] **Step 6: Manual check.** Add a "Typing" button to `test.html` that emits `typing` with the existing Chat ID, Sender ID and Sender Type inputs (`isTyping: true`, plus a second button for `false`). With two tabs connected to the server, both having clicked Join Chat for the same chat ID: tab A emits typing, tab B logs the `typing` event (the existing `socket.onAny` prints it) and tab A does not log its own event. A tab that never clicked Join Chat sends typing and nobody receives it.

- [ ] **Step 7: Commit** (if git exists): `feat: typing indicator relay`.
