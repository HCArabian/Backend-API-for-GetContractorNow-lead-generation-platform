// clear-test-data.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearTestData() {
  console.log('Clearing test data...');
  
  await prisma.sMSLog.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.customerFeedback.deleteMany({});
  await prisma.dispute.deleteMany({});
  await prisma.billingRecord.deleteMany({});
  await prisma.leadAssignment.deleteMany({});
  await prisma.lead.deleteMany({});
  
  // Reset number pool without deleting
  await prisma.twilioNumberPool.updateMany({
    data: {
      status: 'available',
      currentLeadId: null,
      assignedAt: null,
      expiresAt: null
    }
  });
  
  console.log('Test data cleared');
  await prisma.$disconnect();
}

clearTestData();