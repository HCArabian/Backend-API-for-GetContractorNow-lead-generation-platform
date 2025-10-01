const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { calculateLeadScore } = require("./scoring");
const { assignContractorToLead } = require("./assignment");
const cookieParser = require("cookie-parser");
const {
  hashPassword,
  comparePassword,
  generateToken,
  contractorAuth,
} = require("./auth");

const app = express();
const path = require("path");

// Contractor portal route
app.get("/contractor", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
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

    const assignmentResult = await assignContractorToLead(savedLead.id, prisma);

    if (assignmentResult.success && assignmentResult.assigned) {
      console.log(
        "✅ Lead assigned to contractor:",
        assignmentResult.contractor.businessName
      );

      // Return success with assignment details
      return res.json({
        success: true,
        message: "Lead received, approved, and assigned to contractor",
        leadId: savedLead.id,
        category: savedLead.category,
        score: savedLead.score,
        assignment: {
          contractor: assignmentResult.contractor.businessName,
          responseDeadline: assignmentResult.assignment.responseDeadline,
        },
      });
    } else {
      console.log(
        "⚠️  Lead saved but not assigned:",
        assignmentResult.error || "No contractors available"
      );

      // Lead saved but couldn't assign
      return res.json({
        success: true,
        message: "Lead received and approved, but no contractors available",
        leadId: savedLead.id,
        category: savedLead.category,
        score: savedLead.score,
        warning:
          assignmentResult.error || "No contractors available in this area",
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
app.post('/api/webhooks/twilio/call-status', async (req, res) => {
  try {
    const {
      CallSid: callSid,
      CallStatus: callStatus,
      CallDuration: callDuration,
      From: from,
      To: to,
      Direction: direction,
      RecordingUrl: recordingUrl,
      RecordingSid: recordingSid
    } = req.body;

    console.log('📞 TWILIO WEBHOOK:', {
      callSid,
      callStatus,
      from,
      to: to,
      direction
    });

    // ============================================
    // HANDLE INCOMING CALLS - ROUTE BY NUMBER
    // ============================================
    
    if (!callStatus || callStatus === 'ringing' || callStatus === 'in-progress') {
      console.log('📞 Incoming call to:', to);
      
      // Find which lead this tracking number belongs to
      const assignment = await prisma.leadAssignment.findFirst({
        where: {
          trackingNumber: to
        },
        include: {
          lead: true,
          contractor: true
        }
      });
      
      if (!assignment) {
        console.error('❌ No assignment found for tracking number:', to);
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This tracking number is not currently assigned. Please contact support.</Say>
  <Hangup/>
</Response>`;
        return res.type('text/xml').send(twiml);
      }
      
      // Verify the caller is the assigned contractor
      const normalizedFrom = from.replace(/\D/g, '').slice(-10);
      const normalizedContractorPhone = assignment.contractor.phone.replace(/\D/g, '').slice(-10);
      
      if (normalizedFrom !== normalizedContractorPhone) {
        console.error('❌ Unauthorized caller for this tracking number');
        console.error(`   Expected: ${normalizedContractorPhone}, Got: ${normalizedFrom}`);
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This number is assigned to a different contractor.</Say>
  <Hangup/>
</Response>`;
        return res.type('text/xml').send(twiml);
      }
      
      const customerPhone = assignment.lead.customerPhone;
      console.log('✅ Routing call to customer:', customerPhone);
      
      // Forward call and record
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting your call, please wait.</Say>
  <Dial record="record-from-answer" recordingStatusCallback="${process.env.RAILWAY_URL}/api/webhooks/twilio/call-status">
    ${customerPhone}
  </Dial>
</Response>`;
      
      return res.type('text/xml').send(twiml);
    }

    // ============================================
    // HANDLE STATUS CALLBACKS (for billing)
    // ============================================
    
    if (!callSid) {
      return res.status(400).json({ error: 'Missing CallSid' });
    }

    // Find assignment by tracking number
    const assignment = await prisma.leadAssignment.findFirst({
      where: {
        trackingNumber: to
      },
      include: {
        lead: true,
        contractor: true
      }
    });
    
    if (!assignment) {
      console.error('❌ No assignment found for billing');
      return res.json({ success: true, message: 'No assignment found' });
    }
    
    const lead = assignment.lead;
    const contractor = assignment.contractor;

    console.log('✅ Processing call for lead:', lead.id);

    // Create or update CallLog
    const callLog = await prisma.callLog.upsert({
      where: {
        callSid: callSid
      },
      update: {
        callStatus: callStatus,
        callEndedAt: callStatus === 'completed' ? new Date() : null,
        callDuration: callDuration ? parseInt(callDuration) : null,
        recordingUrl: recordingUrl || null,
        recordingSid: recordingSid || null,
      },
      create: {
        callSid: callSid,
        leadId: lead.id,
        contractorId: contractor.id,
        callDirection: 'contractor_to_customer',
        trackingNumber: to,
        callStartedAt: new Date(),
        callEndedAt: callStatus === 'completed' ? new Date() : null,
        callDuration: callDuration ? parseInt(callDuration) : null,
        callStatus: callStatus,
        recordingUrl: recordingUrl || null,
        recordingSid: recordingSid || null,
      }
    });

    console.log('✅ CallLog:', callLog.id, 'Duration:', callDuration);

    // BILLING LOGIC
    if (callStatus === 'completed' && callDuration && parseInt(callDuration) > 30) {
      
      console.log('💰 Call qualifies for billing');

      // Check for existing billing
      const existingBilling = await prisma.billingRecord.findFirst({
        where: {
          leadId: lead.id,
          contractorId: contractor.id
        }
      });

      if (existingBilling) {
        console.log('⚠️  Billing already exists');
        
        // Release tracking number back to pool (contacted successfully)
        await prisma.twilioNumberPool.updateMany({
          where: {
            phoneNumber: to,
            status: 'assigned'
          },
          data: {
            status: 'available',
            currentLeadId: null,
            assignedAt: null,
            expiresAt: null
          }
        });
        
        console.log('✅ Tracking number released back to pool');
        
        return res.json({ 
          success: true, 
          message: 'Call logged - billing exists',
          callLogId: callLog.id 
        });
      }

      // Create billing record
      const billingRecord = await prisma.billingRecord.create({
        data: {
          leadId: lead.id,
          contractorId: contractor.id,
          amountOwed: lead.price,
          status: 'pending',
          dateIncurred: new Date()
        }
      });

      console.log('🎉 BILLING CREATED:', {
        billingId: billingRecord.id,
        amount: `$${lead.price}`,
        lead: lead.id
      });

      // Update lead status
      await prisma.lead.update({
        where: { id: lead.id },
        data: { 
          status: 'contacted',
          firstContactAt: new Date()
        }
      });

      // Update assignment status
      await prisma.leadAssignment.update({
        where: { id: assignment.id },
        data: { 
          status: 'contacted'
        }
      });

      // Release tracking number back to pool
      await prisma.twilioNumberPool.updateMany({
        where: {
          phoneNumber: to,
          status: 'assigned'
        },
        data: {
          status: 'available',
          currentLeadId: null,
          assignedAt: null,
          expiresAt: null
        }
      });

      console.log('✅ Tracking number released back to pool');

      return res.json({ 
        success: true,
        message: 'Call logged and billing created',
        callLogId: callLog.id,
        billingRecordId: billingRecord.id,
        amount: lead.price
      });
    }

    return res.json({ 
      success: true,
      message: 'Call logged - no billing',
      callLogId: callLog.id,
      reason: callDuration ? `Duration: ${callDuration}s` : 'No duration'
    });

  } catch (error) {
    console.error('❌ WEBHOOK ERROR:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
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
        status: true,
      },
      orderBy: {
        businessName: "asc",
      },
    });

    res.json({ success: true, contractors });
  } catch (error) {
    console.error("Error fetching contractors:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
app.post("/api/contractor/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Find contractor
    const contractor = await prisma.contractor.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!contractor) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Check password
    const isValidPassword = await comparePassword(
      password,
      contractor.passwordHash
    );

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Check if account is active
    if (contractor.status !== "active") {
      return res
        .status(403)
        .json({ error: "Account is suspended or inactive" });
    }

    // Generate token
    const token = generateToken(contractor.id);

    // Update last active
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: { lastActiveAt: new Date() },
    });

    console.log("✅ Contractor logged in:", contractor.businessName);

    res.json({
      success: true,
      token,
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
        totalLeadsReceived: true,
        totalJobsCompleted: true,
        status: true,
        isAcceptingLeads: true,
        createdAt: true,
      },
    });

    if (!contractor) {
      return res.status(404).json({ error: "Contractor not found" });
    }

    res.json({ success: true, contractor });
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

    // Get tracking numbers for each lead
    const leadsWithTracking = await Promise.all(
      assignments.map(async (assignment) => {
        const trackingNumber = await prisma.trackingNumber.findFirst({
          where: {
            leadId: assignment.leadId,
            status: "active",
          },
        });

        return {
          ...assignment,
          trackingNumber: trackingNumber?.twilioNumber || null,
        };
      })
    );

    res.json({
      success: true,
      leads: leadsWithTracking,
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

      // Validate input
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

      // Get contractor
      const contractor = await prisma.contractor.findUnique({
        where: { id: req.contractorId },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }

      // Verify current password
      const isValidPassword = await comparePassword(
        currentPassword,
        contractor.passwordHash
      );

      if (!isValidPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Hash new password
      const newPasswordHash = await hashPassword(newPassword);

      // Update password
      await prisma.contractor.update({
        where: { id: req.contractorId },
        data: { passwordHash: newPasswordHash },
      });

      console.log(
        "✅ Password changed for contractor:",
        contractor.businessName
      );

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

    // Get lead details separately
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
          // Mark billing as credited
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
          // Reduce the amount owed
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
