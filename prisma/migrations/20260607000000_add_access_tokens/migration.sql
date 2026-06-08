-- Named, scope-limited API access tokens.
CREATE TABLE "accessToken" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" VARCHAR NOT NULL DEFAULT '',
    "jti" VARCHAR NOT NULL,
    "scopes" JSON,
    "preview" VARCHAR NOT NULL DEFAULT '',
    "lastUsedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accessToken_jti_key" ON "accessToken"("jti");

CREATE INDEX "accessToken_accountId_idx" ON "accessToken"("accountId");

ALTER TABLE "accessToken"
    ADD CONSTRAINT "accessToken_accountId_fkey"
    FOREIGN KEY ("accountId")
    REFERENCES "accounts"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
