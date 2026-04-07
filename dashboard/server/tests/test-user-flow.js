/**
 * Test script for validating the complete user flow
 * 
 * This script validates the following user flow:
 * 1. User connects to Solace broker by providing Solace credentials
 * 2. User adds stocks to Selected Stocks list which triggers Twitter feed publishing
 * 3. Live Market Intelligence shows market data from Solace for selected stocks
 * 4. User toggles "Live Data" for market indices and sees live data from Solace
 */

// Use in Node.js with:
// node server/tests/test-user-flow.js

const fetch = require('node-fetch');

// Configuration
const API_BASE_URL = 'http://localhost:3000';
const TEST_SYMBOL = 'AAPL';
const TEST_INDICES = ['SPX', 'DJI', 'NDX'];

// Helper function for API requests
async function callApi(endpoint, method = 'GET', data = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    return await response.json();
  } catch (error) {
    console.error(`Error calling ${endpoint}:`, error);
    return { success: false, error: error.message };
  }
}

// 1. Test Solace connection
async function testSolaceConnection() {
  console.log('\n===== STEP 1: Testing Solace Connection =====');
  
  // Sample Solace credentials
  const solaceConnection = {
    url: 'wss://mr-connection-xbwbdf9zk81.messaging.solace.cloud:443',
    vpnName: 'financial-data',
    userName: 'test-user',
    password: 'test-password'
  };
  
  console.log('Connecting to Solace with credentials:', solaceConnection);
  
  const result = await callApi('/api/solace/connect', 'POST', solaceConnection);
  
  if (result.success) {
    console.log('✅ Successfully connected to Solace broker');
    return true;
  } else {
    console.error('❌ Failed to connect to Solace broker:', result.message);
    return false;
  }
}

// 2. Test adding stocks and verify Twitter feed publishing
async function testAddingStocks() {
  console.log('\n===== STEP 2: Testing Stock Selection & Twitter Feed Publishing =====');
  
  // Data subscription request
  const subscription = {
    symbols: [TEST_SYMBOL]
  };
  
  console.log(`Adding stock ${TEST_SYMBOL} to selected stocks`);
  
  // Simulate frontend subscription
  const result = await callApi('/api/simulation/start', 'POST', subscription);
  
  if (result.success) {
    console.log(`✅ Successfully added ${TEST_SYMBOL} to selected stocks`);
    
    // Verify Twitter feed is being published
    console.log(`Verifying Twitter feed publishing for ${TEST_SYMBOL}`);
    const twitterResult = await callApi('/api/test/twitter-publishing', 'POST', { symbol: TEST_SYMBOL });
    
    if (twitterResult.success) {
      console.log(`✅ Twitter feed is being published for ${TEST_SYMBOL}`);
      return true;
    } else {
      console.error(`❌ Twitter feed is not being published: ${twitterResult.message}`);
      return false;
    }
  } else {
    console.error('❌ Failed to add stock:', result.message);
    return false;
  }
}

// 3. Test Live Market Intelligence data from Solace
async function testMarketIntelligence() {
  console.log('\n===== STEP 3: Testing Live Market Intelligence Data =====');
  
  // Test market data for the selected stock
  console.log(`Testing market data for ${TEST_SYMBOL}`);
  const marketDataResult = await callApi('/api/test/market-data', 'POST', { symbol: TEST_SYMBOL });
  
  if (marketDataResult.success) {
    console.log(`✅ Market data is being sent for ${TEST_SYMBOL}`);
    
    // Test signal data for the selected stock
    console.log(`Testing trading signals for ${TEST_SYMBOL}`);
    const signalResult = await callApi('/api/test/signal', 'POST', { 
      symbol: TEST_SYMBOL, 
      signal: 'BUY', 
      confidence: 0.95,
      tweetContent: `Test signal for ${TEST_SYMBOL} showing strong buy indicators based on recent news.`
    });
    
    if (signalResult.success) {
      console.log(`✅ Trading signals are being sent for ${TEST_SYMBOL}`);
      return true;
    } else {
      console.error(`❌ Trading signals are not being sent: ${signalResult.message}`);
      return false;
    }
  } else {
    console.error(`❌ Market data is not being sent: ${marketDataResult.message}`);
    return false;
  }
}

// 4. Test Live Data Toggle for Market Indices
async function testLiveDataToggle() {
  console.log('\n===== STEP 4: Testing Live Data Toggle for Market Indices =====');
  
  // Test comprehensive Solace connection and subscription
  const solaceConnectionTest = await callApi('/api/test/solace-connection', 'POST', { 
    symbol: TEST_SYMBOL,
    enableTracing: true,
    testLiveData: true
  });
  
  if (solaceConnectionTest.success) {
    console.log('✅ Solace connection is properly handling market indices subscriptions');
    
    // Test individual market indices
    let allIndicesWorking = true;
    
    for (const index of TEST_INDICES) {
      console.log(`Testing market data for index ${index}`);
      const indexDataResult = await callApi('/api/test/market-data', 'POST', { symbol: index });
      
      if (indexDataResult.success) {
        console.log(`✅ Market data is being sent for ${index}`);
      } else {
        console.error(`❌ Market data is not being sent for ${index}: ${indexDataResult.message}`);
        allIndicesWorking = false;
      }
    }
    
    return allIndicesWorking;
  } else {
    console.error('❌ Solace connection test failed:', solaceConnectionTest.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('Starting user flow validation tests...');
  
  // Step 1: Connect to Solace
  const solaceConnected = await testSolaceConnection();
  if (!solaceConnected) {
    console.error('❌ Failed at Step 1: Solace Connection. Cannot proceed with further tests.');
    return;
  }
  
  // Step 2: Add stocks and verify Twitter feeds
  const stocksAdded = await testAddingStocks();
  if (!stocksAdded) {
    console.error('❌ Failed at Step 2: Adding Stocks. Twitter feed publishing may not be working.');
    // Continue to next tests even if this one fails
  }
  
  // Step 3: Test Live Market Intelligence
  const marketIntelligenceWorking = await testMarketIntelligence();
  if (!marketIntelligenceWorking) {
    console.error('❌ Failed at Step 3: Live Market Intelligence. Market data or signals may not be working.');
    // Continue to next tests even if this one fails
  }
  
  // Step 4: Test Live Data Toggle for Market Indices
  const liveDataToggleWorking = await testLiveDataToggle();
  if (!liveDataToggleWorking) {
    console.error('❌ Failed at Step 4: Live Data Toggle. Market indices subscription may not be working.');
  }
  
  // Final report
  console.log('\n===== TEST SUMMARY =====');
  console.log('1. Solace Connection:', solaceConnected ? '✅ PASS' : '❌ FAIL');
  console.log('2. Stock Selection & Twitter Feed:', stocksAdded ? '✅ PASS' : '❌ FAIL');
  console.log('3. Live Market Intelligence:', marketIntelligenceWorking ? '✅ PASS' : '❌ FAIL');
  console.log('4. Live Data Toggle for Market Indices:', liveDataToggleWorking ? '✅ PASS' : '❌ FAIL');
  
  if (solaceConnected && stocksAdded && marketIntelligenceWorking && liveDataToggleWorking) {
    console.log('\n✅ ALL TESTS PASSED! The user flow is working correctly.');
  } else {
    console.log('\n❌ SOME TESTS FAILED. See details above for specific issues.');
  }
}

// Run the tests
runTests();