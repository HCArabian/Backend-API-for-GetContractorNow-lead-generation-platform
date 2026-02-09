// services/stripe.js
// Consolidated Stripe module — all Stripe API calls go through here
// Single initialization, null guards, consistent error handling

const Sentry = require("@sentry/node");

let stripe = null;

try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    console.log("✅ Stripe initialized");
  } else {
    console.warn("⚠️ STRIPE_SECRET_KEY not set — Stripe disabled");
  }
} catch (error) {
  console.error("⚠️ Stripe initialization failed:", error.message);
}

/**
 * Throws if Stripe is not initialized
 */
function requireStripe() {
  if (!stripe) {
    throw new Error("Stripe is not initialized — STRIPE_SECRET_KEY not set");
  }
  return stripe;
}

/**
 * Get the raw stripe instance (for webhook signature verification)
 */
function getStripeInstance() {
  return stripe;
}

// ============================================
// WEBHOOK HELPERS
// ============================================

/**
 * Verify and construct a Stripe webhook event
 */
function constructWebhookEvent(body, signature, secret) {
  const s = requireStripe();
  return s.webhooks.constructEvent(body, signature, secret);
}

// ============================================
// SUBSCRIPTION MANAGEMENT
// ============================================

/**
 * Retrieve a subscription by ID
 */
async function retrieveSubscription(subscriptionId) {
  const s = requireStripe();
  return s.subscriptions.retrieve(subscriptionId);
}

/**
 * Update a subscription (change plan, cancel, reactivate)
 */
async function updateSubscription(subscriptionId, updateData) {
  const s = requireStripe();
  return s.subscriptions.update(subscriptionId, updateData);
}

// ============================================
// PAYMENT METHODS
// ============================================

/**
 * Retrieve payment method details
 */
async function retrievePaymentMethod(paymentMethodId) {
  const s = requireStripe();
  return s.paymentMethods.retrieve(paymentMethodId);
}

/**
 * Attach a payment method to a customer
 */
async function attachPaymentMethod(paymentMethodId, customerId) {
  const s = requireStripe();
  return s.paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });
}

// ============================================
// CHECKOUT & BILLING PORTAL
// ============================================

/**
 * Create a checkout session for subscription signup
 */
async function createCheckoutSession(params) {
  const s = requireStripe();
  return s.checkout.sessions.create(params);
}

/**
 * Create a billing portal session
 */
async function createBillingPortalSession(customerId, returnUrl) {
  const s = requireStripe();
  return s.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

// ============================================
// PAYMENT INTENTS
// ============================================

/**
 * Create a payment intent (for credit deposits and lead charging)
 */
async function createPaymentIntent(params) {
  const s = requireStripe();
  return s.paymentIntents.create(params);
}

// ============================================
// SETUP INTENTS
// ============================================

/**
 * Create a setup intent for adding a payment method
 */
async function createSetupIntent(customerId) {
  const s = requireStripe();
  return s.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
  });
}

// ============================================
// CUSTOMERS
// ============================================

/**
 * Create a Stripe customer
 */
async function createCustomer(params) {
  const s = requireStripe();
  return s.customers.create(params);
}

/**
 * Search for customers by email
 */
async function listCustomersByEmail(email, limit = 1) {
  const s = requireStripe();
  return s.customers.list({
    email: email,
    limit: limit,
  });
}

// ============================================
// INVOICES
// ============================================

/**
 * List invoices for a customer
 */
async function listInvoices(customerId, limit = 12) {
  const s = requireStripe();
  return s.invoices.list({
    customer: customerId,
    limit: limit,
  });
}

module.exports = {
  getStripeInstance,
  requireStripe,
  constructWebhookEvent,
  retrieveSubscription,
  updateSubscription,
  retrievePaymentMethod,
  attachPaymentMethod,
  createCheckoutSession,
  createBillingPortalSession,
  createPaymentIntent,
  createSetupIntent,
  createCustomer,
  listCustomersByEmail,
  listInvoices,
};