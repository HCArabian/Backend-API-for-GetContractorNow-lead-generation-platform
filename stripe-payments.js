const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create a customer in Stripe for a contractor
async function createStripeCustomer(contractor) {
  try {
    const customer = await stripe.customers.create({
      email: contractor.email,
      name: contractor.businessName,
      phone: contractor.phone,
      metadata: {
        contractorId: contractor.id,
        platform: 'GetContractorNow'
      }
    });

    // Save Stripe customer ID to database
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: { stripeCustomerId: customer.id }
    });

    console.log('Stripe customer created:', customer.id);
    return customer;
  } catch (error) {
    console.error('Stripe customer creation error:', error);
    throw error;
  }
}

// Charge contractor for a lead
async function chargeContractorForLead(contractorId, leadId, amount, description) {
  try {
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId }
    });

    if (!contractor.stripeCustomerId) {
      throw new Error('Contractor has no Stripe customer ID');
    }

    if (!contractor.stripePaymentMethodId) {
      throw new Error('Contractor has no payment method on file');
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      customer: contractor.stripeCustomerId,
      payment_method: contractor.stripePaymentMethodId,
      off_session: true, // Charge without customer present
      confirm: true, // Charge immediately
      description: description,
      metadata: {
        contractorId: contractorId,
        leadId: leadId
      }
    });

    console.log('Payment successful:', paymentIntent.id);

    // Update billing record with Stripe payment ID
    await prisma.billingRecord.update({
      where: {
        leadId_contractorId: {
          leadId: leadId,
          contractorId: contractorId
        }
      },
      data: {
        stripePaymentId: paymentIntent.id,
        status: 'paid',
        paidAt: new Date()
      }
    });

    return {
      success: true,
      paymentIntentId: paymentIntent.id,
      amount: amount
    };

  } catch (error) {
    console.error('Payment error:', error);

    // Update billing record with error
    await prisma.billingRecord.update({
      where: {
        leadId_contractorId: {
          leadId: leadId,
          contractorId: contractorId
        }
      },
      data: {
        status: 'failed',
        notes: `Payment failed: ${error.message}`
      }
    });

    return {
      success: false,
      error: error.message
    };
  }
}

// Create a setup intent for adding payment method
async function createSetupIntent(contractorId) {
  try {
    const contractor = await prisma.contractor.findUnique({
      where: { id: contractorId }
    });

    if (!contractor.stripeCustomerId) {
      const customer = await createStripeCustomer(contractor);
      contractor.stripeCustomerId = customer.id;
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: contractor.stripeCustomerId,
      payment_method_types: ['card']
    });

    return setupIntent;
  } catch (error) {
    console.error('Setup intent error:', error);
    throw error;
  }
}

// Save payment method after contractor adds it
async function savePaymentMethod(contractorId, paymentMethodId) {
  try {
    await prisma.contractor.update({
      where: { id: contractorId },
      data: { stripePaymentMethodId: paymentMethodId }
    });

    console.log('Payment method saved for contractor:', contractorId);
    return { success: true };
  } catch (error) {
    console.error('Save payment method error:', error);
    throw error;
  }
}

module.exports = {
  createStripeCustomer,
  chargeContractorForLead,
  createSetupIntent,
  savePaymentMethod
};