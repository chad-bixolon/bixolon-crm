-- Existing and newly created users default to Eastern until they save a personal choice.
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/New_York';
