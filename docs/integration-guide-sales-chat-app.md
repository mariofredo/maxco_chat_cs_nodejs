# Integration Guide: Inside Sales Chat After a Sales Person Change (App)

What the mobile app builds so that, after the CRM moves a user to another sales person, the user sees and talks only to the new sales person.

- **Audience:** the Flutter team that builds the user-facing Live Chat.
- **Backend:** image `maxco-chat-cs:1.1.3` (PR #20).
- **Full contract:** `docs/integration-guide-app.md`, sections "Inside Sales chat" and "Chat list filter". This guide is the part of it the app builds for this change.
- The code samples are Dart sketches for `socket_io_client` and `http`. They were **not compiled or run**; check them against the package versions you use.

## 1. What changes for the user

- Admin can move a user from Sales A to Sales B in the CRM. The user's Inside Sales chat (`category_id = 3`) with A is then **closed**, and a new, empty chat with B is opened.
- The user sees **only the chat with B**. The conversation with A stays on the server and in A's CRM, but the app no longer lists it.
- **The app never moves the user.** If the app's data still says Sales A, the server keeps the user with B and tells the app with `salesMismatch`.
- A closed Inside Sales chat **refuses messages**. This is unlike Customer Support, where a message after a closed ticket opens a new ticket.

```
┌ Live Chat ───────────────────────────────┐
│ Customer Support       Your deposit has… │
│ Promotion              New offer for…    │
│ Sales B                (no messages yet) │  ← the chat with Sales A is no longer listed
└──────────────────────────────────────────┘
```

## 2. What the app builds

| When | Do |
|---|---|
| Loading the chat list | `POST /api/chats/user` with `"source": "app"` (section 3). |
| The response has `salesMismatch` | Show the list as it is. Refreshing the user's profile is optional (section 4). |
| The socket connects, and on every reconnect | `join_user { userId }`, and `join_chat` for the open conversation. |
| `chat_closed` with `reason: "sales_changed"` | Drop that chat from the list and close its screen (section 5). |
| `new_user_chatroom` with `chatData.category_id == 3` | Use it as the Inside Sales chat and `join_chat` its room (section 5). |
| `send_message_error` with `reason: "chat_closed"` | Do not add the bubble. Keep the input disabled (section 6). |
| Unread badge | Nothing to change (section 7). |

## 3. Loading the list

```
POST /api/chats/user
Header: X-API-Key
{ "userId": "u-42", "userName": "Budi", "userReferrerId": "sales-a", "userReferrerName": "Sales A",
  "source": "app", "page": 1, "pageSize": 20 }

→ { "success": true, "data": [ chat rows ], "pagination": { total, page, pageSize, hasMore }, "salesMismatch"?: { … } }
```

- `userReferrerId` / `userReferrerName` are the sales person the app knows for the user, the same values as today.
- With `"source": "app"`, `data` holds only the **active** Inside Sales chat. Closed ones are left out of `data` and of `pagination.total`. Customer Support and Promotion chats are listed as before.
- `categoryIds` and paging work as before (`docs/integration-guide-app.md`, "Chat list filter").
- A missing or blank `userId` answers `400 { success: false, message: "Missing user ID" }`.
- `GET /api/chats/user/:userId` is unchanged: it lists every chat, closed Inside Sales chats included. Keep using it for the CS ticket history (`?categoryIds=1`), not for the chat list.

What the server does with the user's Inside Sales chat on this call:

| Active Inside Sales chat on the server | `userReferrerId` the app sends | Result |
|---|---|---|
| none | any | A new chat is created for that sales person (with no sales person when `userReferrerId` is empty). |
| owned by the same sales person | the same id | Nothing changes. |
| any | empty | Nothing changes. |
| has no sales person yet | a non-empty id | The chat is replaced with one for that sales person. |
| owned by another sales person | a different id | **Nothing changes.** The response adds `salesMismatch`. |

## 4. `salesMismatch`

```json
"salesMismatch": { "sent": "sales-a", "currentReferrerId": "sales-b", "currentReferrerName": "Sales B" }
```

- It appears when the active Inside Sales chat belongs to a different sales person than the `userReferrerId` the app sent. It means the app's copy of the user's sales person is out of date.
- The list already holds the right chat, B's. Show it as it is, and do not block the user.
- Optional: refresh the user's profile so the next call sends B.
- The field is **absent** when there is no mismatch, never `null`.
- The server logs every mismatch, so the backend and CRM teams can find users whose move did not reach the chat server.

## 5. Live events

When the CRM moves the user while the app is open:

| Event | Room | Payload | Do |
|---|---|---|---|
| `chat_closed` | `chat_<old id>` | `{ chatId, chatData, reason: "sales_changed" }` | Drop the old chat from the list. If its screen is open, close it, or show it read-only with a note such as "Your sales person has changed". |
| `new_user_chatroom` | `user_<userId>` | `{ chatData }` | When `chatData.category_id` is `3`: use it as the Inside Sales chat (it replaces the old row) and `join_chat` its room. |

- `new_user_chatroom` also arrives for new Customer Support and Promotion chats. Check `category_id` before replacing the Inside Sales row.
- `chat_closed` reaches only sockets in room `chat_<old id>`. An app that was not in that room sees the change on the next list load.
- The server forgets room membership when a socket reconnects. Send `join_user` and `join_chat` again on every `connect`.
- When the app was closed during the move, nothing more is needed: the next list load returns only the new chat.

```dart
socket.onConnect((_) {
  socket.emit('join_user', {'userId': userId});
  if (openChatId != null) {
    socket.emit('join_chat', {'chatId': openChatId, 'userId': userId});
  }
});

socket.on('chat_closed', (data) {
  final chat = data['chatData'];
  if (data['reason'] == 'sales_changed' && chat?['category_id'] == 3) {
    removeChatRow(data['chatId'].toString());
    closeScreenIfOpen(data['chatId'].toString(), note: 'Your sales person has changed');
  }
});

socket.on('new_user_chatroom', (data) {
  final chat = data['chatData'];
  if (chat['category_id'] == 3) {
    replaceInsideSalesRow(chat);
    socket.emit('join_chat', {'chatId': chat['id'], 'userId': userId});
  } else {
    upsertChatRow(chat); // CS or Promotion, as today
  }
});
```

## 6. Sending to a closed Inside Sales chat

- The server refuses a message to a closed Inside Sales chat. It is not stored, no push is sent, and no new chat is opened.
- Only the sending socket gets `send_message_error { chat_id, reason: "chat_closed" }`, without `message`. Do not add the bubble.
- Keep the input of a closed Inside Sales chat disabled, and send only to the active one.
- Customer Support is different: a message after a closed ticket opens a new ticket. Closed Promotion chats are unchanged.

## 7. Unread badge

`GET /api/client/chat/unread/:userId` leaves closed Inside Sales chats out of `total` and out of `chats`. After a move, unread messages in the old chat no longer count, and the badge clears. Nothing to change in the app.

## 8. Release notes

- Release the app after the backend release with PR #20. Against an older backend, `source` is ignored and the list behaves as before.
- **Old app versions** (no `source`) keep listing every Inside Sales chat, closed ones included, and never get `salesMismatch`. A message to a closed one is refused whatever the app version, so the user of an old version can see the old chat but not write in it.
- After the backend release, the CRM team moves every client once to their current sales person. Users whose sales person changed before the release then get the new chat live (`new_user_chatroom`) or on the next list load.

## 9. Try it with test.html

Open `test.html` (repo root) against the backend. The **App** panel plays this app and the **CRM** panel plays the sales person.

1. Open **Lanjutan** (under the server fields) and set **Referrer ID (sales)** to `sales1`. Click **Connect keduanya**, then App **Inside sales**: the list holds one Inside Sales chat, owned by `sales1`, and no `salesMismatch`.
2. Put that chat's id in **Chat ID** and click **Masuk room (keduanya)**. Send a message from the App.
3. Set **Referrer ID** to `sales2` and click CRM **Pindah sales**. The App shows "🔒 Chat ditutup (sales diganti)", and its log shows `new_user_chatroom` with the new chat.
4. Send from the App in the old chat: "Ditolak: Chat sudah ditutup; balasan tidak terkirim."
5. Set **Referrer ID** back to `sales1` and click App **Inside sales**: the list holds only the new chat of `sales2`, plus `salesMismatch { sent: "sales1", currentReferrerId: "sales2", … }`. Nothing changed on the server.
6. **Belum dibaca**: the old chat is not in `chats`, and its messages are not in `total`.

## 10. Test checklist

- [ ] The chat list call sends `"source": "app"`.
- [ ] Only one Inside Sales chat is shown, the active one.
- [ ] `salesMismatch` does not block or break the list.
- [ ] While the chat list is open, a move in the CRM replaces the Inside Sales row live.
- [ ] While the old Inside Sales chat is open, a move in the CRM closes it or makes it read-only.
- [ ] A new CS or Promotion chat from `new_user_chatroom` does not replace the Inside Sales row.
- [ ] After a reconnect, `join_user` is sent again and live updates still arrive.
- [ ] A message to a closed Inside Sales chat shows no bubble.
- [ ] The unread badge clears after a move.
