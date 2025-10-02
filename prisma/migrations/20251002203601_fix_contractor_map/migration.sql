/*
  Warnings:

  - A unique constraint covering the columns `[leadId,contractorId]` on the table `BillingRecord` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Contractor" ADD COLUMN     "requirePasswordChange" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "BillingRecord_leadId_contractorId_key" ON "public"."BillingRecord"("leadId", "contractorId");
