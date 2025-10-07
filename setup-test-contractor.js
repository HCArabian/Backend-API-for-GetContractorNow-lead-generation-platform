const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function setupTestContractor() {
  const email = process.argv[2] || 'test@contractor.com';

  try {
    const contractor = await prisma.contractor.update({
      where: { email: email },
      data: {
        subscriptionTier: 'pro',
        subscriptionStatus: 'active',
        creditBalance: 1000,
        stripeCustomerId: 'cus_test123',
        stripeSubscriptionId: 'sub_test123'
      }
    });

    console.log('✅ Contractor updated successfully!');
    console.log('Email:', contractor.email);
    console.log('Subscription Tier:', contractor.subscriptionTier);
    console.log('Credit Balance:', contractor.creditBalance);

    // Create a test credit transaction
    await prisma.creditTransaction.create({
      data: {
        contractorId: contractor.id,
        type: 'deposit',
        amount: 1000,
        balanceBefore: 0,
        balanceAfter: 1000,
        description: 'Initial credit deposit',
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days
      }
    });

    console.log('✅ Test transaction created!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupTestContractor();