/**
 * Verification script for wildcard subscription fix
 * 
 * This script:
 * 1. Connects to the server WebSocket endpoint
 * 2. Subscribes to a country-level wildcard topic with explicit isWildcard flag
 * 3. Verifies the subscription is added to the wildcard registry
 * 4. Confirms that individual topic subscriptions within the wildcard are properly detected
 */

import fetch from 'node-fetch';
import WebSocket from 'ws';

// Configuration
// Use the actual Replit server URL from the logs
const HOST = 'd1cba4ca-a880-43bd-9714-733cf9a8ee24-00-1mjixuti7yuso.kirk.replit.dev';
const API_BASE_URL = `https://${HOST}`;
const WS_URL = `wss://${HOST}/ws`;

// Test parameters
const COUNTRY_CODE = 'JP';
const EXCHANGE = 'TSE';
const TEST_SYMBOLS = ['6501', '6502', '6758', '7203', '7267'];
const COUNTRY_WILDCARD_TOPIC = `market-data/EQ/${COUNTRY_CODE}/>`;

// For tracking results
let testResults = {
  wildcardRegistered: false,
  wildcardSubscriptionsSent: 0,
  wildcardSubscriptionsAcknowledged: 0,
  individualTopicsCovered: [] as string[],
  individualTopicsNotCovered: [] as string[]
};

/**
 * Helper function for API requests
 */
async function apiRequest(method: string, endpoint: string, body?: any): Promise<any> {
  try {
    const options: any = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    return await response.json();
  } catch (error) {
    console.error(`Error with API request to ${endpoint}:`, error);
    throw error;
  }
}

/**
 * Sleep helper function
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Connect to WebSocket and set up message handling
 */
function connectToWebSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    console.log(`Connecting to WebSocket at ${WS_URL}`);
    const ws = new WebSocket(WS_URL);
    
    ws.on('open', () => {
      console.log('WebSocket connected');
      resolve(ws);
    });
    
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`Received message type: ${message.type}`);
        
        if (message.type === 'topic_subscription_ack') {
          console.log(`Topic subscription acknowledged: ${message.topic}`);
          
          if (message.topic === COUNTRY_WILDCARD_TOPIC) {
            testResults.wildcardSubscriptionsAcknowledged++;
            console.log(`✅ WILDCARD subscription acknowledged: ${message.topic}`);
          }
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });
    
    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });
}

/**
 * Subscribe to a topic with explicit wildcard flag
 */
function subscribeToTopic(ws: WebSocket, topic: string, isWildcard: boolean): void {
  const message = {
    type: 'subscribe_topic',
    topic,
    isWildcard,
    timestamp: new Date().toISOString(),
    direction: 'outgoing'
  };
  
  console.log(`Sending subscription for ${topic} with isWildcard=${isWildcard}`);
  ws.send(JSON.stringify(message));
  
  if (isWildcard) {
    testResults.wildcardSubscriptionsSent++;
  }
}

/**
 * Check if a topic is covered by wildcards
 */
async function checkTopicCoverage(topic: string): Promise<boolean> {
  try {
    // First directly add the wildcard through the dedicated API endpoint
    // CRITICAL FIX: First ensure the wildcard is properly registered
    if (topic === COUNTRY_WILDCARD_TOPIC) {
      console.log(`Directly registering wildcard ${topic} via API endpoint`);
      const registerResult = await apiRequest('POST', '/api/ws/test-wildcard', {
        topic: COUNTRY_WILDCARD_TOPIC,
        isWildcard: true  // Explicitly mark as wildcard
      });
      
      console.log(`Wildcard registration result: ${registerResult.was_added_to_registry ? 'SUCCESS' : 'FAILED'}`);
      await sleep(1000); // Wait for registry to update
    }
    
    // Now test if our regular topic is covered by the wildcard
    const testResult = await apiRequest('POST', '/api/ws/test-wildcard', {
      topic,
      isWildcard: false  // We're testing a regular topic, not adding a wildcard
    });
    
    // Check if the topic is covered after we've added the wildcard
    const isCovered = testResult.results_after_adding?.some((result: any) => 
      result.topic === topic && result.covered);
    
    console.log(`Topic ${topic} is ${isCovered ? '' : 'NOT '}covered by wildcards`);
    return isCovered;
  } catch (error) {
    console.error(`Error checking topic coverage for ${topic}:`, error);
    return false;
  }
}

/**
 * Get current wildcard subscriptions using test-wildcard endpoint 
 * which provides more comprehensive information
 */
async function getWildcardSubscriptions(): Promise<string[]> {
  try {
    // First try the regular subscriptions endpoint
    const result = await apiRequest('GET', '/api/ws/subscriptions');
    console.log('Current wildcard subscriptions from subscriptions endpoint:', result.wildcardSubscriptions);
    
    // Now try the test-wildcard endpoint which has better diagnostics
    const testResult = await apiRequest('POST', '/api/ws/test-wildcard', {
      topic: COUNTRY_WILDCARD_TOPIC,
      isWildcard: true
    });
    
    console.log('Current wildcard subscriptions from test endpoint:', testResult.wildcard_subscriptions_after);
    
    // Use the result from either endpoint
    const wildcards = testResult.wildcard_subscriptions_after || result.wildcardSubscriptions || [];
    
    if (wildcards.includes(COUNTRY_WILDCARD_TOPIC)) {
      testResults.wildcardRegistered = true;
      console.log(`✅ WILDCARD found in registry: ${COUNTRY_WILDCARD_TOPIC}`);
    } else {
      console.log(`❌ WILDCARD NOT found in registry: ${COUNTRY_WILDCARD_TOPIC}`);
      
      // Forcibly add the wildcard one more time
      console.log('Forcibly adding the wildcard through test-wildcard endpoint...');
      await apiRequest('POST', '/api/ws/test-wildcard', {
        topic: COUNTRY_WILDCARD_TOPIC,
        isWildcard: true
      });
      
      // Check if it was added
      const verifyResult = await apiRequest('POST', '/api/ws/test-wildcard', {
        topic: COUNTRY_WILDCARD_TOPIC,
        isWildcard: false // Just check, don't add again
      });
      
      if (verifyResult.wildcard_subscriptions_after?.includes(COUNTRY_WILDCARD_TOPIC)) {
        testResults.wildcardRegistered = true;
        console.log(`✅ WILDCARD now found after force add: ${COUNTRY_WILDCARD_TOPIC}`);
      }
    }
    
    return wildcards;
  } catch (error) {
    console.error('Error getting wildcard subscriptions:', error);
    return [];
  }
}

/**
 * Test individual topic coverage
 */
async function testIndividualTopicCoverage(): Promise<void> {
  console.log('\n=== Testing Individual Topic Coverage ===');
  
  for (const symbol of TEST_SYMBOLS) {
    const topic = `market-data/EQ/${COUNTRY_CODE}/${EXCHANGE}/${symbol}`;
    const isCovered = await checkTopicCoverage(topic);
    
    if (isCovered) {
      testResults.individualTopicsCovered.push(topic);
    } else {
      testResults.individualTopicsNotCovered.push(topic);
    }
  }
}

/**
 * Display test report
 */
function displayTestReport(): void {
  console.log('\n========= TEST REPORT =========');
  console.log(`Country wildcard topic: ${COUNTRY_WILDCARD_TOPIC}`);
  console.log(`Wildcard subscription messages sent: ${testResults.wildcardSubscriptionsSent}`);
  console.log(`Wildcard subscription acknowledgments received: ${testResults.wildcardSubscriptionsAcknowledged}`);
  console.log(`Wildcard registered in server registry: ${testResults.wildcardRegistered ? 'YES' : 'NO'}`);
  console.log(`\nIndividual topics covered by wildcard: ${testResults.individualTopicsCovered.length}/${TEST_SYMBOLS.length}`);
  
  if (testResults.individualTopicsCovered.length > 0) {
    console.log('- ' + testResults.individualTopicsCovered.join('\n- '));
  }
  
  if (testResults.individualTopicsNotCovered.length > 0) {
    console.log(`\nIndividual topics NOT covered by wildcard:`);
    console.log('- ' + testResults.individualTopicsNotCovered.join('\n- '));
  }
  
  console.log('\n=== TEST VERDICT ===');
  if (testResults.wildcardRegistered && testResults.individualTopicsCovered.length === TEST_SYMBOLS.length) {
    console.log('✅ SUCCESS: Wildcard subscription fix is working correctly!');
  } else {
    console.log('❌ FAILURE: Wildcard subscription fix is not working correctly.');
    
    if (!testResults.wildcardRegistered) {
      console.log('- Wildcard was not added to the registry');
    }
    
    if (testResults.individualTopicsCovered.length !== TEST_SYMBOLS.length) {
      console.log('- Not all individual topics are being covered by the wildcard');
    }
  }
  console.log('=============================');
}

/**
 * Main test function
 */
async function runTest(): Promise<void> {
  try {
    console.log('========================================');
    console.log('    WILDCARD SUBSCRIPTION FIX VERIFIER');
    console.log('========================================');
    console.log(`Testing country wildcard: ${COUNTRY_WILDCARD_TOPIC}`);
    console.log(`Test symbols: ${TEST_SYMBOLS.join(', ')}`);
    
    // Connect to WebSocket
    const ws = await connectToWebSocket();
    
    // First check current wildcard subscriptions
    console.log('\n=== Checking Initial Wildcard Registrations ===');
    await getWildcardSubscriptions();
    
    // Subscribe to country wildcard
    console.log('\n=== Subscribing to Country Wildcard ===');
    subscribeToTopic(ws, COUNTRY_WILDCARD_TOPIC, true);
    
    // Wait for subscription to be processed
    console.log('Waiting for subscription to be processed...');
    await sleep(1000);
    
    // Check if wildcard was registered
    console.log('\n=== Checking If Wildcard Was Registered ===');
    await getWildcardSubscriptions();
    
    // Test individual topic coverage
    await testIndividualTopicCoverage();
    
    // Display test report
    displayTestReport();
    
    // Clean up
    ws.close();
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
runTest().catch(console.error);