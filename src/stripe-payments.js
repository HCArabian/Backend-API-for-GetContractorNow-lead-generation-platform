const Sentry = require("@sentry/node");
const prisma = require("./db");

let stripe = null;

try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    console.log("✅ Stripe initialized in stripe-payments.js");
  } else {
    console.warn("⚠️ STRIPE_SECRET_KEY not set — Stripe payments disabled");
  }
} catch (error) {
  console.error("⚠️ Stripe initialization failed:", error.message);
}

function requireStripe() {
  if (!stripe) {
    throw new Error("Stripe is not initialized — STRIPE_SECRET_KEY not set");
  }
  return stripe;
}

// Create a customer in Stripe for a contractor
async function createStripeCustomer(contractor) {
  try {
    const s = requireStripe();
    const customer = await s.customers.create({
      email: contractor.email,
      name: contractor.businessName,
      phone: contractor.phone,
      metadata: {
        contractorId: contractor.id,
        platform: "GetContractorNow",
      },
    });

    // Save Stripe customer ID to database
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: { stripeCustomerId: customer.id },
    });

    console.log("Stripe customer created:", customer.id);
    return customer;
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        operation: 'create_stripe_customer',
        contractorId: contractor.id
      },
      extra: {
        contractorEmail: contractor.email,
        businessName: contractor.businessName
      }
    });
    console.error("Stripe customer creation error:", error);
    throw error;
  }
}

// Charge contractor for a lead
async function chargeContractorForLead(
  contractorId,
  leadId,
  amount,
  description
) {
  try {
    const s = requireStripe();
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
    });

    if (!contractor.stripeCustomerId) {
      throw new Error("Contractor has no Stripe customer ID");
    }

    if (!contractor.stripePaymentMethodId) {
      throw new Error("Contractor has no payment method on file");
    }

    // Create payment intent
    const paymentIntent = await s.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: "usd",
      customer: contractor.stripeCustomerId,
      payment_method: contractor.stripePaymentMethodId,
      off_session: true, // Charge without customer present
      confirm: true, // Charge immediately
      description: description,
      metadata: {
        contractorId: contractorId,
        leadId: leadId,
      },
    });

    console.log("Payment successful:", paymentIntent.id);

    // Update billing record with Stripe payment ID
    await prisma.billingRecord.updateMany({
      where: {
        leadId: leadId,
        contractorId: contractorId,
      },
      data: {
        stripePaymentId: paymentIntent.id,
        status: "paid",
        paidAt: new Date(),
      },
    });

    return {
      success: true,
      paymentIntentId: paymentIntent.id,
      amount: amount,
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        operation: 'charge_contractor',
        contractorId: contractorId,
        leadId: leadId
      },
      extra: {
        amount: amount,
        description: description,
        errorType: error.type,
        errorCode: error.code
      }
    });
    console.error("Payment error:", error);

    // Update billing record with error - use updateMany to avoid errors if record doesn't exist
    await prisma.billingRecord.updateMany({  // ✅ FIXED: Changed from update to updateMany
      where: {
        leadId: leadId,
        contractorId: contractorId,
      },
      data: {
        status: "failed",
        notes: `Payment failed: ${error.message}`,
      },
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

// Create a setup intent for adding payment method
async function createSetupIntent(contractorId) {
  try {
    const s = requireStripe();
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
    });

    if (!contractor.stripeCustomerId) {
      const customer = await createStripeCustomer(contractor);
      contractor.stripeCustomerId = customer.id;
    }

    const setupIntent = await s.setupIntents.create({
      customer: contractor.stripeCustomerId,
      payment_method_types: ["card"],
    });

    return setupIntent;
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        operation: 'create_setup_intent',
        contractorId: contractorId
      }
    });
    console.error("Setup intent error:", error);
    throw error;
  }
}

// Save payment method after contractor adds it
async function savePaymentMethod(contractorId, paymentMethodId) {
  try {
    const s = requireStripe();
    // Get payment method details from Stripe
    const paymentMethod = await s.paymentMethods.retrieve(paymentMethodId);
    
    // Get contractor's Stripe customer ID
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
      select: { stripeCustomerId: true }
    });
    
    // Attach payment method to customer if not already attached
    if (contractor.stripeCustomerId) {
      await s.paymentMethods.attach(paymentMethodId, {
        customer: contractor.stripeCustomerId,
      });
    }
    
    // Save to database with card details
    await prisma.contractor.update({
      where: { id: contractorId },
      data: { 
        stripePaymentMethodId: paymentMethodId,
        paymentMethodLast4: paymentMethod.card?.last4 || null,  // ✅ ADDED
        paymentMethodBrand: paymentMethod.card?.brand || null,  // ✅ ADDED
        paymentMethodExpMonth: paymentMethod.card?.exp_month || null,  // ✅ ADDED
        paymentMethodExpYear: paymentMethod.card?.exp_year || null,  // ✅ ADDED
      },
    });

    console.log("Payment method saved for contractor:", contractorId);
    return { success: true };
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        operation: 'save_payment_method',
        contractorId: contractorId
      },
      extra: {
        paymentMethodId: paymentMethodId
      }
    });
    console.error("Save payment method error:", error);
    throw error;
  }
}

module.exports = {
  createStripeCustomer,
  chargeContractorForLead,
  createSetupIntent,
  savePaymentMethod,
};