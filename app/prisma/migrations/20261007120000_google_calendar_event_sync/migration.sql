ALTER TABLE "GoogleCalendarConnection"
  ADD COLUMN "primaryCalendarId" TEXT NOT NULL DEFAULT 'primary',
  ADD COLUMN "syncToken" TEXT,
  ADD COLUMN "lastSuccessfulSyncAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncStartedAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncCompletedAt" TIMESTAMP(3),
  ADD COLUMN "syncLeaseUntil" TIMESTAMP(3);

CREATE TABLE "GoogleCalendarEvent" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "connectionId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "googleCalendarId" TEXT NOT NULL,
  "googleEventId" TEXT NOT NULL,
  "googleICalUid" TEXT,
  "status" TEXT NOT NULL,
  "summary" TEXT,
  "location" TEXT,
  "htmlLink" TEXT,
  "hangoutLink" TEXT,
  "organizerEmail" TEXT,
  "organizerDisplayName" TEXT,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "startTimeZone" TEXT,
  "endTimeZone" TEXT,
  "allDay" BOOLEAN NOT NULL DEFAULT false,
  "startDate" TEXT,
  "endDate" TEXT,
  "googleCreatedAt" TIMESTAMP(3),
  "googleUpdatedAt" TIMESTAMP(3),
  "recurringEventId" TEXT,
  "originalStartTime" TEXT,
  "visibility" TEXT,
  "transparency" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleCalendarEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleCalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoogleCalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleCalendarEvent_connectionId_googleCalendarId_googleEventId_key" ON "GoogleCalendarEvent"("connectionId", "googleCalendarId", "googleEventId");
CREATE INDEX "GoogleCalendarEvent_userId_startAt_idx" ON "GoogleCalendarEvent"("userId", "startAt");
CREATE INDEX "GoogleCalendarEvent_userId_startDate_idx" ON "GoogleCalendarEvent"("userId", "startDate");
CREATE INDEX "GoogleCalendarEvent_connectionId_status_idx" ON "GoogleCalendarEvent"("connectionId", "status");

CREATE TABLE "GoogleCalendarAttendee" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "eventId" INTEGER NOT NULL,
  "email" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "displayName" TEXT,
  "responseStatus" TEXT,
  "organizer" BOOLEAN NOT NULL DEFAULT false,
  "self" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "GoogleCalendarAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "GoogleCalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleCalendarAttendee_eventId_normalizedEmail_key" ON "GoogleCalendarAttendee"("eventId", "normalizedEmail");
CREATE INDEX "GoogleCalendarAttendee_normalizedEmail_idx" ON "GoogleCalendarAttendee"("normalizedEmail");
