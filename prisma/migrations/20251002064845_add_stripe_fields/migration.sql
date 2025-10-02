-- AlterTable
ALTER TABLE "public"."BillingRecord" ADD COLUMN     "stripePaymentId" TEXT;

-- AlterTable
ALTER TABLE "public"."Contractor" ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripePaymentMethodId" TEXT;
