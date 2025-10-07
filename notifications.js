// notifications.js - Email Notification System

const sgMail = require("@sendgrid/mail");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

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

async function sendContractorOnboardingEmail(contractor, temporaryPassword) {
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
    .button { display: inline-block; background: #2563eb; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 6px; margin: 10px 0; font-weight: bold; }
    .button.secondary { background: #6b7280; }
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
      
      <p>You're now ready to start receiving qualified leads in your service area. Here's how to get started:</p>

      <div class="alert-box">
        <strong>⚠️ IMPORTANT:</strong> You must change your temporary password on first login for security.
      </div>

      <h2 style="color: #1f2937; margin-top: 30px;">Step 1: Access Your Portal</h2>
      
      <div class="credentials-box">
        <h3>Your Login Credentials</h3>
        <p><strong>Portal URL:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
        <p><strong>Email:</strong> ${contractor.email}</p>
        <p><strong>Temporary Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 4px; font-size: 16px; font-weight: bold;">${temporaryPassword}</code></p>
      </div>

      <div style="text-align: center; margin: 20px 0;">
        <a href="${portalUrl}" class="button">Access Portal Now</a>
      </div>

      <h2 style="color: #1f2937; margin-top: 40px;">Step 2: Choose Your Subscription Tier</h2>
      <p>Select the plan that fits your business needs:</p>

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
          <a href="${process.env.STRIPE_PAYMENT_LINK_STARTER}?prefilled_email=${encodeURIComponent(contractor.email)}" class="button secondary">Choose Starter</a>
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
          <a href="${process.env.STRIPE_PAYMENT_LINK_PRO}?prefilled_email=${encodeURIComponent(contractor.email)}" class="button">Choose Pro</a>
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
          <a href="${process.env.STRIPE_PAYMENT_LINK_ELITE}?prefilled_email=${encodeURIComponent(contractor.email)}" class="button secondary">Choose Elite</a>
        </div>
      </div>

      <div class="alert-box" style="background: #d1fae5; border-left-color: #10b981;">
        <strong>🎟️ Beta Tester?</strong> If you have a promotional code, enter it during checkout for special pricing!
      </div>

      <h2 style="color: #1f2937; margin-top: 40px;">Step 3: Add Credit ($500 minimum)</h2>
      <p>After subscribing, you'll need to add credit to your account to start receiving leads. We require a minimum balance of $500. This credit is used to pay for leads and unused credits are refundable.</p>

      <h2 style="color: #1f2937; margin-top: 40px;">What Happens Next?</h2>
      <ol style="line-height: 2;">
        <li>Login to your portal and change your password</li>
        <li>Choose your subscription tier</li>
        <li>Add credit to your account ($500 minimum)</li>
        <li>Start receiving qualified leads!</li>
      </ol>

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
          includesPaymentLinks: true,
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

module.exports = {
  sendNewLeadEmail,
  sendFeedbackRequestEmail,
  sendContractorOnboardingEmail,
  sendContractorSuspensionEmail,
  sendContractorReactivationEmail, // ADD THIS
};
