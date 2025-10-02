require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);

async function addTestPaymentMethod(contractorEmail) {
  try {
    const contractor = await prisma.contractor.findUnique({
      where: { email: contractorEmail },
    });

    if (!contractor) {
      throw new Error("Contractor not found");
    }

    console.log("Found contractor:", contractor.businessName);

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: contractor.email,
      name: contractor.businessName,
      metadata: { contractorId: contractor.id },
    });

    console.log("Created Stripe customer:", customer.id);

    // Use Stripe's test payment method token
    const paymentMethod = await stripe.paymentMethods.create({
      type: "card",
      card: {
        token: "tok_visa", // Stripe test token for Visa
      },
    });

    console.log("Created test payment method:", paymentMethod.id);

    // Attach to customer
    await stripe.paymentMethods.attach(paymentMethod.id, {
      customer: customer.id,
    });

    // Set as default
    await stripe.customers.update(customer.id, {
      invoice_settings: {
        default_payment_method: paymentMethod.id,
      },
    });

    // Update contractor in database
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        stripeCustomerId: customer.id,
        stripePaymentMethodId: paymentMethod.id,
      },
    });

    console.log("\n✅ SUCCESS!");
    console.log("Contractor:", contractor.businessName);
    console.log("Stripe Customer ID:", customer.id);
    console.log("Payment Method ID:", paymentMethod.id);
    console.log("\nThis contractor can now receive leads and be charged.");
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

const contractorEmail = process.argv[2];
if (!contractorEmail) {
  console.error("Usage: node add-test-payment-method.js contractor@email.com");
  process.exit(1);
}

addTestPaymentMethod(contractorEmail);
