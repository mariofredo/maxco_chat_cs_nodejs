# test.html Tickets, Uploads and All-CS Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `test.html` can exercise the ticket flow, upload limits, the category filter and the REST close, and the app guide's divider order rule is corrected.

**Architecture:** Changes stay inside the single-file page: CSS, markup and the inline script. No server change.

**Tech Stack:** Plain HTML/CSS/JS, Socket.IO client 4.7.2 (CDN).

**Spec:** `docs/superpowers/specs/2026-11-18-test-html-tickets-design.md`

## Global Constraints

- Upload limits and messages are identical to the server:
  - 50 MiB (`52428800`);
  - extensions `jpg, jpeg, png, webp, mp4, mov, pdf`;
  - messages `File is larger than 50 MB` and `File type not allowed (allowed: jpg, jpeg, png, webp, mp4, mov, pdf)`.
- Divider order: time, then older ticket (`chat_id`) first, then opened → messages → closed.
- Existing behavior of the page (presence, typing, hints, log filters, remembered fields) is unchanged.
- No unit tests: this is a manual dev page. Verification is a browser run against the local server (Task 2).

## Review Focus

- `chat_closed` for a ticket that is not the current Chat ID must not draw a divider (log only).
- A normal message (`previous_chat_id: null`) must never move the Chat ID.
- The file pre-check must not block a valid upload (uppercase `PHOTO.JPG`).
- A refused send must clear the 3-second "pesan belum kembali" warning.
- An empty category field must call `/api/chats/user/:id` without `categoryIds`.

---

### Task 1: test.html and the guide's divider rule

**Files:**
- Modify: `test.html`
- Modify: `docs/integration-guide-app.md` (§9.3 tie rule)

- [ ] **Step 1: Implement the spec's App, CRM and shared items in `test.html`**

Add these helpers to the page script:
- `addDivider(side, text, kind)`, where `kind` is `open`, `closed` or `hint`;
- `onChatClosed(side, d)`;
- `onSendError(side, d)`;
- `supportThread()`;
- `checkFile(file)`.

`checkFile(file)` returns `null`, or the server's message text.

Also add the field `categoryFilter` and the checkbox `skipFileCheck`. Add `categoryFilter` to `SAVED`.

- [ ] **Step 2: Fix the guide**

In §9.3, replace the "break ties" paragraph with the order from Global Constraints.

- [ ] **Step 3: Commit**

---

### Task 2: Browser verification

- [ ] **Step 1:** Start the server on this branch:
  `PORT=3999 FCM_PUSH_ENABLED=false node --import tsx --env-file=.env.local src/app.ts`
- [ ] **Step 2:** Open `test.html` in the browser. Set the server to `http://localhost:3999` and the App user to `test-awc-ui`.
- [ ] **Step 3:** Run the spec's verification list. Expected: every item behaves as described, and there are no console errors.
- [ ] **Step 4:** Delete the `test-awc-ui` rows. Stop the server.
