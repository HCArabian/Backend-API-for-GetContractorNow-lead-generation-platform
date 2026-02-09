const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function recycleExpiredNumbers() {
  console.log('🔄 Starting number recycling process...');
  console.log('Time:', new Date().toISOString());
  
  try {
    const now = new Date();
    
    // Find expired assigned numbers
    const expiredNumbers = await prisma.twilioNumberPool.findMany({
      where: {
        status: 'assigned',
        expiresAt: {
          lte: now
        }
      }
    });

    console.log(`\n📋 Found ${expiredNumbers.length} expired numbers to recycle`);

    if (expiredNumbers.length === 0) {
      console.log('✅ No expired numbers - pool is clean');
    }

    for (const number of expiredNumbers) {
      // Release back to pool
      await prisma.twilioNumberPool.update({
        where: { id: number.id },
        data: {
          status: 'available',
          currentLeadId: null,
          assignedAt: null,
          expiresAt: null
        }
      });

      console.log(`✅ Released: ${number.phoneNumber}`);
      console.log(`   Was assigned to lead: ${number.currentLeadId}`);
      console.log(`   Expired at: ${number.expiresAt.toLocaleString()}`);
    }

    // Get updated pool status
    const available = await prisma.twilioNumberPool.count({
      where: { status: 'available' }
    });

    const assigned = await prisma.twilioNumberPool.count({
      where: { status: 'assigned' }
    });

    const total = await prisma.twilioNumberPool.count();

    console.log('\n📊 Updated Pool Status:');
    console.log(`   Available: ${available}`);
    console.log(`   Assigned: ${assigned}`);
    console.log(`   Total: ${total}`);
    console.log(`   Utilization: ${((assigned / total) * 100).toFixed(1)}%`);

    // Alert if pool is running low
    if (available < 5) {
      console.log('\n⚠️  WARNING: Less than 5 numbers available!');
      console.log('   Consider purchasing more Twilio numbers.');
    }

    console.log('\n✅ Recycling complete');
    await prisma.$disconnect();
    
  } catch (error) {
    console.error('\n❌ Error during recycling:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

recycleExpiredNumbers();