async function testAPI() {
  console.log('🔍 Testing Contractor API...\n');

  const API_BASE = 'https://api.getcontractornow.com/api';
  const email = 'YOUR_CONTRACTOR_EMAIL@example.com'; // CHANGE THIS
  const password = 'YOUR_PASSWORD'; // CHANGE THIS

  try {
    // Step 1: Login
    console.log('1. Testing login...');
    const loginResponse = await fetch(`${API_BASE}/contractor/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const loginData = await loginResponse.json();
    
    if (!loginResponse.ok) {
      console.error('❌ Login failed:', loginData);
      return;
    }

    console.log('✅ Login successful');
    const token = loginData.token;

    // Step 2: Test Dashboard
    console.log('\n2. Testing dashboard endpoint...');
    const dashboardResponse = await fetch(`${API_BASE}/contractor/dashboard`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const dashboardData = await dashboardResponse.json();
    
    if (!dashboardResponse.ok) {
      console.error('❌ Dashboard failed:', dashboardResponse.status, dashboardData);
      return;
    }

    console.log('✅ Dashboard loaded successfully!');
    console.log('\n📊 Contractor Data:');
    console.log('  Business Name:', dashboardData.contractor.businessName);
    console.log('  Email:', dashboardData.contractor.email);
    console.log('  Credit Balance: $' + dashboardData.contractor.creditBalance);
    console.log('\n💳 Subscription:');
    console.log('  Tier:', dashboardData.subscription.tier);
    console.log('  Monthly Price: $' + dashboardData.subscription.monthlyPrice);
    console.log('  Lead Cost: $' + dashboardData.subscription.leadCost);
    console.log('  Status:', dashboardData.subscription.status);
    console.log('\n📈 Stats:');
    console.log('  Leads This Month:', dashboardData.stats.leadsThisMonth);
    console.log('  Max Leads:', dashboardData.stats.maxLeadsPerMonth);
    console.log('\n💰 Transactions:');
    console.log('  Total Transactions:', dashboardData.recentTransactions.length);

    // Step 3: Test Leads
    console.log('\n3. Testing leads endpoint...');
    const leadsResponse = await fetch(`${API_BASE}/contractor/leads`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const leadsData = await leadsResponse.json();
    
    if (!leadsResponse.ok) {
      console.error('❌ Leads failed:', leadsResponse.status, leadsData);
      return;
    }

    console.log('✅ Leads loaded successfully!');
    console.log('  Total Leads:', leadsData.leads.length);

    console.log('\n✅ ALL TESTS PASSED!');

  } catch (error) {
    console.error('\n❌ API Test Error:', error.message);
  }
}

testAPI();