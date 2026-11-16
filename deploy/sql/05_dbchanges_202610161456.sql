-- ============================================================================
-- 05_dbchanges_202610161456.sql - seed of chat category 3 (Inside Sales)
-- Applies to: databases that ALREADY ran 01_schema.sql .. 04_dbchanges_*.sql
-- (for an existing handover, run sql/dbchanges_202610161456.sql instead).
-- New deployments: no manual run needed - docker-entrypoint-initdb.d applies
-- 01 -> 05 in order.
-- One-time only: not idempotent (plain INSERT; the primary key makes a second
-- run fail, which is the expected signal that the row is already there).
-- Required: without category 3, POST /api/chats/user cannot create the inside
-- sales chat (foreign key on list_chats.category_id).
-- ============================================================================

USE `maxco_chat_im`;

INSERT INTO list_chat_category (category_id, category_name) VALUES
	 (3, 'Inside Sales');
