/**
 * Simple Twitter Service
 * 
 * A stripped-down version that focuses on strict timing control
 * and eliminates all the complexity from the previous implementations.
 */

import { twitterPublisherService } from "./twitterPublisherService";
import { storage } from "../storage";

interface StockTweetState {
  symbol: string;
  companyName: string;
  isActive: boolean;
  lastTweetTimestamp: Date | null;
  tweetsPublished: number;
  intervalTimer: NodeJS.Timeout | null;
  frequencySeconds: number;
}

class SimpleTwitterService {
  private activeStocks: Map<string, StockTweetState> = new Map();
  private defaultFrequencySeconds: number = 60; // Default to 1 minute
  private isEnabled: boolean = false; // Start disabled by default
  private isInitialized: boolean = false;
  
  constructor() {
    console.log("✨ SimpleTwitterService initialized - DISABLED by default until user activates");
    // Do NOT automatically connect on initialization
    // User must explicitly start service via API
  }
  
  /**
   * Initialize the Twitter publisher service
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      console.log("Connecting Twitter publisher to Solace...");
      await twitterPublisherService.connect();
      this.isInitialized = true;
      console.log("Twitter publisher connected successfully");
    } catch (error) {
      console.error("Failed to initialize Twitter publisher:", error);
    }
  }
  
  /**
   * Start tweet generation for a symbol
   */
  async startTweets(symbol: string, frequencySeconds?: number): Promise<boolean> {
    if (!this.isEnabled) {
      console.log("Twitter service is disabled");
      return false;
    }
    
    // Initialize the service if not already initialized
    if (!this.isInitialized) {
      console.log("Twitter service not initialized, initializing now");
      await this.initialize();
    }
    
    // Use provided frequency or default
    const interval = (frequencySeconds || this.defaultFrequencySeconds) * 1000;
    
    try {
      // Get stock info
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        console.error(`Stock not found: ${symbol}`);
        return false;
      }
      
      // Stop existing timer if any
      this.stopTweets(symbol);
      
      // Create new state
      const state: StockTweetState = {
        symbol,
        companyName: stock.companyName,
        isActive: true,
        lastTweetTimestamp: null,
        tweetsPublished: 0,
        intervalTimer: null,
        frequencySeconds: frequencySeconds || this.defaultFrequencySeconds
      };
      
      // Create a function explicitly bound to this instance and symbol to prevent context issues on macOS
      const boundFunction = this.publishTweet.bind(this, symbol);
      
      // Set interval and store state
      console.log(`Setting up tweets for ${symbol} every ${interval}ms`);
      // First cancel any existing timer for this symbol
      if (state.intervalTimer) {
        clearInterval(state.intervalTimer);
      }
      // Create a new timer with properly bound function
      state.intervalTimer = setInterval(boundFunction, interval);
      
      // Also schedule a one-time check to verify the timer is working (macOS compatibility)
      setTimeout(() => {
        console.log(`Verifying tweet timer for ${symbol} is active`);
        const currentState = this.activeStocks.get(symbol);
        if (currentState && currentState.isActive && !currentState.intervalTimer) {
          console.log(`Timer not active for ${symbol}, recreating timer`);
          currentState.intervalTimer = setInterval(boundFunction, interval);
        }
      }, 1000);
      this.activeStocks.set(symbol, state);
      
      // Publish immediate tweet
      await this.publishTweet(symbol);
      
      return true;
    } catch (error) {
      console.error(`Error starting tweets for ${symbol}:`, error);
      return false;
    }
  }
  
  /**
   * Stop tweet generation for a symbol
   */
  stopTweets(symbol: string): void {
    const state = this.activeStocks.get(symbol);
    if (state) {
      console.log(`Stopping tweets for ${symbol}`);
      
      if (state.intervalTimer) {
        clearInterval(state.intervalTimer);
        state.intervalTimer = null;
      }
      
      state.isActive = false;
    }
  }
  
  /**
   * Stop all tweet generation
   */
  stopAllTweets(): void {
    console.log("Stopping all tweet generation");
    
    for (const [symbol, state] of this.activeStocks.entries()) {
      if (state.intervalTimer) {
        clearInterval(state.intervalTimer);
        state.intervalTimer = null;
      }
      state.isActive = false;
    }
  }
  
  /**
   * Publish a tweet for a symbol
   */
  private async publishTweet(symbol: string): Promise<boolean> {
    const state = this.activeStocks.get(symbol);
    if (!state || !state.isActive) return false;
    
    try {
      // Generate tweet content
      const content = this.generateTweetContent(state.companyName, symbol);
      const timestamp = new Date();
      
      // Publish via service
      // console.log(`Publishing tweet for ${symbol}`);
      const success = await twitterPublisherService.publishTweet(
        symbol, 
        content, 
        state.companyName, 
        timestamp
      );
      
      // Update state if successful
      if (success) {
        state.lastTweetTimestamp = timestamp;
        state.tweetsPublished++;
        // console.log(`✅ Tweet published for ${symbol}`);
        
        // Note: We're not storing tweets in the database here
        // The TwitterPublisherService only publishes to Solace
        // Database storage is only done in test routes
        // This is intentional - tweets are meant to be ephemeral messages
      } else {
        console.error(`Failed to publish tweet for ${symbol}`);
      }
      
      return success;
    } catch (error) {
      console.error(`Error publishing tweet for ${symbol}:`, error);
      return false;
    }
  }
  
  /**
   * Generate tweet content
   */
  private generateTweetContent(companyName: string, symbol: string): string {
    const templates = [
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
    
    const index = Math.floor(Math.random() * templates.length);
    return templates[index];
  }
  
  /**
   * Set default tweet frequency
   */
  setFrequency(seconds: number): void {
    if (seconds < 5) seconds = 5; // Minimum 5 seconds
    console.log(`Setting default tweet frequency to ${seconds} seconds`);
    this.defaultFrequencySeconds = seconds;
  }
  
  /**
   * Force publish a tweet
   */
  async forceTweet(symbol: string): Promise<boolean> {
    const state = this.activeStocks.get(symbol);
    
    // If no active state, create temporary one
    if (!state) {
      const stock = await storage.getStockBySymbol(symbol);
      if (!stock) {
        console.error(`Stock not found for forced tweet: ${symbol}`);
        return false;
      }
      
      // Create temporary state
      const tempState: StockTweetState = {
        symbol,
        companyName: stock.companyName,
        isActive: true,
        lastTweetTimestamp: null,
        tweetsPublished: 0,
        intervalTimer: null,
        frequencySeconds: this.defaultFrequencySeconds
      };
      
      this.activeStocks.set(symbol, tempState);
      const result = await this.publishTweet(symbol);
      this.activeStocks.delete(symbol);
      return result;
    }
    
    // If state exists, force a publish
    const wasActive = state.isActive;
    state.isActive = true;
    const result = await this.publishTweet(symbol);
    state.isActive = wasActive;
    return result;
  }
  
  /**
   * Get status information
   */
  getStatus(): any {
    const activeSymbols: string[] = [];
    const symbolDetails: Record<string, any> = {};
    
    // Collect active symbols and details
    for (const [symbol, state] of this.activeStocks.entries()) {
      if (state.isActive) {
        activeSymbols.push(symbol);
      }
      
      const lastPublish = state.lastTweetTimestamp 
        ? new Date(state.lastTweetTimestamp).toISOString()
        : 'never';
      
      symbolDetails[symbol] = {
        active: state.isActive,
        frequency: state.frequencySeconds,
        lastPublish,
        count: state.tweetsPublished
      };
    }
    
    return {
      enabled: this.isEnabled,
      initialized: this.isInitialized,
      defaultFrequency: this.defaultFrequencySeconds,
      activeSymbols,
      details: symbolDetails
    };
  }
  
  /**
   * Set active symbols for tweet generation
   * This is used to ensure wildcards and individual stocks are properly synchronized
   */
  setActiveSymbols(symbols: string[]): void {
    console.log(`Setting active symbols for tweet generation: ${symbols.join(', ')}`);
    
    // First get the current set of active symbols
    const currentActive = new Set<string>();
    for (const [symbol, state] of this.activeStocks.entries()) {
      if (state.isActive) {
        currentActive.add(symbol);
      }
    }
    
    // Find symbols to stop (in current but not in new list)
    const symbolsToStop = [...currentActive].filter(s => !symbols.includes(s));
    if (symbolsToStop.length > 0) {
      console.log(`Stopping tweet generation for removed symbols: ${symbolsToStop.join(', ')}`);
      for (const symbol of symbolsToStop) {
        this.stopTweets(symbol);
      }
    }
    
    // Find symbols to start (in new list but not in current)
    const symbolsToStart = symbols.filter(s => !currentActive.has(s));
    if (symbolsToStart.length > 0) {
      console.log(`Starting tweet generation for new symbols: ${symbolsToStart.join(', ')}`);
      for (const symbol of symbolsToStart) {
        // Use default frequency
        this.startTweets(symbol);
      }
    }
  }
  
  /**
   * Set tweet frequency for all active symbols
   */
  setTweetFrequency(seconds: number): void {
    console.log(`Setting tweet frequency to ${seconds} seconds for all active symbols`);
    this.defaultFrequencySeconds = seconds;
    
    // Update frequency for all active symbols
    for (const [symbol, state] of this.activeStocks.entries()) {
      if (state.isActive && state.intervalTimer) {
        // Stop and restart with new frequency
        this.stopTweets(symbol);
        this.startTweets(symbol, seconds);
      }
    }
  }
  
  /**
   * Enable or disable the service
   */
  async setEnabled(enabled: boolean): Promise<void> {
    console.log(`${enabled ? 'Enabling' : 'Disabling'} Twitter service`);
    this.isEnabled = enabled;
    
    if (enabled && !this.isInitialized) {
      // Initialize when enabled if not already initialized
      console.log("Initializing Twitter service upon activation");
      await this.initialize();
    } else if (!enabled) {
      this.stopAllTweets();
    }
  }
  
  /**
   * Start simulation for multiple symbols
   */
  async startSimulation(symbols: string[], frequencySeconds?: number): Promise<boolean> {
    let success = true;
    
    for (const symbol of symbols) {
      const result = await this.startTweets(symbol, frequencySeconds);
      if (!result) success = false;
    }
    
    return success;
  }
  
  /**
   * Stop simulation for multiple symbols
   */
  stopSimulation(symbols?: string[]): void {
    if (!symbols || symbols.length === 0) {
      this.stopAllTweets();
      return;
    }
    
    for (const symbol of symbols) {
      this.stopTweets(symbol);
    }
  }
}

export const simpleTwitterService = new SimpleTwitterService();