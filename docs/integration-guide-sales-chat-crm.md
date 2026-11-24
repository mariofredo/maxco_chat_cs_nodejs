# Integration Guide: Moving a Client to Another Sales Person (CRM)

What the CRM builds so that a client's Inside Sales chat follows the client when admin moves them from one sales person to another.

- **Audience:** the CRM team: the admin screen that moves a client, and the sales person's live chat menu.
- **Backend:** PR #20, in the first backend image after `maxco-chat-cs:1.1.2`. It needs SQL file `12_dbchanges_202611241200.sql`.
- **Full contract:** `docs/integration-guide-crm.md` section 11 (moving a client) and section 9.3 (refused messages). This guide is the part of it the CRM builds for this change.
- The code samples are Dart sketches for `socket_io_client` and `http`. They were **not compiled or run**; check them against the package versions you use.

## 1. What changes

**Before:** a client had one Inside Sales chat (`category_id = 3`), tied for good to the sales person who first had it (`user_referrer_id`). Moving the client in the CRM did not reach the chat server, so the old sales person kept chatting with the client and the new one never saw the chat.

**Now:**

- A client has at most one **active** Inside Sales chat. Older ones are **closed** and kept with their messages. Nothing is deleted.
- The CRM tells the chat server about a move with one REST call, `reassign_sales_chat`. The server closes the old chat and opens a new, empty chat for the new sales person.
- The old sales person keeps the old chat in their list, closed. The new sales person does not see the old conversation.
- A closed Inside Sales chat takes no more messages, from the sales person or from the client.
- Only this call moves a client. The app never does, and "Chat with Client" (`open_inside_sales_chat`) is unchanged.

```
Admin moves client u-42 from Sales A to Sales B (in the CRM, as today)
 └─ CRM: POST /api/chats/crm/reassign_sales_chat { user_id: "u-42", user_referrer_id: "sales-b", … }
     Server: chat 101 (Sales A) → closed, kept with its messages
             chat 205 (Sales B) → new, active, empty
     ├─ chat_closed { chatId: 101, reason: "sales_changed" }  → room chat_101       (Sales A's CRM)
     ├─ new_user_chatroom { chatData: chat 205 }               → room user_sales-b   (Sales B's CRM)
     └─ new_user_chatroom { chatData: chat 205 }               → room user_u-42      (the client's app)
```

## 2. What the CRM builds

| When | Do |
|---|---|
| Admin moves a client to another sales person, and the move is saved in the CRM | Call `reassign_sales_chat` with the client and the **new** sales person (section 3). Retry when it fails. |
| Once, right after the backend release | Call `reassign_sales_chat` for every client that has a sales person (section 6). |
| A sales person is in the live chat menu, and on every reconnect | `join_user { userId: <sales person's member id> }`, so new chats reach them. "Chat with Client" already needs this. |
| `chat_closed` arrives | Show the chat as closed and disable its input. `reason: "sales_changed"` means the client was moved (section 4). |
| `new_user_chatroom` arrives | Add the chat to the list and `join_chat` its room (section 4). |
| `send_message_error` with `reason: "chat_closed"` | Remove the pending bubble and keep the input disabled (section 5). |

## 3. The call

Call it after the move is saved in the CRM:

```
POST /api/chats/crm/reassign_sales_chat
Header: X-API-Key
{ "user_id": "u-42", "user_name": "Budi", "user_referrer_id": "sales-b", "user_referrer_name": "Sales B" }
```

| Field | Required | Meaning |
|---|---|---|
| `user_id` | yes | The client. |
| `user_name` | no, but send it | The client's name, stored on the new chat. When empty, the name on the old chat is kept. |
| `user_referrer_id` | yes | The **new** sales person's member id: the same id their CRM sends in `join_user` and in `chat/referred`. |
| `user_referrer_name` | no, but send it | The new sales person's name, stored on the new chat. The client's app shows it. |

Ids may be strings or numbers. They are trimmed and compared as text.

| Status | Body | What to do |
|---|---|---|
| `200` | `{ success: true, data: { chat, closedChatId }, message: "Inside sales chat is with the new sales person" }` | Done. `chat` is the client's active Inside Sales chat now. `closedChatId` is the id of the old chat that was closed, or `null`. |
| `400` | `{ success: false, message: "user_id and user_referrer_id are required" }` | Fix the request. Do not retry it as it is. |
| `500` | `{ success: false, message: "Internal server error" }` | Retry, then reload the lists: the change may already be saved. If it keeps failing, ask the backend team to check the server log (SQL file 12 not run gives this). |

What the server does:

| Client's Inside Sales chat before the call | Result | `closedChatId` | Events |
|---|---|---|---|
| Active, owned by another sales person | The old chat is closed and kept. A new active chat is created for the new sales person. | old chat id | `chat_closed` to the old room, `new_user_chatroom` to the new sales person and to the client |
| No active chat (never had one, or only closed ones) | A new active chat is created for the new sales person. | `null` | `new_user_chatroom` to the new sales person and to the client |
| Active, already owned by the new sales person | Nothing changes. | `null` | none |

- The new chat has a new `chat_ticket`, and `user_referrer_id` / `user_referrer_name` and `admin_id` / `admin_name` of the new sales person. It starts empty: no message is copied.
- **Safe to repeat.** A second call for the same client and sales person changes nothing and sends no event. Two calls at the same time also leave exactly one active chat.
- Until the call succeeds, the client keeps chatting with the old sales person.

```dart
/// Returns true when the chat server has the client with [salesId].
Future<bool> reassignSalesChat({
  required String clientId,
  required String clientName,
  required String salesId,
  required String salesName,
}) async {
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/api/chats/crm/reassign_sales_chat'),
        headers: {'Content-Type': 'application/json', 'X-API-Key': apiKey},
        body: jsonEncode({
          'user_id': clientId,
          'user_name': clientName,
          'user_referrer_id': salesId,
          'user_referrer_name': salesName,
        }),
      );
      if (res.statusCode == 200) return true;
      if (res.statusCode == 400) return false; // bad request: retrying will not help
    } catch (_) {
      // network error: retry
    }
    await Future.delayed(Duration(seconds: 2 * attempt));
  }
  return false; // keep the client on a "retry later" list
}
```

If it still fails after the retries, keep the move in the CRM and retry the call later, for example from a list of failed calls. The server log also lists every app request whose sales person does not match the active chat (`sales mismatch: user … sent sales …, chat … belongs to …`), which shows clients whose call never went through.

## 4. Live events

| Who | Event | Room | Payload | Do |
|---|---|---|---|---|
| Old sales person's CRM | `chat_closed` | `chat_<old id>` | `{ chatId, chatData, reason: "sales_changed" }` | Mark the chat closed, disable its input. A note such as "Client moved to another sales person" helps. |
| New sales person's CRM | `new_user_chatroom` | `user_<new sales person id>` | `{ chatData }` | Add the chat to the list and `join_chat` its room. |

- `chatData` is the full chat row (`id`, `chat_ticket`, `user_id`, `user_name`, `user_referrer_id`, `user_referrer_name`, `admin_id`, `admin_name`, `status`, `category_id`, `created_at`, `closed_at`, …).
- `chat_closed` reaches only sockets in room `chat_<old id>`. A sales person who had not joined it sees the change on the next list load: the row has `status: "closed"`.
- `chat_closed` also comes with `reason: "agent"` (closed by CS) and `"auto_no_reply"` (CS auto-close). Handle all of them the same way; only the note differs.
- `new_user_chatroom` also arrives when a chat is opened with "Chat with Client". Same handling.
- The server forgets room membership when a socket reconnects. Send `join_user` and the `join_chat` of open chats again on every `connect`.

```dart
socket.onConnect((_) {
  socket.emit('join_user', {'userId': myMemberId});
  for (final chatId in openChatIds) {
    socket.emit('join_chat', {'chatId': chatId, 'userId': myMemberId});
  }
});

socket.on('chat_closed', (data) {
  final chatId = data['chatId'].toString();
  markChatClosed(chatId, data['chatData']); // status closed, input disabled
  if (data['reason'] == 'sales_changed') {
    showNote(chatId, 'Client moved to another sales person');
  }
});

socket.on('new_user_chatroom', (data) {
  final chat = data['chatData'];
  upsertChatRow(chat); // the referred list
  socket.emit('join_chat', {'chatId': chat['id'], 'userId': myMemberId});
});
```

## 5. Closed Inside Sales chats

- The server refuses a message to a closed Inside Sales chat, whoever closed it: a move, or a sales person or CS closing it by hand. The message is not stored and no push is sent. Only the sending socket gets `send_message_error { chat_id, reason: "chat_closed" }`, without `message`.
- Disable the input of every chat with `category_id = 3` and `status: "closed"`, and do not add the bubble when the error arrives.
- **Lists:** `POST /api/chats/crm/chat/referred { userReferrerId, page, pageSize }` returns active and closed chats. After a move, the old sales person's list has the old chat as closed and the new sales person's list has the new chat. Show the status on each row.
- **After a chat was closed by hand**, "Chat with Client" opens a new active chat for the sales person who clicks it, when the client has no active one. The client's app picks it up live (`new_user_chatroom`).

## 6. One-time step after the release

Clients moved before the release still have their chat with the old sales person. Fix them once:

1. Wait until SQL file 12 and the new backend image are live.
2. For **every client that has a sales person** in the CRM, call `reassign_sales_chat` with that client and their **current** sales person.
3. Make the calls **one after another**, not in parallel.
4. Collect the clients whose call failed and run the step again for them. Running the whole step again is safe.

| Client | Effect |
|---|---|
| Chat already with the current sales person | Nothing changes, no event. |
| Moved before the release (chat still with the old sales person) | Old chat closed, new chat for the current sales person, events as in section 4. |
| No active Inside Sales chat | A new, empty chat for the current sales person. It shows in that sales person's referred list, and the sales person and the client get `new_user_chatroom`. |

```dart
final failed = <Client>[];
for (final client in clientsWithSalesPerson) { // one at a time
  final ok = await reassignSalesChat(
    clientId: client.id,
    clientName: client.name,
    salesId: client.salesPerson.id,
    salesName: client.salesPerson.name,
  );
  if (!ok) failed.add(client);
}
// Run again for `failed` until it is empty.
```

## 7. Release order

1. The backend team runs SQL file 12 (`deploy/sql/12_dbchanges_202611241200.sql`, after file 11) on every database.
2. The backend team deploys the new image. Without file 12, `reassign_sales_chat` answers `500`.
3. The CRM release with sections 2 to 5. Against the old backend, `reassign_sales_chat` does not exist (`404`), so release the CRM after the backend, or treat a `404` as "retry later". The event handling is harmless against the old backend.
4. The one-time step (section 6).
5. The app team ships `source: "app"` (their guide: `docs/integration-guide-sales-chat-app.md`).

## 8. Try it with test.html

Open `test.html` (repo root) against the backend. The **CRM** panel plays the sales person and the **App** panel plays the client.

1. Set **Referrer ID (sales)** to `sales1`. Click **Connect keduanya**, then App **Inside sales**: the log shows the client's active Inside Sales chat, owned by `sales1`.
2. Put that chat's id in **Chat ID** and join the room on both sides. Send a message from each side.
3. Set **Referrer ID** to `sales2` and click CRM **Pindah sales**. The log shows `200` with `closedChatId` = the old chat's id. Both panels show "🔒 Chat ditutup (sales diganti)", and the App log shows `new_user_chatroom` with the new chat.
4. Reply from the CRM in the old chat: "Ditolak: Chat sudah ditutup; balasan tidak terkirim."
5. CRM **Referred** with `sales2`: the new chat. With `sales1`: the old chat, `closed`.
6. Click **Pindah sales** again: `closedChatId: null`, no event.

## 9. Test checklist

- [ ] Moving a client calls `reassign_sales_chat` with the **new** sales person's id and name.
- [ ] A failed call (network error or `5xx`) is retried, and the lists are reloaded after a `5xx`.
- [ ] The old sales person sees the chat closed live, with its input disabled.
- [ ] The new sales person sees the new chat appear live, without reloading.
- [ ] After a reconnect, `join_user` and `join_chat` are sent again and new chats still arrive.
- [ ] A reply to a closed Inside Sales chat shows no bubble and the input stays disabled.
- [ ] The referred list shows closed chats as closed.
- [ ] The one-time step runs one call at a time and reports failed clients.
