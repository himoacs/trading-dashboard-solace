import { solaceService } from "./solaceService";
import { storage } from "../storage";

/**
 * SignalService manages subscription to the signal/output topic from Solace
 * 
 * Flow:
 * 1. Our app publishes Twitter feed data to Solace broker on twitter-feed/* topics
 * 2. External Agent Mesh processes the tweets and publishes to signal/output topic
 * 3. Our UI subscribes to signal/output topic to receive and display signals
 */
class SignalService {
  private signalSubscription: { unsubscribe: () => void } | null = null;
  private twitterTopicPrefix = 'twitter-feed/';
  private signalOutputTopic = 'signal/output';
  
  /**
   * Subscribe to the signal/output topic for the specified symbols
   */
  async startSignalGeneration(symbols: string[]): Promise<void> {
    console.log(`Starting subscription to ${this.signalOutputTopic} for symbols: ${symbols.join(', ')}`);
    
    if (!solaceService.isConnected()) {
      console.error('Cannot subscribe to signals: Not connected to Solace');
      return;
    }
    
    // Only subscribe once to the signal/output topic
    if (!this.signalSubscription) {
      try {
        // Create handler for signal/output messages
        const signalOutputHandler = async (message: any) => {
          console.log(`Received message on ${this.signalOutputTopic} topic:`, JSON.stringify(message));
          
          // Enhanced handling for different message formats
          let symbol = message.symbol;
          let companyName = message.companyName;
          let signalData = message;
          let signalType = 'unknown';
          
          // Handle messages that have a data object with symbol inside (most common format)
          if (message.data && message.data.symbol) {
            symbol = message.data.symbol;
            companyName = message.data.companyName || companyName;
            signalData = message.data;
            signalType = 'data-structure';
          }
          
          // Handle direct signal objects (older format)
          else if (message.symbol && message.signal) {
            symbol = message.symbol;
            companyName = message.companyName || companyName;
            signalData = message;
            signalType = 'direct-structure';
          }
          
          // Handle messages with type field (from our WebSocket system)
          else if (message.type === 'signal/output' && message.symbol) {
            symbol = message.symbol;
            companyName = message.companyName || companyName;
            // If data exists, use it, otherwise use the message itself
            signalData = message.data || message;
            signalType = 'typed-structure';
          }
          
          // Try to extract symbol from id field (common in external systems)
          if (!symbol && message.id) {
            // Validate that it looks like a symbol (all uppercase, 1-5 chars)
            if (/^[A-Z]{1,5}$/.test(message.id)) {
              symbol = message.id;
              signalType = 'id-based';
              console.log(`Extracted symbol from id field: ${symbol}`);
            }
          }
          
          // Check for symbol in content field (sometimes it's there)
          if (!symbol && message.content) {
            // Look for typical stock symbol patterns (e.g., $MSFT, #AAPL, NVDA)
            const contentSymbolMatch = message.content.match(/(?:^|\s|\$|#)([A-Z]{1,5})(?:\s|$|,|\.|;)/);
            if (contentSymbolMatch && contentSymbolMatch[1]) {
              symbol = contentSymbolMatch[1];
              signalType = 'content-symbol';
              console.log(`Extracted symbol from content field: ${symbol}`);
            }
          }
          
          // Check for typical patterns in the body or message field that might contain a symbol
          const bodyContent = message.body || message.message || message.content || '';
          if (!symbol && bodyContent) {
            // Extract stock symbols that start with $ like $MSFT
            const dollarMatch = bodyContent.match(/\$([A-Z]{1,5})/);
            if (dollarMatch && dollarMatch[1]) {
              symbol = dollarMatch[1];
              signalType = 'dollar-symbol-in-body';
              console.log(`Extracted symbol from $ pattern in body/message: ${symbol}`);
            }
            
            // Extract stock symbols with hashtag like #MSFT
            if (!symbol) {
              const hashMatch = bodyContent.match(/#([A-Z]{1,5})/);
              if (hashMatch && hashMatch[1]) {
                symbol = hashMatch[1];
                signalType = 'hash-symbol-in-body';
                console.log(`Extracted symbol from # pattern in body/message: ${symbol}`);
              }
            }
            
            // Extract standalone stock symbols like MSFT (common in headlines)
            if (!symbol) {
              const symbolMatch = bodyContent.match(/\b([A-Z]{1,5})\b/);
              if (symbolMatch && symbolMatch[1] && !/^(AI|THE|FOR|AND|BUY|SELL)$/.test(symbolMatch[1])) {
                symbol = symbolMatch[1];
                signalType = 'standalone-symbol-in-body';
                console.log(`Extracted standalone symbol from body/message: ${symbol}`);
              }
            }
            
            // Check for company name mentions to infer symbol
            if (!symbol) {
              const companyNameMap = {
                'microsoft': 'MSFT',
                'apple': 'AAPL',
                'amazon': 'AMZN',
                'google': 'GOOG',
                'facebook': 'META',
                'meta': 'META',
                'nvidia': 'NVDA',
                'amd': 'AMD',
                'advanced micro': 'AMD',
                'tesla': 'TSLA',
                'netflix': 'NFLX'
              };
              
              const lowerContent = bodyContent.toLowerCase();
              for (const [company, ticker] of Object.entries(companyNameMap)) {
                if (lowerContent.includes(company)) {
                  symbol = ticker;
                  signalType = 'company-name-in-body';
                  console.log(`Extracted symbol ${symbol} from company name "${company}" in body/message`);
                  break;
                }
              }
            }
          }
          
          // Use Capital case Signal field to determine action type (common in some API responses)
          if (!signalData.signal && message.Signal) {
            signalData.signal = message.Signal;
            console.log(`Using 'Signal' field as 'signal': ${signalData.signal}`);
          }
          
          if (!symbol) {
            console.error('Missing symbol in signal/output message:', JSON.stringify(message));
            return;
          }
          
          console.log(`Processing signal for ${symbol} (format: ${signalType})`);
          
          // Get additional stock information to enrich the message
          try {
            // Look up the stock to get company name if not already available
            if (!companyName) {
              const stock = await storage.getStockBySymbol(symbol);
              if (stock) {
                companyName = stock.companyName;
                console.log(`Found company name for ${symbol}: ${companyName}`);
              }
            }
          } catch (err) {
            console.error(`Error getting stock info for ${symbol}:`, err);
          }
          
          // Store the trading signal in the database if it has signal data
          if (signalData.signal) {
            console.log(`Storing signal for ${symbol}: ${signalData.signal} with ${signalData.confidence || 'unknown'} confidence`);
            await this.storeSignalData(symbol, signalData);
            
            // Check if this is already a standardized message to prevent republishing loops
            const isAlreadyStandardized = (
              message.type === "signal/output" && 
              message.symbol === symbol && 
              message.companyName === companyName && 
              message.signal === signalData.signal && 
              typeof message.confidence !== 'undefined' &&
              message.data?.symbol === symbol
            );
            
            // Only republish if the message isn't already in the standardized format
            if (!isAlreadyStandardized) {
              try {
                // Create a standardized message format that includes symbol at all levels
                const standardizedMessage = {
                  type: "signal/output",
                  symbol,                      // Always include symbol at top level
                  companyName,                 // Include company name if available
                  signal: signalData.signal,   // Include signal at top level
                  confidence: signalData.confidence || 0.5,
                  timestamp: new Date().toISOString(),
                  // Add a flag to indicate this is a standardized message to prevent infinite loops
                  isStandardized: true,
                  data: {
                    ...signalData,            // Keep all original data
                    symbol,                   // Ensure symbol is in data too
                    companyName               // Ensure company name is in data too
                  }
                };
                
                // Republish the standardized message
                await solaceService.publish(this.signalOutputTopic, standardizedMessage);
                console.log(`Republished standardized signal for ${symbol} on ${this.signalOutputTopic}`);
              } catch (err) {
                console.error(`Error republishing standardized signal for ${symbol}:`, err);
              }
            } else {
              console.log(`Signal for ${symbol} is already in standardized format, skipping republish`);
            }
          } else {
            console.log(`No signal data found in message for ${symbol}`);
          }
        };
        
        // Subscribe to the signal/output topic
        await solaceService.subscribe(this.signalOutputTopic, signalOutputHandler);
        
        // Save subscription for cleanup
        this.signalSubscription = {
          unsubscribe: () => solaceService.unsubscribe(this.signalOutputTopic, signalOutputHandler)
        };
        
        console.log(`Successfully subscribed to ${this.signalOutputTopic}`);
      } catch (error) {
        console.error(`Error subscribing to ${this.signalOutputTopic}:`, error);
      }
    }
  }
  
  /**
   * Unsubscribe from the signal/output topic
   */
  async stopSignalGeneration(): Promise<void> {
    console.log('Stopping signal subscription');
    
    if (this.signalSubscription) {
      this.signalSubscription.unsubscribe();
      this.signalSubscription = null;
      console.log(`Unsubscribed from ${this.signalOutputTopic}`);
    }
  }
  
  /**
   * Store signal data in the database
   */
  private async storeSignalData(symbol: string, signalData: any): Promise<void> {
    try {
      // Get the stock
      const stock = await storage.getStockBySymbol(symbol);
      
      if (!stock) {
        console.error(`Stock not found for symbol ${symbol}`);
        return;
      }
      
      // Extract signal details
      const signal = signalData.signal || 'HOLD';
      const confidence = signalData.confidence || 0.5;
      const reasoning = signalData.reasoning || 'No reasoning provided';
      
      // Store in database
      await storage.createTradingSignal({
        stockId: stock.id,
        signal,
        confidence,
        reasoning
      });
      
      console.log(`Stored trading signal for ${symbol}: ${signal} (${confidence.toFixed(2)})`);
    } catch (error) {
      console.error(`Error storing signal data for ${symbol}:`, error);
    }
  }
  
  /**
   * Helper method to publish Twitter content to Solace for external Agent Mesh processing
   * This method will be called by twitterService when new tweets are generated
   */
  async publishTweetForProcessing(symbol: string, tweetContent: string, timestamp: Date): Promise<void> {
    try {
      // Check if Solace is connected first
      if (!solaceService.isConnected()) {
        console.log(`Cannot publish tweet for ${symbol}: Not connected to Solace`);
        return;
      }
      
      // Get the stock for additional context
      const stock = await storage.getStockBySymbol(symbol);
      
      if (!stock) {
        console.error(`Stock not found for symbol ${symbol}`);
        return;
      }
      
      // Create a message with all context needed for Agent Mesh to process
      const message = {
        symbol,
        companyName: stock.companyName,
        content: tweetContent,
        price: stock.currentPrice || 0,
        percentChange: stock.percentChange || 0,
        timestamp: timestamp.toISOString()
      };
      
      // Topic for Agent Mesh to subscribe to
      const topic = `${this.twitterTopicPrefix}${symbol}`;
      
      // Publish to Solace for external Agent Mesh to process
      await solaceService.publish(topic, message);
      
      // console.log(`Published tweet for ${symbol} to Solace (topic: ${topic}): "${tweetContent.substring(0, 40)}..."`);
      
      // NOTE: We no longer generate automatic test signals here
      // Instead, the external Agent Mesh process should respond via Solace,
      // or test routes can be used to simulate signals
    } catch (error) {
      console.error(`Error publishing tweet for Agent Mesh processing:`, error);
    }
  }
  
  /**
   * Test method that simulates receiving a signal directly to signal/output topic
   * This is used only for testing and simulating the external Agent Mesh
   * NOTE: We should NOT use this method in production, only for testing
   */
  async publishTestSignal(symbol: string, signal: string, confidence: number, tweetContent: string): Promise<void> {
    try {
      // Get the stock
      const stock = await storage.getStockBySymbol(symbol);
      
      if (!stock) {
        console.error(`Stock not found for symbol ${symbol}`);
        return;
      }
      
      // DO NOT allow generic "Automatic test signal" messages
      if (tweetContent.includes("Automatic test signal") || tweetContent.includes("test signal")) {
        console.warn(`Refusing to publish generic test signal for ${symbol} - use real content instead`);
        return;
      }
      
      // Create timestamp that will be used consistently
      const timestamp = new Date().toISOString();
      
      // Ensure the symbol is always included at the top level AND in the data
      // This fixes the issue where signal/output messages don't include symbol
      const message = {
        type: "signal/output",
        symbol,                   // Always include symbol at top level
        companyName: stock.companyName, // Always include company name at top level
        signal,                   // Include signal at top level
        confidence,               // Include confidence at top level
        isStandardized: true,     // Add flag to prevent republishing loop
        data: {
          symbol,                 // Include symbol in data object too
          companyName: stock.companyName,
          signal,
          confidence,
          content: tweetContent,
          timestamp
        },
        timestamp
      };
      
      // Publish directly to the signal/output topic
      await solaceService.publish(this.signalOutputTopic, message);
      
      console.log(`Published processed signal to ${this.signalOutputTopic} for ${symbol}:`, JSON.stringify(message));
      
      // Also store in database
      await this.storeSignalData(symbol, {
        signal,
        confidence,
        reasoning: `Signal generated from tweet: ${tweetContent.substring(0, 50)}...`
      });
      
      return;
    } catch (error) {
      console.error(`Error publishing test signal:`, error);
      throw error;
    }
  }
}

// Export as llmService to maintain compatibility with existing code
export const llmService = new SignalService();
