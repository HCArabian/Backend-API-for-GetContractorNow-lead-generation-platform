/*
  Warnings:

  - You are about to drop the column `responseTime` on the `LeadAssignment` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."LeadAssignment_assignedAt_idx";

-- DropIndex
DROP INDEX "public"."LeadAssignment_responseDeadline_idx";

-- AlterTable
ALTER TABLE "public"."LeadAssignment" DROP COLUMN "responseTime",
ADD COLUMN     "trackingNumber" TEXT;

-- CreateIndex
CREATE INDEX "LeadAssignment_trackingNumber_idx" ON "public"."LeadAssignment"("trackingNumber");
