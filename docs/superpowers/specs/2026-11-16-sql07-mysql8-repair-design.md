# SQL 07 on MySQL 8 + repair for existing databases — design (short)

## Intent
`deploy/sql/07_dbchanges_202610191417.sql` fails on MySQL 8.0 at line 53 with
`ERROR 1215 (HY000): Cannot add foreign key constraint`: it adds a STORED generated column
(`sales_chat_key`) whose base column `list_chats.category_id` has a foreign key with
`ON UPDATE CASCADE` (`FK_list_chats_list_chat_category`, from `02_migrations.sql`). MySQL 8 forbids
CASCADE / SET NULL / SET DEFAULT on the base column of a stored generated column; MariaDB allows it.
Effect: `install.sh --with-db` fresh install never gets a healthy DB, and a client running the §5
loop on MySQL 8 ends with the 07 de-duplication done but no `sales_chat_key` column and no
`uq_list_chats_sales_chat` unique index — which the app relies on (`ER_DUP_ENTRY` in
`src/services/chatService.ts:421`, `src/services/crmChatService.ts:672`) to stop duplicate inside
sales chats (category 3). Duplicates may have been created again since.

Verified: 07 as shipped fails on mysql:8.0; the same ALTERs succeed once the FK is
`ON UPDATE RESTRICT`. With that patch, `install.sh --with-db` + DEPLOYMENT.md §7 checks +
`check-endpoints.sh` all pass on image 1.0.0.

## Goals
- Fresh installs (01 → NN, MySQL 8.0 and MariaDB 10.4+) succeed.
- One repair file fixes any existing database state, safe to run more than once.

## Non-goals
- No app code change, no image rebuild (tars in `deploy/` unchanged).
- `02_migrations.sql` unchanged (it must keep matching what clients already ran).

## Anti-goals
- The repair must never lose messages: duplicates' messages move to the kept (oldest) chat before deletion.
- The repair must not fail on a database where 07 already succeeded (MariaDB) or on a fresh install.

## Approaches
- **A (chosen): fix 07 + new idempotent repair file 10.** Fix sits next to the column that needs it; older files keep matching history.
- B: create the FK without CASCADE in `02_migrations.sql` + repair file. Rejected: shipped 02 would no longer match what clients ran.
- C: replace the unique index with an app-level lock. Rejected: needs a new image and every client upgrading.

## Decisions
1. **07** (`deploy/sql/07_dbchanges_202610191417.sql` and repo `sql/dbchanges_202610191417.sql`):
   right before `ALTER TABLE list_chats ADD COLUMN sales_chat_key ...`, drop
   `FK_list_chats_list_chat_category` and re-add it `FOREIGN KEY (category_id) REFERENCES
   list_chat_category (category_id) ON UPDATE RESTRICT ON DELETE RESTRICT`.
2. **Repair** `deploy/sql/10_dbchanges_202611161515.sql` + repo `sql/dbchanges_202611161515.sql`,
   MySQL 8.0 + MariaDB 10.4+ compatible, idempotent:
   a. `USE maxco_chat_im`; de-duplicate category 3 chats exactly as 07 steps 1–4 (no-op without duplicates);
   b. FK swap to RESTRICT only when `information_schema.REFERENTIAL_CONSTRAINTS.UPDATE_RULE = 'CASCADE'`;
   c. add `sales_chat_key` only when missing (`information_schema.COLUMNS`);
   d. add `uq_list_chats_sales_chat` only when missing (`information_schema.STATISTICS`);
   e. final `SELECT` reporting column / index / FK update rule.
   Conditional DDL via `SET @s = IF(...)`; `PREPARE`/`EXECUTE` (no stored procedures).
3. **DEPLOYMENT.md**: §5 — file 10 purpose, back up first (`mysqldump`), safe to re-run;
   order comment `03..10`. §11 — rows for `ERROR 1215 ... Cannot add foreign key constraint`
   (run `sql/10_...`) and for a failed `--with-db` first install (`down -v`, reinstall).
4. `release/build_release.sh` unchanged (its manual SQL list picks up file 10).

## Verification (throwaway containers)
- mysql:8.0 fresh: `install.sh --with-db` healthy; §7 checks pass.
- mysql:8.0 broken state (01–06, old 07 fails, 08, 09, duplicates inserted): file 10 merges
  duplicates (messages kept), adds column + index + RESTRICT FK; second run: no error.
- MariaDB with old 07 applied: file 10 runs clean, row counts unchanged.
- MariaDB fresh: 01–10 succeed.

## Left to the builder
- MariaDB image tag (any 10.4+; e.g. `mariadb:10.11`).
- Exact wording of the final status `SELECT`.
