# Database Reference for the Client - Design

Date: 2026-11-17. Size: small change (one new document).

## Intent

The client is moving the data of their old chat app into this one. Their team needs the current database schema to write that migration. Today they only receive the raw SQL files (`deploy/sql/01..09`), which show the final tables only after mentally replaying 8 rounds of ALTERs, and say nothing about what values are valid.

## Goals

- One readable document that describes every table and column as the database is **after 01..09 run**, in plain English.
- Say what each column means and what values it accepts, so an import produces data the app handles correctly.
- List the rules an import can break without an error.

## Non-goals

- No old-app to new-app mapping (we do not have the old app's data; the client maps).
- No migration script.
- No schema change. The `list_chats.updated_at` bug is noted in the document, not fixed (user did not ask for the fix; a `10_*.sql` can come separately).

## Anti-goal

A document that disagrees with the real database. Every column, type, default, key and seed row in it must match what 01..09 actually create.

## Approaches

1. One consolidated SQL file of the final state (dumped from a scratch DB). Exact, but still raw SQL with no meanings.
2. Send the 9 existing files. No work, but no final picture and no rules.
3. **Written reference document (chosen by the user).** Most readable for the migration team; risk of drifting from the SQL is handled by building it from a real dump (see Constraints).

## Decisions

- **Format and place (my call):** Markdown at `deploy/DATABASE.md`, next to `deploy/DEPLOYMENT.md`, so it ships in the deploy package like the other client docs. English, same style as `docs/integration-guide-*.md`. `DEPLOYMENT.md` §5 gets one line pointing to it. Not inside `deploy/sql/` (everything there auto-runs on a fresh install).
- **Source of truth (my call):** run 01..09 on a throwaway MySQL 8.0 container, take `SHOW CREATE TABLE` for all 7 tables plus the seed rows, and write the document from that output, not from reading the migration files.
- **`updated_at` (my default, user did not choose):** document the schema as the SQL creates it (no `list_chats.updated_at`) and add a "Known issue" note.

## Document contents

1. **Overview** - the 7 tables, one line each, and a small text diagram of how they link (`list_chats` at the center). What is not in the database: online status and typing (in memory), uploaded files (on disk, `chat_uploads` volume), users/admins (IDs from the client's member system and CRM; there is no users table).
2. **One section per table** - purpose; column table (name, type, null, default, meaning / allowed values); primary key, foreign keys, unique keys, indexes. Tables: `list_chats`, `list_messages`, `list_chat_admin_history`, `list_content_type`, `list_chat_category`, `list_user_devices`, `list_chat_config`.
3. **Reference data** - rows that must exist: content types (1 Text, 2 File), categories (1 Customer Service, 2 Announcement - the app files promotion chats here, 3 Inside Sales), config (`max_waiting_minutes` = 120).
4. **Rules for importing data** - the ones the database does not catch, or catches with an error:
   - Category 3 (Inside Sales): exactly one chat per user; enforced by the generated column `sales_chat_key` + unique key; never insert into `sales_chat_key`.
   - Category 1 (Customer Service): at most one `pending`/`active` chat per user; enforced only by the app.
   - `chat_ticket` format `NNNN-NNNN-NNNN` (12 random digits); category 2 chats use the literal `Promotion`.
   - File messages: `content_type` = 2, `content_url` = server path `uploads/chat/<epoch ms>_<file name>`, `metadata` = `{"fileName": ..., "size": <bytes>}`; the file itself must be copied into the `chat_uploads` volume.
   - Text messages: `content_type` = 1, `message` set, `content_url` / `metadata` NULL.
   - `sender_type` is `user` or `admin`; `read_at` NULL means unread (drives unread counts).
   - Timestamps are stored in the database server's local time, not UTC.
   - Insert order: reference data, then `list_chats`, then `list_messages` / `list_chat_admin_history` (foreign keys).
5. **Columns kept but not written by the current app** - `list_chats.department_id`, the whole `list_chat_admin_history` table (incl. `redirect_*`). Safe to fill from old data or leave empty.
6. **Known issue** - the app writes `list_chats.updated_at` (status change, admin assignment) but no SQL file creates it.
7. **Where each part comes from** - which `deploy/sql` file creates or changes each table, for anyone who wants the raw SQL.

## Left to the builder

- Exact wording and order inside each section.
- Whether the text diagram is ASCII or a Mermaid block (ASCII preferred: renders anywhere).
- Verify every rule above against the code once more while writing; drop or correct any that turn out wrong.

## Done when

- `deploy/DATABASE.md` exists, covers sections 1-7, and every column/type/default/key/seed in it matches the scratch-DB dump.
- `deploy/DEPLOYMENT.md` §5 links to it.
- Scratch container removed.
