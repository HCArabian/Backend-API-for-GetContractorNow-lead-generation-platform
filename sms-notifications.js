const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendSMS(to, message, leadId, contractorId) {
  try {
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_SMS_NUMBER,
      to: to,
    });

    console.log("✅ SMS sent:", result.sid, "to:", to);

    // Log to database
    await prisma.sMSLog.create({
      data: {
        leadId: leadId,
        contractorId: contractorId,
        messageSid: result.sid,
        fromNumber: process.env.TWILIO_SMS_NUMBER,
        toNumber: to,
        messageBody: message,
        direction: "system_to_contractor",
        status: result.status,
      },
    });

    console.log("✅ SMS logged to database");

    return { success: true, sid: result.sid };
  } catch (error) {
    console.error("❌ SMS error:", error.message);

    // Log failed attempt to database
    if (leadId && contractorId) {
      try {
        await prisma.sMSLog.create({
          data: {
            leadId: leadId,
            contractorId: contractorId,
            messageSid: "FAILED",
            fromNumber: process.env.TWILIO_SMS_NUMBER || "N/A",
            toNumber: to,
            messageBody: message,
            direction: "system_to_contractor",
            status: "failed",
          },
        });
      } catch (logError) {
        console.error("Failed to log SMS error:", logError.message);
      }
    }

    return { success: false, error: error.message };
  }
}

async function notifyContractorSMS(contractor, lead, trackingNumber) {
  // Only send SMS for PLATINUM and GOLD leads
  if (lead.category !== "PLATINUM" && lead.category !== "GOLD") {
    console.log("Skipping SMS - lead is", lead.category);
    return null;
  }

  const urgencyEmoji = lead.category === "PLATINUM" ? "🔥" : "⭐";

  // Format service type and budget range for display
  const serviceType = lead.serviceType.replace(/_/g, " ").toUpperCase();
  const budgetRange = lead.budgetRange.replace(/_/g, " ");

  // Determine response time based on category
  const responseTime = lead.category === "PLATINUM" ? "20 minutes" : "2 hours";

  const message = `${urgencyEmoji} NEW ${lead.category} LEAD - ${lead.customerCity}, ${lead.customerState}
Service: ${serviceType}
Budget: ${budgetRange}
Call NOW: ${trackingNumber}
Respond within ${responseTime}!`;

  console.log("📱 Sending SMS to contractor:", contractor.businessName);
  return await sendSMS(contractor.phone, message, lead.id, contractor.id);
}

// Check if SMS can be sent to contractor (opt-out check)
async function canSendSMS(contractorId) {
  try {
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
      select: {
        smsOptedOut: true,
        phone: true,
        businessName: true,
      }
    });

    if (!contractor) {
      console.error('❌ Contractor not found:', contractorId);
      return false;
    }

    if (contractor.smsOptedOut) {
      console.log(`⚠️ SMS blocked - contractor opted out: ${contractor.businessName}`);
      return false;
    }

    if (!contractor.phone) {
      console.log(`⚠️ SMS blocked - no phone number: ${contractor.businessName}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Error checking SMS opt-out status:', error);
    return false;
  }
}

module.exports = { sendSMS, notifyContractorSMS, canSendSMS };
