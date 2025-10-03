require('dotenv').config();
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const NEW_WEBHOOK_URL = 'https://api.getcontractornow.com/api/webhooks/twilio/call-status';

async function updateAllWebhooks() {
  console.log('Fetching all phone numbers...\n');
  
  try {
    const numbers = await client.incomingPhoneNumbers.list();
    
    console.log(`Found ${numbers.length} phone numbers\n`);
    
    for (const number of numbers) {
      console.log(`Updating ${number.phoneNumber}...`);
      
      await client.incomingPhoneNumbers(number.sid).update({
        voiceUrl: NEW_WEBHOOK_URL,
        voiceMethod: 'POST',
        statusCallback: NEW_WEBHOOK_URL,
        statusCallbackMethod: 'POST'
      });
      
      console.log(`✅ Updated ${number.phoneNumber}\n`);
    }
    
    console.log('All webhooks updated successfully!');
    
  } catch (error) {
    console.error('Error updating webhooks:', error);
  }
}

updateAllWebhooks();