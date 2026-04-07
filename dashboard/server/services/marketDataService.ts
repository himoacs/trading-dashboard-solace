import { solaceService } from "./solaceService";
import { publisherSolaceService } from "./publisherSolaceService";
import { storage } from "../storage";

class MarketDataService {
  private simulationInterval: NodeJS.Timeout | null = null;
  private symbols: string[] = [];
  private allAvailableStocks: string[] = []; // All stocks from storage
  private lastUpdateTime: Record<string, number> = {}; // Track last update time for each symbol
  private publisherConnected: boolean = false;
  private updateFrequencyMs: number = 100; // Changed default frequency to 100ms
  private _lastPublishSkippedLogTime: number = 0;
  
  constructor() {
    // SECURITY FIX: Don't automatically connect to Solace at startup
    // We will only connect when the user provides credentials
    console.log("Market data service initialized - NO automatic connection to Solace");
    console.log("Connection will only be established when user provides credentials via the UI");
    
    // Initialize the simulation for updating local market data (without publishing)
    this.initContinuousDataSimulation();
    
    // Make sure publishing is stopped by default
    publisherSolaceService.stopFeed();
    console.log("Market data service initialized - publishing is STOPPED by default");
  }
  
  /**
   * Connect the dedicated publisher service to Solace
   * This method now requires explicit user-provided credentials
   * @param config The Solace connection configuration provided by user
   */
  public async connectPublisher(config?: any): Promise<void> {
    try {
      if (!config) {
        console.log("SECURITY: No credentials provided for market data publisher");
        console.log("Cannot connect publisher without user-provided credentials");
        this.publisherConnected = false;
        return;
      }
      
      console.log("Connecting dedicated market data publisher using user-provided credentials...");
      await publisherSolaceService.connect(config);
      this.publisherConnected = publisherSolaceService.isConnected();
      console.log(`Market data publisher connected to Solace: ${this.publisherConnected}`);
    } catch (error) {
      console.error("Failed to connect market data publisher to Solace:", error);
      this.publisherConnected = false;
      throw error;
    }
  }
  
  /**
   * Initialize continuous data simulation for all available stocks and market indices
   * This runs automatically when the service starts and continues running
   */
  private async initContinuousDataSimulation(): Promise<void> {
    try {
      // Get all available stocks from storage
      const availableStocksFromStorage = await storage.getAvailableStocks();
      
      // Define known market index symbols to exclude from regular stock processing
      const knownIndexSymbols = ['SPX', 'DJI', 'NDX', 'FTSE', 'N225', 'HSI'];
      
      // Filter out known index symbols
      const equityStocks = availableStocksFromStorage.filter(
        stock => !knownIndexSymbols.includes(stock.symbol.toUpperCase())
      );
      
      this.allAvailableStocks = equityStocks.map(stock => stock.symbol);
      
      console.log(`Initializing continuous market data simulation for ${this.allAvailableStocks.length} equity stocks`);
      
      // Initial market data update for all stocks and indices
      await this.updateAllData();
      
      // Explicitly bind the method to this instance to ensure proper context on macOS
      const boundUpdateAllData = this.updateAllData.bind(this);
      
      // Use the configured updateFrequencyMs directly for the simulation interval
      // This ensures the data generation and publication frequency are in sync
      this.simulationInterval = setInterval(
        boundUpdateAllData,
        this.updateFrequencyMs // Generate and publish data at the configured frequency
      );
      
      console.log(`Market data simulation running, frequency: ${this.updateFrequencyMs}ms`);
    } catch (error) {
      console.error("Error initializing continuous data simulation:", error);
    }
  }
  
  /**
   * Set the update frequency for market data in milliseconds
   * @param frequencyMs How often to publish market data (in milliseconds)
   * @returns The current update frequency in milliseconds
   */
  setUpdateFrequencyMs(frequencyMs: number): number {
    // Market data can use very fast frequencies (10ms to 5000ms)
    if (frequencyMs < 10 || frequencyMs > 5000) {
      console.warn(`Invalid frequency ${frequencyMs}ms - must be between 10 and 5000 milliseconds for market data. Using default.`);
      return this.updateFrequencyMs;
    }
    
    const oldFrequency = this.updateFrequencyMs;
    this.updateFrequencyMs = frequencyMs;
    
    console.log(`Market data update frequency changed from ${oldFrequency}ms to ${frequencyMs}ms`);
    
    // Clear and restart the simulation interval with the new frequency
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      
      // Explicitly bind the method to this instance to ensure proper context on macOS
      const boundUpdateAllData = this.updateAllData.bind(this);
      
      this.simulationInterval = setInterval(
        boundUpdateAllData,
        this.updateFrequencyMs
      );
      
      console.log(`Restarted market data simulation, new frequency: ${frequencyMs}ms`);
    }
    
    return this.updateFrequencyMs;
  }
  
  /**
   * Set the update frequency for market data in seconds (legacy support)
   * @param frequencySeconds How often to publish market data (in seconds)
   * @returns The current update frequency in seconds
   */
  setUpdateFrequency(frequencySeconds: number): number {
    // Convert seconds to milliseconds and use the new method
    const frequencyMs = frequencySeconds * 1000;
    this.setUpdateFrequencyMs(frequencyMs);
    
    // Return the current frequency in seconds for backward compatibility
    return Math.round(this.updateFrequencyMs / 1000);
  }
  
  /**
   * Get the current market data service status
   * @returns The current status including update frequency
   */
  getStatus(): {
    updateFrequency: number;
    updateFrequencyMs: number;
    activeSymbols: string[];
    publisherConnected: boolean;
  } {
    return {
      updateFrequency: Math.round(this.updateFrequencyMs / 1000), // in seconds for compatibility
      updateFrequencyMs: this.updateFrequencyMs, // in milliseconds
      activeSymbols: this.symbols,
      publisherConnected: this.publisherConnected
    };
  }
  
  /**
   * Update stocks and market indices
   * Improved to be more selective and efficient
   * Market indices are only updated when specifically requested by client
   */
  // Add timestamp tracking for throttled logging
  private _lastStatusLogTime: number = 0;
  
  private async updateAllData(): Promise<void> {
    // FIXED: ONLY check the backend publisher's connection status - never use frontend
    const isPublisherConnected = this.publisherConnected;
    
    const publisherStatus = publisherSolaceService.getConnectionStatus();
    const isPublisherFeedActive = publisherStatus && publisherStatus.feedActive === true;
    const hasValidConnection = publisherStatus.connected && 
                              publisherStatus.connectionInfo?.isConfigPresent === true;
    
    const currentTime = Date.now();
    const timeSinceLastLog = currentTime - this._lastStatusLogTime;
    const shouldLogStatus = timeSinceLastLog > 30000;

    // ADD PRE-CHECK LOGGING HERE
    if (shouldLogStatus) {
      // console.log(`[MarketDataService.updateAllData PRE-CHECK] publisherStatus.connected: ${publisherStatus.connected}, publisherStatus.connectionInfo?.isConfigPresent: ${publisherStatus.connectionInfo?.isConfigPresent}, hasValidConnection: ${hasValidConnection}, isPublisherFeedActive: ${isPublisherFeedActive}`);
    }
    
    if (!hasValidConnection || !isPublisherFeedActive) {
      if (shouldLogStatus) {
        console.log("Market data processing skipped - requires valid Solace connection AND active feed");
        this._lastStatusLogTime = currentTime;
      }
      return;
    }
    
    // console.log("Using dedicated market data publisher service for publishing with valid user credentials"); // Reduced verbosity
    
    // Market indices have been removed, no need to track them
    
    // IMPROVED BEHAVIOR: Process user-selected symbols first for prioritized updates,
    // then update a small batch of non-selected symbols for storage ONLY (not publishing)
    // This ensures user selections are respected while maintaining background data updates

    // Process all stocks in small batches to avoid overwhelming the system
    const batchSize = 50;
    const totalStocks = this.allAvailableStocks.length;
    
    // Determine how many batches to process
    const batches = Math.ceil(totalStocks / batchSize);
    
    // Process a different batch each time updateAllData is called
    // This ensures all stocks get updated over time
    const currentBatchIndex = Math.floor(Date.now() / 1000) % batches;
    const startIndex = currentBatchIndex * batchSize;
    const endIndex = Math.min(startIndex + batchSize, totalStocks);
    
    // Get the current batch of stocks to update
    const stocksInCurrentBatch = this.allAvailableStocks.slice(startIndex, endIndex);
    
    // Track which symbols we've already processed to avoid duplicate updates
    const processedSymbols = new Set<string>();
    
    // First, process user-selected symbols if any (higher priority)
    if (stocksInCurrentBatch.length > 0) {
      if (Math.random() < 0.1) { // Log more frequently now that it's batched
        // console.log(`[MarketDataService.updateAllData] Processing batch ${currentBatchIndex + 1}/${batches} with ${stocksInCurrentBatch.length} symbols.`);
      }
      
      // Update symbols in the current batch
      for (const symbol of stocksInCurrentBatch) { // Iterate over the current batch
        try {
          // Determine if the symbol from the batch is in the user-selected list (this.symbols)
          // For now, let's assume if it's in a batch, it's intended for update.
          // The definition of "selected" might need refinement if this.symbols is used for true user selection.
          // For this fix, we'll pass 'true' for isSymbolSelected if it's from a batch being processed.
          await this.updateSymbolMarketData(symbol, true); // Pass true for isSymbolSelected for batched items
          
          processedSymbols.add(symbol);
        } catch (error) {
          console.error(`Error updating data for ${symbol} in batch:`, error);
        }
      }
    }

    // CRITICAL SECURITY FIX: NEVER update non-selected stocks
    // This completely removes the practice of updating market data for stocks the user didn't select
    // Removed excessive logging
  }
  
  /**
   * Start market data simulation for the specified symbols
   * Note: This method now just adds symbols to the tracking list,
   * actual publishing happens continuously in the background
   */
  async startSimulation(symbols: string[], updateFrequencySeconds: number): Promise<void> {
    // Ensure allAvailableStocks is populated
    if (this.allAvailableStocks.length === 0) {
      try {
        const availableStocksFromStorage = await storage.getAvailableStocks();
        this.allAvailableStocks = availableStocksFromStorage.map(stock => stock.symbol);
        console.log(`MarketDataService: Loaded ${this.allAvailableStocks.length} available stocks from storage.`);
      } catch (error) {
        console.error("MarketDataService: Error loading available stocks from storage:", error);
        // If loading fails, we can't proceed with setting this.symbols to all stocks.
        // Fallback to using provided symbols or an empty array.
        this.symbols = [...new Set([...symbols])]; // Use provided symbols as a fallback
        console.warn(`MarketDataService: Fallback - tracking ${this.symbols.length} provided symbols due to storage error.`);
        // We might want to return or throw an error here depending on desired behavior
      }
    }

    // Set this.symbols to all available stock symbols
    // The 'symbols' argument to this function is now effectively ignored for populating this.symbols
    // if allAvailableStocks was successfully loaded.
    if (this.allAvailableStocks.length > 0) {
      this.symbols = [...this.allAvailableStocks];
      console.log(`MarketDataService: Now tracking all ${this.symbols.length} available stocks for publishing.`);
    } else if (this.symbols.length === 0 && symbols.length > 0) {
      // This case handles if allAvailableStocks is empty (e.g. initial load failed) but symbols were provided.
      console.log(`MarketDataService: allAvailableStocks is empty, but ${symbols.length} symbols were provided to startSimulation. Tracking these.`);
      this.symbols = [...new Set([...symbols])];
    } else {
      console.log(`MarketDataService: No stocks to track (allAvailableStocks is empty and no symbols provided to startSimulation).`);
      this.symbols = []; // Ensure it's an empty array if no stocks are available or provided
    }
    
    // The 'updateFrequencySeconds' argument is not directly used here anymore to set an interval,
    // as the main simulation interval is managed by initContinuousDataSimulation and setUpdateFrequencyMs.
    // However, it might be used by the caller (publisherSolaceService) to set its own frequency.
    console.log("Added symbols to tracking list, but NOT activating market data feed - user must activate manually");
    
    // Log the current feed status
    const feedStatus = publisherSolaceService.getConnectionStatus();
    console.log("Current feed status:", feedStatus);
    
    // FIXED: ONLY check the backend publisher's connection status
    const isPublisherConnected = this.publisherConnected;
    
    console.log(`Backend publisher connection status: ${isPublisherConnected ? 'Connected' : 'Not connected'}`);
    
    // Force an immediate update of market data for the specified symbols
    try {
      if (isPublisherConnected) {
        // If dedicated publisher is connected, use it to publish market data
        console.log("Using dedicated publisher service for market data publishing");
        
        for (const symbol of symbols) {
          try {
            await this.updateSymbolMarketData(symbol);
            console.log(`Published initial market data for ${symbol} using dedicated publisher`);
          } catch (error) {
            console.error(`Error publishing initial market data for ${symbol} using dedicated publisher:`, error);
          }
        }
      } else {
        console.warn(`Cannot publish initial market data - backend publisher not connected to Solace. Please configure backend Solace connection.`);
        
        // Even without a backend Solace connection, we still want to update the internal market data
        // This ensures data is current in storage even when Solace isn't connected
        console.log("Only starting market data simulation for " + symbols.join(", ") + " - no backend Solace connection");
        
        // Generate market data for each symbol without publishing to Solace
        for (const symbol of symbols) {
          try {
            // Get the stock from storage
            const stock = await storage.getStockBySymbol(symbol);
            
            if (!stock) {
              console.error(`Stock not found for symbol ${symbol}`);
              continue;
            }
            
            // Generate simulated price data
            const basePrice = stock.currentPrice || this.getBasePrice(symbol);
            const percentChange = this.generateRandomPercentChange();
            const currentPrice = basePrice * (1 + percentChange / 100);
            
            // Update the stock price in storage only (no Solace publishing)
            await storage.updateStockPrice(
              symbol,
              parseFloat(currentPrice.toFixed(2)),
              parseFloat(percentChange.toFixed(2))
            );
            
            console.log(`Updated market data in storage for ${symbol}: $${currentPrice.toFixed(2)} (${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(2)}%)`);
            
            // Only update storage, no publishing without a backend Solace connection
          } catch (error) {
            console.error(`Error updating initial market data for ${symbol}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("Error publishing initial market data:", error);
    }
    
    return;
  }
  
  /**
   * Stop market data simulation for specific symbols
   * Note: This just removes symbols from tracking, but data is still published
   */
  async stopSimulation(): Promise<void> {
    this.symbols = [];
    console.log("Removed user-selected symbols from tracking list");
    return;
  }
  
  /**
   * Update market data for selected symbols (deprecated, use updateAllData instead)
   * We keep this for backward compatibility
   */
  private async updateMarketData(): Promise<void> {
    // Just delegate to updateAllData since we're publishing data for all stocks now
    await this.updateAllData();
  }
  
  /**
   * Public method to immediately update all stocks, even without simulation started
   * This is used when first connecting to Solace to ensure data is available right away
   */
  async updateAllStocksImmediately(symbols: string[]): Promise<void> {
    // Check connection status for both publisher and frontend services
    const isPublisherConnected = this.publisherConnected;
    const isFrontendConnected = solaceService.isConnected();
    
    // Determine if we have any Solace connection available
    const hasConnection = isPublisherConnected || isFrontendConnected;
    
    if (!hasConnection) {
      console.log("Cannot update market data immediately - no Solace connection established");
      return; // Don't proceed without a connection
    }
    
    console.log(`Immediately updating market data for ${symbols.length} symbols`);
    console.log(`Using ${isPublisherConnected ? 'dedicated publisher' : 'frontend Solace connection'}`);
    
    for (const symbol of symbols) {
      try {
        await this.updateSymbolMarketData(symbol);
      } catch (error) {
        console.error(`Error updating immediate market data for ${symbol}:`, error);
      }
    }
  }
  
  /**
   * Update market data for a specific symbol
   * Public method for testing and manual updates
   * Respects configured update frequency (in milliseconds) or can force immediate updates
   */
  async updateSymbolMarketData(symbol: string, isSymbolSelected: boolean = false, isForceUpdate: boolean = false): Promise<void> {
    try {
    // FIXED: Check if the publisher is actually connected to Solace
    const isPublisherConnected = publisherSolaceService.isConnected();
    
    // Check if we have a frontend Solace connection
    const isFrontendConnected = solaceService.isConnected();
    
    // Check if the publisher feed is active
    // CRITICAL FIX: This is the key difference between Twitter and Market Data services
    // Twitter service checks this.feedActive directly in publishTweet
    // Here we need to check publisherSolaceService.getConnectionStatus().feedActive
    const pubStatus = publisherSolaceService.getConnectionStatus();
    
    // Log the feed status for debugging (only occasionally)
    // if (Math.random() < 0.05) { // Log this only 5% of the time to reduce log spam
    //  console.log("Market data service checking publisher feed status:", 
    //    pubStatus.feedActive ? "ACTIVE" : "INACTIVE", 
    //    pubStatus);
    //}
    
    // Fix: Update our internal tracking of publisher connection status
    this.publisherConnected = isPublisherConnected;
    
    // Get feed status from publisher
    const isPublisherFeedActive = pubStatus && pubStatus.feedActive === true;
    
    // CRITICAL SECURITY FIX: First check if we have a valid Solace connection and active feed
    // This ensures we never update market data without both conditions being true
    const connectionValid = pubStatus.connected && 
                            pubStatus.connectionInfo?.isConfigPresent === true;
                              
    // Fail fast - do not process ANY market data if there's no valid Solace connection or feed is inactive
    if (!connectionValid || !isPublisherFeedActive) {
      // Only log occasionally to avoid console spam
      if (Math.random() < 0.05) { 
        console.log(`Skipping market data update for ${symbol} - Solace connection required`);
        console.log("Feed status: " + (isPublisherFeedActive ? "ACTIVE" : "INACTIVE"));
        console.log("Connection status: " + (connectionValid ? "CONNECTED" : "NOT CONNECTED"));
      }
      return;
    }
    
    // Rate limiting: Check if we've updated this symbol recently
    const now = Date.now();
    const lastUpdate = this.lastUpdateTime[symbol] || 0;
    const elapsedSinceLastUpdate = now - lastUpdate;
    
    // Calculate the minimum time between updates directly from updateFrequencyMs
    const minUpdateIntervalMs = this.updateFrequencyMs;
    
    // Force immediate update for:
    // 1. Initial data (never updated before)
    // 2. When the configured frequency time has elapsed since last update
    // 3. When this is a forced update (isForceUpdate=true parameter, used for one-time operations)
    const isInitialDataOrDueForUpdate = 
      !this.lastUpdateTime[symbol] || // Initial data for this symbol
      elapsedSinceLastUpdate >= minUpdateIntervalMs || // Frequency seconds have passed
      isForceUpdate; // Force immediate update regardless of timing
    
    // Skip update if we've updated this symbol too recently
    if (!isInitialDataOrDueForUpdate) {
      // Don't log to avoid spamming console, just silently skip
      return;
    }
    
    // Update the last update time for this symbol
    this.lastUpdateTime[symbol] = now;
    
    // Get the stock from storage
    const stock = await storage.getStockBySymbol(symbol);
    
    if (!stock) {
      console.error(`Stock not found for symbol ${symbol}`);
      return;
    }
    
    // Generate simulated price data
    const basePrice = stock.currentPrice || this.getBasePrice(symbol);
    const percentChange = this.generateRandomPercentChange();
    const currentPrice = basePrice * (1 + percentChange / 100);
    
    // We already have proper security checks earlier in this function
    // So we can rely on those checks to ensure we never update data without Solace connection
    
    // Only update the stock price in storage if we have a valid Solace connection
    const updatedStock = await storage.updateStockPrice(
      symbol,
      parseFloat(currentPrice.toFixed(2)),
      parseFloat(percentChange.toFixed(2))
    );
    
    if (!updatedStock) {
      console.error(`Failed to update stock price for ${symbol}`);
      return;
    }
    
    // Create the market data message
    // Import helper functions from client stockUtils for topic consistency
    let topic: string;
    
    if (symbol === 'SPX' || symbol === 'DJI' || symbol === 'NDX' || 
        symbol === 'FTSE' || symbol === 'N225' || symbol === 'HSI') {
      // Handle market indices with simple topic pattern
      topic = `market-data/${symbol}`;
    } else {
      // Use the stock exchange map to determine the correct exchange and country
      // Map of stock symbols to exchanges from stockUtils.ts
      const STOCK_EXCHANGE_MAP: Record<string, string> = {
        // Market Indices already handled above
        
        // Tech stocks - mostly NASDAQ
        "AAPL": "NASDAQ", "MSFT": "NASDAQ", "GOOG": "NASDAQ", "AMZN": "NASDAQ",
        "META": "NASDAQ", "TSLA": "NASDAQ", "NVDA": "NASDAQ", "INTC": "NASDAQ",
        "CSCO": "NASDAQ", "ADBE": "NASDAQ", "NFLX": "NASDAQ", "AMD": "NASDAQ",
        "MRNA": "NASDAQ", "PYPL": "NASDAQ", "CMCSA": "NASDAQ", "SBUX": "NASDAQ",
        
        // NYSE stocks
        "JPM": "NYSE", "V": "NYSE", "MA": "NYSE", "BAC": "NYSE", "WFC": "NYSE",
        "GS": "NYSE", "AXP": "NYSE", "MS": "NYSE", "BLK": "NYSE", "DIS": "NYSE",
        "KO": "NYSE", "PEP": "NYSE", "NKE": "NYSE", "HD": "NYSE", "WMT": "NYSE",
        "JNJ": "NYSE", "PFE": "NYSE", "UNH": "NYSE", "ABT": "NYSE",
        "MRK": "NYSE", "CVS": "NYSE", "ABBV": "NYSE", "TMO": "NYSE", "DHR": "NYSE",
        "XOM": "NYSE", "CVX": "NYSE", "CRM": "NYSE", "VZ": "NYSE", "T": "NYSE",
        "ORCL": "NYSE", "IBM": "NYSE", "BA": "NYSE", "CAT": "NYSE", "MCD": "NYSE",
        
        // London Stock Exchange (UK)
        "HSBA": "LSE", // HSBC Holdings
        "BARC": "LSE", // Barclays
        "BP": "LSE",   // BP
        "LLOY": "LSE", // Lloyds Banking Group
        "VOD": "LSE",  // Vodafone Group
        "GSK": "LSE",  // GlaxoSmithKline
        "AZN": "LSE",  // AstraZeneca
        "RIO": "LSE",  // Rio Tinto
        "ULVR": "LSE", // Unilever
        "SHEL": "LSE", // Shell
        "RDSB": "LSE", // Royal Dutch Shell
        "BT": "LSE",   // BT Group
        
        // Singapore Exchange
        "O39": "SGX",  // Oversea-Chinese Banking
        "D05": "SGX",  // DBS Group Holdings
        "U11": "SGX",  // United Overseas Bank
        "Z74": "SGX",  // Singapore Airlines
        "C6L": "SGX",  // Singapore Airlines (alternate)
        "C38U": "SGX", // CapitaLand Mall Trust
        "C09": "SGX",  // City Developments
        
        // Tokyo Stock Exchange (Japan)
        "7203": "TSE", // Toyota Motor Corporation
        "9984": "TSE", // SoftBank Group
        "6758": "TSE", // Sony Group
        "7751": "TSE", // Canon
        "6501": "TSE", // Hitachi
        "6502": "TSE", // Toshiba
        "7267": "TSE", // Honda Motor
        "9432": "TSE", // Nippon Telegraph & Telephone
        
        // Australian Securities Exchange
        "BHP": "ASX",  // BHP Group
        "CBA": "ASX",  // Commonwealth Bank of Australia
        "WBC": "ASX",  // Westpac Banking
        "NAB": "ASX",  // National Australia Bank
        "ANZ": "ASX",  // Australia & New Zealand Banking
        "CSL": "ASX",  // CSL Ltd
        "WES": "ASX",  // Wesfarmers
        "FMG": "ASX"   // Fortescue Metals Group
      };
      
      // Map of exchanges to countries
      const EXCHANGE_COUNTRY_MAP: Record<string, string> = {
        "NYSE": "US",
        "NASDAQ": "US",
        "AMEX": "US",
        "LSE": "UK",
        "AIM": "UK",
        "SGX": "SG",
        "TSE": "JP",
        "ASX": "AU"
      };
      
      // Get the exchange and country for this symbol
      const exchange = STOCK_EXCHANGE_MAP[symbol] || "NYSE";
      
      // Use the correct country code from the mapping
      const country = EXCHANGE_COUNTRY_MAP[exchange] || "US";
      
      // Log exchange and country for debugging specific symbols
      if (["HSBA", "O39", "7203", "BHP"].includes(symbol) || Math.random() < 0.02) {
        //console.log(`Publishing data for non-US stock: ${symbol}, Exchange: ${exchange}, Country: ${country}`);
      }
      
      // Create the full topic string with the correct country and exchange
      topic = `market-data/EQ/${country}/${exchange}/${symbol}`;
    }
    
    const message = {
      symbol: updatedStock.symbol,
      companyName: updatedStock.companyName,
      currentPrice: updatedStock.currentPrice,
      percentChange: updatedStock.percentChange,
      timestamp: updatedStock.lastUpdated
    };
    
    // Only publish to Solace if:
    // 1. We have a Solace connection
    // 2. The publisher feed is active
    
    // CRITICAL FIX: We must strictly check for an actual connection
    // This ensures market data is only published when Solace is available
    // FIXED: Only check the publisher's connection, NOT the frontend connection
      const publisherIsConnected = this.publisherConnected;
      const feedIsActive = publisherSolaceService.isFeedActive();

      // UNCOMMENTED DIAGNOSTIC LOGGING
      //console.log(`[MarketDataService.updateSymbolMarketData PUBLISH_CHECK for ${symbol}] publisherIsConnected: ${publisherIsConnected}, feedIsActive: ${feedIsActive}`);

      if (publisherIsConnected && feedIsActive) {
        // Publish ALL stocks to Solace broker - filtering happens on the client side
        await publisherSolaceService.publish(topic, message);
        
        // UNCOMMENTED SUCCESS LOG
        // console.log(`Successfully published market data for ${symbol} to ${topic}`);
        
        // Log both the storage update and publication status
        if (isSymbolSelected) {
          // For selected symbols, show full details as these are prominent in the UI
          // console.log(`Published market data for ${symbol}: $${currentPrice.toFixed(2)} (${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(2)}%) - will show in Live Market Intelligence`);
        } else if (Math.random() < 0.05) { // 5% logging for non-selected symbols to reduce spam
          // For non-selected symbols, they're published but filtered out in the UI
          // console.log(`Published market data for ${symbol}: $${currentPrice.toFixed(2)} (${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(2)}%) - not shown in Live Market Intelligence`);
        }
      } else {
        // MANUALLY ADDED LOG:
        const currentTime = Date.now();
        if (currentTime - (this._lastPublishSkippedLogTime || 0) > 30000) { 
          console.log(`[MarketDataService SKIPPING PUBLISH for ${symbol}] Reason: Connection: ${publisherIsConnected}, Feed: ${feedIsActive}`);
          this._lastPublishSkippedLogTime = currentTime;
        }
      }
    } catch (error) {
      console.error(`Error in updateSymbolMarketData for ${symbol}:`, error);
      // Potentially add a counter for errors and stop trying for a symbol if it fails too many times
    }
  }
  
  /**
   * Generate a baseline price for a symbol
   */
  private getBasePrice(symbol: string): number {
    // Different price ranges for different symbols
    const priceRanges: Record<string, [number, number]> = {
      'AAPL': [170, 190],
      'MSFT': [320, 340],
      'GOOG': [135, 150],
      'AMZN': [125, 135],
      'TSLA': [230, 250],
      'META': [280, 300],
      'NVDA': [750, 800],
      'JPM': [180, 200],
      'V': [250, 270],
      'NFLX': [550, 600],
      'DIS': [90, 100],
      'ADBE': [450, 500],
      'PYPL': [60, 70],
      'INTC': [30, 40],
      'CSCO': [45, 55]
    };
    
    const [min, max] = priceRanges[symbol] || [50, 200];
    return min + Math.random() * (max - min);
  }
  
  /**
   * Generate a random percent change
   */
  private generateRandomPercentChange(): number {
    // Generate a value between -3% and +3%
    return (Math.random() * 6 - 3);
  }
}

export const marketDataService = new MarketDataService();
