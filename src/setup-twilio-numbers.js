const twilio = require('twilio');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const webhookUrl = `${process.env.RAILWAY_URL}/api/webhooks/twilio/call-status`;

async function setupNumbers() {
  console.log('Setting up Twilio numbers...');
  console.log('Webhook URL:', webhookUrl);
  console.log('');
  
  try {
    // Get all your purchased numbers from Twilio
    const twilioNumbers = await client.incomingPhoneNumbers.list();
    
    console.log(`Found ${twilioNumbers.length} numbers in your Twilio account\n`);
    
    let configured = 0;
    let addedToDb = 0;
    
    for (const number of twilioNumbers) {
      try {
        // Configure the webhook
        await client.incomingPhoneNumbers(number.sid)
          .update({
            voiceUrl: webhookUrl,
            voiceMethod: 'POST',
            statusCallback: webhookUrl,
            statusCallbackMethod: 'POST'
          });
        
        console.log(`✅ Configured webhook: ${number.phoneNumber}`);
        configured++;
        
        // Check if already in database
        const existing = await prisma.twilioNumberPool.findUnique({
          where: { phoneNumber: number.phoneNumber }
        });
        
        if (!existing) {
          // Add to database pool
          await prisma.twilioNumberPool.create({
            data: {
              phoneNumber: number.phoneNumber,
              status: 'available'
            }
          });
          console.log(`✅ Added to database: ${number.phoneNumber}`);
          addedToDb++;
        } else {
          console.log(`   Already in database: ${number.phoneNumber}`);
        }
        
        console.log('');
        
      } catch (error) {
        console.error(`❌ Failed to setup ${number.phoneNumber}:`, error.message);
        console.log('');
      }
    }
    
    console.log('─────────────────────────────────');
    console.log(`✅ Configured ${configured} numbers with webhook`);
    console.log(`✅ Added ${addedToDb} new numbers to database`);
    console.log('');
    
    // Show pool status
    const poolStatus = await prisma.twilioNumberPool.groupBy({
      by: ['status'],
      _count: true
    });
    
    console.log('📊 Number Pool Status:');
    poolStatus.forEach(status => {
      console.log(`   ${status.status}: ${status._count}`);
    });
    
    const totalInPool = await prisma.twilioNumberPool.count();
    console.log(`   TOTAL: ${totalInPool}`);
    console.log('');
    console.log('🎉 Setup complete! Ready to assign leads.');
    
    await prisma.$disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
  }
}

setupNumbers();