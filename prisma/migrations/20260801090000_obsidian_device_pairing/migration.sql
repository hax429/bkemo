-- Obsidian companion pairing codes and revocable device credentials.

CREATE TABLE "integrationPairingCode" (
  "id" UUID NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "accountId" INTEGER NOT NULL,
  "deviceLabel" VARCHAR(80) NOT NULL DEFAULT '',
  "scopes" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "usedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integrationPairingCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integrationPairingCode_codeHash_key" ON "integrationPairingCode"("codeHash");
CREATE INDEX "integrationPairingCode_accountId_createdAt_idx" ON "integrationPairingCode"("accountId", "createdAt");
CREATE INDEX "integrationPairingCode_expiresAt_idx" ON "integrationPairingCode"("expiresAt");

ALTER TABLE "integrationPairingCode"
  ADD CONSTRAINT "integrationPairingCode_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "integrationDeviceCredential" (
  "id" UUID NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "accountId" INTEGER NOT NULL,
  "deviceLabel" VARCHAR(80) NOT NULL DEFAULT '',
  "scopes" JSONB NOT NULL,
  "preview" VARCHAR(16) NOT NULL DEFAULT '',
  "lastUsedAt" TIMESTAMPTZ(6),
  "expiresAt" TIMESTAMPTZ(6),
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integrationDeviceCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integrationDeviceCredential_tokenHash_key" ON "integrationDeviceCredential"("tokenHash");
CREATE INDEX "integrationDeviceCredential_accountId_createdAt_idx" ON "integrationDeviceCredential"("accountId", "createdAt");
CREATE INDEX "integrationDeviceCredential_accountId_revokedAt_idx" ON "integrationDeviceCredential"("accountId", "revokedAt");

ALTER TABLE "integrationDeviceCredential"
  ADD CONSTRAINT "integrationDeviceCredential_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
