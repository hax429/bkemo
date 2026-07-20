-- Stable identifiers let exports merge safely without reusing deployment-local
-- integer primary keys.
ALTER TABLE "accounts" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "attachments" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "notes" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "comments" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "tag" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "follows" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "notifications" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "conversation" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "message" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "noteHistory" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "aiScheduledTask" ADD COLUMN "portableId" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "accounts_portableId_key" ON "accounts"("portableId");
CREATE UNIQUE INDEX "attachments_portableId_key" ON "attachments"("portableId");
CREATE UNIQUE INDEX "notes_portableId_key" ON "notes"("portableId");
CREATE UNIQUE INDEX "comments_portableId_key" ON "comments"("portableId");
CREATE UNIQUE INDEX "tag_portableId_key" ON "tag"("portableId");
CREATE UNIQUE INDEX "follows_portableId_key" ON "follows"("portableId");
CREATE UNIQUE INDEX "notifications_portableId_key" ON "notifications"("portableId");
CREATE UNIQUE INDEX "conversation_portableId_key" ON "conversation"("portableId");
CREATE UNIQUE INDEX "message_portableId_key" ON "message"("portableId");
CREATE UNIQUE INDEX "noteHistory_portableId_key" ON "noteHistory"("portableId");
CREATE UNIQUE INDEX "aiScheduledTask_portableId_key" ON "aiScheduledTask"("portableId");
