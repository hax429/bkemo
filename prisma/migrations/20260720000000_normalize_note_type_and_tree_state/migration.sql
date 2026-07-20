-- `-1` is an API query sentinel and must never be stored as a note type.
UPDATE "notes" SET "type" = 0 WHERE "type" = -1;

-- A parent's archive/trash state owns the state of its descendants.
WITH RECURSIVE note_tree AS (
  SELECT "id", "isArchived", "isRecycle"
  FROM "notes"
  WHERE "parentNoteId" IS NULL
  UNION ALL
  SELECT child."id", note_tree."isArchived", note_tree."isRecycle"
  FROM "notes" child
  JOIN note_tree ON child."parentNoteId" = note_tree."id"
)
UPDATE "notes" note
SET "isArchived" = note_tree."isArchived",
    "isRecycle" = note_tree."isRecycle"
FROM note_tree
WHERE note."id" = note_tree."id"
  AND (note."isArchived" IS DISTINCT FROM note_tree."isArchived"
    OR note."isRecycle" IS DISTINCT FROM note_tree."isRecycle");

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_type_valid"
  CHECK ("type" IN (0, 1, 2));
