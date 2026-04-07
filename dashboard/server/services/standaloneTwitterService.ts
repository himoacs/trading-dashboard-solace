/**
 * Standalone Twitter Service
 * 
 * A completely isolated implementation that handles Twitter feed publishing
 * with direct Solace connectivity. This service:
 * 
 * 1. Maintains its own dedicated connection to Solace
 * 2. Publishes tweets at specified intervals for selected symbols
 * 3. Has no dependencies on other services to avoid interference
 * 
 * This implementation is deliberately minimal to ensure reliable timing.
 */

import solace from 'solclientjs';
import { twitterPublisherService } from './twitterPublisherService';
import { solaceService } from './solaceService';
import { SolaceConnection } from '@shared/schema';

interface TweetState {
  symbol: string;
  companyName: string;
  isActive: boolean;
  interval: NodeJS.Timeout | null;
  lastPublished: Date | null;
  lastPublishedTimestamp: number;  // Unix timestamp (ms) of last publication
  count: number;
  frequencySeconds: number;
}

class StandaloneTwitterService {
  private tweetStates: Map<string, TweetState> = new Map();
  private defaultFrequencySeconds: number = 60;
  
  // Company name mapping for popular stocks
  private readonly companyNames: Record<string, string> = {
    'AAPL': 'Apple',
    'MSFT': 'Microsoft',
    'GOOG': 'Google',
    'AMZN': 'Amazon',
    'META': 'Meta',
    'TSLA': 'Tesla',
    'NVDA': 'NVIDIA',
    'JPM': 'JPMorgan Chase',
    'JNJ': 'Johnson & Johnson',
    'V': 'Visa',
    'UNH': 'UnitedHealth',
    'PG': 'Procter & Gamble',
    'MA': 'Mastercard',
    'HD': 'Home Depot',
    'BAC': 'Bank of America',
    'XOM': 'Exxon Mobil',
    'AVGO': 'Broadcom',
    'COST': 'Costco',
    'ABBV': 'AbbVie',
    'PFE': 'Pfizer',
    'CSCO': 'Cisco',
    'MRK': 'Merck',
    'TMO': 'Thermo Fisher',
    'ADBE': 'Adobe',
    'CRM': 'Salesforce',
    'ABT': 'Abbott',
    'MCD': 'McDonald\'s',
    'NFLX': 'Netflix',
    'CMCSA': 'Comcast',
    'WFC': 'Wells Fargo',
    'DIS': 'Disney',
    'AMD': 'AMD',
    'INTC': 'Intel',
    'VZ': 'Verizon',
    'ORCL': 'Oracle',
    'PEP': 'PepsiCo',
    'KO': 'Coca-Cola',
    'T': 'AT&T',
    'SBUX': 'Starbucks',
    'IBM': 'IBM',
    'GS': 'Goldman Sachs',
    'AXP': 'American Express',
    'CAT': 'Caterpillar',
    'CVX': 'Chevron',
    'BLK': 'BlackRock',
    'PYPL': 'PayPal',
    'MRNA': 'Moderna',
    'NKE': 'Nike',
    'MS': 'Morgan Stanley',
    'CVS': 'CVS Health'
  };
  
  constructor() {
    // This service no longer manages its own connection.
    console.log("StandaloneTwitterService initialized - will use twitterPublisherService for publishing.");
  }

  /**
   * This service no longer manages its own connection.
   * The main twitterPublisherService handles the connection lifecycle.
   */

  setFrequency(seconds: number): void {
    if (seconds < 10) {
      console.warn(`Twitter feed frequency of ${seconds}s is too low, setting to minimum of 10s`);
      this.defaultFrequencySeconds = 10;
    } else {
      this.defaultFrequencySeconds = seconds;
      console.log(`Twitter feed default frequency set to ${seconds} seconds`);
    }
    
    // Update frequency for all active tweet states
    for (const state of this.tweetStates.values()) {
      if (state.isActive) {
        this.updateTweetFrequency(state.symbol, this.defaultFrequencySeconds);
      }
    }
  }

  private updateTweetFrequency(symbol: string, frequencySeconds: number): void {
    const state = this.tweetStates.get(symbol);
    if (!state) return;
    
    state.frequencySeconds = frequencySeconds;
    console.log(`Updated tweet frequency for ${symbol} to ${frequencySeconds} seconds`);
  }

  async startTweets(symbol: string, frequencySeconds?: number): Promise<boolean> {
    const companyName = this.companyNames[symbol] || symbol;
    let state = this.tweetStates.get(symbol);
    
    if (!state) {
      state = {
        symbol,
        companyName,
        isActive: false,
        interval: null,
        lastPublished: null,
        lastPublishedTimestamp: 0,
        count: 0,
        frequencySeconds: frequencySeconds || this.defaultFrequencySeconds
      };
      this.tweetStates.set(symbol, state);
    }
    
    if (state.isActive) {
      if (frequencySeconds && frequencySeconds !== state.frequencySeconds) {
        this.updateTweetFrequency(symbol, frequencySeconds);
      }
      return true;
    }
    
    const actualFrequency = frequencySeconds || this.defaultFrequencySeconds;
    state.frequencySeconds = actualFrequency;
    
    try {
      await this.publishTweet(symbol);
      
      state.interval = setInterval(() => {
        const now = Date.now();
        const lastUpdate = state.lastPublishedTimestamp || 0;
        const elapsedSinceLastUpdate = now - lastUpdate;
        const minimumInterval = state.frequencySeconds * 1000;
        
        if (elapsedSinceLastUpdate >= minimumInterval) {
          this.publishTweet(symbol).catch(err => {
            console.error(`Error publishing tweet for ${symbol}:`, err);
          });
        }
      }, 1000);
      
      state.isActive = true;
      console.log(`Started Twitter feed for ${symbol} with ${actualFrequency}s frequency`);
      
      return true;
    } catch (error) {
      console.error(`Error starting tweets for ${symbol}: ${error}`);
      return false;
    }
  }

  stopTweets(symbol: string): void {
    const state = this.tweetStates.get(symbol);
    if (!state) {
      console.log(`No tweet state found for ${symbol}`);
      return;
    }
    
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    
    state.isActive = false;
    console.log(`Stopped Twitter feed for ${symbol}`);
  }

  stopAllTweets(): void {
    console.log("Stopping all Twitter feeds");
    
    for (const [symbol, state] of this.tweetStates.entries()) {
      if (state.isActive) {
        this.stopTweets(symbol);
      }
    }
  }

  stopAllSimulation(): void {
    console.log('Stopping all Twitter simulations via stopAllSimulation()');
    this.stopAllTweets();
  }

  async startSimulation(symbols: string[], frequencySeconds?: number): Promise<boolean> {
    if (!symbols || symbols.length === 0) {
      console.log("No symbols provided for Twitter simulation");
      return false;
    }
    
    console.log(`Starting Twitter simulation for ${symbols.length} symbols with ${frequencySeconds || this.defaultFrequencySeconds}s frequency`);
    
    const results = await Promise.all(
      symbols.map(symbol => this.startTweets(symbol, frequencySeconds))
    );
    
    return results.every(result => result === true);
  }

  stopSimulation(symbols?: string[]): void {
    if (!symbols || symbols.length === 0) {
      this.stopAllTweets();
      return;
    }
    
    console.log(`Stopping Twitter simulation for ${symbols.length} symbols`);
    
    symbols.forEach(symbol => this.stopTweets(symbol));
  }

  async forceTweet(symbol: string): Promise<boolean> {
    console.log(`Forcing tweet for ${symbol}`);
    
    try {
      if (typeof twitterPublisherService !== 'undefined' && twitterPublisherService) {
        if (typeof twitterPublisherService.isFeedActive === 'function' && !twitterPublisherService.isFeedActive()) {
          console.log(`✅ Force activating TwitterPublisherService feed for ${symbol}`);
          
          if (typeof twitterPublisherService.startFeed === 'function') {
            await twitterPublisherService.startFeed([symbol], 60);
          }
          
          if (typeof twitterPublisherService.setPublishingEnabled === 'function') {
            twitterPublisherService.setPublishingEnabled(true);
          }
        }
      }
      
      let state = this.tweetStates.get(symbol);
      
      if (!state) {
        state = {
          symbol,
          companyName: this.companyNames[symbol] || symbol,
          isActive: false,
          interval: null,
          lastPublished: null,
          lastPublishedTimestamp: 0,
          count: 0,
          frequencySeconds: this.defaultFrequencySeconds
        };
        this.tweetStates.set(symbol, state);
      }
      
      return await this.publishTweet(symbol);
    } catch (error) {
      console.error(`Error forcing tweet for ${symbol}: ${error}`);
      return false;
    }
  }

  private async publishTweet(symbol: string): Promise<boolean> {
    // CRITICAL FIX: Do not attempt to publish if the backend publisher is not connected.
    if (!twitterPublisherService.isConnected()) {
      console.warn(`⚠️ Cannot publish tweet for ${symbol}, Twitter publisher service is not connected.`);
      return false;
    }

    const state = this.tweetStates.get(symbol);
    if (!state) {
      console.log(`No active tweet state for ${symbol}, skipping publication`);
      return false;
    }
    
    // Check if enough time has passed since the last publication
    const now = Date.now();
    const timeSinceLastPublish = now - (state.lastPublishedTimestamp || 0);
    const requiredInterval = state.frequencySeconds * 1000;
    
    if (timeSinceLastPublish < requiredInterval) {
      return false; // Not time yet, skip
    }
    
    const companyName = this.companyNames[symbol] || symbol;
    const tweetContent = this.generateTweetContent(companyName, symbol);
    
    const message = {
      symbol: symbol,
      companyName: companyName,
      content: tweetContent,
      timestamp: new Date().toISOString()
    };
    
    const topic = `twitter-feed/${symbol}`;

    try {
      // Directly use the main publisher service. No need for a separate connection.
      await twitterPublisherService.publish(topic, message);
      
      // Update state
      state.count++;
      state.lastPublished = new Date();
      state.lastPublishedTimestamp = now;
      
      return true;
    } catch (error) {
      console.error(`Failed to publish tweet for ${symbol} via twitterPublisherService:`, error);
      return false;
    }
  }

  private generateTweetContent(companyName: string, symbol: string): string {
    const scenarios = [
      `Just saw the latest news on ${companyName} ($${symbol}). This could be interesting for their stock price! #investing #markets`,
      `$${symbol} is making moves today. Keep an eye on ${companyName} for potential opportunities. #stocks #trading`,
      `Market chatter about ${companyName} ($${symbol}) is picking up. Something brewing? #stockmarket #investing`,
      `Analysts are updating their outlook on ${companyName} ($${symbol}). Worth watching closely! #stocks #analysis`,
      `Just heard some interesting insights about ${companyName}'s ($${symbol}) future plans. #investing #stocktips`,
      `$${symbol} technical indicators showing interesting patterns. ${companyName} might be worth a closer look! #technicalanalysis`,
      `Industry trends looking favorable for ${companyName} ($${symbol}). #sectoranalysis #stocks`,
      `${companyName} ($${symbol}) management team making strategic moves. This could affect performance. #investing #leadership`,
      `Supply chain updates might impact ${companyName} ($${symbol}) in coming quarters. #logistics #stocks`,
      `New product rumors circulating about ${companyName} ($${symbol}). Innovation pipeline looks promising! #innovation #investing`,
      `Q${Math.floor(Math.random() * 4) + 1} earnings approaching for ${companyName} ($${symbol}). Expectations running high! #earnings #stocks`,
      `Market sentiment on ${companyName} ($${symbol}) seems to be shifting. #marketsentiment #trading`,
      `Interesting options activity on $${symbol} today. ${companyName} attracting attention? #options #trading`,
      `Regulatory developments could affect ${companyName} ($${symbol}) in the near term. #regulation #stocks`,
      `Global economic factors creating both challenges and opportunities for ${companyName} ($${symbol}). #globalmarkets #investing`,
      `Competition heating up in ${companyName}'s ($${symbol}) space. Market share battle worth watching! #competition #stocks`,
      `Insider buying/selling patterns for ${companyName} ($${symbol}) showing interesting trends. #insidertrading #stockmarket`,
      `${companyName} ($${symbol}) expanding into new markets. Growth potential? #expansion #investing`,
      `Consumer sentiment toward ${companyName} ($${symbol}) products changing. Could impact sales. #consumertrends #stocks`,
      `ESG performance metrics looking strong for ${companyName} ($${symbol}). #sustainableinvesting #esg`,
      `Analysts have upgraded their rating for ${companyName}. #${symbol} $${symbol}`
    ];
    return scenarios[Math.floor(Math.random() * scenarios.length)];
  }
  
  getStatus(): any {
    const activeSymbols = Array.from(this.tweetStates.entries())
      .filter(([_, state]) => state.isActive)
      .map(([symbol]) => symbol);
    
    const details = Object.fromEntries(this.tweetStates.entries());
    
    return {
      connected: true,
      connecting: false,
      activeCount: activeSymbols.length,
      totalSymbols: this.tweetStates.size,
      defaultFrequencySeconds: this.defaultFrequencySeconds,
      totalTweetsPublished: Array.from(this.tweetStates.values()).reduce((sum, state) => sum + state.count, 0),
      activeSymbols: activeSymbols,
      details: details
    };
  }
}

export const standaloneTwitterService = new StandaloneTwitterService();