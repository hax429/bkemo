-- Add email to accounts (in-site registration collects email)
ALTER TABLE "accounts" ADD COLUMN "email" VARCHAR NOT NULL DEFAULT '';
