/**
 * Traffic Generator Context
 * 
 * Browser-native traffic generators that publish market data and tweets
 * directly from the browser to Solace using solclientjs.
 * 
 * Pattern based on Solace Lens SDKPerfContext.
 */
import { createContext, useContext, useCallback, useRef, useState, useEffect, type ReactNode } from 'react';
import solace from 'solclientjs';
import {
  GeneratorConfig,
  GeneratorStats,
  GeneratorStatus,
  GeneratorState,
  BrokerConfig,
  MarketDataMessage,
  TweetData,
  DEFAULT_MARKET_DATA_CONFIG,
  DEFAULT_TWITTER_CONFIG,
  GENERATOR_STORAGE_KEY,
  StockInfo,
} from '../types/generatorTypes';
import { DEFAULT_STOCKS, STOCK_EXCHANGE_MAP, STOCK_EXCHANGES } from '../lib/stockUtils';

// Initialize Solace factory if not already done
try {
  const factoryProps = new solace.SolclientFactoryProperties();
  factoryProps.profile = solace.SolclientFactoryProfiles.version10;
  solace.SolclientFactory.init(factoryProps);
} catch {
  // Already initialized
}

// Storage helpers for persisting generator state
interface StoredGeneratorInfo {
  config: GeneratorConfig;
  brokerConfig: BrokerConfig;
}

function getStoredGenerators(): Map<string, StoredGeneratorInfo> {
  try {
    const stored = localStorage.getItem(GENERATOR_STORAGE_KEY);
    if (!stored) return new Map();
    const parsed = JSON.parse(stored) as [string, StoredGeneratorInfo][];
    return new Map(parsed);
  } catch {
    return new Map();
  }
}

function setStoredGenerators(generators: Map<string, StoredGeneratorInfo>) {
  try {
    localStorage.setItem(GENERATOR_STORAGE_KEY, JSON.stringify([...generators.entries()]));
  } catch {
    // Ignore storage errors
  }
}

function addStoredGenerator(generatorId: string, info: StoredGeneratorInfo) {
  const generators = getStoredGenerators();
  generators.set(generatorId, info);
  setStoredGenerators(generators);
}

function removeStoredGenerator(generatorId: string) {
  const generators = getStoredGenerators();
  generators.delete(generatorId);
  setStoredGenerators(generators);
}

// Create empty stats
function createEmptyStats(): GeneratorStats {
  return {
    messagesSent: 0,
    bytesSent: 0,
    publishRate: 0,
    errors: 0,
    startTime: 0,
    elapsed: 0,
    lastPublishTime: null,
  };
}

// Active session tracking
interface ActiveGenerator {
  id: string;
  config: GeneratorConfig;
  brokerConfig: BrokerConfig;
  session: solace.Session | null;
  status: GeneratorStatus;
  stats: GeneratorStats;
  output: string[];
  error: string | null;
  publishInterval: ReturnType<typeof setInterval> | null;
  statsInterval: ReturnType<typeof setInterval> | null;
  messagesSent: number;
  bytesSent: number;
  errors: number;
  startTime: number;
  stockIndex: number;  // For round-robin stock selection
  stocks: StockInfo[];  // Cached stock data with simulated prices
}

// Stock price simulation helpers
function getBasePrice(symbol: string): number {
  // Base prices roughly matching real stock prices
  const basePrices: Record<string, number> = {
    'AAPL': 175, 'MSFT': 380, 'GOOG': 140, 'AMZN': 175, 'META': 500,
    'TSLA': 250, 'NVDA': 880, 'INTC': 45, 'CSCO': 50, 'ADBE': 580,
    'NFLX': 600, 'AMD': 170, 'PYPL': 65, 'CMCSA': 42, 'SBUX': 95,
    'JPM': 195, 'V': 280, 'MA': 460, 'BAC': 35, 'WFC': 55,
    'GS': 420, 'AXP': 225, 'MS': 95, 'BLK': 800, 'DIS': 115,
    'KO': 62, 'PEP': 175, 'NKE': 105, 'MCD': 290, 'HD': 370,
    'WMT': 165, 'JNJ': 160, 'PFE': 28, 'MRNA': 115, 'UNH': 525,
    'ABT': 115, 'MRK': 125, 'CVS': 80, 'ABBV': 180, 'TMO': 580,
    'DHR': 255, 'XOM': 115, 'CVX': 160, 'CRM': 300, 'VZ': 42,
    'T': 17, 'ORCL': 125, 'IBM': 190, 'BA': 215, 'CAT': 340,
    // UK stocks
    'HSBA': 650, 'BARC': 180, 'BP': 530, 'LLOY': 55, 'VOD': 85,
    'GSK': 1600, 'AZN': 11500, 'RIO': 5500, 'ULVR': 4200, 'SHEL': 2700,
    // Singapore stocks
    'O39': 13, 'D05': 35, 'U11': 30, 'Z74': 6.5,
    // Japan stocks
    '7203': 2800, '9984': 8500, '6758': 13000, '7751': 3500,
    // Australia stocks
    'BHP': 46, 'CBA': 115, 'WBC': 25, 'NAB': 33, 'ANZ': 28, 'CSL': 280,
  };
  return basePrices[symbol] || 100 + Math.random() * 200;
}

function simulatePriceChange(currentPrice: number): { newPrice: number; percentChange: number; priceChange: number } {
  // Random walk with mean reversion tendency
  const volatility = 0.002 + Math.random() * 0.003; // 0.2% to 0.5% volatility
  const direction = Math.random() > 0.5 ? 1 : -1;
  const percentChange = direction * volatility * 100;
  const priceChange = currentPrice * (percentChange / 100);
  const newPrice = Math.max(0.01, currentPrice + priceChange);
  
  return {
    newPrice: parseFloat(newPrice.toFixed(2)),
    percentChange: parseFloat(percentChange.toFixed(2)),
    priceChange: parseFloat(priceChange.toFixed(2)),
  };
}

// Initialize stocks with base prices and exchange info
function initializeStocks(): StockInfo[] {
  return DEFAULT_STOCKS
    .filter(s => !['SPX', 'DJI', 'NDX', 'FTSE', 'N225', 'HSI'].includes(s.symbol)) // Exclude indices
    .map(stock => {
      const exchange = STOCK_EXCHANGE_MAP[stock.symbol] || 'NYSE';
      const exchangeInfo = STOCK_EXCHANGES[exchange];
      const basePrice = getBasePrice(stock.symbol);
      return {
        symbol: stock.symbol,
        companyName: stock.companyName,
        exchange,
        country: exchangeInfo?.country || 'US',
        currentPrice: basePrice,
        previousClose: basePrice,
      };
    });
}

// Tweet templates for various sentiments
const TWEET_TEMPLATES = {
  bullish: [
    "🚀 ${symbol} looking strong today! Technical indicators suggest momentum is building. #Stocks #Trading",
    "Bullish on ${symbol}! Just saw impressive volume coming in. ${companyName} could be ready for a breakout. 📈",
    "Big moves expected for ${symbol}. Institutional buying pressure is evident. #WallStreet",
    "Loading up on ${symbol} here. The risk/reward is excellent at current levels. 🎯",
    "${companyName} (${symbol}) exceeding expectations. This stock has legs! #Investing",
  ],
  bearish: [
    "⚠️ Caution on ${symbol}. Seeing distribution patterns form. #Trading #Stocks",
    "Taking profits on ${symbol}. ${companyName} facing headwinds that can't be ignored. 📉",
    "Red flags on ${symbol} chart. Support levels breaking down. #TechnicalAnalysis",
    "Reducing exposure to ${symbol}. Macro conditions not favorable for this sector.",
    "${companyName} (${symbol}) - waiting for better entry. Current valuation stretched. 🔍",
  ],
  neutral: [
    "Watching ${symbol} closely. ${companyName} at a critical juncture here. #Stocks",
    "Mixed signals on ${symbol}. Need more confirmation before taking a position. 📊",
    "Sideways action continues for ${symbol}. Waiting for a clear breakout direction.",
    "${companyName} (${symbol}) - consolidating after recent moves. Patience is key. ⏳",
    "No strong conviction on ${symbol} right now. Market still deciding direction.",
  ],
};

function generateTweet(stock: StockInfo): TweetData {
  const sentiments = ['bullish', 'bearish', 'neutral'] as const;
  const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
  const templates = TWEET_TEMPLATES[sentiment];
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  const content = template
    .replace(/\${symbol}/g, stock.symbol)
    .replace(/\${companyName}/g, stock.companyName);
  
  const authors = [
    'TraderMike', 'WallStreetPro', 'StockGuru', 'MarketWatch', 'FinanceX',
    'TechInvestor', 'BullishBets', 'AlphaTrader', 'InvestSmart', 'MarketMaven'
  ];
  
  return {
    symbol: stock.symbol,
    content,
    author: authors[Math.floor(Math.random() * authors.length)],
    timestamp: new Date().toISOString(),
    sentiment,
  };
}

// Context interface
interface TrafficGeneratorContextValue {
  // Get state for a specific generator
  getGeneratorState: (generatorId: string) => GeneratorState;
  
  // Check if a generator is active
  isGeneratorActive: (generatorId: string) => boolean;
  
  // Get all generators
  getAllGenerators: () => GeneratorConfig[];
  
  // Start a generator
  startGenerator: (generatorId: string, brokerConfig: BrokerConfig) => void;
  
  // Stop a generator
  stopGenerator: (generatorId: string) => void;
  
  // Update generator config (rate, QoS settings, etc.)
  updateGeneratorConfig: (generatorId: string, updates: Partial<GeneratorConfig>) => void;
  
  // Clear output for a generator
  clearOutput: (generatorId: string) => void;
  
  // Subscribe to state changes (for re-rendering)
  subscribeToGenerator: (generatorId: string, callback: () => void) => () => void;
  
  // Get current broker config if connected
  getBrokerConfig: () => BrokerConfig | null;
  
  // Set broker config (from frontend connection)
  setBrokerConfig: (config: BrokerConfig | null) => void;
}

const TrafficGeneratorContext = createContext<TrafficGeneratorContextValue | null>(null);

export function TrafficGeneratorProvider({ children }: { children: ReactNode }) {
  const generatorsRef = useRef<Map<string, ActiveGenerator>>(new Map());
  const subscribersRef = useRef<Map<string, Set<() => void>>>(new Map());
  const [brokerConfig, setBrokerConfigState] = useState<BrokerConfig | null>(null);
  
  // Default generator configs
  const configsRef = useRef<Map<string, GeneratorConfig>>(new Map([
    [DEFAULT_MARKET_DATA_CONFIG.id, { ...DEFAULT_MARKET_DATA_CONFIG }],
    [DEFAULT_TWITTER_CONFIG.id, { ...DEFAULT_TWITTER_CONFIG }],
  ]));
  
  // Force re-render
  const [, forceUpdate] = useState({});
  
  // Notify subscribers
  const notifySubscribers = useCallback((generatorId: string) => {
    const subs = subscribersRef.current.get(generatorId);
    if (subs) {
      subs.forEach((cb: () => void) => cb());
    }
    forceUpdate({});
  }, []);
  
  // Add log entry
  const log = useCallback((generatorId: string, message: string, type: 'info' | 'error' | 'message' = 'info') => {
    const generator = generatorsRef.current.get(generatorId);
    if (!generator) return;
    
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const prefix = type === 'error' ? '❌' : type === 'message' ? '📨' : 'ℹ️';
    generator.output = [...generator.output.slice(-200), `[${timestamp}] ${prefix} ${message}`];
    notifySubscribers(generatorId);
  }, [notifySubscribers]);
  
  // Update stats
  const updateGeneratorStats = useCallback((generatorId: string) => {
    const g = generatorsRef.current.get(generatorId);
    if (!g) return;
    
    const now = Date.now();
    const elapsed = (now - g.startTime) / 1000;
    
    g.stats = {
      messagesSent: g.messagesSent,
      bytesSent: g.bytesSent,
      publishRate: elapsed > 0 ? g.messagesSent / elapsed : 0,
      errors: g.errors,
      startTime: g.startTime,
      elapsed,
      lastPublishTime: g.stats.lastPublishTime,
    };
    notifySubscribers(generatorId);
  }, [notifySubscribers]);
  
  // Get generator state
  const getGeneratorState = useCallback((generatorId: string): GeneratorState => {
    const generator = generatorsRef.current.get(generatorId);
    const config = configsRef.current.get(generatorId);
    
    if (!generator) {
      return {
        config: config || DEFAULT_MARKET_DATA_CONFIG,
        status: 'stopped',
        stats: createEmptyStats(),
        output: [],
        error: null,
      };
    }
    
    return {
      config: generator.config,
      status: generator.status,
      stats: generator.stats,
      output: generator.output,
      error: generator.error,
    };
  }, []);
  
  const isGeneratorActive = useCallback((generatorId: string) => {
    const generator = generatorsRef.current.get(generatorId);
    return generator?.status === 'running' || generator?.status === 'starting';
  }, []);
  
  const getAllGenerators = useCallback(() => {
    return Array.from(configsRef.current.values());
  }, []);
  
  // Disconnect a session
  const disconnectGenerator = useCallback((generatorId: string) => {
    const g = generatorsRef.current.get(generatorId);
    if (!g) return;
    
    if (g.publishInterval) {
      clearInterval(g.publishInterval);
      g.publishInterval = null;
    }
    if (g.statsInterval) {
      clearInterval(g.statsInterval);
      g.statsInterval = null;
    }
    
    try {
      g.session?.disconnect();
    } catch (err) {
      console.error('Error disconnecting:', err);
    }
  }, []);
  
  // Stop generator
  const stopGenerator = useCallback((generatorId: string) => {
    const g = generatorsRef.current.get(generatorId);
    if (!g) return;
    
    g.status = 'stopping';
    log(generatorId, 'Stopping generator...');
    notifySubscribers(generatorId);
    
    disconnectGenerator(generatorId);
    
    updateGeneratorStats(generatorId);
    g.status = 'stopped';
    log(generatorId, 'Generator stopped');
    
    // Update config to disabled
    const config = configsRef.current.get(generatorId);
    if (config) {
      config.enabled = false;
      configsRef.current.set(generatorId, config);
    }
    
    removeStoredGenerator(generatorId);
    notifySubscribers(generatorId);
  }, [log, updateGeneratorStats, notifySubscribers, disconnectGenerator]);
  
  // Start generator
  const startGenerator = useCallback((generatorId: string, brokerCfg: BrokerConfig) => {
    const config = configsRef.current.get(generatorId);
    if (!config) {
      console.error(`Generator config not found: ${generatorId}`);
      return;
    }
    
    // Stop existing if any
    if (generatorsRef.current.has(generatorId)) {
      stopGenerator(generatorId);
    }
    
    // Initialize generator state
    const stocks = initializeStocks();
    const g: ActiveGenerator = {
      id: generatorId,
      config: { ...config, enabled: true },
      brokerConfig: brokerCfg,
      session: null,
      status: 'starting',
      stats: createEmptyStats(),
      output: [],
      error: null,
      publishInterval: null,
      statsInterval: null,
      messagesSent: 0,
      bytesSent: 0,
      errors: 0,
      startTime: Date.now(),
      stockIndex: 0,
      stocks,
    };
    
    generatorsRef.current.set(generatorId, g);
    configsRef.current.set(generatorId, g.config);
    notifySubscribers(generatorId);
    
    // Store for auto-restart
    addStoredGenerator(generatorId, { config: g.config, brokerConfig: brokerCfg });
    
    log(generatorId, `Starting ${config.name}...`);
    log(generatorId, `Connecting to ${brokerCfg.url}`);
    
    try {
      const sessionProperties = {
        url: brokerCfg.url,
        vpnName: brokerCfg.vpnName,
        userName: brokerCfg.username,
        password: brokerCfg.password,
        connectRetries: 3,
        reconnectRetries: 3,
        reconnectRetryWaitInMsecs: 1000,
        publisherProperties: {
          acknowledgeMode: solace.MessagePublisherAcknowledgeMode.PER_MESSAGE,
        },
      };
      
      const session = solace.SolclientFactory.createSession(sessionProperties);
      g.session = session;
      
      // Publish a message
      const publishMessage = () => {
        if (!g.session || g.status !== 'running') return;
        
        try {
          const message = solace.SolclientFactory.createMessage();
          
          let payload: string;
          let topic: string;
          
          if (config.type === 'market-data') {
            // Get next stock (round-robin)
            const stock = g.stocks[g.stockIndex % g.stocks.length];
            g.stockIndex++;
            
            // Simulate price change
            const { newPrice, percentChange, priceChange } = simulatePriceChange(stock.currentPrice);
            stock.currentPrice = newPrice;
            
            // Create market data message
            const marketData: MarketDataMessage = {
              symbol: stock.symbol,
              companyName: stock.companyName,
              currentPrice: newPrice,
              percentChange,
              priceChange,
              volume: Math.floor(Math.random() * 1000000) + 100000,
              previousClose: stock.previousClose,
              exchange: stock.exchange,
              country: stock.country,
              timestamp: new Date().toISOString(),
            };
            
            payload = JSON.stringify(marketData);
            topic = config.topicPattern
              .replace('{country}', stock.country)
              .replace('{exchange}', stock.exchange)
              .replace('{symbol}', stock.symbol);
            
          } else {
            // Twitter generator
            const stock = g.stocks[Math.floor(Math.random() * g.stocks.length)];
            const tweet = generateTweet(stock);
            payload = JSON.stringify(tweet);
            topic = config.topicPattern.replace('{symbol}', stock.symbol);
          }
          
          message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
          message.setBinaryAttachment(payload);
          
          // Set delivery mode
          if (config.deliveryMode === 'PERSISTENT') {
            message.setDeliveryMode(solace.MessageDeliveryModeType.PERSISTENT);
          } else {
            message.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
          }
          
          // Set DMQ eligibility
          message.setDMQEligible(config.dmqEligible);
          
          // Set eliding eligibility (if supported)
          if (config.allowMessageEliding) {
            try {
              (message as any).setElidingEligible?.(true);
            } catch {
              // Method may not exist in all versions
            }
          }
          
          g.session.send(message);
          g.messagesSent++;
          g.bytesSent += payload.length;
          g.stats.lastPublishTime = Date.now();
          
          // Log occasionally (every 100 messages for market data, every message for twitter)
          if (config.type === 'twitter' || g.messagesSent % 100 === 0) {
            log(generatorId, `Published to ${topic}`, 'message');
          }
          
        } catch (err) {
          g.errors++;
          log(generatorId, `Publish error: ${err}`, 'error');
        }
      };
      
      // Session event handlers
      session.on(solace.SessionEventCode.UP_NOTICE, () => {
        log(generatorId, 'Connected to Solace broker');
        g.status = 'running';
        g.startTime = Date.now();
        notifySubscribers(generatorId);
        
        // Start publishing based on rate
        const intervalMs = config.type === 'market-data'
          ? 1000 / config.messageRate  // messages per second
          : (60 / config.messageRate) * 1000;  // tweets per minute -> ms
        
        log(generatorId, `Publishing every ${intervalMs.toFixed(0)}ms (rate: ${config.messageRate} ${config.type === 'market-data' ? 'msg/s' : 'tweets/min'})`);
        
        g.publishInterval = setInterval(publishMessage, intervalMs);
        g.statsInterval = setInterval(() => updateGeneratorStats(generatorId), 500);
      });
      
      session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (event: solace.SessionEvent) => {
        log(generatorId, `Connection failed: ${event.infoStr}`, 'error');
        g.status = 'error';
        g.error = event.infoStr || 'Connection failed';
        removeStoredGenerator(generatorId);
        notifySubscribers(generatorId);
      });
      
      session.on(solace.SessionEventCode.DISCONNECTED, () => {
        log(generatorId, 'Disconnected from broker');
        if (g.status === 'running') {
          g.status = 'stopped';
        }
        notifySubscribers(generatorId);
      });
      
      session.on(solace.SessionEventCode.RECONNECTING_NOTICE, () => {
        log(generatorId, 'Reconnecting...');
      });
      
      session.on(solace.SessionEventCode.RECONNECTED_NOTICE, () => {
        log(generatorId, 'Reconnected');
        g.status = 'running';
        notifySubscribers(generatorId);
      });
      
      session.connect();
      
    } catch (err) {
      log(generatorId, `Error starting generator: ${err}`, 'error');
      g.status = 'error';
      g.error = err instanceof Error ? err.message : String(err);
      notifySubscribers(generatorId);
    }
  }, [log, stopGenerator, updateGeneratorStats, notifySubscribers]);
  
  // Update generator config
  const updateGeneratorConfig = useCallback((generatorId: string, updates: Partial<GeneratorConfig>) => {
    const config = configsRef.current.get(generatorId);
    if (!config) return;
    
    const newConfig = { ...config, ...updates };
    configsRef.current.set(generatorId, newConfig);
    
    const generator = generatorsRef.current.get(generatorId);
    if (generator) {
      generator.config = newConfig;
      
      // If rate changed and running, restart the interval
      if (updates.messageRate !== undefined && generator.status === 'running' && generator.publishInterval) {
        clearInterval(generator.publishInterval);
        
        const intervalMs = newConfig.type === 'market-data'
          ? 1000 / newConfig.messageRate
          : (60 / newConfig.messageRate) * 1000;
        
        log(generatorId, `Rate updated to ${newConfig.messageRate} ${newConfig.type === 'market-data' ? 'msg/s' : 'tweets/min'}`);
        
        // Re-create publish function with updated config
        const publishMessage = () => {
          if (!generator.session || generator.status !== 'running') return;
          
          try {
            const message = solace.SolclientFactory.createMessage();
            let payload: string;
            let topic: string;
            
            if (newConfig.type === 'market-data') {
              const stock = generator.stocks[generator.stockIndex % generator.stocks.length];
              generator.stockIndex++;
              const { newPrice, percentChange, priceChange } = simulatePriceChange(stock.currentPrice);
              stock.currentPrice = newPrice;
              
              const marketData: MarketDataMessage = {
                symbol: stock.symbol,
                companyName: stock.companyName,
                currentPrice: newPrice,
                percentChange,
                priceChange,
                volume: Math.floor(Math.random() * 1000000) + 100000,
                previousClose: stock.previousClose,
                exchange: stock.exchange,
                country: stock.country,
                timestamp: new Date().toISOString(),
              };
              
              payload = JSON.stringify(marketData);
              topic = newConfig.topicPattern
                .replace('{country}', stock.country)
                .replace('{exchange}', stock.exchange)
                .replace('{symbol}', stock.symbol);
            } else {
              const stock = generator.stocks[Math.floor(Math.random() * generator.stocks.length)];
              const tweet = generateTweet(stock);
              payload = JSON.stringify(tweet);
              topic = newConfig.topicPattern.replace('{symbol}', stock.symbol);
            }
            
            message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
            message.setBinaryAttachment(payload);
            
            if (newConfig.deliveryMode === 'PERSISTENT') {
              message.setDeliveryMode(solace.MessageDeliveryModeType.PERSISTENT);
            } else {
              message.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
            }
            
            message.setDMQEligible(newConfig.dmqEligible);
            
            generator.session.send(message);
            generator.messagesSent++;
            generator.bytesSent += payload.length;
            generator.stats.lastPublishTime = Date.now();
            
            if (newConfig.type === 'twitter' || generator.messagesSent % 100 === 0) {
              log(generatorId, `Published to ${topic}`, 'message');
            }
          } catch (err) {
            generator.errors++;
            log(generatorId, `Publish error: ${err}`, 'error');
          }
        };
        
        generator.publishInterval = setInterval(publishMessage, intervalMs);
      }
      
      // Update stored config
      const stored = getStoredGenerators().get(generatorId);
      if (stored) {
        addStoredGenerator(generatorId, { ...stored, config: newConfig });
      }
    }
    
    notifySubscribers(generatorId);
  }, [log, notifySubscribers]);
  
  // Clear output
  const clearOutput = useCallback((generatorId: string) => {
    const generator = generatorsRef.current.get(generatorId);
    if (generator) {
      generator.output = [];
      notifySubscribers(generatorId);
    }
  }, [notifySubscribers]);
  
  // Subscribe to generator changes
  const subscribeToGenerator = useCallback((generatorId: string, callback: () => void) => {
    if (!subscribersRef.current.has(generatorId)) {
      subscribersRef.current.set(generatorId, new Set());
    }
    subscribersRef.current.get(generatorId)!.add(callback);
    
    return () => {
      subscribersRef.current.get(generatorId)?.delete(callback);
    };
  }, []);
  
  // Set broker config
  const setBrokerConfig = useCallback((config: BrokerConfig | null) => {
    setBrokerConfigState(config);
  }, []);
  
  // Get broker config
  const getBrokerConfig = useCallback(() => {
    return brokerConfig;
  }, [brokerConfig]);
  
  // Auto-restart generators on mount
  useEffect(() => {
    const stored = getStoredGenerators();
    stored.forEach(({ config, brokerConfig: storedBrokerConfig }, generatorId) => {
      if (config.enabled) {
        console.log(`Auto-restarting generator: ${generatorId}`);
        // Delay to ensure context is ready
        setTimeout(() => {
          startGenerator(generatorId, storedBrokerConfig);
        }, 500);
      }
    });
    
    // Cleanup on unmount
    return () => {
      generatorsRef.current.forEach((_: ActiveGenerator, generatorId: string) => {
        disconnectGenerator(generatorId);
      });
    };
  }, [startGenerator, disconnectGenerator]);
  
  const value: TrafficGeneratorContextValue = {
    getGeneratorState,
    isGeneratorActive,
    getAllGenerators,
    startGenerator,
    stopGenerator,
    updateGeneratorConfig,
    clearOutput,
    subscribeToGenerator,
    getBrokerConfig,
    setBrokerConfig,
  };
  
  return (
    <TrafficGeneratorContext.Provider value={value}>
      {children}
    </TrafficGeneratorContext.Provider>
  );
}

// Hook to use the context
export function useTrafficGenerator() {
  const context = useContext(TrafficGeneratorContext);
  if (!context) {
    throw new Error('useTrafficGenerator must be used within a TrafficGeneratorProvider');
  }
  return context;
}

// Hook to subscribe to a specific generator's state changes
export function useGeneratorState(generatorId: string) {
  const ctx = useTrafficGenerator();
  const [, forceUpdate] = useState({});
  
  useEffect(() => {
    return ctx.subscribeToGenerator(generatorId, () => forceUpdate({}));
  }, [ctx, generatorId]);
  
  return ctx.getGeneratorState(generatorId);
}
