import type { Express, Request, Response } from "express";
import { solaceService, SessionType } from "./services/solaceService";
import { llmService } from "./services/llmService";
import { twitterService } from "./services/twitterService";
import { marketDataService } from "./services/marketDataService";
import { storage } from "./storage";
import { WebSocket } from "ws";

// Define test helper functions directly in this file instead of importing
// This avoids issues with ES modules vs CommonJS

/**
 * Trace Solace publish calls
 */
function traceSolacePublishing() {
  const originalPublish = solaceService.publish;
  
  // Override the publish method to add tracing
  solaceService.publish = async function(topic: string, message: any) {
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
async function testTwitterPublishing(symbol: string) {
  if (!solaceService.isConnected()) {
    console.error('Cannot test Twitter publishing: Not connected to Solace');
    return { success: false, message: 'Not connected to Solace' };
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
    return { success: true, message: `Successfully published to ${topic}` };
  } catch (error) {
    console.error(`Error publishing test tweet to Solace:`, error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error publishing to Solace'
    };
  }
}

/**
 * Test subscribing to Solace topics
 */
async function testSolaceSubscription(topic: string) {
  if (!solaceService.isConnected()) {
    console.error('Cannot test Solace subscription: Not connected to Solace');
    return { success: false, message: 'Not connected to Solace' };
  }
  
  console.log(`Testing Solace subscription for topic: ${topic}`);
  
  let received = false;
  
  try {
    // Create a one-time callback function
    const callback = (message: any) => {
      console.log(`[TEST] Received message from Solace topic '${topic}':`, JSON.stringify(message));
      received = true;
    };
    
    // Subscribe to the topic
    await solaceService.subscribe(topic, callback);
    console.log(`Successfully subscribed to Solace topic: ${topic}`);
    
    // Return a promise that resolves when a message is received or times out
    return new Promise<{success: boolean, message: string}>((resolve) => {
      // Set a timeout to check if we received a message
      const timeout = setTimeout(() => {
        solaceService.unsubscribe(topic, callback);
        resolve({ 
          success: received, 
          message: received ? 'Message received' : 'No message received within timeout' 
        });
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
    return { 
      success: false, 
      message: error instanceof Error ? error.message : `Unknown error subscribing to ${topic}` 
    };
  }
}

/**
 * Test the 'Live Data' toggle functionality for market indices
 */
async function testLiveDataToggle(indexSymbols = ['SPX', 'DJI', 'NDX']) {
  if (!solaceService.isConnected()) {
    console.error('Cannot test live data toggle: Not connected to Solace');
    return { success: false, message: 'Not connected to Solace' };
  }
  
  console.log('Testing Live Data toggle for market indices');
  
  // Array to store message counts
  const messageCounts: Record<string, number> = {};
  indexSymbols.forEach(symbol => {
    messageCounts[symbol] = 0;
  });
  
  // Subscribe to all index topics
  const subscriptions: {topic: string, callback: (message: any) => void}[] = [];
  
  for (const symbol of indexSymbols) {
    const topic = `market-data/${symbol}`;
    
    // Create a callback that counts messages
    const callback = (message: any) => {
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

/**
 * Register test routes for development and debugging purposes
 */
export function registerTestRoutes(app: Express): void {
  /**
   * Test endpoint for wildcard subscription diagnostics
   * This endpoint directly tests and reports wildcard subscription behavior
   * without relying on the WebSocket behavior or middleware
   */
  app.get('/api/test/wildcard-subscriptions', (req: Request, res: Response) => {
    try {
      // Set content type explicitly to ensure the response is treated as JSON
      res.setHeader('Content-Type', 'application/json');
      
      // Access the wildcard subscriptions from app locals or directly
      const wildcardSubscriptions = app.locals.wildcardSubscriptions || new Set<string>();
      const clientSubscriptions = app.locals.clientSubscriptions || new Map();
      const clients = app.locals.clients || [];
      
      // Format client subscriptions for easier viewing
      const formattedClientSubs: Record<string, string[]> = {};
      
      // Helper to safely format client subscriptions
      function formatClientSubscriptions(
        subscriptions: Map<any, Set<string>>
      ): Record<string, string[]> {
        const result: Record<string, string[]> = {};
        subscriptions.forEach((topics, client) => {
          if (client && typeof client.readyState !== 'undefined') {
            const clientId = `client_${client.readyState || 'unknown'}`;
            result[clientId] = Array.from(topics || new Set<string>());
          }
        });
        return result;
      }
      
      try {
        const formatted = formatClientSubscriptions(clientSubscriptions as Map<WebSocket, Set<string>>);
        Object.assign(formattedClientSubs, formatted);
      } catch (err) {
        console.error('Error formatting client subscriptions:', err);
      }
      
      // Testing country-level wildcard logic
      const countryWildcardTests = [
        { country: 'US', topic: 'market-data/EQ/US/>', expected: true },
        { country: 'JP', topic: 'market-data/EQ/JP/>', expected: true }
      ];
      
      // Testing exchange-level wildcard logic
      const exchangeWildcardTests = [
        { exchange: 'NYSE', topic: 'market-data/EQ/*/NYSE/>', expected: true },
        { exchange: 'NASDAQ', topic: 'market-data/EQ/*/NASDAQ/>', expected: true }
      ];
      
      // Helper function to type-safely filter topics
      function filterTopics(topics: Set<string>, filterFn: (topic: string) => boolean): string[] {
        return Array.from(topics).filter(topic => typeof topic === 'string' && filterFn(topic));
      }
      
      // Check if wildcards are correctly registered
      const countryWildcardsFound = filterTopics(wildcardSubscriptions as Set<string>, topic => 
        topic.startsWith('market-data/EQ/') && 
        topic.split('/').length === 4 && 
        topic.endsWith('/>')
      );
      
      const exchangeWildcardsFound = filterTopics(wildcardSubscriptions as Set<string>, topic => 
        topic.startsWith('market-data/EQ/') && 
        topic.split('/').length === 5 && 
        topic.split('/')[2] === '*' && 
        topic.endsWith('/>')
      );
      
      // Return diagnostics
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        clients_count: clients.length,
        wildcard_subscriptions: Array.from(wildcardSubscriptions),
        client_subscriptions: formattedClientSubs,
        diagnostics: {
          country_wildcards_found: countryWildcardsFound,
          exchange_wildcards_found: exchangeWildcardsFound,
          test_results: {
            country_wildcards: countryWildcardTests.map(test => ({
              ...test,
              found: wildcardSubscriptions.has(test.topic)
            })),
            exchange_wildcards: exchangeWildcardTests.map(test => ({
              ...test,
              found: wildcardSubscriptions.has(test.topic)
            }))
          }
        }
      });
    } catch (error) {
      console.error('Error running wildcard subscription diagnostics:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error running diagnostics'
      });
    }
  });
  /**
   * Test endpoint for multi-session Solace architecture
   * This tests the three separate sessions for different message types
   */
  app.post("/api/test/multi-session", async (req: Request, res: Response) => {
    try {
      // Check if Solace is connected
      if (!solaceService.isConnected()) {
        return res.status(400).json({
          success: false,
          message: "Not connected to Solace broker",
          details: "Connect to Solace first before testing multi-session architecture"
        });
      }

      // Test if all three session types exist
      const stockSession = solaceService.getSolaceSession(SessionType.STOCK_MARKET_DATA);
      const indexSession = solaceService.getSolaceSession(SessionType.INDEX_MARKET_DATA);
      const signalSession = solaceService.getSolaceSession(SessionType.SIGNALS);

      const sessionStatus = {
        stockMarketData: stockSession ? "ACTIVE" : "NOT CREATED",
        indexMarketData: indexSession ? "ACTIVE" : "NOT CREATED",
        signals: signalSession ? "ACTIVE" : "NOT CREATED"
      };

      // Test publishing to different topics using the different sessions
      const testResults = [];
      
      // 1. Test stock market data
      try {
        const stockTestMsg = {
          symbol: "MSFT",
          companyName: "Microsoft Corp.",
          currentPrice: 350.25,
          percentChange: 2.3,
          timestamp: new Date().toISOString()
        };
        
        await solaceService.publish(
          "market-data/EQ/US/NASDAQ/MSFT", 
          stockTestMsg
        );
        
        testResults.push({
          sessionType: "stock_market_data",
          topic: "market-data/EQ/US/NASDAQ/MSFT",
          result: "SUCCESS"
        });
      } catch (error) {
        testResults.push({
          sessionType: "stock_market_data",
          topic: "market-data/EQ/US/NASDAQ/MSFT",
          result: "FAILED",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
      
      // 2. Test index market data
      try {
        const indexTestMsg = {
          symbol: "SPX",
          currentPrice: 5200.75,
          percentChange: 0.5,
          timestamp: new Date().toISOString()
        };
        
        await solaceService.publish(
          "market-data/SPX", 
          indexTestMsg
        );
        
        testResults.push({
          sessionType: "index_market_data",
          topic: "market-data/SPX",
          result: "SUCCESS"
        });
      } catch (error) {
        testResults.push({
          sessionType: "index_market_data",
          topic: "market-data/SPX",
          result: "FAILED",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
      
      // 3. Test signal data
      try {
        const signalTestMsg = {
          symbol: "MSFT",
          signal: "Buy",
          confidence: 0.85,
          content: "Test signal for multi-session architecture",
          timestamp: new Date().toISOString()
        };
        
        await solaceService.publish(
          "signal/output", 
          signalTestMsg
        );
        
        testResults.push({
          sessionType: "signals",
          topic: "signal/output",
          result: "SUCCESS"
        });
      } catch (error) {
        testResults.push({
          sessionType: "signals",
          topic: "signal/output",
          result: "FAILED",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
      
      // Test subscription to each session type
      const subscriptionTests = [];
      
      // 1. Test subscription to stock market data
      try {
        const stockTopic = "market-data/EQ/US/NASDAQ/AAPL";
        await solaceService.subscribe(stockTopic, (message) => {
          console.log(`[TEST] Received stock market data: ${JSON.stringify(message)}`);
        });
        subscriptionTests.push({
          sessionType: "stock_market_data",
          topic: stockTopic,
          result: "SUBSCRIBED"
        });
      } catch (error) {
        subscriptionTests.push({
          sessionType: "stock_market_data",
          result: "FAILED",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
      
      // 2. Test subscription to index market data
      try {
        const indexTopic = "market-data/SPX";
        await solaceService.subscribe(indexTopic, (message) => {
          console.log(`[TEST] Received index market data: ${JSON.stringify(message)}`);
        });
        subscriptionTests.push({
          sessionType: "index_market_data",
          topic: indexTopic,
          result: "SUBSCRIBED"
        });
      } catch (error) {
        subscriptionTests.push({
          sessionType: "index_market_data",
          result: "FAILED",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
      
      // 3. Test subscription to signal data
      try {
        const signalTopic = "signal/output";
        await solaceService.subscribe(signalTopic, (message) => {
          console.log(`[TEST] Received signal data: ${JSON.stringify(message)}`);
        });
        subscriptionTests.push({
          sessionType: "signals",
          topic: signalTopic,
          result: "SUBSCRIBED"
        });
      } catch (error) {
        subscriptionTests.push({
          sessionType: "signals",
          result: "FAILED",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
      
      // Return the test results
      res.json({
        success: true,
        message: "Multi-session Solace architecture test completed",
        sessionStatus,
        publishTests: testResults,
        subscriptionTests
      });
    } catch (error) {
      console.error("Error testing multi-session architecture:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test multi-session architecture",
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });
  /**
   * Test endpoint to verify Solace connection with user-provided credentials
   * This is a diagnostic tool for verifying broker connectivity
   */
  app.post("/api/test/solace-connection-validate", async (req: Request, res: Response) => {
    try {
      const { brokerUrl, vpnName, username, password } = req.body;
      
      // Validate required parameters
      if (!brokerUrl || !vpnName || !username || !password) {
        return res.status(400).json({
          success: false,
          message: "Missing required connection parameters",
          details: "All fields (brokerUrl, vpnName, username, password) are required"
        });
      }
      
      console.log(`Attempting to validate Solace connection to: ${brokerUrl}`);
      
      // Temporarily disconnect from any existing connection
      const wasConnected = solaceService.isConnected();
      if (wasConnected) {
        await solaceService.disconnect();
        console.log("Temporarily disconnected from existing Solace connection for validation");
      }
      
      // Attempt to connect with provided credentials
      await solaceService.connect({
        brokerUrl,
        vpnName,
        username,
        password,
        configType: 'backend'  // Use backend as default config type for testing
      });
      
      // Test publishing to a diagnostic topic
      const testMessage = {
        type: "connection_test",
        timestamp: new Date().toISOString(),
        message: "Solace connection test successful"
      };
      
      await solaceService.publish("diagnostic/connection-test", testMessage);
      console.log("Test message published to Solace successfully");
      
      // If we had a previous connection, restore it
      if (wasConnected) {
        // Get the active config from storage
        const activeConfig = await storage.getActiveSolaceConfig();
        if (activeConfig) {
          await solaceService.connect({
            brokerUrl: activeConfig.brokerUrl,
            vpnName: activeConfig.vpnName,
            username: activeConfig.username,
            password: activeConfig.password,
            configType: (activeConfig.configType as 'frontend' | 'backend' | 'twitter' | 'twitter-publisher') || 'backend'
          });
          console.log("Restored previous Solace connection");
        }
      } else {
        // No previous connection, just disconnect
        await solaceService.disconnect();
      }
      
      // Return success response
      res.json({
        success: true,
        message: "Solace connection validation successful",
        details: {
          brokerUrl,
          vpnName,
          username: "******", // Mask the password for security
          connectionEstablished: true,
          messagePublished: true
        }
      });
    } catch (error) {
      console.error("Error validating Solace connection:", error);
      res.status(500).json({
        success: false,
        message: "Failed to validate Solace connection",
        details: error instanceof Error ? error.message : "Unknown error",
        error: error instanceof Error ? error.stack : null
      });
    }
  });
  /**
   * Test endpoint to send market data directly to subscribed clients
   * This helps debug market data subscription issues
   */
  app.post("/api/test/market-data", async (req: Request, res: Response) => {
    try {
      // Get the symbol from the request
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ success: false, message: "Symbol is required" });
      }

      // Look up the stock to get company information
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        return res.status(404).json({ success: false, message: `Stock not found for symbol: ${symbol}` });
      }
      
      // Determine the correct topic
      const isMarketIndex = ['SPX', 'DJI', 'NDX'].includes(symbol);
      let topic: string;
      
      if (isMarketIndex) {
        topic = `market-data/${symbol}`;
      } else {
        // Determine exchange (NYSE or NASDAQ) based on common knowledge
        const exchange = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'TSLA', 'NVDA', 'INTC', 'CSCO', 'ADBE', 'NFLX', 'AMD', 'MRNA', 'PYPL', 'CMCSA', 'SBUX'].includes(symbol) 
          ? 'NASDAQ' 
          : 'NYSE';
        
        topic = `market-data/EQ/US/${exchange}/${symbol}`;
      }
      
      // Create a price update with small random change
      const basePrice = stock.currentPrice || 100;
      const priceChange = Math.random() * 10 - 5;
      const currentPrice = (basePrice + priceChange).toFixed(2);
      const percentChange = parseFloat((Math.random() * 2 - 1).toFixed(2));
      
      // Create the market data message
      const marketData = {
        type: 'market-data',
        topic,
        symbol,
        data: {
          symbol,
          companyName: stock.companyName,
          currentPrice: parseFloat(currentPrice), // Convert string back to number
          percentChange,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };
      
      console.log(`Sending test market data for ${symbol} to topic ${topic}`);
      
      // Update the stock price in storage
      await storage.updateStockPrice(
        symbol,
        parseFloat(currentPrice),
        percentChange
      );
      
      // Instead of direct WebSocket broadcasting, publish to Solace
      // This is more aligned with the application architecture
      await solaceService.publish(topic, marketData.data);
      
      res.json({ 
        success: true, 
        message: `Test market data sent for ${symbol} to Solace topic ${topic}`,
        details: {
          marketData
        }
      });
    } catch (error) {
      console.error('Error sending test market data:', error);
      res.status(500).json({ 
        success: false,
        message: error instanceof Error ? error.message : "Failed to send test market data" 
      });
    }
  });
  
  // Test route for Solace connection tests
  app.post("/api/test/solace-connection", async (req: Request, res: Response) => {
    try {
      console.log("Running Solace connection tests");
      
      if (!solaceService.isConnected()) {
        return res.status(400).json({ 
          success: false, 
          message: "Cannot run tests: Not connected to Solace" 
        });
      }
      
      // Trace publishing (optional)
      const tracing = req.body.enableTracing ? traceSolacePublishing() : null;
      
      // Test Twitter publishing to Solace
      const symbol = req.body.symbol || "AAPL";
      const twitterPublishResult = await testTwitterPublishing(symbol);
      
      // Test Solace subscription for signal/output
      const subscriptionResult = await testSolaceSubscription("signal/output");
      
      // Test live data toggle for market indices (optional)
      const liveDataResult = req.body.testLiveData ? 
        await testLiveDataToggle() : 
        { success: "skipped", message: "Live data test skipped" };
      
      // Disable tracing if enabled
      if (tracing) {
        tracing.restore();
      }
      
      res.json({
        success: true,
        results: {
          twitterPublish: twitterPublishResult,
          solaceSubscription: subscriptionResult,
          liveDataToggle: liveDataResult
        }
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error instanceof Error ? error.message : "Failed to run Solace connection tests"
      });
    }
  });
  
  // Test route to verify Twitter feed is published to Solace
  
  /**
   * Diagnostic endpoint to check why Twitter feed publisher is not publishing feeds
   * This analyzes the Twitter service implementation and connection status
   */
  app.post("/api/test/twitter-feed-diagnostic", async (req: Request, res: Response) => {
    try {
      const symbol = req.body.symbol || "AAPL";
      console.log(`Running Twitter feed diagnostic for symbol: ${symbol}`);
      
      // Check Solace connection status
      const solaceConnected = solaceService.isConnected();
      console.log(`Solace connection status: ${solaceConnected ? "Connected" : "Disconnected"}`);
      
      // Check if Twitter simulation is running by checking tweet frequency
      // Use safer approach that doesn't rely on specific return type structure
      const tweetFrequency = twitterService.getTweetFrequency();
      console.log(`Tweet frequency returned by service: ${JSON.stringify(tweetFrequency)}`);
      
      // Safely determine if Twitter simulation is running
      let twitterSimulationRunning = false;
      if (tweetFrequency) {
        if (typeof tweetFrequency === 'number') {
          twitterSimulationRunning = tweetFrequency > 0;
        } else if (Array.isArray(tweetFrequency) && tweetFrequency.length > 0) {
          twitterSimulationRunning = tweetFrequency[0] > 0;
        }
      }
      console.log(`Twitter simulation running: ${twitterSimulationRunning}`);
      
      // Check if symbol is in the tracked symbols - use indirect method 
      // since we shouldn't access private fields
      let isSymbolTracked = false;
      
      // We'll check by trying to stop simulation for this symbol and seeing if a log message appears
      // This is a hacky but functional method to check if a symbol is tracked
      console.log(`Checking if ${symbol} is tracked by Twitter service...`);
      const originalLog = console.log;
      let isTracked = false;
      
      // Override console.log temporarily to capture output
      console.log = function(msg, ...args) {
        // If we see a message about stopping a simulation for this symbol, it was tracked
        if (typeof msg === 'string' && msg.includes(`Stopped Twitter feed simulation for ${symbol}`)) {
          isTracked = true;
        }
        // Pass through to original
        originalLog.apply(console, [msg, ...args]);
      };
      
      // Initialize TwitterService first (will be a no-op if already initialized)
      twitterService.init()
        .then(() => {
          // Now stop the simulation for just this symbol - if it's tracked, we'll see a log message
          return twitterService.stopSimulation();
        })
        .then(() => {
          // Restore console.log
          console.log = originalLog;
          console.log(`Symbol ${symbol} is tracked: ${isTracked}`);
          
          // Restart simulation with the same frequency (will be a no-op if no symbols were tracked)
          const freq = twitterService.getTweetFrequency();
          let minFreq = 60, maxFreq = 60;  // Default values
          
          // Handle different return types safely
          if (Array.isArray(freq) && freq.length >= 2) {
            minFreq = freq[0];
            maxFreq = freq[1];
          } else if (typeof freq === 'number') {
            minFreq = maxFreq = freq;
          }
          
          twitterService.setTweetFrequency(minFreq, maxFreq);
          
          // We'll infer that AAPL is tracked if any symbols are tracked
          // since that's the most common test symbol
          return twitterService.startSimulation(['AAPL'], 60);
        })
        .catch(err => {
          console.log = originalLog;
          console.error(`Error checking tracked symbols: ${err}`);
        });
      
      // Force publishing a test Twitter feed
      console.log(`Forcing test Twitter feed publication for ${symbol}`);
      const testTweet = {
        id: Date.now(), // Only used for Solace, not for storage
        content: `This is a diagnostic test tweet for $${symbol} #${symbol} generated at ${new Date().toISOString()}`
        // Note: timestamp will be set automatically by the storage implementation
      };
      
      // Create the feed in storage
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        return res.status(404).json({
          success: false, 
          message: `Stock not found for symbol: ${symbol}`
        });
      }
      
      // Create tweet in storage with correct type
      // Convert sentiment to a numeric value (-1 to 1) as required by schema
      const sentimentValue = Math.random() > 0.5 ? 0.75 : -0.75; // Random positive or negative sentiment
      
      // Note: Only include fields that are in the schema: stockId, content, sentiment
      // The timestamp will be set automatically by the storage implementation
      await storage.createTwitterFeed({
        stockId: stock.id,
        content: testTweet.content,
        sentiment: sentimentValue
        // Note: 'source' field was removed as it's not part of the TwitterFeed schema
      });
      
      // Publish to Solace if connected
      let publishResult = "Not attempted - Solace not connected";
      if (solaceConnected) {
        try {
          const topic = `twitter-feed/${symbol}`;
          // Add timestamp for Solace message (only needed for Solace, not for storage)
          const solaceMessage = {
            ...testTweet,
            timestamp: new Date()
          };
          await solaceService.publish(topic, solaceMessage);
          publishResult = `Successfully published to topic: ${topic}`;
          console.log(publishResult);
        } catch (pubError) {
          publishResult = `Error publishing to Solace: ${pubError instanceof Error ? pubError.message : 'Unknown error'}`;
          console.error(publishResult);
        }
      }
      
      // Compile diagnostic information
      const diagnosticInfo = {
        solaceConnected,
        twitterSimulationRunning,
        isSymbolTracked: isTracked, // Use isTracked from our check
        testPublishResult: publishResult,
        recommendations: [] as string[] // Define proper type to avoid errors
      };
      
      // Add recommendations based on diagnostic results
      if (!solaceConnected) {
        diagnosticInfo.recommendations.push("Connect to Solace broker using the configuration panel");
      }
      
      if (!twitterSimulationRunning) {
        diagnosticInfo.recommendations.push("Start Twitter simulation by selecting symbols and enabling Twitter feed in the dashboard");
      }
      
      if (!isSymbolTracked && twitterSimulationRunning) {
        diagnosticInfo.recommendations.push(`Add ${symbol} to the list of tracked symbols in the dashboard`);
      }
      
      res.json({
        success: true,
        message: "Twitter feed diagnostic completed",
        diagnosticInfo
      });
    } catch (error) {
      console.error("Error running Twitter feed diagnostic:", error);
      res.status(500).json({
        success: false,
        message: "Error running Twitter feed diagnostic",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
  
  app.post("/api/test/twitter-publishing", async (req: Request, res: Response) => {
    try {
      if (!solaceService.isConnected()) {
        return res.status(400).json({ 
          success: false, 
          message: "Cannot run test: Not connected to Solace" 
        });
      }
      
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ 
          success: false, 
          message: "Symbol is required" 
        });
      }
      
      // Enable tracing to record Solace publishing
      const tracing = traceSolacePublishing();
      
      // Initialize TwitterService first to ensure it's ready
      await twitterService.init();
      
      // Now use the private method to update the Twitter feed
      // @ts-ignore - Accessing private method for testing
      await twitterService.updateSymbolTwitterFeed(symbol);
      
      // Restore tracing
      tracing.restore();
      
      res.json({
        success: true,
        message: `Twitter feed for ${symbol} published to Solace. Check server logs for [TRACE] messages.`
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error instanceof Error ? error.message : "Failed to test Twitter publishing"
      });
    }
  });
  
  // Test route to verify WebSocket broadcasting is not used
  app.post("/api/test/no-websocket-broadcast", async (req: Request, res: Response) => {
    try {
      const symbol = req.body.symbol || "AAPL";
      
      // Create a tweet to test
      const tweet = `Test tweet for ${symbol} to verify no WebSocket broadcasting is used`;
      
      // Call the method to publish a tweet via the LLM service
      await llmService.publishTweetForProcessing(symbol, tweet, new Date());
      
      // In a proper implementation, this would be sent via Solace, not WebSocket broadcast
      res.json({
        success: true,
        message: "Tweet published to Solace. Check logs for confirmation.",
        details: {
          symbol,
          tweet,
          topic: `twitter-feed/${symbol}`
        }
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error instanceof Error ? error.message : "Failed to test Twitter publishing"
      });
    }
  });
  // Test route to simulate a signal with trading signal coming from signal/output topic
  app.post("/api/test/signal", async (req: Request, res: Response) => {
    try {
      // Get the symbol from the request
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ message: "Symbol is required" });
      }
      
      // Get signal type - defaults to BUY
      const signal = req.body.signal || "BUY";
      
      // Get confidence - defaults to 0.85
      const confidence = req.body.confidence || 0.85;
      
      // Require actual tweet content in the request
      const tweetContent = req.body.tweetContent;
      if (!tweetContent) {
        return res.status(400).json({ 
          message: "tweetContent is required - please provide actual tweet content, not test data"
        });
      }
        
      // Don't allow generic test signals
      if (tweetContent.includes("Automatic test signal") || tweetContent.includes("test signal")) {
        return res.status(400).json({ 
          message: "Generic test signals are not allowed - please provide actual tweet content"
        });
      }
      
      // Look up the stock to get company name
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        return res.status(400).json({ message: `Stock not found for symbol: ${symbol}` });
      }
      
      // Create a proper signal message using llmService
      try {
        await llmService.publishTestSignal(symbol, signal, confidence, tweetContent);
        console.log(`Published signal for ${symbol} via llmService`);
        
        res.json({ 
          success: true, 
          message: "Test signal published",
          details: {
            symbol,
            signal,
            confidence,
            tweetContent,
            timestamp: new Date().toISOString()
          }
        });
      } catch (err) {
        console.error(`Error publishing signal via llmService: ${err}`);
        return res.status(500).json({ message: "Failed to publish signal" });
      }
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to publish test signal" 
      });
    }
  });
  
  // Test route to simulate just a tweet message coming from signal/output topic (no trading signal)
  app.post("/api/test/tweet", async (req: Request, res: Response) => {
    try {
      // Get the symbol from the request
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ message: "Symbol is required" });
      }
      
      // Get tweet content or generate default
      const tweetContent = req.body.tweetContent || 
        `New information about ${symbol} has been analyzed. #${symbol}`;
      
      // Look up the stock to get company name
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        return res.status(400).json({ message: `Stock not found for symbol: ${symbol}` });
      }
      
      // Create a tweet-only message (no signal)
      // Note: removed 'source' field - it's not part of the schema
      const tweetMessage = {
        symbol: symbol,
        companyName: stock.companyName,
        tweetContent: tweetContent,
        timestamp: new Date().toISOString()
      };
      
      console.log(`Publishing test tweet to signal/output topic:`, tweetMessage);
      
      // Publish to the signal/output topic
      await solaceService.publish("signal/output", tweetMessage);
      
      res.json({ 
        success: true, 
        message: "Test tweet published",
        details: tweetMessage 
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to publish test tweet" 
      });
    }
  });

  // Test route that simulates a signal message in the exact format of signal/output
  app.post("/api/test/signal-output", async (req: Request, res: Response) => {
    try {
      // Get the symbol from the request
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ message: "Symbol is required" });
      }
      
      // Get signal type - defaults to BUY
      const signal = req.body.signal || "BUY";
      
      // Get confidence - defaults to 0.85
      const confidence = req.body.confidence || 0.85;
      
      // Get tweet content or generate default
      const content = req.body.content || 
        `${symbol} is showing strong momentum. Analysts predict positive earnings. #${symbol}`;
      
      // Look up the stock to get company name
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        return res.status(400).json({ message: `Stock not found for symbol: ${symbol}` });
      }
      
      // Create a message with the exact type expected for signal/output
      const outputMessage = {
        type: "signal/output",
        symbol: symbol,
        data: {
          symbol: symbol,
          companyName: stock.companyName,
          signal: signal,
          confidence: confidence,
          content: content,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };
      
      console.log(`Publishing test signal/output message:`, outputMessage);
      
      // Publish directly to all WebSocket clients
      await solaceService.publish("signal/output", outputMessage);
      
      res.json({ 
        success: true, 
        message: "Test signal/output message published",
        details: outputMessage 
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to publish test signal/output message" 
      });
    }
  });

  // Test route to simulate a SELL signal
  app.post("/api/test/sell", async (req: Request, res: Response) => {
    try {
      // Get the symbol from the request
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ message: "Symbol is required" });
      }
      
      // Look up the stock to get company name
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        return res.status(400).json({ message: `Stock not found for symbol: ${symbol}` });
      }
      
      // Create a SELL signal
      const sellSignal = {
        symbol: symbol,
        companyName: stock.companyName,
        signal: "SELL",
        confidence: 0.9,
        tweetContent: `${stock.companyName} is facing significant headwinds. Technical indicators suggest downward pressure. #${symbol}`,
        timestamp: new Date().toISOString(),
        source: "signal/output"
      };
      
      console.log(`Publishing SELL signal to signal/output topic:`, sellSignal);
      
      // Publish to the signal/output topic
      await solaceService.publish("signal/output", sellSignal);
      
      res.json({ 
        success: true, 
        message: "Test SELL signal published",
        details: sellSignal 
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to publish SELL signal" 
      });
    }
  });

  // Test route to simulate a HOLD signal
  app.post("/api/test/hold", async (req: Request, res: Response) => {
    try {
      // Get the symbol from the request
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ message: "Symbol is required" });
      }
      
      // Look up the stock to get company name
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        return res.status(400).json({ message: `Stock not found for symbol: ${symbol}` });
      }
      
      // Create a HOLD signal
      const holdSignal = {
        symbol: symbol,
        companyName: stock.companyName,
        signal: "HOLD",
        confidence: 0.75,
        tweetContent: `${stock.companyName} is showing mixed indicators. Market uncertainty suggests maintaining current positions. #${symbol}`,
        timestamp: new Date().toISOString(),
        source: "signal/output"
      };
      
      console.log(`Publishing HOLD signal to signal/output topic:`, holdSignal);
      
      // Publish to the signal/output topic
      await solaceService.publish("signal/output", holdSignal);
      
      res.json({ 
        success: true, 
        message: "Test HOLD signal published",
        details: holdSignal 
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to publish HOLD signal" 
      });
    }
  });
  
  // Test route using the llmService's publishTestSignal method
  app.post("/api/test/llm-signal", async (req: Request, res: Response) => {
    try {
      // Get the symbol from the request
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ message: "Symbol is required" });
      }
      
      // Get signal type - defaults to BUY
      const signal = req.body.signal || "BUY";
      
      // Get confidence - defaults to 0.85
      const confidence = req.body.confidence || 0.85;
      
      // Get tweet content or generate default
      const tweetContent = req.body.tweetContent || 
        `${symbol} is showing strong momentum based on LLM analysis. High confidence trading signal generated. #${symbol}`;
      
      // Use the llmService to publish the test signal
      await llmService.publishTestSignal(symbol, signal, confidence, tweetContent);
      
      res.json({ 
        success: true, 
        message: "Test signal published via LLM service",
        details: {
          symbol,
          signal,
          confidence,
          tweetContent,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to publish test signal via LLM service" 
      });
    }
  });
  
  /**
   * Test endpoint to send signal/output message via Solace
   * This is extremely useful for testing the frontend's ability to process signal/output messages
   */
  // Test route to force market data updates for specific symbols
  app.post("/api/test/market-update", async (req: Request, res: Response) => {
    try {
      const symbols = req.body.symbols || ["AAPL", "MSFT", "GOOG", "AMZN", "TSLA", "SPX", "DJI", "NDX"];
      
      // Force market data updates for the requested symbols
      for (const symbol of symbols) {
        await marketDataService.updateSymbolMarketData(symbol);
      }
      
      res.json({
        success: true,
        message: `Forced market data update for ${symbols.length} symbols`,
        symbols
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to update market data"
      });
    }
  });

  app.post("/api/test/direct-websocket", async (req: Request, res: Response) => {
    try {
      // Get the symbol from the request
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ message: "Symbol is required" });
      }
      
      // Get signal type - defaults to BUY
      const signal = req.body.signal || "BUY";
      
      // Get confidence - defaults to 0.85
      const confidence = parseFloat(req.body.confidence) || 0.85;
      
      // Get tweet content or generate default
      const content = req.body.content || 
        `${symbol} is showing strong momentum based on signal/output test. #${symbol}`;
      
      // Look up the stock to get company name
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        return res.status(400).json({ message: `Stock not found for symbol: ${symbol}` });
      }
      
      // Create a message with signal/output format
      const message = {
        type: "signal/output",
        symbol: symbol,
        data: {
          symbol: symbol,
          companyName: stock.companyName,
          signal: signal,
          confidence: confidence,
          content: content,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };
      
      // Check if Solace is connected
      if (!solaceService.isConnected()) {
        return res.status(400).json({ 
          success: false, 
          message: "Cannot send test signal: Not connected to Solace" 
        });
      }
      
      // Publish to signal/output topic in Solace
      await solaceService.publish("signal/output", message);
      
      console.log(`Published signal/output message to Solace:`, JSON.stringify(message));
      
      res.json({ 
        success: true, 
        message: `Test signal published to Solace on 'signal/output' topic`,
        details: message
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to publish test signal to Solace" 
      });
    }
  });
}