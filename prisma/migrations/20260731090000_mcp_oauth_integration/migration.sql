ALTER TABLE "notes" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bkemo_increment_note_revision()
RETURNS trigger AS $$
BEGIN
  NEW."revision" := OLD."revision" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notes_revision_trigger
BEFORE UPDATE ON "notes"
FOR EACH ROW EXECUTE FUNCTION bkemo_increment_note_revision();

ALTER TABLE "mcpServers"
  ADD COLUMN "allowedTools" JSONB,
  ADD COLUMN "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
  ADD COLUMN "maxResultBytes" INTEGER NOT NULL DEFAULT 1048576,
  ADD COLUMN "secretsEncrypted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastUsedAt" TIMESTAMPTZ(6),
  ADD COLUMN "lastStatus" VARCHAR(32),
  ADD COLUMN "lastError" TEXT;

UPDATE "mcpServers"
SET "isEnabled" = false, "lastStatus" = 'legacy-disabled'
WHERE "type" <> 'streamable-http';

CREATE TABLE "oauthClient" (
  "id" UUID NOT NULL,
  "clientName" VARCHAR(255) NOT NULL,
  "redirectUris" JSONB NOT NULL,
  "grantTypes" JSONB NOT NULL,
  "responseTypes" JSONB NOT NULL,
  "tokenEndpointAuthMethod" VARCHAR(64) NOT NULL DEFAULT 'none',
  "clientUri" TEXT,
  "logoUri" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "oauthClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauthAuthorizationCode" (
  "id" UUID NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "clientId" UUID NOT NULL,
  "accountId" INTEGER NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "scopes" JSONB NOT NULL,
  "resource" TEXT NOT NULL,
  "codeChallenge" VARCHAR(128) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "usedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauthAuthorizationCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauthToken" (
  "id" UUID NOT NULL,
  "accessTokenHash" VARCHAR(64) NOT NULL,
  "refreshTokenHash" VARCHAR(64),
  "clientId" UUID NOT NULL,
  "accountId" INTEGER NOT NULL,
  "scopes" JSONB NOT NULL,
  "resource" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "refreshExpiresAt" TIMESTAMPTZ(6),
  "revokedAt" TIMESTAMPTZ(6),
  "lastUsedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauthToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauthConsent" (
  "id" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "accountId" INTEGER NOT NULL,
  "scopes" JSONB NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "oauthConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integrationIdempotency" (
  "id" UUID NOT NULL,
  "accountId" INTEGER NOT NULL,
  "credentialId" VARCHAR(128) NOT NULL,
  "operation" VARCHAR(80) NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "integrationIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integrationAudit" (
  "id" UUID NOT NULL,
  "accountId" INTEGER NOT NULL,
  "credentialId" VARCHAR(128) NOT NULL,
  "source" VARCHAR(32) NOT NULL,
  "operation" VARCHAR(80) NOT NULL,
  "outcome" VARCHAR(32) NOT NULL,
  "targetId" UUID,
  "durationMs" INTEGER NOT NULL,
  "errorCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integrationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauthAuthorizationCode_codeHash_key" ON "oauthAuthorizationCode"("codeHash");
CREATE UNIQUE INDEX "oauthToken_accessTokenHash_key" ON "oauthToken"("accessTokenHash");
CREATE UNIQUE INDEX "oauthToken_refreshTokenHash_key" ON "oauthToken"("refreshTokenHash");
CREATE UNIQUE INDEX "oauthConsent_accountId_clientId_key" ON "oauthConsent"("accountId", "clientId");
CREATE UNIQUE INDEX "integrationIdempotency_credentialId_operation_key_key" ON "integrationIdempotency"("credentialId", "operation", "key");
CREATE INDEX "oauthClient_createdAt_idx" ON "oauthClient"("createdAt");
CREATE INDEX "oauthAuthorizationCode_clientId_expiresAt_idx" ON "oauthAuthorizationCode"("clientId", "expiresAt");
CREATE INDEX "oauthAuthorizationCode_accountId_createdAt_idx" ON "oauthAuthorizationCode"("accountId", "createdAt");
CREATE INDEX "oauthToken_accountId_createdAt_idx" ON "oauthToken"("accountId", "createdAt");
CREATE INDEX "oauthToken_clientId_revokedAt_idx" ON "oauthToken"("clientId", "revokedAt");
CREATE INDEX "oauthConsent_clientId_idx" ON "oauthConsent"("clientId");
CREATE INDEX "integrationIdempotency_accountId_createdAt_idx" ON "integrationIdempotency"("accountId", "createdAt");
CREATE INDEX "integrationIdempotency_expiresAt_idx" ON "integrationIdempotency"("expiresAt");
CREATE INDEX "integrationAudit_accountId_createdAt_idx" ON "integrationAudit"("accountId", "createdAt");
CREATE INDEX "integrationAudit_credentialId_createdAt_idx" ON "integrationAudit"("credentialId", "createdAt");

ALTER TABLE "oauthAuthorizationCode" ADD CONSTRAINT "oauthAuthorizationCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthAuthorizationCode" ADD CONSTRAINT "oauthAuthorizationCode_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthToken" ADD CONSTRAINT "oauthToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthToken" ADD CONSTRAINT "oauthToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integrationIdempotency" ADD CONSTRAINT "integrationIdempotency_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integrationAudit" ADD CONSTRAINT "integrationAudit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
