-- Compose drafts are deliberately separate from notes so draft autosaves never
-- enter the saved-note change journal or appear in native iOS note queries.
CREATE TABLE "composeDraft" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "type" INTEGER NOT NULL DEFAULT 0,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMPTZ(6),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "writerId" VARCHAR(128),
    "leaseExpiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "composeDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "composeDraft_accountId_key" ON "composeDraft"("accountId");

ALTER TABLE "composeDraft"
ADD CONSTRAINT "composeDraft_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Schedules are persisted in an application-owned table. The server registers
-- in-memory timers from these rows and performs no database polling between
-- due times.
CREATE TABLE "systemSchedule" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "cron" VARCHAR(128) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMPTZ(6),
    "lastStatus" VARCHAR(32),
    "lastOutput" JSON,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "systemSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "systemSchedule_name_key" ON "systemSchedule"("name");
