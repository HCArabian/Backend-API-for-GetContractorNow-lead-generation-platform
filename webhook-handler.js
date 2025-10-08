const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function handleSubscriptionCreated(subscription) {
  try {
    console.log("🔄 Processing subscription:", subscription.id);

    // ✅ FIXED: Access properties directly from subscription object
    const customerId = subscription.customer;
    const subscriptionId = subscription.id;
    const status = subscription.status;

    // Find contractor by Stripe customer ID
    const contractor = await prisma.contractor.findFirst({
      where: { stripeCustomerId: customerId },
    });

    if (!contractor) {
      console.log(`⚠️ No contractor found for customer: ${customerId}`);
      return; // Not an error - might be a different customer
    }

    // Get price ID to determine tier
    const priceId = subscription.items?.data?.[0]?.price?.id;
    let tier = "pro"; // default

    if (priceId === process.env.STRIPE_PRICE_STARTER) {
      tier = "starter";
    } else if (priceId === process.env.STRIPE_PRICE_PRO) {
      tier = "pro";
    } else if (priceId === process.env.STRIPE_PRICE_ELITE) {
      tier = "elite";
    }

    // Update contractor
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: status === "active" ? "active" : "inactive",
        subscriptionTier: tier,
        subscriptionStartDate: new Date(subscription.current_period_start * 1000),
        subscriptionEndDate: new Date(subscription.current_period_end * 1000),
        isAcceptingLeads: status === "active",
      },
    });

    console.log(
      `✅ Subscription created: ${contractor.businessName} - ${tier} tier`
    );
  } catch (error) {
    console.error("❌ Error in handleSubscriptionCreated:", error);
    throw error; // Re-throw so Sentry captures it
  }
}


module.exports = {
  handleSubscriptionCreated
};