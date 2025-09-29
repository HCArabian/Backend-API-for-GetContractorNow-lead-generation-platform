const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calculateLeadScore } = require('./scoring');
const { assignContractorToLead } = require('./assignment');

const app = express();

// CORS - Allow requests from your Webflow site
app.use(cors({
  origin: '*', // Allow all origins for now (we'll restrict later)
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // IMPORTANT: For Twilio webhooks

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'GetContractorNow API is running',
    timestamp: new Date().toISOString()
  });
});

// Lead submission endpoint
app.post('/api/leads/submit', async (req, res) => {
  try {
    const leadData = req.body;
    console.log('Received lead submission:', {
      email: leadData.email,
      phone: leadData.phone,
      service: leadData.service_type
    });
    
    // Run advanced scoring algorithm
    const scoringResult = await calculateLeadScore(leadData, prisma);
    
    console.log('Scoring result:', scoringResult);
    
    // If lead is rejected, return error with specific reasons
    if (scoringResult.status === 'rejected') {
      console.log('Lead rejected:', scoringResult.rejectReasons);
      
      return res.status(400).json({
        success: false,
        error: 'Lead validation failed',
        validationErrors: scoringResult.validationErrors,
        message: scoringResult.validationErrors.join('. ')
      });
    }
    
    // Lead approved - save to database
    const savedLead = await prisma.lead.create({
      data: {
        // Customer Info
        customerFirstName: leadData.first_name,
        customerLastName: leadData.last_name,
        customerEmail: leadData.email,
        customerPhone: leadData.phone,
        customerAddress: leadData.address,
        customerCity: leadData.city,
        customerState: leadData.state,
        customerZip: leadData.zip,
        
        // Service Details
        serviceType: leadData.service_type,
        serviceDescription: leadData.service_description || null,
        timeline: leadData.timeline,
        budgetRange: leadData.budget_range,
        propertyType: leadData.property_type,
        propertyAge: leadData.property_age || null,
        existingSystem: leadData.existing_system || null,
        systemIssue: leadData.system_issue || null,
        
        // Contact Preferences
        preferredContactTime: leadData.preferred_contact_time || null,
        preferredContactMethod: leadData.preferred_contact_method || 'phone',
        
        // Marketing Tracking
        referralSource: leadData.referral_source || null,
        utmSource: leadData.utm_source || null,
        utmMedium: leadData.utm_medium || null,
        utmCampaign: leadData.utm_campaign || null,
        
        // Form Metadata
        formCompletionTime: leadData.form_completion_time || null,
        ipAddress: leadData.ip_address || null,
        userAgent: leadData.user_agent || null,
        
        // Scoring Results
        score: scoringResult.score,
        category: scoringResult.category,
        price: scoringResult.price,
        confidenceLevel: scoringResult.confidenceLevel,
        qualityFlags: scoringResult.qualityFlags,
        
        // Status
        status: 'pending_assignment'
      }
    });
    
    console.log('✅ Lead saved successfully:', {
      id: savedLead.id,
      category: savedLead.category,
      score: savedLead.score,
      price: savedLead.price
    });
    
    // ============================================
    // NEW: AUTOMATICALLY ASSIGN CONTRACTOR
    // ============================================
    
    console.log('\n🔄 Starting contractor assignment...');
    
    const assignmentResult = await assignContractorToLead(savedLead.id, prisma);
    
    if (assignmentResult.success && assignmentResult.assigned) {
      console.log('✅ Lead assigned to contractor:', assignmentResult.contractor.businessName);
      
      // Return success with assignment details
      return res.json({
        success: true,
        message: 'Lead received, approved, and assigned to contractor',
        leadId: savedLead.id,
        category: savedLead.category,
        score: savedLead.score,
        assignment: {
          contractor: assignmentResult.contractor.businessName,
          responseDeadline: assignmentResult.assignment.responseDeadline
        }
      });
    } else {
      console.log('⚠️  Lead saved but not assigned:', assignmentResult.error || 'No contractors available');
      
      // Lead saved but couldn't assign
      return res.json({
        success: true,
        message: 'Lead received and approved, but no contractors available',
        leadId: savedLead.id,
        category: savedLead.category,
        score: savedLead.score,
        warning: assignmentResult.error || 'No contractors available in this area'
      });
    }
    
  } catch (error) {
    console.error('❌ Error processing lead:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Something went wrong processing your request'
    });
  }
});

// ============================================
// TWILIO WEBHOOK - BILLING AUTOMATION
// ============================================
app.post('/api/webhooks/twilio/call-status', async (req, res) => {
  try {
    // Get Twilio's call data (sent as form-urlencoded)
    const {
      CallSid: callSid,
      CallStatus: callStatus,
      CallDuration: callDuration,
      From: from,
      To: to,
      Direction: direction,
      RecordingUrl: recordingUrl,
      RecordingSid: recordingSid
    } = req.body;
    
    // Validate required fields
    if (!callSid || !callStatus) {
      return res.status(400).json({ error: 'Missing required Twilio fields' });
    }

    console.log('📞 TWILIO WEBHOOK RECEIVED:', {
      callSid,
      callStatus,
      callDuration,
      from,
      to,
      direction,
    });

    // STEP 1: Find the tracking number record
    const trackingNumber = await prisma.trackingNumber.findFirst({
      where: {
        twilioNumber: to,
        status: 'active'
      },
      include: {
        lead: {
          include: {
            assignment: true
          }
        }
      }
    });

    if (!trackingNumber) {
      console.error('❌ Tracking number not found:', to);
      return res.status(404).json({ error: 'Tracking number not found' });
    }

    console.log('✅ Found tracking number for Lead ID:', trackingNumber.leadId);

    // Get contractor ID from lead assignment
    const contractorId = trackingNumber.lead.assignment?.contractorId;
    
    if (!contractorId) {
      console.error('❌ No contractor assigned to lead:', trackingNumber.leadId);
      return res.status(400).json({ error: 'No contractor assigned' });
    }

    // STEP 2: Create or update CallLog
    const callLog = await prisma.callLog.upsert({
      where: {
        callSid: callSid
      },
      update: {
        callStatus: callStatus,
        callEndedAt: callStatus === 'completed' ? new Date() : null,
        callDuration: callDuration ? parseInt(callDuration) : null,
        recordingUrl: recordingUrl || null,
        recordingSid: recordingSid || null,
      },
      create: {
        callSid: callSid,
        leadId: trackingNumber.leadId,
        contractorId: contractorId,
        callDirection: direction === 'inbound' ? 'customer_to_contractor' : 'contractor_to_customer',
        trackingNumber: to,
        callStartedAt: new Date(),
        callEndedAt: callStatus === 'completed' ? new Date() : null,
        callDuration: callDuration ? parseInt(callDuration) : null,
        callStatus: callStatus,
        recordingUrl: recordingUrl || null,
        recordingSid: recordingSid || null,
      }
    });

    console.log('✅ CallLog created/updated:', callLog.id);

    // STEP 3: BILLING LOGIC - THE CRITICAL PART!
    // Only create billing if:
    // 1. Call is completed
    // 2. Call duration > 30 seconds
    // 3. No existing billing record for this lead + contractor
    
    if (callStatus === 'completed' && callDuration && parseInt(callDuration) > 30) {
      
      console.log('💰 Call qualifies for billing (>30 seconds)');

      // Check if billing record already exists (prevent double-billing)
      const existingBilling = await prisma.billingRecord.findFirst({
        where: {
          leadId: trackingNumber.leadId,
          contractorId: contractorId
        }
      });

      if (existingBilling) {
        console.log('⚠️ Billing record already exists - skipping duplicate');
        return res.json({ 
          success: true, 
          message: 'Call logged - billing already exists',
          callLogId: callLog.id 
        });
      }

      // CREATE BILLING RECORD - This is where the money is tracked!
      const billingRecord = await prisma.billingRecord.create({
        data: {
          leadId: trackingNumber.leadId,
          contractorId: contractorId,
          amount: 250.00, // Your lead price
          status: 'pending',
          billedAt: new Date(),
          serviceType: trackingNumber.lead.serviceType,
        }
      });

      console.log('🎉 BILLING RECORD CREATED:', {
        billingId: billingRecord.id,
        contractorId: contractorId,
        leadId: trackingNumber.leadId,
        amount: '$250.00'
      });

      // STEP 4: Update lead status to "contacted"
      await prisma.lead.update({
        where: { id: trackingNumber.leadId },
        data: { 
          status: 'contacted',
          firstContactAt: new Date()
        }
      });

      // STEP 5: Update lead assignment status
      if (trackingNumber.lead.assignment) {
        await prisma.leadAssignment.update({
          where: { id: trackingNumber.lead.assignment.id },
          data: { 
            status: 'contacted',
            contactedAt: new Date()
          }
        });
      }

      return res.json({ 
        success: true,
        message: 'Call logged and billing created',
        callLogId: callLog.id,
        billingRecordId: billingRecord.id,
        amount: 250.00
      });
    }

    // Call completed but didn't meet billing threshold
    return res.json({ 
      success: true,
      message: 'Call logged - did not meet billing criteria',
      callLogId: callLog.id,
      reason: callDuration ? `Duration too short (${callDuration}s < 30s)` : 'No duration recorded'
    });

  } catch (error) {
    console.error('❌ WEBHOOK ERROR:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});