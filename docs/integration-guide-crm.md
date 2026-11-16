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
    'senderName': adminName,                  // optional, shown to the user
  });
  lastTypingSent = now;
}
idleTimer?.cancel();
idleTimer = Timer(Duration(seconds: 2), sendTypingStop);   // isTyping: false after 2 s idle
// also call sendTypingStop() right after the message is sent
```

Receive the user's typing:

```dart
socket.on('typing', (data) {
  // data: { chatId, isTyping, senderId, senderType, senderName|null }
  if (data['senderType'] != 'user') return;
  showTyping(chatId: data['chatId'], typing: data['isTyping'] == true);
  hideTimer?.cancel();
  if (data['isTyping'] == true) {
    hideTimer = Timer(Duration(seconds: 5), () => showTyping(chatId: data['chatId'], typing: false));
  }
});
```

- The server keeps no typing state and has no timer. **You** must hide the indicator on `isTyping: false`, when a message from the user arrives, or after **5 seconds without a new `isTyping: true`**.
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
