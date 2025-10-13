// webhook-handler.js - Save Stripe Data to Database

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ============================================
// SUBSCRIPTION CREATED - Save Everything!
// ============================================
async function handleSubscriptionCreated(subscription) {
  console.log("📝 Saving subscription to database:", subscription.id);

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);

    // Get customer details
    const customer = await stripe.customers.retrieve(subscription.customer);
    const customerEmail = customer.email;

    console.log(`📧 Customer: ${customerEmail}`);

    // Find contractor
    const contractor = await prisma.contractor.findUnique({
      where: { email: customerEmail.toLowerCase() },
    });

    if (!contractor) {
      throw new Error(`No contractor found with email: ${customerEmail}`);
    }

    // Determine tier from price ID
    const priceId = subscription.items.data[0].price.id;
    let tier = "pro";

    if (priceId === process.env.STRIPE_PRICE_STARTER) tier = "starter";
    else if (priceId === process.env.STRIPE_PRICE_PRO) tier = "pro";
    else if (priceId === process.env.STRIPE_PRICE_ELITE) tier = "elite";

    // 🔥 Get payment method with multiple fallbacks
    let paymentData = {};
    let pmId = null;

    // Try 1: Get from subscription's default payment method
    if (subscription.default_payment_method) {
      pmId = subscription.default_payment_method;
      console.log("💳 Found payment method from subscription.default_payment_method");
    }
    // Try 2: Get from customer invoice settings
    else if (customer.invoice_settings?.default_payment_method) {
      pmId = customer.invoice_settings.default_payment_method;
      console.log("💳 Found payment method from customer.invoice_settings");
    }
    // Try 3: Get the most recent payment method attached to customer
    else {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: subscription.customer,
        type: "card",
        limit: 1,
      });

      if (paymentMethods.data.length > 0) {
        pmId = paymentMethods.data[0].id;
        console.log("💳 Found payment method from payment methods list");
      }
    }

    // If we found a payment method, retrieve its details
    if (pmId) {
      const pm = await stripe.paymentMethods.retrieve(pmId);

      // ✅ Save payment method ID + display info
      paymentData = {
        stripePaymentMethodId: pm.id,
        paymentMethodLast4: pm.card?.last4,
        paymentMethodBrand: pm.card?.brand,
        paymentMethodExpMonth: pm.card?.exp_month,
        paymentMethodExpYear: pm.card?.exp_year,
      };

      console.log(`💳 Payment method saved: ${pm.card?.brand} ****${pm.card?.last4} (ID: ${pm.id})`);
    } else {
      console.warn(`⚠️ No payment method found for ${customerEmail}`);
    }

    // ✅ SAVE TO DATABASE
    const updated = await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        // Stripe IDs
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,

        // Payment Method
        ...paymentData,

        // Subscription Details
        subscriptionTier: tier,
        subscriptionStatus: "active",
        subscriptionStartDate: new Date(subscription.current_period_start * 1000),
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),

        // Enable leads if they have credit
        isAcceptingLeads: contractor.creditBalance >= 500,
      },
    });

    console.log(`✅ Database updated: ${updated.businessName}`);
    console.log(`   Tier: ${tier}`);
    console.log(`   Status: active`);
    if (paymentData.paymentMethodBrand) {
      console.log(`   Payment: ${paymentData.paymentMethodBrand} ****${paymentData.paymentMethodLast4}`);
    }

    return { success: true };
  } catch (error) {
    console.error("❌ Webhook handler error:", error);
    throw error;
  }
}

// ============================================
// SUBSCRIPTION UPDATED - Update Database
// ============================================
async function handleSubscriptionUpdated(subscription) {
  console.log("📝 Updating subscription in database:", subscription.id);

  try {
    const contractor = await prisma.contractor.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!contractor) {
      console.log("⚠️ No contractor found for subscription");
      return { success: false };
    }

    // Determine new tier
    const priceId = subscription.items.data[0].price.id;
    let tier = contractor.subscriptionTier;

    if (priceId === process.env.STRIPE_PRICE_STARTER) tier = "starter";
    else if (priceId === process.env.STRIPE_PRICE_PRO) tier = "pro";
    else if (priceId === process.env.STRIPE_PRICE_ELITE) tier = "elite";

    // Determine status
    let status = "inactive";
    if (subscription.status === "active") status = "active";
    else if (subscription.status === "past_due") status = "past_due";
    else if (subscription.status === "canceled") status = "cancelled";

    // ✅ UPDATE DATABASE
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        subscriptionTier: tier,
        subscriptionStatus: status,
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),
        isAcceptingLeads: status === "active" && contractor.creditBalance >= 500,
      },
    });

    console.log(`✅ Updated: ${contractor.businessName} → ${status}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Update handler error:", error);
    throw error;
  }
}

// ============================================
// SUBSCRIPTION DELETED
// ============================================
async function handleSubscriptionDeleted(subscription) {
  console.log("❌ Subscription deleted:", subscription.id);

  try {
    const contractor = await prisma.contractor.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!contractor) {
      console.log("⚠️ No contractor found for subscription");
      return { success: false };
    }

    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        subscriptionStatus: "cancelled",
        isAcceptingLeads: false,
      },
    });

    console.log(`✅ Subscription cancelled for: ${contractor.businessName}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Delete handler error:", error);
    throw error;
  }
}

// ============================================
// PAYMENT METHOD ATTACHED
// ============================================
async function handlePaymentMethodAttached(paymentMethod) {
  console.log("💳 Payment method attached:", paymentMethod.id);

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);

    // Find contractor by Stripe customer ID
    const contractor = await prisma.contractor.findFirst({
      where: { stripeCustomerId: paymentMethod.customer },
    });

    if (!contractor) {
      console.log("⚠️ No contractor found for customer:", paymentMethod.customer);
      return;
    }

    // Only update if they don't already have a payment method
    if (!contractor.stripePaymentMethodId) {
      await prisma.contractor.update({
        where: { id: contractor.id },
        data: {
          stripePaymentMethodId: paymentMethod.id,
          paymentMethodLast4: paymentMethod.card?.last4,
          paymentMethodBrand: paymentMethod.card?.brand,
          paymentMethodExpMonth: paymentMethod.card?.exp_month,
          paymentMethodExpYear: paymentMethod.card?.exp_year,
        },
      });

      console.log(
        `✅ Payment method saved: ${contractor.businessName} - ${paymentMethod.card?.brand} ****${paymentMethod.card?.last4}`
      );
    }
  } catch (error) {
    console.error("❌ Error handling payment method attached:", error);
  }
}

module.exports = {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handlePaymentMethodAttached,
};