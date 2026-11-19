# Integration Guide: CRM (CS / Sales side)

How the CRM makes **"Customer Support / Sales is online"** appear in the mobile app, how it shows **whether a user is online**, and how typing works. Backend contract only; nothing here changes the existing chat events.

The code samples are Dart sketches for `socket_io_client` (the existing CRM code references `lib/services/live_chat_service.dart`). They were **not compiled or run**; check them against the package version you use. Test the behavior against `test.html` (the **CRM (CS)** side) first.

## 1. What the CRM needs to do

| When | Do |
|---|---|
| CRM connects (and on every reconnect) | Connect with the API key. If the person is still in the live chat menu, send `presence_register` again. |
| CS / Sales enters the **live chat menu** | `presence_register` with the teams that person belongs to. |
| CS / Sales leaves that menu, or logs out | `presence_leave`. |
| A chat list or conversation is on screen | Load initial user status over REST, then keep it updated from `presence_user_changed`. |
| Typing in a conversation | `typing` events (section 5). |

## 2. Connect

When the server has `CHAT_API_KEY` set, the socket needs it or fails with `connect_error` ("Invalid API key"), and REST needs the `X-API-Key` header (otherwise `401`).

```dart
final socket = io.io(
  baseUrl,
  io.OptionBuilder()
      .setTransports(['websocket'])
      .setAuth({'api_key': apiKey})
      .enableReconnection()
      .build(),
);
```

## 3. Making the team "online" for users

Events: `presence_register`, `presence_leave`.

```dart
void onLiveChatMenuOpened() {
  inMenu = true;
  socket.emit('presence_register', {
    'adminId': adminId,                       // String
    'teams': teamsForThisPerson,              // see below
  });
}

void onLiveChatMenuClosed() {
  inMenu = false;
  socket.emit('presence_leave', {});
}

socket.onConnect((_) {
  if (inMenu) onLiveChatMenuOpened();         // restore after reconnect / server restart
});
```

**Which teams to send.**
- Today every CS also counts as Sales (a project decision), so a CS sends `['customer_support', 'sales']`. The user's app then shows both tabs online and offline together.
- To make the difference real, send per role: a CS-only person `['customer_support']`, a sales person `['sales']`. The server needs no change. The valid names are exactly `customer_support` and `sales`; anything else is dropped, and if no valid team is left the registration is ignored.
- Calling `presence_register` again on the same socket **replaces** the team list (last call wins). Use this if the person switches role.

**How a team turns on and off.**
- A team is **online while at least one registered person lists it**. With 2 CS, when one leaves the menu the team stays online; it goes offline only when the last one leaves.
- `presence_leave` takes effect **immediately**. A dropped connection (closed tab, lost network) takes effect after a **grace period** (default 10 seconds, `PRESENCE_GRACE_SECONDS`), so a quick reconnect does not flicker the status. A silent network death can take up to about a minute longer to be noticed.
- One person with several tabs or devices stays online until the last one leaves.
- Presence means **"in the live chat menu"**. Do not register when the CRM is merely open on another page; users would see "Online" with nobody looking at chats.
- Always re-register in the `onConnect` callback. The server keeps presence in memory only, so a server restart or reconnect clears it. Until the CRM re-registers, users see the team offline.

Registering also puts the socket in the server room that receives `presence_user_changed` (next section). There is no separate call for that.

## 4. Showing whether a user is online

Events/endpoint: `presence_user_changed` (server to client), `GET /api/chats/crm/presence`.

**Order: register first, then load initial status.** This way no change can be missed between the two.

```dart
// 1) presence_register already sent (section 3)

// 2) initial status for the users currently on screen (max 100 ids per request)
final res = await dio.get('$baseUrl/api/chats/crm/presence',
    queryParameters: {'userIds': ids.join(',')},
    options: Options(headers: {'X-API-Key': apiKey}));
// res.data: { "success": true, "data": { "user123": true, "user456": false } }

// 3) live updates
socket.on('presence_user_changed', (data) {
  // data: { userId: String, online: bool }
  if (visibleUserIds.contains(data['userId'])) {
    userOnline[data['userId']] = data['online'] == true;
  }
});
```

- The server sends `presence_user_changed` for **every** user to every registered admin socket. The CRM must **filter to the users it displays** (as above) and ignore the rest.
- The REST call accepts a comma separated string, or a repeated `userIds` key. Blanks and duplicates are ignored. It returns `400` if the list is empty or has more than **100** ids. For a longer list, split it into chunks of 100.
- A user who never registered is returned as `false`.
- The initial REST status can be slightly stale by the time it is drawn; the live events then correct it.
- A user is online while the mobile app is on the Live Chat flow with a connected socket. A background app or a dropped connection shows as offline after the grace period (and possibly up to about a minute later for a silent network drop).

## 5. Typing indicator

Events: `typing` in both directions. The CRM socket must have joined the chat room first.

```dart
socket.emit('join_chat', {'chatId': chatId, 'userId': adminId}); // existing event, required first
```

Send while the CS types (debounce; never one event per keystroke):

```dart
if (now - lastTypingSent > 3000) {            // first keystroke, then at most every ~3 s
  socket.emit('typing', {
    'chatId': chatId,
    'isTyping': true,
    'senderId': adminId,                      // String
    'senderType': 'admin',
    'senderName': adminName,                  // shown to the user and to the other CS
  });
  lastTypingSent = now;
}
idleTimer?.cancel();
idleTimer = Timer(Duration(seconds: 2), sendTypingStop);   // isTyping: false after 2 s idle
// also call sendTypingStop() right after the message is sent
```

Receive the typing of the user **and of the other CS** in the same chat. Every CS can answer every chat, so showing a colleague's typing keeps two CS from answering the same question:

```dart
final hideTimers = <String, Timer>{};   // key: chatId|senderId

socket.on('typing', (data) {
  // data: { chatId, isTyping, senderId, senderType, senderName|null }
  final chatId = data['chatId'];
  final senderId = data['senderId'];
  final key = '$chatId|$senderId';
  void show(bool typing) => data['senderType'] == 'user'
      ? showUserTyping(chatId: chatId, typing: typing)
      : showColleagueTyping(chatId: chatId, csId: senderId, name: data['senderName'], typing: typing); // "Budi (CS) is typing…"
  hideTimers.remove(key)?.cancel();
  show(data['isTyping'] == true);
  if (data['isTyping'] == true) {
    hideTimers[key] = Timer(Duration(seconds: 5), () => show(false));
  }
});
```

- The server keeps no typing state and has no timer. **You** must hide an indicator on `isTyping: false` from that sender, when a message from that sender arrives, or after **5 seconds without a new `isTyping: true`** from that sender.
- Several CS can type in the same chat at once: keep one indicator per `senderId`.
- Always send `senderName` with the CS display name. Without it the user and the other CS receive `null`.
- You never receive your own `typing` event. If the socket has not joined that chat's room, the event is ignored silently.

## 6. Rules and pitfalls

- `adminId`, `userId`, `senderId` must be **strings**; a number is ignored. `chatId` may be a string or a number.
- Malformed payloads are ignored silently, so a typo shows up as "nothing happens". Compare with the log in `test.html`.
- Identity is not verified (anyone with the shared API key can claim any `adminId`). Do not use presence for authorization.
- The same person must not register for a team they do not work in; users would see that team online.
- If more than one backend instance is ever deployed, presence will be inconsistent until a shared store (Redis) is added. Today it is one process.

## 7. Event reference (CRM side)

| Direction | Event | Payload |
|---|---|---|
| to server | `presence_register` | `{ adminId: string, teams: ("customer_support"\|"sales")[] }` |
| to server | `presence_leave` | `{}` |
| to server | `join_chat` (existing) | `{ chatId, userId }` |
| to server | `typing` | `{ chatId, isTyping: boolean, senderId: string, senderType: "admin", senderName?: string }` |
| from server | `presence_user_changed` | `{ userId, online }` |
| from server | `typing` | `{ chatId: string, isTyping, senderId, senderType, senderName: string\|null }` |
| REST | `GET /api/chats/crm/presence?userIds=a,b,c` | `{ success, data: { "<userId>": boolean } }` (`400` if empty or over 100) |

## 8. Test checklist

Use `test.html`: the **App (user)** side plays the mobile app for you.

1. Enter the menu: the App header in `test.html` shows "Maxco Customer Support ● Online". Leave: Offline.
2. Register with only `sales` (untick Customer Support in `test.html`, or send `['sales']`): only the Sales badge is online.
3. Two CS: register two sockets (two browser tabs of `test.html`). Leave with one: the app still shows Online. Leave with the second: Offline.
4. Close a tab without leaving: the status drops after the grace period, not before.
5. Restart the backend while in the menu: after the CRM reconnects and re-registers, the app shows Online again.
6. On the App side of `test.html`, switch **Saya sedang di layar Live Chat** on and off: your chat list shows that user going Online and Offline, and the initial REST status matches.
7. Type in the App side: your conversation header shows "... sedang mengetik…" and the indicator disappears when the user stops, sends, or after 5 seconds.
8. Type in your conversation: the App side shows the indicator and clears it the same way.
9. Two CS: open the same chat as two CS (two browsers). Type in one: the other shows "<name> (CS) is typing…", and the App side shows that name.

## 9. Tickets (Customer Support)

Each Customer Support chat is one **ticket** (`chat_ticket`). This section applies to Customer Support chats (`category_id = 1`) only; Promotion and Inside Sales chats are unchanged.

### 9.1 Automated close

The server closes a Customer Support chat by itself when it waits on the user: the latest message is from CS, nothing was written for `auto_close_minutes`, and that CS message is at most `auto_close_minutes + 60` minutes old (older chats are left for CS to close by hand). It then:

1. stores an automated message and sends it as `new_message` to `chat_<id>`, with `sender_type: "system"`, `sender_id: "system"`, `sender_name: "Maxco Customer Support"`, `metadata: { "type": "auto_close" }`,
2. sends `chat_closed` `{ chatId, chatData, reason: "auto_no_reply" }` to `chat_<id>`.

- **Render `sender_type: "system"`** messages (in the conversation, in chat history and as `last_message` of a list row). If the CRM parses `sender_type` strictly (`user` / `admin` only), this must change before the backend is deployed.
- A `system` message is not a CS reply: it does not count for the Assigned / Waiting rules.
- The chat moves to the Closed list.

Settings live in `list_chat_config` and apply without a restart:

| Key | Value |
|---|---|
| `auto_close_minutes` | minutes; `0` = off. Ships as `10` (on); set `0` until the app and CRM releases if they are not out yet. |
| `auto_close_message` | text template, `{name}` = user name (or "there"), `{minutes}`. Max 255 characters. |

### 9.2 New ticket

When a user writes to a closed Customer Support ticket, the server stores the message in that user's open ticket (a new `pending` chat with a new ticket number when there is none). The CRM sees it as:

- `chat_room_created` (existing event, same payload as today) for a ticket that was just created, so it appears in the Waiting list;
- `new_message` for the new chat id, with `previous_chat_id` (the closed chat) and `is_new_ticket`. Both fields are `null` / `false` on normal messages.

### 9.3 Replies to a closed ticket

An admin `send_message` to a **closed Customer Support** chat is rejected: nothing is stored or broadcast, and only the sending socket receives:

```json
{ "event": "send_message_error", "payload": { "chat_id": 10, "reason": "chat_closed" } }
```

Disable the input of closed Customer Support chats, and show an error if `send_message_error` arrives. Closed Promotion and Inside Sales chats are unchanged.

### 9.4 Closing a chat

`chat_closed` now carries `reason`: `"agent"` when CS closes the chat, `"auto_no_reply"` for the automated close.

`POST /api/chats/crm/chat/close` now also sends `chat_closed` `{ chatId, chatData, reason: "agent" }` to `chat_<id>` (before, only the socket `close_chat` did), so the user's app learns that the ticket is closed. The REST response is unchanged. A CRM page that already updates itself from the REST response may receive this event for the same chat; treat it as idempotent.

A `send_message` with a `sender_type` other than `user` or `admin` is rejected (`system` messages are written by the server only).

## 10. Assigned list and PIC

The PIC (`admin_id` / `admin_name` of a chat) is informative only. Every CS can see, open and reply to every chat.

- `POST /api/chats/crm/chat/active` (the Assigned tab) now returns **every** chat that any CS has replied to within `max_waiting_minutes`, not only the chats of the CS who is logged in. Show the PIC from `admin_name` on each row. `last_message_admin*` is the latest reply of any CS. `adminId` is still accepted in the body but no longer filters.
- `POST /api/chats/crm/create_service_chat` no longer answers `401 "Chat already assigned to another admin"`. It returns the user's open chat to any CS.
- Replying to a chat handled by another CS stores the message as usual. Within `max_waiting_minutes` it does not change the PIC (same takeover rule as before).
- If the CRM disables the input when `admin_id` is not the logged-in CS, remove that check.

## File uploads

Files are sent as base64, through `send_message` (`content_type: 2`, `file_name`, `file_data`) or through `POST /api/chats/crm/chat/upload` (`fileName`, `fileDataBase64`).

- **Maximum 50 MB** (`52 428 800` bytes), measured on the real file, not on the base64 text.
- **Allowed types**: `jpg`, `jpeg`, `png`, `webp`, `mp4`, `mov`, `pdf`. The server checks the file name's extension, in any letter case.
- **Check size and type on the device, before encoding.** The server accepts up to about 72 MB of payload so that a 50 MB file fits as base64. Socket.IO drops the connection, with no error event, for anything bigger, and that is what used to show as "something went wrong".
- The server keeps only the name without its path, limited to letters, digits, `.`, `_` and `-`. The original name stays in `metadata.fileName`.

A refused file is not stored. The sender receives:

| Path | Response |
|---|---|
| `send_message` | `send_message_error` `{ chat_id, reason, message, maxBytes }`, to the sending socket only |
| REST upload | HTTP 400 `{ success: false, reason, message, maxBytes }` |
| REST body over ~72 MB | HTTP 413 `{ success: false, reason: "file_too_large", message, maxBytes }` |

`reason` is `file_too_large` or `file_type_not_allowed`. Show `message` to the user as is:
- "File is larger than 50 MB"
- "File type not allowed (allowed: jpg, jpeg, png, webp, mp4, mov, pdf)"

The same `send_message_error` event also carries `reason: "chat_closed"` (section 9).

## Times

Times from the database are UTC, in the format `YYYY-MM-DD HH:mm:ss` without a zone: `"2026-11-19 06:33:39"` is 13:33:39 in WIB. This covers `created_at`, `closed_at`, `last_message_time` and every other `*_at` / `*_time` field, in REST responses and in the `chat_data` of socket events. It does not depend on the database server time zone.

One exception: `new_message.created_at` of a message sent through the socket is ISO 8601 UTC with `Z` (`"2026-11-19T06:33:39.123Z"`).

- Read every time as UTC and convert it to the browser time zone before showing it. Never show the text as is. One parser covers both forms:

  ```js
  const parseServerTime = (v) => new Date(v.endsWith('Z') ? v : `${v.replace(' ', 'T')}Z`);
  ```

- Parse times before comparing or sorting them.
