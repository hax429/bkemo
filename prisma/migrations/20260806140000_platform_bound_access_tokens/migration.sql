-- Platform binding on managed access tokens + misuse incidents.
-- Hard cutover: empty legacy apiToken; drop Obsidian pairing/device credentials.

ALTER TABLE "accessToken" ADD COLUMN IF NOT EXISTS "platform" VARCHAR(16) NOT NULL DEFAULT 'api';

UPDATE "accessToken" SET "platform" = 'api' WHERE "platform" IS NULL OR "platform" = '';

CREATE INDEX IF NOT EXISTS "accessToken_accountId_platform_idx" ON "accessToken"("accountId", "platform");

CREATE TABLE IF NOT EXISTS "accessTokenMisuseIncident" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" INTEGER NOT NULL,
    "accessTokenId" INTEGER NOT NULL,
    "expectedPlatform" VARCHAR(16) NOT NULL,
    "observedPlatform" VARCHAR(16) NOT NULL,
    "tokenName" VARCHAR(80) NOT NULL DEFAULT '',
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMPTZ(6),

    CONSTRAINT "accessTokenMisuseIncident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "accessTokenMisuseIncident_accountId_dismissedAt_idx"
  ON "accessTokenMisuseIncident"("accountId", "dismissedAt");
CREATE INDEX IF NOT EXISTS "accessTokenMisuseIncident_accessTokenId_observedPlatform_idx"
  ON "accessTokenMisuseIncident"("accessTokenId", "observedPlatform");

DO $$ BEGIN
  ALTER TABLE "accessTokenMisuseIncident"
    ADD CONSTRAINT "accessTokenMisuseIncident_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "accessTokenMisuseIncident"
    ADD CONSTRAINT "accessTokenMisuseIncident_accessTokenId_fkey"
    FOREIGN KEY ("accessTokenId") REFERENCES "accessToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Legacy account apiToken is retired; managed access tokens replace it.
UPDATE "accounts" SET "apiToken" = '';

-- Obsidian must re-pair with a platform-bound access token.
DELETE FROM "integrationDeviceCredential";
DELETE FROM "integrationPairingCode";
