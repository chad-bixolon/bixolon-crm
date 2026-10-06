CREATE TABLE "PriceExceptionLifecycleEvent" (
  "id" SERIAL NOT NULL,
  "priceExceptionId" INTEGER NOT NULL,
  "oldStatus" "PriceExceptionStatus" NOT NULL,
  "newStatus" "PriceExceptionStatus" NOT NULL,
  "actorId" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceExceptionLifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PriceExceptionLifecycleEvent_priceExceptionId_createdAt_idx" ON "PriceExceptionLifecycleEvent"("priceExceptionId", "createdAt");
ALTER TABLE "PriceExceptionLifecycleEvent" ADD CONSTRAINT "PriceExceptionLifecycleEvent_priceExceptionId_fkey" FOREIGN KEY ("priceExceptionId") REFERENCES "PriceException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionLifecycleEvent" ADD CONSTRAINT "PriceExceptionLifecycleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
