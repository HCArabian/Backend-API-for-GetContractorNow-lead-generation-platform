// subscription-helpers.js
// Helper functions for subscription and credit system

const prisma = require("./db");

/**
 * Get lead cost based on contractor's tier and beta status
 * 
 * Pricing (set via env vars):
 *   Starter: $125/lead  (LEAD_COST_STARTER=12500)
 *   Pro:     $175/lead  (LEAD_COST_PRO=17500)
 *   Elite:   $300/lead  (LEAD_COST_ELITE=30000)
 */

function getLeadCostForContractor(contractor) {
  // Beta testers pay special rate
  if (contractor.isBetaTester && contractor.betaTesterLeadCost) {
    return contractor.betaTesterLeadCost;
  }
  
  // Regular pricing based on tier
  switch (contractor.subscriptionTier) {
    case 'starter':
      return parseFloat(process.env.LEAD_COST_STARTER) / 100 || 125.00;
    case 'pro':
      return parseFloat(process.env.LEAD_COST_PRO) / 100 || 175.00;
    case 'elite':
      return parseFloat(process.env.LEAD_COST_ELITE) / 100 || 300.00;
    default:
      return 175.00; // Default fallback
  }
}

/**
 * Get lead cap based on contractor's tier
 * Returns null for unlimited (elite tier)
 * 
 * Caps:
 *   Starter: 15/month   (LEAD_CAP_STARTER=15)
 *   Pro:     40/month   (LEAD_CAP_PRO=40)
 *   Elite:   Unlimited  (LEAD_CAP_ELITE=0)
 */
function getLeadCapForTier(tier) {
  switch (tier) {
    case 'starter':
      return parseInt(process.env.LEAD_CAP_STARTER) || 15;
    case 'pro':
      return parseInt(process.env.LEAD_CAP_PRO) || 40;
    case 'elite':
      return parseInt(process.env.LEAD_CAP_ELITE) || null; // 0 = unlimited
    default:
      return 0;
  }
}

/**
 * Check if contractor meets ALL requirements to receive leads
 * Returns { canReceive: boolean, reason: string }
 * 
 * Checks (in order):
 *   1. Account status is active
 *   2. Account is verified
 *   3. Contractor is accepting leads
 *   4. Subscription is active (or beta tester)
 *   5. Payment method on file (or beta tester)
 *   6. Stripe customer exists (or beta tester)
 *   7. Credit balance meets minimum
 *   8. Monthly lead cap not exceeded
 */
async function canContractorReceiveLeads(contractor) {
  // 1. Check account status
  if (contractor.status !== 'active') {
    return {
      canReceive: false,
      reason: `Account status is ${contractor.status}, not active`
    };
  }

  // 2. Check if verified
  if (!contractor.isVerified) {
    return {
      canReceive: false,
      reason: 'Account is not verified'
    };
  }

  // 3. Check if accepting leads
  if (!contractor.isAcceptingLeads) {
    return {
      canReceive: false,
      reason: 'Contractor has disabled lead acceptance'
    };
  }

  // 4. Check subscription status
  if (contractor.subscriptionStatus !== 'active' && !contractor.isBetaTester) {
    return {
      canReceive: false,
      reason: `Subscription status is ${contractor.subscriptionStatus}, not active`
    };
  }

  // 5. Check payment method exists
  if (!contractor.stripePaymentMethodId && !contractor.isBetaTester) {
    return {
      canReceive: false,
      reason: 'No payment method on file - must add card before receiving leads'
    };
  }

  // 6. Check Stripe customer exists
  if (!contractor.stripeCustomerId && !contractor.isBetaTester) {
    return {
      canReceive: false,
      reason: 'No Stripe customer ID - payment setup incomplete'
    };
  }

  // 7. Check credit balance meets minimum
  const leadCost = getLeadCostForContractor(contractor);
  if (contractor.creditBalance < leadCost) {
    return {
      canReceive: false,
      reason: `Insufficient credit balance ($${contractor.creditBalance.toFixed(2)}) - need at least $${leadCost.toFixed(2)} for one lead`
    };
  }

  // 8. Check monthly lead cap
  const leadCap = getLeadCapForTier(contractor.subscriptionTier);
  if (leadCap !== null && leadCap > 0) {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const leadsThisMonth = await prisma.leadAssignment.count({
      where: {
        contractorId: contractor.id,
        assignedAt: { gte: firstOfMonth }
      }
    });
    
    if (leadsThisMonth >= leadCap) {
      return {
        canReceive: false,
        reason: `Monthly lead cap reached (${leadsThisMonth}/${leadCap})`
      };
    }
  }

  // All checks passed
  return {
    canReceive: true,
    reason: 'All requirements met'
  };
}

/**
 * Get minimum credit balance required
 * Default: $1000
 */
function getMinimumCreditBalance() {
  return parseFloat(process.env.MINIMUM_CREDIT_BALANCE) / 100 || 1000.00;
}

/**
 * Get credit expiry date
 * Default: 60 days from now
 */
function getCreditExpiryDate() {
  const days = parseInt(process.env.CREDIT_EXPIRY_DAYS) || 60;
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);
  return expiryDate;
}

/**
 * Format currency for display
 */
function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

module.exports = {
  getLeadCostForContractor,
  getLeadCapForTier,
  getMinimumCreditBalance,
  getCreditExpiryDate,
  formatCurrency,
  canContractorReceiveLeads,
};