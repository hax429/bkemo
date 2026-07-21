ALTER TABLE "storageMigrationJob"
  ADD COLUMN "skipped" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "databaseMigrationJob"
  ADD COLUMN "direction" VARCHAR NOT NULL DEFAULT 'local-to-neon';

CREATE TABLE "storageActivityLog" (
  "id" UUID NOT NULL,
  "category" VARCHAR NOT NULL,
  "action" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL,
  "source" VARCHAR,
  "destination" VARCHAR,
  "summary" TEXT NOT NULL,
  "details" JSON,
  "requestedById" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  CONSTRAINT "storageActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "storageActivityLog_createdAt_idx" ON "storageActivityLog"("createdAt");
CREATE INDEX "storageActivityLog_category_createdAt_idx" ON "storageActivityLog"("category", "createdAt");
