// webhook-handler.js - Stripe Webhook Handlers

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ============================================
// HANDLE SUBSCRIPTION CREATED
// ============================================
async function handleSubscriptionCreated(subscription) {
  console.log("📝 Processing subscription created:", subscription.id);

  try {
    const stripeCustomerId = subscription.customer;
    const subscriptionId = subscription.id;

    // Get price ID to determine tier
    const priceId = subscription.items.data[0].price.id;
    let tier = "pro"; // default

    if (priceId === process.env.STRIPE_PRICE_STARTER) {
      tier = "starter";
    } else if (priceId === process.env.STRIPE_PRICE_PRO) {
      tier = "pro";
    } else if (priceId === process.env.STRIPE_PRICE_ELITE) {
      tier = "elite";
    }

    console.log(`🎯 Subscription tier: ${tier}`);

    // Get customer email from Stripe
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    const customerEmail = customer.email;

    console.log(`📧 Customer email: ${customerEmail}`);

    // Find contractor by email
    const contractor = await prisma.contractor.findUnique({
      where: { email: customerEmail.toLowerCase() },
    });

    if (!contractor) {
      console.error(`❌ No contractor found with email: ${customerEmail}`);
      throw new Error(`No contractor found with email: ${customerEmail}`);
    }

    console.log(`✅ Found contractor: ${contractor.businessName}`);

    // Get payment method
    let paymentMethodData = {};
    if (customer.invoice_settings?.default_payment_method) {
      const pmId = customer.invoice_settings.default_payment_method;
      const pm = await stripe.paymentMethods.retrieve(pmId);
      
      paymentMethodData = {
        stripePaymentMethodId: pm.id,
        paymentMethodLast4: pm.card?.last4,
        paymentMethodBrand: pm.card?.brand,
        paymentMethodExpMonth: pm.card?.exp_month,
        paymentMethodExpYear: pm.card?.exp_year,
      };

      console.log(`💳 Payment method: ${pm.card?.brand} ending in ${pm.card?.last4}`);
    }

    // Update contractor with subscription info
    const updatedContractor = await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        stripeCustomerId: stripeCustomerId,
        stripeSubscriptionId: subscriptionId,
        subscriptionTier: tier,
        subscriptionStatus: "active",
        subscriptionStartDate: new Date(subscription.current_period_start * 1000),
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),
        isAcceptingLeads: contractor.creditBalance >= 500, // Only if they have credit
        ...paymentMethodData,
      },
    });

    console.log(`✅ Contractor updated successfully`);
    console.log(`   Stripe Customer ID: ${stripeCustomerId}`);
    console.log(`   Subscription ID: ${subscriptionId}`);
    console.log(`   Tier: ${tier}`);
    console.log(`   Status: active`);

    // Send welcome email (optional)
    try {
      const { sendSubscriptionConfirmationEmail } = require("./notifications");
      await sendSubscriptionConfirmationEmail(updatedContractor, tier);
    } catch (emailError) {
      console.error("⚠️ Failed to send confirmation email:", emailError);
      // Don't fail the webhook if email fails
    }

    return { success: true, contractor: updatedContractor };
  } catch (error) {
    console.error("❌ Error handling subscription created:", error);
    throw error; // Re-throw to be caught by webhook handler
  }
}

// ============================================
// HANDLE SUBSCRIPTION UPDATED
// ============================================
async function handleSubscriptionUpdated(subscription) {
  console.log("📝 Processing subscription updated:", subscription.id);

  try {
    const contractor = await prisma.contractor.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!contractor) {
      console.error("❌ No contractor found for subscription:", subscription.id);
      return { success: false, error: "Contractor not found" };
    }

    // Determine new tier
    const priceId = subscription.items.data[0].price.id;
    let tier = contractor.subscriptionTier;

    if (priceId === process.env.STRIPE_PRICE_STARTER) {
      tier = "starter";
    } else if (priceId === process.env.STRIPE_PRICE_PRO) {
      tier = "pro";
    } else if (priceId === process.env.STRIPE_PRICE_ELITE) {
      tier = "elite";
    }

    // Determine status
    let status = "inactive";
    if (subscription.status === "active") {
      status = "active";
    } else if (subscription.status === "past_due") {
      status = "past_due";
    } else if (subscription.status === "canceled" || subscription.status === "unpaid") {
      status = "cancelled";
    }

    // Update contractor
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        subscriptionTier: tier,
        subscriptionStatus: status,
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),
        isAcceptingLeads: status === "active" && contractor.creditBalance >= 500,
      },
    });

    console.log(`✅ Subscription updated: ${contractor.businessName} → ${status}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Error handling subscription updated:", error);
    throw error;
  }
}

// ============================================
// HANDLE SUBSCRIPTION DELETED
// ============================================
async function handleSubscriptionDeleted(subscription) {
  console.log("❌ Processing subscription deleted:", subscription.id);

  try {
    const contractor = await prisma.contractor.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!contractor) {
      console.error("❌ No contractor found for subscription:", subscription.id);
      return { success: false, error: "Contractor not found" };
    }

    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        subscriptionStatus: "cancelled",
        isAcceptingLeads: false,
      },
    });

    console.log(`✅ Subscription cancelled: ${contractor.businessName}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Error handling subscription deleted:", error);
    throw error;
  }
}

// ============================================
// HANDLE PAYMENT METHOD UPDATED
// ============================================
async function handlePaymentMethodAttached(paymentMethod) {
  console.log("💳 Processing payment method attached:", paymentMethod.id);

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);
    const customer = await stripe.customers.retrieve(paymentMethod.customer);

    const contractor = await prisma.contractor.findFirst({
      where: { email: customer.email.toLowerCase() },
    });

    if (!contractor) {
      console.error("❌ No contractor found for customer:", customer.email);
      return { success: false, error: "Contractor not found" };
    }

    // Update payment method info
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        stripeCustomerId: customer.id,
        stripePaymentMethodId: paymentMethod.id,
        paymentMethodLast4: paymentMethod.card?.last4,
        paymentMethodBrand: paymentMethod.card?.brand,
        paymentMethodExpMonth: paymentMethod.card?.exp_month,
        paymentMethodExpYear: paymentMethod.card?.exp_year,
      },
    });

    console.log(`✅ Payment method updated: ${contractor.businessName}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Error handling payment method:", error);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handlePaymentMethodAttached,
};