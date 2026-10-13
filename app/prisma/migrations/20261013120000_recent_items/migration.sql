CREATE TYPE "RecentEntityType" AS ENUM ('ACCOUNT', 'CONTACT', 'OPPORTUNITY', 'PROJECT', 'SUPPORT_CASE', 'PRICE_EXCEPTION', 'TASK', 'ACTIVITY');
CREATE TABLE "RecentItem" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "entityType" "RecentEntityType" NOT NULL,
  "recordId" INTEGER NOT NULL CHECK ("recordId" > 0),
  "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecentItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecentItem_userId_entityType_recordId_key" ON "RecentItem"("userId", "entityType", "recordId");
CREATE INDEX "RecentItem_userId_lastViewedAt_id_idx" ON "RecentItem"("userId", "lastViewedAt" DESC, "id" DESC);
ALTER TABLE "RecentItem" ADD CONSTRAINT "RecentItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
