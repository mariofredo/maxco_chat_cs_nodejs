# Live Chat Update: CRM (CS side)

What the CRM has to build for:
- the Customer Support (CS) ticket flow,
- open access for every CS,
- closing chats,
- the file upload limit,
- moving a client to another sales person.

**Audience:** the CRM team that builds the CS live chat menu.

**Backend:** image `maxco-chat-cs:1.1.1` (PR #2 tickets and auto-close, PR #3 all-CS access, upload limit and category filter, PR #12 UTC times).

**Exhaustive contract:** `docs/integration-guide-crm.md`, sections 9, 10, 11, "File uploads" and "Times". Connection, presence and typing events are unchanged and are covered in sections 1–8 of that guide; section 5 now shows colleague typing.

## 1. What changes for CS

- **CS works per ticket.** Every CS chat (`category_id = 1`) is a ticket with a number (`chat_ticket`). When a user writes again after a ticket is closed, the server opens a **new ticket**, which arrives in **Waiting** like any new chat. The user sees all tickets as one continuous conversation; CS keeps seeing them one by one.
- **The PIC is information only.** Every CS can see, open and reply to every chat, including chats handled by another CS. The Assigned list shows every handled chat, with its PIC.
- **Colleague typing.** CS in the same chat receive each other's `typing` (`senderType: "admin"`). Show it, for example "Budi (CS) is typing…", so two CS do not answer the same question, and always send `senderName` (`docs/integration-guide-crm.md` section 5).
- **Closed tickets take no more CS replies.** Disable the input. The server rejects a reply with `send_message_error`.
- **Auto-close.** When CS has replied and the user stays silent for 10 minutes, the server closes the ticket and stores an **automated message** (`sender_type: "system"`). It is on by default once migration 10 has run; it can be switched off (section 7).
- **Files** are limited to 50 MB, and only images, videos, PDF and Word (docx) are accepted.
- **Moving a client to another sales person** is a new REST call, `reassign_sales_chat` (section 11). Call it after every move, and once for every client with a sales person right after the release.
- **Times are UTC.** Times keep their format (`2026-11-19 06:33:39`), but the value is now UTC whatever the database server's zone. Convert it to the browser time zone before showing it (section 8). This fixes times that showed hours off.

## 2. Lists

| Tab | Endpoint | Change |
|---|---|---|
| Waiting | `GET /api/chats/crm/chat/pending?page&pageSize&categoryIds` | New tickets from returning users appear here (`chat_room_created`). |
| Assigned | `POST /api/chats/crm/chat/active { adminId, page, pageSize, categoryIds }` | Now holds the chats of **every** CS that replied within `max_waiting_minutes`, not only yours. Show the PIC from `admin_name` on each row. `adminId` is still accepted but no longer filters. |
| Closed | `GET /api/chats/crm/closed?page&pageSize&categoryIds` | Holds chats closed by CS and auto-closed tickets. |

- `last_message` of a row can now be an automated message (`last_message` text from `sender_type: "system"`). Render it like any other message preview.
- `chat_room_created { id, user_id, chat_ticket, status, created_at, user_name }` goes to every socket when a new ticket opens. Add the row to Waiting and load its messages when it is opened. The first message may arrive before your socket joins the room.

## 3. The conversation

### 3.1 Messages

| `sender_type` | Render as |
|---|---|
| `user` | user bubble |
| `admin` | CS bubble (`sender_name`; may be another CS) |
| `system` | **Automated message** (`metadata.type = "auto_close"`, `sender_name` "Maxco Customer Support"). Not a CS reply. It does not count for the Waiting / Assigned rules. |

If the CRM parses `sender_type` strictly (`user` / `admin` only), that must change **before** the backend is deployed.

### 3.2 Replying

```
emit send_message { chat_id, sender_id, sender_type: "admin", sender_name, content_type: 1, message }
```

- **Any CS may reply.** Within `max_waiting_minutes` a reply does not change the PIC (same takeover rule as before).
- `POST /api/chats/crm/create_service_chat` no longer answers `401 "Chat already assigned to another admin"`. It returns the user's open chat to any CS.
- If the CRM disables the input when `admin_id` is not the logged-in CS, remove that check.

### 3.3 Refused messages

The server answers only the sending socket with:

```
send_message_error { chat_id, reason, message?, maxBytes? }
```

The message is not stored or broadcast.

| `reason` | When | Show |
|---|---|---|
| `chat_closed` | CS reply to a **closed CS ticket**, or a message to a **closed Inside Sales chat** | "This ticket is closed" (CS) or "This chat is closed" (Inside Sales). Keep the input of closed CS tickets and closed Inside Sales chats disabled. |
| `file_too_large` | file over 50 MB | `message` |
| `file_type_not_allowed` | not jpg/jpeg/png/webp/mp4/mov/pdf/docx | `message` |

A closed Inside Sales chat (its client was moved to another sales person, section 11) refuses messages from the sales person and from the client alike, and a client message does not reopen it. Closed Promotion chats are unchanged: CS replies are still stored there.

## 4. Closing a chat

| Way | Call |
|---|---|
| REST | `POST /api/chats/crm/chat/close { chatId }` → `{ success, message, data }` |
| Socket | `close_chat { chatId }` |

- Both set `status = 'closed'` and `closed_at`, and both send `chat_closed { chatId, chatData, reason: "agent" }` to `chat_<id>`, so the user's app shows the ticket as closed. The REST path did not notify the app before.
- **Idempotent.** Closing a chat that is already closed changes nothing and sends no event. REST answers `success` with `"Chat already closed"`. Your own page may also receive the `chat_closed` event right after the REST response; handle it idempotently.
- A manual close sends no push and stores no automated message.
- After the close, a message from the user opens a new ticket in Waiting.
- The close reason and the CS who closed the chat are not stored yet.

## 5. Ticket history of a user

The CRM can show a user's earlier tickets, for example when the user comes back in a new ticket:

```
GET /api/chats/user/:userId?categoryIds=1&page=1&pageSize=20
→ { success, data: [ one row per chat/ticket ], pagination: { total, page, pageSize, hasMore } }
```

- One row per ticket. Each row has `id`, `chat_ticket`, `status`, `created_at`, `closed_at`, `admin_name` (PIC) and the last message.
- `categoryIds` is optional: `1` is CS tickets, `2` is Promotion, `3` is Inside Sales, and no value means all.
- Messages of one ticket: `POST /api/chats/crm/messages { chatId, updateRead, userId, page, pageSize }`, as today.

## 6. File uploads

- **REST upload:** `POST /api/chats/crm/chat/upload { fileName, fileDataBase64 }`.
  - Accepted: 200 `{ data: { file_url } }`. Then send it with `send_message { content_type: 2, content_url: file_url, metadata }`.
  - Refused: 400 `{ success: false, reason, message, maxBytes }`.
  - Body over about 72 MB: 413 `{ success: false, reason: "file_too_large", message, maxBytes }`.
- **Socket upload:** `send_message { content_type: 2, file_name, file_data }`. A refused file returns `send_message_error`, as in section 3.3.
- **Limit:** 50 MB of the real file. **Types:** `jpg, jpeg, png, webp, mp4, mov, pdf, docx`.
- Check both in the CRM **before** encoding: a much larger payload makes Socket.IO drop the connection silently.
- Show `message` as is:
  - "File is larger than 50 MB"
  - "File type not allowed (allowed: jpg, jpeg, png, webp, mp4, mov, pdf, docx)"

## 7. Auto-close (operations)

Settings live in `list_chat_config` and take effect within about a minute, without a restart:

| Key | Value |
|---|---|
| `auto_close_minutes` | `10` after migration 10 (on); `0` = off. Set `0` until the app and CRM releases if they are not out yet. |
| `auto_close_message` | Template text; `{name}` = user name, `{minutes}` = the setting. Max 255 characters. |

```sql
UPDATE list_chat_config SET config_value = '10' WHERE config_key = 'auto_close_minutes'; -- on
UPDATE list_chat_config SET config_value = '0'  WHERE config_key = 'auto_close_minutes'; -- off
```

A CS ticket closes automatically when all of these hold:
- the last message is from CS;
- the user has been silent for `auto_close_minutes`;
- that CS message is not older than `auto_close_minutes + 60` minutes. Older chats are left for CS to close by hand.

Chats waiting for CS never auto-close.

The closed chat moves to the Closed tab with the automated message as its last message.

## 8. Reference

| Direction | Name | Payload |
|---|---|---|
| REST | `POST /api/chats/crm/chat/active` | `{ adminId, page, pageSize, categoryIds? }` → every handled chat |
| REST | `POST /api/chats/crm/chat/close` | `{ chatId }` |
| REST | `POST /api/chats/crm/reassign_sales_chat` | `{ user_id, user_name, user_referrer_id, user_referrer_name }` → `{ success, data: { chat, closedChatId }, message }` |
| REST | `POST /api/chats/crm/create_service_chat` | `{ user_id, user_name, admin_id }` → 200/201, no more 401 |
| REST | `GET /api/chats/user/:userId` | `?page&pageSize&categoryIds` → one row per ticket |
| REST | `POST /api/chats/crm/chat/upload` | `{ fileName, fileDataBase64 }` → 200 / 400 / 413 |
| to server | `send_message` | `{ chat_id, sender_id, sender_type: "admin", sender_name, content_type, … }` |
| to server | `close_chat` | `{ chatId }` |
| from server | `new_message` | message fields + `chat_data`, `previous_chat_id`, `is_new_ticket` |
| from server | `chat_closed` | `{ chatId, chatData, reason: "agent" \| "auto_no_reply" \| "sales_changed" }` |
| from server | `new_user_chatroom` | `{ chatData }` (new sales chat, on `user_<sales person id>`) |
| from server | `chat_room_created` | `{ id, user_id, chat_ticket, status, created_at, user_name }` |
| from server | `send_message_error` | `{ chat_id, reason, message?, maxBytes? }` |

**Times:** every `*_at` / `*_time` field is UTC as `YYYY-MM-DD HH:mm:ss`, without a zone. `new_message.created_at` is ISO UTC with `Z`. Read both with `new Date(v.endsWith('Z') ? v : v.replace(' ', 'T') + 'Z')`, never show the raw text, and parse times before comparing or sorting them.

## 9. Try it with test.html

Open `test.html` (repo root) against the backend. The **CRM** panel plays CS and the **App** panel plays the user.

1. Click **Connect keduanya** and **Buat chat**, then join the room on both sides. CRM sends a message.
2. CRM **Active**: the log lists every handled chat with its PIC.
3. CRM **Tutup chat (REST)**: both panels show "🔒 Ticket #… is closed (ditutup CS)".
4. Put the old Chat ID back and reply from the CRM: "Ditolak: Tiket sudah ditutup".
5. App sends a message, which opens a new ticket. CRM **Muat riwayat tiket** (category Customer Support): one row per ticket, closed and pending, with PIC. Click a row to open that ticket.
6. CRM **Kirim file** with a `.exe`: refused with the `file_type_not_allowed` message.

## 10. Before the backend goes live

- Release a CRM version that renders `sender_type: "system"`, handles `send_message_error` and reads the times as UTC, together with the backend. Before it, times were the database server's local time in the same format.
- The backend team runs migration 10 (`sql/dbchanges_202611181400.sql`) and sets nginx `client_max_body_size 72m`.
- Migration 10 turns auto-close on (`auto_close_minutes = 10`). Run it after the app and CRM are released, or set the value to `0` right after it until then.
- Right after the release, call `reassign_sales_chat` once for every client that has a sales person (section 11).

## 11. Moving a client to another sales person

When admin moves a client to another sales person, tell the chat server right after the move:

```
POST /api/chats/crm/reassign_sales_chat
{ user_id, user_name, user_referrer_id, user_referrer_name }   // the NEW sales person
→ { success, data: { chat, closedChatId }, message }
```

- `user_id` and `user_referrer_id` are required (`400` otherwise). Send the names too: they are stored on the new chat.
- The sales chat of the old sales person is **closed** and kept, with its messages. A new active chat is created for the new sales person. `closedChatId` is the old chat's id, `null` when nothing was closed (no active chat, or the chat already belongs to the new sales person).
- **Old sales person's CRM:** `chat_closed { chatId, chatData, reason: "sales_changed" }` on `chat_<old id>`. Show the chat as closed and disable its input: the server refuses messages to it with `send_message_error` `reason: "chat_closed"` (section 3.3).
- **New sales person's CRM:** `new_user_chatroom { chatData }` on `user_<new sales person id>` (the socket joins it with `join_user`). Add the chat to the list and `join_chat` the room.
- **Safe to repeat.** Calling it again for the same client and sales person changes nothing and sends no event. If the call fails, call it again.
- **One-time step right after the release:** call it once for **every client that has a sales person**. Clients whose chat is already right are not changed; clients moved before the release are fixed.
- "Chat with Client" is unchanged. Contract: `docs/integration-guide-crm.md` section 11.
