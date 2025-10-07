const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { sendNewLeadEmail } = require("./notifications");
const { notifyContractorSMS, canSendSMS } = require("./sms-notifications");
const { canContractorReceiveLeads } = require("./subscription-helpers");

async function assignContractor(lead) {
  try {
    console.log("🔄 Starting contractor assignment for lead:", lead.id);
    console.log("📋 Lead details:", {
      category: lead.category,
      service: lead.serviceType,
      zip: lead.customerZip,
      price: lead.price,
    });

    // Find eligible contractors
    console.log("🔎 Searching for eligible contractors...");

    const contractors = await prisma.contractor.findMany({
      where: {
        status: "active",
        isAcceptingLeads: true,
        isVerified: true,
        stripePaymentMethodId: { not: null }, // Must have payment method
        serviceZipCodes: {
          has: lead.customerZip,
        },
        specializations: {
          has: lead.serviceType,
        },
      },
      orderBy: {
        totalLeadsReceived: "asc",
      },
    });

    console.log(`📊 Found ${contractors.length} potential contractors`);

    if (contractors.length === 0) {
      console.log("❌ No contractors found matching service area and type");
      return null;
    }

    // ============================================
    // ✅ ENHANCED: Validate EACH contractor meets ALL requirements
    // ============================================

    let selectedContractor = null;

    for (const contractor of contractors) {
      const eligibility = await canContractorReceiveLeads(contractor);

      console.log(
        `🔍 Checking ${contractor.businessName}:`,
        eligibility.reason
      );

      if (eligibility.canReceive) {
        selectedContractor = contractor;
        console.log("✅ Selected contractor:", contractor.businessName);
        break; // Found eligible contractor
      } else {
        console.log(
          `❌ ${contractor.businessName} not eligible: ${eligibility.reason}`
        );
      }
    }

    // If no contractor passed all checks
    if (!selectedContractor) {
      console.log("❌ No eligible contractors found after validation");
      console.log(
        "   All contractors failed payment method or credit requirements"
      );
      // Log selected contractor details for debugging
      console.log("📋 Selected contractor details:", {
        name: selectedContractor.businessName,
        hasPaymentMethod: !!selectedContractor.stripePaymentMethodId,
        creditBalance: selectedContractor.creditBalance,
        subscriptionStatus: selectedContractor.subscriptionStatus,
        subscriptionTier: selectedContractor.subscriptionTier,
      });
      return null;
    }

    // Calculate response deadline (24 hours for PLATINUM/GOLD, 48 for others)
    const responseDeadline = new Date();
    const hoursToAdd =
      lead.category === "PLATINUM" || lead.category === "GOLD" ? 24 : 48;
    responseDeadline.setHours(responseDeadline.getHours() + hoursToAdd);

    // Create assignment
    const assignment = await prisma.leadAssignment.create({
      data: {
        leadId: lead.id,
        contractorId: selectedContractor.id,
        responseDeadline: responseDeadline,
        status: "assigned",
      },
    });

    console.log("✅ Assignment created:", assignment.id);

    // Assign tracking number from pool
    const trackingNumber = await assignTracking(lead.id, selectedContractor.id);

    if (!trackingNumber) {
      console.error(
        "⚠️ Failed to assign tracking number - pool may be exhausted"
      );
    }

    // Update contractor stats
    await prisma.contractor.update({
      where: { id: selectedContractor.id },
      data: {
        totalLeadsReceived: {
          increment: 1,
        },
      },
    });

    // Update lead status
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: "assigned",
        assignedAt: new Date(),
      },
    });

    // Send email notification to contractor
    console.log("📧 Sending email notification...");
    try {
      await sendNewLeadEmail(
        selectedContractor,
        lead,
        assignment,
        trackingNumber
      );

      console.log("✅ Email notification sent");
    } catch (emailError) {
      console.error("⚠️ Email notification failed:", emailError.message);
    }

    // Send SMS notification for PLATINUM and GOLD leads
    if (
      trackingNumber &&
      (lead.category === "PLATINUM" || lead.category === "GOLD")
    ) {
      console.log("📱 Checking SMS eligibility for", lead.category, "lead...");

      // ✅ NEW: Check if contractor has SMS enabled (not opted out)
      const canSendSMSToContractor = await canSendSMS(selectedContractor.id);

      if (canSendSMSToContractor) {
        console.log("📱 Sending SMS notification...");
        const smsResult = await notifyContractorSMS(
          selectedContractor,
          lead,
          trackingNumber
        );

        if (smsResult && smsResult.success) {
          console.log("✅ SMS notification sent");
        } else {
          console.log(
            "⚠️ SMS notification failed:",
            smsResult?.error || "Unknown error"
          );
        }
      } else {
        console.log("⚠️ SMS skipped - contractor opted out or no phone number");
      }
    } else {
      console.log(
        "ℹ️ SMS skipped - lead category is",
        lead.category,
        "or no tracking number"
      );
    }

    console.log("🎉 Assignment complete!");

    return {
      contractor: selectedContractor,
      assignment: assignment,
      trackingNumber: trackingNumber,
    };
  } catch (error) {
    console.error("❌ Assignment error:", error);
    throw error;
  }
}

async function assignTracking(leadId, contractorId) {
  try {
    // Find an available number from the pool
    const availableNumber = await prisma.twilioNumberPool.findFirst({
      where: {
        status: "available",
      },
    });

    if (!availableNumber) {
      console.error("❌ No available tracking numbers in pool!");
      console.error(
        "⚠️ ACTION REQUIRED: Buy more Twilio numbers or wait for recycling"
      );
      return null;
    }

    // Calculate expiration (5 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 5);

    // Mark number as assigned
    await prisma.twilioNumberPool.update({
      where: { id: availableNumber.id },
      data: {
        status: "assigned",
        currentLeadId: leadId,
        assignedAt: new Date(),
        expiresAt: expiresAt,
      },
    });

    // Update the lead assignment with this tracking number
    await prisma.leadAssignment.update({
      where: { leadId: leadId },
      data: {
        trackingNumber: availableNumber.phoneNumber,
      },
    });

    console.log(
      `✅ Assigned tracking number ${availableNumber.phoneNumber} to lead ${leadId}`
    );
    console.log(`   Expires: ${expiresAt.toLocaleString()}`);

    return availableNumber.phoneNumber;
  } catch (error) {
    console.error("Error assigning tracking number:", error);
    return null;
  }
}

module.exports = { assignContractor, assignTracking };
