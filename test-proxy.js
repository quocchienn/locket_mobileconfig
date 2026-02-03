const axios = require('axios');
const https = require('https');

const testProxy = async () => {
  const baseUrl = process.env.TEST_URL || 'http://localhost:3000';
  
  console.log('🧪 Testing Locket Unlock Proxy...\n');
  
  const tests = [
    {
      name: 'Health Check',
      url: `${baseUrl}/health`,
      method: 'GET'
    },
    {
      name: 'PAC File',
      url: `${baseUrl}/proxy.pac`,
      method: 'GET'
    },
    {
      name: 'Mobileconfig',
      url: `${baseUrl}/install.mobileconfig`,
      method: 'GET'
    },
    {
      name: 'Install Page',
      url: `${baseUrl}/install`,
      method: 'GET'
    }
  ];
  
  for (const test of tests) {
    try {
      const response = await axios({
        method: test.method,
        url: test.url,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 10000
      });
      
      console.log(`✅ ${test.name}: ${response.status} - ${response.statusText}`);
      
      if (test.name === 'Health Check') {
        console.log('   Response:', JSON.stringify(response.data, null, 2));
      }
      
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
    }
  }
  
  // Test RevenueCat API simulation
  console.log('\n🧪 Testing RevenueCat API simulation...');
  
  const fakeReceipt = {
    "app_user_id": "test_user_123",
    "fetch_token": "fake_token_xyz"
  };
  
  try {
    const response = await axios({
      method: 'POST',
      url: `${baseUrl}/v1/receipts`,
      data: fakeReceipt,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fake_api_key'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    
    console.log('✅ RevenueCat Proxy: Working');
    console.log('   Status:', response.status);
    
    if (response.data && response.data.subscriber) {
      if (response.data.subscriber.entitlements && response.data.subscriber.entitlements.pro) {
        console.log('✅ Pro Unlock: SUCCESS');
        console.log('   Expiry:', response.data.subscriber.entitlements.pro.expires_date);
      } else {
        console.log('❌ Pro Unlock: FAILED - No entitlements');
      }
    }
    
  } catch (error) {
    console.log('❌ RevenueCat Proxy Test Failed:', error.message);
  }
  
  console.log('\n🎉 Test completed!');
};

// Run tests
if (require.main === module) {
  testProxy().catch(console.error);
}

module.exports = testProxy;