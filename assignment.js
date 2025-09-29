// assignment.js - Contractor Assignment System

// ============================================
// ASSIGNMENT ALGORITHM
// ============================================
const { assignTrackingNumber } = require('./trackingNumbers');
const { sendNewLeadEmail } = require('./notifications');


async function assignContractorToLead(leadId, prisma) {
  try {
    console.log(`\n🔍 Starting contractor assignment for lead ${leadId}`);
    
    // Get lead details
    const lead = await prisma.lead.findUnique({
      where: { id: leadId }
    });
    
    if (!lead) {
      console.error('❌ Lead not found');
      return { success: false, error: 'Lead not found' };
    }
    
    console.log(`📋 Lead details:`, {
      category: lead.category,
      service: lead.serviceType,
      zip: lead.customerZip,
      timeline: lead.timeline,
      score: lead.score
    });
    
    // Skip assignment for NURTURE leads
    if (lead.category === 'NURTURE') {
      console.log('⏭️  NURTURE lead - skipping assignment');
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'nurture_no_assignment' }
      });
      return { 
        success: true, 
        message: 'NURTURE lead - no contractor assigned',
        assigned: false
      };
    }
    
    // ============================================
    // FIND ELIGIBLE CONTRACTORS
    // ============================================
    
    console.log('🔎 Searching for eligible contractors...');
    
    // Step 1: Geographic match (contractors covering this ZIP code)
    const eligibleContractors = await prisma.contractor.findMany({
      where: {
        // Must cover this ZIP code
        serviceZipCodes: { has: lead.customerZip },
        
        // Must be active and accepting leads
        status: 'active',
        isAcceptingLeads: true,
        isVerified: true,
        
        // Must have specialization match
        specializations: { has: lead.serviceType }
      }
    });
    
    console.log(`📊 Found ${eligibleContractors.length} contractors covering ZIP ${lead.customerZip}`);
    
    if (eligibleContractors.length === 0) {
      // No contractors available - mark lead as unassigned
      console.warn('⚠️  No contractors available for this area/service');
      
      await prisma.lead.update({
        where: { id: leadId },
        data: { 
          status: 'no_contractor_available',
          rejectionReason: `No contractors available in ZIP ${lead.customerZip} for ${lead.serviceType}`
        }
      });
      
      return { 
        success: false, 
        error: 'No contractors available in this area',
        assigned: false
      };
    }
    
    // ============================================
    // FILTER BY PERFORMANCE REQUIREMENTS
    // ============================================
    
    console.log('✨ Filtering by performance requirements...');
    
    let qualifiedContractors = eligibleContractors;
    
    // PLATINUM leads: Only best contractors (4.5+ rating, 70%+ conversion)
    if (lead.category === 'PLATINUM') {
      qualifiedContractors = eligibleContractors.filter(c => 
        (c.customerRating || 0) >= 4.5 && 
        (c.conversionRate || 0) >= 0.70 &&
        (c.avgResponseTime || 999) <= 20 // Must respond within 20 min
      );
      
      console.log(`💎 PLATINUM requirements: ${qualifiedContractors.length} qualified`);
    }
    
    // GOLD leads: Top tier contractors (4.0+ rating, 55%+ conversion)
    else if (lead.category === 'GOLD') {
      qualifiedContractors = eligibleContractors.filter(c => 
        (c.customerRating || 0) >= 4.0 && 
        (c.conversionRate || 0) >= 0.55 &&
        (c.avgResponseTime || 999) <= 120 // Must respond within 2 hours
      );
      
      console.log(`⭐ GOLD requirements: ${qualifiedContractors.length} qualified`);
    }
    
    // SILVER/BRONZE: Any verified contractor
    else {
      console.log(`💎 ${lead.category} requirements: All ${qualifiedContractors.length} contractors qualified`);
    }
    
    // If no contractors meet performance requirements, use all eligible
    if (qualifiedContractors.length === 0) {
      console.warn('⚠️  No contractors meet performance requirements, using all eligible');
      qualifiedContractors = eligibleContractors;
    }
    
    // ============================================
    // CHECK CAPACITY LIMITS
    // ============================================
    
    console.log('📊 Checking capacity limits...');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const thisWeekStart = new Date();
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
    thisWeekStart.setHours(0, 0, 0, 0);
    
    // Check each contractor's current load
    const contractorsWithCapacity = [];
    
    for (const contractor of qualifiedContractors) {
      // Count today's leads
      const leadsToday = await prisma.leadAssignment.count({
        where: {
          contractorId: contractor.id,
          assignedAt: { gte: today }
        }
      });
      
      // Count this week's leads
      const leadsThisWeek = await prisma.leadAssignment.count({
        where: {
          contractorId: contractor.id,
          assignedAt: { gte: thisWeekStart }
        }
      });
      
      const hasCapacity = 
        leadsToday < (contractor.maxLeadsPerDay || 999) &&
        leadsThisWeek < (contractor.maxLeadsPerWeek || 999);
      
      if (hasCapacity) {
        contractorsWithCapacity.push({
          ...contractor,
          currentDailyLoad: leadsToday,
          currentWeeklyLoad: leadsThisWeek
        });
      } else {
        console.log(`❌ ${contractor.businessName} at capacity (today: ${leadsToday}/${contractor.maxLeadsPerDay}, week: ${leadsThisWeek}/${contractor.maxLeadsPerWeek})`);
      }
    }
    
    console.log(`✅ ${contractorsWithCapacity.length} contractors have capacity`);
    
    if (contractorsWithCapacity.length === 0) {
      console.warn('⚠️  All contractors at capacity');
      
      await prisma.lead.update({
        where: { id: leadId },
        data: { 
          status: 'contractors_at_capacity',
          rejectionReason: 'All available contractors at capacity'
        }
      });
      
      return { 
        success: false, 
        error: 'All contractors at capacity',
        assigned: false
      };
    }
    
    // ============================================
    // CALCULATE PRIORITY SCORES
    // ============================================
    
    console.log('🎯 Calculating priority scores...');
    
    const scoredContractors = contractorsWithCapacity.map(contractor => {
      let priorityScore = 50; // Base score
      
      // Performance bonuses
      if ((contractor.customerRating || 0) >= 4.8) priorityScore += 20;
      else if ((contractor.customerRating || 0) >= 4.5) priorityScore += 15;
      else if ((contractor.customerRating || 0) >= 4.0) priorityScore += 10;
      
      if ((contractor.conversionRate || 0) >= 0.80) priorityScore += 20;
      else if ((contractor.conversionRate || 0) >= 0.70) priorityScore += 15;
      else if ((contractor.conversionRate || 0) >= 0.55) priorityScore += 10;
      
      if ((contractor.avgResponseTime || 999) <= 15) priorityScore += 15;
      else if ((contractor.avgResponseTime || 999) <= 30) priorityScore += 10;
      else if ((contractor.avgResponseTime || 999) <= 60) priorityScore += 5;
      
      // Load balancing bonus (less busy = higher priority)
      const loadPercentage = contractor.currentDailyLoad / (contractor.maxLeadsPerDay || 5);
      if (loadPercentage <= 0.3) priorityScore += 15; // Under 30% capacity
      else if (loadPercentage <= 0.5) priorityScore += 10; // Under 50%
      else if (loadPercentage <= 0.7) priorityScore += 5; // Under 70%
      
      // Exact specialization match bonus
      const hasExactMatch = contractor.specializations?.includes(lead.serviceType);
      if (hasExactMatch) priorityScore += 10;
      
      return {
        contractor,
        priorityScore
      };
    });
    
    // Sort by priority score (highest first)
    scoredContractors.sort((a, b) => b.priorityScore - a.priorityScore);
    
    console.log('🏆 Top 3 contractors by priority:');
    scoredContractors.slice(0, 3).forEach((sc, idx) => {
      console.log(`  ${idx + 1}. ${sc.contractor.businessName} - Score: ${sc.priorityScore}`);
    });
    
    // ============================================
    // SELECT BEST CONTRACTOR
    // ============================================
    
    const selectedContractor = scoredContractors[0].contractor;
    
    console.log(`\n✅ Selected: ${selectedContractor.businessName}`);
    console.log(`   Rating: ${selectedContractor.customerRating || 'N/A'}`);
    console.log(`   Conversion: ${((selectedContractor.conversionRate || 0) * 100).toFixed(0)}%`);
    console.log(`   Avg Response: ${selectedContractor.avgResponseTime || 'N/A'} min`);
    
    // ============================================
    // CREATE ASSIGNMENT
    // ============================================
    
    // Calculate response deadline based on lead category
    const responseTimeMinutes = {
      'PLATINUM': 20,
      'GOLD': 120,
      'SILVER': 1440,  // 24 hours
      'BRONZE': 2880   // 48 hours
    }[lead.category] || 1440;
    
    const responseDeadline = new Date(Date.now() + responseTimeMinutes * 60 * 1000);
    
    const assignment = await prisma.leadAssignment.create({
      data: {
        leadId: lead.id,
        contractorId: selectedContractor.id,
        assignedAt: new Date(),
        responseDeadline: responseDeadline,
        status: 'assigned'
      }
    });
    
    // Update lead status
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: 'assigned',
        assignedAt: new Date()
      }
    });
    
    // Update contractor's current lead count (for tracking)
    await prisma.contractor.update({
      where: { id: selectedContractor.id },
      data: {
        currentLeadCount: { increment: 1 },
        totalLeadsReceived: { increment: 1 }
      }
    });
    
// ============================================
// ASSIGN TRACKING NUMBER
// ============================================

console.log(`\n📞 Assigning tracking number...`);

const trackingResult = await assignTrackingNumber(
  lead.id,
  selectedContractor.id,
  lead.customerPhone,
  selectedContractor.phone,
  prisma
);

if (!trackingResult.success) {
  console.error('⚠️  Failed to assign tracking number:', trackingResult.error);
  // Assignment still succeeds, but without tracking number
}

// ============================================
// SEND EMAIL NOTIFICATION
// ============================================

console.log(`\n📧 Sending email notification...`);

const emailResult = await sendNewLeadEmail(
  selectedContractor,
  lead,
  assignment,
  trackingResult.trackingNumber
);

if (!emailResult.success) {
  console.error('⚠️  Failed to send email:', emailResult.error);
}

// NOW THE EXISTING COMPLETION LOG:
console.log(`\n🎉 Assignment complete!`);
console.log(`   Assignment ID: ${assignment.id}`);
console.log(`   Tracking Number: ${trackingResult.trackingNumber || 'Not assigned'}`);
console.log(`   Response deadline: ${responseDeadline.toLocaleString()}`);
console.log(`   Must respond within: ${responseTimeMinutes} minutes\n`);
    
    return {
      success: true,
      assigned: true,
      contractor: {
        id: selectedContractor.id,
        businessName: selectedContractor.businessName,
        phone: selectedContractor.phone,
        email: selectedContractor.email
      },
      assignment: {
        id: assignment.id,
        responseDeadline: responseDeadline,
        responseTimeMinutes: responseTimeMinutes
      },
      trackingNumber: trackingResult.success ? trackingResult.trackingNumber : null
    };
    
  } catch (error) {
    console.error('❌ Error in contractor assignment:', error);
    return {
      success: false,
      error: error.message,
      assigned: false
    };
  }
}

module.exports = { assignContractorToLead };