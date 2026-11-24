# Live Chat Update: Mobile App (user side)

What the mobile app has to build for the new Customer Support (CS) ticket flow, the chat list, and the file upload limit.

- **Audience:** the Flutter team that builds the user-facing Live Chat.
- **Backend:** image `maxco-chat-cs:1.1.1` (PR #2 tickets and auto-close, PR #3 upload limit, category filter and all-CS access, PR #12 UTC times).
- **Exhaustive contract:** `docs/integration-guide-app.md`, sections 9, "File uploads", "Chat list filter", "Inside Sales chat" and "Times". Connection, presence and typing events are unchanged and are covered in sections 1–8 of that guide; section 4 now shows typing from several CS.

## 1. What changes for the user

- **Chats with Customer Support are one continuous conversation.** On the server, each CS chat is a ticket with a number (`chat_ticket`), and a ticket can be closed. The user never sees a list of tickets. The user sees one conversation, with "Ticket #… is closed" and "New ticket #… opened" lines inside it.
- **Auto-close.** When CS has replied and the user stays silent for 10 minutes, the server closes the ticket and sends an **Automated message**. It is on by default once the backend runs migration 10 (see section 8).
- **Several CS can answer one ticket.** Show the name of each CS reply from its own `sender_name`, not from the chat's PIC (`chat_data.admin_name`). Keep the typing indicator per CS: "Andi is typing…", "Andi and Budi are typing…" (`docs/integration-guide-app.md` section 4).
- **The user can always write.** After a ticket is closed the input stays enabled. The next message opens a new ticket automatically; the app does not call anything extra.
- **Files** are limited to 50 MB and to images, videos, PDF and Word (docx). The app checks this before sending and shows a clear message.
- **Times are UTC.** Times keep their format (`2026-11-19 06:33:39`), but the value is now UTC whatever the database server's zone. The app converts it to the device time zone before showing it (section 6). This fixes times that showed hours off.

```
┌ Live Chat ───────────────────────────────┐
│ Maxco Customer Support        ● Online   │
├──────────────────────────────────────────┤
│        ── New ticket #1234-… opened ──     │
│ CS:   Could you send us the receipt?     │
│ ⏱ AUTOMATED MESSAGE                      │
│   Hi Priya, since we haven't received…   │
│        ── 🔒 Ticket #1234-… is closed ──   │
│     Send a message to open a new ticket. │
│        ── New ticket #5678-… opened ──     │
│ You:  My deposit has arrived, now…       │
│ CS:   Good morning, I'd be glad to help  │
├──────────────────────────────────────────┤
│ [+] Write a message…               [ ↑ ] │
└──────────────────────────────────────────┘
```

## 2. Chat list screen

Load the user's chats:

```
GET /api/chats/user/:userId?page=1&pageSize=50[&categoryIds=1|2|3]
Header: X-API-Key
→ { success, data: [ chat rows ], pagination: { total, page, pageSize, hasMore } }
```

| `category_id` | Name | Show as |
|---|---|---|
| 1 | Customer Support | **One row** for all CS tickets. Status and last message come from the newest ticket. Opening it shows the continuous conversation (section 3). |
| 2 | Promotion | One row per chat, as today. |
| 3 | Inside Sales | One row per chat, as today. With `source: "app"` (`POST /api/chats/user` only, section 2.1) only the active one. A closed one refuses messages (section 2.1). |

- `categoryIds` is optional. With no value you get every category. `categoryIds=1` returns only the CS tickets, and `pagination.total` counts only those.
- Each row has `id`, `chat_ticket`, `category_id`, `status` (`pending` / `active` / `closed`), `created_at`, `closed_at`, `last_message`, `last_message_time`, `last_message_content_type`, `last_message_sender_id`.
- Unread badge: `GET /api/client/chat/unread/:userId` returns `{ total, chats: [{ chatId, unread }] }`. For the single CS row, add up the unread counts of all CS tickets. Automated messages count as unread.

### 2.1 Inside Sales chat

The Inside Sales chat of a user can change sales person: the CRM closes the old chat and opens a new one for the new sales person. To show only the current one, load the list with `POST /api/chats/user` and `"source": "app"`:

```
POST /api/chats/user
{ userId, userName, userReferrerId, userReferrerName, source: "app", page, pageSize, categoryIds? }
→ { success, data: [ chat rows ], pagination, salesMismatch? }
```

- With `source: "app"`, closed Inside Sales chats are not in `data` or in `pagination.total`. Without `source` nothing changes: every chat is listed.
- `userReferrerId` / `userReferrerName` are the sales person the app knows. The server creates the Inside Sales chat when there is no active one (or when the active one has no sales person), and never moves the user to another sales person.
- **`salesMismatch`** `{ sent, currentReferrerId, currentReferrerName }` means the active chat belongs to a different sales person than the one the app sent: the app's copy is out of date. The list still holds the active chat. Refreshing the user's data is optional. The field is absent when there is no mismatch.
- Live: `chat_closed` with `reason: "sales_changed"` on `chat_<old id>` means the CRM moved the user. Drop that chat from the list and close its screen. The new chat arrives as `new_user_chatroom { chatData }`: show it as the Inside Sales chat and `join_chat` its room.
- **A closed Inside Sales chat refuses messages.** `send_message` to it is not stored, sends no push and opens no new chat (unlike a CS ticket, section 3). The sending socket gets `send_message_error { chat_id, reason: "chat_closed" }`, without `message`: do not add the bubble, and keep the input of a closed Inside Sales chat disabled. Closed Promotion chats are unchanged.

## 3. The Customer Support conversation

### 3.1 Loading it

```
GET /api/client/chat/support-thread/:userId?page=1&pageSize=50
→ { success,
    data: { messages: [...], tickets: [...], current: {...} | null },
    pagination: { total, page, pageSize, hasMore } }
```

- **`messages`** come from every CS ticket of the user. Page 1 holds the newest messages, and each page is ordered oldest first. Load the next page when the user scrolls up and `hasMore` is true.
- **`tickets`** has `{ chat_id, chat_ticket, status, created_at, closed_at }` for every ticket that has messages on this page.
- **`current`** is `{ chat_id, chat_ticket, status }` of the newest CS ticket, or `null` if the user never chatted with CS. In that case create the chat with `POST /api/chats` (as today).

### 3.2 Drawing it

Merge the markers and the messages into one list and sort it by these keys, in this order:

1. time (`created_at` of a message; for markers, the ticket's `created_at` or `closed_at`);
2. the older ticket first (smaller `chat_id`);
3. inside one ticket: the "opened" marker, then the messages, then the "closed" marker;
4. messages of the same ticket and time: by message `id`. Dart's `List.sort` is not stable, so this key must be explicit.

| Item | Draw as |
|---|---|
| "opened" marker (ticket `created_at`) | `New ticket #<chat_ticket> opened` |
| "closed" marker (ticket `closed_at`, when not null) | `🔒 Ticket #<chat_ticket> is closed` |
| `sender_type: "user"` | the user's bubble |
| `sender_type: "admin"` | the CS bubble (`sender_name`) |
| `sender_type: "system"` (`metadata.type = "auto_close"`) | **Automated message** bubble. Never treat it as the user's message. |
| `content_type: 2` | file bubble. URL: `<server>/<content_url>`; name in `metadata.fileName` |

Under the last item, show `Send a message to open a new ticket.` only when `current.status === "closed"`.

### 3.3 Sending and rooms

- Join `chat_<current.chat_id>` (`join_chat`) and `user_<userId>` (`join_user`) when the conversation opens.
- **Always send to `current.chat_id`**, even when that ticket is closed:

  ```
  emit send_message { chat_id, sender_id, sender_type: "user", sender_name, content_type: 1, message }
  ```

- Keep the input enabled when the ticket is closed.

### 3.4 Live events

| Event | What it means | What the app does |
|---|---|---|
| `new_message` with `previous_chat_id: null` | normal message | add the bubble |
| `new_message` with `previous_chat_id` set and `chat_data.category_id === 1` | the message was addressed to a closed ticket and stored in the user's open ticket | make `chat_id` the current ticket. If `is_new_ticket` is true, draw `New ticket #<chat_data.chat_ticket> opened` first. Then add the bubble. |
| `chat_closed { chatId, chatData, reason }` | a ticket was closed. `reason` is `"auto_no_reply"` (automated) or `"agent"` (closed by CS) | if `chatId` is the current ticket, draw the closed marker and the "Send a message…" line. **Ignore it for any other chat.** With `reason: "sales_changed"` it is an Inside Sales chat, not a ticket: see section 2.1. |
| `new_user_chatroom { chatData }` | a new room for this user, for example the new ticket opened from another device | `join_chat` that room |
| `send_message_error { chat_id, reason, message, maxBytes }` | the server refused the message (section 4) | show `message` and do not add the bubble |

- Do not switch tickets just because `chat_id` differs from the current one. The socket also receives messages of the Promotion and Sales chats, and a normal message echoes `chat_id` exactly as you sent it (string or number).
- Two quick messages to a closed ticket open only one ticket.

### 3.5 Read state

`PUT /api/chats/:chatId/read { userId }` marks one chat (ticket) as read. When the user opens the conversation, mark every CS ticket that has unread messages (see the unread endpoint), not only `current`. Otherwise an automated message on an older ticket keeps the badge on.

## 4. File uploads

Send a file with `send_message`:

```
{ content_type: 2, file_name, file_data: <base64, no "data:" prefix> }
```

- **Limit:** 50 MB (`52 428 800` bytes) of the real file.
- **Allowed types:** `jpg`, `jpeg`, `png`, `webp`, `mp4`, `mov`, `pdf`, `docx`. The server checks the extension in any letter case.
- **Check both on the device, before base64-encoding.** Above about 72 MB of payload, Socket.IO drops the connection without any error event. That used to appear as "something went wrong".
- **Convert iPhone photos (HEIC/HEIF) to JPG before sending.** HEIC/HEIF, GIF and 3GP are refused and will not be added: many CS devices (browsers, Windows, older Android) cannot display HEIC. On iOS, `image_picker` with `imageQuality` or `maxWidth` already returns a JPG.
- A refused file is not stored and opens no ticket. The sender gets `send_message_error`:

  | `reason` | `message` (show as is) |
  |---|---|
  | `file_too_large` | `File is larger than 50 MB` |
  | `file_type_not_allowed` | `File type not allowed (allowed: jpg, jpeg, png, webp, mp4, mov, pdf, docx)` |

## 5. Push notifications

- CS replies and the automated close message arrive as FCM push with `data: { type: "chat", chat_id }`.
- The push title of a CS reply or the automated close message is "Customer Support". Promotion and Sales pushes show the agent's name.
- For a CS ticket, open the CS conversation (section 3), not the single ticket.

## 6. Reference

| Direction | Name | Payload |
|---|---|---|
| REST | `GET /api/chats/user/:userId` | `?page&pageSize&categoryIds` → chat rows + `pagination` |
| REST | `GET /api/client/chat/support-thread/:userId` | `?page&pageSize` → `{ messages, tickets, current }` + `pagination` |
| REST | `GET /api/client/chat/unread/:userId` | `{ total, chats: [{ chatId, unread }] }` |
| REST | `PUT /api/chats/:chatId/read` | `{ userId }` |
| REST | `POST /api/chats` | `{ userId, userName }` → new or open CS chat |
| REST | `POST /api/chats/user` | `{ userId, userName, userReferrerId, userReferrerName, source: "app", page, pageSize }` → chat rows + `pagination` + `salesMismatch?` (section 2.1) |
| to server | `send_message` | `{ chat_id, sender_id, sender_type: "user", sender_name, content_type, message \| file_name + file_data }` |
| to server | `join_chat` / `join_user` | `{ chatId, userId }` / `{ userId }` |
| from server | `new_message` | message fields + `chat_data`, `previous_chat_id`, `is_new_ticket` |
| from server | `chat_closed` | `{ chatId, chatData, reason: "auto_no_reply" \| "agent" \| "sales_changed" }` |
| from server | `new_user_chatroom` | `{ chatData }` |
| from server | `send_message_error` | `{ chat_id, reason, message?, maxBytes? }` |

All REST calls send the `X-API-Key` header, and the socket connects with `auth: { api_key }`.

**Times:** every `*_at` / `*_time` field is UTC as `YYYY-MM-DD HH:mm:ss`, without a zone. `new_message.created_at` is ISO UTC with `Z`. Read both with `DateTime.parse(v.endsWith('Z') ? v : '${v}Z').toLocal()`, never show the raw text, and parse times before comparing or sorting them.

## 7. Try it with test.html

Open `test.html` (repo root) against the backend. The **App** panel plays this app and the **CRM** panel plays CS.

1. Click **Connect keduanya** and **Buat chat**, then join the room on both sides.
2. CRM sends a message, then clicks **Tutup chat (REST)**. On the App side you see "🔒 Ticket #… is closed (ditutup CS)" and the "Send a message…" line.
3. App sends a message. You see "New ticket #… opened", and the Chat ID moves to the new ticket.
4. App **Thread tiket**, or the "Customer Support" row in the list: the continuous conversation.
5. App list category picker: CS shows as one row, Promotion and Inside Sales as one row each.
6. **Kirim file** with a `.exe` or a file over 50 MB: refused before sending. Tick **Lewati cek file** under "Lanjutan" to see the server's `send_message_error` instead.

## 8. Release notes

- **Order:** release the app (and the CRM) before the backend runs migration 10, which turns auto-close on. The new behavior is harmless against the current backend.
- **Auto-close is on by default** (`auto_close_minutes = 10`) once the backend runs migration 10. Release the app first, or ask the backend team to set it to `0` until then; no restart is needed.
- **Times:** release the app together with the backend. Before it, times were the database server's local time in the same format, so an app that reads them as UTC shows them shifted against the old backend, and an app that shows the raw text shows UTC (7 hours behind WIB) against the new one.
- **Old app versions:** if an old version lets the user type into a closed ticket, the message goes to a new ticket with a different `chat_id`, and the old screen may not show it.
- **`source: "app"`** is opt-in. An app version that does not send it keeps listing every Inside Sales chat, closed ones included, and gets no `salesMismatch`. A message to a closed one is refused with `send_message_error` (`reason: "chat_closed"`), whatever the app version.
