const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client'); // ADD THIS LINE
const prisma = new PrismaClient(); // ADD THIS LINE
const { calculateLeadScore } = require('./scoring');

const app = express();

// CORS - Allow requests from your Webflow site
app.use(cors({
  origin: '*', // Allow all origins for now (we'll restrict later)
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'GetContractorNow API is running',
    timestamp: new Date().toISOString()
  });
});

// Lead submission endpoint
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
    
    // Return success with lead details
    res.json({
      success: true,
      message: 'Lead received and approved',
      leadId: savedLead.id,
      category: savedLead.category,
      score: savedLead.score
    });
    
  } catch (error) {
    console.error('❌ Error processing lead:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Something went wrong processing your request'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});