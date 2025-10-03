-- AlterTable
ALTER TABLE "public"."Contractor" ADD COLUMN     "emailBounceReason" TEXT,
ADD COLUMN     "emailBounced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailBouncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Lead" ADD COLUMN     "customerEmailBounced" BOOLEAN NOT NULL DEFAULT false;
