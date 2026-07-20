CREATE TABLE "storageMigrationJob" (
  "id" UUID NOT NULL,
  "direction" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL,
  "sourceProvider" VARCHAR NOT NULL,
  "destinationProvider" VARCHAR NOT NULL,
  "totalCount" INTEGER NOT NULL DEFAULT 0,
  "totalBytes" DECIMAL NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "migrated" INTEGER NOT NULL DEFAULT 0,
  "migratedBytes" DECIMAL NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "cleanupStatus" VARCHAR NOT NULL DEFAULT 'idle',
  "cleanupDeleted" INTEGER NOT NULL DEFAULT 0,
  "cleanupFailed" INTEGER NOT NULL DEFAULT 0,
  "requestedById" INTEGER,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "completedAt" TIMESTAMPTZ(6),
  CONSTRAINT "storageMigrationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "storageMigrationItem" (
  "id" SERIAL NOT NULL,
  "jobId" UUID NOT NULL,
  "attachmentId" INTEGER NOT NULL,
  "attachmentPortableId" UUID NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "destinationPath" TEXT,
  "name" VARCHAR NOT NULL,
  "size" DECIMAL NOT NULL DEFAULT 0,
  "status" VARCHAR NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "sourceDeletedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "storageMigrationItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "databaseMigrationJob" (
  "id" UUID NOT NULL,
  "status" VARCHAR NOT NULL,
  "targetHost" VARCHAR NOT NULL,
  "targetDatabase" VARCHAR NOT NULL,
  "sourceDatabase" VARCHAR NOT NULL,
  "sourceBytes" BIGINT NOT NULL DEFAULT 0,
  "estimatedBytes" BIGINT NOT NULL DEFAULT 0,
  "sourceTableCount" INTEGER NOT NULL DEFAULT 0,
  "verifiedTableCount" INTEGER NOT NULL DEFAULT 0,
  "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
  "requestedById" INTEGER,
  "message" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "completedAt" TIMESTAMPTZ(6),
  CONSTRAINT "databaseMigrationJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "storageMigrationJob_status_idx" ON "storageMigrationJob"("status");
CREATE UNIQUE INDEX "storageMigrationItem_jobId_attachmentId_key" ON "storageMigrationItem"("jobId", "attachmentId");
CREATE INDEX "storageMigrationItem_jobId_status_idx" ON "storageMigrationItem"("jobId", "status");
CREATE INDEX "databaseMigrationJob_status_idx" ON "databaseMigrationJob"("status");
CREATE INDEX "databaseMigrationJob_maintenanceMode_idx" ON "databaseMigrationJob"("maintenanceMode");

ALTER TABLE "storageMigrationItem"
  ADD CONSTRAINT "storageMigrationItem_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "storageMigrationJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
