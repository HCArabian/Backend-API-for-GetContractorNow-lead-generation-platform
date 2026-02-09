// stripe-payments.js
// High-level Stripe payment operations (customer creation, lead charging, payment methods)
// Uses services/stripe.js for all Stripe API calls

const Sentry = require("@sentry/node");
const prisma = require("./db");
const {
  createCustomer,
  createPaymentIntent,
  createSetupIntent: stripeCreateSetupIntent,
  retrievePaymentMethod,
  attachPaymentMethod,
} = require("./services/stripe");

// Create a customer in Stripe for a contractor
async function createStripeCustomer(contractor) {
  try {
    const customer = await createCustomer({
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
        operation: "create_stripe_customer",
        contractorId: contractor.id,
      },
      extra: {
        contractorEmail: contractor.email,
        businessName: contractor.businessName,
      },
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
    const paymentIntent = await createPaymentIntent({
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
        operation: "charge_contractor",
        contractorId: contractorId,
        leadId: leadId,
      },
      extra: {
        amount: amount,
        description: description,
        errorType: error.type,
        errorCode: error.code,
      },
    });
    console.error("Payment error:", error);

    // Update billing record with error
    await prisma.billingRecord.updateMany({
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
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
    });

    if (!contractor.stripeCustomerId) {
      const customer = await createStripeCustomer(contractor);
      contractor.stripeCustomerId = customer.id;
    }

    const setupIntent = await stripeCreateSetupIntent(
      contractor.stripeCustomerId
    );

    return setupIntent;
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        operation: "create_setup_intent",
        contractorId: contractorId,
      },
    });
    console.error("Setup intent error:", error);
    throw error;
  }
}

// Save payment method after contractor adds it
async function savePaymentMethod(contractorId, paymentMethodId) {
  try {
    // Get payment method details from Stripe
    const paymentMethod = await retrievePaymentMethod(paymentMethodId);

    // Get contractor's Stripe customer ID
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId },
      select: { stripeCustomerId: true },
    });

    // Attach payment method to customer if not already attached
    if (contractor.stripeCustomerId) {
      await attachPaymentMethod(paymentMethodId, contractor.stripeCustomerId);
    }

    // Save to database with card details
    await prisma.contractor.update({
      where: { id: contractorId },
      data: {
        stripePaymentMethodId: paymentMethodId,
        paymentMethodLast4: paymentMethod.card?.last4 || null,
        paymentMethodBrand: paymentMethod.card?.brand || null,
        paymentMethodExpMonth: paymentMethod.card?.exp_month || null,
        paymentMethodExpYear: paymentMethod.card?.exp_year || null,
      },
    });

    console.log("Payment method saved for contractor:", contractorId);
    return { success: true };
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        operation: "save_payment_method",
        contractorId: contractorId,
      },
      extra: {
        paymentMethodId: paymentMethodId,
      },
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