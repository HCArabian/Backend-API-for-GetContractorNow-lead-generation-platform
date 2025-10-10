// ============================================
// 1. ALL IMPORTS FIRST (MUST BE AT TOP)
// ============================================
require("dotenv").config();

const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const twilio = require("twilio");
const path = require("path");
const Sentry = require("@sentry/node");
const validator = require('validator');


// Your custom imports
const { calculateLeadScore } = require("./scoring");
const { assignContractor } = require("./assignment");
const { createSetupIntent, savePaymentMethod } = require("./stripe-payments");
const {
  sendFeedbackRequestEmail,
  sendContractorOnboardingEmail,
  sendLowCreditWarning,
  sendCreditDepletedEmail,
  sendLowCreditSMS,
} = require("./notifications");
const { hashPassword, comparePassword, generateToken } = require("./auth");
const { handleSubscriptionCreated } = require("./webhook-handler");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticateAdmin: newAdminAuth,
} = require("./admin-auth");
const {
  validateAndFormatPhone,
  validateEmail,
  validateLicenseNumber,
  validateAndFormatEIN,
  validateZipCode,
  validateState,
  validateCity,
  validateServiceZipCodes,
  validateWebsiteUrl,
  sanitizeBusinessName,
  validateServiceTypes,
  validateYearsInBusiness,
} = require("./utils/contractorValidation");
const {
  getLeadCostForContractor,
  canContractorReceiveLeads,
  getMinimumCreditBalance,
  getCreditExpiryDate,
  formatCurrency,
} = require("./subscription-helpers");
// Configure CORS properly
const allowedOrigins = [
  "https://www.getcontractornow.com",
  "https://getcontractornow.com",
  "https://your-webflow-site.webflow.io",
  "http://localhost:3000", // for local testing
];

// ============================================
// 2. INITIALIZE SENTRY
// ============================================
try {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 1.0,
    beforeSend(event, hint) {
      const error = hint.originalException;
      if (error && error.statusCode) {
        event.tags = event.tags || {};
        event.tags.statusCode = error.statusCode;
      }
      if (event.tags?.statusCode === 404) {
        return null;
      }
      return event;
    },
    ignoreErrors: [
      "Non-Error exception captured",
      "Navigation cancelled",
      "ResizeObserver loop limit exceeded",
    ],
  });
  console.log("✅ Sentry initialized successfully");
} catch (error) {
  console.error("⚠️ Sentry initialization failed:", error.message);
  console.log("Continuing without Sentry monitoring...");
}

// ============================================
// 3. SENTRY MONITORING HELPERS
// ============================================
function monitorWebhook(webhookType, operation) {
  if (!Sentry || !Sentry.startTransaction) {
    return {
      finish: () => {},
      setData: () => {},
    };
  }

  const transaction = Sentry.startTransaction({
    op: "webhook",
    name: `${webhookType}.${operation}`,
  });

  return {
    finish: (success = true) => {
      transaction.setStatus(success ? "ok" : "error");
      transaction.finish();
    },
    setData: (key, value) => {
      transaction.setData(key, value);
    },
  };
}

// Security event logging helper
async function logSecurityEvent(type, details) {
  try {
    console.log("🔒 SECURITY EVENT:", type, details);
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

// ============================================
// 4. SENTRY MIDDLEWARE (if available)
// ============================================
if (Sentry && Sentry.Handlers) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
  console.log("✅ Sentry request handlers attached");
} else {
  console.log("⚠️ Sentry handlers not available - skipping");
}

// Trust Railway proxy
app.set("trust proxy", 1);

// ============================================
// 5. WEBHOOK ROUTES FIRST - WITH SPECIFIC BODY PARSERS
// CRITICAL: These MUST come before express.json()
// ============================================

// ============================================
// STRIPE SUBSCRIPTION WEBHOOK
// ============================================
// ============================================
// STRIPE WEBHOOK - UNIFIED HANDLER
// ============================================
// Stripe Webhook Handler
// Stripe Webhook Handler
app.post(
  "/api/webhooks/stripe/subscription",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      console.log("✅ Stripe webhook received:", event.type);
    } catch (err) {
      console.error("❌ Webhook verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;

          console.log("📋 Checkout session completed");
          console.log("   - Session ID:", session.id);
          console.log("   - Customer ID:", session.customer);
          console.log("   - Subscription ID:", session.subscription);
          console.log("   - Metadata:", JSON.stringify(session.metadata));

          const contractorId = session.metadata?.contractorId;

          if (!contractorId) {
            console.error("❌ NO CONTRACTOR ID IN METADATA!");
            console.error(
              "Full session metadata:",
              JSON.stringify(session.metadata, null, 2)
            );
            return res
              .status(400)
              .json({ error: "Missing contractor ID in metadata" });
          }

          // Get subscription details from Stripe
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription
          );

          // Map package to tier
          const packageTierMap = {
            starter: "STARTER",
            pro: "PRO",
            elite: "ELITE",
          };
          const tier = packageTierMap[session.metadata?.packageId] || "PRO";

          console.log("💳 Updating contractor with Stripe info...");

          // Update contractor in database
          const updated = await prisma.contractor.update({
            where: { id: contractorId },
            data: {
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
              subscriptionStatus: "active",
              subscriptionTier: tier,
              subscriptionStartDate: new Date(
                subscription.current_period_start * 1000
              ),
              subscriptionEndDate: new Date(
                subscription.current_period_end * 1000
              ),
              status: "active",
              isAcceptingLeads: true,
              // Clear the package selection token since setup is complete
              packageSelectionToken: null,
              packageSelectionTokenExpiry: null,
            },
          });

          console.log("✅ CONTRACTOR ACTIVATED SUCCESSFULLY");
          console.log("   - ID:", updated.id);
          console.log("   - Business:", updated.businessName);
          console.log("   - Email:", updated.email);
          console.log("   - Stripe Customer:", updated.stripeCustomerId);
          console.log(
            "   - Stripe Subscription:",
            updated.stripeSubscriptionId
          );
          console.log("   - Tier:", updated.subscriptionTier);
          console.log("   - Status:", updated.subscriptionStatus);

          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object;
          console.log(
            "📝 Subscription updated:",
            subscription.id,
            "Status:",
            subscription.status
          );

          const contractor = await prisma.contractor.findFirst({
            where: { stripeSubscriptionId: subscription.id },
          });

          if (contractor) {
            let status = "inactive";
            if (subscription.status === "active") status = "active";
            else if (subscription.status === "canceled") status = "cancelled";
            else if (subscription.status === "past_due") status = "past_due";

            await prisma.contractor.update({
              where: { id: contractor.id },
              data: {
                subscriptionStatus: status,
                subscriptionEndDate: new Date(
                  subscription.current_period_end * 1000
                ),
                status:
                  subscription.status === "active" ? "active" : "inactive",
              },
            });

            console.log("✅ Updated subscription status to:", status);
          } else {
            console.warn(
              "⚠️ No contractor found for subscription:",
              subscription.id
            );
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          console.log("❌ Subscription deleted:", subscription.id);

          const contractor = await prisma.contractor.findFirst({
            where: { stripeSubscriptionId: subscription.id },
          });

          if (contractor) {
            await prisma.contractor.update({
              where: { id: contractor.id },
              data: {
                subscriptionStatus: "cancelled",
                subscriptionEndDate: new Date(),
                status: "inactive",
                isAcceptingLeads: false,
              },
            });

            console.log(
              "✅ Subscription cancelled for:",
              contractor.businessName
            );
          }
          break;
        }

        case "invoice.payment_succeeded": {
          const invoice = event.data.object;
          console.log("💰 Payment succeeded for invoice:", invoice.id);

          if (invoice.subscription) {
            const contractor = await prisma.contractor.findFirst({
              where: { stripeSubscriptionId: invoice.subscription },
            });

            if (contractor && contractor.subscriptionStatus !== "active") {
              await prisma.contractor.update({
                where: { id: contractor.id },
                data: {
                  subscriptionStatus: "active",
                  status: "active",
                  isAcceptingLeads: true,
                },
              });

              console.log(
                "✅ Activated subscription after payment for:",
                contractor.businessName
              );
            }
          }
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;
          console.log("❌ Payment failed for invoice:", invoice.id);

          if (invoice.subscription) {
            const contractor = await prisma.contractor.findFirst({
              where: { stripeSubscriptionId: invoice.subscription },
            });

            if (contractor) {
              await prisma.contractor.update({
                where: { id: contractor.id },
                data: {
                  subscriptionStatus: "past_due",
                  isAcceptingLeads: false,
                },
              });

              console.log("⚠️ Payment failed for:", contractor.businessName);

              // TODO: Send payment failed email notification
            }
          }
          break;
        }

        default:
          console.log(`ℹ️ Unhandled event type: ${event.type}`);
      }

      // Always acknowledge receipt
      res.json({ received: true });
    } catch (error) {
      console.error("❌ Error processing webhook:", error);
      Sentry.captureException(error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============================================
// SENDGRID WEBHOOK
// ============================================
app.post(
  "/api/webhooks/sendgrid",
  express.json(), // ✅ SendGrid sends JSON
  async (req, res) => {
    try {
      const signature = req.headers["x-twilio-email-event-webhook-signature"];
      const timestamp = req.headers["x-twilio-email-event-webhook-timestamp"];

      if (signature && process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY) {
        const payload = timestamp + JSON.stringify(req.body);
        const expectedSignature = crypto
          .createHmac("sha256", process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY)
          .update(payload)
          .digest("base64");

        if (signature !== expectedSignature) {
          console.error("❌ Invalid SendGrid signature");
          return res.status(403).json({ error: "Invalid signature" });
        }
      }

      const events = req.body;
      console.log(`📧 SendGrid webhook: ${events.length} events`);

      for (const event of events) {
        const { email, event: eventType, reason, timestamp } = event;

        if (eventType === "bounce" || eventType === "dropped") {
          // Handle contractor bounces
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

          // Handle lead bounces
          const leads = await prisma.lead.findMany({
            where: { customerEmail: email.toLowerCase() },
          });

          if (leads.length > 0) {
            await prisma.lead.updateMany({
              where: { customerEmail: email.toLowerCase() },
              data: { customerEmailBounced: true },
            });
            console.log(`✅ Marked ${leads.length} lead(s) email as bounced`);
          }
        }
      }

      res.json({ received: true });
    } catch (error) {
      console.error("❌ SendGrid webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

// ============================================
// TWILIO WEBHOOK - CALL STATUS
// ============================================
app.post(
  "/api/webhooks/twilio/call-status",
  express.urlencoded({ extended: false }), // ✅ CRITICAL: Twilio sends form data
  async (req, res) => {
    const monitor = monitorWebhook("twilio", "call_status");

    try {
      // Test mode bypass
      const testSecret = req.query.test;
      const isTestMode = testSecret && testSecret === process.env.CRON_SECRET;

      if (!isTestMode) {
        // Verify Twilio signature
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
          console.error("❌ Invalid Twilio signature");
          monitor.finish(false);
          return res.status(403).json({ error: "Invalid signature" });
        }
        console.log("✅ Twilio signature verified");
      } else {
        console.log("🧪 TEST MODE: Signature verification bypassed");
      }

      // Extract call data
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

      monitor.setData("callSid", callSid);
      monitor.setData("callStatus", callStatus);

      console.log("📞 TWILIO WEBHOOK:", {
        callSid,
        callStatus,
        from,
        to,
        direction,
      });

      // Handle incoming calls (ringing/in-progress)
      if (
        !callStatus ||
        callStatus === "ringing" ||
        callStatus === "in-progress"
      ) {
        const assignment = await prisma.leadAssignment.findFirst({
          where: { trackingNumber: to },
          include: { lead: true, contractor: true },
        });

        if (!assignment) {
          console.error("❌ No assignment found for:", to);
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This tracking number is not currently assigned.</Say>
  <Hangup/>
</Response>`;
          return res.type("text/xml").send(twiml);
        }

        // Verify caller is the assigned contractor
        const normalizedFrom = from.replace(/\D/g, "").slice(-10);
        const normalizedContractorPhone = assignment.contractor.phone
          .replace(/\D/g, "")
          .slice(-10);

        if (normalizedFrom !== normalizedContractorPhone) {
          console.error("❌ Unauthorized caller");
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This number is assigned to a different contractor.</Say>
  <Hangup/>
</Response>`;
          return res.type("text/xml").send(twiml);
        }

        // Forward call to customer
        const customerPhone = assignment.lead.customerPhone;
        console.log("✅ Routing call to:", customerPhone);

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting your call, please wait.</Say>
  <Dial record="record-from-answer" recordingStatusCallback="${process.env.RAILWAY_URL}/api/webhooks/twilio/call-status">
    ${customerPhone}
  </Dial>
</Response>`;

        return res.type("text/xml").send(twiml);
      }

      // Handle status callbacks (billing)
      if (!callSid) {
        return res.status(400).json({ error: "Missing CallSid" });
      }

      const assignment = await prisma.leadAssignment.findFirst({
        where: { trackingNumber: to },
        include: { lead: true, contractor: true },
      });

      if (!assignment) {
        console.log("ℹ️ No assignment found for billing");
        return res.json({ success: true, message: "No assignment found" });
      }

      const lead = assignment.lead;
      const contractor = assignment.contractor;

      // Log the call
      const callLog = await prisma.callLog.upsert({
        where: { callSid: callSid },
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

      console.log("✅ CallLog created:", callLog.id);

      // Bill for qualified calls (30+ seconds, completed)
      if (
        callStatus === "completed" &&
        callDuration &&
        parseInt(callDuration) >= 30
      ) {
        console.log("💰 Qualified call - processing billing");

        const fullContractor = await prisma.contractor.findUnique({
          where: { id: contractor.id },
        });

        // Check if already billed
        const existingBilling = await prisma.billingRecord.findFirst({
          where: {
            leadId: lead.id,
            contractorId: contractor.id,
          },
        });

        if (existingBilling) {
          console.log("⚠️ Already billed for this lead");
          return res.json({
            success: true,
            message: "Call logged (already billed)",
            callLogId: callLog.id,
          });
        }

        // Check active subscription
        if (fullContractor.subscriptionStatus !== "active") {
          console.log("❌ No active subscription");
          return res.json({
            success: true,
            message: "Call logged (no active subscription)",
            callLogId: callLog.id,
          });
        }

        const leadCost = getLeadCostForContractor(fullContractor);

        // Check sufficient credit
        if (fullContractor.creditBalance < leadCost) {
          console.log("❌ Insufficient credit");
          await prisma.contractor.update({
            where: { id: fullContractor.id },
            data: { isAcceptingLeads: false },
          });
          return res.json({
            success: true,
            message: "Call logged (insufficient credit)",
            callLogId: callLog.id,
          });
        }

        // Deduct credit
        const finalBalance = Math.max(
          0,
          fullContractor.creditBalance - leadCost
        );

        await prisma.$transaction([
          prisma.creditTransaction.create({
            data: {
              contractorId: fullContractor.id,
              type: "deduction",
              amount: -leadCost,
              balanceBefore: fullContractor.creditBalance,
              balanceAfter: finalBalance,
              leadId: lead.id,
              description: `Lead charge: ${lead.customerFirstName} ${lead.customerLastName}`,
            },
          }),
          prisma.contractor.update({
            where: { id: fullContractor.id },
            data: {
              creditBalance: finalBalance,
              isAcceptingLeads: finalBalance >= getMinimumCreditBalance(),
            },
          }),
          prisma.billingRecord.create({
            data: {
              leadId: lead.id,
              contractorId: fullContractor.id,
              amountOwed: leadCost,
              status: "paid",
              dateIncurred: new Date(),
              notes: `Paid from credit balance`,
            },
          }),
          prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: "contacted",
              firstContactAt: new Date(),
            },
          }),
          prisma.leadAssignment.update({
            where: { id: assignment.id },
            data: { status: "contacted" },
          }),
        ]);

        // Send low credit warnings
        const previousBalance = fullContractor.creditBalance;

        if (previousBalance > 100 && finalBalance <= 100) {
          await sendLowCreditWarning(fullContractor, finalBalance, 100);
        }
        if (previousBalance > 50 && finalBalance <= 50) {
          await sendLowCreditWarning(fullContractor, finalBalance, 50);
          await sendLowCreditSMS(fullContractor, finalBalance);
        }
        if (finalBalance <= 0) {
          await sendCreditDepletedEmail(fullContractor);
          await sendLowCreditSMS(fullContractor, 0);
        }

        console.log(`✅ Credit deducted: ${formatCurrency(leadCost)}`);

        monitor.finish(true);
        return res.json({
          success: true,
          message: "Call logged and charged",
          callLogId: callLog.id,
          charged: leadCost,
          newBalance: finalBalance,
        });
      }

      // Call did not qualify for billing
      console.log("ℹ️ Call did not qualify for billing");
      monitor.finish(true);
      return res.json({
        success: true,
        message: "Call logged - no billing",
        callLogId: callLog.id,
      });
    } catch (error) {
      monitor.finish(false);
      Sentry.captureException(error, {
        tags: { webhook: "twilio" },
      });
      console.error("❌ WEBHOOK ERROR:", error);
      return res.status(500).json({
        error: "Webhook processing failed",
        details: error.message,
      });
    }
  }
);
// ============================================
// 6. NOW ADD GLOBAL MIDDLEWARE FOR ALL OTHER ROUTES
// ============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) {
        console.log("Request with no origin - allowing");
        return callback(null, true);
      }

      console.log("Request from origin:", origin); // Debug log

      if (allowedOrigins.indexOf(origin) !== -1) {
        console.log("Origin allowed:", origin);
        callback(null, true);
      } else {
        console.log("Origin rejected:", origin);
        // ALLOW IT ANYWAY (for now) instead of rejecting
        callback(null, true); // Change this temporarily
        // callback(new Error('Not allowed by CORS')); // This was causing the error
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Sentry breadcrumbs
app.use((req, res, next) => {
  Sentry.addBreadcrumb({
    message: req.url,
    category: "request",
    level: "info",
  });
  next();
});

// Static files
app.use(express.static("public"));

/* // Stripe webhook handler
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
); */

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

app.get("/contractor-app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "contractor-form.html"));
});

app.get("/api/debug/check-env", (req, res) => {
  res.json({
    hasAdminPassword: !!process.env.ADMIN_PASSWORD,
    adminPasswordLength: process.env.ADMIN_PASSWORD?.length || 0,
    hasJwtSecret: !!process.env.JWT_SECRET,
    jwtSecretLength: process.env.JWT_SECRET?.length || 0,
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET, // ✅ ADDED
    webhookSecretLength: process.env.STRIPE_WEBHOOK_SECRET?.length || 0, // ✅ ADDED
    hasStripeKey: !!process.env.STRIPE_SECRET_KEY_TEST, // ✅ BONUS CHECK
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

// ============================================
// ADMIN API ENDPOINTS
// ============================================

// Get all billing records with filters
app.get("/api/admin/billing", newAdminAuth, async (req, res) => {
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
/* app.post("/api/webhooks/twilio/call-status", async (req, res) => {
  const monitor = monitorWebhook("twilio", "call_status");

  try {
    // ✅ TEST MODE: Skip signature verification if test parameter provided
    const isTestMode = req.query.test === process.env.CRON_SECRET;
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
      monitor.finish(false); // ✅ ADD THIS
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

    monitor.setData("callSid", callSid); // ✅ ADD THIS
    monitor.setData("callStatus", callStatus); // ✅ ADD THIS

    console.log("📞 TWILIO WEBHOOK (verified):", {
      callSid,
      callStatus,
      from,
      to: to,
      direction,
    }); */

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// Get single billing record
app.get("/api/admin/billing/:id", newAdminAuth, async (req, res) => {
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
app.patch("/api/admin/billing/:id", newAdminAuth, async (req, res) => {
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
app.get("/api/admin/contractors", newAdminAuth, async (req, res) => {
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
app.post(
  "/api/admin/contractors/:id/suspend",
  newAdminAuth,
  async (req, res) => {
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
  }
);

// Reactivate contractor (admin)
app.post(
  "/api/admin/contractors/:id/reactivate",
  newAdminAuth,
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
app.get("/api/admin/stats", newAdminAuth, async (req, res) => {
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
app.get("/api/admin/disputes", newAdminAuth, async (req, res) => {
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
app.patch("/api/admin/disputes/:id", newAdminAuth, async (req, res) => {
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
app.get("/api/admin/feedback", newAdminAuth, async (req, res) => {
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
        feedback: {  // ✅ CORRECT - lowercase
          none: {}, // No feedback submitted yet
        },
        customerEmailBounced: false, // ✅ ADDED - Don't email bounced addresses
      },
      include: {
        assignment: {  // ✅ ADDED - Need contractor info for email
          include: {
            contractor: true
          }
        }
      }
    });

    console.log(`Found ${leads.length} leads eligible for feedback emails`);

    let sent = 0;
    let failed = 0;
    
    for (const lead of leads) {
      // ✅ ADDED - Skip if no contractor assigned
      if (!lead.assignment || !lead.assignment.contractor) {
        console.log(`⚠️ Lead ${lead.id} has no contractor - skipping`);
        continue;
      }

      const result = await sendFeedbackRequestEmail(lead);
      if (result.success) {
        sent++;
      } else {
        failed++;
      }
    }

    console.log(`✅ Feedback emails sent: ${sent}, Failed: ${failed}`);

    res.json({
      success: true,
      totalEligible: leads.length,
      sent: sent,
      failed: failed
    });
  } catch (error) {
    console.error("Feedback email cron error:", error);
    
    // ✅ ADDED - Report to Sentry
    if (typeof Sentry !== 'undefined') {
      Sentry.captureException(error, {
        tags: { cron: 'feedback_emails' }
      });
    }
    
    res.status(500).json({ 
      error: "Failed to send feedback emails",
      message: error.message 
    });
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
// Approve contractor and send onboarding email
app.post(
  "/api/admin/contractors/:id/approve",
  newAdminAuth,
  async (req, res) => {
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

      // Generate package selection token (valid for 7 days)
      const packageSelectionToken = crypto.randomBytes(32).toString("hex");
      const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Update contractor
      const updatedContractor = await prisma.contractor.update({
        where: { id: contractorId },
        data: {
          status: "approved", // Will become "active" after payment
          isVerified: true,
          passwordHash: hashedPassword,
          requirePasswordChange: true,
          isApproved: true,
          packageSelectionToken: packageSelectionToken,
          packageSelectionTokenExpiry: tokenExpiry,
          subscriptionStatus: "inactive", // Will become "active" after payment
        },
      });

      // Build package selection URL
      const packageSelectionUrl = `${process.env.FRONTEND_URL}/select-package?token=${packageSelectionToken}`;

      // Send onboarding email with package selection URL
      await sendContractorOnboardingEmail(
        updatedContractor,
        tempPassword,
        packageSelectionUrl
      );

      console.log("✅ Contractor approved:", updatedContractor.businessName);
      console.log("   Package selection URL:", packageSelectionUrl);

      res.json({
        success: true,
        message: "Contractor approved and onboarding email sent",
        contractor: {
          id: updatedContractor.id,
          businessName: updatedContractor.businessName,
          email: updatedContractor.email,
          tempPassword: tempPassword, // For admin reference
          packageSelectionUrl: packageSelectionUrl, // For admin to test
        },
      });
    } catch (error) {
      console.error("Approval error:", error);
      Sentry.captureException(error);
      res.status(500).json({ error: "Failed to approve contractor" });
    }
  }
);

// Verify package selection token
app.get("/api/contractors/verify-token/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const contractor = await prisma.contractor.findUnique({
      where: { packageSelectionToken: token },
      select: {
        id: true,
        businessName: true,
        email: true,
        packageSelectionTokenExpiry: true,
        subscriptionStatus: true,
      },
    });

    if (!contractor) {
      return res.status(404).json({ error: "Invalid or expired token" });
    }

    // Check if token expired
    if (contractor.packageSelectionTokenExpiry < new Date()) {
      return res
        .status(400)
        .json({ error: "Token expired. Please contact support." });
    }

    // Check if already has active subscription
    if (contractor.subscriptionStatus === "active") {
      return res.status(400).json({
        error: "Subscription already active",
        redirectTo: "/dashboard",
      });
    }

    res.json({
      valid: true,
      contractorId: contractor.id,
      businessName: contractor.businessName,
      email: contractor.email,
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(500).json({ error: "Failed to verify token" });
  }
});

// Create Stripe checkout session from package selection
app.post("/api/contractors/create-checkout", async (req, res) => {
  try {
    const { token, packageId } = req.body;

    console.log("📦 Checkout request received:", {
      token: token?.substring(0, 10) + "...",
      packageId,
    });

    // Validate input
    if (!token || !packageId) {
      return res.status(400).json({
        success: false,
        error: "Token and packageId are required",
      });
    }

    // Validate package
    const validPackages = ["starter", "pro", "elite"];
    if (!validPackages.includes(packageId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid package. Must be starter, pro, or elite.",
      });
    }

    // Find contractor by token
    const contractor = await prisma.contractor.findUnique({
      where: { packageSelectionToken: token },
    });

    if (!contractor) {
      console.error("❌ Token not found:", token.substring(0, 10) + "...");
      return res.status(404).json({
        success: false,
        error: "Invalid or expired token",
      });
    }

    // Check token expiry
    if (contractor.packageSelectionTokenExpiry < new Date()) {
      console.error("❌ Token expired for contractor:", contractor.email);
      return res.status(400).json({
        success: false,
        error: "Token expired. Please contact support for a new link.",
      });
    }

    // Check if already has active subscription
    if (contractor.subscriptionStatus === "active") {
      console.warn(
        "⚠️ Contractor already has active subscription:",
        contractor.email
      );
      return res.status(400).json({
        success: false,
        error:
          "You already have an active subscription. Please login to your dashboard.",
        redirectTo: "/dashboard",
      });
    }

    // Map package to Stripe Price ID
    const priceMap = {
      starter: process.env.STRIPE_PRICE_STARTER,
      pro: process.env.STRIPE_PRICE_PRO,
      elite: process.env.STRIPE_PRICE_ELITE,
    };

    const priceId = priceMap[packageId];

    if (!priceId) {
      console.error("❌ Price ID not configured for package:", packageId);
      return res.status(500).json({
        success: false,
        error: "Package pricing not configured. Please contact support.",
      });
    }

    console.log("✅ Creating checkout session:");
    console.log("   - Contractor:", contractor.businessName);
    console.log("   - Email:", contractor.email);
    console.log("   - Package:", packageId);
    console.log("   - Price ID:", priceId);

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/select-package?token=${token}&package=${packageId}&cancelled=true`,

      // ⭐ CRITICAL: Pass contractor ID in metadata
      metadata: {
        contractorId: contractor.id,
        packageId: packageId,
        source: "package_selection",
        businessName: contractor.businessName,
      },

      // Pre-fill customer information
      customer_email: contractor.email,

      // Collect billing address
      billing_address_collection: "required",

      // Enable promotional codes
      allow_promotion_codes: true,

      // Subscription settings
      subscription_data: {
        metadata: {
          contractorId: contractor.id,
          packageId: packageId,
        },
      },
    });

    console.log("✅ Checkout session created successfully:", session.id);

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("❌ Checkout creation error:", error);
    Sentry.captureException(error);
    res.status(500).json({
      success: false,
      error:
        "Failed to create checkout session. Please try again or contact support.",
    });
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

// Get bounced emails (admin)
app.get("/api/admin/bounced-emails", newAdminAuth, async (req, res) => {
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

/*  // Remove this entire block:
app.get('/api/test-sentry', (req, res) => {
  try {
    throw new Error('Test error for Sentry');
  } catch (error) {
    Sentry.captureException(error);
    res.json({ message: 'Error sent to Sentry' });
  }
});  */

// Optional: Your own error handler after Sentry's
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* ### **Step 3: Add Backup Monitoring Endpoint**

 Add to `index.js`:
```javascript
// Database backup status (admin)
app.get('/api/admin/backup-status', newAdminAuth, async (req, res) => {
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
// ============================================
// CONTRACTOR DASHBOARD ENDPOINT - BULLETPROOF VERSION
// Replace your existing /api/contractor/dashboard with this
// ============================================

// ============================================
// DASHBOARD - LOADS FROM DATABASE ONLY
// Fast, reliable, no Stripe API calls!
// ============================================

app.get(
  "/api/contractor/dashboard",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;

      // ✅ SINGLE DATABASE QUERY - No Stripe calls!
      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
        select: {
          // Basic Info
          id: true,
          businessName: true,
          email: true,
          phone: true,
          creditBalance: true,
          status: true,

          // Subscription (from database!)
          subscriptionTier: true,
          subscriptionStatus: true,
          subscriptionStartDate: true,
          subscriptionEndDate: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,

          // Payment Method (last 4 only!)
          paymentMethodLast4: true,
          paymentMethodBrand: true,
          paymentMethodExpMonth: true,
          paymentMethodExpYear: true,

          // Service Info
          serviceZipCodes: true,
          specializations: true,

          // Profile
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

          // Status
          isVerified: true,
          verifiedAt: true,
          isAcceptingLeads: true,
          isApproved: true,
          isBetaTester: true,
          betaTesterLeadCost: true,

          // Stats
          avgResponseTime: true,
          conversionRate: true,
          customerRating: true,
          totalJobsCompleted: true,
          totalLeadsReceived: true,

          createdAt: true,
        },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }

      // Calculate pricing
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

      // Get leads this month
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
      });

      // Max leads by tier
      let maxLeads = 15;
      if (contractor.subscriptionTier === "pro") maxLeads = 40;
      if (contractor.subscriptionTier === "elite") maxLeads = 999;

      // ✅ BUILD RESPONSE - All from database!
      const response = {
        contractor: {
          id: contractor.id,
          businessName: contractor.businessName,
          email: contractor.email,
          phone: contractor.phone,
          creditBalance: contractor.creditBalance || 0,
          serviceZipCodes: contractor.serviceZipCodes || [],
          specializations: contractor.specializations || [],
          status: contractor.status,
        },
        subscription: {
          tier: contractor.subscriptionTier || "none",
          status: contractor.subscriptionStatus || "inactive",
          monthlyPrice: monthlyPrice,
          leadCost: leadCost,
          isBetaTester: contractor.isBetaTester || false,
          stripeSubscriptionId: contractor.stripeSubscriptionId,
          stripeCustomerId: contractor.stripeCustomerId,

          // ✅ Payment method (last 4 only!)
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
          licenseNumber: contractor.licenseNumber || "",
          licenseState: contractor.licenseState || "",
          licenseExpirationDate: contractor.licenseExpirationDate,
          businessAddress: contractor.businessAddress || "",
          businessCity: contractor.businessCity || "",
          businessState: contractor.businessState || "",
          businessZip: contractor.businessZip || "",
          taxId: contractor.taxId
            ? "***-**-" + contractor.taxId.slice(-4)
            : null,
          insuranceProvider: contractor.insuranceProvider || "",
          insurancePolicyNumber: contractor.insurancePolicyNumber || "",
          insuranceExpirationDate: contractor.insuranceExpirationDate,
          yearsInBusiness: contractor.yearsInBusiness,
          websiteUrl: contractor.websiteUrl || "",
          businessType: contractor.businessType || "",
          isVerified: contractor.isVerified || false,
          verifiedAt: contractor.verifiedAt,
          avgResponseTime: contractor.avgResponseTime,
          conversionRate: contractor.conversionRate,
          customerRating: contractor.customerRating,
          totalJobsCompleted: contractor.totalJobsCompleted || 0,
          totalLeadsReceived: contractor.totalLeadsReceived || 0,
          isAcceptingLeads: contractor.isAcceptingLeads || false,
          isApproved: contractor.isApproved || false,
          memberSince: contractor.createdAt,
        },
        stats: {
          leadsThisMonth: leadsThisMonth,
          maxLeadsPerMonth: maxLeads,
        },
        recentTransactions: recentTransactions,
      };

      console.log(
        `✅ Dashboard loaded (from database): ${contractor.businessName}`
      );

      res.json(response);
    } catch (error) {
      console.error("❌ Dashboard error:", error);
      res.status(500).json({ error: "Failed to load dashboard" });
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

// ============================================
// SUBSCRIPTION MANAGEMENT ENDPOINTS
// ============================================

// Get available subscription plans
app.get(
  "/api/contractor/subscription/plans",
  authenticateContractor,
  async (req, res) => {
    try {
      const plans = [
        {
          tier: "starter",
          name: "Starter",
          price: 99,
          leadCost: 75,
          maxLeads: 15,
          features: [
            "Up to 15 leads/month",
            "$75 per lead",
            "Basic support",
            "Email notifications",
          ],
        },
        {
          tier: "pro",
          name: "Pro",
          price: 125,
          leadCost: 100,
          maxLeads: 40,
          features: [
            "Up to 40 leads/month",
            "$100 per lead",
            "Priority support",
            "SMS + Email notifications",
            "Analytics dashboard",
          ],
        },
        {
          tier: "elite",
          name: "Elite",
          price: 200,
          leadCost: 250,
          maxLeads: 999,
          features: [
            "Unlimited leads",
            "$250 per premium lead",
            "Dedicated account manager",
            "All notifications",
            "Advanced analytics",
            "Custom integrations",
          ],
        },
      ];

      res.json({ plans });
    } catch (error) {
      console.error("Get plans error:", error);
      res.status(500).json({ error: "Failed to load plans" });
    }
  }
);

// Upgrade/downgrade subscription
app.post(
  "/api/contractor/subscription/change-plan",
  authenticateContractor,
  async (req, res) => {
    try {
      const { newTier } = req.body;
      const contractorId = req.contractor.id;

      if (!["starter", "pro", "elite"].includes(newTier)) {
        return res.status(400).json({ error: "Invalid subscription tier" });
      }

      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
      });

      if (!contractor.stripeSubscriptionId) {
        return res.status(400).json({ error: "No active subscription found" });
      }

      // Get the correct price ID for the new tier
      let priceId;
      if (newTier === "starter") priceId = process.env.STRIPE_PRICE_STARTER;
      else if (newTier === "pro") priceId = process.env.STRIPE_PRICE_PRO;
      else if (newTier === "elite") priceId = process.env.STRIPE_PRICE_ELITE;

      // Update subscription in Stripe
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);
      const subscription = await stripe.subscriptions.retrieve(
        contractor.stripeSubscriptionId
      );

      await stripe.subscriptions.update(contractor.stripeSubscriptionId, {
        items: [
          {
            id: subscription.items.data[0].id,
            price: priceId,
          },
        ],
        proration_behavior: "create_prorations", // Pro-rate the change
      });

      // Update in database
      await prisma.contractor.update({
        where: { id: contractorId },
        data: { subscriptionTier: newTier },
      });

      console.log(
        `✅ Subscription changed: ${contractor.businessName} → ${newTier}`
      );

      res.json({
        success: true,
        message: `Successfully changed to ${newTier.toUpperCase()} plan`,
        newTier: newTier,
      });
    } catch (error) {
      console.error("Change plan error:", error);
      Sentry.captureException(error);
      res.status(500).json({ error: "Failed to change plan" });
    }
  }
);

// Cancel subscription
app.post(
  "/api/contractor/subscription/cancel",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;
      const { reason } = req.body;

      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
      });

      if (!contractor.stripeSubscriptionId) {
        return res.status(400).json({ error: "No active subscription found" });
      }

      // Cancel subscription in Stripe (at period end)
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);
      await stripe.subscriptions.update(contractor.stripeSubscriptionId, {
        cancel_at_period_end: true,
        metadata: { cancellation_reason: reason || "Not provided" },
      });

      // Update database
      await prisma.contractor.update({
        where: { id: contractorId },
        data: {
          subscriptionStatus: "cancelling", // Will become 'cancelled' at period end
          isAcceptingLeads: false,
        },
      });

      console.log(`⚠️ Subscription cancelled: ${contractor.businessName}`);

      res.json({
        success: true,
        message:
          "Subscription will be cancelled at the end of your billing period",
        endsAt: contractor.subscriptionEndDate,
      });
    } catch (error) {
      console.error("Cancel subscription error:", error);
      Sentry.captureException(error);
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  }
);

// Reactivate cancelled subscription
app.post(
  "/api/contractor/subscription/reactivate",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;

      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
      });

      if (!contractor.stripeSubscriptionId) {
        return res.status(400).json({ error: "No subscription found" });
      }

      // Reactivate in Stripe
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);
      await stripe.subscriptions.update(contractor.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      // Update database
      await prisma.contractor.update({
        where: { id: contractorId },
        data: {
          subscriptionStatus: "active",
          isAcceptingLeads: contractor.creditBalance >= 500,
        },
      });

      console.log(`✅ Subscription reactivated: ${contractor.businessName}`);

      res.json({
        success: true,
        message: "Subscription reactivated successfully",
      });
    } catch (error) {
      console.error("Reactivate subscription error:", error);
      Sentry.captureException(error);
      res.status(500).json({ error: "Failed to reactivate subscription" });
    }
  }
);

// Get billing invoices from Stripe
app.get(
  "/api/contractor/subscription/invoices",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractor = await prisma.contractor.findUnique({
        where: { id: req.contractor.id },
      });

      if (!contractor.stripeCustomerId) {
        return res.json({ invoices: [] });
      }

      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);
      const invoices = await stripe.invoices.list({
        customer: contractor.stripeCustomerId,
        limit: 12,
      });

      const formattedInvoices = invoices.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        amount: inv.amount_paid / 100,
        status: inv.status,
        paidAt: inv.status_transitions.paid_at
          ? new Date(inv.status_transitions.paid_at * 1000)
          : null,
        createdAt: new Date(inv.created * 1000),
        invoicePdf: inv.invoice_pdf,
        hostedUrl: inv.hosted_invoice_url,
      }));

      res.json({ invoices: formattedInvoices });
    } catch (error) {
      console.error("Get invoices error:", error);
      res.status(500).json({ error: "Failed to load invoices" });
    }
  }
);

// ============================================
// BACKEND: Add to index.js
// ============================================

// Create Stripe Customer Portal session
app.post(
  "/api/contractor/payment/portal",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractor = await prisma.contractor.findUnique({
        where: { id: req.contractor.id },
      });

      // ✅ CHECK: If no Stripe customer, try to find it by email
      if (!contractor.stripeCustomerId) {
        console.log("⚠️ No stripeCustomerId found, searching by email...");

        const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);

        // Search for customer by email
        const customers = await stripe.customers.list({
          email: contractor.email,
          limit: 1,
        });

        if (customers.data.length > 0) {
          const stripeCustomer = customers.data[0];
          console.log("✅ Found Stripe customer:", stripeCustomer.id);

          // Update database with found customer ID
          await prisma.contractor.update({
            where: { id: contractor.id },
            data: { stripeCustomerId: stripeCustomer.id },
          });

          // Create portal session
          const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomer.id,
            return_url: `${
              process.env.RAILWAY_URL || "https://app.getcontractornow.com"
            }/contractor`,
          });

          return res.json({
            success: true,
            url: session.url,
          });
        }

        // Still no customer found
        console.error("❌ No Stripe customer found for:", contractor.email);
        return res.status(400).json({
          error:
            "No payment method found. Please contact support to link your account.",
        });
      }

      // Has stripeCustomerId - create portal normally
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);
      const session = await stripe.billingPortal.sessions.create({
        customer: contractor.stripeCustomerId,
        return_url: `${
          process.env.RAILWAY_URL || "https://app.getcontractornow.com"
        }/contractor`,
      });

      res.json({
        success: true,
        url: session.url,
      });
    } catch (error) {
      console.error("Portal session error:", error);
      Sentry.captureException(error);
      res.status(500).json({
        error: "Failed to create portal session",
        details: error.message,
      });
    }
  }
);

// ============================================
// CONTRACTOR APPLICATION SYSTEM
// Add to index.js after line 150 (after other routes)
// ============================================

// ============================================
// PUBLIC CONTRACTOR APPLICATION ENDPOINT
// ============================================

// ============================================
// 1. UPDATE CONTRACTOR APPLICATION ENDPOINT
// ============================================
// Replace your existing POST /api/contractors/apply with this:

// ============================================
// CONTRACTOR APPLICATION ENDPOINT - FIXED
// ============================================
// ============================================
// UPDATED CONTRACTOR APPLICATION ROUTE
// Place this in index.js, replacing existing route
// ============================================

app.post("/api/contractors/apply", async (req, res) => {
  try {
    const data = req.body;
    const validationErrors = [];

    console.log("📥 Received contractor application:", data.businessName);

    // ============================================
    // 1. VALIDATE BUSINESS NAME
    // ============================================
    const businessNameValidation = sanitizeBusinessName(data.businessName);
    if (!businessNameValidation.valid) {
      validationErrors.push(businessNameValidation.error);
    }
    const businessName = businessNameValidation.formatted;

    // ============================================
    // 2. VALIDATE EMAIL
    // ============================================
    const emailValidation = validateEmail(data.email);
    if (!emailValidation.valid) {
      validationErrors.push(emailValidation.error);
    }
    const email = emailValidation.normalized;

    // Check for duplicate email
    if (email) {
      const existingContractor = await prisma.contractor.findUnique({
        where: { email: email },
      });

      if (existingContractor) {
        return res.status(400).json({
          success: false,
          error: "An application already exists with this email address",
        });
      }
    }

    // ============================================
    // 3. VALIDATE PHONE NUMBER
    // ============================================
    const phoneValidation = validateAndFormatPhone(data.phone);
    if (!phoneValidation.valid) {
      validationErrors.push(phoneValidation.error);
    }
    const phone = phoneValidation.formatted;

    // ============================================
    // 4. VALIDATE BUSINESS ADDRESS
    // ============================================
    let businessCity = null;
    let businessState = null;
    let businessZip = null;

    if (data.businessCity) {
      const cityValidation = validateCity(data.businessCity);
      if (!cityValidation.valid) {
        validationErrors.push(`City: ${cityValidation.error}`);
      } else {
        businessCity = cityValidation.formatted;
      }
    }

    if (data.businessState) {
      const stateValidation = validateState(data.businessState);
      if (!stateValidation.valid) {
        validationErrors.push(`State: ${stateValidation.error}`);
      } else {
        businessState = stateValidation.formatted;
      }
    }

    if (data.businessZip) {
      const zipValidation = validateZipCode(data.businessZip);
      if (!zipValidation.valid) {
        validationErrors.push(`Business ZIP: ${zipValidation.error}`);
      } else {
        businessZip = zipValidation.formatted;
      }
    }

    // ============================================
    // 5. VALIDATE LICENSE INFORMATION
    // ============================================
    let licenseNumber = null;
    if (data.licenseNumber && data.licenseState) {
      const licenseValidation = validateLicenseNumber(
        data.licenseNumber,
        data.licenseState
      );
      if (!licenseValidation.valid) {
        validationErrors.push(`License: ${licenseValidation.error}`);
      } else {
        licenseNumber = licenseValidation.formatted;
      }
    }

    // ============================================
    // 6. VALIDATE TAX ID / EIN
    // ============================================
    const einValidation = validateAndFormatEIN(data.taxId);
    if (!einValidation.valid) {
      validationErrors.push(`Tax ID: ${einValidation.error}`);
    }
    const taxId = einValidation.formatted;
    // ============================================
    // 4B. VALIDATE GEOGRAPHY MATCHING (CRITICAL)
    // ============================================
    if (businessCity && businessState && businessZip) {
      console.log("🗺️  Validating geographic consistency...");

      try {
        const response = await fetch(
          `https://api.zippopotam.us/us/${businessZip}`
        );

        if (response.ok) {
          const data = await response.json();

          if (data.places && data.places.length > 0) {
            const zipState = data.places[0]["state abbreviation"];
            const zipCities = data.places.map((p) =>
              p["place name"].toLowerCase()
            );
            const enteredCity = businessCity.toLowerCase().trim();

            // Check state match
            if (zipState.toUpperCase() !== businessState.toUpperCase()) {
              validationErrors.push(
                `ZIP code ${businessZip} is in ${zipState}, not ${businessState}. Please verify your location.`
              );
            }

            // Check city match
            const cityMatch = zipCities.some(
              (zipCity) =>
                zipCity === enteredCity ||
                zipCity.includes(enteredCity) ||
                enteredCity.includes(zipCity)
            );

            if (!cityMatch) {
              const suggestedCity = data.places[0]["place name"];
              validationErrors.push(
                `ZIP code ${businessZip} is in ${suggestedCity}, ${zipState}. Did you mean ${suggestedCity}?`
              );
            }
          }
        } else {
          console.warn("⚠️  Could not verify ZIP code via API");
        }
      } catch (geoError) {
        console.warn("⚠️  Geographic validation API failed:", geoError.message);
        // Don't block application if API is down
      }
    }
    // ============================================
    // 6B. VALIDATE INSURANCE (CRITICAL)
    // ============================================
    console.log("🛡️  Validating insurance information...");

    // Insurance provider validation
    if (!data.insuranceProvider || data.insuranceProvider.trim().length < 2) {
      validationErrors.push("Insurance provider is required");
    } else {
      const knownProviders = [
        "State Farm",
        "Allstate",
        "Progressive",
        "GEICO",
        "Liberty Mutual",
        "Farmers",
        "Nationwide",
        "Travelers",
        "USAA",
        "American Family",
        "The Hartford",
        "Chubb",
        "Erie Insurance",
        "Next Insurance",
        "Hiscox",
        "Thimble",
        "BiBerk",
        "Insureon",
        "Pie Insurance",
      ];

      const providerLower = data.insuranceProvider.toLowerCase();
      const isKnown = knownProviders.some(
        (known) =>
          providerLower.includes(known.toLowerCase()) ||
          known.toLowerCase().includes(providerLower)
      );

      if (!isKnown) {
        console.warn("⚠️  Unknown insurance provider:", data.insuranceProvider);
        // Log for manual review but don't block
      }
    }

    // Insurance policy number validation
    if (
      !data.insurancePolicyNumber ||
      data.insurancePolicyNumber.trim().length < 5
    ) {
      validationErrors.push(
        "Insurance policy number is required (minimum 5 characters)"
      );
    } else {
      const cleanPolicy = data.insurancePolicyNumber.replace(/[\s\-]/g, "");

      // Check for suspicious patterns
      if (/^(0+|1+|9+|12345|00000|test)$/i.test(cleanPolicy)) {
        validationErrors.push("Invalid insurance policy number format");
      }

      // Policy numbers should be alphanumeric
      if (!/^[A-Z0-9\-\s]+$/i.test(data.insurancePolicyNumber)) {
        validationErrors.push(
          "Policy number should only contain letters, numbers, and dashes"
        );
      }
    }

    // Insurance expiration validation
    if (!data.insuranceExpirationDate) {
      validationErrors.push("Insurance expiration date is required");
    } else {
      const expiryDate = new Date(data.insuranceExpirationDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (isNaN(expiryDate.getTime())) {
        validationErrors.push("Invalid insurance expiration date");
      } else if (expiryDate < today) {
        validationErrors.push(
          "Insurance policy has expired. Current insurance is required."
        );
      } else if (
        expiryDate < new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
      ) {
        console.warn(
          "⚠️  Insurance expiring within 30 days:",
          data.insuranceExpirationDate
        );
        // Don't block but log for follow-up
      }
    }

    // ============================================
    // 7. VALIDATE WEBSITE URL
    // ✅ FIXED: Handle both 'website' and 'websiteUrl' from form
    // ============================================
    const websiteValidation = validateWebsiteUrl(
      data.website || data.websiteUrl
    );
    if (!websiteValidation.valid) {
      validationErrors.push(`Website: ${websiteValidation.error}`);
    }
    const websiteUrl = websiteValidation.formatted;

    // ============================================
    // 8. VALIDATE YEARS IN BUSINESS
    // ============================================
    const yearsValidation = validateYearsInBusiness(data.yearsInBusiness);
    if (!yearsValidation.valid) {
      validationErrors.push(yearsValidation.error);
    }
    const yearsInBusiness = yearsValidation.formatted;

    // ============================================
    // 9. VALIDATE SERVICE TYPES
    // ============================================
    const serviceTypesValidation = validateServiceTypes(data.serviceTypes);
    if (!serviceTypesValidation.valid) {
      validationErrors.push(serviceTypesValidation.error);
    }
    const serviceTypes = serviceTypesValidation.formatted;

    // ⚠️ IMPORTANT: Schema uses 'specializations' not 'serviceTypes'
    // Rename for Prisma compatibility
    const specializations = serviceTypes;

    // ============================================
    // 10. VALIDATE SERVICE ZIP CODES
    // ============================================
    const serviceZipsValidation = await validateServiceZipCodes(
      data.serviceZipCodes,
      businessZip
    );
    if (!serviceZipsValidation.valid) {
      validationErrors.push(serviceZipsValidation.error);
    }
    const serviceZipCodes = serviceZipsValidation.formatted;

    // ============================================
    // 11. VALIDATE LEGAL COMPLIANCE
    // ============================================
    if (!data.acceptedTerms) {
      validationErrors.push("You must accept the Terms of Service");
    }

    if (!data.acceptedTCPA) {
      validationErrors.push(
        "You must consent to receive SMS notifications (TCPA requirement)"
      );
    }

    if (!data.acceptedPrivacy) {
      validationErrors.push("You must accept the Privacy Policy");
    }

    // ============================================
    // CHECK FOR ANY VALIDATION ERRORS
    // ============================================
    if (validationErrors.length > 0) {
      console.log("❌ Validation errors:", validationErrors);
      return res.status(400).json({
        success: false,
        error: validationErrors[0],
        errors: validationErrors,
      });
    }

    // ============================================
    // 12. CREATE CONTRACTOR IN DATABASE
    // ✅ ALL FIELD NAMES MATCH PRISMA SCHEMA
    // ============================================
    console.log("✅ All validations passed, creating contractor...");

    const contractor = await prisma.contractor.create({
      data: {
        // Business Info - ✅ VERIFIED FIELD NAMES
        businessName: businessName,
        businessType: data.businessType || null,
        yearsInBusiness: yearsInBusiness,
        websiteUrl: websiteUrl, // ✅ FIXED: Schema uses websiteUrl, not website

        // Contact Info - ✅ VERIFIED FIELD NAMES
        email: email,
        phone: phone,

        // Address - ✅ VERIFIED FIELD NAMES
        businessAddress: data.businessAddress || "",
        businessCity: businessCity || "",
        businessState: businessState || "",
        businessZip: businessZip || "",

        // License & Tax - ✅ VERIFIED FIELD NAMES
        licenseNumber: licenseNumber || "",
        licenseState: data.licenseState || "",
        licenseExpirationDate: data.licenseExpirationDate
          ? new Date(data.licenseExpirationDate)
          : null,
        taxId: taxId,

        // Insurance (REQUIRED fields) - ✅ VERIFIED FIELD NAMES
        insuranceProvider: data.insuranceProvider, // Required - validation ensures it exists
        insurancePolicyNumber: data.insurancePolicyNumber, // Required - validation ensures it exists
        insuranceExpirationDate: data.insuranceExpirationDate
          ? new Date(data.insuranceExpirationDate)
          : null,

        // Service Info - ✅ VERIFIED FIELD NAMES
        specializations: specializations, // ✅ Schema uses 'specializations' not 'serviceTypes'
        serviceZipCodes: serviceZipCodes,
        description: data.description || "",

        // Application Status - ✅ VERIFIED FIELD NAMES
        status: "active",
        isVerified: false,
        applicationSubmittedAt: new Date(),

        // Legal Compliance - ✅ VERIFIED FIELD NAMES
        acceptedTermsAt: new Date(),
        acceptedTCPAAt: new Date(),
        privacyPolicyAcceptedAt: new Date(), // Was: acceptedPrivacyAt
        tcpaConsentText:
          "I consent to receive automated SMS notifications about new leads, account updates, and service messages from GetContractorNow. Message frequency varies. Message and data rates may apply. Reply STOP to cancel.",
        ipAddress: req.ip || req.headers["x-forwarded-for"] || "unknown",
        userAgent: req.headers["user-agent"] || "unknown",
        smsOptedOut: false,

        // Account Settings - ✅ VERIFIED FIELD NAMES
        subscriptionTier: "none",
        subscriptionStatus: "pending",
        creditBalance: 0,
        isAcceptingLeads: false,

        // Additional fields - ✅ VERIFIED FIELD NAMES
        referralSource: data.referralSource || "website",
        notes: data.notes || "",

        // ⚠️ NOTE: passwordHash is now optional (nullable) in schema
        // It will be set when admin approves the contractor
      },
    });

    // ============================================
    // 13. SEND CONFIRMATION EMAILS
    // ============================================
    try {
      const {
        sendApplicationConfirmation,
        sendAdminApplicationAlert,
      } = require("./notifications");

      await sendApplicationConfirmation(contractor);
      await sendAdminApplicationAlert(contractor);
    } catch (emailError) {
      console.error("⚠️  Email notification error:", emailError);
    }

    // ============================================
    // 14. SUCCESS RESPONSE
    // ============================================
    console.log("✅ Contractor application created successfully");
    console.log(`   ID: ${contractor.id}`);
    console.log(`   Business: ${contractor.businessName}`);
    console.log(`   Email: ${contractor.email}`);
    console.log(`   Phone: ${contractor.phone}`);
    console.log(`   Specializations: ${contractor.specializations.join(", ")}`);
    console.log(`   Service ZIPs: ${contractor.serviceZipCodes.join(", ")}`);

    res.json({
      success: true,
      message:
        "Application submitted successfully! An admin will review your application and send you login credentials within 24-48 hours.",
      applicationId: contractor.id,
    });
  } catch (error) {
    console.error("❌ Contractor application error:", error);

    // Handle Prisma errors
    if (error.code === "P2002") {
      return res.status(400).json({
        success: false,
        error: "An application already exists with this email address",
      });
    }

    if (error.code === "P2003") {
      return res.status(400).json({
        success: false,
        error: "Invalid data provided. Please check all fields.",
      });
    }

    // Log the full error for debugging
    console.error("Full error details:", error);

    res.status(500).json({
      success: false,
      error:
        "Failed to submit application. Please try again or contact support.",
    });
  }
});

// ============================================
// LEGAL COMPLIANCE ENDPOINTS
// ============================================

// Twilio SMS Opt-Out Handler (STOP/START commands)
app.post("/api/webhooks/twilio/sms-optout", async (req, res) => {
  try {
    const { From: from, Body: body } = req.body;
    const twilioSignature = req.headers["x-twilio-signature"];
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

    const isValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      twilioSignature,
      url,
      req.body
    );

    if (!isValid) {
      console.error("❌ Invalid Twilio SMS signature");
      return res.status(403).send("Forbidden");
    }

    const normalizedPhone = from.replace(/\D/g, "").slice(-10);
    const message = body.trim().toUpperCase();

    const contractor = await prisma.contractor.findFirst({
      where: { phone: { endsWith: normalizedPhone } },
    });

    if (!contractor) {
      return res.status(200).send("OK");
    }

    // Handle STOP
    if (["STOP", "UNSUBSCRIBE", "CANCEL", "QUIT", "END"].includes(message)) {
      await prisma.contractor.update({
        where: { id: contractor.id },
        data: { smsOptedOut: true, smsOptOutAt: new Date() },
      });

      console.log(`✅ SMS opt-out: ${contractor.businessName}`);

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been unsubscribed from SMS notifications. Reply START to resubscribe.</Message>
</Response>`;

      return res.type("text/xml").send(twiml);
    }

    // Handle START
    if (["START", "UNSTOP", "SUBSCRIBE", "YES"].includes(message)) {
      await prisma.contractor.update({
        where: { id: contractor.id },
        data: {
          smsOptedOut: false,
          smsOptOutAt: null,
          acceptedTCPAAt: new Date(),
        },
      });

      console.log(`✅ SMS opt-in: ${contractor.businessName}`);

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been resubscribed to SMS notifications from GetContractorNow.</Message>
</Response>`;

      return res.type("text/xml").send(twiml);
    }

    // Handle HELP
    if (["HELP", "INFO"].includes(message)) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>GetContractorNow: Receive HVAC leads via SMS. Msg&data rates may apply. Reply STOP to cancel. Contact: support@getcontractornow.com</Message>
</Response>`;

      return res.type("text/xml").send(twiml);
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ SMS webhook error:", error);
    res.status(500).send("Error");
  }
});

// Privacy Policy Acceptance Logging
app.post("/api/contractors/log-privacy-acceptance", async (req, res) => {
  try {
    const { contractorId } = req.body;

    if (!contractorId) {
      return res.status(400).json({ error: "Contractor ID required" });
    }

    await prisma.contractor.update({
      where: { id: contractorId },
      data: {
        privacyPolicyAcceptedAt: new Date(),
        privacyPolicyVersion: "1.0",
      },
    });

    console.log(`✅ Privacy policy accepted: ${contractorId}`);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Privacy acceptance error:", error);
    res.status(500).json({ error: "Failed to log acceptance" });
  }
});

// Data Export (GDPR/CCPA)
app.get(
  "/api/contractor/data-export",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractor = await prisma.contractor.findUnique({
        where: { id: req.contractor.id },
        include: {
          leadAssignments: { include: { lead: true } },
          creditTransactions: true,
          billingRecords: true,
          callLogs: true,
        },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }

      const exportData = {
        businessInfo: {
          businessName: contractor.businessName,
          email: contractor.email,
          phone: contractor.phone,
        },
        accountInfo: {
          creditBalance: contractor.creditBalance,
          subscriptionTier: contractor.subscriptionTier,
        },
        legalCompliance: {
          termsAcceptedAt: contractor.acceptedTermsAt,
          tcpaAcceptedAt: contractor.acceptedTCPAAt,
          smsOptedOut: contractor.smsOptedOut,
        },
        leads: contractor.leadAssignments.length,
        transactions: contractor.creditTransactions.length,
      };

      res.json({ success: true, exportDate: new Date(), data: exportData });
    } catch (error) {
      console.error("❌ Data export error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  }
);

// Data Deletion Request (GDPR)
app.post(
  "/api/contractor/request-deletion",
  authenticateContractor,
  async (req, res) => {
    try {
      await prisma.contractor.update({
        where: { id: req.contractor.id },
        data: {
          deletionRequestedAt: new Date(),
          status: "pending_deletion",
          isAcceptingLeads: false,
        },
      });

      const { sendDeletionRequestAlert } = require("./notifications");
      await sendDeletionRequestAlert(req.contractor);

      console.log(`✅ Deletion request: ${req.contractor.businessName}`);

      res.json({
        success: true,
        message:
          "Deletion request received. Account will be reviewed within 30 days.",
      });
    } catch (error) {
      console.error("❌ Deletion request error:", error);
      res.status(500).json({ error: "Failed to process deletion request" });
    }
  }
);

// Admin Compliance Status
app.get("/api/admin/compliance/status", newAdminAuth, async (req, res) => {
  try {
    const contractors = await prisma.contractor.findMany({
      select: {
        id: true,
        businessName: true,
        email: true,
        acceptedTermsAt: true,
        acceptedTCPAAt: true,
        smsOptedOut: true,
        deletionRequestedAt: true,
      },
    });

    const summary = {
      total: contractors.length,
      fullyCompliant: contractors.filter(
        (c) => c.acceptedTermsAt && c.acceptedTCPAAt
      ).length,
      smsOptOuts: contractors.filter((c) => c.smsOptedOut).length,
      pendingDeletion: contractors.filter((c) => c.deletionRequestedAt).length,
    };

    res.json({ success: true, summary, contractors });
  } catch (error) {
    console.error("❌ Compliance status error:", error);
    res.status(500).json({ error: "Failed to fetch compliance status" });
  }
});

// ============================================
// ADMIN APPLICATION MANAGEMENT
// ============================================

// Get all contractor applications
app.get("/api/admin/applications", newAdminAuth, async (req, res) => {
  try {
    const { status, sortBy } = req.query;

    const where = {};
    if (status && status !== "all") {
      where.status = status;
    } else if (!status) {
      // Default: show only pending applications
      where.status = "pending";
    }

    const orderBy =
      sortBy === "oldest" ? { createdAt: "asc" } : { createdAt: "desc" };

    const applications = await prisma.contractor.findMany({
      where,
      orderBy,
      select: {
        id: true,
        businessName: true,
        ownerFirstName: true,
        ownerLastName: true,
        email: true,
        phone: true,
        businessCity: true,
        businessState: true,
        licenseNumber: true,
        licenseState: true,
        serviceZipCodes: true,
        specializations: true,
        status: true,
        isApproved: true,
        createdAt: true,
        applicationNotes: true,
        referralSource: true,
      },
    });

    // Count by status
    const [pending, approved, rejected] = await Promise.all([
      prisma.contractor.count({ where: { status: "pending" } }),
      prisma.contractor.count({
        where: { status: "active", isApproved: true },
      }),
      prisma.contractor.count({ where: { status: "rejected" } }),
    ]);

    res.json({
      success: true,
      applications,
      counts: {
        pending,
        approved,
        rejected,
        total: applications.length,
      },
    });
  } catch (error) {
    console.error("Get applications error:", error);
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});

// Get single application details
app.get("/api/admin/applications/:id", newAdminAuth, async (req, res) => {
  try {
    const application = await prisma.contractor.findUnique({
      where: { id: req.params.id },
    });

    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }

    res.json({
      success: true,
      application,
    });
  } catch (error) {
    console.error("Get application error:", error);
    res.status(500).json({ error: "Failed to fetch application" });
  }
});

// Approve contractor application
app.post(
  "/api/admin/applications/:id/approve",
  newAdminAuth,
  async (req, res) => {
    try {
      const { subscriptionTier, initialCredit, notes } = req.body;

      const contractor = await prisma.contractor.findUnique({
        where: { id: req.params.id },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Application not found" });
      }

      if (contractor.status === "active" && contractor.isApproved) {
        return res.status(400).json({ error: "Contractor already approved" });
      }

      // Generate temporary password
      const tempPassword = crypto.randomBytes(8).toString("hex");
      const passwordHash = await hashPassword(tempPassword);

      // Determine subscription tier (default to 'pro')
      const tier = subscriptionTier || "pro";
      const credit = initialCredit || 0;

      // Update contractor to active status
      const updatedContractor = await prisma.contractor.update({
        where: { id: req.params.id },
        data: {
          status: "active",
          isApproved: true,
          isVerified: true,
          isAcceptingLeads: true,
          passwordHash: passwordHash,
          requirePasswordChange: true,
          subscriptionStatus: "active",
          subscriptionTier: tier,
          subscriptionStartDate: new Date(),
          subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          creditBalance: credit,
          approvalNotes: notes || null,
        },
      });

      // If initial credit given, create transaction
      if (credit > 0) {
        await prisma.creditTransaction.create({
          data: {
            contractorId: updatedContractor.id,
            type: "deposit",
            amount: credit,
            balanceBefore: 0,
            balanceAfter: credit,
            description: "Initial credit upon approval",
          },
        });
      }

      // Send onboarding email with credentials
      await sendContractorOnboardingEmail(updatedContractor, tempPassword);

      console.log("✅ Contractor approved:", updatedContractor.businessName);

      res.json({
        success: true,
        message: "Contractor approved and onboarding email sent",
        contractor: {
          id: updatedContractor.id,
          businessName: updatedContractor.businessName,
          email: updatedContractor.email,
          tempPassword: tempPassword, // Return for admin reference
        },
      });
    } catch (error) {
      console.error("Approval error:", error);
      Sentry.captureException(error);
      res.status(500).json({ error: "Failed to approve contractor" });
    }
  }
);

// Reject contractor application
app.post(
  "/api/admin/applications/:id/reject",
  newAdminAuth,
  async (req, res) => {
    try {
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: "Rejection reason required" });
      }

      const contractor = await prisma.contractor.findUnique({
        where: { id: req.params.id },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Application not found" });
      }

      // Update to rejected status
      await prisma.contractor.update({
        where: { id: req.params.id },
        data: {
          status: "rejected",
          isApproved: false,
          rejectionReason: reason,
        },
      });

      // Send rejection email
      const { sendApplicationRejectionEmail } = require("./notifications");
      await sendApplicationRejectionEmail(contractor, reason);

      console.log("❌ Contractor rejected:", contractor.businessName);

      res.json({
        success: true,
        message: "Application rejected and notification sent",
      });
    } catch (error) {
      console.error("Rejection error:", error);
      res.status(500).json({ error: "Failed to reject application" });
    }
  }
);

// Request more information from applicant
app.post(
  "/api/admin/applications/:id/request-info",
  newAdminAuth,
  async (req, res) => {
    try {
      const { message, requestedFields } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message required" });
      }

      const contractor = await prisma.contractor.findUnique({
        where: { id: req.params.id },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Application not found" });
      }

      // Update status to under_review
      await prisma.contractor.update({
        where: { id: req.params.id },
        data: {
          status: "under_review",
          reviewNotes: message,
        },
      });

      // Send email requesting more information
      const { sendApplicationInfoRequestEmail } = require("./notifications");
      await sendApplicationInfoRequestEmail(
        contractor,
        message,
        requestedFields
      );

      console.log("📧 Info requested from:", contractor.businessName);

      res.json({
        success: true,
        message: "Information request sent to applicant",
      });
    } catch (error) {
      console.error("Request info error:", error);
      res.status(500).json({ error: "Failed to request information" });
    }
  }
);

// ============================================
// 2. TCPA COMPLIANCE - SMS OPT-OUT HANDLER
// ============================================

app.post("/api/webhooks/twilio/sms", async (req, res) => {
  try {
    const { From: from, Body: body } = req.body;

    // Verify Twilio signature for security
    const twilioSignature = req.headers["x-twilio-signature"];
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const twilio = require("twilio");

    const isValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      twilioSignature,
      url,
      req.body
    );

    if (!isValid) {
      console.error("❌ Invalid Twilio SMS signature");
      return res.status(403).send("Forbidden");
    }

    // Normalize phone number
    const normalizedPhone = from.replace(/\D/g, "").slice(-10);
    const message = body.trim().toUpperCase();

    // Find contractor by phone
    const contractor = await prisma.contractor.findFirst({
      where: {
        phone: {
          endsWith: normalizedPhone,
        },
      },
    });

    if (!contractor) {
      console.log("📱 SMS from unknown number:", from);
      return res.status(200).send("OK");
    }

    // ✅ Handle STOP command (TCPA requirement)
    if (
      message === "STOP" ||
      message === "UNSUBSCRIBE" ||
      message === "CANCEL" ||
      message === "QUIT" ||
      message === "END"
    ) {
      await prisma.contractor.update({
        where: { id: contractor.id },
        data: {
          smsOptedOut: true,
          smsOptOutAt: new Date(),
        },
      });

      console.log(`✅ SMS opt-out processed for ${contractor.businessName}`);

      // Send confirmation (Twilio requires this)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been unsubscribed from SMS notifications. You will no longer receive text messages from GetContractorNow. Reply START to resubscribe.</Message>
</Response>`;

      return res.type("text/xml").send(twiml);
    }

    // ✅ Handle START command (re-opt-in)
    if (
      message === "START" ||
      message === "UNSTOP" ||
      message === "SUBSCRIBE" ||
      message === "YES"
    ) {
      await prisma.contractor.update({
        where: { id: contractor.id },
        data: {
          smsOptedOut: false,
          smsOptOutAt: null,
          acceptedTCPAAt: new Date(), // Refresh consent timestamp
        },
      });

      console.log(`✅ SMS opt-in processed for ${contractor.businessName}`);

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been resubscribed to SMS notifications from GetContractorNow. Reply STOP to unsubscribe.</Message>
</Response>`;

      return res.type("text/xml").send(twiml);
    }

    // ✅ Handle HELP command (TCPA requirement)
    if (message === "HELP" || message === "INFO") {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>GetContractorNow: Receive exclusive HVAC leads via SMS. Msg&data rates may apply. Reply STOP to cancel, HELP for help. Contact: support@getcontractornow.com</Message>
</Response>`;

      return res.type("text/xml").send(twiml);
    }

    // For any other message, just acknowledge
    console.log(`📱 SMS received from ${contractor.businessName}: ${body}`);
    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ SMS webhook error:", error);
    res.status(500).send("Error");
  }
});

// ============================================
// 3. PRIVACY POLICY ACCEPTANCE LOGGING
// ============================================

app.post("/api/contractors/log-privacy-acceptance", async (req, res) => {
  try {
    const { contractorId } = req.body;

    if (!contractorId) {
      return res.status(400).json({
        success: false,
        error: "Contractor ID is required",
      });
    }

    await prisma.contractor.update({
      where: { id: contractorId },
      data: {
        privacyPolicyAcceptedAt: new Date(),
        privacyPolicyVersion: "1.0", // Update this when you update privacy policy
      },
    });

    console.log(`✅ Privacy policy accepted by contractor: ${contractorId}`);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Privacy acceptance error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to log acceptance",
    });
  }
});

// ============================================
// 4. DATA PRIVACY - CONTRACTOR DATA EXPORT (GDPR/CCPA)
// ============================================

app.get(
  "/api/contractor/data-export",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;

      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
        include: {
          leadAssignments: {
            include: {
              lead: true,
            },
          },
          creditTransactions: true,
          billingRecords: true,
          callLogs: true,
        },
      });

      if (!contractor) {
        return res.status(404).json({
          success: false,
          error: "Contractor not found",
        });
      }

      // Remove sensitive fields and format data
      const exportData = {
        businessInformation: {
          businessName: contractor.businessName,
          email: contractor.email,
          phone: contractor.phone,
          address: `${contractor.businessAddress}, ${contractor.businessCity}, ${contractor.businessState} ${contractor.businessZip}`,
          licenseNumber: contractor.licenseNumber,
          serviceZipCodes: contractor.serviceZipCodes,
          yearsInBusiness: contractor.yearsInBusiness,
          serviceTypes: contractor.serviceTypes,
          website: contractor.website,
          description: contractor.description,
        },
        accountInformation: {
          accountCreated: contractor.createdAt,
          accountStatus: contractor.status,
          subscriptionTier: contractor.subscriptionTier,
          subscriptionStatus: contractor.subscriptionStatus,
          creditBalance: contractor.creditBalance,
          isActive: contractor.isActive,
          isAcceptingLeads: contractor.isAcceptingLeads,
        },
        legalCompliance: {
          termsAcceptedAt: contractor.acceptedTermsAt,
          tcpaAcceptedAt: contractor.acceptedTCPAAt,
          privacyPolicyAcceptedAt: contractor.privacyPolicyAcceptedAt,
          privacyPolicyVersion: contractor.privacyPolicyVersion,
          smsOptedOut: contractor.smsOptedOut,
          smsOptOutAt: contractor.smsOptOutAt,
        },
        leadHistory: contractor.leadAssignments.map((assignment) => ({
          assignedAt: assignment.assignedAt,
          status: assignment.status,
          leadType: assignment.lead?.serviceType,
          cost: assignment.cost,
          customerLocation: `${assignment.lead?.customerCity}, ${assignment.lead?.customerState}`,
        })),
        transactionHistory: contractor.creditTransactions.map((txn) => ({
          date: txn.createdAt,
          type: txn.type,
          amount: txn.amount,
          description: txn.description,
          balanceAfter: txn.balanceAfter,
        })),
        billingHistory: contractor.billingRecords.map((bill) => ({
          date: bill.createdAt,
          amount: bill.amount,
          status: bill.status,
          type: bill.type,
        })),
        callHistory: contractor.callLogs.map((call) => ({
          date: call.createdAt,
          duration: call.duration,
          status: call.status,
          recordingUrl: call.recordingUrl ? "Available" : "Not available",
        })),
      };

      console.log(
        `✅ Data export generated for contractor: ${contractor.businessName}`
      );

      res.json({
        success: true,
        exportDate: new Date().toISOString(),
        data: exportData,
      });
    } catch (error) {
      console.error("❌ Data export error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to export data",
      });
    }
  }
);

// ============================================
// 5. DATA DELETION REQUEST (GDPR Right to be Forgotten)
// ============================================

app.post(
  "/api/contractor/request-deletion",
  authenticateContractor,
  async (req, res) => {
    try {
      const contractorId = req.contractor.id;
      const contractor = req.contractor;

      // Mark for deletion (don't delete immediately - need to preserve for legal/financial)
      await prisma.contractor.update({
        where: { id: contractorId },
        data: {
          deletionRequestedAt: new Date(),
          status: "pending_deletion",
          isAcceptingLeads: false,
          isActive: false,
        },
      });

      // Send email to admin for manual review
      const { sendDeletionRequestAlert } = require("./notifications");
      await sendDeletionRequestAlert(contractor);

      console.log(
        `✅ Deletion request received from: ${contractor.businessName}`
      );

      res.json({
        success: true,
        message:
          "Deletion request received. Your account will be reviewed and deleted within 30 days as required by law. You will receive a confirmation email.",
      });
    } catch (error) {
      console.error("❌ Deletion request error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process deletion request",
      });
    }
  }
);

// ============================================
// 6. CHECK SMS OPT-OUT STATUS BEFORE SENDING
// ============================================
// Add this helper function to use before sending any SMS

async function canSendSMS(contractorId) {
  const contractor = await prisma.contractor.findUnique({
    where: { id: contractorId },
    select: {
      smsOptedOut: true,
      phone: true,
      businessName: true,
    },
  });

  if (!contractor) {
    console.error("❌ Contractor not found:", contractorId);
    return false;
  }

  if (contractor.smsOptedOut) {
    console.log(
      `⚠️ SMS blocked - contractor opted out: ${contractor.businessName}`
    );
    return false;
  }

  if (!contractor.phone) {
    console.log(`⚠️ SMS blocked - no phone number: ${contractor.businessName}`);
    return false;
  }

  return true;
}

// ============================================
// ADMIN: DECLINE CONTRACTOR APPLICATION
// Add this to your index.js with other admin routes
// ============================================

app.post("/api/admin/contractors/:id/decline", async (req, res) => {
  try {
    // Verify admin authentication
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Please provide a reason for declining this application",
      });
    }

    const contractorId = req.params.id;

    // Get contractor details
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
    });

    if (!contractor) {
      return res.status(404).json({
        success: false,
        error: "Contractor not found",
      });
    }

    // Update contractor status to declined
    const updatedContractor = await prisma.contractor.update({
      where: { id: contractorId },
      data: {
        status: "declined",
        isVerified: false,
        isApproved: false,
        verificationNotes: reason,
        verifiedAt: new Date(), // Mark when decision was made
      },
    });

    // Send decline notification email
    try {
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      const msg = {
        to: contractor.email,
        from: "noreply@getcontractornow.com",
        subject: "GetContractorNow - Application Update",
        html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .info-box { background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Application Decision</h1>
    </div>
    <div class="content">
      <p>Dear ${contractor.businessName},</p>
      
      <p>Thank you for your interest in joining GetContractorNow. After reviewing your application, we regret to inform you that we are unable to approve your contractor account at this time.</p>
      
      <div class="info-box">
        <strong>Reason:</strong><br>
        ${reason}
      </div>
      
      <p><strong>What's Next?</strong></p>
      <ul>
        <li>You can reapply in the future once you've addressed the issues mentioned above</li>
        <li>Feel free to contact us if you have questions about this decision</li>
        <li>We appreciate your understanding and wish you success in your business</li>
      </ul>
      
      <p>If you believe this decision was made in error or would like to discuss further, please contact us at <a href="mailto:support@getcontractornow.com">support@getcontractornow.com</a>.</p>
      
      <p>Best regards,<br>
      The GetContractorNow Team</p>
    </div>
  </div>
</body>
</html>
        `,
      };

      await sgMail.send(msg);
      console.log(`✅ Decline notification sent to ${contractor.email}`);
    } catch (emailError) {
      console.error("⚠️  Failed to send decline email:", emailError);
      // Don't fail the request if email fails
    }

    console.log(
      `❌ Contractor application declined: ${contractor.businessName}`
    );
    console.log(`   Reason: ${reason}`);

    res.json({
      success: true,
      message: `Application declined. Notification email sent to ${contractor.email}.`,
      contractor: updatedContractor,
    });
  } catch (error) {
    console.error("❌ Error declining contractor:", error);
    res.status(500).json({
      success: false,
      error: "Failed to decline application. Please try again.",
    });
  }
});

// ============================================
// 8. ADMIN ENDPOINT TO VIEW COMPLIANCE STATUS
// ============================================

app.get("/api/admin/compliance/status", newAdminAuth, async (req, res) => {
  try {
    const contractors = await prisma.contractor.findMany({
      select: {
        id: true,
        businessName: true,
        email: true,
        acceptedTermsAt: true,
        acceptedTCPAAt: true,
        privacyPolicyAcceptedAt: true,
        smsOptedOut: true,
        smsOptOutAt: true,
        deletionRequestedAt: true,
        status: true,
      },
    });

    const summary = {
      totalContractors: contractors.length,
      fullyCompliant: contractors.filter(
        (c) =>
          c.acceptedTermsAt && c.acceptedTCPAAt && c.privacyPolicyAcceptedAt
      ).length,
      smsOptOuts: contractors.filter((c) => c.smsOptedOut).length,
      pendingDeletion: contractors.filter((c) => c.deletionRequestedAt).length,
      missingConsent: contractors.filter(
        (c) => !c.acceptedTermsAt || !c.acceptedTCPAAt
      ).length,
    };

    res.json({
      success: true,
      summary,
      contractors,
    });
  } catch (error) {
    console.error("❌ Compliance status error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch compliance status",
    });
  }
});

// ============================================
// ADMIN AUTHENTICATION ENDPOINTS
// ============================================

// Admin login
app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Find admin
    const admin = await prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!admin) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!admin.isActive) {
      return res.status(401).json({ error: "Admin account is inactive" });
    }

    // Verify password
    const isValid = await comparePassword(password, admin.passwordHash);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate tokens
    const accessToken = generateAccessToken(admin.id, admin.email, admin.role);
    const refreshToken = generateRefreshToken(admin.id);

    // Update last login
    await prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    console.log("✅ Admin logged in:", admin.email);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Refresh access token
app.post("/api/admin/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required" });
    }

    const decoded = verifyRefreshToken(refreshToken);

    if (!decoded) {
      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }

    // Verify admin still exists
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.adminId },
    });

    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: "Admin not found or inactive" });
    }

    // Generate new access token
    const accessToken = generateAccessToken(admin.id, admin.email, admin.role);

    res.json({
      success: true,
      accessToken,
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(500).json({ error: "Token refresh failed" });
  }
});

// Admin logout (optional - client-side can just delete tokens)
app.post("/api/admin/logout", newAdminAuth, async (req, res) => {
  res.json({ success: true, message: "Logged out successfully" });
});

// Get current admin info
app.get("/api/admin/me", newAdminAuth, async (req, res) => {
  res.json({
    success: true,
    admin: req.admin,
  });
});

// ============================================
// SENTRY ERROR HANDLER (MUST BE LAST)
// ============================================

// The error handler must be registered before any other error middleware and after all controllers
// SENTRY ERROR HANDLER (MUST BE LAST)
if (Sentry && Sentry.Handlers) {
  app.use(Sentry.Handlers.errorHandler());
  console.log("✅ Sentry error handler attached");
}

// Optional fallback error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
