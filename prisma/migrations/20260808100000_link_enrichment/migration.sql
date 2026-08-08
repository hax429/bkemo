-- Save-time URL enrichment sidecar for bookmark cards.
CREATE TABLE IF NOT EXISTS "linkEnrichment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" INTEGER NOT NULL,
    "noteId" INTEGER NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "title" VARCHAR(512) NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "favicon" VARCHAR(2048) NOT NULL DEFAULT '',
    "imageUrl" VARCHAR(2048) NOT NULL DEFAULT '',
    "imagePath" VARCHAR(2048) NOT NULL DEFAULT '',
    "markdown" TEXT NOT NULL DEFAULT '',
    "archiveUrl" VARCHAR(2048) NOT NULL DEFAULT '',
    "archiveJobId" VARCHAR(128) NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "markdownStatus" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "archiveStatus" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "linkEnrichment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "linkEnrichment_noteId_url_key" ON "linkEnrichment"("noteId", "url");
CREATE INDEX IF NOT EXISTS "linkEnrichment_accountId_status_idx" ON "linkEnrichment"("accountId", "status");
CREATE INDEX IF NOT EXISTS "linkEnrichment_noteId_idx" ON "linkEnrichment"("noteId");

ALTER TABLE "linkEnrichment"
  ADD CONSTRAINT "linkEnrichment_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "linkEnrichment"
  ADD CONSTRAINT "linkEnrichment_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
