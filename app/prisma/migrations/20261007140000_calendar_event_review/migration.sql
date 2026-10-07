CREATE TABLE "GoogleCalendarEventReview" (
  "eventId" INTEGER NOT NULL,
  "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
  "explanations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "suggestedContactIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "suggestedAccountId" INTEGER,
  "suggestedOpportunityId" INTEGER,
  "suggestedProjectId" INTEGER,
  "selectedContactIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "selectedAccountId" INTEGER,
  "selectedOpportunityId" INTEGER,
  "selectedProjectId" INTEGER,
  "selectionsConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "ignoredAt" TIMESTAMP(3),
  "ignoredById" INTEGER,
  "activityId" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleCalendarEventReview_pkey" PRIMARY KEY ("eventId")
);
CREATE UNIQUE INDEX "GoogleCalendarEventReview_activityId_key" ON "GoogleCalendarEventReview"("activityId");
CREATE INDEX "GoogleCalendarEventReview_matchStatus_ignoredAt_activityId_idx" ON "GoogleCalendarEventReview"("matchStatus", "ignoredAt", "activityId");
ALTER TABLE "GoogleCalendarEventReview" ADD CONSTRAINT "GoogleCalendarEventReview_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "GoogleCalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleCalendarEventReview" ADD CONSTRAINT "GoogleCalendarEventReview_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoogleCalendarEventReview" ADD CONSTRAINT "GoogleCalendarEventReview_ignoredById_fkey" FOREIGN KEY ("ignoredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoogleCalendarEventReview" ADD CONSTRAINT "GoogleCalendarEventReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
