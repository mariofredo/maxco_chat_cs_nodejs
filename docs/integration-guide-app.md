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
