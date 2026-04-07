/**
 * This file contains test helpers and functions to verify the Solace connection
 * is properly set up and the data flow is directly from Solace to the frontend
 * without WebSocket broadcasting.
 */

const { solaceService } = require('../services/solaceService');

/**
 * Trace Solace publish calls 
 * 
 * Use this function to check if data is being properly published to Solace
 */
function traceSolacePublishing() {
  const originalPublish = solaceService.publish;
  
  // Override the publish method to add tracing
  solaceService.publish = async function(topic, message) {
    console.log(`[TRACE] Publishing to Solace topic '${topic}':`, JSON.stringify(message));
    return originalPublish.call(this, topic, message);
  };
  
  console.log('Solace publish tracing enabled');
  
  return {
    restore: () => {
      solaceService.publish = originalPublish;
      console.log('Solace publish tracing disabled');
    }
  };
}

/**
 * Test publishing to specific Twitter feed topic
 */
async function testTwitterPublishing(symbol) {
  if (!solaceService.isConnected()) {
    console.error('Cannot test Twitter publishing: Not connected to Solace');
    return;
  }
  
  console.log(`Testing Twitter publishing for symbol: ${symbol}`);
  
  const sampleTweet = `Test tweet for ${symbol} to verify Solace publishing is working`;
  const topic = `twitter-feed/${symbol}`;
  const message = {
    symbol,
    content: sampleTweet,
    timestamp: new Date().toISOString()
  };
  
  try {
    await solaceService.publish(topic, message);
    console.log(`Successfully published test tweet to Solace topic: ${topic}`);
    return true;
  } catch (error) {
    console.error(`Error publishing test tweet to Solace:`, error);
    return false;
  }
}

/**
 * Test subscribing to Solace topics
 */
async function testSolaceSubscription(topic) {
  if (!solaceService.isConnected()) {
    console.error('Cannot test Solace subscription: Not connected to Solace');
    return;
  }
  
  console.log(`Testing Solace subscription for topic: ${topic}`);
  
  let received = false;
  
  try {
    // Create a one-time callback function
    const callback = (message) => {
      console.log(`[TEST] Received message from Solace topic '${topic}':`, JSON.stringify(message));
      received = true;
    };
    
    // Subscribe to the topic
    await solaceService.subscribe(topic, callback);
    console.log(`Successfully subscribed to Solace topic: ${topic}`);
    
    // Return a promise that resolves when a message is received or times out
    return new Promise((resolve) => {
      // Set a timeout to check if we received a message
      const timeout = setTimeout(() => {
        solaceService.unsubscribe(topic, callback);
        resolve({ success: received, message: received ? 'Message received' : 'No message received within timeout' });
      }, 5000);
      
      // If we receive a message before timeout, resolve immediately
      const checkInterval = setInterval(() => {
        if (received) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          solaceService.unsubscribe(topic, callback);
          resolve({ success: true, message: 'Message received from Solace' });
        }
      }, 100);
    });
  } catch (error) {
    console.error(`Error subscribing to Solace topic ${topic}:`, error);
    return { success: false, message: `Error: ${error.message}` };
  }
}

/**
 * Test the 'Live Data' toggle functionality for market indices
 */
async function testLiveDataToggle(indexSymbols = ['SPX', 'DJI', 'NDX']) {
  if (!solaceService.isConnected()) {
    console.error('Cannot test live data toggle: Not connected to Solace');
    return;
  }
  
  console.log('Testing Live Data toggle for market indices');
  
  // Array to store message counts
  const messageCounts = {};
  indexSymbols.forEach(symbol => {
    messageCounts[symbol] = 0;
  });
  
  // Subscribe to all index topics
  const subscriptions = [];
  
  for (const symbol of indexSymbols) {
    const topic = `market-data/${symbol}`;
    
    // Create a callback that counts messages
    const callback = (message) => {
      messageCounts[symbol]++;
      console.log(`[TEST] Received message from ${topic}:`, JSON.stringify(message));
    };
    
    try {
      await solaceService.subscribe(topic, callback);
      subscriptions.push({ topic, callback });
      console.log(`Subscribed to ${topic}`);
    } catch (error) {
      console.error(`Error subscribing to ${topic}:`, error);
    }
  }
  
  // Wait for messages with live data on
  console.log('Waiting for messages (Live Data ON)...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Store message counts with live data on
  const messageCountsLiveOn = { ...messageCounts };
  console.log('Message counts with Live Data ON:', messageCountsLiveOn);
  
  // Unsubscribe from all topics (simulating Live Data OFF)
  for (const { topic, callback } of subscriptions) {
    await solaceService.unsubscribe(topic, callback);
    console.log(`Unsubscribed from ${topic}`);
  }
  
  // Reset message counts
  indexSymbols.forEach(symbol => {
    messageCounts[symbol] = 0;
  });
  
  // Wait a bit to ensure no messages come through
  console.log('Waiting for messages (Live Data OFF)...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Store message counts with live data off
  const messageCountsLiveOff = { ...messageCounts };
  console.log('Message counts with Live Data OFF:', messageCountsLiveOff);
  
  // Analyze results
  const liveDataWorking = indexSymbols.every(symbol => 
    messageCountsLiveOn[symbol] > 0 && messageCountsLiveOff[symbol] === 0
  );
  
  return {
    success: liveDataWorking,
    messageCountsLiveOn,
    messageCountsLiveOff,
    message: liveDataWorking 
      ? 'Live Data toggle is working correctly' 
      : 'Live Data toggle might not be working correctly'
  };
}

module.exports = {
  traceSolacePublishing,
  testTwitterPublishing,
  testSolaceSubscription,
  testLiveDataToggle
};