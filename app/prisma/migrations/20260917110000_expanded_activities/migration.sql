-- CreateEnum
CREATE TYPE "ActivityDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'NA');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "direction" "ActivityDirection" NOT NULL DEFAULT 'NA',
ADD COLUMN     "followUpDate" TIMESTAMP(3),
ADD COLUMN     "nextStep" TEXT,
ADD COLUMN     "outcome" TEXT;

-- CreateTable
CREATE TABLE "ActivityContact" (
    "activityId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityContact_pkey" PRIMARY KEY ("activityId","contactId")
);

-- CreateIndex
CREATE INDEX "ActivityContact_contactId_activityId_idx" ON "ActivityContact"("contactId", "activityId");

-- AddForeignKey
ALTER TABLE "ActivityContact" ADD CONSTRAINT "ActivityContact_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityContact" ADD CONSTRAINT "ActivityContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
