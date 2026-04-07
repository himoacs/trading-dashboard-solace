import type { Express, Request, Response } from "express";
import { Router } from 'express';
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from 'ws';
import { storage } from "./storage";
import { z } from "zod";
import { 
  solaceConnectionSchema, 
  dataSubscriptionSchema,
  // any other relevant schemas from @shared/schema
} from "@shared/schema";

// Service Imports
import { solaceService, SessionType } from "./services/solaceService"; 
import { marketDataService } from "./services/marketDataService";
import { llmService } from "./services/llmService";
// Import publisher services that use user-provided credentials
import { publisherSolaceService } from "./services/publisherSolaceService";

// Define MessageTypes if not already defined or imported (based on previous context)
export const MessageTypes = {
  MARKET_DATA: 'market-data',
  TWITTER_FEED: 'twitter-feed',
  NEWS_FEED: 'news-feed',
  ECONOMIC_INDICATOR: 'economic-indicator',
  TRADING_SIGNAL: 'trading-signal',
  SIGNAL: 'signal',
  SIGNAL_OUTPUT: 'signal/output',
  CONNECTION: 'connection',
  PING: 'ping',
  PONG: 'pong',
  SUBSCRIPTION_ACK: 'subscription_ack',
  TOPIC_SUBSCRIPTION_ACK: 'topic_subscription_ack',
  TOPIC_UNSUBSCRIPTION_ACK: 'topic_unsubscription_ack'
};

// Define WebSocketMessage type if not already defined or imported (based on previous context)
export type WebSocketMessage = {
  type: string;
  symbol?: string;
  data?: any;
  timestamp?: string;
  message?: string;
  symbols?: string[]; 
  topic?: string;     
  rawData?: string;   
  direction?: 'incoming' | 'outgoing'; 
  isWildcard?: boolean; 
  wildcardType?: 'country' | 'exchange' | 'other'; 
  isCriticalTest?: boolean; 
  content?: string;        
  Signal?: string;         
  signal?: string;         
  confidence?: number;     
  companyName?: string;    
};

// Module-level array to store WebSocket clients
const clients: WebSocket[] = []; // Renamed from globalClients and made the primary list

// Module-level store for client topic subscriptions
const clientSubscriptions = new Map<WebSocket, Set<string>>();

// NEW: Set to track topics the main solaceService is subscribed to on Solace for WebSockets
// Initialize with topics that the backend solaceService should always listen to.
const initialSolaceTopicsForServerListener = ['signal/*']; // Example: always listen to all signals. connection/status is usually for client-facing broker.
const activeSolaceSubscriptionsForWebSockets = new Set<string>(initialSolaceTopicsForServerListener);

// Module-level function to access client subscriptions
function getWsClientSubscriptions(): Map<WebSocket, Set<string>> {
  return clientSubscriptions;
}

// Export broadcast function to be used by other modules
export function broadcastToWebSockets(message: any): void {
  let sentCount = 0;
  
  clients.forEach(client => { // Changed from globalClients to clients
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
        sentCount++;
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
      }
    }
  });
  
  // console.log(`Broadcasting message to ${sentCount} WebSocket clients: ${message.type}`);
}

// Broadcast to WebSocket clients subscribed to a specific topic
export function broadcastToWebSocketSubscribers(topic: string, message: any): void {
  // DETAILED LOG FOR BROADCAST ATTEMPT
  // console.log(`[WS BROADCAST ATTEMPT] Topic: "${topic}"`);
  if (message && typeof message === 'object') {
    const messagePreview = JSON.stringify(message).substring(0, 150);
    // console.log(`  - Message Preview (object): ${messagePreview}${JSON.stringify(message).length > 150 ? '...' : ''}`);
  } else if (typeof message === 'string') {
    const messagePreview = message.substring(0, 150);
    // console.log(`  - Message Preview (string): ${messagePreview}${message.length > 150 ? '...' : ''}`);
  } else {
    // console.log(`  - Message Preview (other type): ${typeof message}`);
  }

  let sentCount = 0;
  
  const currentClientSubscriptions = getWsClientSubscriptions(); // Use module-level getter

  clients.forEach(client => { // Changed from globalClients to clients
    if (client.readyState === WebSocket.OPEN) {
      try {
        if (topic === 'signal/output') {
          client.send(JSON.stringify(message));
          sentCount++;
        } else {
          const subscriptions = currentClientSubscriptions.get(client);
          if (subscriptions && subscriptions.has(topic)) {
          client.send(JSON.stringify(message));
          sentCount++;
          }
        }
      } catch (error) {
        console.error(`Error sending WebSocket message for topic ${topic}:`, error);
      }
    }
  });
  
  if (sentCount > 0 && topic !== 'signal/output' && Math.random() < 0.05) {
    console.log(`Broadcasting ${topic} message to ${sentCount} subscribed clients`);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // SECURITY FIX: Deactivate all Solace configurations at startup
  // This ensures no hardcoded credentials are used for automatic connections
  try {
    console.log("SECURITY: Deactivating all Solace configurations at startup");
    await storage.deactivateAllSolaceConfigs();
    
    // SECURITY FIX: Also explicitly reset the publisher service state
    // This ensures any existing connections are properly terminated
    // and credentials are cleared from memory
    if (publisherSolaceService && typeof publisherSolaceService.resetAllState === 'function') {
      //console.log("SECURITY: Explicitly resetting publisher service state");
      publisherSolaceService.resetAllState();
    } else {
      //console.log("SECURITY: Publisher service not available or reset method not found");
    }
    
    //console.log("SECURITY: All Solace configurations deactivated. User must provide credentials via the UI.");
  } catch (error) {
    console.error("Error deactivating Solace configurations:", error);
  }
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true }); // Use noServer option
  
  // ****** MODIFIED HTTP UPGRADE HANDLER ******
  httpServer.on('upgrade', (request, socket, head) => {
    // Ensure this is an upgrade request for our specific WebSocket path
    if (request.url === '/ws') { 
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // For any other upgrade requests (e.g., Vite HMR), destroy the socket
      // to prevent them from being handled by this server.
      socket.destroy();
    }
  });
  // ****** END MODIFIED HTTP UPGRADE HANDLER ******
  
  // Keep track of all connected clients - MOVED to module scope
  // const clients: WebSocket[] = []; 
  
  // Store WebSocket server in app.locals for test routes
  app.locals.wss = wss;
  // app.locals.clients = clients; // REMOVED - clients is now module-scoped
  
  // Set up ping interval to keep connections alive (every 30 seconds)
  const pingInterval = setInterval(() => {
    // Ping clients in the local `clients` list for this wss instance
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          // Send a ping-like message with current timestamp
          client.send(JSON.stringify({
            type: 'ping',
            timestamp: new Date().toISOString()
          }));
        } catch (err) {
          console.error('Error sending ping to client:', err);
        }
      }
    });
    
    // Log current connection count
    console.log(`Active WebSocket connections (this instance): ${clients.filter(c => c.readyState === WebSocket.OPEN).length}`);
  }, 30000);
  
  // Track wildcard subscriptions separately for optimized subscription management
  const wildcardSubscriptions = new Set<string>();
  
  // DEBUG helper function to ensure wildcards are added correctly
  const debugAddWildcard = (topic: string, source: string): void => {
    console.log(`🔍 [${source}] Adding wildcard topic: ${topic}`);
    console.log(`  - Before: wildcardSubscriptions.size = ${wildcardSubscriptions.size}`);
    console.log(`  - Current wildcards: [${Array.from(wildcardSubscriptions).join(', ')}]`);
    
    // Add to the wildcard set
    wildcardSubscriptions.add(topic);
    
    console.log(`  - After: wildcardSubscriptions.size = ${wildcardSubscriptions.size}`);
    console.log(`  - Updated wildcards: [${Array.from(wildcardSubscriptions).join(', ')}]`);
    console.log(`  - Contains added topic: ${wildcardSubscriptions.has(topic)}`);
  };
  
  // Store subscription maps in app.locals for testing and diagnostics
  app.locals.wildcardSubscriptions = wildcardSubscriptions;
  
  // Functions to access WebSocket clients and their subscriptions
  function getWsClients(): WebSocket[] { // This function now correctly returns the module-scoped clients
    return clients;
  }
  
  // getWsClientSubscriptions is now module-level
  // function getWsClientSubscriptions(): Map<WebSocket, Set<string>> {
  //   return clientSubscriptions;
  // }
  
  // Helper function to get wildcard subscriptions (for testing)
  function getWildcardSubscriptions(): Set<string> {
    return wildcardSubscriptions;
  }
  
  /**
   * Function to check if a specific topic is covered by any active wildcard subscription
   * COMPLETELY REWRITTEN for maximum clarity and reliability
   */
  function isTopicCoveredByWildcard(topic: string): boolean {
    // Basic validation
    if (!topic || wildcardSubscriptions.size === 0) {
      console.log(`❌ No wildcards registered or invalid topic: ${topic}`);
      return false;
    }
    
    // More detailed logging
    console.log(`\n🔍 CHECKING TOPIC COVERAGE: "${topic}"`);
    console.log(`📋 CURRENT WILDCARD REGISTRY (${wildcardSubscriptions.size}):`);
    Array.from(wildcardSubscriptions).forEach(w => console.log(`   - ${w}`));
    
    // Parse topic parts
    const parts = topic.split('/');
    if (parts.length < 5) {
      console.log(`❌ Invalid topic format (too few parts): ${topic}`);
      return false;
    }
    
    // Extract topic components for matching
    const [type, assetClass, country, exchange, symbol] = parts;
    console.log(`📊 Topic breakdown: type=${type}, assetClass=${assetClass}, country=${country}, exchange=${exchange}, symbol=${symbol}`);
    
    // APPROACH 1: Direct matching with well-formed patterns that would match this topic
    
    // Country-level wildcard pattern for this specific topic
    const countryWildcard = `${type}/${assetClass}/${country}/>`;
    if (wildcardSubscriptions.has(countryWildcard)) {
      console.log(`✅ MATCH FOUND! Topic is covered by country wildcard: ${countryWildcard}`);
      return true;
    }
    
    // Exchange-level wildcard pattern for this specific topic
    const exchangeWildcard = `${type}/${assetClass}/${country}/${exchange}/>`;
    if (wildcardSubscriptions.has(exchangeWildcard)) {
      console.log(`✅ MATCH FOUND! Topic is covered by exchange wildcard: ${exchangeWildcard}`);
      return true;
    }
    
    // APPROACH 2: Manual pattern matching against all wildcards
    console.log(`🔄 No direct match found, checking all wildcards manually...`);
    
    // Manual check of each wildcard in the registry
    for (const wildcardPattern of wildcardSubscriptions) {
      console.log(`  📝 Checking against wildcard: ${wildcardPattern}`);
      
      const wildcardParts = wildcardPattern.split('/');
      
      // Check for country-level wildcard match: market-data/EQ/JP/>
      const isCountryWildcardMatch = 
        wildcardParts.length === 4 &&
        wildcardParts[0] === type &&
        wildcardParts[1] === assetClass &&
        wildcardParts[2] === country &&
        wildcardParts[3] === '>';
        
      if (isCountryWildcardMatch) {
        console.log(`✅ COUNTRY WILDCARD MATCH! ${topic} is covered by ${wildcardPattern}`);
        return true;
      }
      
      // Check for exchange-level wildcard match: market-data/EQ/JP/TSE/>
      const isExchangeWildcardMatch =
        wildcardParts.length === 5 &&
        wildcardParts[0] === type &&
        wildcardParts[1] === assetClass &&
        wildcardParts[2] === country &&
        wildcardParts[3] === exchange &&
        wildcardParts[4] === '>';
        
      if (isExchangeWildcardMatch) {
        console.log(`✅ EXCHANGE WILDCARD MATCH! ${topic} is covered by ${wildcardPattern}`);
        return true;
      }
    }
    
    // APPROACH 3: Dynamic pattern recognition
    // This is a safety fallback to catch any pattern variations we might have missed
    for (const wildcardPattern of wildcardSubscriptions) {
      // Skip if not a wildcard pattern
      if (!wildcardPattern.includes('>')) continue;
      
      // Create a regex pattern from the wildcard topic
      // Replace '>' with '.*' for regex matching
      let regexPattern = wildcardPattern.replace('>', '.*');
      // Escape special characters in the regex pattern
      regexPattern = regexPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Replace the escaped '\\>' with '.*' for wildcard matching
      regexPattern = regexPattern.replace('\\>\\.*', '.*');
      
      // Create regex from the pattern
      const regex = new RegExp(`^${regexPattern}$`);
      
      // Test if the topic matches this pattern
      if (regex.test(topic)) {
        console.log(`✅ DYNAMIC MATCH! Topic ${topic} matches wildcard pattern ${wildcardPattern}`);
        return true;
      }
    }
    
    // No match found after checking everything
    console.log(`❌ RESULT: Topic ${topic} is NOT covered by any wildcard subscription`);
    return false;
  }

  // Market indices functionality has been removed
  
  // Make sure to clear all intervals when the server shuts down
  httpServer.on('close', () => {
    clearInterval(pingInterval);
    // Market indices interval has been removed
  });
  
  // WebSocket connection handler
  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');
    
    // Add to client list
    clients.push(ws); // ADDED - ensure new connections are added to the module-scoped list
    // globalClients.push(ws); // REMOVED - globalClients is removed
    console.log(`Total WebSocket clients connected: ${clients.length}`);
    
    // Check if we have any active Solace connection
    if (!solaceService.isConnected()) {
      console.log("No active Solace connection detected when client connected - UI will show connection required");
    }
    
    // IMPORTANT: We no longer automatically populate the UI with popular stocks
    // User must explicitly select stocks or use filters to see data in the Live Market Intelligence panel
    
    // In production, we don't want to send automatic test signals
    // Test signals should only be sent via explicit test routes or through Solace
    // This also addresses the issue with receiving signals when no Solace connection exists
    
    // Remove automatic test signal sending completely
    
    // For testing the client's signal processing, use dedicated test routes:
    // POST /api/test/signal
    // POST /api/test/signal-output 
    // These routes are better for testing as they're explicitly called
    
    // Handle incoming messages
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Received message from client:', data);
        
        // Handle pong responses
        if (data.type === 'pong') {
          console.log('Received pong from client');
          return;
        }
        
        // Handle request for immediate market data
        if (data.type === 'request_market_data' && data.symbol) {
          console.log(`Client requested immediate market data for: ${data.symbol}`);
          
          try {
            // Get the stock from storage
            const stock = await storage.getStockBySymbol(data.symbol);
            
            if (stock) {
              // For regular stocks, determine the proper topic structure
              const isMarketIndex = ['SPX', 'DJI', 'NDX'].includes(data.symbol);
              let topic: string;
              
              if (isMarketIndex) {
                topic = `market-data/${data.symbol}`;
              } else {
                // Determine exchange (NYSE or NASDAQ) based on common knowledge
                const exchange = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'TSLA', 'NVDA', 'INTC', 'CSCO', 'ADBE', 'NFLX', 'AMD', 'MRNA', 'PYPL', 'CMCSA', 'SBUX'].includes(data.symbol) 
                  ? 'NASDAQ' 
                  : 'NYSE';
                  
                topic = `market-data/EQ/US/${exchange}/${data.symbol}`;
              }
              
              // Create market data message
              const message = {
                type: 'market-data',
                topic,
                symbol: stock.symbol,
                data: {
                  symbol: stock.symbol,
                  companyName: stock.companyName,
                  currentPrice: stock.currentPrice,
                  percentChange: stock.percentChange,
                  timestamp: new Date().toISOString()
                },
                timestamp: new Date().toISOString()
              };
              
              // Send to this specific client
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
                console.log(`Sent immediate market data for ${data.symbol} to client`);
              }
              
              // Also add it to the market service's list of tracked symbols
              await marketDataService.startSimulation([data.symbol], 5);
            } else {
              console.error(`Stock not found for symbol ${data.symbol}`);
            }
          } catch (error) {
            console.error(`Error sending immediate market data for ${data.symbol}:`, error);
          }
          
          return;
        }
        
        // Handle subscriptions
        if (data.type === 'subscribe' && Array.isArray(data.symbols)) {
          console.log(`Client subscribed to symbols: ${data.symbols.join(', ')}`);
          
          // Subscribe to market data topics for each symbol
          for (const symbol of data.symbols) {
            try {
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
              
              // Add to client subscriptions
              const clientSubscriptions = getWsClientSubscriptions().get(ws) || new Set<string>();
              clientSubscriptions.add(topic);
              getWsClientSubscriptions().set(ws, clientSubscriptions);
              
              // Log the current subscriptions
              const topics = Array.from(clientSubscriptions).join(', ');
              console.log(`Client now subscribed to topics: ${topics}`);
              
              // Start all simulations for this symbol
              if (solaceService.isConnected()) {
                console.log(`Starting all simulations for symbol: ${symbol}`);
                
                // Start market data simulation
                await marketDataService.startSimulation([symbol], 5);
                
                // Twitter feed is now browser-native via TrafficGeneratorPanel
                
                // News feed and economic indicators removed as requested
                
                // Start LLM signal generation
                // await llmService.startSignalGeneration([symbol]); // DEPRECATED: LLM service is old code
              } else {
                console.log(`Starting limited simulations for ${symbol} - no main Solace connection`);
                
                // Always start market data as it's essential
                await marketDataService.startSimulation([symbol], 5);
                
                // Twitter feed is now browser-native via TrafficGeneratorPanel
                // await llmService.startSignalGeneration([symbol]); // DEPRECATED: Also remove here if present
              }
            } catch (error) {
              console.error(`Error subscribing to market data for ${symbol}:`, error);
            }
          }
          
          // Send acknowledgment
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'subscription_ack',
              symbols: data.symbols,
              timestamp: new Date().toISOString()
            }));
          }
        }
        
        // Handle topic-based subscriptions
        if (data.type === 'subscribe_topic' && data.topic) {
          const topic = data.topic;
          console.log(`Client subscribed to topic: ${topic}`);
          
          // Check if this is an AMD topic that might be wrong (still using NYSE)
          if (topic.includes('/AMD') && topic.includes('/NYSE/')) {
            // AMD is now a NASDAQ stock, so we need to fix the topic
            const correctedTopic = topic.replace('/NYSE/AMD', '/NASDAQ/AMD');
            console.log(`Correcting AMD topic from ${topic} to ${correctedTopic}`);
            
            // Add the corrected topic to client subscriptions
            let clientSubs = clientSubscriptions.get(ws);
            if (!clientSubs) {
              clientSubs = new Set<string>();
              clientSubscriptions.set(ws, clientSubs);
            }
            clientSubs.add(correctedTopic);
            
            // If we have an active Solace connection, also subscribe to this topic there
            if (solaceService.isConnected()) {
              try {
                solaceService.subscribe(correctedTopic, (message) => {
                  console.log(`Message received on Solace subscription for corrected topic: ${correctedTopic}`);
                }).catch(err => {
                  console.error(`Error subscribing to corrected Solace topic ${correctedTopic}:`, err);
                });
              } catch (subError) {
                console.error(`Error subscribing to corrected Solace topic ${correctedTopic}:`, subError);
              }
            }
            
            // Send acknowledgment to client about the correction
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'topic_correction',
                originalTopic: topic,
                correctedTopic: correctedTopic,
                message: 'AMD is a NASDAQ stock, not NYSE',
                timestamp: new Date().toISOString()
              }));
            }
          } else {
            // Check if this is a wildcard topic subscription
            // CRITICAL FIX: First detect if this is a wildcard by message or pattern
            
            // 1. Check for explicit wildcard flag in message data with multiple fallbacks
            // This is critical for handling AU wildcards - we need to detect all ways the flag can be set
            const explicitWildcard = Boolean(
              data.isWildcard === true || 
              data.data?.isWildcard === true ||
              data.wildcardType === 'country' || 
              data.wildcardType === 'exchange' ||
              data.data?.wildcardType === 'country' || 
              data.data?.wildcardType === 'exchange'
            );
            
            // 2. Check topic pattern for wildcard character
            const topicHasWildcard = topic.includes('>');
            
            // 3. Pattern matching for different wildcard types
            const parts = topic.split('/');
            
            // Country-level wildcard: market-data/EQ/JP/>
            const isCountryWildcard = parts.length === 4 && 
                                    parts[0] === 'market-data' && 
                                    parts[1] === 'EQ' && 
                                    parts[3] === '>';
            
            // Exchange-level wildcard: market-data/EQ/JP/TSE/>
            const isExchangeWildcard = parts.length === 5 && 
                                    parts[0] === 'market-data' && 
                                    parts[1] === 'EQ' && 
                                    parts[4] === '>';
                                    
            // Final determination - ANY condition means it's a wildcard
            // This is a critical fix - we must correctly identify all wildcards
            const isWildcard = explicitWildcard || topicHasWildcard || isCountryWildcard || isExchangeWildcard;
            
            // Enhanced logging for debugging
            console.log(`🔍 WILDCARD DEBUG for topic ${topic}:`);
            console.log(`  - data.isWildcard = ${data.isWildcard}`);
            console.log(`  - data.data?.isWildcard = ${data.data?.isWildcard}`);
            console.log(`  - data.wildcardType = ${data.wildcardType || 'undefined'}`);
            console.log(`  - data.data?.wildcardType = ${data.data?.wildcardType || 'undefined'}`);
            console.log(`  - explicitWildcard = ${explicitWildcard}`);
            console.log(`  - topic.includes('>') = ${topicHasWildcard}`);
            console.log(`  - isCountryWildcard (pattern match) = ${isCountryWildcard}`);
            console.log(`  - isExchangeWildcard (pattern match) = ${isExchangeWildcard}`);
            console.log(`  - Topic parts = [${parts.join(', ')}] (${parts.length} parts)`);
            console.log(`  - Final isWildcard value = ${isWildcard}`);
            
            // CRITICAL FIX: Properly add to wildcard registry and track wildcard type
            if (isWildcard) {
              console.log(`✅ Processing wildcard topic subscription: ${topic}`);
              
              // CONSOLIDATED WILDCARD HANDLING: Use a single function to add to the registry
              // This ensures wildcards are consistently added to the registry in one place
              // and prevents duplicate entries or inconsistent handling
              
              // Delete any existing entry first (in case of duplicate handling)
              wildcardSubscriptions.delete(topic);
              
              // Now add the wildcard to the registry
              wildcardSubscriptions.add(topic);
              
              // Verify the wildcard was added correctly
              const isAdded = wildcardSubscriptions.has(topic);
              console.log(`✓ WILDCARD ADDED TO REGISTRY: ${topic} - Success: ${isAdded}`);
              console.log(`🔢 Total wildcards in registry: ${wildcardSubscriptions.size}`);
              
              // Log all wildcards in the registry for verification
              console.log(`📋 CURRENT WILDCARD REGISTRY:`);
              Array.from(wildcardSubscriptions).forEach(w => 
                console.log(`   - ${w}${w === topic ? ' (JUST ADDED)' : ''}`)
              );
              
              // Special handling and logging for country wildcards
              if (isCountryWildcard) {
                const countryCode = parts[2];
                console.log(`🌍 COUNTRY WILDCARD SUBSCRIPTION for ${countryCode}: ${topic}`);
                console.log(`Verified in wildcard registry: ${wildcardSubscriptions.has(topic)}`);
              }
              
              // Special handling for exchange wildcards
              if (isExchangeWildcard) {
                const exchange = parts[3];
                const country = parts[2];
                console.log(`🏢 EXCHANGE WILDCARD SUBSCRIPTION for ${country}/${exchange}: ${topic}`);
                console.log(`Verified in wildcard registry: ${wildcardSubscriptions.has(topic)}`);
              }
            } else {
              // For non-wildcard topics, check if already covered by a wildcard
              const isCoveredByWildcard = isTopicCoveredByWildcard(topic);
              if (isCoveredByWildcard) {
                console.log(`✓ Topic ${topic} is already covered by a wildcard subscription, no need for individual Solace subscription`);
              } else {
                console.log(`✗ Topic ${topic} is NOT covered by any wildcard, needs individual subscription`);
              }
            }
            
            // Add to client subscriptions regardless (for tracking)
            let clientSubs = clientSubscriptions.get(ws);
            if (!clientSubs) {
              clientSubs = new Set<string>();
              clientSubscriptions.set(ws, clientSubs);
            }
            clientSubs.add(topic);
            
            // If we have an active Solace connection, also subscribe to this topic there
            // ONLY if it's a wildcard OR not covered by an existing wildcard
            if (solaceService.isConnected()) {
              try {
                // For individual topics, check if already covered by wildcard
                if (!isWildcard && isTopicCoveredByWildcard(topic)) {
                  console.log(`Skipping Solace subscription for ${topic} - already covered by wildcard`);
                } else {
                  console.log(`Adding Solace subscription for topic: ${topic}`);
                  
                  // For wildcard topics, use special handling
                  if (isWildcard) {
                    console.log(`⭐⭐⭐ WILDCARD SUBSCRIPTION: Using wildcard session type for topic ${topic} ⭐⭐⭐`);
                    
                    // Parse topic pattern
                    const topicParts = topic.split('/');
                    const isCountryWildcard = topicParts.length === 4 && topicParts[3] === '>';
                    const isExchangeWildcard = topicParts.length === 5 && topicParts[4] === '>';
                    
                    // Better detection of country wildcards vs exchange wildcards
                    if (isCountryWildcard) {
                      console.log(`🌍 COUNTRY WILDCARD DETECTED: ${topic}`);
                      console.log(`This will cover ALL exchanges and stocks in the specified country`);
                      
                      // Extract the country code
                      const countryCode = topicParts[2];
                      console.log(`Country code extracted: ${countryCode}`);
                      
                      // Verify wildcard is already in registry from earlier processing
                      console.log(`Verifying country wildcard in registry: ${wildcardSubscriptions.has(topic)}`);
                      
                      // If not in registry (which shouldn't happen but let's be safe), add it now
                      if (!wildcardSubscriptions.has(topic)) {
                        console.log(`⚠️ Country wildcard ${topic} not found in registry - adding it now`);
                        wildcardSubscriptions.add(topic);
                      }
                    } 
                    else if (isExchangeWildcard) {
                      console.log(`🏢 EXCHANGE WILDCARD DETECTED: ${topic}`);
                      console.log(`This will cover all stocks in the specified exchange`);
                      
                      // Extract country and exchange from parts
                      const country = topicParts[2];
                      const exchange = topicParts[3];
                      console.log(`Country: ${country}, Exchange: ${exchange}`);
                      
                      // Verify wildcard is already in registry from earlier processing
                      console.log(`Verifying exchange wildcard in registry: ${wildcardSubscriptions.has(topic)}`);
                      
                      // If not in registry (which shouldn't happen but let's be safe), add it now
                      if (!wildcardSubscriptions.has(topic)) {
                        console.log(`⚠️ Exchange wildcard ${topic} not found in registry - adding it now`);
                        wildcardSubscriptions.add(topic);
                      }
                    }
                    
                    // Session management for different topic types
                    const sessionType = 
                      topic.includes('/NASDAQ/') ? 'NASDAQ' :
                      topic.includes('/NYSE/') ? 'NYSE' : 'default';
                    
                    console.log(`Using ${sessionType} session for topic ${topic}`);
                    
                    // Log the current wildcard registry state
                    console.log(`📋 Current wildcard registry (${wildcardSubscriptions.size} entries):`);
                    Array.from(wildcardSubscriptions).forEach(w => console.log(`   - ${w}`));
                  }
                  
                  solaceService.subscribe(topic, (message) => {
                    console.log(`Message received on Solace subscription for topic: ${topic}`);
                  }).catch(err => {
                    console.error(`Error subscribing to Solace topic ${topic}:`, err);
                  });
                }
              } catch (subError) {
                console.error(`Error subscribing to Solace topic ${topic}:`, subError);
              }
            } else {
              console.log(`Not subscribing to Solace topic ${topic} - no active Solace connection`);
            }
            
            // Log subscribed topics
            console.log(`Client now subscribed to topics: ${Array.from(clientSubs).join(', ')}`);
          }
          
          // Send acknowledgment
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'topic_subscription_ack',
              topic: data.topic,
              timestamp: new Date().toISOString()
            }));
          }
          
          // If the topic is for market data for indices, send them the current data
          if (data.topic.startsWith('market-data/') && 
              (data.topic.endsWith('SPX') || data.topic.endsWith('DJI') || data.topic.endsWith('NDX'))) {
            // Send the latest data for this index if available
            const symbol = data.topic.split('/').pop();
            
            // Use promise-based approach since we can't use await in this context
            storage.getStockBySymbol(symbol)
              .then(stock => {
                if (stock && stock.currentPrice !== null) {
                  const indexData = {
                    type: 'market-data',
                    topic: `market-data/${stock.symbol}`,
                    symbol: stock.symbol,
                    data: {
                      symbol: stock.symbol,
                      companyName: stock.companyName,
                      currentPrice: stock.currentPrice,
                      percentChange: stock.percentChange,
                      timestamp: new Date().toISOString()
                    },
                    timestamp: new Date().toISOString()
                  };
                  
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(indexData));
                    console.log(`Sent initial data for market index ${symbol} to new subscriber`);
                  }
                }
              })
              .catch(error => {
                console.error(`Error sending initial data for ${data.topic}:`, error);
              });
          }
        }
        
        // Handle topic-based unsubscriptions
        if (data.type === 'unsubscribe_topic' && data.topic) {
          const topic = data.topic;
          console.log(`Client unsubscribed from topic: ${topic}`);
          
          // Check if this is a wildcard topic
          const isWildcard = topic.includes('>');
          
          // Remove from client subscriptions
          const clientSubs = clientSubscriptions.get(ws);
          if (clientSubs) {
            clientSubs.delete(topic);
            console.log(`Client unsubscribed from ${topic}, remaining topics: ${Array.from(clientSubs).join(', ')}`);
            
            // If this was a wildcard topic and it's no longer in any client's subscriptions,
            // remove it from the wildcardSubscriptions collection too
            if (isWildcard) {
              let isStillSubscribed = false;
              clientSubscriptions.forEach((subs) => {
                if (subs.has(topic)) {
                  isStillSubscribed = true;
                }
              });
              
              if (!isStillSubscribed && wildcardSubscriptions.has(topic)) {
                console.log(`Removing wildcard topic ${topic} from wildcard registry as no clients are subscribed`);
                wildcardSubscriptions.delete(topic);
              }
            }
            
            // Check if any other clients are still subscribed to this topic
            let anyClientSubscribed = false;
            clientSubscriptions.forEach((topics) => {
              if (topics.has(topic)) {
                anyClientSubscribed = true;
              }
            });
            
            // If it's a wildcard and no one else is subscribed, remove from our wildcard tracking
            if (isWildcard && !anyClientSubscribed) {
              wildcardSubscriptions.delete(topic);
              console.log(`Removed wildcard topic from tracking: ${topic}`);
            }
            
            // If no other client is subscribed to this topic and we have a Solace connection,
            // unsubscribe from the Solace topic as well - BUT only if it's not covered by a wildcard
            if (!anyClientSubscribed && solaceService.isConnected()) {
              // For wildcard topics, always unsubscribe
              // For individual topics, only unsubscribe if not covered by a wildcard
              if (isWildcard || !isTopicCoveredByWildcard(topic)) {
                try {
                  console.log(`No clients left subscribed to ${topic}, unsubscribing from Solace topic`);
                  solaceService.unsubscribe(topic).catch(err => {
                    console.error(`Error unsubscribing from Solace topic ${topic}:`, err);
                  });
                } catch (unsubError) {
                  console.error(`Error unsubscribing from Solace topic ${topic}:`, unsubError);
                }
              } else {
                console.log(`Not unsubscribing from ${topic} on Solace - still covered by a wildcard subscription`);
              }
            }
          }
          
          // Send acknowledgment
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'topic_unsubscription_ack',
              topic: data.topic,
              timestamp: new Date().toISOString()
            }));
          }
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });
    
    // Handle disconnection
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      
      // Remove subscriptions for this client
      if (clientSubscriptions.has(ws)) {
        const subs = clientSubscriptions.get(ws);
        if (subs) {
          console.log(`Cleaning up ${subs.size} subscriptions for disconnected client`);
          
          // If we have an active Solace connection, clean up Solace subscriptions that are no longer needed
          if (solaceService.isConnected()) {
            // For each topic this client was subscribed to
            subs.forEach(topic => {
              // Check if any other clients are still subscribed to this topic
              let anyClientSubscribed = false;
              clientSubscriptions.forEach((topics, client) => {
                if (client !== ws && topics.has(topic)) {
                  anyClientSubscribed = true;
                }
              });
              
              // If no other client is subscribed, unsubscribe from Solace
              if (!anyClientSubscribed) {
                try {
                  console.log(`No clients left subscribed to ${topic} after disconnect, unsubscribing from Solace topic`);
                  solaceService.unsubscribe(topic).catch(err => {
                    console.error(`Error unsubscribing from Solace topic ${topic} during client disconnection:`, err);
                  });
                } catch (unsubError) {
                  console.error(`Error unsubscribing from Solace topic ${topic} during client disconnection:`, unsubError);
                }
              }
            });
          }
        }
        // Remove this client's subscriptions
        clientSubscriptions.delete(ws);
      }
      
      // Remove from local clients array
      const index = clients.indexOf(ws);
      if (index !== -1) {
        clients.splice(index, 1);
      }
      
      // Also remove from global clients array // REMOVED - globalClients is removed
      // const globalIndex = globalClients.indexOf(ws);
      // if (globalIndex !== -1) {
      //   globalClients.splice(globalIndex, 1);
      // }
      
      console.log(`Remaining WebSocket clients: ${clients.length}`);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket client error:', error);
    });
    
    // Send a welcome message
    if (ws.readyState === WebSocket.OPEN) {
      try {
        // 1. Send connection confirmation
        const welcomeMessage = { 
          type: 'connection', 
          message: 'Connected to WebSocket server',
          timestamp: new Date().toISOString()
        };
        ws.send(JSON.stringify(welcomeMessage));
        console.log('Sent welcome message to client');
        
        // No longer sending automatic test signals on connection
        // This ensures a cleaner experience and prevents confusion with test data
        // Test signals should only be sent via explicit test routes:
        // POST /api/test/signal
        // POST /api/test/signal-output
      } catch (error) {
        console.error('Error sending welcome message:', error);
      }
    }
  });
  
  // Route to get WebSocket client status
  app.get("/api/ws/status", async (_req: Request, res: Response) => {
    try {
      const activeClients = clients.filter(c => c.readyState === WebSocket.OPEN).length;
      const closingClients = clients.filter(c => c.readyState === WebSocket.CLOSING).length;
      const connectingClients = clients.filter(c => c.readyState === WebSocket.CONNECTING).length;
      const closedClients = clients.filter(c => c.readyState === WebSocket.CLOSED).length;
      
      res.json({
        success: true,
        status: {
          totalClients: clients.length,
          activeClients,
          closingClients,
          connectingClients,
          closedClients
        }
      });
    } catch (error) {
      console.error('Error getting WebSocket status:', error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to get WebSocket status"
      });
    }
  });
  
  // Route to get detailed subscription information for debugging
  app.get("/api/ws/subscriptions", async (_req: Request, res: Response) => {
    try {
      const wildcards = getWildcardSubscriptions();
      
      // Format client subscriptions for easier reading
      const formattedClientSubs: Record<string, string[]> = {};
      
      clientSubscriptions.forEach((topics, ws) => {
        // Use readyState as client ID since we can't expose the WebSocket object directly
        const clientId = `client_${ws.readyState}`;
        formattedClientSubs[clientId] = Array.from(topics);
      });
      
      // Set Content-Type explicitly to ensure the response is treated as JSON
      res.setHeader('Content-Type', 'application/json');
      
      res.json({
        success: true,
        clients_count: clients.length,
        wildcard_subscriptions: Array.from(wildcards),
        client_subscriptions: formattedClientSubs
      });
      
      // Log that we're sending the response
      console.log('Sending subscription details to client, wildcards:', Array.from(wildcards).length);
    } catch (error) {
      console.error('Error getting subscription details:', error);
      res.status(500).setHeader('Content-Type', 'application/json').json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to get subscription details"
      });
    }
  });
  
  // Test endpoint for wildcard subscription detection and handling
  app.post("/api/ws/test-wildcard", async (req: Request, res: Response) => {
    try {
      const { topic, isWildcard = true } = req.body;
      
      if (!topic) {
        return res.status(400).json({ error: "Topic parameter is required" });
      }
      
      console.log(`🧪 TEST WILDCARD ENDPOINT: Processing request for topic ${topic} with isWildcard=${isWildcard}`);
      
      // IMPROVED: First get a COPY of the current wildcard set to avoid interference
      const wildcardSet = new Set(getWildcardSubscriptions());
      console.log(`Current wildcard set size before test: ${wildcardSet.size}`);
      console.log(`Current wildcards: ${Array.from(wildcardSet).join(', ')}`);
      
      // Enhanced wildcard detection logic
      const parts = topic.split('/');
      const isCountryWildcard = parts.length === 4 && 
                              parts[0] === 'market-data' && 
                              parts[1] === 'EQ' && 
                              parts[3] === '>';
                              
      const isExchangeWildcard = parts.length === 5 && 
                               parts[0] === 'market-data' && 
                               parts[1] === 'EQ' && 
                               parts[4] === '>';
                               
      const topicHasWildcard = topic.includes('>');
      
      // Determine wildcard type for more specific handling
      let wildcardType = 'none';
      if (isCountryWildcard) wildcardType = 'country';
      else if (isExchangeWildcard) wildcardType = 'exchange';
      else if (topicHasWildcard) wildcardType = 'generic';
      
      // Log detection outcomes
      console.log(`🧪 TEST: Wildcard detection results for ${topic}:`);
      console.log(`  - Explicit isWildcard flag: ${isWildcard}`);
      console.log(`  - Topic includes '>': ${topicHasWildcard}`);
      console.log(`  - Country wildcard pattern match: ${isCountryWildcard}`);
      console.log(`  - Exchange wildcard pattern match: ${isExchangeWildcard}`);
      console.log(`  - Determined wildcard type: ${wildcardType}`);
      
      // Create test topics for coverage checking
      let testTopics: string[] = [];
      
      if (isCountryWildcard) {
        const countryCode = parts[2];
        // Create test topics for this country with different exchanges
        testTopics = [
          `market-data/EQ/${countryCode}/TSE/TESTSTOCK1`,
          `market-data/EQ/${countryCode}/NYSE/TESTSTOCK2`,
          `market-data/EQ/${countryCode}/NASDAQ/TESTSTOCK3`,
          `market-data/EQ/${countryCode}/LSE/TESTSTOCK4`,
          `market-data/EQ/${countryCode}/SGX/TESTSTOCK5`
        ];
      } else if (isExchangeWildcard) {
        const countryCode = parts[2];
        const exchange = parts[3];
        // Create test topics for this exchange with different stocks
        testTopics = [
          `market-data/EQ/${countryCode}/${exchange}/TESTSTOCK1`,
          `market-data/EQ/${countryCode}/${exchange}/TESTSTOCK2`,
          `market-data/EQ/${countryCode}/${exchange}/TESTSTOCK3`,
          `market-data/EQ/${countryCode}/${exchange}/STOCK.A`,
          `market-data/EQ/${countryCode}/${exchange}/STOCK.B`
        ];
      } else if (parts.length >= 5) {
        // It's a regular topic, test with variations around it
        const type = parts[0] || 'market-data';
        const assetClass = parts[1] || 'EQ';
        const country = parts[2] || 'US';
        const exchange = parts[3] || 'NYSE';
        const symbol = parts[4] || 'AAPL';
        
        // Test if it's covered by potential wildcards
        testTopics = [
          `${type}/${assetClass}/${country}/${exchange}/${symbol}`, // Original
          `${type}/${assetClass}/${country}/${exchange}/DIFFERENT`, // Different symbol
          `${type}/${assetClass}/${country}/DIFFERENT/${symbol}`,   // Different exchange
          `${type}/${assetClass}/DIFFERENT/${exchange}/${symbol}`   // Different country
        ];
      }
      
      // Test before adding to wildcards set
      const withoutAddingResults = testTopics.map(testTopic => {
        // For better diagnostics, log why each topic is or isn't matched
        const covered = isTopicCoveredByWildcard(testTopic);
        console.log(`Test topic ${testTopic} - covered by wildcard BEFORE adding: ${covered}`);
        
        return {
          topic: testTopic,
          covered
        };
      });
      
      // CRITICAL FIX: Only add to registry if it's a wildcard
      let addedToRegistry = false;
      if (isWildcard || wildcardType !== 'none') {
        console.log(`🧪 TEST: Adding topic ${topic} to global wildcard registry as type: ${wildcardType}`);
        
        // Remove any previous entry to avoid duplicates
        wildcardSubscriptions.delete(topic);
        
        // Add to the registry
        wildcardSubscriptions.add(topic);
        addedToRegistry = true;
        
        console.log(`After adding, wildcard registry size: ${wildcardSubscriptions.size}`);
        console.log(`Registry contents: ${Array.from(wildcardSubscriptions).join(', ')}`);
        console.log(`Confirmed topic in registry: ${wildcardSubscriptions.has(topic)}`);
      } else {
        console.log(`Topic ${topic} is not a wildcard, not adding to registry`);
      }
      
      // Test again with the wildcard added (if applicable)
      const withAddingResults = testTopics.map(testTopic => {
        // For better diagnostics, log why each topic is or isn't matched
        const covered = isTopicCoveredByWildcard(testTopic);
        console.log(`Test topic ${testTopic} - covered by wildcard AFTER adding: ${covered}`);
        
        return {
          topic: testTopic,
          covered
        };
      });
      
      // Now actively send the subscription to WebSocket clients
      console.log(`🧪 TEST: Sending wildcard test topic ${topic} with isWildcard=${isWildcard} to all connected clients`);
      
      // Count of clients that received the test
      let sentCount = 0;
      
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            const message = {
              type: 'subscribe_topic',
              topic,
              isWildcard, // IMPORTANT: Pass the explicit flag from request
              wildcardType, // Add the detected wildcard type for better client handling
              timestamp: new Date().toISOString(),
              direction: 'outgoing',
              isCriticalTest: true
            };
            
            console.log(`🧪 TEST: Sending test message to client:`, JSON.stringify(message));
            client.send(JSON.stringify(message));
            sentCount++;
          } catch (error) {
            console.error(`Error sending test message to client:`, error);
          }
        }
      });
      
      // Wait a bit to let subscription propagate
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get the updated wildcard set after the test
      const updatedWildcardSet = getWildcardSubscriptions();
      const wasAdded = updatedWildcardSet.has(topic);
      
      // Generate pattern variations for testing
      const patternVariations = [];
      if (isCountryWildcard && parts.length >= 3) {
        const countryCode = parts[2];
        patternVariations.push({
          type: 'country',
          pattern: `market-data/EQ/${countryCode}/>`,
          description: `All stocks in country ${countryCode}`
        });
      }
      
      if (isExchangeWildcard && parts.length >= 4) {
        const countryCode = parts[2];
        const exchange = parts[3];
        patternVariations.push({
          type: 'exchange',
          pattern: `market-data/EQ/${countryCode}/${exchange}/>`,
          description: `All stocks in ${exchange} exchange in ${countryCode}`
        });
      }

      // Check if each test topic is covered AFTER adding the wildcard
      const successfulMatches = withAddingResults.filter(result => result.covered).length;
      const totalTests = withAddingResults.length;
      
      // Calculate success percentage
      const successPercentage = totalTests > 0 ? Math.round((successfulMatches / totalTests) * 100) : 0;
      
      res.json({
        success: wasAdded,
        message: wasAdded ? 
          `Successfully added wildcard topic ${topic} to registry` : 
          `Failed to add wildcard topic ${topic} to registry`,
        topic,
        wildcardType,
        detectedPatterns: {
          isCountryWildcard,
          isExchangeWildcard,
          topicHasWildcard
        },
        registry: {
          size: updatedWildcardSet.size,
          contents: Array.from(updatedWildcardSet),
          wasAdded,
          topicInRegistry: updatedWildcardSet.has(topic)
        },
        testResults: {
          beforeAddingWildcard: withoutAddingResults,
          afterAddingWildcard: withAddingResults,
          successRate: {
            matches: successfulMatches,
            total: totalTests,
            percentage: successPercentage
          }
        },
        patternVariations,
        broadcastInfo: {
          clientCount: sentCount
        },
        status: wasAdded ? 'SUCCESS' : 'FAILURE: Wildcard not added to registry'
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Special diagnostic endpoint for testing wildcard topic coverage
  app.post("/api/ws/test-topic-coverage", async (req: Request, res: Response) => {
    try {
      const { topic } = req.body;
      
      if (!topic) {
        return res.status(400).json({ 
          success: false, 
          message: "Topic parameter is required" 
        });
      }
      
      console.log(`🔍 TESTING TOPIC COVERAGE for ${topic}`);
      
      // First, let's add a special debug helper function if it doesn't exist yet
      // Function to check if a topic is covered by any wildcards with detailed diagnostics
      function debugCheckTopicCoverage(topicToCheck: string): { 
        covered: boolean; 
        matchedBy?: string;
        matchType?: string;
        diagnostics: string[];
      } {
        const diagnostics: string[] = [];
        diagnostics.push(`Checking if topic ${topicToCheck} is covered by any wildcards`);
        
        // Basic validation
        if (!topicToCheck) {
          diagnostics.push(`Invalid topic: empty string`);
          return { covered: false, diagnostics };
        }
        
        // Check if we have any wildcards
        if (wildcardSubscriptions.size === 0) {
          diagnostics.push(`No wildcards registered in the system`);
          return { covered: false, diagnostics };
        }
        
        diagnostics.push(`Current wildcard registry (${wildcardSubscriptions.size} entries):`);
        Array.from(wildcardSubscriptions).forEach(w => {
          diagnostics.push(`  - ${w}`);
        });
        
        // Parse topic parts
        const parts = topicToCheck.split('/');
        if (parts.length < 5) {
          diagnostics.push(`Topic has invalid format (${parts.length} parts, expected ≥5)`);
          return { covered: false, diagnostics };
        }
        
        const [type, assetClass, country, exchange, symbol] = parts;
        diagnostics.push(`Topic breakdown: type=${type}, assetClass=${assetClass}, country=${country}, exchange=${exchange}, symbol=${symbol}`);
        
        // Check for country-level wildcard
        const countryWildcard = `${type}/${assetClass}/${country}/>`;
        if (wildcardSubscriptions.has(countryWildcard)) {
          diagnostics.push(`MATCH! Topic is covered by country wildcard: ${countryWildcard}`);
          return { 
            covered: true, 
            matchedBy: countryWildcard,
            matchType: 'country',
            diagnostics 
          };
        }
        
        // Check for exchange-level wildcard
        const exchangeWildcard = `${type}/${assetClass}/${country}/${exchange}/>`;
        if (wildcardSubscriptions.has(exchangeWildcard)) {
          diagnostics.push(`MATCH! Topic is covered by exchange wildcard: ${exchangeWildcard}`);
          return { 
            covered: true, 
            matchedBy: exchangeWildcard,
            matchType: 'exchange',
            diagnostics 
          };
        }
        
        // Try a more dynamic approach
        for (const wildcardPattern of wildcardSubscriptions) {
          diagnostics.push(`Checking against wildcard: ${wildcardPattern}`);
          
          const wildcardParts = wildcardPattern.split('/');
          
          // Check for country-level wildcard match
          const isCountryWildcardMatch = 
            wildcardParts.length === 4 &&
            wildcardParts[0] === type &&
            wildcardParts[1] === assetClass &&
            wildcardParts[2] === country &&
            wildcardParts[3] === '>';
            
          if (isCountryWildcardMatch) {
            diagnostics.push(`MATCH! Topic matches country wildcard pattern ${wildcardPattern}`);
            return { 
              covered: true, 
              matchedBy: wildcardPattern, 
              matchType: 'country',
              diagnostics 
            };
          }
          
          // Check for exchange-level wildcard match
          const isExchangeWildcardMatch =
            wildcardParts.length === 5 &&
            wildcardParts[0] === type &&
            wildcardParts[1] === assetClass &&
            wildcardParts[2] === country &&
            wildcardParts[3] === exchange &&
            wildcardParts[4] === '>';
            
          if (isExchangeWildcardMatch) {
            diagnostics.push(`MATCH! Topic matches exchange wildcard pattern ${wildcardPattern}`);
            return { 
              covered: true, 
              matchedBy: wildcardPattern,
              matchType: 'exchange',
              diagnostics 
            };
          }
        }
        
        diagnostics.push(`No matching wildcard pattern found for topic ${topicToCheck}`);
        return { covered: false, diagnostics };
      }
      
      // Now use our debug function to check the topic
      const result = debugCheckTopicCoverage(topic);
      
      // Run the standard isTopicCoveredByWildcard function for comparison
      const standardResult = isTopicCoveredByWildcard(topic);
      
      // Check if there's a discrepancy between the two functions
      const discrepancy = result.covered !== standardResult;
      
      if (discrepancy) {
        console.warn(`⚠️ DISCREPANCY DETECTED: Debug helper says ${result.covered} but standard function says ${standardResult}`);
      }
      
      // Return the results
      return res.json({
        success: true,
        topic,
        debugResult: result,
        standardResult,
        discrepancy,
        wildcardRegistry: {
          size: wildcardSubscriptions.size,
          contents: Array.from(wildcardSubscriptions)
        }
      });
    } catch (error) {
      console.error(`Error in test-topic-coverage:`, error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error testing topic coverage',
        error: String(error)
      });
    }
  });

  // Test endpoint to directly send messages via WebSocket
  app.post("/api/ws/test-signal", async (req: Request, res: Response) => {
    try {
      const symbol = req.body.symbol;
      if (!symbol) {
        return res.status(400).json({ message: "Symbol is required" });
      }
      
      const signal = req.body.signal || "BUY";
      const confidence = parseFloat(req.body.confidence) || 0.85;
      const content = req.body.content || 
        `${symbol} is showing strong momentum based on direct WebSocket test. #${symbol}`;
      
      // Format the message as signal/output
      const message = {
        type: "signal/output",
        symbol,
        data: {
          symbol,
          companyName: symbol === 'AAPL' ? 'Apple Inc.' : 
                      symbol === 'MSFT' ? 'Microsoft Corporation' : 
                      symbol === 'GOOG' ? 'Alphabet Inc.' : 
                      symbol === 'AMZN' ? 'Amazon.com Inc.' : 'Unknown Company',
          signal,
          confidence,
          content,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };
      
      console.log(`Sending test signal/output message: ${JSON.stringify(message, null, 2)}`);
      
      // Send to all clients
      let sentCount = 0;
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
          sentCount++;
        }
      });
      
      res.json({
        success: true,
        message: `Test signal sent to ${sentCount} WebSocket clients`,
        details: message
      });
    } catch (error) {
      console.error('Error sending test signal:', error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to send test signal"
      });
    }
  });
  
  // Get available stocks
  app.get("/api/stocks/available", async (_req: Request, res: Response) => {
    try {
      const stocks = await storage.getAvailableStocks();
      res.json(stocks);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch available stocks" 
      });
    }
  });

  // Mock mode endpoint removed - real Solace connection required
  app.post("/api/solace/mock", async (_req: Request, res: Response) => {
    // Mock mode has been disabled - inform clients that real connection is required
    res.status(400).json({
      success: false,
      message: "Mock mode has been removed. Please use a real Solace connection."
    });
  });
  
  // Add an endpoint to check Solace connection status
  app.get("/api/solace/status", async (_req: Request, res: Response) => {
    try {
      // Get real status from services - use isConnected for backwards compatibility
      const frontendConnected = solaceService.isConnected();
      const publisherStatus = publisherSolaceService.getConnectionStatus();
      
      // Get additional frontend connection details if available
      let frontendConnecting = false;
      let frontendConfig = null;
      
      // Use the new getConnectionStatus method if it exists
      try {
        const solaceStatus = solaceService.getConnectionStatus();
        frontendConnecting = solaceStatus.connecting;
        frontendConfig = solaceStatus.currentConfig;
      } catch (e) {
        console.log("Legacy solaceService doesn't have getConnectionStatus method, using fallback");
      }
      
      // Get the complete solace status
      let solaceStatus = null;
      try {
        solaceStatus = solaceService.getConnectionStatus();
      } catch (e) {
        console.log("Could not get detailed solace status");
      }
      
      // Prepare the detailed connection status info for each service
      const frontendStatus = {
        connected: frontendConnected,
        connecting: frontendConnecting,
        currentConfig: frontendConfig,
        tcpPort: solaceStatus?.tcpPort || "55555",
        lastError: solaceStatus?.lastError || "",
        // Add these properties to match the other services' structure
        feedActive: false,
        feedStarting: false
      };
      
      return res.status(200).json({
        success: true,
        // Include original fields for backward compatibility
        frontend: frontendConnected,
        publisher: publisherStatus.connected,
        connecting: frontendConnecting || publisherStatus.connecting,
        publisherTcpPort: publisherStatus.tcpPort || "55555",
        lastError: publisherStatus.lastError || "",
        
        // Include detailed status info for each service
        connectionStatus: frontendStatus,
        publisherStatus: publisherStatus
      });
    } catch (error) {
      console.error("Error checking Solace status:", error);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/solace/connect", async (req: Request, res: Response) => {
    try {
      const validatedData = solaceConnectionSchema.parse(req.body);
      const configType = validatedData.configType || 'frontend';
      
      console.log(`Received Solace connection request with configType: ${configType}`);
      
      // Only deactivate configs of the same type
      if (configType === 'frontend') {
        await storage.deactivateConfigsByType('frontend');
      } else if (configType === 'backend') {
        await storage.deactivateConfigsByType('backend');
      }
      
      // Store the connection in database as active
      const config = await storage.createSolaceConfig({
        ...validatedData,
        isActive: true
      });
      
      if (configType === 'frontend') {
        // For frontend, connect the user-facing Solace service
        console.log("Connecting frontend Solace service...");
        await solaceService.connect(validatedData);
        console.log(`Successfully connected frontend to Solace broker at ${validatedData.brokerUrl}`);
        
        // ****** NEW CODE START ******
        // Establish initial server-side Solace subscriptions
        console.log("Establishing initial server-side Solace subscriptions...");
        for (const initialTopic of initialSolaceSubscriptions) {
          try {
            await solaceService.subscribe(initialTopic, (message) => {
              // The global onMessage handler in solaceService will process this.
              // No need for specific logic here, but can add debug log if needed.
              // console.log(`[InitialSub] Message on ${initialTopic}:`, message);
            });
            console.log(`Successfully subscribed to initial Solace topic: ${initialTopic}`);
          } catch (subError) {
            console.error(`Error subscribing to initial Solace topic ${initialTopic}:`, subError);
          }
        }
        console.log("Initial server-side Solace subscriptions established.");
        // ****** NEW CODE END ******
        
        // Set up global message handler to relay Solace messages to WebSocket clients
        // REMOVING this redundant assignment of solaceService.onMessage
        /* 
        solaceService.onMessage = (topic, message) => {
          console.log(`Solace message received for topic ${topic}, forwarding to WebSocket clients`);
          
          // Create raw data string for debug panel if not already present
          const rawData = typeof message === 'object' ? JSON.stringify(message) : String(message);
          
          // Format the message for WebSocket clients
          const formattedMessage = {
            type: topic.includes('market-data') ? 'market-data' : 
                  topic.includes('twitter-feed') ? 'twitter-feed' : 
                  topic.includes('trading-signal') ? 'trading-signal' : 
                  topic,
            topic: topic,
            symbol: message.symbol || '',
            data: message,
            timestamp: new Date().toISOString(),
            rawData: rawData,
            direction: 'incoming' // Mark as incoming message for debug panel
          };
          
          // Broadcast to WebSocket clients subscribed to this topic
          broadcastToWebSocketSubscribers(topic, formattedMessage);
        };
        */
        
        // When connecting to Solace, don't start any simulations automatically
        // All simulations will be started when user explicitly selects stocks
        console.log("Connected to Solace broker - simulations will start only when user selects stocks");
        
        // We only initialize basic connection data and market structure
        // No data publishing for any stocks or indices until explicitly requested
        
        // Reset all simulation state
        await marketDataService.stopSimulation();
        // Twitter feed is now browser-native via TrafficGeneratorPanel
        // News feed and economic indicators removed as requested
        // await newsService.stopSimulation();
        // await economicIndicatorService.stopSimulation();
        
        // Now that we're connected to Solace, subscribe to all topics that clients have requested
        console.log("Syncing WebSocket client subscriptions with Solace connection");
        try {
          // Get all unique topics across all clients
          const allTopics = new Set<string>();
          clientSubscriptions.forEach(topics => {
            topics.forEach(topic => allTopics.add(topic));
          });
          
          if (allTopics.size > 0) {
            // First identify and subscribe to all wildcard topics
            const wildcardTopics = Array.from(allTopics).filter(topic => topic.includes('>'));
            
            if (wildcardTopics.length > 0) {
              console.log(`Found ${wildcardTopics.length} wildcard topics to subscribe to first: ${wildcardTopics.join(', ')}`);
              
              // Clear and rebuild the wildcard tracking set
              wildcardSubscriptions.clear();
              
              // Subscribe to all wildcard topics first
              for (const wildcardTopic of wildcardTopics) {
                try {
                  // Add to our wildcard tracking
                  wildcardSubscriptions.add(wildcardTopic);
                  
                  // Check for country wildcards specifically
                  if (wildcardTopic.match(/market-data\/EQ\/[A-Z]{2}\/>/)) {
                    const countryCode = wildcardTopic.split('/')[2];
                    console.log(`🌍🌍🌍 COUNTRY WILDCARD: Found country wildcard for ${countryCode}: ${wildcardTopic}`);
                    console.log(`This country wildcard will cover ALL exchanges and stocks in ${countryCode}`);
                  }
                  
                  // Subscribe to the wildcard topic
                  await solaceService.subscribe(wildcardTopic, (message) => {
                    console.log(`Message received on Solace subscription for wildcard topic: ${wildcardTopic}`);
                    // The global message handler will handle broadcasting
                  });
                  console.log(`Successfully subscribed to wildcard Solace topic: ${wildcardTopic}`);
                } catch (subError) {
                  console.error(`Error subscribing to wildcard Solace topic ${wildcardTopic}:`, subError);
                }
              }
            }
            
            // Now subscribe to individual topics not covered by wildcards
            const individualTopics = Array.from(allTopics).filter(topic => !topic.includes('>'));
            
            // Count how many topics will be skipped due to wildcard coverage
            let skippedCount = 0;
            let subscribedCount = 0;
            
            console.log(`Processing ${individualTopics.length} individual topics`);
            for (const topic of individualTopics) {
              try {
                // Check if this topic is covered by a wildcard subscription
                if (isTopicCoveredByWildcard(topic)) {
                  console.log(`Skipping Solace subscription for ${topic} - already covered by wildcard`);
                  skippedCount++;
                } else {
                  // Subscribe to the individual topic
                  await solaceService.subscribe(topic, (message) => {
                    console.log(`Message received on Solace subscription for ${topic}`);
                    // The global message handler will handle broadcasting
                  });
                  console.log(`Successfully subscribed to individual Solace topic: ${topic}`);
                  subscribedCount++;
                }
              } catch (subError) {
                console.error(`Error subscribing to Solace topic ${topic}:`, subError);
              }
            }
            
            console.log(`Subscription optimization: ${skippedCount} topics skipped (covered by wildcards), ${subscribedCount} individual topics subscribed`);
          } else {
            console.log("No client topic subscriptions to sync with Solace");
          }
        } catch (syncError) {
          console.error("Error syncing client subscriptions with Solace:", syncError);
        }
        
        // Send connection notification but NOT on signal/output topic
        try {
          await solaceService.publish('connection/status', {
            status: 'CONNECTED',
            message: 'Successfully connected to Solace',
            timestamp: new Date().toISOString()
          });
          console.log("Connection status message published to Solace successfully");
        } catch (err) {
          console.error("Failed to publish connection status to Solace", err);
        }
        
        res.json({ 
          success: true, 
          config,
          status: {
            frontend: solaceService.isConnected() ? 'connected' : 'disconnected'
          }
        });
      } 
      else if (configType === 'backend') {
        // For backend, connect the publisher services
        console.log("Connecting backend publisher services...");
        let marketDataPublisherConnected = false;
        let twitterPublisherConnected = false;
        let marketDataPublisherStatus = null;
        let twitterPublisherStatus = null;
        
        try {
          console.log("Connecting market data publisher to Solace...");
          await publisherSolaceService.connect(validatedData);
          console.log("Market data publisher connected successfully");
          marketDataPublisherConnected = true;
          marketDataPublisherStatus = publisherSolaceService.getConnectionStatus();
          
          // Don't automatically activate the market data feed
          // This will be done explicitly by the user via the market-data-feed/start endpoint
          console.log("Market data publisher connected but feed not activated yet. User must activate manually.");
        } catch (publisherError) {
          console.error("Error connecting market data publisher:", publisherError);
          // Still get the status even if connection failed
          marketDataPublisherStatus = publisherSolaceService.getConnectionStatus();
        }
        
        // Twitter feed is now browser-native via TrafficGeneratorPanel
        
        // Return detailed status information
        res.json({ 
          success: marketDataPublisherConnected, 
          message: marketDataPublisherConnected 
            ? "Successfully connected market data publisher to Solace"
            : "Failed to connect market data publisher to Solace",
          config,
          status: {
            backend: {
              marketDataPublisher: marketDataPublisherConnected ? 'connected' : 'disconnected',
            }
          },
          // Include detailed status for monitoring
          marketDataPublisherStatus
        });
      } else {
        // Unknown config type
        res.status(400).json({ 
          success: false,
          message: `Unknown configuration type: ${configType}` 
        });
      }
    } catch (error) {
      console.error("Error connecting to Solace:", error);
      res.status(400).json({ 
        success: false,
        message: error instanceof Error ? error.message : "Invalid connection details" 
      });
    }
  });

  // Disconnect from Solace broker
  app.post("/api/solace/disconnect", async (_req: Request, res: Response) => {
    try {
      console.log("Received disconnect request, stopping all services first");
      
      // Stop all simulation services before disconnecting
      try {
        // Stop in a specific order to ensure clean shutdown
        await marketDataService.stopSimulation();
        // Twitter feed is now browser-native via TrafficGeneratorPanel
        // News feed and economic indicators removed as requested
        // await newsService.stopSimulation();
        // await economicIndicatorService.stopSimulation();
        await llmService.stopSignalGeneration();
        
        console.log("All simulation services stopped successfully");
      } catch (serviceError) {
        console.error("Error stopping simulation services:", serviceError);
        // Continue with disconnection even if services fail to stop
      }
      
      // Also disconnect publisher services before main Solace connection
      try {
        console.log("Disconnecting market data publisher service...");
        await publisherSolaceService.disconnect();
        console.log("Market data publisher disconnected successfully");
      } catch (publisherError) {
        console.error("Error disconnecting market data publisher:", publisherError);
        // Continue with disconnection even if publisher service fails to disconnect
      }
      
      // Disconnect main Solace connection with a timeout to prevent hanging
      const disconnectPromise = solaceService.disconnect();
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("Solace disconnect timeout")), 5000);
      });
      
      await Promise.race([disconnectPromise, timeoutPromise]);
      
      console.log("Successfully disconnected from all Solace connections");
      res.json({ success: true });
    } catch (error) {
      console.error("Error during Solace disconnection:", error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to disconnect from Solace broker",
        success: false
      });
    }
  });
  
  // Endpoint to unsubscribe from a Solace topic (especially for wildcards)
  app.post("/api/solace/unsubscribe", async (req: Request, res: Response) => {
    try {
      const { topic } = req.body;
      
      if (!topic) {
        return res.status(400).json({ success: false, error: "Topic is required" });
      }
      
      console.log(`API request to unsubscribe from Solace topic: ${topic}`);
      
      // Check if the topic is a wildcard
      const isWildcard = topic.includes('>');
      
      // For wildcard topics, we need to be more careful
      if (isWildcard) {
        console.log(`Unsubscribing from wildcard topic: ${topic}`);
        
        // Check if this topic is actually covered by another wildcard
        const isCovered = isTopicCoveredByWildcard(topic);
        console.log(`Topic ${topic} covered by another wildcard: ${isCovered}`);
        
        // If not covered by another wildcard, unsubscribe from Solace
        if (!isCovered && solaceService.isConnected()) {
          try {
            await solaceService.unsubscribe(topic);
            console.log(`Successfully unsubscribed from Solace wildcard topic: ${topic}`);
          } catch (unsubError) {
            console.error(`Error unsubscribing from Solace topic ${topic}:`, unsubError);
          }
        }
        
        // Always remove from wildcard registry to ensure UI consistency
        if (wildcardSubscriptions.has(topic)) {
          console.log(`Removing wildcard topic ${topic} from wildcard registry`);
          wildcardSubscriptions.delete(topic);
        }
      } else {
        // For individual topics, it's simpler
        if (solaceService.isConnected()) {
          try {
            await solaceService.unsubscribe(topic);
            console.log(`Successfully unsubscribed from Solace topic: ${topic}`);
          } catch (unsubError) {
            console.error(`Error unsubscribing from Solace topic ${topic}:`, unsubError);
          }
        }
      }
      
      // Send server-side acknowledgment to all connected clients
      broadcastToWebSockets({
        type: 'topic_unsubscription_ack',
        topic: topic,
        timestamp: new Date().toISOString()
      });
      
      res.json({ success: true, message: `Unsubscribed from topic: ${topic}` });
    } catch (error) {
      console.error("Error unsubscribing from Solace topic:", error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error while unsubscribing" 
      });
    }
  });
  
  // Market data feed control endpoints
  app.post("/api/market-data-feed/start", async (req: Request, res: Response) => {
    try {
      // Extract symbols from request body, default to empty array if not provided
      const symbols = req.body.symbols && Array.isArray(req.body.symbols) ? req.body.symbols : [];
      console.log(`/api/market-data-feed/start called with ${symbols.length} symbols: ${symbols.join(', ')}`);

      // Fast check for connection status
      const publisherConnected = publisherSolaceService.isConnected();
      const frontendConnected = solaceService.isConnected();
      
      // Immediately start feed regardless of connection status to provide instant feedback
      let feedResult;
      
      if (publisherConnected) {
        // For connected publishers, call startFeed and await its result, passing symbols
        feedResult = await publisherSolaceService.startFeed(); 
        
        // For macOS, force feed activation (this might be redundant now with changes in startFeed)
        // Consider reviewing if this is still necessary or if startFeed handles it sufficiently.
        if (process.platform === 'darwin') {
          publisherSolaceService.setFeedActive(true);
          // Update feedResult if setFeedActive changes state, or rely on startFeed's returned state.
          // For now, let's assume startFeed's result is authoritative after await.
          feedResult = { success: true, feedActive: publisherSolaceService.isFeedActive(), connected: true };
        }
      } else {
        // If not connected, prepare a pending result
        feedResult = { success: false, feedActive: false, connected: false, pending: true };
        
        // Start connection in background without blocking response
        setTimeout(() => {
          (async () => { // Wrap in async IIFE to use await
          try {
            // Import the helper function lazily to avoid startup delays
            const { ensureMarketDataPublisherConnected } = require('./services/marketDataPublisherConnect');
            
            // Connect and start feed in background
              const connectionResult = await ensureMarketDataPublisherConnected(); // MODIFIED: Added await
                if (connectionResult) {
                // Pass symbols here as well if connecting and starting in background
                await publisherSolaceService.startFeed(); 
                }
            } catch (connectionError) {
                console.error("Background connection error:", connectionError);
          }
          })().catch(error => console.error("Error in background async task wrapper:", error));
        }, 10); // Start background task after 10ms
      }
      
      // Respond immediately to client for better responsiveness
      // This response might be sent before the background connection/feed start completes.
      // The ERR_HTTP_HEADERS_SENT was due to a second response from this *same* route handler
      // after an error in a setTimeout. Awaiting startFeed() directly should prevent that.
      res.json({
        success: publisherConnected, // This reflects the initial connection state
        message: publisherConnected 
          ? "Market data feed started successfully" 
          : "Market data feed starting in background",
        status: feedResult // This feedResult is from the initial synchronous part
      });
      
      // The following section seems to attempt a *second* response, which was the core issue.
      // If `res.json` above is the intended immediate response, this section should be removed or reworked.
      // For now, I will comment it out as it's highly suspect for causing ERR_HTTP_HEADERS_SENT.

      /*
      // Get the latest status and check if feed is active
      const publisherStatus = publisherSolaceService.getConnectionStatus();
      console.log("Current publisher status:", publisherStatus);
      
      // Ensure the feed is now active
      const isFeedActive = publisherStatus.feedActive;
      console.log(`Feed active status after startFeed(): ${isFeedActive}`, publisherStatus);
      
      const response = {
        success: true,
        message: publisherConnected 
          ? "Market data feed started successfully using dedicated publisher" 
          : frontendConnected
            ? "Market data feed started successfully using frontend connection"
            : "Market data feed activated, but no Solace connection available yet. Data will be published when connected.",
        publisherStatus,
        feedActive: isFeedActive, // Explicit feedActive flag for frontend compatibility
        connectionAvailable: publisherConnected || frontendConnected
      };
      
      console.log("Market data feed start API response:", {
        success: true,
        feedActive: isFeedActive,
        publisherStatus: {
          ...publisherStatus,
          feedActive: publisherStatus.feedActive // Log the nested feedActive flag too
        }
      });
      
      console.log("Sending response:", response);
      return res.status(200).json(response); // THIS IS THE LIKELY CULPRIT OF THE DOUBLE RESPONSE
      */
    } catch (error) {
      console.error("Error starting market data feed:", error);
      // Ensure headers are not already sent before sending an error response
      if (!res.headersSent) {
      return res.status(500).json({ success: false, message: "Internal server error" });
      }
    }
  });
  
  app.post("/api/market-data-feed/stop", async (_req: Request, res: Response) => {
    try {
      // Stop the market data feed using the dedicated stop method
      const feedResult = publisherSolaceService.stopFeed();
      const publisherStatus = publisherSolaceService.getConnectionStatus();
      
      // Log clear confirmation message with status details
      console.log("Market data feed stopped - Feed active:", feedResult.feedActive);
      
      const response = {
        success: true,
        message: "Market data feed stopped successfully",
        publisherStatus,
        feedActive: feedResult.feedActive // Explicit feedActive flag for frontend compatibility
      };
      
      console.log("Market data feed stop API response:", {
        success: true,
        feedActive: feedResult.feedActive,
        publisherStatus: {
          ...publisherStatus,
          feedActive: publisherStatus.feedActive
        }
      });
      
      return res.status(200).json(response);
    } catch (error) {
      console.error("Error stopping market data feed:", error);
      
      // Even if there's an error, try to stop the feed
      publisherSolaceService.setFeedActive(false);
      const publisherStatus = publisherSolaceService.getConnectionStatus();
      
      const response = {
        success: true,
        message: "Market data feed stopped with warnings",
        publisherStatus,
        feedActive: false, // Force feedActive to false in error case
        warnings: error instanceof Error ? error.message : "Unknown error"
      };
      
      console.log("Market data feed stop API response (with warnings):", {
        success: true,
        feedActive: false,
        publisherStatus: {
          ...publisherStatus,
          feedActive: publisherStatus.feedActive
        }
      });
      
      return res.status(200).json(response);
    }
  });
  
  // API endpoint for configuring market data feed options (including frequency)
  app.post("/api/market-data-feed/message-options", async (req: Request, res: Response) => {
    try {
      console.log("API: Market data feed message options request received:", req.body);
      
      const { frequency, frequencyMs: explicitFrequencyMs, deliveryMode, allowMessageEliding, dmqEligible } = req.body;
      let changesApplied = false;
      let messageDetails = [];
      
      // Handle frequency setting if provided
      if (frequency !== undefined || explicitFrequencyMs !== undefined) {
        // First check if we have explicitFrequencyMs, as it takes precedence
        let frequencyMs: number;
        let reportedFrequency: number;
        
        if (explicitFrequencyMs !== undefined) {
          // Validate millisecond frequency (e.g., 10ms to 60000ms)
          if (typeof explicitFrequencyMs !== 'number' || explicitFrequencyMs < 10 || explicitFrequencyMs > 60000) {
            return res.status(400).json({
              success: false,
              message: "Invalid frequencyMs. Must be a number between 10 and 60000 milliseconds for market data feed"
            });
          }
          frequencyMs = explicitFrequencyMs;
          reportedFrequency = Math.round(frequencyMs / 1000); // For display purposes
          console.log(`API: Using explicit millisecond frequency: ${frequencyMs}ms (approx. ${reportedFrequency}s)`);
        } else {
          // Validate seconds-based frequency
          if (typeof frequency !== 'number' || frequency < 1 || frequency > 3600) {
            return res.status(400).json({
              success: false,
              message: "Invalid frequency. Must be a number between 1 and 3600 seconds"
            });
          }
          
          // Convert frequency from seconds to milliseconds
          frequencyMs = frequency * 1000;
          reportedFrequency = frequency;
        }
        
        console.log(`API: Setting market data update frequency to ${reportedFrequency} seconds (${frequencyMs}ms)`);
        
        // Update the market data service frequency using the millisecond method if available
        if (marketDataService.setUpdateFrequencyMs) {
          marketDataService.setUpdateFrequencyMs(frequencyMs);
          changesApplied = true;
          messageDetails.push(`frequency updated to ${reportedFrequency} seconds (${frequencyMs}ms)`);
        } else if (marketDataService.setUpdateFrequency) {
          // Fall back to seconds-based method if needed
          marketDataService.setUpdateFrequency(reportedFrequency);
          changesApplied = true;
          messageDetails.push(`frequency updated to ${reportedFrequency} seconds`);
        } else {
          console.warn("Warning: marketDataService frequency update methods are not available");
        }
        
        // Also update in the publisher service if available
        if (publisherSolaceService.setUpdateFrequencyMs) {
          publisherSolaceService.setUpdateFrequencyMs(frequencyMs);
          console.log(`Updated publisherSolaceService frequency to ${frequencyMs}ms`);
        } else if (publisherSolaceService.setUpdateFrequency) {
          publisherSolaceService.setUpdateFrequency(reportedFrequency);
          console.log(`Updated publisherSolaceService frequency to ${reportedFrequency}s`);
        } else {
          console.warn("Warning: publisherSolaceService frequency update methods are not available");
        }
      } else {
        console.log("API: No frequency provided in request, skipping frequency update");
      }
      
      // Handle message delivery options if any provided
      if (deliveryMode !== undefined || allowMessageEliding !== undefined || dmqEligible !== undefined) {
        const messageOptions: any = {};
        
        if (deliveryMode !== undefined) {
          if (deliveryMode !== "DIRECT" && deliveryMode !== "PERSISTENT") {
            return res.status(400).json({
              success: false,
              message: "Invalid deliveryMode. Must be 'DIRECT' or 'PERSISTENT'"
            });
          }
          messageOptions.deliveryMode = deliveryMode;
          messageDetails.push(`delivery mode set to ${deliveryMode}`);
        }
        
        if (allowMessageEliding !== undefined) {
          // Accept string representations of booleans to be more flexible
          if (typeof allowMessageEliding !== 'boolean' && 
              !(typeof allowMessageEliding === 'string' && 
                (allowMessageEliding.toLowerCase() === 'true' || 
                 allowMessageEliding.toLowerCase() === 'false'))) {
            return res.status(400).json({
              success: false,
              message: "Invalid allowMessageEliding. Must be a boolean value or 'true'/'false' string"
            });
          }
          // Convert string 'true'/'false' to actual boolean
          const allowMsgElidingBool = typeof allowMessageEliding === 'string' ? 
            allowMessageEliding.toLowerCase() === 'true' : Boolean(allowMessageEliding);
            
          messageOptions.allowMessageEliding = allowMsgElidingBool;
          messageDetails.push(`message eliding ${allowMsgElidingBool ? 'enabled' : 'disabled'}`);
        }
        
        if (dmqEligible !== undefined) {
          // Accept string representations of booleans to be more flexible
          if (typeof dmqEligible !== 'boolean' && 
              !(typeof dmqEligible === 'string' && 
                (dmqEligible.toLowerCase() === 'true' || 
                 dmqEligible.toLowerCase() === 'false'))) {
            return res.status(400).json({
              success: false,
              message: "Invalid dmqEligible. Must be a boolean value or 'true'/'false' string"
            });
          }
          
          // Convert string 'true'/'false' to actual boolean
          const dmqEligibleBool = typeof dmqEligible === 'string' ? 
            dmqEligible.toLowerCase() === 'true' : Boolean(dmqEligible);
            
          messageOptions.dmqEligible = dmqEligibleBool;
          messageDetails.push(`DMQ eligibility ${dmqEligibleBool ? 'enabled' : 'disabled'}`);
        }
        
        if (Object.keys(messageOptions).length > 0) {
          console.log("Applying QoS settings to publisher service:", messageOptions);
          // Make explicit QoS options call with await to ensure it completes
          const qosSuccess = await publisherSolaceService.setMessageOptions(messageOptions);
          if (qosSuccess) {
            console.log("Successfully applied QoS settings to Market Data publisher");
            changesApplied = true;
          } else {
            console.error("Failed to apply QoS settings to Market Data publisher:", messageOptions);
            return res.status(500).json({
              success: false,
              message: "Failed to apply QoS settings to Market Data publisher"
            });
          }
        }
      }
      
      // Get current status to include in response
      const currentPublisherStatus = publisherSolaceService.getConnectionStatus();
      // Ensure frequencyMs is part of the publisherStatus in the response
      const publisherStatusForResponse = {
        ...currentPublisherStatus,
        frequencyMs: currentPublisherStatus.updateFrequency !== undefined ? currentPublisherStatus.updateFrequency * 1000 : undefined,
      };

      // Get the update frequency directly from the publisher service status
      const marketDataStatus = { 
        updateFrequency: currentPublisherStatus.updateFrequency
      };
      
      // Prepare response message
      let responseMessage;
      if (changesApplied) {
        responseMessage = `Successfully updated market data settings: ${messageDetails.join(", ")}`;
      } else {
        responseMessage = "No changes applied to market data settings";
      }
      
      // Safely extract update frequency values, with fallbacks
      const getUpdateFrequency = (status: any) => {
        return typeof status === 'object' && status !== null ? 
              (status.frequency || status.updateFrequency || null) : null;
      };
      
      // Use provided values first, then try to get from service status
      const responseFrequency = frequency !== undefined ? frequency : 
                              (getUpdateFrequency(marketDataStatus) || 
                               getUpdateFrequency(currentPublisherStatus) || "unchanged");
      
      // For millisecond precision, use explicit value if provided, otherwise calculate from seconds or use existing ms value
      const responseFrequencyMs = explicitFrequencyMs !== undefined ? explicitFrequencyMs : 
                                (frequency !== undefined ? frequency * 1000 : 
                                 (typeof responseFrequency === 'number' ? responseFrequency * 1000 : 
                                  (publisherStatusForResponse.frequencyMs !== undefined ? publisherStatusForResponse.frequencyMs : "unchanged")));
      
      // Prepare response
      const response = {
        success: true,
        message: responseMessage,
        publisherStatus: publisherStatusForResponse, // Use the modified status object
        marketDataStatus,
        frequency: responseFrequency,
        frequencyMs: responseFrequencyMs,
        messageOptions: currentPublisherStatus.messageOptions
      };
      
      console.log("Market data feed message-options API response:", response);
      return res.status(200).json(response);
    } catch (error) {
      console.error("Error configuring market data feed message options:", error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Internal server error configuring market data feed"
      });
    }
  });

  // Start data simulation
  app.post("/api/simulation/start", async (req: Request, res: Response) => {
    try {
      // Check if Solace is connected (needed for market data)
      const solaceConnected = solaceService.isConnected();
      let marketDataStarted = false;
      let twitterFeedStarted = false;
      let signalDataStarted = false;
      let responseMessage = "";
      
      // Validate request (with more lenient error handling)
      let symbols: string[] = [];
      let subscription = { 
        marketData: true, 
        signalData: false, 
        twitterFeed: true,
        newsFeed: false,
        economicData: false
      };
      let updateFrequency = 5;
      
      // Try to parse symbols with fallback
      if (req.body.symbols) {
        symbols = Array.isArray(req.body.symbols) ? req.body.symbols : [req.body.symbols];
      } else if (req.body.symbol) {
        // Support legacy 'symbol' parameter
        symbols = Array.isArray(req.body.symbol) ? req.body.symbol : [req.body.symbol];
      }
      
      // Make sure we have valid symbols
      if (!symbols || symbols.length === 0) {
        return res.status(400).json({
          success: false, 
          message: "Symbol(s) required to start simulation"
        });
      }
      
      // Try to parse subscription settings
      if (req.body.subscription) {
        try {
          subscription = dataSubscriptionSchema.parse(req.body.subscription);
        } catch (error) {
          console.warn("Invalid subscription schema, using defaults:", error);
        }
      }
      
      // Try to parse update frequency
      if (req.body.updateFrequency) {
        const parsedFreq = parseInt(req.body.updateFrequency.toString(), 10);
        if (!isNaN(parsedFreq) && parsedFreq > 0 && parsedFreq <= 30) {
          updateFrequency = parsedFreq;
        }
      }
      
      console.log(`Starting simulation for symbols: ${symbols.join(', ')}`);
      
      // Start market data simulation if enabled and Solace is connected
      if (subscription.marketData) {
        if (solaceConnected) {
          console.log("Starting market data simulation with Solace connection");
          await marketDataService.startSimulation(symbols, updateFrequency);
          marketDataStarted = true;
          responseMessage += "Market data started. ";
        } else {
          console.log("Skipping market data simulation - no active Solace connection");
          responseMessage += "Market data skipped (no Solace connection). ";
        }
      }
      
      // Start LLM signal generation if enabled and Solace is connected
      if (subscription.signalData) {
        if (solaceConnected) {
          console.log("Starting signal generation with Solace connection");
          await llmService.startSignalGeneration(symbols);
          signalDataStarted = true;
          responseMessage += "Signal generation started. ";
        } else {
          console.log("Skipping signal generation - no active Solace connection");
          responseMessage += "Signal generation skipped (no Solace connection). ";
        }
      }
      
      // Twitter feed is now browser-native via TrafficGeneratorPanel
      // No backend tracking needed
      
      // Build final success message
      let finalMessage = responseMessage || "Simulation started successfully";
      
      // Return simulation status in response
      res.json({ 
        success: true, 
        message: finalMessage,
        status: {
          marketDataStarted,
          signalDataStarted,
          twitterFeedStarted
        }
      });
    } catch (error) {
      console.error("Error starting simulation:", error);
      res.status(400).json({ 
        success: false,
        message: error instanceof Error ? error.message : "Failed to start simulation" 
      });
    }
  });

  // Stop data simulation
  app.post("/api/simulation/stop", async (req: Request, res: Response) => {
    try {
      // Stop market data simulation (always)
      await marketDataService.stopSimulation();
      
      // Stop LLM service if running
      await llmService.stopSignalGeneration();
      
      // Twitter feed is now browser-native via TrafficGeneratorPanel
      
      res.json({
        success: true,
        message: 'Simulation stopped successfully.'
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to stop simulation" 
      });
    }
  });

  // Get market data for specified symbols
  app.get("/api/market-data", async (req: Request, res: Response) => {
    try {
      // Extract symbols from query parameter
      const symbolsParam = req.query.symbols as string;
      
      if (!symbolsParam) {
        return res.status(400).json({ message: "No symbols provided" });
      }
      
      const symbols = symbolsParam.split(',');
      const marketData = await storage.getMarketData(symbols);
      
      res.json(marketData);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to fetch market data" 
      });
    }
  });

  // Initialize the WebSocket broadcast module with our clients and subscriptions
  // setGlobalClients(clients);
  //setClientSubscriptions(clientSubscriptions);
  
  // Hook into the Solace service to forward messages to WebSocket clients
  solaceService.onMessage = (topic: string, message: any) => {
    console.log(`Received message from Solace on topic: ${topic}`);
    
    // DETAILED LOGGING FOR INCOMING SOLACE MESSAGE PAYLOAD:
    console.log(`  [SERVER PAYLOAD DIAGNOSTICS] Topic: "${topic}"`);
    console.log(`  - Payload Type (typeof): ${typeof message}`);

    if (typeof message === 'string') {
      console.log(`  - Payload Content (string prefix): "${message.substring(0, 300)}${message.length > 300 ? '...' : ''}"`);
      if (message.trim().startsWith('{') || message.trim().startsWith('[')) {
        try {
          const parsedStringPayload = JSON.parse(message);
          console.log(`  - Payload Content (string, parsed as JSON - prefix):`, JSON.stringify(parsedStringPayload, null, 2).substring(0, 500) + (JSON.stringify(parsedStringPayload, null, 2).length > 500 ? '...' : ''));
        } catch (parseError: any) {
          console.log(`  - Payload Content (string): Could not parse as JSON. Error: ${parseError.message}`);
        }
      }
    } else if (typeof message === 'object' && message !== null) {
      try {
        const stringifiedObject = JSON.stringify(message);
        console.log(`  - Payload Content (object - stringified prefix):`, stringifiedObject.substring(0, 500) + (stringifiedObject.length > 500 ? '...' : ''));
        if (topic.startsWith('signal/')) {
          const content = message.content;
          const signal = message.signal;
          const msgType = message.type; 
          const msgSymbol = message.symbol; 
          console.log(`  - Direct fields check (signal topic "${topic}"): content='${typeof content === 'string' ? content.substring(0,100) + '...' : content}', signal='${signal}', type='${msgType}', symbol='${msgSymbol}'`);
        }
      } catch (e: any) {
        console.log(`  - Payload Content (object): Could not stringify. Error: ${e.message}`);
      }
    } else {
      console.log(`  - Payload Content (other type): ${message}`);
    }

    let symbol: string | null = null;
    let type: 'market-data' | 'twitter-feed' | 'trading-signal' | 'signal/output' | 'news-feed' | 'economic-indicator' | 'connection/status' | 'unknown' = 'unknown';
    const topicParts = topic.split('/');

    if (topic.startsWith('market-data')) {
      type = 'market-data';
      if (topicParts.length >= 3) { 
        symbol = topicParts[topicParts.length - 1];
      }
    } else if (topic.startsWith('twitter-feed')) {
      type = 'twitter-feed';
      if (topicParts.length >= 2) { 
        symbol = topicParts[1];
      }
    } else if (topic.startsWith('signal/')) { // Handles signal/SYMBOL and signal/output
      if (topic === 'signal/output') {
        type = 'signal/output';
        if (message && message.symbol) symbol = message.symbol;
        else if (message && message.data && message.data.symbol) symbol = message.data.symbol;
      } else {
        type = 'trading-signal'; // Treat signal/SYMBOL as a trading-signal type
        if (topicParts.length >= 2) symbol = topicParts[1];
      }
    } else if (topic.startsWith('trading-signal')) { // Legacy, if still used
        type = 'trading-signal';
        if (topicParts.length >= 2) symbol = topicParts[1];
    } else if (topic.startsWith('news-feed')) {
      type = 'news-feed';
      if (topicParts.length >= 2) { symbol = topicParts[topicParts.length -1];}
    } else if (topic.startsWith('economic-indicator')) {
      type = 'economic-indicator';
    } else if (topic.startsWith('connection/status')) {
      type = 'connection/status';
    }
    
    if (!symbol && message && message.symbol) {
      symbol = message.symbol;
    } else if (!symbol && message && message.data && message.data.symbol) {
      symbol = message.data.symbol;
    }

    const wsMessage: any = {
      type: type,
      topic: topic,
      symbol: symbol,
      data: message,
      timestamp: new Date().toISOString(),
      direction: 'incoming'
    };
    try {
      wsMessage.rawData = typeof message === 'object' ? JSON.stringify(message) : String(message);
    } catch (e) {
      wsMessage.rawData = "Could not stringify raw message";
    }

    // Standard broadcast logic for other message types or if twitter-feed republish fails (handled in catch)
    if (type === 'market-data' && symbol) { 
      console.log(`[DEBUG SERVER MARKET-DATA BROADCAST] Broadcasting 'market-data' message for '${symbol}' on topic '${topic}' to relevant subscribers.`);
      broadcastToWebSocketSubscribers(topic, wsMessage);
    } else if (type === 'trading-signal' && symbol && topic.startsWith('signal/')) { 
        const signalContent = wsMessage.data && wsMessage.data.content;
        console.log(`[DEBUG SERVER SIGNAL BROADCAST LOGIC] Topic: "${topic}", Symbol: "${symbol}", Type: "${type}". Attempting to broadcast.`);
        if (signalContent && typeof signalContent === 'string') {
             console.log(`   wsMessage.data.content (type string, preview): ${signalContent.substring(0,150)}...`);
        } else if (signalContent) {
            console.log(`   wsMessage.data.content (type object, preview): ${JSON.stringify(signalContent).substring(0,150)}...`);
        } else {
            console.log(`   wsMessage.data.content is undefined or null.`);
        }
        broadcastToWebSocketSubscribers(topic, wsMessage);
    } else if (type === 'signal/output') { // Deprecated path
      console.log(`[DEBUG SERVER SIGNAL/OUTPUT BROADCAST] Broadcasting 'signal/output' message for symbol '${symbol || 'unknown'}' on topic '${topic}'`);
      broadcastToWebSocketSubscribers(topic, wsMessage);
    } else if (type === 'news-feed' && symbol) {
      console.log(`Broadcasting news-feed message for ${symbol}`);
      broadcastToWebSocketSubscribers(topic, wsMessage);
    } else if (type === 'economic-indicator') {
      console.log(`Broadcasting economic-indicator message`);
      broadcastToWebSocketSubscribers(topic, wsMessage);
    } else if (type === 'connection/status') {
      console.log(`Broadcasting connection/status message`);
      broadcastToWebSocketSubscribers(topic, wsMessage);
    } else {
      console.log(`[UNKNOWN TYPE OR NO SYMBOL OR NOT BROADCASTING] Message for topic: ${topic}, type: ${type}, symbol: ${symbol}`);
    }
  };

  // Setup initial Solace subscriptions for the main service
  // This ensures the server listens for all relevant data from the broker.
  // These are base subscriptions; client-specific subscriptions are added dynamically.
  const initialSolaceSubscriptions = [
    'signal/*',                   // All signals (e.g., signal/NVDA, signal/6501)

    'connection/status',          // Connection status messages
    // 'signal/output' // Deprecated, but if messages still arrive, good to listen.
  ];

  // Ensure Solace service attempts to subscribe to these when it connects.
  // This might be in an `on connect` event for solaceService or when /api/solace/connect is called.
  // For now, this array is defined. The actual subscription call needs to be verified/added.
  // The logic in /api/solace/connect (around line 1572) that syncs client subscriptions
  // should be augmented or preceded by logic that establishes these base server-side subscriptions.

  console.log("Initial Solace subscriptions for server defined:", initialSolaceSubscriptions);

  return httpServer;
}
