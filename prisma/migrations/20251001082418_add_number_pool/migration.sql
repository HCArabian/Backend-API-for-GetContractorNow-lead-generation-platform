-- CreateTable
CREATE TABLE "public"."TwilioNumberPool" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "currentLeadId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwilioNumberPool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwilioNumberPool_phoneNumber_key" ON "public"."TwilioNumberPool"("phoneNumber");

-- CreateIndex
CREATE INDEX "TwilioNumberPool_status_idx" ON "public"."TwilioNumberPool"("status");

-- CreateIndex
CREATE INDEX "TwilioNumberPool_phoneNumber_idx" ON "public"."TwilioNumberPool"("phoneNumber");

-- CreateIndex
CREATE INDEX "TwilioNumberPool_expiresAt_idx" ON "public"."TwilioNumberPool"("expiresAt");
