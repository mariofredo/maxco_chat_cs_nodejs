# Sales chat follows the client's new sales person — design (short)

Repo `maxco_chat_cs_nodejs` · 24 Nov 2026

## Intent

Admin can move a client from sales A to sales B in the CRM (the same CRM that uses the live chat). The chat server never hears about it: the inside sales chat (category 3) keeps `user_referrer_id = A`, so A keeps chatting with the client and B never sees the chat in their list. After a move the client should talk only to B. The old conversation must **not** be deleted.

## Today

- One sales chat per user, closed ones included: generated column `sales_chat_key` = `user_id` when `category_id = 3`, unique index `uq_list_chats_sales_chat` (`sql/dbchanges_202611161515.sql`).
- `user_referrer_id` is written once, at insert, and never updated.
- `POST /api/chats/user` (`getUserSalesChat`) receives `userId, userName, userReferrerId, userReferrerName`. `ensureUserSalesChat` → `createSalesChatIfMissing` returns as soon as any category 3 chat exists, without comparing the sales person. Then `fetchUserChats` returns every chat of the user, every status.
- CRM sales list (`POST /api/chats/crm/chat/referred`, `fetchReferredChats`) filters on `user_referrer_id`, every status.
- CRM "Chat with Client" (`POST /api/chats/crm/open_inside_sales_chat`): B's insert hits the unique index and the fallback returns A's chat.
- It is not known for sure which clients call `POST /api/chats/user`; a comment in `clientChatService.ts` says the CRM also uses the `fetchUserChats` endpoint.
- A message to a closed sales chat is stored like any other; only CS chats are routed or refused when closed (`routeMessage`).
- Every REST route is protected by the same static `X-API-Key` (`requireApiKey`); there is no per-role check.

## Goals

- A user can have many sales chats over time, at most one **active**.
- When admin moves a client in the CRM, the CRM tells the chat server: A's chat is closed and a new active chat for B is created, right away.
- The app sees only the active sales chat.
- The app never moves a client. If it sends a sales person different from the active chat's, it gets an error.
- A keeps the old chat, closed, in their CRM list. Nothing is deleted.

## Non-goals

- Changing CRM "Chat with Client": it keeps today's behavior.
- B seeing A's conversation.
- Any change to CS (1) and Promotion (2) chats.
- Finding clients that were moved before this release; admin runs the reassign for them.

## Approaches

What happens to the old conversation:

1. Delete A's chat and start over. Rejected: loses chat data.
2. Hand the same chat over to B (B sees A's history, A loses it). Not picked.
3. **Close A's chat, create a new one for B; only the active one counts.** Picked by the user.

What the user sees in the app after the move:

1. **Only B's chat.** The old chat is hidden from the app, kept in the database and in A's CRM list. Picked by the user.
2. One sales conversation with a divider, like the CS tickets. More work on server and app.

What triggers the switch:

1. The app's list load, when it sends a different sales person. Rejected: the app may send stale data (for example cached at login) and would switch the client back to A after the CRM moved it to B.
2. CRM "Chat with Client". Rejected: the CRM sends the logged-in sales person's id, so any sales person opening a client would take it over.
3. **A new CRM endpoint, called when admin moves the client.** Picked by the user, as the only trigger. Instant, and it is the admin's own action.

What the app gets when it sends a sales person that is not the active chat's:

1. **An error, no list (409).** Picked by the user. The app must refresh the user's data and retry.
2. The list plus a warning field. Not picked: the user wants the wrong id to fail.

## Design

1. **Database** — new file in `sql/` (copied into `deploy/sql/` as `12_…`), run by hand like the others; `deploy/schema.sql` and `deploy/DATABASE.md` follow.
   - `sales_chat_key` becomes `CASE WHEN category_id = 3 AND status = 'active' THEN user_id ELSE NULL END`, still `STORED`; the unique index stays.
   - Idempotent, in the style of file 11. Existing data cannot conflict: today there is at most one sales chat per user.
2. **New CRM endpoint `POST /api/chats/crm/reassign_sales_chat`** (named like `open_inside_sales_chat`).
   - Body: `user_id`, `user_name`, `user_referrer_id` (B), `user_referrer_name` (B's name). `user_id` and `user_referrer_id` required (400 otherwise).
   - Active sales chat owned by someone else → close it (`status = 'closed'`, `closed_at = NOW()`) and create a new active chat for B, in one transaction.
   - No active sales chat → create one for B.
   - Active sales chat already owned by B → nothing changes.
   - The new chat stores B as `user_referrer_id` / `user_referrer_name` and as `admin_id` / `admin_name`, like the chat the app path creates today.
   - Response: `{ success, data: { chat, closedChatId } }`, `closedChatId` null when nothing was closed.
   - Runs under the same per-user lock as `ensureUserSalesChat`, so a reassign and an app list load for the same user never interleave. `ER_DUP_ENTRY` means another request already created B's chat.
3. **Events on a switch:** `chat_closed` to room `chat_<old id>` with `reason: "sales_changed"` (A's CRM and any open screen of the client); `new_user_chatroom` with the new chat to `user_<B>` and `user_<client>`, so B's CRM and the client's app pick it up live.
4. **`POST /api/chats/user` with `source: "app"`:**
   - no active sales chat → create one for `userReferrerId` (as today);
   - active sales chat with the same `user_referrer_id`, or an empty `userReferrerId` in the request → return the list;
   - active sales chat with an empty `user_referrer_id` (created before the client had a sales person) and a non-empty `userReferrerId` → close it and create one for `userReferrerId`, like a reassign (no sales conversation to protect);
   - active sales chat owned by a different, non-empty sales person → **409**, no list, nothing changes, logged on the server:
     ```json
     { "success": false, "code": "SALES_REFERRER_MISMATCH",
       "message": "...",
       "data": { "currentReferrerId": "B", "currentReferrerName": "B's name" } }
     ```
   - the returned list holds only `status = 'active'` sales chats; CS and Promotion chats are unchanged.
5. **`POST /api/chats/user` without `source: "app"`** (old app versions, possibly the CRM): exactly as today. No check, no filter.
6. **Message to a closed sales chat:** refused for both sides with the existing `send_message_error` (`ChatClosedError`). Otherwise A could still reach the client from the old chat, and the client would get a push with A's name for a chat they cannot see.
7. **Docs:**
   - `integration-guide-crm.md` / `live-chat-update-crm.md`: call `reassign_sales_chat` after a move; the old chat closes with `reason: "sales_changed"`; B gets `new_user_chatroom`.
   - `integration-guide-app.md` / `live-chat-update-app.md`: send `source: "app"`; closed sales chats are no longer listed; handle `409 SALES_REFERRER_MISMATCH` (refresh the user's data, retry); on `chat_closed` with `sales_changed`, drop the old chat and use the one from `new_user_chatroom`; sending to a closed sales chat is refused.
   - `panduan-menjalankan-dan-menguji.md` and `test.html`, where they cover the sales chat.
8. **Tests:**
   - reassign: closes A's chat and creates B's; no active chat → creates B's; already B → no change; missing fields → 400; events sent.
   - app path: same sales → list; empty `userReferrerId` → list; different sales → 409, nothing changed; ownerless active chat → replaced; no `source` → old behavior; list hides closed sales chats.
   - send to a closed sales chat refused (admin and user).

## Calls made (not discussed)

- Endpoint name `reassign_sales_chat`, snake_case body, to match `open_inside_sales_chat`.
- The new chat's `admin_id` / `admin_name` are B's.
- An empty `userReferrerId` from the app is never a mismatch.
- An active sales chat with no sales person is replaced when the app sends one (not a 409).
- The "active only" filter and the 409 apply only with `source: "app"`, so a CRM call to the same endpoint behaves as today.
- Messages to a closed sales chat are refused. Today they are stored; this also affects sales chats closed by hand from the CRM.
- `chat_closed` reason is `"sales_changed"`.
- After the CRM closes a sales chat by hand, the next app load creates a fresh one for the sales person the app sends.

## Known edges

- **A client whose app keeps sending the old sales person cannot load any chat (CS included) until the app sends the right one.** This covers stale app data and clients moved before this release; for the second, admin runs the reassign. The server log lists every 409.
- Old app versions (no `source`) still see closed sales chats and never get the 409.
- The endpoint is protected only by the shared `X-API-Key`, like every other CRM endpoint.
- If a client has no active sales chat, a sales person other than the owner can still create one through "Chat with Client" (today's behavior); the client's app then gets the 409 until admin runs the reassign.

## Left to the builder

- Migration file name and timestamp, how the transaction and the shared per-user lock are written, test layout, the 409 `message` text.
- Release and image version.
