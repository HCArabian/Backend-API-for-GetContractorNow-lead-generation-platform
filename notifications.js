// notifications.js - Email Notification System

const sgMail = require("@sendgrid/mail");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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
        type: "email",
        recipient: contractor.email,
        subject: emailSubject,
        body: emailHtml,
        status: "sent",
        sentAt: new Date(),
        metadata: {
          leadId: lead.id,
          contractorId: contractor.id,
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
  const portalUrl = `${process.env.RAILWAY_URL}/contractor`;

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
    .button { display: inline-block; background: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to GetContractorNow!</h1>
    </div>
    <div class="content">
      <p>Hi ${contractor.businessName},</p>
      <p>Your contractor account has been approved! You can now start receiving qualified leads in your service area.</p>
      
      <div class="credentials-box">
        <h3>Your Login Credentials</h3>
        <p><strong>Portal URL:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
        <p><strong>Email:</strong> ${contractor.email}</p>
        <p><strong>Temporary Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 4px; font-size: 16px;">${temporaryPassword}</code></p>
      </div>
      
      <p style="color: #dc2626; font-weight: bold;">⚠️ IMPORTANT: You must change your password on first login.</p>
      
      <div style="text-align: center;">
        <a href="${portalUrl}" class="button">Access Contractor Portal</a>
      </div>
      
      <h3>Next Steps:</h3>
      <ol>
        <li>Login with your temporary password</li>
        <li>Change your password immediately</li>
        <li>Add payment method (required to receive leads)</li>
        <li>Review your profile and service areas</li>
        <li>Start receiving leads!</li>
      </ol>
      
      <p style="font-size: 12px; color: #666; margin-top: 30px;">
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
      subject: "Welcome to GetContractorNow - Your Account is Approved",
      html: emailHtml,
    });

    console.log("Onboarding email sent to:", contractor.email);
    return { success: true };
  } catch (error) {
    console.error("Onboarding email error:", error);
    return { success: false, error: error.message };
  }
}
async function sendContractorSuspensionEmail(contractor, reason) {
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
        type: "email",
        recipient: contractor.email,
        subject: "Account Suspended - GetContractorNow",
        body: emailHtml,
        status: "sent",
        sentAt: new Date(),
        metadata: {
          contractorId: contractor.id,
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

module.exports = {
  sendNewLeadEmail,
  sendFeedbackRequestEmail,
  sendContractorOnboardingEmail,
  sendContractorSuspensionEmail, // ADD THIS
};
