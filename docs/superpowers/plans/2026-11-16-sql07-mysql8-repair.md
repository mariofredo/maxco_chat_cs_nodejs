# SQL 07 MySQL 8 fix + repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fresh installs pass SQL 07 on MySQL 8, and one idempotent repair file (10) fixes any existing database.

**Architecture:** SQL-only change: FK swap inserted into 07; new conditional-DDL repair file 10 (+ repo `sql/` copies); DEPLOYMENT.md §5/§11 notes. Verified against throwaway mysql:8.0 / mariadb containers, then end-to-end `install.sh --with-db`.

**Tech Stack:** MySQL 8.0 / MariaDB 10.4+ SQL, bash (Git Bash), Docker Desktop.

**Spec:** `docs/superpowers/specs/2026-11-16-sql07-mysql8-repair-design.md`

## Global Constraints

- FK after fix: `FK_list_chats_list_chat_category FOREIGN KEY (category_id) REFERENCES list_chat_category (category_id) ON UPDATE RESTRICT ON DELETE RESTRICT`.
- Repair file names: `deploy/sql/10_dbchanges_202611161515.sql`, `sql/dbchanges_202611161515.sql`.
- Column `sales_chat_key VARCHAR(100) GENERATED ALWAYS AS (CASE WHEN category_id = 3 THEN user_id ELSE NULL END) STORED`; unique key `uq_list_chats_sales_chat (sales_chat_key)`.
- No stored procedures; conditional DDL via `SET @s = IF(...)` + `PREPARE`/`EXECUTE`/`DEALLOCATE`.
- No change to `02_migrations.sql`, app code, image tars, `install.sh`, `build_release.sh`.
- No commits unless the user asks.

## Review Focus

1. MySQL 8 DB where old 07 failed and new duplicates exist → file 10 merges them, no message lost, index added.
2. File 10 run twice → second run no error, no change.
3. MariaDB DB where old 07 succeeded (column + index present, FK CASCADE) → file 10 no error, rows unchanged.
4. Fresh MySQL 8 via docker-entrypoint-initdb.d (01→10 in one init) → healthy.
5. A category-3 chat with admin history among duplicates → history of duplicates removed, kept chat's history intact (FK `fk_history_chat` would otherwise block delete).

---

### Task 1: Fix 07 + idempotent repair file 10

**Files:**
- Modify: `deploy/sql/07_dbchanges_202610191417.sql` (before line 53), `sql/dbchanges_202610191417.sql` (same spot)
- Create: `deploy/sql/10_dbchanges_202611161515.sql`, `sql/dbchanges_202611161515.sql`
- Test: `<workspace>/test_sql.sh` (throwaway containers)

**Interfaces:**
- Produces: `deploy/sql/01..10` runnable in order on mysql:8.0 and mariadb:10.11; file 10 runnable on any state.

- [ ] **Step 1: Write `test_sql.sh <repo>`** — scenarios, each in a fresh container, `mysql -uroot` piping files:
  - `mysql8_fresh`: 01..10 each exit 0; assert column `sales_chat_key` exists, index `uq_list_chats_sales_chat` exists, FK `UPDATE_RULE='RESTRICT'`.
  - `mysql8_broken`: 01–06, **old** 07 (`git show HEAD:deploy/sql/07_dbchanges_202610191417.sql`, error expected), 08, 09; insert user `u1` with 3 category-3 chats (ids a<b<c), 2 messages on each, 1 admin-history row on b, plus user `u2` with one category-1 chat; run 10 → exit 0; assert: `u1` has 1 category-3 chat = a, 6 messages all on a, 0 history on b/c, `u2` chat untouched, column + index + RESTRICT present; run 10 again → exit 0, same counts.
  - `maria_old07`: mariadb:10.11, 01..09 with old 07 (succeeds), FK still CASCADE; one category-3 chat with messages; run 10 → exit 0; row counts unchanged; index present.
  - `maria_fresh`: mariadb:10.11, 01..10 each exit 0.
  Print `ok/FAIL` per assertion and `RESULT: N passed, M failed`; exit non-zero on any fail.

- [ ] **Step 2: Run it — expect FAIL** (`mysql8_fresh` fails at 07 line 53 with ERROR 1215; file 10 missing).

- [ ] **Step 3: Edit 07 (both copies)** — insert before `ALTER TABLE list_chats ADD COLUMN sales_chat_key`: comment why (MySQL 8 forbids CASCADE on base column of a stored generated column), `DROP FOREIGN KEY`, re-add with RESTRICT. Update header line "New deployments ... 01 -> 07" untouched.

- [ ] **Step 4: Create file 10 (both copies)** — header in the style of 09 (purpose, applies to, idempotent, back up first); steps a–e from the spec. Repo copy identical except header line naming `sql/dbchanges_202611161515.sql`.

- [ ] **Step 5: Run test — expect PASS**: `bash <workspace>/test_sql.sh "$PWD"` → `RESULT: ... 0 failed`.

### Task 2: DEPLOYMENT.md + end-to-end install

**Files:**
- Modify: `deploy/DEPLOYMENT.md` §5 (loop comment `03..10`, new bullet for file 10 incl. `mysqldump` backup and re-run safety), §11 (two rows: `ERROR 1215 ... Cannot add foreign key constraint` → run `sql/10_dbchanges_202611161515.sql`; failed `--with-db` first install / `maxco_chat_cs_db is unhealthy` → `docker compose -f docker-compose.yml -f docker-compose.with-db.yml down -v`, then `./install.sh --with-db` again)

**Interfaces:**
- Consumes: files from Task 1.

- [ ] **Step 1: Edit DEPLOYMENT.md** as above; nothing else in the guide changes.

- [ ] **Step 2: End-to-end** — throwaway copy of `deploy/` (no `.env`, no arm64 tar), `.env` from `.env.example` with `MYSQLPASSWORD=testpass123`, `APP_PORT=13000`; `IMAGE_TAR=maxco-chat-cs_1.0.0_linux-amd64.tar ./install.sh --with-db`.
  Expected: `Done. Status: healthy`; §7: `/healthz` `{"ok":true}`, create_service_chat 201, upload success, socket.io handshake; `check-endpoints.sh http://127.0.0.1:13000` → `all checks passed`.

- [ ] **Step 3: Clean up** — `down -v`, remove test images/containers/folder; `git status` shows only the intended files; `deploy/.env` unchanged.
