# Integration Guide: Mobile App (user side)

How the mobile app shows **"Customer Support / Sales is online"** and **"CS is typing"**, and how it tells the CRM that **the user is on the Live Chat screen**. Backend contract only; nothing here changes the existing chat events.

The code samples are Dart sketches for `socket_io_client`. They were **not compiled or run**; check them against the package version you use. Test the behavior against `test.html` (the **App (user)** side) before wiring the UI.

## 1. What the app needs to do

| When | Do |
|---|---|
| App connects (and on every reconnect) | Connect with the API key. Re-send the registrations below if the user is still on the Live Chat flow. |
| User opens the Live Chat flow | `presence_subscribe` (listen to team status) and `presence_user_register` (tell CS the user is here). |
| User moves between Customer Support / Sales tabs, or opens a conversation | Nothing. Stay registered. |
| User leaves the whole Live Chat flow | `presence_user_leave` and `presence_unsubscribe`. |
| User types in a conversation | `typing` events (section 4). |

## 2. Connect

Every request and socket needs the API key when the server has `CHAT_API_KEY` set. Without it the socket fails with `connect_error` ("Invalid API key") and REST calls return `401`.

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

**Re-register on every `connect`.** The server keeps presence in memory only. After a network drop or a server restart the registration is gone, so send it again from the `onConnect` callback, not only when the screen opens.

## 3. Team status ("CS online", "Sales online")

Events: `presence_subscribe` (client to server), `presence_changed` (server to client).

```dart
void onLiveChatOpened() {
  inLiveChat = true;
  socket.emit('presence_subscribe', {});                     // both teams
  socket.emit('presence_user_register', {'userId': userId}); // see section 5
}

socket.onConnect((_) {
  if (inLiveChat) {            // reconnect: restore everything
    socket.emit('presence_subscribe', {});
    socket.emit('presence_user_register', {'userId': userId});
  }
});

socket.on('presence_changed', (data) {
  // data: { team: 'customer_support' | 'sales', online: true | false }
  teamOnline[data['team']] = data['online'] == true;
  // update the agent bar for the matching tab, and the header line
  // "Customer Support & Sales available" (for example: any team online)
});
```

- Right after `presence_subscribe`, the server sends **one `presence_changed` per team with the current status**, to this socket only. You do not need to call REST first, and you do not need any ordering between subscribe and REST.
- Optional fallback: `GET /api/client/presence` returns `{ "success": true, "data": { "customer_support": false, "sales": true } }` (send the `X-API-Key` header). Use it only if you need a value before the socket is connected.
- Status is **per team**: Customer Support and Sales can differ. A team is online while at least one person of that team is in the CRM live chat menu. You cannot tell how many people, or who.
- `presence_changed` is only sent when the status **changes**, so keep the last value in app state and render from it.
- Before the first event arrives, show a neutral state, not "Offline". The design only defines the "Online" look; the offline wording is a UI decision.
- To stop listening, send `presence_unsubscribe` (same payload shape as subscribe: `{}` for both teams or `{ "teams": ["sales"] }`).

## 4. Typing indicator

Events: `typing` in both directions. The socket must have joined the chat room first.

```dart
socket.emit('join_chat', {'chatId': chatId, 'userId': userId}); // existing event, required first
```

Send while the user types (debounce, never one event per keystroke):

```dart
// on text change
if (now - lastTypingSent > 3000) {            // first keystroke, then at most every ~3 s
  socket.emit('typing', {
    'chatId': chatId,
    'isTyping': true,
    'senderId': userId,                       // string
    'senderType': 'user',
    'senderName': userName,                   // optional
  });
  lastTypingSent = now;
}
idleTimer?.cancel();
idleTimer = Timer(Duration(seconds: 2), sendTypingStop);  // isTyping: false after 2 s idle

// also call sendTypingStop() right after the message is sent
```

Receive the agent's typing:

```dart
socket.on('typing', (data) {
  // data: { chatId, isTyping, senderId, senderType, senderName|null }
  if (data['senderType'] != 'admin') return;
  showTyping(data['isTyping'] == true, name: data['senderName']);
  hideTimer?.cancel();
  if (data['isTyping'] == true) {
    hideTimer = Timer(Duration(seconds: 5), () => showTyping(false));
  }
});
```

- The server does **not** keep typing state and has no timer. **You** must hide the indicator when `isTyping` is `false`, when a message from the agent arrives, or after **5 seconds without a new `isTyping: true`**. Otherwise a dropped socket leaves "typing" on screen forever.
- You never receive your own `typing` event back.
- If the socket has not joined that chat's room, the event is silently ignored.

## 5. Telling the CRM the user is online

Events: `presence_user_register`, `presence_user_leave`.

```dart
socket.emit('presence_user_register', {'userId': userId});  // userId must be a String
socket.emit('presence_user_leave', {});                     // when leaving the whole flow
```

- "On the Live Chat screen" means **the whole Live Chat flow**: the tab list and the conversations inside it. Register once on entering and leave once on exiting. **Do not** leave on a tab switch or when opening a conversation, otherwise the CS sees the user go offline while the user is chatting.
- The user stays online while at least one of their sockets is registered (two devices work). `presence_user_leave` releases that socket immediately.
- If the connection just drops (no `presence_user_leave`), the server keeps the user online for a grace period (default 10 seconds) and then marks them offline. A hard network loss can take up to about a minute to be noticed.
- If the app goes to the background and the OS closes the socket, the user will appear offline. That is expected ("online" means "app open on this screen").

## 6. Rules and pitfalls

- `userId`, `senderId` and `adminId` must be **strings**. A number is ignored without any error. `chatId` may be a string or a number.
- A malformed payload is ignored silently, so a typo shows up as "nothing happens". Compare with the log in `test.html`.
- The API key is shared and unverified identity is accepted (anyone with the key can claim any `userId`). Do not treat presence as proof of identity.
- Do not poll REST for status. Subscribe once and keep state.

## 7. Event reference (app side)

| Direction | Event | Payload |
|---|---|---|
| to server | `presence_subscribe` | `{}` or `{ teams?: ("customer_support"\|"sales")[] }` |
| to server | `presence_unsubscribe` | same as subscribe |
| to server | `presence_user_register` | `{ userId: string }` |
| to server | `presence_user_leave` | `{}` |
| to server | `join_chat` (existing) | `{ chatId, userId }` |
| to server | `typing` | `{ chatId, isTyping: boolean, senderId: string, senderType: "user", senderName?: string }` |
| from server | `presence_changed` | `{ team, online }` |
| from server | `typing` | `{ chatId: string, isTyping, senderId, senderType, senderName: string\|null }` |
| REST | `GET /api/client/presence` | `{ success, data: { customer_support, sales } }` |

## 8. Test checklist

Use `test.html`: the page plays the CRM side for you.

1. Open the Live Chat flow: the agent bar shows a neutral state, then the real status within a moment.
2. In `test.html` CRM side, tick **Saya sedang di menu live chat**: the app shows Online. Untick: Offline.
3. Untick only **Sales**: the Sales tab goes Offline while Customer Support stays Online.
4. Kill the CRM connection (**Putuskan**): the app stays Online for about the grace period, then goes Offline.
5. Switch tabs and open a conversation: the CRM page still shows the user Online.
6. Type in the app: the CRM header shows "... sedang mengetik…". Stop for 2 seconds, or send: it disappears.
7. Type in the CRM page: the app shows the indicator, and it disappears after the CRM stops (or after 5 seconds).
8. Turn Wi-Fi off and on during the Live Chat flow: after reconnect, the status and the user's online state are restored without reopening the screen.

## 9. Tickets (Customer Support)

Each Customer Support chat is one **ticket** (`chat_ticket`, for example `1234-5678-9012`). This section applies to Customer Support chats (`category_id = 1`) only; Promotion and Sales chats are unchanged.

### 9.1 Automated close

The server closes a Customer Support chat by itself when it is waiting on the user:

- the latest message in the chat is from CS (`sender_type: 'admin'`),
- nothing was written for `auto_close_minutes` (10 in the design),
- and that CS message is at most `auto_close_minutes + 60` minutes old. Older chats are left for CS to close by hand.

When it closes a chat, the server:

1. stores an automated message and sends it as a normal `new_message` to `chat_<id>`:
   ```json
   { "sender_type": "system", "sender_id": "system", "sender_name": "Maxco Customer Support",
     "content_type": 1, "message": "Hi Priya, since we haven't received a reply ...",
     "metadata": { "type": "auto_close" }, "chat_id": 10, "...": "same fields as any new_message" }
   ```
2. sends `chat_closed` `{ chatId, chatData, reason: "auto_no_reply" }` to `chat_<id>`,
3. sends a push notification with the same text.

Render `sender_type: 'system'` as the **Automated message** bubble (`metadata.type === 'auto_close'`). Never treat it as a message from the user. A `system` message also appears in chat history and as `last_message` of a chat.

`chat_closed.reason` is `"auto_no_reply"` (automated close) or `"agent"` (closed by CS). Both mean the ticket is closed: show "Ticket #… is closed" and keep the input enabled (section 9.2).

The feature ships switched off (`auto_close_minutes = 0`). It is switched on after this app version is released.

### 9.2 New ticket

The server opens the new ticket. The app does not call anything extra:

1. Always send the user's message with `send_message` to the **current** Customer Support chat id, even when that ticket is closed. Keep the input enabled after `chat_closed`.
2. When the addressed ticket is closed, the server stores the message in the user's open ticket (it creates one, with a new ticket number, when there is none), moves this socket into that ticket's room, and sends:
   - `new_message` to `chat_<new id>` and `user_<userId>` (each socket receives it once), with:
     - `chat_id`: the new ticket's chat id,
     - `previous_chat_id`: the closed chat the message was addressed to,
     - `is_new_ticket`: `true` when the ticket was just created,
     - `chat_data`: the new ticket's row (`chat_ticket`, `status: "pending"`, ...);
   - `new_user_chatroom` `{ chatData }` to `user_<userId>`, so the user's other devices can `join_chat` the new room.
3. On a `new_message` whose `previous_chat_id` is not `null` **and** whose `chat_data.category_id` is `1`, make `chat_id` the current Customer Support chat. Draw "New ticket #<chat_ticket> opened" before the message only when `is_new_ticket` is `true` (otherwise the message went to a ticket that was already open). Do not switch on a mere `chat_id` difference: the socket also receives messages of the Promotion and Sales chats, and a normal message echoes `chat_id` as it was sent (string or number).
4. Ignore a `chat_closed` whose `chatId` is not the current Customer Support chat (for example a late close of an older ticket).

Two quick messages to a closed ticket open one ticket, not two. For `new_message` of a normal message, `previous_chat_id` is `null` and `is_new_ticket` is `false`.

Promotion and Sales chats keep today's behavior.

### 9.3 Support thread

`GET /api/client/chat/support-thread/:userId?page=1&pageSize=50` (header `X-API-Key`) returns every Customer Support ticket of the user as one thread:

```json
{
  "success": true,
  "data": {
    "messages": [ { "id": 1, "chat_id": 10, "sender_type": "user", "message": "...", "created_at": "2026-11-17 09:24:00", "...": "list_messages columns" } ],
    "tickets":  [ { "chat_id": 10, "chat_ticket": "1234-5678-9012", "status": "closed", "created_at": "2026-11-17 09:21:00", "closed_at": "2026-11-17 09:35:00" } ],
    "current":  { "chat_id": 11, "chat_ticket": "2345-6789-0123", "status": "pending" }
  },
  "pagination": { "total": 120, "page": 1, "pageSize": 50, "hasMore": true }
}
```

- **Paging** works like `GET /api/chats/:chatId/messages`: page 1 is the newest messages, the next pages go back in time, and each page is ordered oldest-first. Load the next page when the user scrolls up while `hasMore` is `true`.
- **`tickets`** lists the tickets whose messages are on this page. Place the markers by time, not by first or last message:
  - "New ticket #`chat_ticket` opened" at `created_at`,
  - "Ticket #`chat_ticket` is closed" at `closed_at` (when not null).

  Times have one-second precision, so break ties this way: the "opened" marker goes **before** messages with the same time, the "closed" marker goes **after** them. The automated message is stored with exactly the ticket's `closed_at`, so it always shows just above "Ticket … is closed".

  Older data can hold messages written to a ticket after it was closed. They show after its closed marker.
- **`current`** is the user's latest Customer Support chat.
  - Show "Send a message to open a new ticket." only when `current.status === "closed"`.
  - Send with `send_message` to `current.chat_id`, even when it is closed (section 9.2).
  - When `current` is `null`, the user has never chatted with CS: create the chat with `POST /api/chats` as today.
- **Rooms:** join `chat_<current.chat_id>` (`join_chat`) and `user_<userId>` (`join_user`).
- **Unread:** `GET /api/client/chat/unread/:userId` now also counts automated (`system`) messages.

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

## Chat list filter

`GET /api/chats/user/:userId` and `POST /api/chats/user` return every chat of the user. That covers all categories, including each closed Customer Support ticket. Both accept an optional category filter:

| Endpoint | How to send it |
|---|---|
| `GET /api/chats/user/:userId` | query `?categoryIds=1` or `?categoryIds=1,2` |
| `POST /api/chats/user` | body `"categoryIds": "1,2"` or `"categoryIds": [1, 2]` |

- `1` = Customer Support (tickets), `2` = Promotion, `3` = Inside Sales.
- No value, an empty value or an invalid value means every category, the same as before.
- `pagination.total` counts only the filtered chats. Paging (`page`, `pageSize`) works as before.
- Example: the user's ticket history is `GET /api/chats/user/<userId>?categoryIds=1&page=1&pageSize=20`. Each row is one ticket (`chat_ticket`, `status`, `created_at`, `closed_at`, last message).
