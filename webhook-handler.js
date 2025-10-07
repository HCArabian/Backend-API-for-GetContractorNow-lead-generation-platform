const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function handleSubscriptionCreated(subscription) {
  console.log("🎉 New subscription created:", subscription.id);

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);
    const stripeCustomerId = subscription.customer;
    
    // Get customer email from Stripe
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    const email = customer.email;

    if (!email) {
      console.error("❌ No email found for Stripe customer:", stripeCustomerId);
      return;
    }

    console.log("📧 Looking for contractor with email:", email);

    // Find contractor by email
    let contractor = await prisma.contractor.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase() },
          { stripeCustomerId: stripeCustomerId }
        ]
      }
    });

    if (!contractor) {
      console.error("❌ Contractor not found for email:", email);
      return;
    }

    // Determine tier from price ID
    let tier = "pro";
    const priceId = subscription.items.data[0].price.id;

    if (priceId === process.env.STRIPE_PRICE_STARTER) {
      tier = "starter";
    } else if (priceId === process.env.STRIPE_PRICE_PRO) {
      tier = "pro";
    } else if (priceId === process.env.STRIPE_PRICE_ELITE) {
      tier = "elite";
    }

    // Check if beta tester
    const isBeta = subscription.discount?.coupon?.id === process.env.STRIPE_PROMO_BETA;

    // Get payment method
    let paymentMethodDetails = {};
    
    try {
      const paymentMethodId = subscription.default_payment_method;
      
      if (paymentMethodId) {
        console.log("💳 Retrieving payment method:", paymentMethodId);
        
        const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
        
        if (paymentMethod && paymentMethod.card) {
          paymentMethodDetails = {
            stripePaymentMethodId: paymentMethod.id,
            paymentMethodLast4: paymentMethod.card.last4,
            paymentMethodBrand: paymentMethod.card.brand,
            paymentMethodExpMonth: paymentMethod.card.exp_month,
            paymentMethodExpYear: paymentMethod.card.exp_year,
          };
          
          console.log(`✅ Payment method saved: ${paymentMethod.card.brand} ending in ${paymentMethod.card.last4}`);
        }
      }
    } catch (pmError) {
      console.error("⚠️ Error retrieving payment method:", pmError.message);
    }

    console.log("✅ Found contractor:", contractor.businessName);
    console.log("   Tier:", tier);
    console.log("   Beta tester:", isBeta);

    // Update contractor
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        stripeCustomerId: stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: "active",
        subscriptionTier: tier,
        subscriptionStartDate: new Date(subscription.current_period_start * 1000),
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),
        isBetaTester: isBeta,
        betaTesterLeadCost: isBeta ? 50.0 : null,
        ...paymentMethodDetails,
      },
    });

    console.log(`✅ Contractor ${contractor.businessName} subscribed to ${tier.toUpperCase()} tier`);
    if (isBeta) {
      console.log("🎟️ Beta tester discount applied - $50/lead pricing");
    }

  } catch (error) {
    console.error("Error handling subscription created:", error);
    throw error;
  }
}

module.exports = {
  handleSubscriptionCreated
};