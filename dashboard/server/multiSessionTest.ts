/**
 * Test script to verify Solace multi-session architecture
 * 
 * This script can be run from the command line using:
 * npx tsx server/multiSessionTest.ts
 */

import fetch, { RequestInit, HeadersInit } from 'node-fetch';

// Test data for Solace connection - FOR TEST PURPOSES ONLY
// These credentials should never be used for automatic connections on app startup
// They are only used in this test script
// The actual credentials will be provided by the user via the config panel
const TEST_CREDENTIALS = {
  brokerUrl: "wss://example.messaging.solace.cloud:443",
  vpnName: "example-vpn",
  username: "example-user",
  password: "example-password",
  configType: "backend" // Required configType parameter
};

// Base URL for API calls
const API_BASE_URL = 'http://localhost:5000';

async function testMultiSessionArchitecture() {
  console.log('===== Multi-Session Architecture Test =====');
  console.log('Testing Solace service with multiple session types');
  console.log('Broker URL:', TEST_CREDENTIALS.brokerUrl);
  console.log('VPN:', TEST_CREDENTIALS.vpnName);
  
  try {
    // Step 1: Connect to Solace
    console.log('\n1. Connecting to Solace...');
    const connectResult = await apiRequest('POST', '/api/solace/connect', TEST_CREDENTIALS);
    console.log('✓ Connected to Solace successfully');
    
    // Step 2: Test multi-session functionality
    console.log('\n2. Testing multi-session functionality...');
    const testResult = await apiRequest('POST', '/api/test/multi-session') as {
      sessionStatus: {
        stockMarketData: string;
        indexMarketData: string;
        signals: string;
      };
      publishTests: Array<{
        sessionType: string;
        topic: string;
        result: string;
        error?: string;
      }>;
      subscriptionTests: Array<{
        sessionType: string;
        topic?: string;
        result: string;
        error?: string;
      }>;
    };
    
    // Step 3: Display test results
    console.log('\n===== Test Results =====');
    console.log('\nSession Status:');
    console.table(testResult.sessionStatus);
    
    console.log('\nPublish Tests:');
    console.table(testResult.publishTests);
    
    console.log('\nSubscription Tests:');
    console.table(testResult.subscriptionTests);
    
    // Step 4: Disconnect from Solace
    console.log('\n4. Disconnecting from Solace...');
    await apiRequest('POST', '/api/solace/disconnect');
    console.log('✓ Disconnected from Solace successfully');
    
    // Step 5: Provide overall test summary
    const allPublishSuccess = testResult.publishTests.every(test => test.result === 'SUCCESS');
    const allSubscribeSuccess = testResult.subscriptionTests.every(test => test.result === 'SUBSCRIBED');
    
    console.log('\n===== Test Summary =====');
    if (allPublishSuccess && allSubscribeSuccess) {
      console.log('✅ All tests PASSED! The multi-session architecture is working correctly.');
    } else {
      console.log('⚠️ Some tests FAILED. Review the details above.');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
  }
}

/**
 * Helper function to make API requests
 */
async function apiRequest(method: string, endpoint: string, body?: any) {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  const options: RequestInit = {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  };
  
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API request failed with status ${response.status}`;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch (e) {
        // If parsing fails, use the raw text
        if (errorText) {
          errorMessage += `: ${errorText}`;
        }
      }
      
      throw new Error(errorMessage);
    }
    
    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    } else {
      throw new Error(`Unknown error during API request to ${endpoint}`);
    }
  }
}

// Run the test if this file is executed directly
if (import.meta.url.endsWith('multiSessionTest.ts') || 
    import.meta.url.includes('multiSessionTest.js')) {
  testMultiSessionArchitecture().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

export default testMultiSessionArchitecture;