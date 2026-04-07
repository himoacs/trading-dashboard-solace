/**
 * Test script to verify Solace multi-session architecture
 * 
 * This script can be run from the command line using:
 * npx tsx server/runSolaceTest.ts
 * 
 * It connects to Solace, creates all three session types, and verifies
 * messages can be published and received on each session.
 */

import fetch from 'node-fetch';

// TypeScript interfaces for the API responses
interface ApiResponse {
  success: boolean;
  message: string;
}

interface MultiSessionResponse extends ApiResponse {
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
}

// Mock Solace broker connection details for testing
// These are only example credentials used in the test script
// The actual credentials will be provided by the user via the config panel
const TEST_CREDENTIALS = {
  brokerUrl: "wss://example.messaging.solace.cloud:443",
  vpnName: "example-vpn",
  username: "example-user",
  password: "example-password",
  configType: "backend" // Required configType parameter
};

async function runSolaceTest() {
  console.log("=== Solace Multi-Session Architecture Test ===");
  console.log("This test script will verify if the three session types are working correctly");
  
  try {
    // 1. Connect to Solace
    console.log("\n1. Connecting to Solace broker...");
    const connectResponse = await fetch('http://localhost:5000/api/solace/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_CREDENTIALS)
    });
    
    if (!connectResponse.ok) {
      const errorData = await connectResponse.json() as ApiResponse;
      throw new Error(`Failed to connect to Solace: ${errorData.message || connectResponse.statusText}`);
    }
    
    console.log("✓ Successfully connected to Solace broker");
    
    // 2. Run the multi-session test
    console.log("\n2. Testing multi-session architecture...");
    const testResponse = await fetch('http://localhost:5000/api/test/multi-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!testResponse.ok) {
      const errorData = await testResponse.json() as ApiResponse;
      throw new Error(`Multi-session test failed: ${errorData.message || testResponse.statusText}`);
    }
    
    const testResults = await testResponse.json() as MultiSessionResponse;
    console.log("✓ Multi-session test completed");
    
    // 3. Display test results
    console.log("\n=== Test Results ===");
    console.log("\nSession Status:");
    console.table(testResults.sessionStatus);
    
    console.log("\nPublish Tests:");
    console.table(testResults.publishTests);
    
    console.log("\nSubscription Tests:");
    console.table(testResults.subscriptionTests);
    
    // 4. Disconnect from Solace
    console.log("\n4. Disconnecting from Solace broker...");
    const disconnectResponse = await fetch('http://localhost:5000/api/solace/disconnect', {
      method: 'POST'
    });
    
    if (!disconnectResponse.ok) {
      const errorData = await disconnectResponse.json() as ApiResponse;
      console.warn(`Warning: Failed to disconnect cleanly: ${errorData.message || disconnectResponse.statusText}`);
    } else {
      console.log("✓ Successfully disconnected from Solace broker");
    }
    
    console.log("\n=== Test Complete ===");
    
    // Overall summary
    if (testResults.success) {
      const allPublishSuccess = testResults.publishTests.every(test => test.result === "SUCCESS");
      const allSubscribeSuccess = testResults.subscriptionTests.every(test => test.result === "SUBSCRIBED");
      
      if (allPublishSuccess && allSubscribeSuccess) {
        console.log("\n✅ All tests passed! The multi-session Solace architecture is working correctly.");
      } else {
        console.log("\n⚠️ Some tests failed. Check the details above for more information.");
      }
    } else {
      console.log("\n❌ Test failed. Check the details above for more information.");
    }
    
  } catch (error) {
    console.error("\n❌ Test failed with an error:", error instanceof Error ? error.message : error);
  }
}

// Run the test immediately since this is an ES module
// We can determine if this file is being executed directly using import.meta
if (import.meta.url.endsWith('runSolaceTest.ts') || 
    import.meta.url.includes('runSolaceTest.js')) {
  runSolaceTest().catch(console.error);
}

export default runSolaceTest;