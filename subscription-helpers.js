// subscription-helpers.js
// Helper functions for subscription and credit system

/**
 * Get lead cost based on contractor's tier and beta status
 */
function getLeadCostForContractor(contractor) {
  // Beta testers pay special rate
  if (contractor.isBetaTester && contractor.betaTesterLeadCost) {
    return contractor.betaTesterLeadCost;
  }
  
  // Regular pricing based on tier
  switch (contractor.subscriptionTier) {
    case 'starter':
      return parseFloat(process.env.LEAD_COST_STARTER) / 100; // $75
    case 'pro':
      return parseFloat(process.env.LEAD_COST_PRO) / 100; // $100
    case 'elite':
      return parseFloat(process.env.LEAD_COST_ELITE) / 100; // $250
    default:
      return 100.00; // Default fallback
  }
}

/**
 * Get lead cap based on contractor's tier
 * Returns null for unlimited (elite tier)
 */
function getLeadCapForTier(tier) {
  switch (tier) {
    case 'starter':
      return parseInt(process.env.LEAD_CAP_STARTER); // 15
    case 'pro':
      return parseInt(process.env.LEAD_CAP_PRO); // 40
    case 'elite':
      return parseInt(process.env.LEAD_CAP_ELITE) || null; // 0 = unlimited
    default:
      return 0;
  }
}

/**
 * Check if contractor can receive leads
 * Returns { canReceive: boolean, reason: string }
 */
async function canContractorReceiveLeads(contractor, prisma) {
  // Check 1: Active subscription
  if (contractor.subscriptionStatus !== 'active') {
    return {
      canReceive: false,
      reason: 'No active subscription'
    };
  }
  
  // Check 2: Sufficient credit
  const leadCost = getLeadCostForContractor(contractor);
  if (contractor.creditBalance < leadCost) {
    return {
      canReceive: false,
      reason: `Insufficient credit. Balance: $${contractor.creditBalance}, Need: $${leadCost}`
    };
  }
  
  // Check 3: Monthly lead cap (if applicable)
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
  
  // Check 4: Payment method on file
  if (!contractor.stripePaymentMethodId) {
    return {
      canReceive: false,
      reason: 'No payment method on file'
    };
  }
  
  // Check 5: Accepting leads flag
  if (!contractor.isAcceptingLeads) {
    return {
      canReceive: false,
      reason: 'Not accepting leads (disabled by contractor or admin)'
    };
  }
  
  // All checks passed
  return {
    canReceive: true,
    reason: 'All checks passed'
  };
}

/**
 * Get minimum credit balance required
 */
function getMinimumCreditBalance() {
  return parseFloat(process.env.MINIMUM_CREDIT_BALANCE) / 100 || 500.00;
}

/**
 * Get credit expiry date (60 days from now)
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
  canContractorReceiveLeads,
  getMinimumCreditBalance,
  getCreditExpiryDate,
  formatCurrency
};