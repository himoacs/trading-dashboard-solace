import { 
  InsertSolaceConfig, 
  SolaceConfig, 
  StockDataWithMetadata, 
  StockSelection,
  InsertStock,
  Stock,
  InsertTwitterFeed,
  TwitterFeed,
  InsertNewsFeed,
  NewsFeed,
  InsertEconomicIndicator,
  EconomicIndicator,
  InsertTradingSignal,
  TradingSignal,
  InsertStockSubscription,
  StockSubscription,
  users,
  type User,
  type InsertUser
} from "@shared/schema";
import { DEFAULT_STOCKS } from "../client/src/lib/stockUtils";

export interface IStorage {
  // User methods (from original template)
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Solace configuration methods
  getSolaceConfig(id: number): Promise<SolaceConfig | undefined>;
  getActiveSolaceConfig(configType?: string): Promise<SolaceConfig | undefined>;
  getActiveBackendSolaceConfig(): Promise<SolaceConfig | undefined>;
  createSolaceConfig(config: InsertSolaceConfig): Promise<SolaceConfig>;
  deactivateAllSolaceConfigs(): Promise<void>;
  
  // Stock methods
  getStock(id: number): Promise<Stock | undefined>;
  getStockBySymbol(symbol: string): Promise<Stock | undefined>;
  getAvailableStocks(): Promise<StockSelection[]>;
  getAllStocks(): Promise<Stock[]>;
  createStock(stock: InsertStock): Promise<Stock>;
  updateStockPrice(symbol: string, price: number, percentChange: number): Promise<Stock | undefined>;
  
  // Twitter feed methods
  createTwitterFeed(feed: InsertTwitterFeed): Promise<TwitterFeed>;
  getLatestTwitterFeed(stockId: number): Promise<TwitterFeed | undefined>;
  
  // News feed methods
  createNewsFeed(feed: InsertNewsFeed): Promise<NewsFeed>;
  getLatestNewsFeed(stockId: number): Promise<NewsFeed | undefined>;
  
  // Economic indicator methods
  createEconomicIndicator(indicator: InsertEconomicIndicator): Promise<EconomicIndicator>;
  getLatestEconomicIndicator(stockId: number): Promise<EconomicIndicator | undefined>;
  
  // Trading signal methods
  createTradingSignal(signal: InsertTradingSignal): Promise<TradingSignal>;
  getLatestTradingSignal(stockId: number): Promise<TradingSignal | undefined>;
  
  // Subscription methods
  createStockSubscription(subscription: InsertStockSubscription): Promise<StockSubscription>;
  getStockSubscriptions(stockId: number): Promise<StockSubscription[]>;
  
  // Combined market data for frontend
  getMarketData(symbols: string[]): Promise<StockDataWithMetadata[]>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private solaceConfigs: Map<number, SolaceConfig>;
  private stocks: Map<number, Stock>;
  private twitterFeeds: Map<number, TwitterFeed[]>;
  private newsFeeds: Map<number, NewsFeed[]>;
  private economicIndicators: Map<number, EconomicIndicator[]>;
  private tradingSignals: Map<number, TradingSignal[]>;
  private stockSubscriptions: Map<number, StockSubscription[]>;
  
  private userIdCounter: number;
  private configIdCounter: number;
  private stockIdCounter: number;
  private twitterFeedIdCounter: number;
  private newsFeedIdCounter: number;
  private economicIndicatorIdCounter: number;
  private tradingSignalIdCounter: number;
  private subscriptionIdCounter: number;

  constructor() {
    this.users = new Map();
    this.solaceConfigs = new Map();
    this.stocks = new Map();
    this.twitterFeeds = new Map();
    this.newsFeeds = new Map();
    this.economicIndicators = new Map();
    this.tradingSignals = new Map();
    this.stockSubscriptions = new Map();
    
    this.userIdCounter = 1;
    this.configIdCounter = 1;
    this.stockIdCounter = 1;
    this.twitterFeedIdCounter = 1;
    this.newsFeedIdCounter = 1;
    this.economicIndicatorIdCounter = 1;
    this.tradingSignalIdCounter = 1;
    this.subscriptionIdCounter = 1;
    
    // Initialize with default stocks
    this.initializeDefaultStocks();
  }

  private initializeDefaultStocks() {
    // Initialize market indices first
    const marketIndices = [
      { symbol: 'SPX', companyName: 'S&P 500 Index' },
      { symbol: 'DJI', companyName: 'Dow Jones Industrial Average' },
      { symbol: 'NDX', companyName: 'NASDAQ 100 Index' }
    ];
    
    // Add market indices to stocks
    marketIndices.forEach(index => {
      const id = this.stockIdCounter++;
      this.stocks.set(id, {
        id,
        symbol: index.symbol,
        companyName: index.companyName,
        currentPrice: 1000, // Initial placeholder value for indices
        percentChange: 0,
        lastUpdated: new Date()
      });
      // console.log(`Added market index to storage: ${index.symbol}`);
    });
    
    // Add other stocks
    DEFAULT_STOCKS.forEach(stock => {
      const id = this.stockIdCounter++;
      this.stocks.set(id, {
        id,
        symbol: stock.symbol,
        companyName: stock.companyName,
        currentPrice: null,
        percentChange: null,
        lastUpdated: new Date()
      });
    });
  }

  // User methods (from original template)
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userIdCounter++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Solace configuration methods
  async getSolaceConfig(id: number): Promise<SolaceConfig | undefined> {
    return this.solaceConfigs.get(id);
  }

  async getActiveSolaceConfig(configType: string = 'frontend'): Promise<SolaceConfig | undefined> {
    return Array.from(this.solaceConfigs.values())
      .find(config => config.isActive && 
        (config.configType === configType || config.configType === 'both'));
  }
  
  async getActiveBackendSolaceConfig(): Promise<SolaceConfig | undefined> {
    return this.getActiveSolaceConfig('backend');
  }

  async createSolaceConfig(insertConfig: InsertSolaceConfig): Promise<SolaceConfig> {
    // Deactivate all existing configs if this one will be active
    if (insertConfig.isActive) {
      // Only deactivate configs of the same type
      if (insertConfig.configType) {
        await this.deactivateConfigsByType(insertConfig.configType);
      } else {
        await this.deactivateAllSolaceConfigs();
      }
    }
    
    const id = this.configIdCounter++;
    const configType = insertConfig.configType || 'frontend';
    
    const config: SolaceConfig = { 
      ...insertConfig, 
      id,
      configType,
      tcpPort: insertConfig.tcpPort || '55555',
      createdAt: new Date(),
      isActive: insertConfig.isActive !== undefined ? insertConfig.isActive : true
    };
    
    this.solaceConfigs.set(id, config);
    return config;
  }
  
  async deactivateConfigsByType(configType: string): Promise<void> {
    for (const [id, config] of this.solaceConfigs.entries()) {
      if (config.configType === configType || configType === 'both' || config.configType === 'both') {
        this.solaceConfigs.set(id, { ...config, isActive: false });
      }
    }
  }

  async deactivateAllSolaceConfigs(): Promise<void> {
    for (const [id, config] of this.solaceConfigs.entries()) {
      this.solaceConfigs.set(id, { ...config, isActive: false });
    }
  }

  // Stock methods
  async getStock(id: number): Promise<Stock | undefined> {
    return this.stocks.get(id);
  }

  async getStockBySymbol(symbol: string): Promise<Stock | undefined> {
    return Array.from(this.stocks.values()).find(
      stock => stock.symbol.toLowerCase() === symbol.toLowerCase()
    );
  }

  async getAvailableStocks(): Promise<StockSelection[]> {
    return Array.from(this.stocks.values()).map(stock => ({
      symbol: stock.symbol,
      companyName: stock.companyName
    }));
  }
  
  async getAllStocks(): Promise<Stock[]> {
    return Array.from(this.stocks.values());
  }

  async createStock(insertStock: InsertStock): Promise<Stock> {
    const id = this.stockIdCounter++;
    const stock: Stock = {
      ...insertStock,
      id,
      currentPrice: insertStock.currentPrice || null,
      percentChange: insertStock.percentChange || null,
      lastUpdated: new Date()
    };
    
    this.stocks.set(id, stock);
    return stock;
  }

  async updateStockPrice(symbol: string, price: number, percentChange: number): Promise<Stock | undefined> {
    const stock = await this.getStockBySymbol(symbol);
    
    if (!stock) return undefined;
    
    const updatedStock: Stock = {
      ...stock,
      currentPrice: price,
      percentChange: percentChange,
      lastUpdated: new Date()
    };
    
    this.stocks.set(stock.id, updatedStock);
    return updatedStock;
  }

  // Twitter feed methods
  async createTwitterFeed(insertFeed: InsertTwitterFeed): Promise<TwitterFeed> {
    const id = this.twitterFeedIdCounter++;
    // Create the feed with explicitly set properties to match TwitterFeed type
    const feed: TwitterFeed = {
      id,
      stockId: insertFeed.stockId,
      content: insertFeed.content,
      sentiment: insertFeed.sentiment === undefined ? null : insertFeed.sentiment,
      timestamp: new Date()
    };
    
    if (!this.twitterFeeds.has(feed.stockId)) {
      this.twitterFeeds.set(feed.stockId, []);
    }
    
    const feeds = this.twitterFeeds.get(feed.stockId)!;
    feeds.push(feed);
    this.twitterFeeds.set(feed.stockId, feeds);
    
    return feed;
  }

  async getLatestTwitterFeed(stockId: number): Promise<TwitterFeed | undefined> {
    const feeds = this.twitterFeeds.get(stockId) || [];
    if (feeds.length === 0) return undefined;
    
    // Sort by timestamp descending and get the latest one
    return feeds.sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    )[0];
  }

  // News feed methods
  async createNewsFeed(insertFeed: InsertNewsFeed): Promise<NewsFeed> {
    const id = this.newsFeedIdCounter++;
    const feed: NewsFeed = {
      ...insertFeed,
      id,
      timestamp: new Date()
    };
    
    if (!this.newsFeeds.has(feed.stockId)) {
      this.newsFeeds.set(feed.stockId, []);
    }
    
    const feeds = this.newsFeeds.get(feed.stockId)!;
    feeds.push(feed);
    this.newsFeeds.set(feed.stockId, feeds);
    
    return feed;
  }

  async getLatestNewsFeed(stockId: number): Promise<NewsFeed | undefined> {
    const feeds = this.newsFeeds.get(stockId) || [];
    if (feeds.length === 0) return undefined;
    
    // Sort by timestamp descending and get the latest one
    return feeds.sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    )[0];
  }

  // Economic indicator methods
  async createEconomicIndicator(insertIndicator: InsertEconomicIndicator): Promise<EconomicIndicator> {
    const id = this.economicIndicatorIdCounter++;
    const indicator: EconomicIndicator = {
      ...insertIndicator,
      id,
      timestamp: new Date()
    };
    
    if (!this.economicIndicators.has(indicator.stockId)) {
      this.economicIndicators.set(indicator.stockId, []);
    }
    
    const indicators = this.economicIndicators.get(indicator.stockId)!;
    indicators.push(indicator);
    this.economicIndicators.set(indicator.stockId, indicators);
    
    return indicator;
  }

  async getLatestEconomicIndicator(stockId: number): Promise<EconomicIndicator | undefined> {
    const indicators = this.economicIndicators.get(stockId) || [];
    if (indicators.length === 0) return undefined;
    
    // Sort by timestamp descending and get the latest one
    return indicators.sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    )[0];
  }

  // Trading signal methods
  async createTradingSignal(insertSignal: InsertTradingSignal): Promise<TradingSignal> {
    const id = this.tradingSignalIdCounter++;
    const signal: TradingSignal = {
      ...insertSignal,
      id,
      timestamp: new Date(),
      reasoning: insertSignal.reasoning || null
    };
    
    if (!this.tradingSignals.has(signal.stockId)) {
      this.tradingSignals.set(signal.stockId, []);
    }
    
    const signals = this.tradingSignals.get(signal.stockId)!;
    signals.push(signal);
    this.tradingSignals.set(signal.stockId, signals);
    
    return signal;
  }

  async getLatestTradingSignal(stockId: number): Promise<TradingSignal | undefined> {
    const signals = this.tradingSignals.get(stockId) || [];
    if (signals.length === 0) return undefined;
    
    // Sort by timestamp descending and get the latest one
    return signals.sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    )[0];
  }

  // Stock subscription methods
  async createStockSubscription(insertSubscription: InsertStockSubscription): Promise<StockSubscription> {
    const id = this.subscriptionIdCounter++;
    const subscription: StockSubscription = {
      ...insertSubscription,
      id,
      createdAt: new Date(),
      isActive: insertSubscription.isActive !== undefined ? insertSubscription.isActive : true
    };
    
    if (!this.stockSubscriptions.has(subscription.stockId)) {
      this.stockSubscriptions.set(subscription.stockId, []);
    }
    
    const subscriptions = this.stockSubscriptions.get(subscription.stockId)!;
    subscriptions.push(subscription);
    this.stockSubscriptions.set(subscription.stockId, subscriptions);
    
    return subscription;
  }

  async getStockSubscriptions(stockId: number): Promise<StockSubscription[]> {
    return this.stockSubscriptions.get(stockId) || [];
  }

  // Combined market data for frontend
  async getMarketData(symbols: string[]): Promise<StockDataWithMetadata[]> {
    const marketData: StockDataWithMetadata[] = [];
    
    for (const symbol of symbols) {
      const stock = await this.getStockBySymbol(symbol);
      
      if (!stock) continue;
      
      // We intentionally DO NOT retrieve Twitter feeds directly anymore
      // Twitter data should only come from signal/output topic via WebSockets
      
      // Get the latest trading signal for this stock
      const latestSignal = await this.getLatestTradingSignal(stock.id);

      // Get the latest news for this stock
      const latestNews = await this.getLatestNewsFeed(stock.id);

      // Get the latest economic indicator for this stock
      const latestIndicator = await this.getLatestEconomicIndicator(stock.id);
      
      marketData.push({
        id: stock.id,
        symbol: stock.symbol,
        companyName: stock.companyName,
        currentPrice: stock.currentPrice,
        percentChange: stock.percentChange,
        // Do not include lastTweet in initial data, this will only come from signal/output
        lastTweet: null,
        tradingSignal: latestSignal ? {
          signal: latestSignal.signal,
          confidence: latestSignal.confidence,
          timestamp: latestSignal.timestamp
        } : null,
        latestNews: latestNews ? {
          headline: latestNews.headline,
          summary: latestNews.summary,
          source: latestNews.source,
          url: latestNews.url,
          timestamp: latestNews.timestamp
        } : null,
        economicIndicator: latestIndicator ? {
          indicatorType: latestIndicator.indicatorType,
          value: latestIndicator.value,
          previousValue: latestIndicator.previousValue,
          percentChange: latestIndicator.percentChange,
          timestamp: latestIndicator.timestamp
        } : null
      });
    }
    
    return marketData;
  }
}

export const storage = new MemStorage();
