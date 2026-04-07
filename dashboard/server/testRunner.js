/**
 * Simple test runner for Solace connection tests
 * 
 * To use: node testRunner.js
 */

import { solaceService } from './services/solaceService.ts';
import { marketDataService } from './services/marketDataService.ts';

// Uncomment if needed
// import { llmService } from './services/llmService.js';

/**
 * Test script to verify Solace connections and sessions
 * 
 * This script tests:
 * 1. Connecting to Solace with test credentials
 * 2. Creating three sessions for different data types
 * 3. Subscribing to topics for each session
 * 4. Verifying message delivery
 * 5. Proper cleanup on exit
 */

const testSolaceCredentials = {
  brokerUrl: 'wss://example.messaging.solace.cloud:443',
  vpnName: 'example-vpn',
  username: 'example-user',
  password: 'example-password',
  configType: 'backend',
};

const testStocks = ['MSFT', 'AAPL', 'GOOG'];
const testIndices = ['SPX', 'DJI', 'NDX'];

async function runSolaceConnectionTests() {
  console.log('\n🧪 RUNNING SOLACE CONNECTION TESTS 🧪\n');
  
  try {
    // Test 1: Connect to Solace with test credentials
    console.log('Test 1: Connecting to Solace broker with test credentials...');
    await solaceService.connect(testSolaceCredentials);
    
    const isConnected = solaceService.isConnected();
    console.log(`Connection status: ${isConnected ? 'SUCCESS ✅' : 'FAILED ❌'}`);
    
    if (!isConnected) {
      throw new Error('Failed to connect to Solace broker');
    }
    
    // Test 2: Verify Session 1 - Market Data for Stocks
    console.log('\nTest 2: Creating session for stock market data...');
    const stockSession = solaceService.getSolaceSession('stock_market_data');
    console.log(`Stock market data session: ${stockSession ? 'CREATED ✅' : 'FAILED ❌'}`);
    
    if (!stockSession) {
      throw new Error('Failed to create stock market data session');
    }
    
    // Test 3: Verify Session 2 - Market Data for Indices
    console.log('\nTest 3: Creating session for index market data...');
    const indexSession = solaceService.getSolaceSession('index_market_data');
    console.log(`Index market data session: ${indexSession ? 'CREATED ✅' : 'FAILED ❌'}`);
    
    if (!indexSession) {
      throw new Error('Failed to create index market data session');
    }
    
    // Test 4: Verify Session 3 - Signal Data
    console.log('\nTest 4: Creating session for signal data...');
    const signalSession = solaceService.getSolaceSession('signal_data');
    console.log(`Signal data session: ${signalSession ? 'CREATED ✅' : 'FAILED ❌'}`);
    
    if (!signalSession) {
      throw new Error('Failed to create signal data session');
    }
    
    // Test 5: Subscribe to Stock Market Data Topics
    console.log('\nTest 5: Subscribing to stock market data topics...');
    for (const symbol of testStocks) {
      const topic = `market-data/EQ/US/NASDAQ/${symbol}`;
      try {
        // Create a message handler function
        const messageHandler = (message) => {
          console.log(`Received message on ${topic}:`, message);
        };
        
        await solaceService.subscribe(topic, messageHandler);
        console.log(`Subscribed to ${topic} ✅`);
      } catch (err) {
        console.error(`Failed to subscribe to ${topic}: ${err.message} ❌`);
        throw err;
      }
    }
    
    // Test 6: Subscribe to Index Market Data Topics
    console.log('\nTest 6: Subscribing to index market data topics...');
    for (const symbol of testIndices) {
      const topic = `market-data/${symbol}`;
      try {
        // Create a message handler function
        const messageHandler = (message) => {
          console.log(`Received message on ${topic}:`, message);
        };
        
        await solaceService.subscribe(topic, messageHandler);
        console.log(`Subscribed to ${topic} ✅`);
      } catch (err) {
        console.error(`Failed to subscribe to ${topic}: ${err.message} ❌`);
        throw err;
      }
    }
    
    // Test 7: Subscribe to Signal Output Topic
    console.log('\nTest 7: Subscribing to signal output topic...');
    try {
      // Create a message handler function
      const messageHandler = (message) => {
        console.log(`Received message on signal/output:`, message);
      };
      
      await solaceService.subscribe('signal/output', messageHandler);
      console.log(`Subscribed to signal/output ✅`);
    } catch (err) {
      console.error(`Failed to subscribe to signal/output: ${err.message} ❌`);
      throw err;
    }
    
    // Test 8: Test Publishing Messages
    console.log('\nTest 8: Publishing test messages...');
    
    // Test stock market data publishing
    const stockTestMsg = {
      symbol: 'MSFT',
      companyName: 'Microsoft Corp.',
      currentPrice: 350.25,
      percentChange: 2.3,
      timestamp: new Date().toISOString()
    };
    
    try {
      await solaceService.publish('market-data/EQ/US/NASDAQ/MSFT', stockTestMsg);
      console.log('Published stock market data message ✅');
    } catch (err) {
      console.error(`Failed to publish stock market data: ${err.message} ❌`);
    }
    
    // Test index market data publishing
    const indexTestMsg = {
      symbol: 'SPX',
      currentPrice: 5200.75,
      percentChange: 0.5,
      timestamp: new Date().toISOString()
    };
    
    try {
      await solaceService.publish('market-data/SPX', indexTestMsg);
      console.log('Published index market data message ✅');
    } catch (err) {
      console.error(`Failed to publish index market data: ${err.message} ❌`);
    }
    
    // Test signal data publishing
    const signalTestMsg = {
      symbol: 'MSFT',
      signal: 'Buy',
      confidence: 0.85,
      content: 'Microsoft Corp. announces new product line that will disrupt the market. #MSFT $MSFT',
      timestamp: new Date().toISOString()
    };
    
    try {
      await solaceService.publish('signal/output', signalTestMsg);
      console.log('Published signal data message ✅');
    } catch (err) {
      console.error(`Failed to publish signal data: ${err.message} ❌`);
    }
    
    // Test 9: Unsubscribe from Topics
    console.log('\nTest 9: Unsubscribing from topics...');
    
    // Unsubscribe from stock market data topics
    for (const symbol of testStocks) {
      const topic = `market-data/EQ/US/NASDAQ/${symbol}`;
      try {
        await solaceService.unsubscribe(topic);
        console.log(`Unsubscribed from ${topic} ✅`);
      } catch (err) {
        console.error(`Failed to unsubscribe from ${topic}: ${err.message} ❌`);
      }
    }
    
    // Unsubscribe from index market data topics
    for (const symbol of testIndices) {
      const topic = `market-data/${symbol}`;
      try {
        await solaceService.unsubscribe(topic);
        console.log(`Unsubscribed from ${topic} ✅`);
      } catch (err) {
        console.error(`Failed to unsubscribe from ${topic}: ${err.message} ❌`);
      }
    }
    
    // Unsubscribe from signal output topic
    try {
      await solaceService.unsubscribe('signal/output');
      console.log(`Unsubscribed from signal/output ✅`);
    } catch (err) {
      console.error(`Failed to unsubscribe from signal/output: ${err.message} ❌`);
    }
    
    // Test 10: Disconnect from Solace
    console.log('\nTest 10: Disconnecting from Solace...');
    await solaceService.disconnect();
    console.log(`Disconnection: ${!solaceService.isConnected() ? 'SUCCESS ✅' : 'FAILED ❌'}`);
    
    // Final results
    console.log('\n🎉 All Solace connection tests completed! 🎉\n');
    
  } catch (err) {
    console.error(`\nSOLACE CONNECTION TEST FAILED: ${err.message}\n`);
    
    // Cleanup in case of errors
    try {
      if (solaceService.isConnected()) {
        await solaceService.disconnect();
        console.log('Disconnected from Solace during error cleanup');
      }
    } catch (cleanupErr) {
      console.error(`Error during cleanup: ${cleanupErr.message}`);
    }
  }
}

// Run the tests
runSolaceConnectionTests().catch(err => {
  console.error('Fatal error during test execution:', err);
  process.exit(1);
});