/**
 * Test file to diagnose Solace publisher issues
 * Run this with: node server/tests/solace-publisher-test.js
 */

import fetch from 'node-fetch';

// Test Solace connection
async function testSolaceConnection() {
  try {
    console.log('Testing Solace connection...');
    
    const connectionData = {
      brokerUrl: 'wss://example.messaging.solace.cloud:443',
      vpnName: 'example-vpn',
      username: 'example-user',
      password: 'example-password',
      clientId: 'app-test',
      configType: 'backend'
    };
    
    const response = await fetch('http://localhost:5000/api/solace/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connectionData)
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response data:', data);
    
    return { status: response.status, data };
  } catch (error) {
    console.error('Error connecting to Solace:', error);
    throw error;
  }
}

// Test Twitter publishing
async function testTwitterPublishing(symbol = 'AAPL') {
  try {
    console.log(`Testing Twitter publishing for symbol: ${symbol}`);
    
    const response = await fetch('http://localhost:5000/api/test/twitter-publishing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response data:', data);
    
    return { status: response.status, data };
  } catch (error) {
    console.error('Error testing Twitter publishing:', error);
    throw error;
  }
}

// Test signal generation to confirm routing is working
async function testSignalGeneration(symbol = 'AAPL') {
  try {
    console.log(`Testing signal generation for symbol: ${symbol}`);
    
    const testData = {
      symbol,
      signal: 'BUY',
      confidence: 0.95,
      content: `Test signal for ${symbol} to verify routing is working correctly.`
    };
    
    const response = await fetch('http://localhost:5000/api/test/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response data:', data);
    
    return { status: response.status, data };
  } catch (error) {
    console.error('Error testing signal generation:', error);
    throw error;
  }
}

// Start simulation
async function startSimulation() {
  try {
    console.log('Starting simulation...');
    
    const simulationData = {
      symbols: ['AAPL', 'MSFT', 'GOOGL'],
      subscription: {
        marketData: true,
        twitterFeed: true,
        newsFeed: true,
        economicIndicator: true,
        signalData: true
      },
      updateFrequency: 5
    };
    
    const response = await fetch('http://localhost:5000/api/simulation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(simulationData)
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response data:', data);
    
    return { status: response.status, data };
  } catch (error) {
    console.error('Error starting simulation:', error);
    throw error;
  }
}

// Main test sequence
async function runTests() {
  try {
    console.log('=== Testing Solace Connection ===');
    await testSolaceConnection();
    
    console.log('\n=== Starting Simulation ===');
    await startSimulation();
    
    console.log('\n=== Testing Twitter Publishing ===');
    await testTwitterPublishing('AAPL');
    
    console.log('\n=== Testing Signal Generation ===');
    await testSignalGeneration('MSFT');
    
    console.log('\nAll tests completed successfully.');
  } catch (error) {
    console.error('Test sequence failed:', error);
  }
}

// Run the tests
runTests();