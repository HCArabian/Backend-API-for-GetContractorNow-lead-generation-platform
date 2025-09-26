const express = require('express');
const cors = require('cors');
require('dotenv').config();

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
    console.log('Received lead:', leadData);
    
    // Import Prisma Client at the top of the file (add this line at the very top)
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    // TODO: Add scoring logic (for now, use placeholder values)
    const score = 100; // Placeholder
    const category = 'GOLD'; // Placeholder
    const price = 175; // Placeholder
    
    // Save lead to database
    const savedLead = await prisma.lead.create({
      data: {
        customerFirstName: leadData.first_name,
        customerLastName: leadData.last_name,
        customerEmail: leadData.email,
        customerPhone: leadData.phone,
        customerAddress: leadData.address || '',
        customerCity: leadData.city || '',
        customerState: leadData.state || '',
        customerZip: leadData.zip || '',
        
        serviceType: leadData.service_type,
        serviceDescription: leadData.service_description || null,
        timeline: leadData.timeline || '',
        budgetRange: leadData.budget_range || '',
        propertyType: leadData.property_type || '',
        propertyAge: leadData.property_age || null,
        existingSystem: leadData.existing_system || null,
        systemIssue: leadData.system_issue || null,
        
        preferredContactTime: leadData.preferred_contact_time || null,
        preferredContactMethod: leadData.preferred_contact_method || 'phone',
        
        referralSource: leadData.referral_source || null,
        utmSource: leadData.utm_source || null,
        utmMedium: leadData.utm_medium || null,
        utmCampaign: leadData.utm_campaign || null,
        
        formCompletionTime: leadData.form_completion_time || null,
        ipAddress: leadData.ip_address || null,
        userAgent: leadData.user_agent || null,
        
        score: score,
        category: category,
        price: price,
        status: 'pending_assignment'
      }
    });
    
    console.log('Lead saved to database:', savedLead.id);
    
    await prisma.$disconnect();
    
    res.json({ 
      success: true, 
      message: 'Lead received and saved successfully',
      leadId: savedLead.id
    });
  } catch (error) {
    console.error('Error saving lead:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error: ' + error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});