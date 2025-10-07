const Sentry = require("@sentry/node");

// Initialize Sentry FIRST
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "production",
  tracesSampleRate: 1.0,
});

require("dotenv").config();
const jwt = require("jsonwebtoken");
const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { calculateLeadScore } = require("./scoring");
const { assignContractor } = require("./assignment");
const { createSetupIntent, savePaymentMethod } = require("./stripe-payments");
const cookieParser = require("cookie-parser");
const { sendFeedbackRequestEmail } = require("./notifications");
const crypto = require("crypto");
const { sendContractorOnboardingEmail } = require("./notifications");
const twilio = require("twilio");
const { hashPassword, comparePassword, generateToken } = require("./auth");
const { handleSubscriptionCreated } = require("./webhook-handler");

const app = express();

// Trust Railway proxy
app.set("trust proxy", 1);

const path = require("path");

// ============================================
// CRITICAL: STRIPE WEBHOOK MUST BE FIRST
// BEFORE ANY MIDDLEWARE THAT PARSES BODY
// ============================================
// ============================================
// STRIPE SUBSCRIPTION WEBHOOK
// ============================================

app.post(
  "/api/webhooks/stripe/subscription",
  express.json(),
  async (req, res) => {
    console.log("📬 Webhook received");
    console.log("Event type:", req.body?.type);
    
    const event = req.body;

    if (!event || !event.type) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    try {
      if (event.type === "customer.subscription.created") {
        await handleSubscriptionCreated(event.data.object);
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);


// ============================================
// NOW ADD ALL OTHER MIDDLEWARE
// ============================================

// Sentry breadcrumb tracking
app.use((req, res, next) => {
  Sentry.addBreadcrumb({
    message: req.url,
    category: "request",
    level: "info",
  });
  next();
});

// CORS - Allow requests from your Webflow site
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

// Body parsers (AFTER webhook)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Sentry request context
app.use((req, res, next) => {
  if (req.headers.authorization) {
    Sentry.setUser({ auth: "admin" });
  }
  Sentry.setContext("request", {
    method: req.method,
    url: req.url,
    ip: req.ip,
  });
  next();
});

// ============================================
// ROUTES
// ============================================

// Contractor portal routes
app.get("/contractor", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "contractor-portal-v2.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "contractor-portal-v2.html"));
});

app.get("/api/debug/check-env", (req, res) => {
  res.json({
    hasAdminPassword: !!process.env.ADMIN_PASSWORD,
    adminPasswordLength: process.env.ADMIN_PASSWORD?.length || 0,
    hasJwtSecret: !!process.env.JWT_SECRET,
    jwtSecretLength: process.env.JWT_SECRET?.length || 0,
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,  // ✅ ADDED
    webhookSecretLength: process.env.STRIPE_WEBHOOK_SECRET?.length || 0,  // ✅ ADDED
    hasStripeKey: !!process.env.STRIPE_SECRET_KEY_TEST,  // ✅ BONUS CHECK
  });
});

// Middleware to authenticate contractor requests
const authenticateContractor = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const contractor = await prisma.contractor.findUnique({
      where: { id: decoded.contractorId },
    });

    if (!contractor) {
      return res.status(401).json({ error: "Contractor not found" });
    }

    if (contractor.status !== "active") {
      return res
        .status(403)
        .json({ error: "Contractor account is not active" });
    }

    req.contractor = contractor;
    next();
  } catch (error) {
    console.error("Auth error:", error);

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }

    return res.status(500).json({ error: "Authentication failed" });
  }
};

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Increased for testing
  message: { error: "Too many login attempts, please try again later." },
});

// Apply rate limiting
app.use("/api/leads/", apiLimiter);
app.use("/api/contractor/login", authLimiter);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "GetContractorNow API is running",
    timestamp: new Date().toISOString(),
  });
});

// Lead submission endpoint
app.post("/api/leads/submit", async (req, res) => {
  try {
    const leadData = req.body;
    console.log("Received lead submission:", {
      email: leadData.email,
      phone: leadData.phone,
      service: leadData.service_type,
    });

    // Run advanced scoring algorithm
    const scoringResult = await calculateLeadScore(leadData, prisma);

    console.log("Scoring result:", scoringResult);

    // If lead is rejected, return error with specific reasons
    if (scoringResult.status === "rejected") {
      console.log("Lead rejected:", scoringResult.rejectReasons);

      return res.status(400).json({
        success: false,
        error: "Lead validation failed",
        validationErrors: scoringResult.validationErrors,
        message: scoringResult.validationErrors.join(". "),
      });
    }

    // Lead approved - save to database
    const savedLead = await prisma.lead.create({
      data: {
        // Customer Info
        customerFirstName: leadData.first_name,
        customerLastName: leadData.last_name,
        customerEmail: leadData.email.toLowerCase().trim(),
        customerPhone: leadData.phone.replace(/\D/g, ""), // Store digits only
        customerAddress: leadData.address,
        customerCity: leadData.city,
        customerState: leadData.state,
        customerZip: leadData.zip,

        // Service Details
        serviceType: leadData.service_type,
        serviceDescription: leadData.service_description || null,
        timeline: leadData.timeline,
        budgetRange: leadData.budget_range,
        propertyType: leadData.property_type,
        propertyAge: leadData.property_age || null,
        existingSystem: leadData.existing_system || null,
        systemIssue: leadData.system_issue || null,

        // Contact Preferences
        preferredContactTime: leadData.preferred_contact_time || null,
        preferredContactMethod: leadData.preferred_contact_method || "phone",

        // Marketing Tracking
        referralSource: leadData.referral_source || null,
        utmSource: leadData.utm_source || null,
        utmMedium: leadData.utm_medium || null,
        utmCampaign: leadData.utm_campaign || null,

        // Form Metadata
        formCompletionTime: leadData.form_completion_time || null,
        ipAddress: leadData.ip_address || null,
        userAgent: leadData.user_agent || null,

        // Scoring Results
        score: scoringResult.score,
        category: scoringResult.category,
        price: scoringResult.price,
        confidenceLevel: scoringResult.confidenceLevel,
        qualityFlags: scoringResult.qualityFlags,

        // Status
        status: "pending_assignment",
      },
    });

    console.log("✅ Lead saved successfully:", {
      id: savedLead.id,
      category: savedLead.category,
      score: savedLead.score,
      price: savedLead.price,
    });

    // ============================================
    // NEW: AUTOMATICALLY ASSIGN CONTRACTOR
    // ============================================

    console.log("\n🔄 Starting contractor assignment...");

    const assignmentResult = await assignContractor(savedLead);

    if (assignmentResult && assignmentResult.contractor) {
      console.log(
        "✅ Lead assigned to contractor:",
        assignmentResult.contractor.businessName
      );

      return res.json({
        success: true,
        message: "Lead received, approved, and assigned to contractor",
        leadId: savedLead.id,
        category: savedLead.category,
        score: savedLead.score,
      });
    } else {
      console.log("⚠️ Lead saved but not assigned");

      return res.json({
        success: true,
        message: "Lead received and approved, but no contractors available",
        leadId: savedLead.id,
        category: savedLead.category,
        score: savedLead.score,
      });
    }
  } catch (error) {
    console.error("❌ Error processing lead:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "Something went wrong processing your request",
    });
  }
});

// ============================================
// TWILIO WEBHOOK - NUMBER-BASED ROUTING
// ============================================
// Twilio webhook with signature verification
app.post("/api/webhooks/twilio/call-status", async (req, res) => {
  try {
    // Verify the request came from Twilio
    const twilioSignature = req.headers["x-twilio-signature"];
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

    const isValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      twilioSignature,
      url,
      req.body
    );

    if (!isValid) {
      await logSecurityEvent("invalid_twilio_signature", {
        ip: req.ip,
        url: url,
        timestamp: new Date(),
      });
      console.error("Invalid Twilio signature - possible fraud attempt");
      return res.status(403).json({ error: "Invalid signature" });
    }

    // Extract Twilio data
    const {
      CallSid: callSid,
      CallStatus: callStatus,
      CallDuration: callDuration,
      From: from,
      To: to,
      Direction: direction,
      RecordingUrl: recordingUrl,
      RecordingSid: recordingSid,
    } = req.body;

    console.log("📞 TWILIO WEBHOOK (verified):", {
      callSid,
      callStatus,
      from,
      to: to,
      direction,
    });

    // ============================================
    // HANDLE INCOMING CALLS - ROUTE BY NUMBER
    // ============================================

    if (
      !callStatus ||
      callStatus === "ringing" ||
      callStatus === "in-progress"
    ) {
      console.log("📞 Incoming call to:", to);

      // Find which lead this tracking number belongs to
      const assignment = await prisma.leadAssignment.findFirst({
        where: {
          trackingNumber: to,
        },
        include: {
          lead: true,
          contractor: true,
        },
      });

      if (!assignment) {
        console.error("❌ No assignment found for tracking number:", to);
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This tracking number is not currently assigned. Please contact support.</Say>
  <Hangup/>
</Response>`;
        return res.type("text/xml").send(twiml);
      }

      // Verify the caller is the assigned contractor
      const normalizedFrom = from.replace(/\D/g, "").slice(-10);
      const normalizedContractorPhone = assignment.contractor.phone
        .replace(/\D/g, "")
        .slice(-10);

      if (normalizedFrom !== normalizedContractorPhone) {
        console.error("❌ Unauthorized caller for this tracking number");
        console.error(
          `   Expected: ${normalizedContractorPhone}, Got: ${normalizedFrom}`
        );
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This number is assigned to a different contractor.</Say>
  <Hangup/>
</Response>`;
        return res.type("text/xml").send(twiml);
      }

      const customerPhone = assignment.lead.customerPhone;
      console.log("✅ Routing call to customer:", customerPhone);

      // Forward call and record
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting your call, please wait.</Say>
  <Dial record="record-from-answer" recordingStatusCallback="${process.env.RAILWAY_URL}/api/webhooks/twilio/call-status">
    ${customerPhone}
  </Dial>
</Response>`;

      return res.type("text/xml").send(twiml);
    }

    // ============================================
    // HANDLE STATUS CALLBACKS (for billing)
    // ============================================

    if (!callSid) {
      return res.status(400).json({ error: "Missing CallSid" });
    }

    // Find assignment by tracking number
    const assignment = await prisma.leadAssignment.findFirst({
      where: {
        trackingNumber: to,
      },
      include: {
        lead: true,
        contractor: true,
      },
    });

    if (!assignment) {
      console.error("❌ No assignment found for billing");
      return res.json({ success: true, message: "No assignment found" });
    }

    const lead = assignment.lead;
    const contractor = assignment.contractor;

    console.log("✅ Processing call for lead:", lead.id);

    // Create or update CallLog
    const callLog = await prisma.callLog.upsert({
      where: {
        callSid: callSid,
      },
      update: {
        callStatus: callStatus,
        callEndedAt: callStatus === "completed" ? new Date() : null,
        callDuration: callDuration ? parseInt(callDuration) : null,
        recordingUrl: recordingUrl || null,
        recordingSid: recordingSid || null,
      },
      create: {
        callSid: callSid,
        leadId: lead.id,
        contractorId: contractor.id,
        callDirection: "contractor_to_customer",
        trackingNumber: to,
        callStartedAt: new Date(),
        callEndedAt: callStatus === "completed" ? new Date() : null,
        callDuration: callDuration ? parseInt(callDuration) : null,
        callStatus: callStatus,
        recordingUrl: recordingUrl || null,
        recordingSid: recordingSid || null,
      },
    });

    console.log("✅ CallLog:", callLog.id, "Duration:", callDuration);

    // ============================================
    // STEP 3: NEW BILLING LOGIC - CREDIT DEDUCTION
    // ============================================

    // Only bill for qualified calls (30+ seconds, completed)
    if (
      callStatus === "completed" &&
      callDuration &&
      parseInt(callDuration) >= 30
    ) {
      console.log("✅ Qualified call detected (30+ seconds)");

      // Get full contractor details with subscription info
      const fullContractor = await prisma.contractor.findUnique({
        where: { id: contractor.id },
      });

      if (!fullContractor) {
        console.error("❌ Contractor not found");
        return res.status(404).json({ error: "Contractor not found" });
      }

      // Check if already billed for this call
      const existingBilling = await prisma.billingRecord.findFirst({
        where: {
          leadId: lead.id,
          contractorId: contractor.id,
        },
      });

      if (existingBilling) {
        console.log("⚠️ Already billed for this lead, skipping");
        return res.json({
          success: true,
          message: "Call logged (already billed)",
          callLogId: callLog.id,
        });
      }

      // SECURITY CHECK 1: Active subscription required
      if (fullContractor.subscriptionStatus !== "active") {
        console.log("❌ No active subscription - cannot charge");
        console.log(
          "   Subscription status:",
          fullContractor.subscriptionStatus
        );

        return res.json({
          success: true,
          message: "Call logged but not charged (no active subscription)",
          callLogId: callLog.id,
        });
      }

      // Get lead cost for this contractor (tier-based pricing)
      const leadCost = getLeadCostForContractor(fullContractor);
      console.log(
        `💰 Lead cost for ${
          fullContractor.subscriptionTier || "no tier"
        } tier: ${formatCurrency(leadCost)}`
      );

      // SECURITY CHECK 2: Sufficient credit balance
      if (fullContractor.creditBalance < leadCost) {
        console.log(
          `⚠️ Insufficient credit: Balance ${formatCurrency(
            fullContractor.creditBalance
          )}, Need ${formatCurrency(leadCost)}`
        );

        // Disable lead acceptance
        await prisma.contractor.update({
          where: { id: fullContractor.id },
          data: { isAcceptingLeads: false },
        });

        console.log("🚫 Contractor disabled due to low credit");

        // TODO: Send low credit warning email to contractor

        return res.json({
          success: true,
          message: "Call logged but not charged (insufficient credit)",
          callLogId: callLog.id,
        });
      }

      // Calculate new balance
      const newBalance = fullContractor.creditBalance - leadCost;
      console.log(
        `📊 Balance calculation: ${formatCurrency(
          fullContractor.creditBalance
        )} - ${formatCurrency(leadCost)} = ${formatCurrency(newBalance)}`
      );

      // DEDUCT FROM CREDIT BALANCE (Database Transaction)
      try {
        await prisma.$transaction([
          // 1. Create credit transaction record
          prisma.creditTransaction.create({
            data: {
              contractorId: fullContractor.id,
              type: "deduction",
              amount: -leadCost,
              balanceBefore: fullContractor.creditBalance,
              balanceAfter: newBalance,
              leadId: lead.id,
              description: `Lead charge: ${lead.customerFirstName} ${lead.customerLastName} - ${lead.serviceType}`,
            },
          }),

          // 2. Update contractor balance
          prisma.contractor.update({
            where: { id: fullContractor.id },
            data: {
              creditBalance: newBalance,
              // If balance drops below minimum, stop accepting leads
              isAcceptingLeads: newBalance >= getMinimumCreditBalance(),
            },
          }),

          // 3. Create billing record
          prisma.billingRecord.create({
            data: {
              leadId: lead.id,
              contractorId: fullContractor.id,
              amountOwed: leadCost,
              status: "paid", // Already paid from credit
              dateIncurred: new Date(),
              notes: `Paid from credit balance. Previous: ${formatCurrency(
                fullContractor.creditBalance
              )}, New: ${formatCurrency(newBalance)}`,
            },
          }),

          // 4. Update lead status
          prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: "contacted",
              firstContactAt: new Date(),
            },
          }),

          // 5. Update lead assignment status
          prisma.leadAssignment.update({
            where: { id: assignment.id },
            data: {
              status: "contacted",
            },
          }),

          // 6. Set tracking number to expire in 48 hours (instead of 7 days)
          prisma.trackingNumber.updateMany({
            where: {
              leadId: lead.id,
              status: "active",
            },
            data: {
              expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours from now
            },
          }),
        ]);

        console.log(
          `✅ CREDIT DEDUCTED: ${formatCurrency(leadCost)} from ${
            fullContractor.businessName
          }`
        );
        console.log(
          `   Previous balance: ${formatCurrency(fullContractor.creditBalance)}`
        );
        console.log(`   New balance: ${formatCurrency(newBalance)}`);

        if (newBalance < getMinimumCreditBalance()) {
          console.log(
            `⚠️ Balance below minimum (${formatCurrency(
              getMinimumCreditBalance()
            )}) - contractor disabled from receiving new leads`
          );
        }

        console.log("📞 Tracking number set to expire in 48 hours");

        return res.json({
          success: true,
          message: "Call logged and lead charged from credit",
          callLogId: callLog.id,
          charged: leadCost,
          newBalance: newBalance,
          subscriptionTier: fullContractor.subscriptionTier,
        });
      } catch (transactionError) {
        console.error("❌ Transaction failed:", transactionError);
        Sentry.captureException(transactionError, {
          tags: {
            webhook: "twilio",
            operation: "credit_deduction",
          },
          extra: {
            contractorId: fullContractor.id,
            leadId: lead.id,
            leadCost: leadCost,
          },
        });

        return res.status(500).json({
          success: false,
          error: "Failed to process credit deduction",
          details: transactionError.message,
        });
      }
    }

    // Call did not qualify for billing (less than 30 seconds or not completed)
    console.log("ℹ️ Call did not qualify for billing");
    console.log(`   Status: ${callStatus}, Duration: ${callDuration}s`);

    return res.json({
      success: true,
      message: "Call logged - no billing",
      callLogId: callLog.id,
      reason: callDuration
        ? `Duration too short (${callDuration}s < 30s)`
        : "No duration recorded",
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { webhook: "twilio" },
      extra: {
        callSid: req.body.CallSid,
        callStatus: req.body.CallStatus,
      },
    });
    console.error("❌ WEBHOOK ERROR:", error);
    return res.status(500).json({
      error: "Webhook processing failed",
      details: error.message,
    });
  }
});

// ============================================
// ADMIN API ENDPOINTS
// ============================================

// Simple auth middleware (we'll improve this later)
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const adminPassword = process.env.ADMIN_PASSWORD || "changeme123"; // Set this in Railway variables

  if (authHeader === `Bearer ${adminPassword}`) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// Get all billing records with filters
app.get("/api/admin/billing", adminAuth, async (req, res) => {
  try {
    const { status, contractorId, startDate, endDate } = req.query;

    const where = {};

    if (status) where.status = status;
    if (contractorId) where.contractorId = contractorId;
    if (startDate || endDate) {
      where.dateIncurred = {};
      if (startDate) where.dateIncurred.gte = new Date(startDate);
      if (endDate) where.dateIncurred.lte = new Date(endDate);
    }

    const billingRecords = await prisma.billingRecord.findMany({
      where,
      include: {
        lead: {
          select: {
            customerFirstName: true,
            customerLastName: true,
            customerPhone: true,
            customerCity: true,
            customerState: true,
            serviceType: true,
          },
        },
        contractor: {
          select: {
            businessName: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: {
        dateIncurred: "desc",
      },
    });

    // Calculate summary stats
    const summary = {
      total: billingRecords.length,
      totalAmount: billingRecords.reduce(
        (sum, record) => sum + record.amountOwed,
        0
      ),
      pending: billingRecords.filter((r) => r.status === "pending").length,
      pendingAmount: billingRecords
        .filter((r) => r.status === "pending")
        .reduce((sum, r) => sum + r.amountOwed, 0),
      invoiced: billingRecords.filter((r) => r.status === "invoiced").length,
      paid: billingRecords.filter((r) => r.status === "paid").length,
      paidAmount: billingRecords
        .filter((r) => r.status === "paid")
        .reduce((sum, r) => sum + r.amountOwed, 0),
    };

    res.json({
      success: true,
      summary,
      records: billingRecords,
    });
  } catch (error) {
    console.error("Error fetching billing records:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// Get single billing record
app.get("/api/admin/billing/:id", adminAuth, async (req, res) => {
  try {
    const billingRecord = await prisma.billingRecord.findUnique({
      where: { id: req.params.id },
      include: {
        lead: true,
        contractor: true,
      },
    });

    if (!billingRecord) {
      return res.status(404).json({ error: "Billing record not found" });
    }

    res.json({ success: true, record: billingRecord });
  } catch (error) {
    console.error("Error fetching billing record:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update billing record status
app.patch("/api/admin/billing/:id", adminAuth, async (req, res) => {
  try {
    const { status, notes } = req.body;

    const data = { status };

    if (status === "invoiced" && !req.body.invoicedAt) {
      data.invoicedAt = new Date();
    } else if (req.body.invoicedAt) {
      data.invoicedAt = new Date(req.body.invoicedAt);
    }

    if (status === "paid" && !req.body.paidAt) {
      data.paidAt = new Date();
    } else if (req.body.paidAt) {
      data.paidAt = new Date(req.body.paidAt);
    }

    if (notes !== undefined) {
      data.notes = notes;
    }

    const updatedRecord = await prisma.billingRecord.update({
      where: { id: req.params.id },
      data,
      include: {
        lead: true,
        contractor: true,
      },
    });

    res.json({ success: true, record: updatedRecord });
  } catch (error) {
    console.error("Error updating billing record:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all contractors (for filter dropdown)
app.get("/api/admin/contractors", adminAuth, async (req, res) => {
  try {
    const contractors = await prisma.contractor.findMany({
      select: {
        id: true,
        businessName: true,
        email: true,
        phone: true,
        status: true,
        isVerified: true,
        isAcceptingLeads: true,
        stripePaymentMethodId: true,
        serviceZipCodes: true,
        totalLeadsReceived: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json({
      success: true,
      contractors,
    });
  } catch (error) {
    console.error("Error fetching contractors:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Suspend/revoke contractor access (admin)
app.post("/api/admin/contractors/:id/suspend", adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: "Suspension reason required" });
    }

    const contractor = await prisma.contractor.findUnique({
      where: { id: req.params.id },
    });

    if (!contractor) {
      return res.status(404).json({ error: "Contractor not found" });
    }

    // Update contractor status
    await prisma.contractor.update({
      where: { id: req.params.id },
      data: {
        status: "suspended",
        isAcceptingLeads: false,
        suspensionReason: reason,
      },
    });

    // Send suspension email
    const { sendContractorSuspensionEmail } = require("./notifications");
    await sendContractorSuspensionEmail(contractor, reason);

    console.log("Contractor suspended:", contractor.businessName);

    res.json({
      success: true,
      message: "Contractor suspended and notification sent",
    });
  } catch (error) {
    console.error("Suspension error:", error);
    res.status(500).json({ error: "Failed to suspend contractor" });
  }
});

// Reactivate contractor (admin)
app.post(
  "/api/admin/contractors/:id/reactivate",
  adminAuth,
  async (req, res) => {
    try {
      const contractor = await prisma.contractor.findUnique({
        where: { id: req.params.id },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }

      // Update contractor status
      await prisma.contractor.update({
        where: { id: req.params.id },
        data: {
          status: "active",
          isAcceptingLeads: true,
          suspensionReason: null,
        },
      });

      // Send reactivation email
      const { sendContractorReactivationEmail } = require("./notifications");
      await sendContractorReactivationEmail(contractor);

      console.log("Contractor reactivated:", contractor.businessName);

      res.json({
        success: true,
        message: "Contractor reactivated and notification sent",
      });
    } catch (error) {
      console.error("Reactivation error:", error);
      res.status(500).json({ error: "Failed to reactivate contractor" });
    }
  }
);

// Dashboard stats
app.get("/api/admin/stats", adminAuth, async (req, res) => {
  try {
    const [
      totalLeads,
      totalContractors,
      totalBillingRecords,
      pendingBilling,
      totalRevenue,
    ] = await Promise.all([
      prisma.lead.count(),
      prisma.contractor.count(),
      prisma.billingRecord.count(),
      prisma.billingRecord.count({ where: { status: "pending" } }),
      prisma.billingRecord.aggregate({
        where: { status: "paid" },
        _sum: { amountOwed: true },
      }),
    ]);

    res.json({
      success: true,
      stats: {
        totalLeads,
        totalContractors,
        totalBillingRecords,
        pendingBilling,
        totalRevenue: totalRevenue._sum.amountOwed || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================
// CONTRACTOR AUTH ENDPOINTS
// ============================================

app.post("/api/contractor/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const contractor = await prisma.contractor.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!contractor) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isValidPassword = await comparePassword(
      password,
      contractor.passwordHash
    );

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (contractor.status !== "active") {
      return res
        .status(403)
        .json({ error: "Account is suspended or inactive" });
    }

    const token = generateToken(contractor.id);

    await prisma.contractor.update({
      where: { id: contractor.id },
      data: { lastActiveAt: new Date() },
    });

    console.log("Contractor logged in:", contractor.businessName);

    res.json({
      success: true,
      token,
      requirePasswordChange: contractor.requirePasswordChange, // Frontend needs this
      contractor: {
        id: contractor.id,
        businessName: contractor.businessName,
        email: contractor.email,
        phone: contractor.phone,
        subscriptionTier: contractor.subscriptionTier,
        subscriptionStatus: contractor.subscriptionStatus,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Get contractor profile
app.get("/api/contractor/profile", authenticateContractor, async (req, res) => {
  try {
    const contractor = await prisma.contractor.findUnique({
      where: { id: req.contractor.id },
      select: {
        id: true,
        businessName: true,
        email: true,
        phone: true,
        serviceZipCodes: true,
        specializations: true,
        avgResponseTime: true,
        conversionRate: true,
        customerRating: true,
        totalReviews: true,
        totalJobsCompleted: true,
        status: true,
        isAcceptingLeads: true,
        createdAt: true,
      },
    });

    if (!contractor) {
      return res.status(404).json({ error: "Contractor not found" });
    }

    // Calculate actual lead count from database
    const actualLeadCount = await prisma.leadAssignment.count({
      where: { contractorId: req.contractor.id },
    });

    res.json({
      success: true,
      contractor: {
        ...contractor,
        totalLeadsReceived: actualLeadCount,
      },
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Get contractor's assigned leads
app.get("/api/contractor/leads", authenticateContractor, async (req, res) => {
  try {
    const { status } = req.query;

    const where = {
      contractorId: req.contractor.id,
    };

    if (status) {
      where.status = status;
    }

    const assignments = await prisma.leadAssignment.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true,
            customerFirstName: true,
            customerLastName: true,
            customerPhone: true,
            customerCity: true,
            customerState: true,
            customerZip: true,
            serviceType: true,
            timeline: true,
            budgetRange: true,
            category: true,
            price: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        assignedAt: "desc",
      },
    });

    res.json({
      success: true,
      leads: assignments,
    });
  } catch (error) {
    console.error("Leads fetch error:", error);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// Get contractor's billing history
app.get("/api/contractor/billing", authenticateContractor, async (req, res) => {
  try {
    const billingRecords = await prisma.billingRecord.findMany({
      where: {
        contractorId: req.contractor.id,
      },
      include: {
        lead: {
          select: {
            customerFirstName: true,
            customerLastName: true,
            serviceType: true,
            category: true,
          },
        },
      },
      orderBy: {
        dateIncurred: "desc",
      },
    });

    const summary = {
      totalBilled: billingRecords.reduce((sum, r) => sum + r.amountOwed, 0),
      pending: billingRecords.filter((r) => r.status === "pending").length,
      pendingAmount: billingRecords
        .filter((r) => r.status === "pending")
        .reduce((sum, r) => sum + r.amountOwed, 0),
      paid: billingRecords.filter((r) => r.status === "paid").length,
      paidAmount: billingRecords
        .filter((r) => r.status === "paid")
        .reduce((sum, r) => sum + r.amountOwed, 0),
    };

    res.json({
      success: true,
      summary,
      records: billingRecords,
    });
  } catch (error) {
    console.error("Billing fetch error:", error);
    res.status(500).json({ error: "Failed to fetch billing" });
  }
});

// Change contractor password
app.post(
  "/api/contractor/change-password",
  authenticateContractor,
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res
          .status(400)
          .json({ error: "Current and new password required" });
      }

      if (newPassword.length < 8) {
        return res
          .status(400)
          .json({ error: "New password must be at least 8 characters" });
      }

      // ✅ FIXED: Use req.contractor.id instead of req.contractor.id
      const contractor = await prisma.contractor.findUnique({
        where: { id: req.contractor.id },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }

      const isValidPassword = await comparePassword(
        currentPassword,
        contractor.passwordHash
      );

      if (!isValidPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      const newPasswordHash = await hashPassword(newPassword);

      await prisma.contractor.update({
        where: { id: req.contractor.id }, // ✅ FIXED
        data: {
          passwordHash: newPasswordHash,
          requirePasswordChange: false,
        },
      });

      console.log("Password changed for contractor:", contractor.businessName);

      res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  }
);

// Submit a dispute
app.post(
  "/api/contractor/disputes",
  authenticateContractor,
  async (req, res) => {
    try {
      const { leadId, reason, description, evidence } = req.body;

      // Validate input
      if (!leadId || !reason) {
        return res.status(400).json({ error: "Lead ID and reason required" });
      }

      // Verify this lead was assigned to this contractor
      const assignment = await prisma.leadAssignment.findFirst({
        where: {
          leadId: leadId,
          contractorId: req.contractor.id,
        },
      });

      if (!assignment) {
        return res.status(403).json({
          error: "You cannot dispute a lead that was not assigned to you",
        });
      }

      // Check if dispute already exists for this lead
      const existingDispute = await prisma.dispute.findFirst({
        where: {
          leadId: leadId,
          contractorId: req.contractor.id,
        },
      });

      if (existingDispute) {
        return res
          .status(400)
          .json({ error: "Dispute already submitted for this lead" });
      }

      // Create dispute
      const dispute = await prisma.dispute.create({
        data: {
          leadId: leadId,
          contractorId: req.contractor.id,
          reason: reason,
          description: description || null,
          evidence: evidence || null,
          status: "pending",
        },
      });

      console.log("Dispute submitted:", dispute.id);

      res.json({
        success: true,
        dispute: dispute,
      });
    } catch (error) {
      console.error("Dispute submission error:", error);
      res.status(500).json({ error: "Failed to submit dispute" });
    }
  }
);

// Get contractor's disputes
app.get(
  "/api/contractor/disputes",
  authenticateContractor,
  async (req, res) => {
    try {
      const disputes = await prisma.dispute.findMany({
        where: {
          contractorId: req.contractor.id,
        },
        include: {
          contractor: {
            select: {
              businessName: true,
            },
          },
        },
        orderBy: {
          submittedAt: "desc",
        },
      });

      // Get lead details separately for each dispute
      const disputesWithLeads = await Promise.all(
        disputes.map(async (dispute) => {
          const lead = await prisma.lead.findUnique({
            where: { id: dispute.leadId },
            select: {
              customerFirstName: true,
              customerLastName: true,
              customerPhone: true,
              serviceType: true,
              category: true,
            },
          });

          return {
            ...dispute,
            lead,
          };
        })
      );

      res.json({
        success: true,
        disputes: disputesWithLeads,
      });
    } catch (error) {
      console.error("Disputes fetch error:", error);
      res.status(500).json({ error: "Failed to fetch disputes" });
    }
  }
);

// Get all disputes (admin)
app.get("/api/admin/disputes", adminAuth, async (req, res) => {
  try {
    const { status } = req.query;

    const where = {};
    if (status) where.status = status;

    const disputes = await prisma.dispute.findMany({
      where,
      include: {
        contractor: {
          select: {
            businessName: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: {
        submittedAt: "desc",
      },
    });

    // Get lead details separately for each dispute
    const disputesWithLeads = await Promise.all(
      disputes.map(async (dispute) => {
        const lead = await prisma.lead.findUnique({
          where: { id: dispute.leadId },
          select: {
            customerFirstName: true,
            customerLastName: true,
            customerPhone: true,
            customerEmail: true,
            serviceType: true,
            category: true,
            price: true,
          },
        });

        return {
          ...dispute,
          lead,
        };
      })
    );

    const summary = {
      total: disputesWithLeads.length,
      pending: disputesWithLeads.filter((d) => d.status === "pending").length,
      approved: disputesWithLeads.filter((d) => d.status === "approved").length,
      denied: disputesWithLeads.filter((d) => d.status === "denied").length,
    };

    res.json({
      success: true,
      summary,
      disputes: disputesWithLeads,
    });
  } catch (error) {
    console.error("Disputes fetch error:", error);
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
});

// Resolve a dispute (admin)
app.patch("/api/admin/disputes/:id", adminAuth, async (req, res) => {
  try {
    const { status, resolution, resolutionNotes, creditAmount } = req.body;

    if (!status || !resolution) {
      return res.status(400).json({ error: "Status and resolution required" });
    }

    const dispute = await prisma.dispute.update({
      where: { id: req.params.id },
      data: {
        status: status,
        resolution: resolution,
        resolutionNotes: resolutionNotes || null,
        creditAmount: creditAmount || null,
        resolvedAt: new Date(),
      },
      include: {
        contractor: true,
      },
    });

    const lead = await prisma.lead.findUnique({
      where: { id: dispute.leadId },
    });

    // If approved, update the billing record
    if (status === "approved" && resolution !== "denied") {
      const billingRecord = await prisma.billingRecord.findFirst({
        where: {
          leadId: dispute.leadId,
          contractorId: dispute.contractorId,
        },
      });

      if (billingRecord) {
        if (resolution === "full_credit") {
          await prisma.billingRecord.update({
            where: { id: billingRecord.id },
            data: {
              status: "credited",
              notes: `Dispute approved: ${
                resolutionNotes || "Full credit issued"
              }`,
            },
          });
        } else if (resolution === "partial_credit" && creditAmount) {
          await prisma.billingRecord.update({
            where: { id: billingRecord.id },
            data: {
              amountOwed: creditAmount,
              notes: `Dispute approved: Partial credit. ${
                resolutionNotes || ""
              }`,
            },
          });
        }
      }

      // Release tracking number back to pool
      const assignment = await prisma.leadAssignment.findFirst({
        where: {
          leadId: dispute.leadId,
          contractorId: dispute.contractorId,
        },
      });

      if (assignment && assignment.trackingNumber) {
        await prisma.twilioNumberPool.updateMany({
          where: {
            phoneNumber: assignment.trackingNumber,
            status: "assigned",
          },
          data: {
            status: "available",
            currentLeadId: null,
            assignedAt: null,
            expiresAt: null,
          },
        });

        console.log(
          `Released tracking number ${assignment.trackingNumber} back to pool after dispute resolution`
        );
      }
    }

    console.log("Dispute resolved:", dispute.id, status, resolution);

    res.json({
      success: true,
      dispute: {
        ...dispute,
        lead,
      },
    });
  } catch (error) {
    console.error("Dispute resolution error:", error);
    res.status(500).json({ error: "Failed to resolve dispute" });
  }
});

// Submit customer feedback (public endpoint - no auth required)
app.post("/api/feedback/submit", async (req, res) => {
  try {
    const {
      leadId,
      contractorCalled,
      outcome,
      rating,
      feedbackText,
      wouldRecommend,
    } = req.body;

    // Validate lead exists
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { assignment: true },
    });

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    if (!lead.assignment) {
      return res
        .status(400)
        .json({ error: "No contractor assigned to this lead" });
    }

    // Check if feedback already exists
    const existingFeedback = await prisma.customerFeedback.findFirst({
      where: { leadId: leadId },
    });

    if (existingFeedback) {
      return res
        .status(400)
        .json({ error: "Feedback already submitted for this lead" });
    }

    // Create feedback
    const feedback = await prisma.customerFeedback.create({
      data: {
        leadId: leadId,
        contractorId: lead.assignment.contractorId,
        contractorCalled: contractorCalled,
        outcome: outcome || null,
        rating: rating || null,
        feedbackText: feedbackText || null,
        wouldRecommend: wouldRecommend || null,
      },
    });

    console.log("Customer feedback received:", feedback.id);

    // If customer says contractor never called, flag for review
    if (contractorCalled === false) {
      console.log(
        "WARNING: Customer reports no contact from contractor for lead:",
        leadId
      );
    }

    res.json({
      success: true,
      message: "Thank you for your feedback!",
    });
  } catch (error) {
    console.error("Feedback submission error:", error);
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

// Get feedback for admin
app.get("/api/admin/feedback", adminAuth, async (req, res) => {
  try {
    const { contractorId, contractorCalled } = req.query;

    const where = {};
    if (contractorId) where.contractorId = contractorId;
    if (contractorCalled !== undefined)
      where.contractorCalled = contractorCalled === "true";

    const feedback = await prisma.customerFeedback.findMany({
      where,
      include: {
        contractor: {
          select: {
            businessName: true,
            email: true,
          },
        },
      },
      orderBy: {
        submittedAt: "desc",
      },
    });

    // Get lead details separately
    const feedbackWithLeads = await Promise.all(
      feedback.map(async (fb) => {
        const lead = await prisma.lead.findUnique({
          where: { id: fb.leadId },
          select: {
            customerFirstName: true,
            customerLastName: true,
            customerPhone: true,
            serviceType: true,
            category: true,
          },
        });

        return {
          ...fb,
          lead,
        };
      })
    );

    const summary = {
      total: feedbackWithLeads.length,
      contractorCalled: feedbackWithLeads.filter(
        (f) => f.contractorCalled === true
      ).length,
      contractorDidNotCall: feedbackWithLeads.filter(
        (f) => f.contractorCalled === false
      ).length,
      avgRating:
        feedbackWithLeads.filter((f) => f.rating).length > 0
          ? (
              feedbackWithLeads.reduce((sum, f) => sum + (f.rating || 0), 0) /
              feedbackWithLeads.filter((f) => f.rating).length
            ).toFixed(1)
          : "N/A",
    };

    res.json({
      success: true,
      summary,
      feedback: feedbackWithLeads,
    });
  } catch (error) {
    console.error("Feedback fetch error:", error);
    res.status(500).json({ error: "Failed to fetch feedback" });
  }
});

// Get contractor's feedback (for their portal)
app.get(
  "/api/contractor/feedback",
  authenticateContractor,
  async (req, res) => {
    try {
      const feedback = await prisma.customerFeedback.findMany({
        where: {
          contractorId: req.contractor.id,
        },
        orderBy: {
          submittedAt: "desc",
        },
      });

      // Get lead details separately
      const feedbackWithLeads = await Promise.all(
        feedback.map(async (fb) => {
          const lead = await prisma.lead.findUnique({
            where: { id: fb.leadId },
            select: {
              customerFirstName: true,
              customerLastName: true,
              serviceType: true,
              category: true,
            },
          });

          return {
            ...fb,
            lead,
          };
        })
      );

      const summary = {
        total: feedbackWithLeads.length,
        avgRating:
          feedbackWithLeads.filter((f) => f.rating).length > 0
            ? (
                feedbackWithLeads.reduce((sum, f) => sum + (f.rating || 0), 0) /
                feedbackWithLeads.filter((f) => f.rating).length
              ).toFixed(1)
            : "N/A",
        wouldRecommend: feedbackWithLeads.filter(
          (f) => f.wouldRecommend === true
        ).length,
      };

      res.json({
        success: true,
        summary,
        feedback: feedbackWithLeads,
      });
    } catch (error) {
      console.error("Feedback fetch error:", error);
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  }
);

// ============================================
// CRON ENDPOINT - NUMBER RECYCLING
// ============================================
app.post("/api/cron/recycle-numbers", async (req, res) => {
  const cronSecret = req.headers["CRON_SECRET"] || req.query.secret;

  console.log("Expected:", process.env.CRON_SECRET);
  console.log("Received:", cronSecret);

  if (cronSecret !== process.env.CRON_SECRET) {
    console.log("Unauthorized cron attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("🔄 Cron triggered: Starting number recycling...");
  console.log("Time:", new Date().toISOString());

  try {
    const now = new Date();

    // Find expired assigned numbers
    const expiredNumbers = await prisma.twilioNumberPool.findMany({
      where: {
        status: "assigned",
        expiresAt: { lte: now },
      },
    });

    console.log(`📋 Found ${expiredNumbers.length} expired numbers to recycle`);

    for (const number of expiredNumbers) {
      await prisma.twilioNumberPool.update({
        where: { id: number.id },
        data: {
          status: "available",
          currentLeadId: null,
          assignedAt: null,
          expiresAt: null,
        },
      });
      console.log(`✅ Released: ${number.phoneNumber}`);
    }

    // Get updated pool status
    const available = await prisma.twilioNumberPool.count({
      where: { status: "available" },
    });
    const assigned = await prisma.twilioNumberPool.count({
      where: { status: "assigned" },
    });
    const total = await prisma.twilioNumberPool.count();

    const status = {
      recycled: expiredNumbers.length,
      available,
      assigned,
      total,
      utilization: ((assigned / total) * 100).toFixed(1) + "%",
    };

    console.log("📊 Pool Status:", status);

    // Alert if running low
    if (available < 5) {
      console.log("⚠️ WARNING: Less than 5 numbers available!");
    }

    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error("❌ Recycling error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to recycle numbers",
      message: error.message,
    });
  }
});

// Create setup intent for adding payment method
app.post(
  "/api/contractor/payment/setup-intent",
  authenticateContractor,
  async (req, res) => {
    try {
      const setupIntent = await createSetupIntent(req.contractor.id);

      res.json({
        success: true,
        clientSecret: setupIntent.client_secret,
      });
    } catch (error) {
      console.error("Setup intent error:", error);
      res.status(500).json({ error: "Failed to create setup intent" });
    }
  }
);

// Save payment method after contractor adds it
app.post(
  "/api/contractor/payment/save-method",
  authenticateContractor,
  async (req, res) => {
    try {
      const { paymentMethodId } = req.body;

      await savePaymentMethod(req.contractor.id, paymentMethodId);

      res.json({
        success: true,
        message: "Payment method saved successfully",
      });
    } catch (error) {
      console.error("Save payment method error:", error);
      res.status(500).json({ error: "Failed to save payment method" });
    }
  }
);

// Get contractor payment status
app.get(
  "/api/contractor/payment/status",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractor = await prisma.contractor.findUnique({
        where: { id: req.contractor.id },
        select: { stripePaymentMethodId: true },
      });

      res.json({
        success: true,
        hasPaymentMethod: !!contractor.stripePaymentMethodId,
      });
    } catch (error) {
      console.error("Payment status error:", error);
      res.status(500).json({ error: "Failed to check payment status" });
    }
  }
);

// Stripe webhook handler
// Stripe webhook handler with signature verification
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);

      // Verify the signature
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

      console.log("Stripe webhook verified:", event.type);
    } catch (err) {
      console.error("⚠️ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        console.log("Payment succeeded:", paymentIntent.id);

        await prisma.billingRecord.updateMany({
          where: { stripePaymentId: paymentIntent.id },
          data: {
            status: "paid",
            paidAt: new Date(),
          },
        });
        break;

      case "payment_intent.payment_failed":
        const failedPayment = event.data.object;
        console.log("Payment failed:", failedPayment.id);

        await prisma.billingRecord.updateMany({
          where: { stripePaymentId: failedPayment.id },
          data: {
            status: "failed",
            notes: `Payment failed: ${
              failedPayment.last_payment_error?.message || "Unknown error"
            }`,
          },
        });
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  }
);

// Cron endpoint to send feedback emails
app.post("/api/cron/send-feedback-emails", async (req, res) => {
  const cronSecret = req.headers["x-cron-secret"] || req.query.secret;

  if (cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("📧 Cron: Sending feedback request emails...");

  try {
    // Find leads contacted 24 hours ago that haven't received feedback
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);

    const leads = await prisma.lead.findMany({
      where: {
        status: "contacted",
        firstContactAt: {
          gte: new Date(oneDayAgo.getTime() - 60 * 60 * 1000), // 23-24 hours ago
          lte: oneDayAgo,
        },
        CustomerFeedback: {
          none: {}, // No feedback submitted yet
        },
      },
    });

    console.log(`Found ${leads.length} leads eligible for feedback emails`);

    let sent = 0;
    for (const lead of leads) {
      const result = await sendFeedbackRequestEmail(lead);
      if (result.success) sent++;
    }

    res.json({
      success: true,
      totalEligible: leads.length,
      sent: sent,
    });
  } catch (error) {
    console.error("Feedback email cron error:", error);
    res.status(500).json({ error: "Failed to send feedback emails" });
  }
});

// Security event logging
async function logSecurityEvent(type, details) {
  try {
    console.log("🔒 SECURITY EVENT:", type, details);

    // Optionally log to database for audit trail
    await prisma.notificationLog.create({
      data: {
        type: "security",
        recipient: "admin",
        subject: `Security Event: ${type}`,
        status: "logged",
        sentAt: new Date(),
        metadata: {
          eventType: type,
          ...details,
        },
      },
    });
  } catch (error) {
    console.error("Failed to log security event:", error);
  }
}

// Approve contractor and send onboarding email
app.post("/api/admin/contractors/:id/approve", adminAuth, async (req, res) => {
  try {
    const contractorId = req.params.id;

    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
    });

    if (!contractor) {
      return res.status(404).json({ error: "Contractor not found" });
    }

    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString("hex");
    const hashedPassword = await hashPassword(tempPassword);

    // Update contractor
    await prisma.contractor.update({
      where: { id: contractorId },
      data: {
        status: "active",
        isVerified: true,
        passwordHash: hashedPassword,
        requirePasswordChange: true,
      },
    });

    // Send onboarding email
    await sendContractorOnboardingEmail(contractor, tempPassword);

    console.log("Contractor approved and onboarded:", contractor.businessName);

    res.json({
      success: true,
      message: "Contractor approved and onboarding email sent",
    });
  } catch (error) {
    console.error("Contractor approval error:", error);
    res.status(500).json({ error: "Failed to approve contractor" });
  }
});

// Allow both api and app subdomains
app.use((req, res, next) => {
  const host = req.get("host");

  // API routes should only work on api subdomain
  /* if (req.path.startsWith("/api/") && !host.includes("api.")) {
    return res
      .status(404)
      .json({ error: "API endpoints must use api subdomain" });
  } */

  // Allow API routes on BOTH api and app subdomains
  if (req.path.startsWith("/api/")) {
    // API calls work on both api. and app. subdomains
    next();
    return;
  }
  // Portal routes should work on app subdomain
  if (
    (req.path === "/contractor" || req.path === "/admin") &&
    !host.includes("app.")
  ) {
    return res.redirect(`https://app.getcontractornow.com${req.path}`);
  }

  next();
});

// SendGrid webhook for email events
app.post("/api/webhooks/sendgrid", express.json(), async (req, res) => {
  try {
    // Verify SendGrid signature if enabled
    const signature = req.headers["x-twilio-email-event-webhook-signature"];
    const timestamp = req.headers["x-twilio-email-event-webhook-timestamp"];

    if (signature && process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY) {
      const payload = timestamp + JSON.stringify(req.body);
      const expectedSignature = crypto
        .createHmac("sha256", process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY)
        .update(payload)
        .digest("base64");

      if (signature !== expectedSignature) {
        console.error("Invalid SendGrid signature");
        return res.status(403).json({ error: "Invalid signature" });
      }
    }
    const events = req.body;

    console.log(`📧 SendGrid webhook received ${events.length} events`);

    for (const event of events) {
      const { email, event: eventType, reason, timestamp } = event;

      console.log(`Email event: ${eventType} for ${email}`);

      // Handle bounces and blocks
      if (eventType === "bounce" || eventType === "dropped") {
        // Check if it's a contractor email
        const contractor = await prisma.contractor.findUnique({
          where: { email: email.toLowerCase() },
        });

        if (contractor) {
          await prisma.contractor.update({
            where: { id: contractor.id },
            data: {
              emailBounced: true,
              emailBouncedAt: new Date(timestamp * 1000),
              emailBounceReason: reason || eventType,
            },
          });

          console.log(`✅ Marked contractor email as bounced: ${email}`);
        }

        // Check if it's a customer email
        const leads = await prisma.lead.findMany({
          where: { customerEmail: email.toLowerCase() },
        });

        if (leads.length > 0) {
          await prisma.lead.updateMany({
            where: { customerEmail: email.toLowerCase() },
            data: {
              customerEmailBounced: true,
            },
          });

          console.log(
            `✅ Marked ${leads.length} lead(s) email as bounced: ${email}`
          );
        }

        // Log the bounce
        await prisma.notificationLog.create({
          data: {
            type: "email_bounce",
            recipient: email,
            subject: `Email bounced: ${eventType}`,
            status: "bounced",
            sentAt: new Date(timestamp * 1000),
            metadata: {
              eventType,
              reason,
              contractorId: contractor?.id,
              leadCount: leads.length,
            },
          },
        });
      }

      // Handle spam reports
      if (eventType === "spamreport") {
        await prisma.notificationLog.create({
          data: {
            type: "spam_report",
            recipient: email,
            subject: "Email marked as spam",
            status: "spam",
            sentAt: new Date(timestamp * 1000),
            metadata: { eventType },
          },
        });

        console.log(`⚠️ Spam report for: ${email}`);
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error("SendGrid webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Get bounced emails (admin)
app.get("/api/admin/bounced-emails", adminAuth, async (req, res) => {
  try {
    const contractors = await prisma.contractor.findMany({
      where: { emailBounced: true },
      select: {
        email: true,
        businessName: true,
        emailBouncedAt: true,
        emailBounceReason: true,
      },
    });

    const leads = await prisma.lead.findMany({
      where: { customerEmailBounced: true },
      select: {
        customerEmail: true,
        customerFirstName: true,
        customerLastName: true,
      },
      distinct: ["customerEmail"],
    });

    const bounced = [
      ...contractors.map((c) => ({
        email: c.email,
        type: "Contractor",
        businessName: c.businessName,
        bouncedAt: c.emailBouncedAt,
        reason: c.emailBounceReason,
      })),
      ...leads.map((l) => ({
        email: l.customerEmail,
        type: "Customer",
        businessName: `${l.customerFirstName} ${l.customerLastName}`,
        bouncedAt: null,
        reason: "Bounced",
      })),
    ];

    res.json({ bounced });
  } catch (error) {
    console.error("Error fetching bounced emails:", error);
    res.status(500).json({ error: "Failed to fetch bounced emails" });
  }
});

const {
  getLeadCostForContractor,
  canContractorReceiveLeads,
  getMinimumCreditBalance,
  getCreditExpiryDate,
  formatCurrency,
} = require("./subscription-helpers");

// ============================================
// CREDIT MANAGEMENT ENDPOINTS
// ============================================

// Add credit to contractor account
app.post(
  "/api/contractors/credit/deposit",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;
      const { amount } = req.body;

      // Validate amount
      if (!amount || amount < 100) {
        return res.status(400).json({
          error: "Minimum deposit is $100",
        });
      }

      if (amount > 10000) {
        return res.status(400).json({
          error: "Maximum deposit is $10,000",
        });
      }

      // Get contractor
      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }

      // Check if payment method exists
      if (!contractor.stripeCustomerId || !contractor.stripePaymentMethodId) {
        return res.status(400).json({
          error: "Please add a payment method first",
        });
      }

      console.log(
        `💳 Creating credit deposit: $${amount} for ${contractor.businessName}`
      );

      // Create Stripe payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: "usd",
        customer: contractor.stripeCustomerId,
        payment_method: contractor.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Credit deposit - ${contractor.businessName}`,
        metadata: {
          contractorId: contractor.id,
          type: "credit_deposit",
        },
      });

      if (paymentIntent.status === "succeeded") {
        // Calculate new balance
        const newBalance = contractor.creditBalance + amount;
        const expiresAt = getCreditExpiryDate();

        // Create credit transaction record
        await prisma.$transaction([
          prisma.creditTransaction.create({
            data: {
              contractorId: contractor.id,
              type: "deposit",
              amount: amount,
              balanceBefore: contractor.creditBalance,
              balanceAfter: newBalance,
              stripePaymentId: paymentIntent.id,
              expiresAt: expiresAt,
              description: `Credit deposit: ${formatCurrency(amount)}`,
            },
          }),

          prisma.contractor.update({
            where: { id: contractor.id },
            data: {
              creditBalance: newBalance,
              isAcceptingLeads: true, // Enable lead acceptance
            },
          }),
        ]);

        console.log(
          `✅ Credit deposited: ${
            contractor.businessName
          } - New balance: ${formatCurrency(newBalance)}`
        );

        res.json({
          success: true,
          message: `Successfully added ${formatCurrency(
            amount
          )} to your account`,
          newBalance: newBalance,
          expiresAt: expiresAt,
          paymentIntentId: paymentIntent.id,
        });
      } else {
        console.error("Payment intent failed:", paymentIntent.status);
        res.status(400).json({
          error: "Payment failed. Please check your payment method.",
        });
      }
    } catch (error) {
      console.error("Credit deposit error:", error);

      if (error.code === "card_declined") {
        return res.status(400).json({
          error: "Card declined. Please use a different payment method.",
        });
      }

      res.status(500).json({
        error: "Failed to process credit deposit",
        details: error.message,
      });
    }
  }
);

// Get credit balance and transaction history
app.get(
  "/api/contractors/credit/balance",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;

      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
        select: {
          creditBalance: true,
          subscriptionTier: true,
          isBetaTester: true,
          betaTesterLeadCost: true,
        },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }

      // Get recent transactions
      const transactions = await prisma.creditTransaction.findMany({
        where: { contractorId: contractorId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      // Get next expiring credit
      const nextExpiring = await prisma.creditTransaction.findFirst({
        where: {
          contractorId: contractorId,
          type: "deposit",
          expiresAt: { gt: new Date() },
        },
        orderBy: { expiresAt: "asc" },
      });

      const leadCost = getLeadCostForContractor(contractor);
      const minBalance = getMinimumCreditBalance();

      res.json({
        success: true,
        balance: contractor.creditBalance,
        leadCost: leadCost,
        minimumRequired: minBalance,
        hasMinimum: contractor.creditBalance >= minBalance,
        nextExpiry: nextExpiring?.expiresAt || null,
        transactions: transactions,
      });
    } catch (error) {
      console.error("Get balance error:", error);
      res.status(500).json({ error: "Failed to get credit balance" });
    }
  }
);

// ============================================
// SUBSCRIPTION WEBHOOK HANDLERS
// ============================================

async function handleSubscriptionCreated(subscription) {
  console.log("🎉 New subscription created:", subscription.id);

  try {
    const stripeCustomerId = subscription.customer;

    // Get customer email from Stripe
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    const email = customer.email;

    if (!email) {
      console.error("❌ No email found for Stripe customer:", stripeCustomerId);
      return;
    }

    console.log("📧 Looking for contractor with email:", email);

    // Find contractor by email (for new subscriptions) OR by stripeCustomerId (for existing)
    let contractor = await prisma.contractor.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase() },
          { stripeCustomerId: stripeCustomerId },
        ],
      },
    });

    if (!contractor) {
      console.error("❌ Contractor not found for email:", email);
      return;
    }

    // Determine tier from price ID
    let tier = "pro";
    const priceId = subscription.items.data[0].price.id;

    if (priceId === process.env.STRIPE_PRICE_STARTER) {
      tier = "starter";
    } else if (priceId === process.env.STRIPE_PRICE_PRO) {
      tier = "pro";
    } else if (priceId === process.env.STRIPE_PRICE_ELITE) {
      tier = "elite";
    }

    // Check if beta tester
    const isBeta =
      subscription.discount?.coupon?.id === process.env.STRIPE_PROMO_BETA;

    // ============================================
    // NEW: GET PAYMENT METHOD FROM SUBSCRIPTION
    // ============================================

    let paymentMethodDetails = {};

    try {
      // Get the payment method ID from the subscription
      const paymentMethodId = subscription.default_payment_method;

      if (paymentMethodId) {
        console.log("💳 Retrieving payment method:", paymentMethodId);

        // Get payment method details from Stripe
        const paymentMethod = await stripe.paymentMethods.retrieve(
          paymentMethodId
        );

        if (paymentMethod && paymentMethod.card) {
          paymentMethodDetails = {
            stripePaymentMethodId: paymentMethod.id,
            paymentMethodLast4: paymentMethod.card.last4,
            paymentMethodBrand: paymentMethod.card.brand,
            paymentMethodExpMonth: paymentMethod.card.exp_month,
            paymentMethodExpYear: paymentMethod.card.exp_year,
          };

          console.log(
            `✅ Payment method saved: ${paymentMethod.card.brand} ending in ${paymentMethod.card.last4}`
          );
        }
      } else {
        console.log("⚠️ No default payment method on subscription");
      }
    } catch (pmError) {
      console.error("⚠️ Error retrieving payment method:", pmError.message);
      // Don't fail the whole process if payment method retrieval fails
    }

    console.log("✅ Found contractor:", contractor.businessName);
    console.log("   Tier:", tier);
    console.log("   Beta tester:", isBeta);

    // Update contractor with subscription info AND payment method
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        stripeCustomerId: stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: "active",
        subscriptionTier: tier,
        subscriptionStartDate: new Date(
          subscription.current_period_start * 1000
        ),
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),
        isBetaTester: isBeta,
        betaTesterLeadCost: isBeta ? 50.0 : null,
        // Add payment method details
        ...paymentMethodDetails,
      },
    });

    console.log(
      `✅ Contractor ${
        contractor.businessName
      } subscribed to ${tier.toUpperCase()} tier`
    );
    if (isBeta) {
      console.log("🎟️ Beta tester discount applied - $50/lead pricing");
    }
    if (paymentMethodDetails.paymentMethodLast4) {
      console.log(
        `💳 Payment method on file: ${paymentMethodDetails.paymentMethodBrand} ****${paymentMethodDetails.paymentMethodLast4}`
      );
    }
  } catch (error) {
    console.error("Error handling subscription created:", error);
    Sentry.captureException(error);
  }
}

async function handleSubscriptionUpdated(subscription) {
  console.log("🔄 Subscription updated:", subscription.id);

  try {
    const contractor = await prisma.contractor.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!contractor) {
      console.error(
        "❌ Contractor not found for subscription:",
        subscription.id
      );
      return;
    }

    // Determine tier from price ID
    let tier = contractor.subscriptionTier || "pro";
    const priceId = subscription.items.data[0].price.id;

    if (priceId === process.env.STRIPE_PRICE_STARTER) {
      tier = "starter";
    } else if (priceId === process.env.STRIPE_PRICE_PRO) {
      tier = "pro";
    } else if (priceId === process.env.STRIPE_PRICE_ELITE) {
      tier = "elite";
    }

    // Update status based on subscription status
    let status = "inactive";
    if (subscription.status === "active") {
      status = "active";
    } else if (subscription.status === "past_due") {
      status = "past_due";
    } else if (
      subscription.status === "canceled" ||
      subscription.status === "unpaid"
    ) {
      status = "cancelled";
    }

    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        subscriptionStatus: status,
        subscriptionTier: tier,
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),
        // Disable lead acceptance if subscription not active
        isAcceptingLeads:
          status === "active" &&
          contractor.creditBalance >= getMinimumCreditBalance(),
      },
    });

    console.log(
      `✅ Contractor ${contractor.businessName} subscription updated: ${status}`
    );
  } catch (error) {
    console.error("Error handling subscription updated:", error);
    Sentry.captureException(error);
  }
}

async function handleSubscriptionDeleted(subscription) {
  console.log("❌ Subscription cancelled:", subscription.id);

  try {
    const contractor = await prisma.contractor.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!contractor) {
      console.error(
        "❌ Contractor not found for subscription:",
        subscription.id
      );
      return;
    }

    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        subscriptionStatus: "cancelled",
        isAcceptingLeads: false, // Stop receiving leads
      },
    });

    console.log(
      `✅ Contractor ${contractor.businessName} subscription cancelled`
    );

    // TODO: Send cancellation email
  } catch (error) {
    console.error("Error handling subscription deleted:", error);
    Sentry.captureException(error);
  }
}

async function handleInvoicePaymentSucceeded(invoice) {
  console.log("✅ Invoice payment succeeded:", invoice.id);

  try {
    const stripeCustomerId = invoice.customer;

    const contractor = await prisma.contractor.findFirst({
      where: { stripeCustomerId: stripeCustomerId },
    });

    if (!contractor) {
      console.error("❌ Contractor not found for customer:", stripeCustomerId);
      return;
    }

    // Ensure subscription is active
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        subscriptionStatus: "active",
        // Re-enable if they have sufficient credit
        isAcceptingLeads: contractor.creditBalance >= getMinimumCreditBalance(),
      },
    });

    console.log(`✅ Invoice paid for ${contractor.businessName}`);
  } catch (error) {
    console.error("Error handling invoice payment succeeded:", error);
    Sentry.captureException(error);
  }
}

async function handleInvoicePaymentFailed(invoice) {
  console.log("❌ Invoice payment failed:", invoice.id);

  try {
    const stripeCustomerId = invoice.customer;

    const contractor = await prisma.contractor.findFirst({
      where: { stripeCustomerId: stripeCustomerId },
    });

    if (!contractor) {
      console.error("❌ Contractor not found for customer:", stripeCustomerId);
      return;
    }

    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        subscriptionStatus: "past_due",
        isAcceptingLeads: false, // Stop receiving leads until payment made
      },
    });

    console.log(
      `⚠️ Payment failed for ${contractor.businessName} - subscription past due`
    );

    // TODO: Send payment failed email
  } catch (error) {
    console.error("Error handling invoice payment failed:", error);
    Sentry.captureException(error);
  }
}

/* // Remove this entire block:
app.get('/api/test-sentry', (req, res) => {
  try {
    throw new Error('Test error for Sentry');
  } catch (error) {
    Sentry.captureException(error);
    res.json({ message: 'Error sent to Sentry' });
  }
}); */

// Optional: Your own error handler after Sentry's
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* ### **Step 3: Add Backup Monitoring Endpoint**

 Add to `index.js`:
```javascript
// Database backup status (admin)
app.get('/api/admin/backup-status', adminAuth, async (req, res) => {
  try {
    // Get database stats
    const stats = await Promise.all([
      prisma.lead.count(),
      prisma.contractor.count(),
      prisma.billingRecord.count(),
      prisma.leadAssignment.count(),
      prisma.callLog.count(),
      prisma.notificationLog.count()
    ]);

    const backupInfo = {
      lastChecked: new Date().toISOString(),
      recordCounts: {
        leads: stats[0],
        contractors: stats[1],
        billingRecords: stats[2],
        leadAssignments: stats[3],
        callLogs: stats[4],
        notificationLogs: stats[5]
      },
      totalRecords: stats.reduce((sum, count) => sum + count, 0),
      databaseSize: 'Check Railway Dashboard',
      backupSchedule: 'Daily at 2 AM UTC',
      retention: '7 days',
      provider: 'Railway Managed Backups'
    };

    res.json({
      success: true,
      backup: backupInfo
    });
  } catch (error) {
    console.error('Backup status error:', error);
    res.status(500).json({ error: 'Failed to fetch backup status' });
  }
}); */

// Update payment method
app.post(
  "/api/contractor/payment/update-method",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;

      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
      });

      if (!contractor.stripeCustomerId) {
        return res.status(400).json({ error: "No Stripe customer found" });
      }

      // Create setup intent for new card
      const setupIntent = await stripe.setupIntents.create({
        customer: contractor.stripeCustomerId,
        payment_method_types: ["card"],
      });

      res.json({
        success: true,
        clientSecret: setupIntent.client_secret,
      });
    } catch (error) {
      console.error("Update payment method error:", error);
      res.status(500).json({ error: "Failed to update payment method" });
    }
  }
);

// Confirm new payment method
app.post(
  "/api/contractor/payment/confirm-update",
  authenticateContractor,
  async (req, res) => {
    try {
      const { paymentMethodId } = req.body;
      const contractorId = req.contractor.id;

      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
      });

      // Get payment method details
      const paymentMethod = await stripe.paymentMethods.retrieve(
        paymentMethodId
      );

      // Update subscription to use new payment method
      if (contractor.stripeSubscriptionId) {
        await stripe.subscriptions.update(contractor.stripeSubscriptionId, {
          default_payment_method: paymentMethodId,
        });
      }

      // Save to database
      await prisma.contractor.update({
        where: { id: contractorId },
        data: {
          stripePaymentMethodId: paymentMethod.id,
          paymentMethodLast4: paymentMethod.card.last4,
          paymentMethodBrand: paymentMethod.card.brand,
          paymentMethodExpMonth: paymentMethod.card.exp_month,
          paymentMethodExpYear: paymentMethod.card.exp_year,
        },
      });

      res.json({
        success: true,
        message: "Payment method updated successfully",
        paymentMethod: {
          last4: paymentMethod.card.last4,
          brand: paymentMethod.card.brand,
          expMonth: paymentMethod.card.exp_month,
          expYear: paymentMethod.card.exp_year,
        },
      });
    } catch (error) {
      console.error("Confirm payment update error:", error);
      res.status(500).json({ error: "Failed to update payment method" });
    }
  }
);

// Get Contractor Dashboard Data
app.get(
  "/api/contractor/dashboard",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;

      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
        select: {
          id: true,
          businessName: true,
          email: true,
          phone: true,
          creditBalance: true,
          subscriptionTier: true,
          subscriptionStatus: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
          stripePaymentMethodId: true,
          serviceZipCodes: true,
          specializations: true,
          status: true,
          // Verification fields - ADDED
          licenseNumber: true,
          licenseState: true,
          licenseExpirationDate: true,
          businessAddress: true,
          businessCity: true,
          businessState: true,
          businessZip: true,
          taxId: true,
          insuranceProvider: true,
          insurancePolicyNumber: true,
          insuranceExpirationDate: true,
          yearsInBusiness: true,
          websiteUrl: true,
          businessType: true,
          // Payment method info - ADDED
          paymentMethodLast4: true,
          paymentMethodBrand: true,
          paymentMethodExpMonth: true,
          paymentMethodExpYear: true,
          isVerified: true,
          verifiedAt: true,
          // Performance
          avgResponseTime: true,
          conversionRate: true,
          customerRating: true,
          totalJobsCompleted: true,
          totalLeadsReceived: true,
          isAcceptingLeads: true,
          isApproved: true,
          isBetaTester: true,
          betaTesterLeadCost: true,
          createdAt: true,
        },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }

      // Calculate subscription pricing
      let monthlyPrice = 0;
      let leadCost = 0;

      if (contractor.isBetaTester) {
        monthlyPrice = 0;
        leadCost = contractor.betaTesterLeadCost || 50;
      } else if (contractor.subscriptionTier === "starter") {
        monthlyPrice = 99;
        leadCost = 75;
      } else if (contractor.subscriptionTier === "pro") {
        monthlyPrice = 125;
        leadCost = 100;
      } else if (contractor.subscriptionTier === "elite") {
        monthlyPrice = 200;
        leadCost = 250;
      }

      // Get lead count for current month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const leadsThisMonth = await prisma.leadAssignment.count({
        where: {
          contractorId: contractorId,
          assignedAt: { gte: startOfMonth },
        },
      });

      // Get recent transactions
      const recentTransactions = await prisma.creditTransaction.findMany({
        where: { contractorId: contractorId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          description: true,
          createdAt: true,
        },
      });

      // Max leads based on tier
      let maxLeads = 15;
      if (contractor.subscriptionTier === "pro") maxLeads = 40;
      if (contractor.subscriptionTier === "elite") maxLeads = 999;

      res.json({
        contractor: {
          id: contractor.id,
          businessName: contractor.businessName,
          email: contractor.email,
          phone: contractor.phone,
          creditBalance: contractor.creditBalance || 0,
          serviceZipCodes: contractor.serviceZipCodes,
          specializations: contractor.specializations,
          status: contractor.status,
        },
        subscription: {
          tier: contractor.subscriptionTier || "none",
          status: contractor.subscriptionStatus || "inactive",
          monthlyPrice: monthlyPrice,
          leadCost: leadCost,
          isBetaTester: contractor.isBetaTester || false,
          stripeSubscriptionId: contractor.stripeSubscriptionId,
          paymentMethod: contractor.paymentMethodLast4
            ? {
                last4: contractor.paymentMethodLast4,
                brand: contractor.paymentMethodBrand,
                expMonth: contractor.paymentMethodExpMonth,
                expYear: contractor.paymentMethodExpYear,
              }
            : null,
        },
        profile: {
          licenseNumber: contractor.licenseNumber,
          licenseState: contractor.licenseState,
          licenseExpirationDate: contractor.licenseExpirationDate,
          businessAddress: contractor.businessAddress,
          businessCity: contractor.businessCity,
          businessState: contractor.businessState,
          businessZip: contractor.businessZip,
          taxId: contractor.taxId
            ? "***-**-" + contractor.taxId.slice(-4)
            : null,
          insuranceProvider: contractor.insuranceProvider,
          insurancePolicyNumber: contractor.insurancePolicyNumber,
          insuranceExpirationDate: contractor.insuranceExpirationDate,
          yearsInBusiness: contractor.yearsInBusiness,
          websiteUrl: contractor.websiteUrl,
          businessType: contractor.businessType,
          isVerified: contractor.isVerified,
          verifiedAt: contractor.verifiedAt,
          avgResponseTime: contractor.avgResponseTime,
          conversionRate: contractor.conversionRate,
          customerRating: contractor.customerRating,
          totalJobsCompleted: contractor.totalJobsCompleted,
          totalLeadsReceived: contractor.totalLeadsReceived,
          isAcceptingLeads: contractor.isAcceptingLeads,
          isApproved: contractor.isApproved,
          memberSince: contractor.createdAt,
        },
        stats: {
          leadsThisMonth: leadsThisMonth,
          maxLeadsPerMonth: maxLeads,
        },
        recentTransactions: recentTransactions,
      });
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ error: "Failed to load dashboard data" });
    }
  }
);

// GET Contractor's Leads
app.get("/api/contractor/leads", authenticateContractor, async (req, res) => {
  try {
    const contractorId = req.contractor.id;
    const { status } = req.query;

    const whereClause = {
      contractorId: contractorId,
    };

    if (status) {
      whereClause.status = status;
    }

    const assignments = await prisma.leadAssignment.findMany({
      where: whereClause,
      select: {
        // ✅ FIXED: Explicitly select fields from LeadAssignment
        id: true,
        status: true,
        assignedAt: true,
        trackingNumber: true, // ✅ NOW INCLUDED!
        lead: {
          select: {
            id: true,
            customerFirstName: true,
            customerLastName: true,
            customerEmail: true,
            customerPhone: true,
            customerAddress: true,
            customerCity: true,
            customerState: true,
            customerZip: true,
            serviceType: true,
            serviceDescription: true,
            category: true,
            price: true,
            timeline: true,
            propertyType: true,
            budgetRange: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        assignedAt: "desc",
      },
    });

    const leads = assignments.map((assignment) => ({
      assignmentId: assignment.id,
      leadId: assignment.lead.id,
      status: assignment.status,
      assignedAt: assignment.assignedAt,
      trackingNumber: assignment.trackingNumber, // ✅ Now this will work!
      customer: {
        name: `${assignment.lead.customerFirstName} ${assignment.lead.customerLastName}`,
        email: assignment.lead.customerEmail,
        phone: assignment.lead.customerPhone,
        address: assignment.lead.customerAddress,
        city: assignment.lead.customerCity,
        state: assignment.lead.customerState,
        zipCode: assignment.lead.customerZip,
      },
      project: {
        serviceType: assignment.lead.serviceType,
        category: assignment.lead.category,
        price: assignment.lead.price,
        timeline: assignment.lead.timeline,
        propertyType: assignment.lead.propertyType,
        description: assignment.lead.serviceDescription,
        budgetRange: assignment.lead.budgetRange,
      },
      createdAt: assignment.lead.createdAt,
    }));

    res.json({ leads });
  } catch (error) {
    console.error("Get leads error:", error);
    res.status(500).json({ error: "Failed to load leads" });
  }
});
// POST Add Credits to Contractor Account
// Add credit (requires payment method already on file)
app.post(
  "/api/contractor/credits/add",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;
      const { amount } = req.body;

      // Validate amount
      if (![500, 1000, 2500].includes(amount)) {
        return res.status(400).json({
          error: "Invalid amount. Must be $500, $1000, or $2500",
        });
      }

      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }

      // Check payment method exists
      if (!contractor.stripePaymentMethodId) {
        return res.status(400).json({
          error: "Please add a payment method first",
          requiresPaymentMethod: true,
        });
      }

      // Create payment intent (THIS charges the card)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount * 100, // Convert to cents
        currency: "usd",
        customer: contractor.stripeCustomerId,
        payment_method: contractor.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Credit deposit - ${contractor.businessName}`,
        metadata: {
          contractorId: contractor.id,
          type: "credit_deposit",
        },
      });

      if (paymentIntent.status === "succeeded") {
        // Calculate new balance
        const currentBalance = contractor.creditBalance || 0;
        const newBalance = currentBalance + amount;

        // Calculate expiry
        const expiresAt = new Date();
        if (contractor.subscriptionTier === "elite") {
          expiresAt.setDate(expiresAt.getDate() + 120);
        } else if (contractor.subscriptionTier === "pro") {
          expiresAt.setDate(expiresAt.getDate() + 90);
        } else {
          expiresAt.setDate(expiresAt.getDate() + 60);
        }

        // Update database
        const [updatedContractor, transaction] = await prisma.$transaction([
          prisma.contractor.update({
            where: { id: contractorId },
            data: { creditBalance: newBalance },
          }),
          prisma.creditTransaction.create({
            data: {
              contractorId: contractorId,
              type: "deposit",
              amount: amount,
              balanceBefore: currentBalance,
              balanceAfter: newBalance,
              stripePaymentId: paymentIntent.id,
              expiresAt: expiresAt,
              description: `Credit deposit: $${amount}`,
            },
          }),
        ]);

        res.json({
          success: true,
          message: `Successfully added $${amount} to your account`,
          newBalance: newBalance,
          expiresAt: expiresAt,
          transaction: {
            id: transaction.id,
            amount: transaction.amount,
            createdAt: transaction.createdAt,
          },
        });
      } else {
        return res.status(400).json({
          error: "Payment failed. Please check your payment method.",
        });
      }
    } catch (error) {
      console.error("Add credits error:", error);
      Sentry.captureException(error);

      if (error.code === "card_declined") {
        return res.status(400).json({
          error: "Card declined. Please use a different payment method.",
        });
      }

      res.status(500).json({ error: "Failed to add credits" });
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
