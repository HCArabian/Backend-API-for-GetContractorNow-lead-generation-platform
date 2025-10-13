// webhook-handler.js - Save Stripe Data to Database

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ============================================
// SUBSCRIPTION CREATED - Save Everything!
// ============================================
/* async function handleSubscriptionCreated(subscription) {
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
} */

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

    // 🔥 ENHANCED: Get payment method with multiple fallbacks
    let paymentData = {};
    let pmId = null;

    // Try 1: Get from subscription's default payment method
    if (subscription.default_payment_method) {
      pmId = subscription.default_payment_method;
      console.log(
        "💳 Found payment method from subscription.default_payment_method"
      );
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

      // ✅ SECURITY: Store only last 4 digits and metadata
      paymentData = {
        stripePaymentMethodId: pm.id,
        paymentMethodLast4: pm.card?.last4,
        paymentMethodBrand: pm.card?.brand,
        paymentMethodExpMonth: pm.card?.exp_month,
        paymentMethodExpYear: pm.card?.exp_year,
      };

      console.log(`💳 Payment: ${pm.card?.brand} ****${pm.card?.last4}`);
    } else {
      console.warn(`⚠️ No payment method found for ${customerEmail}`);
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
        subscriptionStartDate: new Date(
          subscription.current_period_start * 1000
        ),
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),

        // Enable leads if they have credit
        isAcceptingLeads: contractor.creditBalance >= 500,
      },
    });

    console.log(`✅ Database updated: ${updated.businessName}`);
    console.log(`   Tier: ${tier}`);
    console.log(`   Status: active`);
    if (paymentData.paymentMethodBrand) {
      console.log(
        `   Payment: ${paymentData.paymentMethodBrand} ****${paymentData.paymentMethodLast4}`
      );
    }

    return { success: true };
  } catch (error) {
    console.error("❌ Webhook handler error:", error);
    throw error;
  }
}

// Add this to your webhook handler
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET_TEST
    );
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📨 Webhook received: ${event.type}`);

  try {
    switch (event.type) {
      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;

      // 🔥 NEW: Handle payment method being attached
      case "payment_method.attached":
        await handlePaymentMethodAttached(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 🔥 NEW HANDLER: Save payment method when it's attached
async function handlePaymentMethodAttached(paymentMethod) {
  console.log("💳 Payment method attached:", paymentMethod.id);

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);

    // Find contractor by Stripe customer ID
    const contractor = await prisma.contractor.findFirst({
      where: { stripeCustomerId: paymentMethod.customer },
    });

    if (!contractor) {
      console.log(
        "⚠️ No contractor found for customer:",
        paymentMethod.customer
      );
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
        isAcceptingLeads:
          status === "active" && contractor.creditBalance >= 500,
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

    console.log(
      `✅ Payment method saved: ${paymentMethod.card?.brand} ****${paymentMethod.card?.last4}`
    );
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
