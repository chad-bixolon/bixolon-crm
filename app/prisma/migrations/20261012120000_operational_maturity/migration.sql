ALTER TABLE "Notification" ADD COLUMN "snoozedUntil" TIMESTAMP(3);
CREATE INDEX "Notification_userId_snoozedUntil_idx" ON "Notification"("userId", "snoozedUntil");

CREATE TABLE "NotificationPreference" (
  "userId" INTEGER NOT NULL,
  "category" "NotificationEntityType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId", "category")
);
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ScheduledJobRun" (
  "id" SERIAL NOT NULL,
  "jobType" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "processedCount" INTEGER,
  "createdCount" INTEGER,
  "resolvedCount" INTEGER,
  "resultSummary" TEXT,
  "errorSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduledJobRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScheduledJobRun_jobType_startedAt_idx" ON "ScheduledJobRun"("jobType", "startedAt" DESC);
