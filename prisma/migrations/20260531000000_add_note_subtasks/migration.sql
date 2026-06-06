-- Add self-referential note hierarchy for task subtasks.
ALTER TABLE "notes" ADD COLUMN "parentNoteId" INTEGER;

CREATE INDEX "notes_parentNoteId_idx" ON "notes"("parentNoteId");

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_parentNoteId_fkey"
  FOREIGN KEY ("parentNoteId")
  REFERENCES "notes"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
