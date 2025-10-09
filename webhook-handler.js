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

    // Get payment method (last 4 digits only!)
    let paymentData = {};
    
    if (customer.invoice_settings?.default_payment_method) {
      const pmId = customer.invoice_settings.default_payment_method;
      const pm = await stripe.paymentMethods.retrieve(pmId);
      
      // ✅ SECURITY: Store only last 4 digits and metadata
      paymentData = {
        stripePaymentMethodId: pm.id,
        paymentMethodLast4: pm.card?.last4,
        paymentMethodBrand: pm.card?.brand,
        paymentMethodExpMonth: pm.card?.exp_month,
        paymentMethodExpYear: pm.card?.exp_year,
      };

      console.log(`💳 Payment: ${pm.card?.brand} ****${pm.card?.last4}`);
    }

    // ✅ SAVE TO DATABASE (single source of truth)
    const updated = await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        // Stripe IDs
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        
        // Payment Method (last 4 only!)
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
    console.log(`   Payment: ${paymentData.paymentMethodBrand} ****${paymentData.paymentMethodLast4}`);

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
// PAYMENT METHOD UPDATED - Save Last 4 Only
// ============================================
async function handlePaymentMethodAttached(paymentMethod) {
  console.log("💳 Saving payment method to database");

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);
    const customer = await stripe.customers.retrieve(paymentMethod.customer);

    const contractor = await prisma.contractor.findFirst({
      where: { email: customer.email.toLowerCase() },
    });

    if (!contractor) {
      console.log("⚠️ No contractor found");
      return { success: false };
    }

    // ✅ SECURITY: Save only last 4 digits and metadata
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

    console.log(`✅ Payment method saved: ${paymentMethod.card?.brand} ****${paymentMethod.card?.last4}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Payment method handler error:", error);
    throw error;
  }
}

module.exports = {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handlePaymentMethodAttached,
};