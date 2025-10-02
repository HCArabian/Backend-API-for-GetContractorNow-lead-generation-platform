/*
  Warnings:

  - You are about to drop the column `channel` on the `NotificationLog` table. All the data in the column will be lost.
  - You are about to drop the column `contractorId` on the `NotificationLog` table. All the data in the column will be lost.
  - You are about to drop the column `deliveredAt` on the `NotificationLog` table. All the data in the column will be lost.
  - You are about to drop the column `errorMessage` on the `NotificationLog` table. All the data in the column will be lost.
  - You are about to drop the column `leadId` on the `NotificationLog` table. All the data in the column will be lost.
  - You are about to drop the column `recipientEmail` on the `NotificationLog` table. All the data in the column will be lost.
  - You are about to drop the column `recipientPhone` on the `NotificationLog` table. All the data in the column will be lost.
  - Added the required column `recipient` to the `NotificationLog` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."NotificationLog_contractorId_idx";

-- DropIndex
DROP INDEX "public"."NotificationLog_leadId_idx";

-- AlterTable
ALTER TABLE "public"."NotificationLog" DROP COLUMN "channel",
DROP COLUMN "contractorId",
DROP COLUMN "deliveredAt",
DROP COLUMN "errorMessage",
DROP COLUMN "leadId",
DROP COLUMN "recipientEmail",
DROP COLUMN "recipientPhone",
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "recipient" TEXT NOT NULL,
ALTER COLUMN "body" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "NotificationLog_status_idx" ON "public"."NotificationLog"("status");
