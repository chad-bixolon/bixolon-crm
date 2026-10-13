CREATE TABLE "SavedView" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "routeKey" VARCHAR(40) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "queryState" JSONB NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavedView_userId_routeKey_name_key" ON "SavedView"("userId", "routeKey", "name");
CREATE INDEX "SavedView_userId_routeKey_idx" ON "SavedView"("userId", "routeKey");
CREATE UNIQUE INDEX "SavedView_one_default_per_route" ON "SavedView"("userId", "routeKey") WHERE "isDefault" = true;
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
