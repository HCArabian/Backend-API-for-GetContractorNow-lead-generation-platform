// notifications.js - Email Notification System

const sgMail = require("@sendgrid/mail");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const FROM_EMAIL = process.env.FROM_EMAIL || 'team@getcontractornow.com';
const FROM_NAME = 'GetContractorNow';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@getcontractornow.com';
const PORTAL_URL = process.env.RAILWAY_URL || 'https://app.getcontractornow.com';

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Add this helper function at the top of notifications.js
async function shouldSendEmail(email) {
  // Check if contractor email is bounced
  const contractor = await prisma.contractor.findUnique({
    where: { email: email.toLowerCase() },
    select: { emailBounced: true, emailBounceReason: true },
  });

  if (contractor?.emailBounced) {
    console.log(
      `⚠️ Skipping email to bounced address: ${email} (${contractor.emailBounceReason})`
    );
    return false;
  }

  // Check if customer email is bounced
  const lead = await prisma.lead.findFirst({
    where: { customerEmail: email.toLowerCase() },
    select: { customerEmailBounced: true },
  });

  if (lead?.customerEmailBounced) {
    console.log(`⚠️ Skipping email to bounced customer address: ${email}`);
    return false;
  }

  return true;
}

// ============================================
// SEND NEW LEAD EMAIL TO CONTRACTOR
// ============================================

async function sendNewLeadEmail(contractor, lead, assignment, trackingNumber) {
  const emailSubject = `🎯 New ${
    lead.category
  } Lead - ${lead.serviceType.replace(/_/g, " ")} in ${lead.customerCity}`;

  try {
    console.log(`\n📧 Sending new lead email to ${contractor.businessName}...`);

    const responseTimeText =
      {
        PLATINUM: "20 minutes",
        GOLD: "2 hours",
        SILVER: "24 hours",
        BRONZE: "48 hours",
      }[lead.category] || "24 hours";

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
    .lead-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: bold; margin: 10px 0; }
    .platinum { background: #a78bfa; color: white; }
    .gold { background: #fbbf24; color: #1f2937; }
    .silver { background: #9ca3af; color: white; }
    .bronze { background: #d97706; color: white; }
    .tracking-box { background: #dbeafe; border: 2px solid #2563eb; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center; }
    .tracking-number { font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 2px; }
    .info-section { background: white; padding: 15px; margin: 15px 0; border-radius: 6px; border-left: 4px solid #2563eb; }
    .info-label { color: #6b7280; font-size: 12px; text-transform: uppercase; margin-bottom: 5px; }
    .info-value { font-size: 16px; font-weight: 600; color: #1f2937; }
    .urgent { background: #fee2e2; border-left-color: #dc2626; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
    .cta-button { display: inline-block; background: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 New Lead Assigned!</h1>
    </div>
    
    <div class="content">
      <div style="text-align: center;">
        <span class="lead-badge ${lead.category.toLowerCase()}">${
      lead.category
    } LEAD</span>
      </div>
      
      <div class="tracking-box">
        <div style="font-size: 14px; margin-bottom: 10px;">CALL CUSTOMER AT:</div>
        <div class="tracking-number">${trackingNumber}</div>
        <div style="margin-top: 10px; font-size: 12px; color: #6b7280;">
          This number tracks your call for billing
        </div>
      </div>
      
      <div class="info-section ${lead.category === "PLATINUM" ? "urgent" : ""}">
        <div class="info-label">⏰ Response Deadline</div>
        <div class="info-value">${new Date(
          assignment.responseDeadline
        ).toLocaleString()}</div>
        <div style="margin-top: 5px; font-size: 14px; color: #dc2626;">
          ${
            lead.category === "PLATINUM"
              ? "🔥 URGENT: Respond within " + responseTimeText
              : "Respond within " + responseTimeText
          }
        </div>
      </div>
      
      <h2 style="margin-top: 30px;">Customer Information</h2>
      
      <div class="info-section">
        <div class="info-label">Customer Name</div>
        <div class="info-value">${lead.customerFirstName} ${
      lead.customerLastName
    }</div>
      </div>
      
      <div class="info-section">
        <div class="info-label">Call Customer Using Tracking Number</div>
        <div class="info-value">
            <a href="tel:${trackingNumber}" style="color: #2563eb; text-decoration: none; font-size: 20px;">📞 ${trackingNumber}</a>
        </div>
        <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">
            Click to call directly (calls are tracked for billing)
        </div>
      </div>
      
      <div class="info-section">
        <div class="info-label">Address</div>
        <div class="info-value">
          ${lead.customerAddress}<br>
          ${lead.customerCity}, ${lead.customerState} ${lead.customerZip}
        </div>
      </div>
      
      <div class="info-section">
        <div class="info-label">Service Needed</div>
        <div class="info-value">${lead.serviceType
          .replace(/_/g, " ")
          .toUpperCase()}</div>
      </div>
      
      <div class="info-section">
        <div class="info-label">Timeline</div>
        <div class="info-value">${lead.timeline
          .replace(/_/g, " ")
          .toUpperCase()}</div>
      </div>
      
      <div class="info-section">
        <div class="info-label">Budget Range</div>
        <div class="info-value">${lead.budgetRange
          .replace(/_/g, " ")
          .toUpperCase()}</div>
      </div>
      
      <div class="info-section">
        <div class="info-label">Property Type</div>
        <div class="info-value">${lead.propertyType
          .replace(/_/g, " ")
          .toUpperCase()}</div>
      </div>
      
      ${
        lead.serviceDescription
          ? `
      <div class="info-section">
        <div class="info-label">Additional Details</div>
        <div class="info-value">${lead.serviceDescription}</div>
      </div>
      `
          : ""
      }
      
      <div style="background: #fef3c7; padding: 20px; border-radius: 6px; margin: 20px 0;">
        <strong>💡 Important:</strong>
        <ul style="margin: 10px 0; padding-left: 20px;">
          <li>Call the customer using the tracking number above</li>
          <li>Calls over 30 seconds are automatically billed</li>
          <li>Respond before the deadline to maintain your rating</li>
          <li>Provide excellent service to earn repeat business</li>
        </ul>
      </div>
      
    </div>
    
    <div class="footer">
      <p>GetContractorNow Lead Generation Platform</p>
      <p>Questions? Contact support@getcontractornow.com</p>
    </div>
  </div>
</body>
</html>
    `;

    const msg = {
      to: contractor.email,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: emailSubject,
      html: emailHtml,
    };

    await sgMail.send(msg);

    console.log(`✅ Email sent successfully to ${contractor.email}`);

    // Log successful email to database
    await prisma.notificationLog.create({
      data: {
        contractorId: contractor.id, // ✅ FIXED: Set at top level
        type: "email",
        recipient: contractor.email,
        subject: emailSubject,
        body: null, // ✅ Add body field even if empty
        status: "sent",
        sentAt: new Date(),
        metadata: {
          leadId: lead.id,
          category: lead.category,
          trackingNumber: trackingNumber,
        },
      },
    });

    console.log("✅ Email logged to database");

    return {
      success: true,
      sentTo: contractor.email,
      sentAt: new Date(),
    };
  } catch (error) {
    console.error("❌ Error sending email:", error);

    // Log failed email to database
    try {
      await prisma.notificationLog.create({
        data: {
          type: "email",
          recipient: contractor.email,
          subject: emailSubject,
          status: "failed",
          sentAt: new Date(),
          metadata: {
            leadId: lead.id,
            contractorId: contractor.id,
            error: error.message,
          },
        },
      });
      console.log("✅ Email failure logged to database");
    } catch (logError) {
      console.error("Failed to log email error:", logError.message);
    }

    return {
      success: false,
      error: error.message,
    };
  }
}
async function sendFeedbackRequestEmail(lead) {
  // Check bounce status first
  if (!(await shouldSendEmail(lead.customerEmail))) {
    return { success: false, error: "Email address bounced" };
  }
  const feedbackUrl = `${process.env.RAILWAY_URL}/feedback?leadId=${lead.id}`;

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
    .content { padding: 30px; background: #f9fafb; }
    .button { display: inline-block; background: #2563eb; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>How was your service?</h1>
    </div>
    <div class="content">
      <p>Hi ${lead.customerFirstName},</p>
      <p>We hope the contractor we connected you with provided excellent service!</p>
      <p>Your feedback helps us maintain quality and improve our service. It only takes 1 minute.</p>
      <div style="text-align: center;">
        <a href="${feedbackUrl}" class="button">Leave Feedback</a>
      </div>
      <p style="font-size: 12px; color: #666; margin-top: 30px;">
        If you have any concerns, please contact us at support@getcontractornow.com
      </p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    await sgMail.send({
      to: lead.customerEmail,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: "How was your contractor experience?",
      html: emailHtml,
    });

    console.log("Feedback request email sent to:", lead.customerEmail);

    // Log to database
    await prisma.notificationLog.create({
      data: {
        contractorId: null, // ✅ No contractor for customer emails
        type: "email",
        recipient: lead.customerEmail,
        subject: "How was your contractor experience?",
        body: emailHtml,
        status: "sent",
        sentAt: new Date(),
        metadata: {
          leadId: lead.id,
          purpose: "feedback_request",
        },
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Feedback email error:", error);
    return { success: false, error: error.message };
  }
}

async function sendContractorOnboardingEmail(contractor, temporaryPassword, packageSelectionUrl) {
  // Check bounce status first
  if (!(await shouldSendEmail(contractor.email))) {
    return { success: false, error: "Email address bounced" };
  }

  const portalUrl = `https://app.getcontractornow.com/contractor`;

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
    .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
    .credentials-box { background: #dbeafe; border: 2px solid #2563eb; padding: 20px; margin: 20px 0; border-radius: 8px; }
    .tier-card { background: white; border: 2px solid #e5e7eb; padding: 20px; margin: 15px 0; border-radius: 8px; }
    .tier-card.recommended { border-color: #2563eb; position: relative; }
    .recommended-badge { background: #2563eb; color: white; padding: 5px 15px; border-radius: 4px; font-size: 12px; font-weight: bold; position: absolute; top: -10px; right: 10px; }
    .tier-name { font-size: 24px; font-weight: bold; color: #1f2937; margin-bottom: 10px; }
    .tier-price { font-size: 32px; font-weight: bold; color: #2563eb; margin: 10px 0; }
    .tier-features { list-style: none; padding: 0; margin: 15px 0; }
    .tier-features li { padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .tier-features li:last-child { border-bottom: none; }
    .button { display: inline-block; background: #2563eb; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 6px; margin: 10px 0; font-weight: bold; text-align: center; }
    .button.secondary { background: #6b7280; }
    .button:hover { opacity: 0.9; }
    .alert-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Welcome to GetContractorNow!</h1>
    </div>
    <div class="content">
      <p>Hi ${contractor.businessName},</p>
      <p><strong>Congratulations! Your contractor account has been approved.</strong></p>
      
      <p>You're now ready to start receiving qualified leads in your service area. Follow these simple steps to get started:</p>

      <div class="alert-box">
        <strong>⚠️ IMPORTANT:</strong> You must change your temporary password on first login for security.
      </div>

      <h2 style="color: #1f2937; margin-top: 30px;">Step 1: Your Login Credentials</h2>
      
      <div class="credentials-box">
        <h3 style="margin-top: 0;">Portal Access</h3>
        <p><strong>Portal URL:</strong> <a href="${portalUrl}" style="color: #2563eb;">${portalUrl}</a></p>
        <p><strong>Email:</strong> ${contractor.email}</p>
        <p><strong>Temporary Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 4px; font-size: 16px; font-weight: bold; color: #dc2626;">${temporaryPassword}</code></p>
        <p style="font-size: 14px; color: #6b7280; margin-top: 10px;">⚠️ You'll be prompted to change this password on first login</p>
      </div>

      <h2 style="color: #1f2937; margin-top: 40px;">Step 2: Choose Your Subscription Plan</h2>
      <p>Select the plan that best fits your business needs. Click any button below to complete your secure payment and activate your account.</p>

      <!-- STARTER TIER -->
      <div class="tier-card">
        <div class="tier-name">Starter</div>
        <div class="tier-price">$99<span style="font-size: 16px; color: #6b7280;">/month</span></div>
        <ul class="tier-features">
          <li>✅ Up to 15 leads per month</li>
          <li>✅ $75 per lead</li>
          <li>✅ 3 service ZIP codes</li>
          <li>✅ Standard priority</li>
          <li>✅ Email & SMS notifications</li>
        </ul>
        <div style="text-align: center;">
          <a href="${packageSelectionUrl}&package=starter" class="button secondary">Choose Starter</a>
        </div>
      </div>

      <!-- PRO TIER (RECOMMENDED) -->
      <div class="tier-card recommended">
        <span class="recommended-badge">⭐ RECOMMENDED</span>
        <div class="tier-name">Pro</div>
        <div class="tier-price">$125<span style="font-size: 16px; color: #6b7280;">/month</span></div>
        <ul class="tier-features">
          <li>✅ Up to 40 leads per month</li>
          <li>✅ $100 per lead</li>
          <li>✅ 5 service ZIP codes</li>
          <li>✅ High priority assignment</li>
          <li>✅ Email & SMS notifications</li>
          <li>✅ Extended credit terms (90 days)</li>
        </ul>
        <div style="text-align: center;">
          <a href="${packageSelectionUrl}&package=pro" class="button">Choose Pro</a>
        </div>
      </div>

      <!-- ELITE TIER -->
      <div class="tier-card">
        <div class="tier-name">Elite</div>
        <div class="tier-price">$200<span style="font-size: 16px; color: #6b7280;">/month</span></div>
        <ul class="tier-features">
          <li>✅ Unlimited leads</li>
          <li>✅ $250 per premium lead</li>
          <li>✅ 15 service ZIP codes</li>
          <li>✅ Highest priority assignment</li>
          <li>✅ Email & SMS notifications</li>
          <li>✅ Extended credit terms (120 days)</li>
          <li>✅ Premium lead quality</li>
        </ul>
        <div style="text-align: center;">
          <a href="${packageSelectionUrl}&package=elite" class="button secondary">Choose Elite</a>
        </div>
      </div>

      <div class="alert-box" style="background: #d1fae5; border-left-color: #10b981;">
        <strong>🎟️ Beta Tester?</strong> If you have a promotional code, enter it during checkout for special pricing!
      </div>

      <h2 style="color: #1f2937; margin-top: 40px;">Step 3: Add Credit ($500 minimum)</h2>
      <p>After subscribing, you'll need to add credit to your account to start receiving leads. We require a minimum balance of $500. This credit is used to pay for leads and unused credits are refundable.</p>

      <h2 style="color: #1f2937; margin-top: 40px;">What Happens Next?</h2>
      <ol style="line-height: 2;">
        <li><strong>Choose your plan</strong> - Click one of the buttons above</li>
        <li><strong>Complete payment</strong> - Secure checkout via Stripe</li>
        <li><strong>Login to portal</strong> - Use credentials above</li>
        <li><strong>Change password</strong> - Set your permanent password</li>
        <li><strong>Add credit</strong> - Minimum $500 to receive leads</li>
        <li><strong>Start receiving leads!</strong> - You're all set</li>
      </ol>

      <div style="background: #f9fafb; border: 1px solid #e5e7eb; padding: 20px; margin-top: 30px; border-radius: 8px;">
        <p style="margin: 0; font-size: 14px; color: #6b7280;">
          <strong style="color: #1f2937;">Important:</strong> Your package selection link is valid for 7 days. If you have any questions or need assistance, please don't hesitate to reach out.
        </p>
      </div>

      <p style="margin-top: 30px; padding-top: 30px; border-top: 2px solid #e5e7eb;">
        <strong>Need help?</strong><br>
        Email: support@getcontractornow.com<br>
        We're here to help you succeed!
      </p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    await sgMail.send({
      to: contractor.email,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: "Welcome to GetContractorNow - Choose Your Subscription",
      html: emailHtml,
    });

    console.log("✅ Onboarding email sent to:", contractor.email);

    // Log to database
    await prisma.notificationLog.create({
      data: {
        contractorId: contractor.id,
        type: "email",
        recipient: contractor.email,
        subject: "Welcome to GetContractorNow - Choose Your Subscription",
        body: emailHtml,
        status: "sent",
        sentAt: new Date(),
        metadata: {
          purpose: "onboarding",
          includesPackageSelection: true,
          tokenExpiry: "7 days"
        },
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Onboarding email error:", error);
    return { success: false, error: error.message };
  }
}

async function sendContractorSuspensionEmail(contractor, reason) {
  // Check bounce status first
  if (!(await shouldSendEmail(contractor.email))) {
    return { success: false, error: "Email address bounced" };
  }
  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc2626; color: white; padding: 20px; text-align: center; }
    .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
    .alert-box { background: #fee2e2; border: 2px solid #dc2626; padding: 20px; margin: 20px 0; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ Account Access Suspended</h1>
    </div>
    <div class="content">
      <p>Hi ${contractor.businessName},</p>
      
      <div class="alert-box">
        <strong>Your GetContractorNow account has been suspended.</strong>
      </div>
      
      <p><strong>Reason:</strong></p>
      <p>${reason}</p>
      
      <p><strong>What this means:</strong></p>
      <ul>
        <li>You will no longer receive new leads</li>
        <li>Your account access has been revoked</li>
        <li>You will not be charged for any new leads</li>
      </ul>
      
      <p>If you believe this is an error or would like to discuss reinstatement, please contact us immediately at support@getcontractornow.com</p>
      
      <p style="margin-top: 30px; font-size: 12px; color: #666;">
        GetContractorNow Support Team
      </p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    await sgMail.send({
      to: contractor.email,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: "Account Suspended - GetContractorNow",
      html: emailHtml,
    });

    console.log("Suspension email sent to:", contractor.email);

    // Log notification
    await prisma.notificationLog.create({
      data: {
        contractorId: contractor.id, // ✅ FIXED
        type: "email",
        recipient: contractor.email,
        subject: "Account Suspended - GetContractorNow",
        body: emailHtml,
        status: "sent",
        sentAt: new Date(),
        metadata: {
          purpose: "suspension",
          reason: reason,
        },
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Suspension email error:", error);
    return { success: false, error: error.message };
  }
}

async function sendContractorReactivationEmail(contractor) {
  // Check bounce status first
  if (!(await shouldSendEmail(contractor.email))) {
    return { success: false, error: "Email address bounced" };
  }
  const portalUrl = `https://app.getcontractornow.com/contractor`;
  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 20px; text-align: center; }
    .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
    .success-box { background: #d1fae5; border: 2px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 8px; }
    .button { display: inline-block; background: #10b981; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Account Reactivated</h1>
    </div>
    <div class="content">
      <p>Hi ${contractor.businessName},</p>
      
      <div class="success-box">
        <strong>Good news! Your GetContractorNow account has been reactivated.</strong>
      </div>
      
      <p><strong>What this means:</strong></p>
      <ul>
        <li>You can now receive new leads again</li>
        <li>Your account access has been restored</li>
        <li>You will be charged for qualified leads as normal</li>
      </ul>
      
      <div style="text-align: center;">
        <a href="${portalUrl}" class="button" style="color: white;">Access Contractor Portal</a>
      </div>
      
      <p style="margin-top: 30px;">Thank you for being part of GetContractorNow. We look forward to continuing to send you quality leads!</p>
      
      <p style="margin-top: 30px; font-size: 12px; color: #666;">
        Questions? Contact support@getcontractornow.com
      </p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    await sgMail.send({
      to: contractor.email,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: "Account Reactivated - GetContractorNow",
      html: emailHtml,
    });

    console.log("Reactivation email sent to:", contractor.email);

    await prisma.notificationLog.create({
      data: {
        contractorId: contractor.id, // ✅ FIXED
        type: "email",
        recipient: contractor.email,
        subject: "Account Reactivated - GetContractorNow",
        body: emailHtml,
        status: "sent",
        sentAt: new Date(),
        metadata: {
          purpose: "reactivation",
        },
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Reactivation email error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================
// 1. APPLICATION CONFIRMATION EMAIL (to applicant)
// ============================================

async function sendApplicationConfirmationEmail(contractor) {
  try {
    const msg = {
      to: contractor.email,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: 'Application Received - GetContractorNow',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .highlight { background: #dbeafe; padding: 15px; border-left: 4px solid #2563eb; margin: 20px 0; }
    ul { padding-left: 20px; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">Application Received! ✅</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">Thank you for applying to GetContractorNow</p>
    </div>
    
    <div class="content">
      <p>Hi ${contractor.ownerFirstName},</p>
      
      <p>Thank you for submitting your contractor application to <strong>GetContractorNow</strong>! We've received your information and are excited to review your application.</p>
      
      <div class="highlight">
        <strong>📋 Application Details:</strong><br>
        Business: ${contractor.businessName}<br>
        License: ${contractor.licenseState} #${contractor.licenseNumber}<br>
        Service Areas: ${contractor.serviceZipCodes.join(', ')}<br>
        Submitted: ${new Date().toLocaleDateString()}
      </div>
      
      <h3>What Happens Next?</h3>
      <ul>
        <li><strong>Review Process:</strong> Our team will review your application within 24-48 hours</li>
        <li><strong>Verification:</strong> We'll verify your license, insurance, and credentials</li>
        <li><strong>Approval:</strong> Once approved, you'll receive login credentials and onboarding instructions</li>
        <li><strong>Start Receiving Leads:</strong> You can begin receiving exclusive leads immediately after approval</li>
      </ul>
      
      <h3>Why GetContractorNow?</h3>
      <ul>
        <li>💰 <strong>Exclusive Leads:</strong> No competition - every lead is yours alone</li>
        <li>⚡ <strong>Real-Time Delivery:</strong> Get leads instantly via SMS and email</li>
        <li>🎯 <strong>Pre-Qualified Customers:</strong> Only serious homeowners ready to hire</li>
        <li>📊 <strong>Transparent Pricing:</strong> Pay only for qualified leads you accept</li>
      </ul>
      
      <p style="margin-top: 30px;"><strong>Questions about your application?</strong><br>
      Contact us at <a href="mailto:support@getcontractornow.com">support@getcontractornow.com</a></p>
      
      <p>We look forward to partnering with you!</p>
      
      <p>Best regards,<br>
      <strong>The GetContractorNow Team</strong></p>
    </div>
    
    <div class="footer">
      <p>GetContractorNow - Premium HVAC Lead Generation<br>
      <a href="${PORTAL_URL}">getcontractornow.com</a></p>
    </div>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log('✅ Application confirmation email sent to:', contractor.email);
    return { success: true };

  } catch (error) {
    console.error('❌ Error sending application confirmation:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// 2. ADMIN NEW APPLICATION ALERT
// ============================================

async function sendAdminNewApplicationAlert(contractor) {
  try {
    const msg = {
      to: ADMIN_EMAIL,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: `🆕 New Contractor Application: ${contractor.businessName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; }
    .content { background: #f9fafb; padding: 20px; }
    .info-grid { background: white; padding: 15px; margin: 15px 0; border-radius: 6px; }
    .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
    .button.reject { background: #dc2626; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>🆕 New Contractor Application</h2>
    </div>
    
    <div class="content">
      <div class="info-grid">
        <h3>${contractor.businessName}</h3>
        <p><strong>Owner:</strong> ${contractor.ownerFirstName} ${contractor.ownerLastName}</p>
        <p><strong>Email:</strong> <a href="mailto:${contractor.email}">${contractor.email}</a></p>
        <p><strong>Phone:</strong> ${contractor.phone}</p>
        <p><strong>Location:</strong> ${contractor.businessCity}, ${contractor.businessState} ${contractor.businessZip}</p>
        <p><strong>License:</strong> ${contractor.licenseState} #${contractor.licenseNumber}</p>
        <p><strong>Service ZIPs:</strong> ${contractor.serviceZipCodes.join(', ')}</p>
        <p><strong>Specializations:</strong> ${contractor.specializations.join(', ')}</p>
        <p><strong>Years in Business:</strong> ${contractor.yearsInBusiness || 'Not provided'}</p>
        ${contractor.websiteUrl ? `<p><strong>Website:</strong> <a href="${contractor.websiteUrl}">${contractor.websiteUrl}</a></p>` : ''}
        ${contractor.applicationNotes ? `<p><strong>Notes:</strong> ${contractor.applicationNotes}</p>` : ''}
        <p><strong>Applied:</strong> ${new Date().toLocaleString()}</p>
      </div>
      
      <div style="text-align: center; margin-top: 30px;">
        <a href="${PORTAL_URL}/admin" class="button">Review in Admin Dashboard</a>
      </div>
      
      <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">
        <strong>Action Required:</strong> Review this application in the admin dashboard and approve or reject within 24-48 hours.
      </p>
    </div>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log('✅ Admin alert sent for new application');
    return { success: true };

  } catch (error) {
    console.error('❌ Error sending admin alert:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// 3. APPLICATION REJECTION EMAIL
// ============================================

async function sendApplicationRejectionEmail(contractor, reason) {
  try {
    const msg = {
      to: contractor.email,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: 'Application Status Update - GetContractorNow',
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f3f4f6; padding: 30px; text-align: center; }
    .content { background: white; padding: 30px; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; font-size: 14px; color: #6b7280; }
    .reason-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Application Status Update</h2>
    </div>
    
    <div class="content">
      <p>Hi ${contractor.ownerFirstName},</p>
      
      <p>Thank you for your interest in joining GetContractorNow. After reviewing your application for <strong>${contractor.businessName}</strong>, we regret to inform you that we are unable to approve your application at this time.</p>
      
      <div class="reason-box">
        <strong>Reason:</strong><br>
        ${reason}
      </div>
      
      <p><strong>What You Can Do:</strong></p>
      <ul>
        <li>Address the issues mentioned above and reapply in the future</li>
        <li>Contact us if you believe this decision was made in error</li>
        <li>Ask questions about our requirements</li>
      </ul>
      
      <p>If you have questions or would like to discuss this decision, please contact us at <a href="mailto:support@getcontractornow.com">support@getcontractornow.com</a>.</p>
      
      <p>Best regards,<br>
      The GetContractorNow Team</p>
    </div>
    
    <div class="footer">
      GetContractorNow | <a href="${PORTAL_URL}">getcontractornow.com</a>
    </div>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log('✅ Rejection email sent to:', contractor.email);
    return { success: true };

  } catch (error) {
    console.error('❌ Error sending rejection email:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// 4. REQUEST MORE INFORMATION EMAIL
// ============================================

async function sendApplicationInfoRequestEmail(contractor, message, requestedFields) {
  try {
    const fieldsList = requestedFields ? `
      <div style="background: #dbeafe; padding: 15px; margin: 20px 0;">
        <strong>Information Needed:</strong>
        <ul>
          ${requestedFields.map(field => `<li>${field}</li>`).join('')}
        </ul>
      </div>
    ` : '';

    const msg = {
      to: contractor.email,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: 'Additional Information Needed - GetContractorNow Application',
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Additional Information Needed</h2>
    
    <p>Hi ${contractor.ownerFirstName},</p>
    
    <p>Thank you for submitting your application to GetContractorNow. We're reviewing your application for <strong>${contractor.businessName}</strong> and need some additional information to proceed.</p>
    
    <div style="background: #f9fafb; padding: 20px; margin: 20px 0; border-left: 4px solid #2563eb;">
      ${message}
    </div>
    
    ${fieldsList}
    
    <p>Please reply to this email with the requested information, and we'll continue processing your application.</p>
    
    <a href="mailto:support@getcontractornow.com" class="button">Reply with Information</a>
    
    <p>Thank you for your patience!</p>
    
    <p>Best regards,<br>
    The GetContractorNow Team</p>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log('✅ Info request email sent to:', contractor.email);
    return { success: true };

  } catch (error) {
    console.error('❌ Error sending info request:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// LEGAL COMPLIANCE NOTIFICATIONS
// ============================================

// Deletion Request Alert to Admin
async function sendDeletionRequestAlert(contractor) {
  try {
    const msg = {
      to: ADMIN_EMAIL,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: `🚨 Data Deletion Request - ${contractor.businessName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #ffc107; color: #000; padding: 20px; text-align: center; }
    .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
    .alert-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>⚠️ Data Deletion Request</h2>
    </div>
    
    <div class="content">
      <div class="alert-box">
        <strong>A contractor has requested their data be deleted per GDPR/CCPA requirements.</strong>
      </div>
      
      <h3>Contractor Information:</h3>
      <ul>
        <li><strong>Business:</strong> ${contractor.businessName}</li>
        <li><strong>Email:</strong> ${contractor.email}</li>
        <li><strong>Phone:</strong> ${contractor.phone}</li>
        <li><strong>Account Created:</strong> ${new Date(contractor.createdAt).toLocaleDateString()}</li>
        <li><strong>Request Date:</strong> ${new Date().toLocaleDateString()}</li>
      </ul>
      
      <h3>Required Actions:</h3>
      <ol>
        <li>Review account for pending leads or disputes</li>
        <li>Export all data for legal retention (7 years)</li>
        <li>Cancel Stripe subscriptions</li>
        <li>Anonymize data after retention period</li>
        <li>Confirm deletion to contractor within 30 days</li>
      </ol>
      
      <p style="margin-top: 30px;">
        <strong>⏰ Deadline:</strong> Must complete within 30 days (GDPR/CCPA requirement)
      </p>
      
      <a href="${PORTAL_URL}/admin" style="display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
        Review Account
      </a>
    </div>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ Deletion request alert sent to admin for ${contractor.businessName}`);
    return { success: true };

  } catch (error) {
    console.error('❌ Deletion request alert error:', error);
    return { success: false, error: error.message };
  }
}

// Deletion Confirmation to Contractor
async function sendDeletionConfirmation(contractor) {
  if (!(await shouldSendEmail(contractor.email))) {
    return { success: false, error: 'Email address bounced' };
  }

  try {
    const msg = {
      to: contractor.email,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: 'Data Deletion Request Received - GetContractorNow',
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
    .content { background: white; padding: 30px; }
    .info-box { background: #dbeafe; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0; }
    .warning-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Data Deletion Request Received</h2>
    </div>
    
    <div class="content">
      <p>Hello ${contractor.businessName},</p>
      
      <p>We have received your request to delete your personal data from GetContractorNow. This email confirms that your request is being processed.</p>
      
      <div class="info-box">
        <h3 style="margin-top: 0;">What happens next:</h3>
        <ol style="margin-bottom: 0;">
          <li>Your account has been deactivated immediately</li>
          <li>You will not receive any new leads</li>
          <li>Your data will be reviewed and processed for deletion</li>
          <li>You will receive a confirmation email within 30 days</li>
        </ol>
      </div>
      
      <h3>Important Information:</h3>
      <ul>
        <li><strong>Retention Period:</strong> Some data must be retained for legal compliance (typically 7 years)</li>
        <li><strong>What's Retained:</strong> Transaction records, call recordings, billing history</li>
        <li><strong>What's Deleted:</strong> Personal information, contact details, account access</li>
        <li><strong>Anonymization:</strong> After retention period, all remaining data will be anonymized</li>
      </ul>
      
      <div class="warning-box">
        <strong>⚠️ This action cannot be undone.</strong> If you submitted this request by mistake, please contact us immediately at <a href="mailto:support@getcontractornow.com">support@getcontractornow.com</a>
      </div>
      
      <p style="margin-top: 30px; font-size: 12px; color: #666;">
        This request is being processed in accordance with GDPR and CCPA requirements.
      </p>
    </div>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ Deletion confirmation sent to ${contractor.email}`);
    return { success: true };

  } catch (error) {
    console.error('❌ Deletion confirmation error:', error);
    return { success: false, error: error.message };
  }
}

// SMS Opt-Out Confirmation Email
async function sendSMSOptOutConfirmation(contractor) {
  if (!(await shouldSendEmail(contractor.email))) {
    return { success: false, error: 'Email address bounced' };
  }

  try {
    const msg = {
      to: contractor.email,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: 'SMS Notifications Disabled - GetContractorNow',
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #6b7280; color: white; padding: 20px; text-align: center; }
    .content { background: white; padding: 30px; }
    .warning-box { background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>SMS Notifications Disabled</h2>
    </div>
    
    <div class="content">
      <p>Hello ${contractor.businessName},</p>
      
      <p>You have successfully opted out of SMS notifications from GetContractorNow.</p>
      
      <div class="warning-box">
        <h3 style="margin-top: 0; color: #991b1b;">⚠️ Important Notice</h3>
        <p style="color: #7f1d1d; margin-bottom: 0;">
          <strong>You will no longer receive SMS notifications for new leads.</strong> This may result in delayed responses to lead opportunities. You will still receive email notifications and can view leads in your dashboard.
        </p>
      </div>
      
      <h3>What This Means:</h3>
      <ul>
        <li>✅ You will still receive email notifications</li>
        <li>✅ You can still view leads in your dashboard</li>
        <li>❌ You will NOT receive SMS text messages for new leads</li>
        <li>❌ You will NOT receive SMS alerts for low credit balance</li>
      </ul>
      
      <h3>Want to Re-Enable SMS Notifications?</h3>
      <p>You can opt back in at any time by:</p>
      <ol>
        <li>Replying <strong>START</strong> to any of our SMS messages</li>
        <li>Updating your preferences in your contractor dashboard</li>
        <li>Contacting support at <a href="mailto:support@getcontractornow.com">support@getcontractornow.com</a></li>
      </ol>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${PORTAL_URL}/contractor" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">
          Go to Dashboard
        </a>
      </div>
      
      <p style="margin-top: 30px; font-size: 12px; color: #666;">
        If you didn't request this change, please contact us immediately.
      </p>
    </div>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ SMS opt-out confirmation sent to ${contractor.email}`);
    return { success: true };

  } catch (error) {
    console.error('❌ SMS opt-out confirmation error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// LOW CREDIT WARNING NOTIFICATIONS
// ============================================

// Low Credit Warning ($100 or $50 threshold)
async function sendLowCreditWarning(contractor, currentBalance, threshold) {
  if (!(await shouldSendEmail(contractor.email))) {
    return { success: false, error: 'Email address bounced' };
  }

  const isUrgent = threshold <= 50;
  const urgencyColor = isUrgent ? '#dc2626' : '#f59e0b';
  const urgencyBg = isUrgent ? '#fee2e2' : '#fef3c7';

  try {
    const msg = {
      to: contractor.email,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: `${isUrgent ? '🚨 URGENT:' : '⚠️'} Low Credit Balance - Add Funds Now`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${urgencyColor}; color: white; padding: 30px; text-align: center; }
    .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
    .alert-box { background: ${urgencyBg}; border-left: 4px solid ${urgencyColor}; padding: 20px; margin: 20px 0; border-radius: 6px; }
    .balance-display { font-size: 48px; font-weight: bold; color: ${urgencyColor}; text-align: center; margin: 20px 0; }
    .button { display: inline-block; padding: 15px 30px; background: ${urgencyColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${isUrgent ? '🚨 URGENT' : '⚠️ Warning'}</h1>
      <h2>Low Credit Balance</h2>
    </div>
    
    <div class="content">
      <p>Hello ${contractor.businessName},</p>
      
      <div class="alert-box">
        <strong>${isUrgent ? 'URGENT:' : 'WARNING:'} Your credit balance is running low!</strong>
      </div>
      
      <h3 style="text-align: center; color: #6b7280;">Current Balance:</h3>
      <div class="balance-display">$${currentBalance.toFixed(2)}</div>
      
      ${isUrgent ? `
      <div style="background: #fee2e2; padding: 20px; border-radius: 6px; margin: 20px 0; text-align: center;">
        <h3 style="color: #991b1b; margin-top: 0;">⚠️ CRITICAL: Add credit immediately!</h3>
        <p style="color: #7f1d1d; margin-bottom: 0;">
          Your balance is critically low. You may miss leads if your balance reaches $0.
        </p>
      </div>
      ` : `
      <div style="background: #fef3c7; padding: 20px; border-radius: 6px; margin: 20px 0;">
        <p style="margin: 0; color: #78350f;">
          <strong>Action Required:</strong> Add credit soon to ensure you don't miss any leads.
        </p>
      </div>
      `}
      
      <h3>What happens if balance reaches $0?</h3>
      <ul>
        <li>❌ Your account will be paused automatically</li>
        <li>❌ You will stop receiving new leads</li>
        <li>❌ You'll miss out on potential business opportunities</li>
        <li>✅ Add credit to resume receiving leads immediately</li>
      </ul>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${PORTAL_URL}/contractor" class="button">
          Add Credit Now
        </a>
      </div>
      
      <h3>Need Help?</h3>
      <p>Contact us at <a href="mailto:support@getcontractornow.com">support@getcontractornow.com</a></p>
      
      <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">
        This is an automated alert to help you maintain service continuity.
      </p>
    </div>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ Low credit warning (${threshold}) sent to ${contractor.email}`);

    // Log notification
    await prisma.notificationLog.create({
      data: {
        contractorId: contractor.id,
        type: 'email',
        recipient: contractor.email,
        subject: msg.subject,
        status: 'sent',
        sentAt: new Date(),
        metadata: {
          purpose: 'low_credit_warning',
          threshold: threshold,
          currentBalance: currentBalance,
        },
      },
    });

    return { success: true };

  } catch (error) {
    console.error('❌ Low credit warning email error:', error);
    return { success: false, error: error.message };
  }
}

// Credit Depleted - Account Paused
async function sendCreditDepletedEmail(contractor) {
  if (!(await shouldSendEmail(contractor.email))) {
    return { success: false, error: 'Email address bounced' };
  }

  try {
    const msg = {
      to: contractor.email,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: '🚨 URGENT: Credit Balance Depleted - Account Paused',
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc2626; color: white; padding: 30px; text-align: center; }
    .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
    .alert-box { background: #fee2e2; border: 4px solid #dc2626; padding: 30px; margin: 20px 0; border-radius: 8px; text-align: center; }
    .button { display: inline-block; padding: 18px 40px; background: #dc2626; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 18px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚨 URGENT</h1>
      <h2>Account Paused</h2>
    </div>
    
    <div class="content">
      <p>Hello ${contractor.businessName},</p>
      
      <div class="alert-box">
        <h2 style="margin-top: 0; color: #991b1b;">⛔ Your Account Has Been Paused</h2>
        <p style="font-size: 18px; color: #7f1d1d; margin-bottom: 0;">
          <strong>Your credit balance has reached $0.00</strong>
        </p>
      </div>
      
      <h3>Current Status:</h3>
      <ul style="font-size: 16px;">
        <li><strong>Balance:</strong> $0.00</li>
        <li><strong>Status:</strong> ⛔ Paused - Not Receiving Leads</li>
        <li><strong>Action Required:</strong> Add credit immediately to resume service</li>
      </ul>
      
      <div style="background: #fef3c7; padding: 20px; border-radius: 6px; margin: 30px 0;">
        <h3 style="margin-top: 0; color: #78350f;">⚠️ Don't Miss Out on Leads!</h3>
        <p style="color: #78350f; margin-bottom: 0;">
          Other contractors in your area are receiving exclusive leads right now. 
          Add credit to your account to resume receiving leads immediately.
        </p>
      </div>
      
      <div style="text-align: center; margin: 40px 0;">
        <a href="${PORTAL_URL}/contractor" class="button">
          Add Credit Now
        </a>
      </div>
      
      <h3>What You Need to Do:</h3>
      <ol style="font-size: 16px; line-height: 1.8;">
        <li>Login to your contractor portal</li>
        <li>Navigate to "Manage Credits"</li>
        <li>Add credit to your account (minimum $500 recommended)</li>
        <li>Your account will be reactivated automatically</li>
      </ol>
      
      <p style="margin-top: 30px;">
        <strong>Need help?</strong><br>
        Email: <a href="mailto:support@getcontractornow.com">support@getcontractornow.com</a><br>
        Phone: ${process.env.SUPPORT_PHONE || '(555) 123-4567'}
      </p>
      
      <p style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e7eb; font-size: 12px; color: #6b7280;">
        Your account has been automatically paused to prevent unauthorized charges. 
        Add credit to resume receiving leads.
      </p>
    </div>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ Credit depleted email sent to ${contractor.email}`);

    // Log notification
    await prisma.notificationLog.create({
      data: {
        contractorId: contractor.id,
        type: 'email',
        recipient: contractor.email,
        subject: msg.subject,
        status: 'sent',
        sentAt: new Date(),
        metadata: {
          purpose: 'credit_depleted',
          accountPaused: true,
        },
      },
    });

    return { success: true };

  } catch (error) {
    console.error('❌ Credit depleted email error:', error);
    return { success: false, error: error.message };
  }
}

// Send SMS for low credit (optional - only for urgent threshold)
async function sendLowCreditSMS(contractor, currentBalance) {
  try {
    // Check if SMS allowed
    const { canSendSMS } = require('./sms-notifications');
    const canSend = await canSendSMS(contractor.id);
    
    if (!canSend) {
      console.log('⚠️ SMS skipped - contractor opted out');
      return { success: false, reason: 'opted_out' };
    }

    const { sendSMS } = require('./sms-notifications');
    const message = `🚨 URGENT: Your GetContractorNow credit balance is critically low ($${currentBalance.toFixed(2)}). Add credit now to avoid missing leads: ${PORTAL_URL}/contractor`;

    return await sendSMS(contractor.phone, message, null, contractor.id);

  } catch (error) {
    console.error('❌ Low credit SMS error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendNewLeadEmail,
  sendFeedbackRequestEmail,
  sendContractorOnboardingEmail,
  sendContractorSuspensionEmail,
  sendContractorReactivationEmail,
  
  // Application emails (full names)
  sendApplicationConfirmationEmail,
  sendAdminNewApplicationAlert,
  sendApplicationRejectionEmail,
  sendApplicationInfoRequestEmail,
  
  // ✅ ALIASES for index.js (short names)
  sendApplicationConfirmation: sendApplicationConfirmationEmail,
  sendAdminApplicationAlert: sendAdminNewApplicationAlert,
  
  // Legal Compliance
  sendDeletionRequestAlert,
  sendDeletionConfirmation,
  sendSMSOptOutConfirmation,
  
  // Low Credit Warnings
  sendLowCreditWarning,
  sendCreditDepletedEmail,
  sendLowCreditSMS,
};