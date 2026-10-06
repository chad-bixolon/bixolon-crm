CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "NotificationEntityType" AS ENUM ('PRICE_EXCEPTION', 'OPPORTUNITY', 'TASK', 'DEMO', 'PROJECT', 'TRADE_SHOW', 'CAMPAIGN');

CREATE TABLE "Notification" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "severity" "NotificationSeverity" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entityType" "NotificationEntityType" NOT NULL,
  "entityId" INTEGER NOT NULL,
  "actionUrl" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_sourceKey_key" ON "Notification"("sourceKey");
CREATE INDEX "Notification_userId_dismissedAt_resolvedAt_createdAt_idx" ON "Notification"("userId", "dismissedAt", "resolvedAt", "createdAt");
CREATE INDEX "Notification_userId_readAt_dismissedAt_resolvedAt_idx" ON "Notification"("userId", "readAt", "dismissedAt", "resolvedAt");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_entityType_entityId_idx" ON "Notification"("entityType", "entityId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
