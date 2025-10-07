const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkContractors() {
  try {
    const contractors = await prisma.contractor.findMany({
      select: {
        id: true,
        businessName: true,
        email: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        creditBalance: true,
        status: true,
        _count: {
          select: {
            assignments: true,
            creditTransactions: true,
            billingRecords: true
          }
        }
      },
      take: 10
    });

    console.log('\n📋 YOUR TEST CONTRACTORS:\n');
    
    if (contractors.length === 0) {
      console.log('❌ No contractors found in database!');
      return;
    }

    contractors.forEach((c, index) => {
      console.log(`${index + 1}. ${c.businessName || 'No Business Name'}`);
      console.log(`   📧 Email: ${c.email}`);
      console.log(`   💳 Subscription: ${c.subscriptionTier || '❌ NONE'} (${c.subscriptionStatus || 'inactive'})`);
      console.log(`   💰 Credit Balance: $${(c.creditBalance || 0).toFixed(2)}`);
      console.log(`   ✅ Status: ${c.status}`);
      console.log(`   📊 Assigned Leads: ${c._count.assignments}`);
      console.log(`   💵 Transactions: ${c._count.creditTransactions}`);
      console.log(`   📄 Billing Records: ${c._count.billingRecords}`);
      console.log('');
    });

    console.log('\n🔍 DIAGNOSIS:');
    const needsSetup = contractors.filter(c => !c.subscriptionTier || c.creditBalance === 0);
    
    if (needsSetup.length > 0) {
      console.log('❌ Contractors missing subscription or credits:');
      needsSetup.forEach(c => {
        console.log(`   - ${c.email}: ${!c.subscriptionTier ? 'No subscription tier' : ''} ${c.creditBalance === 0 ? 'No credit balance' : ''}`);
      });
      console.log('\n💡 Fix with: node setup-test-contractor.js EMAIL_HERE');
    } else {
      console.log('✅ All contractors have subscription and credit data!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkContractors();