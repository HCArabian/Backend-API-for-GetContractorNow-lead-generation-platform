-- CreateTable
CREATE TABLE "public"."Lead" (
    "id" TEXT NOT NULL,
    "customerFirstName" TEXT NOT NULL,
    "customerLastName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT NOT NULL,
    "customerCity" TEXT NOT NULL,
    "customerState" TEXT NOT NULL,
    "customerZip" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "serviceDescription" TEXT,
    "timeline" TEXT NOT NULL,
    "budgetRange" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "propertyAge" TEXT,
    "existingSystem" TEXT,
    "systemIssue" TEXT,
    "preferredContactTime" TEXT,
    "preferredContactMethod" TEXT DEFAULT 'phone',
    "referralSource" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "formCompletionTime" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceFingerprint" TEXT,
    "score" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "qualityFlags" JSONB,
    "confidenceLevel" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending_assignment',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "firstContactAt" TIMESTAMP(3),
    "outcomeConfirmedAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Contractor" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "ownerName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "businessAddress" TEXT,
    "businessCity" TEXT,
    "businessState" TEXT,
    "businessZip" TEXT,
    "licenseNumber" TEXT,
    "insuranceCertificate" TEXT,
    "yearsInBusiness" INTEGER,
    "serviceZipCodes" TEXT[],
    "specializations" TEXT[],
    "maxTravelDistance" INTEGER,
    "maxLeadsPerDay" INTEGER NOT NULL DEFAULT 5,
    "maxLeadsPerWeek" INTEGER NOT NULL DEFAULT 20,
    "currentLeadCount" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTime" INTEGER,
    "conversionRate" DOUBLE PRECISION,
    "customerRating" DOUBLE PRECISION,
    "totalReviews" INTEGER NOT NULL DEFAULT 0,
    "totalLeadsReceived" INTEGER NOT NULL DEFAULT 0,
    "totalJobsCompleted" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isAcceptingLeads" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "suspensionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseDeadline" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "responseTime" INTEGER,

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BillingRecord" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "amountOwed" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "invoiceNumber" TEXT,
    "dateIncurred" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoicedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "BillingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TrackingNumber" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "twilioNumber" TEXT NOT NULL,
    "twilioSid" TEXT,
    "customerNumber" TEXT NOT NULL,
    "contractorNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "TrackingNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CallLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "callSid" TEXT NOT NULL,
    "callDirection" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "callStartedAt" TIMESTAMP(3) NOT NULL,
    "callEndedAt" TIMESTAMP(3),
    "callDuration" INTEGER,
    "callStatus" TEXT NOT NULL,
    "recordingUrl" TEXT,
    "recordingSid" TEXT,
    "transcript" TEXT,
    "sentiment" TEXT,
    "keywordsDetected" TEXT[],

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SMSLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "messageSid" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "messageBody" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "SMSLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Dispute" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "evidence" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolution" TEXT,
    "resolutionNotes" TEXT,
    "creditAmount" DOUBLE PRECISION,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerFeedback" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "contractorCalled" BOOLEAN,
    "contactMethod" TEXT,
    "outcome" TEXT,
    "jobValue" DOUBLE PRECISION,
    "outcomeNotes" TEXT,
    "rating" INTEGER,
    "feedbackText" TEXT,
    "wouldRecommend" BOOLEAN,
    "professionalismRating" INTEGER,
    "qualityRating" INTEGER,
    "valueRating" INTEGER,
    "timelinessRating" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotificationLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "contractorId" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_customerEmail_idx" ON "public"."Lead"("customerEmail");

-- CreateIndex
CREATE INDEX "Lead_customerPhone_idx" ON "public"."Lead"("customerPhone");

-- CreateIndex
CREATE INDEX "Lead_customerZip_idx" ON "public"."Lead"("customerZip");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "public"."Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_category_idx" ON "public"."Lead"("category");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "public"."Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_referralSource_idx" ON "public"."Lead"("referralSource");

-- CreateIndex
CREATE INDEX "Lead_ipAddress_idx" ON "public"."Lead"("ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_email_key" ON "public"."Contractor"("email");

-- CreateIndex
CREATE INDEX "Contractor_status_idx" ON "public"."Contractor"("status");

-- CreateIndex
CREATE INDEX "Contractor_isAcceptingLeads_idx" ON "public"."Contractor"("isAcceptingLeads");

-- CreateIndex
CREATE INDEX "Contractor_businessZip_idx" ON "public"."Contractor"("businessZip");

-- CreateIndex
CREATE INDEX "Contractor_customerRating_idx" ON "public"."Contractor"("customerRating");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAssignment_leadId_key" ON "public"."LeadAssignment"("leadId");

-- CreateIndex
CREATE INDEX "LeadAssignment_contractorId_idx" ON "public"."LeadAssignment"("contractorId");

-- CreateIndex
CREATE INDEX "LeadAssignment_status_idx" ON "public"."LeadAssignment"("status");

-- CreateIndex
CREATE INDEX "LeadAssignment_responseDeadline_idx" ON "public"."LeadAssignment"("responseDeadline");

-- CreateIndex
CREATE INDEX "BillingRecord_contractorId_idx" ON "public"."BillingRecord"("contractorId");

-- CreateIndex
CREATE INDEX "BillingRecord_status_idx" ON "public"."BillingRecord"("status");

-- CreateIndex
CREATE INDEX "BillingRecord_dateIncurred_idx" ON "public"."BillingRecord"("dateIncurred");

-- CreateIndex
CREATE INDEX "BillingRecord_invoicedAt_idx" ON "public"."BillingRecord"("invoicedAt");

-- CreateIndex
CREATE INDEX "TrackingNumber_leadId_idx" ON "public"."TrackingNumber"("leadId");

-- CreateIndex
CREATE INDEX "TrackingNumber_twilioNumber_idx" ON "public"."TrackingNumber"("twilioNumber");

-- CreateIndex
CREATE INDEX "TrackingNumber_status_idx" ON "public"."TrackingNumber"("status");

-- CreateIndex
CREATE INDEX "TrackingNumber_expiresAt_idx" ON "public"."TrackingNumber"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_callSid_key" ON "public"."CallLog"("callSid");

-- CreateIndex
CREATE INDEX "CallLog_leadId_idx" ON "public"."CallLog"("leadId");

-- CreateIndex
CREATE INDEX "CallLog_contractorId_idx" ON "public"."CallLog"("contractorId");

-- CreateIndex
CREATE INDEX "CallLog_callSid_idx" ON "public"."CallLog"("callSid");

-- CreateIndex
CREATE INDEX "CallLog_callStartedAt_idx" ON "public"."CallLog"("callStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SMSLog_messageSid_key" ON "public"."SMSLog"("messageSid");

-- CreateIndex
CREATE INDEX "SMSLog_leadId_idx" ON "public"."SMSLog"("leadId");

-- CreateIndex
CREATE INDEX "SMSLog_contractorId_idx" ON "public"."SMSLog"("contractorId");

-- CreateIndex
CREATE INDEX "SMSLog_messageSid_idx" ON "public"."SMSLog"("messageSid");

-- CreateIndex
CREATE INDEX "Dispute_contractorId_idx" ON "public"."Dispute"("contractorId");

-- CreateIndex
CREATE INDEX "Dispute_leadId_idx" ON "public"."Dispute"("leadId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "public"."Dispute"("status");

-- CreateIndex
CREATE INDEX "Dispute_submittedAt_idx" ON "public"."Dispute"("submittedAt");

-- CreateIndex
CREATE INDEX "CustomerFeedback_leadId_idx" ON "public"."CustomerFeedback"("leadId");

-- CreateIndex
CREATE INDEX "CustomerFeedback_contractorId_idx" ON "public"."CustomerFeedback"("contractorId");

-- CreateIndex
CREATE INDEX "CustomerFeedback_rating_idx" ON "public"."CustomerFeedback"("rating");

-- CreateIndex
CREATE INDEX "CustomerFeedback_outcome_idx" ON "public"."CustomerFeedback"("outcome");

-- CreateIndex
CREATE INDEX "NotificationLog_leadId_idx" ON "public"."NotificationLog"("leadId");

-- CreateIndex
CREATE INDEX "NotificationLog_contractorId_idx" ON "public"."NotificationLog"("contractorId");

-- CreateIndex
CREATE INDEX "NotificationLog_sentAt_idx" ON "public"."NotificationLog"("sentAt");

-- CreateIndex
CREATE INDEX "NotificationLog_type_idx" ON "public"."NotificationLog"("type");

-- AddForeignKey
ALTER TABLE "public"."LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeadAssignment" ADD CONSTRAINT "LeadAssignment_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "public"."Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingRecord" ADD CONSTRAINT "BillingRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingRecord" ADD CONSTRAINT "BillingRecord_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "public"."Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CallLog" ADD CONSTRAINT "CallLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CallLog" ADD CONSTRAINT "CallLog_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "public"."Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SMSLog" ADD CONSTRAINT "SMSLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SMSLog" ADD CONSTRAINT "SMSLog_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "public"."Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Dispute" ADD CONSTRAINT "Dispute_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "public"."Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "public"."Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
