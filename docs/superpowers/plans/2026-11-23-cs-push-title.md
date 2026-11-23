# Push title "Customer Support" for CS replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pushes for agent replies in Customer Support chats are titled "Customer Support"; Promotion and Sales pushes keep the agent's name.

**Architecture:** A pure function in a new module decides the push title from the chat's `category_id` and the sender name. `chatSocket.ts` (agent replies) and `autoCloseService.ts` (automated close) use it or its constant. Message data, the database and the CRM are untouched.

**Tech Stack:** Node.js, TypeScript (ESM, `.js` import suffix), `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-23-cs-push-title-design.md`

## Global Constraints

- Title text, exact: `Customer Support`.
- Customer Support chat = `category_id` 1 (MySQL may return it as number or string).
- `sender_name` of stored and broadcast messages does not change; auto-close message keeps `sender_name` `"Maxco Customer Support"` (`SYSTEM_SENDER_NAME`).
- Push body unchanged.

## Review Focus

- `category_id` arrives as the string `"1"` from a MySQL row: still "Customer Support".
- `category_id` missing (`chat_data` without it, `null`, `undefined`): treated as not CS, so `senderName || "Customer Support"`.
- Sales/Promotion with a whitespace-only `sender_name` (`"  "`): title "Customer Support", not a blank title.
- Sales/Promotion with `sender_name` `null`: title "Customer Support" (current fallback kept).
- CS chat with an agent name that contains "Customer" or anything else: always the fixed title, the name never leaks.

---

### Task 1: `pushTitle` and its use in both push paths

**Files:**
- Create: `src/utils/pushTitle.ts`
- Modify: `src/sockets/chatSocket.ts:45` (title of the agent-reply push)
- Modify: `src/services/autoCloseService.ts:166` (title of the auto-close push)
- Modify: `docs/live-chat-update-app.md` section "5. Push notifications"
- Test: `test/push/push-title.test.ts`

**Interfaces:**
- Produces: `export const CS_PUSH_TITLE = "Customer Support"` and `export function pushTitle(categoryId: unknown, senderName: string | null | undefined): string` in `src/utils/pushTitle.ts`.

- [ ] **Step 1: Write the failing test** `test/push/push-title.test.ts`, importing from `../../src/utils/pushTitle.js`:

```ts
test("Customer Support chat always gets the fixed title", () => {
  assert.equal(CS_PUSH_TITLE, "Customer Support");
  assert.equal(pushTitle(1, "Budi"), "Customer Support");
  assert.equal(pushTitle("1", "Budi"), "Customer Support");
  assert.equal(pushTitle(1, null), "Customer Support");
});

test("Promotion and Sales keep the agent's name", () => {
  assert.equal(pushTitle(2, "Budi"), "Budi");
  assert.equal(pushTitle(3, "Sari"), "Sari");
  assert.equal(pushTitle("3", "Sari"), "Sari");
});

test("empty or missing name falls back to Customer Support", () => {
  assert.equal(pushTitle(3, null), "Customer Support");
  assert.equal(pushTitle(3, undefined), "Customer Support");
  assert.equal(pushTitle(3, ""), "Customer Support");
  assert.equal(pushTitle(3, "   "), "Customer Support");
});

test("unknown category is treated as not Customer Support", () => {
  assert.equal(pushTitle(undefined, "Budi"), "Budi");
  assert.equal(pushTitle(null, "Budi"), "Budi");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test test/push/push-title.test.ts`
Expected: FAIL, cannot find module `src/utils/pushTitle.js`.

- [ ] **Step 3: Implement `pushTitle` in `src/utils/pushTitle.ts`**

`Number(categoryId) === 1` → `CS_PUSH_TITLE`; otherwise the trimmed `senderName` if non-empty (return the original name, not a trimmed copy, only the emptiness test trims), else `CS_PUSH_TITLE`. Short doc comment: CS replies hide the agent's name in the push; Promotion/Sales show it.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import tsx --test test/push/push-title.test.ts`
Expected: 4 pass, 0 fail.

- [ ] **Step 5: Use it in both push paths**

- `chatSocket.ts`: `title: pushTitle(newMessagePayload.chat_data?.category_id, newMessagePayload.sender_name)`. `sender_name` is typed `unknown` there (index signature of `SentMessage` / service return); pass it as `string | null` with a cast only if `tsc` asks.
- `autoCloseService.ts`: `title: CS_PUSH_TITLE` instead of `SYSTEM_SENDER_NAME`. Keep `SYSTEM_SENDER_NAME` for the stored message.
- `docs/live-chat-update-app.md` section 5, add one bullet: `- The push title of a CS reply or the automated close message is "Customer Support". Promotion and Sales pushes show the agent's name.`

- [ ] **Step 6: Run the full suite and the type check**

Run: `npm test` then `npx tsc --noEmit -p .`
Expected: all tests pass (previous 74 + 4 new), `tsc` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/utils/pushTitle.ts src/sockets/chatSocket.ts src/services/autoCloseService.ts docs/live-chat-update-app.md test/push/push-title.test.ts
git commit -m "feat(push): title CS pushes Customer Support, keep agent name for sales and promotion"
```
