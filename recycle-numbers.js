const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function recycleExpiredNumbers() {
  console.log('🔄 Checking for expired tracking numbers...');
  
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

    console.log(`Found ${expiredNumbers.length} expired numbers`);

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

      console.log(`✅ Released ${number.phoneNumber} back to pool`);
    }

    // Get pool status
    const poolStatus = await prisma.twilioNumberPool.groupBy({
      by: ['status'],
      _count: true
    });

    console.log('\n📊 Pool Status:');
    poolStatus.forEach(status => {
      console.log(`   ${status.status}: ${status._count}`);
    });

    await prisma.$disconnect();
    
  } catch (error) {
    console.error('❌ Error recycling numbers:', error);
    await prisma.$disconnect();
  }
}

recycleExpiredNumbers();