// trackingNumbers.js - Twilio Tracking Number Management

const twilio = require('twilio');

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// ============================================
// ASSIGN TRACKING NUMBER TO LEAD
// ============================================

async function assignTrackingNumber(leadId, contractorId, customerPhone, contractorPhone, prisma) {
  try {
    console.log(`\n📞 Assigning tracking number for lead ${leadId}`);
    
    // Check if tracking number already exists for this lead
    const existing = await prisma.trackingNumber.findFirst({
      where: { 
        leadId: leadId,
        status: 'active'
      }
    });
    
    if (existing) {
      console.log('✅ Tracking number already exists:', existing.twilioNumber);
      return {
        success: true,
        trackingNumber: existing.twilioNumber,
        existing: true
      };
    }
    
    // Get available Twilio number from your account
    // For now, we'll use your purchased number
    const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (!twilioNumber) {
      throw new Error('TWILIO_PHONE_NUMBER not configured');
    }
    
    // Set expiration (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    // Create tracking number record
    const trackingRecord = await prisma.trackingNumber.create({
      data: {
        leadId: leadId,
        contractorId: contractorId,
        twilioNumber: twilioNumber,
        customerNumber: customerPhone,
        contractorNumber: contractorPhone,
        status: 'active',
        expiresAt: expiresAt
      }
    });
    
    console.log('✅ Tracking number assigned:', {
      twilioNumber: twilioNumber,
      expiresAt: expiresAt.toISOString()
    });
    
    return {
      success: true,
      trackingNumber: twilioNumber,
      expiresAt: expiresAt,
      recordId: trackingRecord.id,
      existing: false
    };
    
  } catch (error) {
    console.error('❌ Error assigning tracking number:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================
// CONFIGURE TWILIO NUMBER FOR CALL FORWARDING
// ============================================

async function configureTwilioNumber(phoneNumber, webhookUrl) {
  try {
    console.log(`\n⚙️ Configuring Twilio number: ${phoneNumber}`);
    
    // Get all phone numbers in your account
    const phoneNumbers = await client.incomingPhoneNumbers.list();
    
    // Find the matching number
    const numberToUpdate = phoneNumbers.find(
      num => num.phoneNumber === phoneNumber
    );
    
    if (!numberToUpdate) {
      throw new Error(`Phone number ${phoneNumber} not found in Twilio account`);
    }
    
    // Update the number configuration
    await client.incomingPhoneNumbers(numberToUpdate.sid)
      .update({
        voiceUrl: webhookUrl,
        voiceMethod: 'POST',
        statusCallback: webhookUrl,
        statusCallbackMethod: 'POST'
      });
    
    console.log('✅ Twilio number configured successfully');
    
    return { success: true };
    
  } catch (error) {
    console.error('❌ Error configuring Twilio number:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  assignTrackingNumber,
  configureTwilioNumber
};