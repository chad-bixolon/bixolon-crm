CREATE TYPE "CalendarConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_REAUTH');

CREATE TABLE "GoogleCalendarConnection" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "googleAccountId" TEXT NOT NULL,
  "googleEmail" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT NOT NULL,
  "grantedScopes" TEXT NOT NULL,
  "connectionStatus" "CalendarConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
  "lastConnectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleCalendarConnection_userId_key" ON "GoogleCalendarConnection"("userId");
CREATE UNIQUE INDEX "GoogleCalendarConnection_googleAccountId_key" ON "GoogleCalendarConnection"("googleAccountId");
ALTER TABLE "GoogleCalendarConnection" ADD CONSTRAINT "GoogleCalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
