/**
 * Twitter Service
 * 
 * Manages tweet generation and publishing for selected stocks
 */
import { twitterPublisherService } from "./twitterPublisherService";
import { storage } from "../storage";

interface StockTweetState {
  symbol: string;
  companyName: string;
  isActive: boolean;
  lastTweetTimestamp: Date | null;
  tweetsPublished: number;
  interval: number | null;
  successCount: number;
  failureCount: number;
  intervalTimer: NodeJS.Timeout | null;
  lastUpdateTime: number;
}

class TwitterService {
  private activeStocks: Map<string, StockTweetState> = new Map();
  private isEnabled: boolean = true;
  private defaultTweetFrequency: number = 60; // seconds
  private publisherConnected: boolean = false;
  private publishingInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    console.log("🔄 TwitterService initialized - NOT starting automatically to prevent duplicate publishers");
    
    // Do NOT automatically connect or start the publisher
    // This avoids duplicate tweet publishers running in the background
    // Test routes will explicitly call init() when needed
  }
  
  /**
   * Initialize the Twitter service - must be explicitly called
   * This method is used by test routes when needed
   */
  async init(): Promise<void> {
    if (this.publishingInterval) {
      console.log("TwitterService already initialized");
      return;
    }
    
    try {
      console.log("Explicitly initializing TwitterService");
      await this.connectPublisher();
      this.initContinuousPublishing();
    } catch (error) {
      console.error("Error connecting Twitter publisher to Solace:", error);
      this.initContinuousPublishing();
    }
  }
  
  /**
   * Connect the dedicated Twitter publisher service to Solace
   */
  private async connectPublisher(): Promise<void> {
    try {
      console.log("Connecting dedicated Twitter publisher to Solace...");
      await twitterPublisherService.connect();
      this.publisherConnected = twitterPublisherService.isConnected();
      console.log(`Twitter publisher connected to Solace: ${this.publisherConnected}`);
    } catch (error) {
      console.error("Failed to connect Twitter publisher to Solace:", error);
      this.publisherConnected = false;
      throw error;
    }
  }
  
  /**
   * Initialize continuous tweet publishing for active stocks
   */
  private initContinuousPublishing(): void {
    console.log("Starting continuous tweet publishing service");
    
    // Set interval for continuous updates every 5 seconds
    this.publishingInterval = setInterval(
      () => this.publishAllPendingTweets(),
      5000 // Check and publish every 5 seconds
    );
  }
  
  /**
   * Check and publish tweets for all active stocks based on their configured intervals
   */
  private publishAllPendingTweets(): void {
    // Skip if service is disabled
    if (!this.isEnabled) {
      return;
    }
    
    // Check publisher connection status
    const isPublisherConnected = twitterPublisherService.isConnected();
    this.publisherConnected = isPublisherConnected;
    
    if (!isPublisherConnected) {
      console.log("Twitter publisher not connected - will queue tweets for later publishing");
    }
    
    const now = Date.now();
    const activeSymbols = this.getActiveSymbols();
    
    // Only log if we have active symbols
    if (activeSymbols.length > 0) {
      console.log(`Checking for pending tweets for ${activeSymbols.length} active stocks`);
    }
    
    // Number of tweets published in this cycle
    let publishedCount = 0;
    
    // Process each active stock
    for (const symbol of activeSymbols) {
      const state = this.activeStocks.get(symbol);
      
      if (!state || !state.isActive) {
        continue;
      }
      
      // Initialize lastUpdateTime if not set
      if (!state.lastUpdateTime) {
        state.lastUpdateTime = now - (state.interval || (this.defaultTweetFrequency * 1000));
      }
      
      // Calculate time since last update
      const elapsedSinceLastUpdate = now - state.lastUpdateTime;
      const intervalMs = state.interval || (this.defaultTweetFrequency * 1000);
      
      // Check if it's time to publish a tweet
      if (elapsedSinceLastUpdate >= intervalMs) {
        console.log(`Publishing scheduled tweet for ${symbol} (interval: ${intervalMs}ms, elapsed: ${elapsedSinceLastUpdate}ms)`);
        
        // Update the last update time
        state.lastUpdateTime = now;
        
        // Generate and publish the tweet
        this.generateAndPublishTweet(symbol).then(success => {
          if (success) {
            publishedCount++;
          }
        }).catch(error => {
          console.error(`Error publishing scheduled tweet for ${symbol}:`, error);
        });
      }
    }
    
    if (publishedCount > 0) {
      console.log(`Published ${publishedCount} tweets in this cycle`);
    }
  }
  
  /**
   * Start tweet simulation for specified stock symbols
   * @param symbols Stock symbols to simulate tweets for
   * @param frequency How often to generate tweets in seconds
   */
  async startSimulation(symbols: string[], frequency: number = this.defaultTweetFrequency): Promise<boolean> {
    if (!this.isEnabled) {
      console.log("TwitterService is disabled - not starting simulation");
      return false;
    }
    
    console.log(`Starting tweet simulation for symbols: ${symbols.join(', ')}`);
    
    if (frequency !== this.defaultTweetFrequency) {
      // Update the default frequency if it was passed
      this.setTweetFrequency(frequency);
    }
    
    // Convert frequency to milliseconds
    const intervalMs = frequency * 1000;
    const now = Date.now();
    
    for (const symbol of symbols) {
      try {
        // Get stock info from storage
        const stock = await storage.getStockBySymbol(symbol);
        
        if (!stock) {
          console.error(`Cannot start tweet simulation for unknown stock: ${symbol}`);
          continue;
        }
        
        // Check if we already have an active simulation for this stock
        if (this.activeStocks.has(symbol)) {
          const existingState = this.activeStocks.get(symbol)!;
          
          // If already active, just update the settings
          if (existingState.isActive) {
            console.log(`Tweet simulation already active for ${symbol}, updating frequency to ${frequency}s`);
            
            // Clear existing interval - we don't need individual timers anymore
            if (existingState.intervalTimer) {
              clearInterval(existingState.intervalTimer);
              existingState.intervalTimer = null;
            }
            
            // Update interval and force an immediate update by setting lastUpdateTime to past
            existingState.interval = intervalMs;
            existingState.lastUpdateTime = now - intervalMs;
            
            continue;
          } else {
            // If exists but not active, reactivate it
            console.log(`Reactivating tweet simulation for ${symbol}`);
            existingState.isActive = true;
            existingState.interval = intervalMs;
            existingState.lastUpdateTime = now - intervalMs; // Set to trigger immediate tweet
            
            // Clear any existing timer
            if (existingState.intervalTimer) {
              clearInterval(existingState.intervalTimer);
              existingState.intervalTimer = null;
            }
            
            continue;
          }
        }
        
        // Create a new state for this stock
        const stockState: StockTweetState = {
          symbol,
          companyName: stock.companyName,
          isActive: true,
          lastTweetTimestamp: null,
          tweetsPublished: 0,
          interval: intervalMs,
          successCount: 0,
          failureCount: 0,
          intervalTimer: null,
          lastUpdateTime: now - intervalMs // Set to past to trigger immediate tweet
        };
        
        // Store the state
        this.activeStocks.set(symbol, stockState);
        console.log(`Added ${symbol} to active tweet tracking with interval: ${intervalMs}ms (${frequency}s)`);
      } catch (error) {
        console.error(`Error starting tweet simulation for ${symbol}:`, error);
      }
    }
    
    // Force immediate execution of publishAllPendingTweets to get initial tweets
    console.log("Triggering immediate tweet publication for newly added symbols");
    this.publishAllPendingTweets();
    
    return true;
  }
  
  /**
   * Stop tweet simulation for all or specific stock symbols
   * @param symbols Optional stock symbols to stop simulation for. If not provided, stops all.
   */
  async stopSimulation(symbols?: string[]): Promise<void> {
    // If no symbols provided, stop all simulations
    if (!symbols || symbols.length === 0) {
      console.log("Stopping all tweet simulations");
      
      // Stop all active intervals and mark as inactive
      for (const [symbol, state] of this.activeStocks.entries()) {
        // Clear any individual timer if it exists
        if (state.intervalTimer) {
          clearInterval(state.intervalTimer);
          state.intervalTimer = null;
        }
        state.isActive = false;
      }
      
      return;
    }
    
    // Stop simulation for specific symbols
    console.log(`Stopping tweet simulation for symbols: ${symbols.join(', ')}`);
    
    for (const symbol of symbols) {
      const state = this.activeStocks.get(symbol);
      
      if (state) {
        // Clear any individual timer if it exists
        if (state.intervalTimer) {
          clearInterval(state.intervalTimer);
          state.intervalTimer = null;
        }
        
        // Mark as inactive
        state.isActive = false;
        
        console.log(`Stopped tweet simulation for ${symbol}`);
      }
    }
  }
  
  /**
   * Generate and publish a tweet for a stock
   * @param symbol Stock symbol
   */
  private async generateAndPublishTweet(symbol: string): Promise<boolean> {
    // Get the stock state
    const state = this.activeStocks.get(symbol);
    
    if (!state || !state.isActive) {
      console.log(`Tweet simulation not active for ${symbol}`);
      return false;
    }
    
    try {
      // Record start time for performance measurement
      const startTime = Date.now();
      
      // Check if publisher is connected
      this.publisherConnected = twitterPublisherService.isConnected();
      if (!this.publisherConnected) {
        console.log(`Twitter publisher not connected - queuing tweet for ${symbol}`);
      }
      
      // Generate tweet content
      const tweetContent = this.generateTweetContent(symbol, state.companyName);
      console.log(`📝 Generated tweet for ${symbol}: "${tweetContent.substring(0, 30)}..."`);
      
      // Get current timestamp
      const timestamp = new Date();
      
      // Publish the tweet
      // console.log(`📤 Publishing tweet for ${symbol} to twitter-feed/${symbol} using dedicated publisher`);
      const success = await twitterPublisherService.publishTweet(
        symbol,
        tweetContent,
        state.companyName,
        timestamp
      );
      
      // Update state based on result
      if (success) {
        state.successCount++;
        state.lastTweetTimestamp = timestamp;
        state.tweetsPublished++;
        console.log(`✅ Successfully published tweet for ${symbol} using dedicated publisher`);
      } else {
        state.failureCount++;
        if (this.publisherConnected) {
          console.error(`❌ Failed to publish tweet for ${symbol} despite connection being available`);
        } else {
          console.log(`Tweet for ${symbol} queued for later delivery`);
        }
      }
      
      // Record end time and log performance
      const duration = Date.now() - startTime;
      console.log(`⏱️ Tweet generation and processing took ${duration}ms for ${symbol}`);
      
      return success;
    } catch (error) {
      console.error(`Error generating and publishing tweet for ${symbol}:`, error);
      
      // Update failure count
      state.failureCount++;
      
      return false;
    }
  }
  
  /**
   * Generate tweet content for a stock
   * @param symbol Stock symbol
   * @param companyName Company name
   */
  private generateTweetContent(symbol: string, companyName: string): string {
    // Create a random tweet about the company
    const tweetTemplates = [
      `${companyName} announces dividend increase of 10% for shareholders. #${symbol} #investing`,
      `${companyName} stock upgraded by major analyst. Target price raised. #${symbol} #stocks`,
      `${companyName} quarterly earnings exceed expectations. Positive outlook for next quarter. #${symbol} #earnings`,
      `${companyName} leadership changes announced today. New CFO appointed. #${symbol} #executive`,
      `${companyName} R&D breakthrough could lead to new product line. #${symbol} #innovation`,
      `${companyName} reports strong customer growth. Market share increasing. #${symbol} #growth`,
      `${companyName} sustainability initiatives gain recognition. ESG scores improved. #${symbol} #ESG`,
      `${companyName} expands into new markets. International growth accelerating. #${symbol} #expansion`,
      `${companyName} announces share buyback program. Positive for shareholders. #${symbol} #buyback`,
      `${companyName} forms strategic partnership with industry leader. #${symbol} #partnership`
    ];
    
    // Select a random tweet template
    const randomIndex = Math.floor(Math.random() * tweetTemplates.length);
    return tweetTemplates[randomIndex];
  }
  
  /**
   * Get metrics about active Twitter feed simulations
   */
  getMetrics(): {
    activeSymbolCount: number;
    configuredInterval: number;
    perSymbolMetrics: Record<string, {
      tweetsPublished: number;
      publishingRatePerMinute: number;
      lastPublishAgo: string;
      successRate: number;
    }>
  } {
    const metrics = {
      activeSymbolCount: 0,
      configuredInterval: this.defaultTweetFrequency,
      perSymbolMetrics: {} as Record<string, any>
    };
    
    // Count active symbols
    let activeCount = 0;
    
    // Calculate per-symbol metrics
    for (const [symbol, state] of this.activeStocks.entries()) {
      if (state.isActive) {
        activeCount++;
      }
      
      const now = new Date();
      const lastPublish = state.lastTweetTimestamp;
      let lastPublishAgo = 'never';
      let publishingRatePerMinute = 0;
      
      if (lastPublish) {
        const secondsAgo = Math.round((now.getTime() - lastPublish.getTime()) / 1000);
        lastPublishAgo = secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.round(secondsAgo/60)}m ago`;
        
        // Estimate publishing rate based on total tweets and time since first tweet
        if (state.tweetsPublished > 0) {
          publishingRatePerMinute = (state.tweetsPublished / secondsAgo) * 60;
        }
      }
      
      const totalAttempts = state.successCount + state.failureCount;
      const successRate = totalAttempts > 0 ? (state.successCount / totalAttempts) * 100 : 0;
      
      metrics.perSymbolMetrics[symbol] = {
        tweetsPublished: state.tweetsPublished,
        publishingRatePerMinute: Math.round(publishingRatePerMinute * 100) / 100,
        lastPublishAgo,
        successRate: Math.round(successRate * 10) / 10 + '% (' + state.successCount + '/' + totalAttempts + ')'
      };
    }
    
    metrics.activeSymbolCount = activeCount;
    
    return metrics;
  }
  
  /**
   * Set the default tweet frequency for new simulations
   * @param frequency Frequency in seconds
   * @param maxFrequency Optional maximum frequency (for compatibility with test routes)
   */
  setTweetFrequency(frequency: number, maxFrequency?: number): void {
    this.defaultTweetFrequency = frequency;
    console.log(`Set default tweet frequency to ${frequency} seconds`);
    
    // Ignore maxFrequency parameter - only used for compatibility with test routes
    if (maxFrequency !== undefined) {
      console.log(`Note: maxFrequency parameter (${maxFrequency}) is ignored in this implementation`);
    }
  }
  
  /**
   * Get the current tweet frequency
   * @returns The current tweet frequency in seconds (number or array for compatibility)
   */
  getTweetFrequency(): number | number[] {
    // Return as number for normal use
    return this.defaultTweetFrequency;
  }
  
  /**
   * Get current status of the Twitter service
   */
  getStatus(): {
    isActive: boolean,
    activeSymbols: string[],
    tweetFrequencySeconds: number
  } {
    return {
      isActive: this.isEnabled,
      activeSymbols: this.getActiveSymbols(),
      tweetFrequencySeconds: this.defaultTweetFrequency
    };
  }
  
  /**
   * Alias for forcePublishTweet with deprecated name for backward compatibility
   * @deprecated Use forcePublishTweet instead
   */
  async forceTweet(symbol: string): Promise<boolean> {
    return this.forcePublishTweet(symbol);
  }
  
  /**
   * Get debugging information about the Twitter service
   */
  getDebugInfo(): any {
    // Collect internal state information for debugging
    const debugInfo: any = {
      isEnabled: this.isEnabled,
      defaultTweetFrequency: this.defaultTweetFrequency,
      activeStockCount: this.activeStocks.size,
      activeStocks: {}
    };
    
    // Add information about each active stock
    for (const [symbol, state] of this.activeStocks.entries()) {
      debugInfo.activeStocks[symbol] = {
        isActive: state.isActive,
        companyName: state.companyName,
        tweetsPublished: state.tweetsPublished,
        lastTweetTime: state.lastTweetTimestamp ? state.lastTweetTimestamp.toISOString() : 'never',
        successCount: state.successCount,
        failureCount: state.failureCount,
        hasTimer: state.intervalTimer !== null,
        intervalMs: state.interval
      };
    }
    
    return debugInfo;
  }
  
  /**
   * Enable or disable tweet generation
   * @param enabled Whether to enable tweet generation
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    
    if (!enabled) {
      // Stop all simulations when disabled
      this.stopSimulation();
    }
    
    console.log(`TwitterService ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Get list of active symbols
   */
  getActiveSymbols(): string[] {
    const activeSymbols: string[] = [];
    
    for (const [symbol, state] of this.activeStocks.entries()) {
      if (state.isActive) {
        activeSymbols.push(symbol);
      }
    }
    
    return activeSymbols;
  }
  
  /**
   * Force publish a tweet immediately for a specified symbol
   * This is useful for testing and debugging the Twitter feed
   * @param symbol The stock symbol to publish a tweet for
   */
  async forcePublishTweet(symbol: string): Promise<boolean> {
    console.log(`Forcing immediate tweet publication for ${symbol}`);
    
    try {
      // Check if we have an active state for this symbol
      if (!this.activeStocks.has(symbol)) {
        console.log(`Creating temporary state for forced tweet for ${symbol}`);
        
        // Get stock info from storage to create a temporary state
        const stock = await storage.getStockBySymbol(symbol);
        
        if (!stock) {
          console.error(`Cannot force tweet for ${symbol} - stock not found in database`);
          return false;
        }
        
        // Create a temporary state for this forced tweet
        const tempState: StockTweetState = {
          symbol,
          companyName: stock.companyName,
          isActive: true,
          lastTweetTimestamp: null,
          tweetsPublished: 0,
          interval: this.defaultTweetFrequency * 1000,
          successCount: 0,
          failureCount: 0,
          intervalTimer: null,
          lastUpdateTime: Date.now()
        };
        
        // Add temporary state to the active stocks
        this.activeStocks.set(symbol, tempState);
        
        // Generate and publish the tweet
        const result = await this.generateAndPublishTweet(symbol);
        
        // Remove the temporary state after publishing
        this.activeStocks.delete(symbol);
        
        // Log metrics after forcing a tweet
        this.logMetrics();
        
        return result;
      }
      
      // For existing stocks
      const state = this.activeStocks.get(symbol)!;
      const wasActive = state.isActive;
      
      // Temporarily set to active if needed
      state.isActive = true;
      
      // Directly call the generate and publish method
      const result = await this.generateAndPublishTweet(symbol);
      
      // Restore previous active state
      state.isActive = wasActive;
      
      // Log metrics after forcing a tweet
      this.logMetrics();
      
      return result;
    } catch (error) {
      console.error(`Error forcing tweet for ${symbol}:`, error);
      return false;
    }
  }

  /**
   * Log metrics about active Twitter feed simulations
   */
  logMetrics(): void {
    const metrics = this.getMetrics();
    
    console.log("========== TWITTER PUBLISHER METRICS ==========");
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Active symbols: ${metrics.activeSymbolCount}`);
    console.log(`Configured tweet interval: ${metrics.configuredInterval}s`);
    
    if (Object.keys(metrics.perSymbolMetrics).length > 0) {
      console.log("PER-SYMBOL METRICS:");
      
      for (const [symbol, symbolMetrics] of Object.entries(metrics.perSymbolMetrics)) {
        console.log(`${symbol}:`);
        console.log(`  Total tweets published: ${symbolMetrics.tweetsPublished}`);
        console.log(`  Publishing rate: ${symbolMetrics.publishingRatePerMinute} tweets/minute`);
        console.log(`  Last publish: ${symbolMetrics.lastPublishAgo}`);
        console.log(`  Success rate: ${symbolMetrics.successRate}`);
      }
    }
    
    console.log("=================================================");
  }
}

export const twitterService = new TwitterService();