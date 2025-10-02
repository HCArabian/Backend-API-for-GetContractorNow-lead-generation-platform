const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendSMS(to, message) {
  try {
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_SMS_NUMBER,
      to: to
    });
    
    console.log('✅ SMS sent:', result.sid, 'to:', to);
    return { success: true, sid: result.sid };
  } catch (error) {
    console.error('❌ SMS error:', error.message);
    return { success: false, error: error.message };
  }
}

async function notifyContractorSMS(contractor, lead, trackingNumber) {
  // Only send SMS for PLATINUM and GOLD leads
  if (lead.category !== 'PLATINUM' && lead.category !== 'GOLD') {
    console.log('Skipping SMS - lead is', lead.category);
    return null;
  }

  const urgencyEmoji = lead.category === 'PLATINUM' ? '🔥' : '⭐';
  
  const message = `${urgencyEmoji} NEW ${lead.category} LEAD - ${lead.customerCity}, ${lead.customerState}
Service: ${lead.serviceType.replace(/_/g, ' ')}
Budget: ${lead.budgetRange.replace(/_/g, ' ')}
Call: ${trackingNumber}
Respond within 24h!`;

  console.log('📱 Sending SMS to contractor:', contractor.businessName);
  return await sendSMS(contractor.phone, message);
}

module.exports = { sendSMS, notifyContractorSMS };