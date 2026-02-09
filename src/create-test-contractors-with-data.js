const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createTestContractors() {
  const testContractors = [
    {
      email: 'starter@test.com',
      tier: 'starter',
      name: 'ABC HVAC Services LLC',
      businessType: 'LLC',
      licenseNumber: 'HVAC-2024-12345',
      licenseState: 'CA',
      yearsInBusiness: 8,
      specializations: ['hvac_repair', 'hvac_installation'],
      serviceZipCodes: ['90001', '90002', '90003'],
      insuranceProvider: 'State Farm',
      insurancePolicyNumber: 'POL-987654321',
      websiteUrl: 'https://abchvac.com',
      businessAddress: '123 Main Street',
      businessCity: 'Los Angeles',
      businessState: 'CA',
      businessZip: '90001',
      taxId: '12-3456789'
    },
    {
      email: 'pro@test.com',
      tier: 'pro',
      name: 'ProPlumb Solutions Inc',
      businessType: 'Corporation',
      licenseNumber: 'PLB-2023-67890',
      licenseState: 'CA',
      yearsInBusiness: 15,
      specializations: ['plumbing_repair', 'plumbing_installation'],
      serviceZipCodes: ['90004', '90005', '90006', '90007', '90008'],
      insuranceProvider: 'Liberty Mutual',
      insurancePolicyNumber: 'POL-123456789',
      websiteUrl: 'https://proplumb.com',
      businessAddress: '456 Oak Avenue',
      businessCity: 'Los Angeles',
      businessState: 'CA',
      businessZip: '90004',
      taxId: '98-7654321'
    },
    {
      email: 'elite@test.com',
      tier: 'elite',
      name: 'Elite Electrical Experts Corp',
      businessType: 'Corporation',
      licenseNumber: 'ELC-2022-11111',
      licenseState: 'CA',
      yearsInBusiness: 22,
      specializations: ['electrical_repair', 'electrical_installation'],
      serviceZipCodes: ['90009', '90010', '90011', '90012', '90013', '90014', '90015', '90016', '90017', '90018', '90019', '90020', '90021', '90022', '90023'],
      insuranceProvider: 'Travelers Insurance',
      insurancePolicyNumber: 'POL-555666777',
      websiteUrl: 'https://eliteelectrical.com',
      businessAddress: '789 Elm Boulevard',
      businessCity: 'Los Angeles',
      businessState: 'CA',
      businessZip: '90010',
      taxId: '45-6789012'
    },
    {
      email: 'basic@test.com',
      tier: 'starter',
      name: 'Reliable Roofing Co',
      businessType: 'Sole Proprietor',
      licenseNumber: 'ROOF-2024-22222',
      licenseState: 'CA',
      yearsInBusiness: 5,
      specializations: ['roofing_repair', 'roofing_installation'],
      serviceZipCodes: ['90024', '90025'],
      insuranceProvider: 'Allstate',
      insurancePolicyNumber: 'POL-999888777',
      websiteUrl: 'https://reliableroofing.com',
      businessAddress: '321 Pine Street',
      businessCity: 'Los Angeles',
      businessState: 'CA',
      businessZip: '90024',
      taxId: '78-9012345'
    }
  ];

  const password = 'TestPass123';
  const hashedPassword = await bcrypt.hash(password, 10);

  console.log('\n🔨 Creating test contractors with full verification data...\n');

  for (const testData of testContractors) {
    try {
      // Delete if exists
      await prisma.contractor.deleteMany({ where: { email: testData.email } });

      // Calculate license and insurance expiration dates
      const licenseExpiration = new Date();
      licenseExpiration.setFullYear(licenseExpiration.getFullYear() + 2);
      
      const insuranceExpiration = new Date();
      insuranceExpiration.setFullYear(insuranceExpiration.getFullYear() + 1);

      // Create contractor with all fields
      const contractor = await prisma.contractor.create({
        data: {
          // Basic Info
          businessName: testData.name,
          email: testData.email,
          password: hashedPassword,
          phone: '555-123-4567',
          
          // Verification Fields
          licenseNumber: testData.licenseNumber,
          licenseState: testData.licenseState,
          licenseExpirationDate: licenseExpiration,
          businessAddress: testData.businessAddress,
          businessCity: testData.businessCity,
          businessState: testData.businessState,
          businessZip: testData.businessZip,
          taxId: testData.taxId,
          insuranceProvider: testData.insuranceProvider,
          insurancePolicyNumber: testData.insurancePolicyNumber,
          insuranceExpirationDate: insuranceExpiration,
          yearsInBusiness: testData.yearsInBusiness,
          websiteUrl: testData.websiteUrl,
          businessType: testData.businessType,
          
          // Payment Method (simulated)
          paymentMethodLast4: '4242',
          paymentMethodBrand: 'Visa',
          paymentMethodExpMonth: 12,
          paymentMethodExpYear: 2026,
          
          // Service Coverage
          serviceZipCodes: testData.serviceZipCodes,
          specializations: testData.specializations,
          
          // Subscription
          subscriptionTier: testData.tier,
          subscriptionStatus: 'active',
          creditBalance: 1000,
          
          // Status
          status: 'active',
          isVerified: true,
          isApproved: true,
          isAcceptingLeads: true,
          
          // Performance Metrics
          avgResponseTime: Math.floor(Math.random() * 60) + 10, // 10-70 minutes
          conversionRate: 0.65 + Math.random() * 0.25, // 65-90%
          customerRating: 4.2 + Math.random() * 0.8, // 4.2-5.0
          totalJobsCompleted: Math.floor(Math.random() * 100) + 50,
          totalLeadsReceived: Math.floor(Math.random() * 150) + 80,
          
          // Stripe
          stripeCustomerId: `cus_test_${testData.tier}`,
          stripeSubscriptionId: `sub_test_${testData.tier}`,
          stripePaymentMethodId: `pm_test_${testData.tier}`
        }
      });

      // Create credit transaction
      await prisma.creditTransaction.create({
        data: {
          contractorId: contractor.id,
          type: 'deposit',
          amount: 1000,
          balanceBefore: 0,
          balanceAfter: 1000,
          description: 'Initial test credit deposit',
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days
        }
      });

      console.log(`✅ Created: ${testData.name}`);
      console.log(`   Email: ${testData.email}`);
      console.log(`   Password: ${password}`);
      console.log(`   Tier: ${testData.tier.toUpperCase()}`);
      console.log(`   Credit: $1,000.00`);
      console.log(`   License: ${testData.licenseNumber}`);
      console.log(`   Business Type: ${testData.businessType}`);
      console.log(`   Years in Business: ${testData.yearsInBusiness}`);
      console.log(`   Service Areas: ${testData.serviceZipCodes.length} ZIP codes`);
      console.log(`   Verified: ✓ Yes`);
      console.log(`   Rating: ${contractor.customerRating.toFixed(1)} / 5.0`);
      console.log('');

    } catch (error) {
      console.error(`❌ Failed to create ${testData.email}:`, error.message);
    }
  }

  console.log('\n✅ ALL TEST CONTRACTORS CREATED!\n');
  console.log('🔐 LOGIN CREDENTIALS:');
  console.log('   Email: starter@test.com, pro@test.com, elite@test.com, basic@test.com');
  console.log('   Password: TestPass123 (for all)\n');
  console.log('🌐 Portal URL: https://app.getcontractornow.com/contractor\n');
  
  await prisma.$disconnect();
}

createTestContractors();