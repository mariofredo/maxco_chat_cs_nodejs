# Push title "Customer Support" for CS replies — design (short)

Repo `maxco_chat_cs_nodejs` · 23 Nov 2026

## Intent

When a CS agent replies in a Customer Support chat, the customer's push notification shows the agent's name as its title. It should say **"Customer Support"** instead. Promotion and Sales chats keep showing the agent's name, because there the person is part of the conversation.

## Today

- `send_message` in `src/sockets/chatSocket.ts` sends an FCM push for every non-user message with `title: sender_name || "Customer Support"`, in every chat category.
- The auto-close job (`src/services/autoCloseService.ts`) sends its push with `title: SYSTEM_SENDER_NAME`, which is `"Maxco Customer Support"`.
- The message payload carries `chat_data` (`SELECT * FROM list_chats`), so `chat_data.category_id` is known when the push is built. `1` = Customer Support, `2` = Promotion, `3` = Inside Sales.

## Goals

- Push for an agent message in a Customer Support chat (`category_id = 1`): title `"Customer Support"`.
- Push in Promotion and Sales chats: unchanged, `sender_name || "Customer Support"`.

## Non-goals

- The name inside the chat. `sender_name` in `new_message`, in message history and in the database stays the agent's name; the CRM still sees who replied. The app can label CS messages itself if it wants.
- Typing `senderName` and `assigned_admin_chat` `adminName`.
- The push body.

## Approaches

1. **Customer Support chats show "Customer Support". Promotion and Sales keep the agent's name.** Picked by the user.
2. Every chat shows "Customer Support". Simplest, but a Sales chat would be labeled Customer Support.
3. A team name per category ("Customer Support", "Promotion", "Sales"). No names anywhere; not asked for.

The title is built on the server, so the change is on the server; the app does not change.

## Design

- One function decides the title, e.g. `pushTitle(categoryId, senderName)`:
  - `categoryId` 1 → `"Customer Support"`;
  - otherwise → `senderName || "Customer Support"` (current behavior).
- `chatSocket.ts` calls it with `chat_data.category_id` and `sender_name`.
- Unit test: CS with a name → "Customer Support"; Sales/Promotion with a name → the name; Sales with an empty name → "Customer Support"; category as string `"1"` (MySQL row) → "Customer Support".
- `docs/live-chat-update-app.md` section 5 (Push notifications): one line saying CS pushes are titled "Customer Support".

## Calls made (not discussed)

- **Auto-close push title** becomes `"Customer Support"` too (was `"Maxco Customer Support"`), so every CS push has the same title. The automated message itself keeps `sender_name` `"Maxco Customer Support"`.

## Left to the builder

- Where `pushTitle` lives (next to `buildPushBody` or in a small module that is easy to test).
