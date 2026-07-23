-- Durable, append-only note change journal. A transaction-scoped advisory lock
-- serializes writers for one account before a cursor is allocated, preventing a later
-- transaction from becoming visible ahead of an earlier cursor.
CREATE TABLE "noteChange" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "noteId" INTEGER NOT NULL,
    "operation" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "noteChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "noteChange_operation_check" CHECK ("operation" IN ('upsert', 'delete'))
);

CREATE INDEX "noteChange_accountId_id_idx" ON "noteChange"("accountId", "id");

ALTER TABLE "noteChange"
    ADD CONSTRAINT "noteChange_accountId_fkey"
    FOREIGN KEY ("accountId")
    REFERENCES "accounts"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "recordNoteChange"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    journal_account_id INTEGER;
    journal_note_id INTEGER;
    journal_operation VARCHAR(16);
BEGIN
    IF TG_OP = 'DELETE' THEN
        journal_account_id := OLD."accountId";
        journal_note_id := OLD."id";
        journal_operation := 'delete';
    ELSE
        journal_account_id := NEW."accountId";
        journal_note_id := NEW."id";
        journal_operation := 'upsert';
    END IF;

    -- Account-less notes are not visible through authenticated sync.
    IF journal_account_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    -- Allocate journal IDs only after serializing this account's writers.
    PERFORM pg_advisory_xact_lock(710429, journal_account_id);

    INSERT INTO "noteChange" ("accountId", "noteId", "operation")
    VALUES (journal_account_id, journal_note_id, journal_operation);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "notes_change_journal"
AFTER INSERT OR UPDATE OR DELETE ON "notes"
FOR EACH ROW
EXECUTE FUNCTION "recordNoteChange"();
