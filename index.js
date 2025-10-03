const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { calculateLeadScore } = require("./scoring");
const { assignContractor } = require("./assignment");
const { createSetupIntent, savePaymentMethod } = require("./stripe-payments");
const cookieParser = require("cookie-parser");
const { sendFeedbackRequestEmail } = require("./notifications");
const crypto = require("crypto");
const { sendContractorOnboardingEmail } = require("./notifications");

const {
  hashPassword,
  comparePassword,
  generateToken,
  contractorAuth,
} = require("./auth");

const app = express();

// Trust Railway proxy
app.set("trust proxy", 1);

const path = require("path");

// Contractor portal route
app.get("/contractor", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/debug/check-env", (req, res) => {
  res.json({
    hasAdminPassword: !!process.env.ADMIN_PASSWORD,
    adminPasswordLength: process.env.ADMIN_PASSWORD?.length || 0,
    hasJwtSecret: !!process.env.JWT_SECRET,
    jwtSecretLength: process.env.JWT_SECRET?.length || 0,
  });
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

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // IMPORTANT: For Twilio webhooks
app.use(cookieParser());

// Rate limiter for most API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts, please try again later." },
});

// Apply rate limiting ONLY to public-facing endpoints
app.use("/api/leads/", apiLimiter);
app.use("/api/contractor/login", authLimiter);

// DO NOT apply rate limiting to admin or contractor authenticated routes

// Serve static files from public folder
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
        customerEmail: leadData.email,
        customerPhone: leadData.phone,
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
app.post("/api/webhooks/twilio/call-status", async (req, res) => {
  try {
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

    console.log("📞 TWILIO WEBHOOK:", {
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

    // BILLING LOGIC
    if (
      callStatus === "completed" &&
      callDuration &&
      parseInt(callDuration) > 30
    ) {
      console.log("💰 Call qualifies for billing");

      // Check for existing billing
      const existingBilling = await prisma.billingRecord.findFirst({
        where: {
          leadId: lead.id,
          contractorId: contractor.id,
        },
      });

      if (existingBilling) {
        console.log("⚠️  Billing already exists");

        // Release tracking number back to pool
        await prisma.twilioNumberPool.updateMany({
          where: {
            phoneNumber: to,
            status: "assigned",
          },
          data: {
            status: "available",
            currentLeadId: null,
            assignedAt: null,
            expiresAt: null,
          },
        });

        console.log("✅ Tracking number released back to pool");

        return res.json({
          success: true,
          message: "Call logged - billing exists",
          callLogId: callLog.id,
        });
      }

      // Create billing record
      const billingRecord = await prisma.billingRecord.create({
        data: {
          leadId: lead.id,
          contractorId: contractor.id,
          amountOwed: lead.price,
          status: "pending",
          dateIncurred: new Date(),
        },
      });

      console.log("🎉 BILLING CREATED:", {
        billingId: billingRecord.id,
        amount: `$${lead.price}`,
        lead: lead.id,
      });

      // Auto-charge contractor via Stripe
      const { chargeContractorForLead } = require("./stripe-payments");

      console.log("💳 Attempting to charge contractor via Stripe...");

      const chargeResult = await chargeContractorForLead(
        contractor.id,
        lead.id,
        lead.price,
        `${lead.category} Lead - ${lead.serviceType.replace(/_/g, " ")} in ${
          lead.customerCity
        }, ${lead.customerState}`
      );

      if (chargeResult.success) {
        console.log(
          "✅ Contractor charged successfully:",
          chargeResult.paymentIntentId
        );
      } else {
        console.error("❌ Auto-charge failed:", chargeResult.error);
        console.error("⚠️  Billing record marked as failed in database");

        // Optionally: Disable contractor if payment fails
        // await prisma.contractor.update({
        //   where: { id: contractor.id },
        //   data: { isAcceptingLeads: false }
        // });
      }

      // Update lead status
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: "contacted",
          firstContactAt: new Date(),
        },
      });

      // Update assignment status
      await prisma.leadAssignment.update({
        where: { id: assignment.id },
        data: {
          status: "contacted",
        },
      });

      // Release tracking number back to pool
      await prisma.twilioNumberPool.updateMany({
        where: {
          phoneNumber: to,
          status: "assigned",
        },
        data: {
          status: "available",
          currentLeadId: null,
          assignedAt: null,
          expiresAt: null,
        },
      });

      console.log("✅ Tracking number released back to pool");

      return res.json({
        success: true,
        message: "Call logged, billing created, and payment processed",
        callLogId: callLog.id,
        billingRecordId: billingRecord.id,
        paymentStatus: chargeResult.success ? "charged" : "failed",
        amount: lead.price,
      });
    }

    return res.json({
      success: true,
      message: "Call logged - no billing",
      callLogId: callLog.id,
      reason: callDuration ? `Duration: ${callDuration}s` : "No duration",
    });
  } catch (error) {
    console.error("❌ WEBHOOK ERROR:", error);
    return res.status(500).json({
      error: "Internal server error",
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

// Contractor login
// Contractor login
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
      requirePasswordChange: contractor.requirePasswordChange, // NEW
      contractor: {
        id: contractor.id,
        businessName: contractor.businessName,
        email: contractor.email,
        phone: contractor.phone,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Get contractor profile
app.get("/api/contractor/profile", contractorAuth, async (req, res) => {
  try {
    const contractor = await prisma.contractor.findUnique({
      where: { id: req.contractorId },
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
      where: { contractorId: req.contractorId },
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
app.get("/api/contractor/leads", contractorAuth, async (req, res) => {
  try {
    const { status } = req.query;

    const where = {
      contractorId: req.contractorId,
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
app.get("/api/contractor/billing", contractorAuth, async (req, res) => {
  try {
    const billingRecords = await prisma.billingRecord.findMany({
      where: {
        contractorId: req.contractorId,
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
  contractorAuth,
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

      const contractor = await prisma.contractor.findUnique({
        where: { id: req.contractorId },
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
        where: { id: req.contractorId },
        data: {
          passwordHash: newPasswordHash,
          requirePasswordChange: false, // Clear flag after password change
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
app.post("/api/contractor/disputes", contractorAuth, async (req, res) => {
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
        contractorId: req.contractorId,
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
        contractorId: req.contractorId,
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
        contractorId: req.contractorId,
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
});

// Get contractor's disputes
app.get("/api/contractor/disputes", contractorAuth, async (req, res) => {
  try {
    const disputes = await prisma.dispute.findMany({
      where: {
        contractorId: req.contractorId,
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
});

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
app.get("/api/contractor/feedback", contractorAuth, async (req, res) => {
  try {
    const feedback = await prisma.customerFeedback.findMany({
      where: {
        contractorId: req.contractorId,
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
      wouldRecommend: feedbackWithLeads.filter((f) => f.wouldRecommend === true)
        .length,
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
  contractorAuth,
  async (req, res) => {
    try {
      const setupIntent = await createSetupIntent(req.contractorId);

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
  contractorAuth,
  async (req, res) => {
    try {
      const { paymentMethodId } = req.body;

      await savePaymentMethod(req.contractorId, paymentMethodId);

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
app.get("/api/contractor/payment/status", contractorAuth, async (req, res) => {
  try {
    const contractor = await prisma.contractor.findUnique({
      where: { id: req.contractorId },
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
});

// Stripe webhook handler
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        console.log("Payment succeeded:", paymentIntent.id);

        // Update billing record
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

        // Mark billing as failed
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
  if (req.path.startsWith("/api/") && !host.includes("api.")) {
    return res
      .status(404)
      .json({ error: "API endpoints must use api subdomain" });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
