ALTER TABLE "conversation"
  ADD COLUMN "scope" VARCHAR(32) NOT NULL DEFAULT 'global',
  ADD COLUMN "noteId" INTEGER;

CREATE INDEX "conversation_accountId_scope_idx" ON "conversation"("accountId", "scope");
CREATE INDEX "conversation_noteId_idx" ON "conversation"("noteId");

ALTER TABLE "conversation"
  ADD CONSTRAINT "conversation_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "notes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
