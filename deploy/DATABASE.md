# Maxco Chat CS — Database Reference

For teams that read or fill this database directly, for example to move chat data from an older
system into this app. It describes the database as it is **after every file in `sql/` has run**
(`01_schema.sql` through `09_dbchanges_202610231200.sql`).

- Database name: `maxco_chat_im` (must match `MYSQLDATABASE` in `.env`), charset `utf8mb4`.
- Server: MySQL 8.0 / MariaDB 10.4+. Types below are shown as MariaDB reports them; MySQL 8.0 shows
  the same columns without display widths (`bigint` for `bigint(20)`, `int` for `int(11)`).
  `list_messages.metadata` is `longtext` holding JSON on both. Before using MySQL 8.0, read §6.

---

## 1. Overview

| Table | Holds |
|---|---|
| `list_chats` | One row per conversation between a member and the CS / Sales team |
| `list_messages` | Every message of every chat, text or file |
| `list_chat_admin_history` | Agent assignment history of a chat (not written by the current app, see §5) |
| `list_content_type` | Lookup: message types (1 = Text, 2 = File) |
| `list_chat_category` | Lookup: chat categories (1 = Customer Service, 2 = Announcement, 3 = Inside Sales) |
| `list_user_devices` | Push notification (FCM) tokens of members' phones |
| `list_chat_config` | Settings as key / value pairs |

```text
 list_chat_category                          list_content_type
   category_id  <──────┐                ┌──────>  content_type_id
                       │                │
                  list_chats            │
                    id  <───────┬───────┼──────────────┐
                    category_id │       │              │
                                │  list_messages   list_chat_admin_history
                                │    chat_id          chat_id
                                │    content_type
                                │
 standalone:  list_user_devices (keyed by member user_id)
              list_chat_config  (keyed by config_key)
```

**Not in the database:**

- Members and agents. There is no users table: `user_id` is the member ID from the client's member
  system, `admin_id` is the CS / Sales person's ID from the CRM. Names are copied into the chat and
  message rows (`user_name`, `admin_name`, `sender_name`).
- Uploaded files. They are stored on disk in the `chat_uploads` volume; a file message only keeps
  the file's path (`list_messages.content_url`).
- Online status and "is typing". Kept in the app's memory only.

---

## 2. Tables

Null: `yes` = the column may be NULL. Default: `—` = no default (the value must be given on insert).

### `list_chats`

One row per conversation. A member can have several chats over time (one per category, and new
Customer Service chats after old ones are closed).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | `bigint(20)` | no | auto increment | Chat ID. Messages point to it. |
| `chat_ticket` | `varchar(50)` | yes | NULL | Ticket number shown to people, e.g. `4821-0937-1156`; promotion chats hold the text `Promotion`. Format in §4. |
| `category_id` | `int(11)` | no | — | Chat category, see `list_chat_category` (1 Customer Service, 2 Announcement, 3 Inside Sales). |
| `user_id` | `varchar(100)` | no | — | Member ID from the client's member system. |
| `user_name` | `varchar(100)` | yes | NULL | Member's display name when the chat was opened. |
| `user_referrer_id` | `varchar(100)` | yes | NULL | ID of the sales person the member belongs to (their referrer), as sent by the mobile app. The Inside Sales chat is with this person. |
| `user_referrer_name` | `varchar(100)` | yes | NULL | Display name of that sales person. |
| `admin_id` | `varchar(100)` | yes | NULL | CRM ID of the CS / Sales person handling the chat. NULL while nobody has taken it. |
| `admin_name` | `varchar(100)` | yes | NULL | Display name of that person. |
| `status` | `enum('pending','active','closed')` | yes | `'pending'` | `pending` = waiting for an agent to take it; `active` = taken (Inside Sales and promotion chats start `active`); `closed` = finished. |
| `created_at` | `timestamp` | no | `current_timestamp()` | When the chat was opened. |
| `closed_at` | `timestamp` | yes | NULL | When the chat was closed. NULL while open. |
| `department_id` | `int(11)` | yes | NULL | Not used by the current app (§5). |
| `sales_chat_key` | `varchar(100)` | yes | generated | Computed by the database: `user_id` when `category_id = 3`, otherwise NULL (`STORED`). Its unique key allows one Inside Sales chat per member. Never insert or update it (§4). |

Keys and indexes:

- `PRIMARY` — `id`.
- `uq_list_chats_sales_chat` — unique on `sales_chat_key`: at most one category 3 chat per `user_id`.
  NULLs do not collide, so categories 1 and 2 are not limited by it.
- `FK_list_chats_list_chat_category` — foreign key `category_id` → `list_chat_category.category_id`,
  `ON UPDATE CASCADE`, delete restricted.
- `idx_list_chats_user_id` — on `user_id` (chat list of one member).

### `list_messages`

Every message of every chat, oldest to newest by `created_at`, then `id`.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | `bigint(20)` | no | auto increment | Message ID. Breaks ties between messages with the same second in `created_at`. |
| `chat_id` | `bigint(20)` | no | — | The chat, `list_chats.id`. |
| `sender_type` | `enum('user','admin')` | no | — | `user` = sent by the member (mobile app); `admin` = sent by CS / Sales (CRM). |
| `sender_id` | `varchar(100)` | no | — | Member ID (when `user`) or CRM ID (when `admin`). |
| `sender_name` | `varchar(100)` | yes | NULL | Sender's display name at sending time. |
| `message` | `text` | yes | NULL | The text of a text message. |
| `content_url` | `text` | yes | NULL | File messages: path of the stored file, e.g. `uploads/chat/1763358000000_invoice.pdf`. NULL for text. |
| `content_type` | `int(11)` | yes | NULL | Message type, see `list_content_type`: 1 = Text, 2 = File. Set it on every row: the CRM's message lists skip messages where it is NULL. |
| `created_at` | `timestamp` | no | `current_timestamp()` | When the message was sent. |
| `read_at` | `timestamp` | yes | NULL | When the other side read it. NULL = unread. |
| `metadata` | `longtext` | yes | NULL | JSON (the database rejects text that is not valid JSON). File messages: `{"fileName": "...", "size": <bytes>}`. |

Keys and indexes:

- `PRIMARY` — `id`.
- `fk_message_chat` — foreign key `chat_id` → `list_chats.id` (update and delete restricted: a chat
  with messages cannot be deleted).
- `FK_list_messages_list_content_type` — foreign key `content_type` →
  `list_content_type.content_type_id`, `ON UPDATE CASCADE`, delete restricted.
- `idx_list_messages_chat_created` — on (`chat_id`, `created_at`, `id`) (message history page by page).

### `list_chat_admin_history`

Meant to record which agent handled a chat and when it was handed over. Kept from the earlier
version of the app; the current app neither writes nor reads it (§5).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | `bigint(20)` | no | auto increment | Row ID. |
| `chat_id` | `bigint(20)` | no | — | The chat, `list_chats.id`. |
| `admin_id` | `varchar(100)` | no | — | CRM ID of the agent. |
| `assigned_at` | `timestamp` | no | `current_timestamp()` | When the agent got the chat. |
| `unassigned_at` | `timestamp` | yes | NULL | When the agent stopped handling it. |
| `redirect_to_department_id` | `int(11)` | yes | NULL | Department the chat was passed to. |
| `redirect_date` | `datetime` | yes | NULL | When it was passed on. |

Keys and indexes:

- `PRIMARY` — `id`.
- `fk_history_chat` — foreign key `chat_id` → `list_chats.id` (update and delete restricted).

### `list_content_type`

Lookup of message types. Its rows are required (§3).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `content_type_id` | `int(11)` | no | auto increment | Type number used in `list_messages.content_type`. |
| `content_type_name` | `varchar(100)` | no | — | Type name. |

Keys and indexes:

- `PRIMARY` — `content_type_id`.

### `list_chat_category`

Lookup of chat categories. Its rows are required (§3).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `category_id` | `int(11)` | no | auto increment | Category number used in `list_chats.category_id`. |
| `category_name` | `varchar(100)` | no | — | Category name. |

Keys and indexes:

- `PRIMARY` — `category_id`.

### `list_user_devices`

Firebase Cloud Messaging (FCM) tokens, one row per member device, used to send push notifications
for new chat messages. Not linked to the other tables by a foreign key.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | `bigint(20)` | no | auto increment | Row ID. |
| `user_id` | `varchar(100)` | no | — | Member ID (same as `list_chats.user_id`). |
| `fcm_token` | `varchar(1024)` | no | — | FCM registration token of one device. The app keeps each token on one member only: registering it again moves it. |
| `platform` | `varchar(20)` | no | `'android'` | Device platform as sent by the app, e.g. `android`, `ios`. |
| `created_at` | `timestamp` | no | `current_timestamp()` | When the token was first registered. |
| `updated_at` | `timestamp` | no | `current_timestamp()` | Set by the database on every change (`ON UPDATE current_timestamp()`). |

Keys and indexes:

- `PRIMARY` — `id`.
- `idx_list_user_devices_user` — on `user_id`.
- `idx_list_user_devices_token` — on the first 191 characters of `fcm_token`.

### `list_chat_config`

App settings as key / value pairs. Its row is required (§3).

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `config_key` | `varchar(100)` | no | — | Setting name. |
| `config_value` | `varchar(255)` | no | — | Setting value, stored as text (numbers too). |
| `description` | `varchar(255)` | yes | NULL | What the setting does. |
| `updated_at` | `timestamp` | no | `current_timestamp()` | Set by the database on every change (`ON UPDATE current_timestamp()`). |

Keys and indexes:

- `PRIMARY` — `config_key`.

---

## 3. Reference data

These rows are created by the `sql/` files and must exist before the app (or an import) writes
chats and messages. The app uses the numbers directly, so keep the IDs exactly as below.

`list_content_type`:

| `content_type_id` | `content_type_name` |
|---|---|
| 1 | Text |
| 2 | File |

`list_chat_category`:

| `category_id` | `category_name` | Used for |
|---|---|---|
| 1 | Customer Service | Member ↔ CS chats. Opened by the member (or the CRM); starts `pending` until an agent takes it. |
| 2 | Announcement | Promotion chats opened by the CRM (`chat_ticket = 'Promotion'`). |
| 3 | Inside Sales | The member's chat with their sales person (`user_referrer_id`). One per member. |

`list_chat_config`:

| `config_key` | `config_value` | Meaning |
|---|---|---|
| `max_waiting_minutes` | `120` | A `pending` or `active` chat whose last CS / Sales message is older than this many minutes, or that has no CS / Sales message yet, shows in the CRM's waiting list instead of its active list. |

---

## 4. Rules for importing data

Filled in by Task 2.

---

## 5. Columns the app does not write

Filled in by Task 2.

---

## 6. Known issues

Filled in by Task 2.

---

## 7. Where each table comes from

| Table | Created by | Changed by |
|---|---|---|
| `list_chats` | `01_schema.sql` | `02_migrations.sql` (`user_name`, `admin_name`, `category_id` + foreign key), `04_dbchanges_202610121639.sql` (`user_referrer_id`), `06_dbchanges_202610190950.sql` (`user_referrer_name`), `07_dbchanges_202610191417.sql` (removes duplicate Inside Sales chats, adds `sales_chat_key` + `uq_list_chats_sales_chat`), `08_dbchanges_202610221020.sql` (`idx_list_chats_user_id`) |
| `list_messages` | `01_schema.sql` | `02_migrations.sql` (`sender_name`), `08_dbchanges_202610221020.sql` (`idx_list_messages_chat_created`) |
| `list_chat_admin_history` | `01_schema.sql` | — |
| `list_content_type` | `01_schema.sql` (with rows 1, 2) | — |
| `list_chat_category` | `02_migrations.sql` (with rows 1, 2) | `05_dbchanges_202610161456.sql` (row 3) |
| `list_user_devices` | `03_dbchanges_202610051115.sql` | — |
| `list_chat_config` | `09_dbchanges_202610231200.sql` (with `max_waiting_minutes`) | — |
