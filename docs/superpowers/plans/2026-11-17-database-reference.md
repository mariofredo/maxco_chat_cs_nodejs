# Database Reference for the Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `deploy/DATABASE.md`, a plain-English reference of the current database schema for the client's team that migrates their old chat app's data into this app.

**Architecture:** Run `deploy/sql/01..09` on a throwaway MySQL 8.0 container, export the real column / index / seed facts to TSV files in the scratchpad, and write the document from those files. A small scratch check script compares the document's column tables and index names with the TSVs in both directions. Import rules are written from the code and each one is confirmed by a grep.

**Tech Stack:** Markdown, Docker (`mysql:8.0`, already pulled locally), Git Bash, awk.

**Spec:** `docs/superpowers/specs/2026-11-17-database-reference-design.md`

## Global Constraints

- Output file: `deploy/DATABASE.md`. Nothing new goes inside `deploy/sql/` (every file there auto-runs on a fresh install).
- English, same tone as `docs/integration-guide-*.md` and `deploy/DEPLOYMENT.md`. Audience: the client's developers; they do not have the source code, so the document never points at `src/` files.
- Every column, type, nullability, default, key, index and seed row must match the scratch DB built from `deploy/sql/01..09`. Types are written as MySQL 8.0 reports them (`COLUMN_TYPE`).
- No schema change. `list_chats.updated_at` is described only as a known issue.
- Database name: `maxco_chat_im`. 7 tables: `list_chats`, `list_messages`, `list_chat_admin_history`, `list_content_type`, `list_chat_category`, `list_user_devices`, `list_chat_config`.
- Scratch files live in `$SCRATCH` = `C:/Users/ASUS/AppData/Local/Temp/claude/2aaeb07ec755cf33/91662834-773c-494d-876b-c12e2c781fbb/scratchpad/dbref` and are never committed.

## Document format (pinned, the check script depends on it)

- Table sections are `### \`<table>\`` headings under `## 2. Tables`.
- Each table section has a column table with this exact header and one row per column:
  `| Column | Type | Null | Default | Meaning |`
  Row form: ``| `<column>` | `<COLUMN_TYPE>` | yes|no | <default> | <meaning> |``
- Each table section names every index from the DB (including `PRIMARY`) in backticks, in a "Keys and indexes" list.
- Top-level sections, in order: `## 1. Overview`, `## 2. Tables`, `## 3. Reference data`, `## 4. Rules for importing data`, `## 5. Columns the app does not write`, `## 6. Known issue`, `## 7. Where each table comes from`.

## Review Focus

1. Client runs MariaDB, not MySQL 8: MariaDB shows `bigint(20)` / `int(11)` where MySQL 8 shows `bigint` / `int`. Readers expect the document to say types are MySQL 8.0 spelling and that these spellings are the same column. → Task 1, Step 4 adds the sentence; Step 6 greps for it.
2. Timestamps imported in UTC while the default deployment runs MySQL with `TZ=Asia/Jakarta`: every chat would look 7 hours off and the waiting list would be wrong. Readers expect a clear "use the MySQL server's time zone" rule. → Task 2, Step 2 checks the source; Step 4 greps the rule.
3. Old file messages carry absolute URLs (old server, cloud storage): the app stores and serves relative `uploads/chat/...` paths through `/uploads`. Readers expect to be told to copy files and rewrite to the relative form. → Task 2, Steps 2 and 4.
4. Import sets `sales_chat_key` or creates 2 Inside Sales chats for one user: MySQL rejects it. Readers expect the rule before they hit the error. → Task 2, Steps 2 and 4.
5. Import creates several open (`pending`/`active`) Customer Service chats for one user: no DB error, but the app only ever reopens the newest. Readers expect the rule to say so. → Task 2, Steps 2 and 4.

---

### Task 1: Scratch database, check script, and the table reference

**Files:**
- Create: `deploy/DATABASE.md` (sections 1, 2, 3, 7; sections 4-6 as headings with one line "Filled in by Task 2" - replaced in Task 2)
- Modify: `deploy/DEPLOYMENT.md` §5 "Database" (around line 101-136): add one line pointing to `DATABASE.md`; add `DATABASE.md` to the package tree in §1 (around line 20)
- Scratch (not committed): `$SCRATCH/columns.tsv`, `$SCRATCH/indexes.tsv`, `$SCRATCH/create_tables.sql`, `$SCRATCH/seeds.txt`, `$SCRATCH/check_db_doc.sh`
- Commit also: `docs/superpowers/specs/2026-11-17-database-reference-design.md`, this plan

**Interfaces:**
- Produces: `deploy/DATABASE.md` in the pinned format; `$SCRATCH/check_db_doc.sh <columns.tsv> <indexes.tsv> <DATABASE.md>` (exit 0 = match); container `dbref-mysql` left running for Task 2.

- [ ] **Step 1: Start the scratch database**

```bash
export SCRATCH="C:/Users/ASUS/AppData/Local/Temp/claude/2aaeb07ec755cf33/91662834-773c-494d-876b-c12e2c781fbb/scratchpad/dbref"
mkdir -p "$SCRATCH"
MSYS_NO_PATHCONV=1 docker run -d --name dbref-mysql -e MYSQL_ROOT_PASSWORD=dbref -e TZ=Asia/Jakarta \
  -v "C:/Users/ASUS/projects/maxco_chat_cs_nodejs/deploy/sql:/docker-entrypoint-initdb.d:ro" mysql:8.0
```
Wait (Monitor until-loop, not sleep) until this prints `1`:
`docker exec dbref-mysql mysql -uroot -pdbref -N -e "SELECT COUNT(*) FROM maxco_chat_im.list_chat_config" 2>/dev/null`
If `docker logs dbref-mysql` shows an `ERROR` from an init script, stop: the SQL files themselves are broken, report it.

- [ ] **Step 2: Export the facts**

```bash
q() { docker exec dbref-mysql mysql -uroot -pdbref -N -B -e "$1" 2>/dev/null; }
q "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, LOWER(IS_NULLABLE), IFNULL(COLUMN_DEFAULT,'NULL'), EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='maxco_chat_im' ORDER BY TABLE_NAME, ORDINAL_POSITION" > "$SCRATCH/columns.tsv"
q "SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='maxco_chat_im' ORDER BY 1,2" > "$SCRATCH/indexes.tsv"
for t in list_chats list_messages list_chat_admin_history list_content_type list_chat_category list_user_devices list_chat_config; do q "SHOW CREATE TABLE maxco_chat_im.$t" ; done > "$SCRATCH/create_tables.sql"
for t in list_content_type list_chat_category list_chat_config; do echo "== $t"; q "SELECT * FROM maxco_chat_im.$t"; done > "$SCRATCH/seeds.txt"
cut -f1 "$SCRATCH/columns.tsv" | sort -u | wc -l
```
Expected: `7`. `columns.tsv` has no `updated_at` row for `list_chats` (confirms the known issue).

- [ ] **Step 3: Write the check script `$SCRATCH/check_db_doc.sh`, then run it - it must fail**

Behavior (bash + awk):
- Parse `DATABASE.md`: a line `### \`<t>\`` opens table section `<t>`; any `## ` or `### ` line closes it. Inside a section, a line matching ``^\| `([^`]+)` \| `([^`]+)` \| (yes|no) \|`` is a column row (column, type, null).
- Fail and print `MISSING <t>.<col>` for each `columns.tsv` row with no column row of the same name in section `<t>`; `WRONG <t>.<col>: doc <type>/<null> db <type>/<null>` when type or null differ; `EXTRA <t>.<col>` for a doc column row not in `columns.tsv`; `NOINDEX <t>.<index>` for each `indexes.tsv` row whose `` `<index>` `` does not appear in section `<t>`.
- Exit 1 if anything was printed, else print `OK` and exit 0.

Run: `bash "$SCRATCH/check_db_doc.sh" "$SCRATCH/columns.tsv" "$SCRATCH/indexes.tsv" deploy/DATABASE.md`
Expected: FAIL (file does not exist yet, or every column `MISSING`).

- [ ] **Step 4: Write `deploy/DATABASE.md` sections 1, 2, 3, 7 from the scratch files**

- Title `# Maxco Chat CS - Database Reference`, then 2-3 lines: who it is for (teams moving data into this app), that it describes the database after all `sql/` files ran, database name `maxco_chat_im`, MySQL 8.0 / MariaDB 10.4+, `utf8mb4`. Plus the sentence: types are shown as MySQL 8.0 reports them; MariaDB shows the same columns with display widths (`bigint(20)`, `int(11)`); `list_messages.metadata` is `longtext` holding JSON on both.
- **1. Overview:** one line per table; ASCII diagram with `list_chats` in the center, `list_messages` and `list_chat_admin_history` hanging off `chat_id`, `list_chat_category` and `list_content_type` as lookups, `list_user_devices` and `list_chat_config` standalone. "Not in the database": online status and typing (in memory), uploaded files (disk, `chat_uploads` volume), users and admins (IDs from the client's member system / CRM, no users table).
- **2. Tables:** one `###` section per table in the order of the Global Constraints list. Purpose (1-2 lines), the pinned column table (Default from `columns.tsv`; generated columns say "generated" with the expression from `create_tables.sql`), "Keys and indexes" list with every index name and every foreign key (target, `ON UPDATE`/`ON DELETE`) from `create_tables.sql`. Meanings: `status` pending = waiting for first CS reply, active = being handled, closed; `sender_type` user/admin; `read_at` NULL = unread; `user_referrer_id`/`user_referrer_name` = the sales person the member belongs to (Inside Sales); `metadata` = JSON; `list_user_devices.platform` free text, default `android`.
- **3. Reference data:** the rows from `seeds.txt` as tables, marked required (the app uses content type 1/2 and category 1/2/3 by number; category 2 is named `Announcement` and holds promotion chats); `max_waiting_minutes` = 120 explained (an active chat whose last CS reply is older than this shows in the CRM waiting list).
- **7. Where each table comes from:** table → `sql/` file(s) that create or change it (`01_schema.sql`, `02_migrations.sql`, `03`..`09`), copied from the file headers.
- Sections 4-6: heading + "Filled in by Task 2".

- [ ] **Step 5: Run the check - it must pass**

Run: `bash "$SCRATCH/check_db_doc.sh" "$SCRATCH/columns.tsv" "$SCRATCH/indexes.tsv" deploy/DATABASE.md`
Expected: `OK`.

- [ ] **Step 6: Check the rest by eye and grep**

- `grep -c "bigint(20)" deploy/DATABASE.md` ≥ 1 (MariaDB sentence, Review Focus 1).
- Every default in the column tables equals column 5 of `columns.tsv` (`CURRENT_TIMESTAMP` for `DEFAULT_GENERATED`); every seed row in §3 equals `seeds.txt`; every foreign key in the doc appears in `create_tables.sql`.

- [ ] **Step 7: Link from DEPLOYMENT.md**

In `deploy/DEPLOYMENT.md` §5, one line: `` Table and column reference (for data migrations or reporting): [`DATABASE.md`](DATABASE.md). `` Add `DATABASE.md` to the §1 package tree with comment `# database reference (tables, columns, import rules)`.
Run: `grep -n "DATABASE.md" deploy/DEPLOYMENT.md` → 2 lines.

- [ ] **Step 8: Commit**

```bash
git add deploy/DATABASE.md deploy/DEPLOYMENT.md docs/superpowers/specs/2026-11-17-database-reference-design.md docs/superpowers/plans/2026-11-17-database-reference.md
git commit -m "docs: add database reference for client data migration"
```

---

### Task 2: Import rules, unused columns, known issue

**Files:**
- Modify: `deploy/DATABASE.md` sections 4, 5, 6 (replace the "Filled in by Task 2" lines)

**Interfaces:**
- Consumes: `deploy/DATABASE.md` from Task 1; container `dbref-mysql`; `$SCRATCH/check_db_doc.sh`.

- [ ] **Step 1: Confirm each rule's source in the code (all must match before writing)**

| Rule | Command | Expected |
|---|---|---|
| One open CS chat per user, app-only | `grep -n "status IN ('active', 'pending') AND category_id = 1" src/services/chatService.ts` | 1+ line |
| One Inside Sales chat per user, DB-enforced | `grep -n "uq_list_chats_sales_chat" "$SCRATCH/create_tables.sql"` | 1 line |
| Ticket format | `grep -n "randomNumericString(12)" src/services/chatService.ts src/services/crmChatService.ts` | 4 lines |
| Promotion ticket literal | `grep -n "'Promotion', 2" src/services/crmChatService.ts` | 2 lines |
| File path + metadata | `grep -nE "uploads/chat\|fileName\|size" src/utils/chatFileStorage.ts` | path `uploads/chat`, `${Date.now()}_${fileName}`, `{ fileName, size }` |
| Files served from `/uploads` | `grep -n 'express.static("uploads")' src/app.ts` | 1 line |
| Unread = admin message with `read_at` NULL | `grep -n "m.read_at IS NULL" src/services/clientChatService.ts` | 1 line |
| Timestamps via `NOW()`, server TZ default Asia/Jakarta | `grep -n "TZ:" deploy/docker-compose.with-db.yml` | `Asia/Jakarta` |
| Columns not written | `grep -rnE "department_id\|list_chat_admin_history\|redirect_" src` | no output |

In the raw markdown of this table, `\|` is a plain `|` when you run the command (markdown escaping only).

If a row does not match, correct or drop that rule; do not write it as it stands in this plan.

- [ ] **Step 2: Prove the two DB-enforced rules on the scratch DB**

```bash
q() { docker exec dbref-mysql mysql -uroot -pdbref maxco_chat_im -e "$1" 2>&1; }
q "INSERT INTO list_chats (chat_ticket,user_id,status,category_id) VALUES ('0000-0000-0001','u1','active',3); INSERT INTO list_chats (chat_ticket,user_id,status,category_id) VALUES ('0000-0000-0002','u1','active',3);"
q "INSERT INTO list_chats (chat_ticket,user_id,status,category_id,sales_chat_key) VALUES ('0000-0000-0003','u2','active',3,'u2');"
```
Expected: first command ends with `ERROR 1062 (23000): Duplicate entry 'u1' for key ...`; second with `ERROR 3105 (HY000): The value specified for generated column 'sales_chat_key' ...`. Copy these exact error lines into the rules.

- [ ] **Step 3: Write sections 4, 5, 6**

- **4. Rules for importing data:** numbered rules, each with "what happens if broken":
  1. Insert order: reference data (§3) → `list_chats` → `list_messages`, `list_chat_admin_history`. Old chat IDs may be kept or renumbered; messages must point to the new `list_chats.id`.
  2. Inside Sales (category 3): one chat per user; never set `sales_chat_key`; the two error lines from Step 2.
  3. Customer Service (category 1): at most one `pending`/`active` chat per user; not checked by the database; the app reopens only the newest, older open ones stay stuck. Close old ones (`status = 'closed'`, `closed_at` set).
  4. Promotion (category 2): `chat_ticket = 'Promotion'`; at most one `active` per user (app-only).
  5. `chat_ticket` for categories 1 and 3: `NNNN-NNNN-NNNN`, 12 random digits; not unique in the database, but keep it unique - it is the ticket number shown to people.
  6. Text message: `content_type = 1`, text in `message`, `content_url` and `metadata` NULL.
  7. File message: `content_type = 2`, `content_url = 'uploads/chat/<epoch ms>_<file name>'` (relative, no leading slash, no host), `metadata = {"fileName": "<name>", "size": <bytes>}`; copy the file to that path inside the `chat_uploads` volume (mounted at `/app/uploads`), where the app serves it at `<base URL>/uploads/chat/...`. Old absolute URLs must be downloaded and rewritten; external URLs are not supported.
  8. `sender_type` `user` or `admin`, `sender_id` = member ID or CRM admin ID, `sender_name` display name.
  9. `read_at`: NULL = unread; the app's unread badge counts `admin` messages with NULL `read_at`. Set `read_at` on old messages unless they should show as unread.
  10. Timestamps: written by the app with MySQL `NOW()` in the MySQL server's time zone (default deployment `TZ=Asia/Jakarta`); import local times in that same zone, not UTC. Check with `SELECT @@global.time_zone, @@system_time_zone;`.
- **5. Columns the app does not write:** `list_chats.department_id`; table `list_chat_admin_history` (all columns, incl. `redirect_to_department_id`, `redirect_date`). Kept from the earlier version; fill from old data or leave empty; the app never reads them.
- **6. Known issue:** the app updates `list_chats.updated_at` when a chat's status changes and when an admin is assigned, but no `sql/` file creates that column, so those two actions fail with `ER_BAD_FIELD_ERROR` until it is added. A fix will ship as a new `sql/` file; until then do not rely on `updated_at`.

- [ ] **Step 4: Verify**

- `bash "$SCRATCH/check_db_doc.sh" "$SCRATCH/columns.tsv" "$SCRATCH/indexes.tsv" deploy/DATABASE.md` → `OK` (rules sections must not add fake column rows).
- `grep -nE "Asia/Jakarta|uploads/chat/|sales_chat_key|ERROR 1062|ERROR 3105|Filled in by Task 2" deploy/DATABASE.md` → every term except `Filled in by Task 2` present.
- `grep -n "src/" deploy/DATABASE.md` → no output (client has no source).

- [ ] **Step 5: Remove the scratch container**

Run: `docker rm -f dbref-mysql && docker ps -a --filter name=dbref-mysql -q`
Expected: second command prints nothing.

- [ ] **Step 6: Commit**

```bash
git add deploy/DATABASE.md
git commit -m "docs: add import rules and known issue to database reference"
```
