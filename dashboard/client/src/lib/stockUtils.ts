import { StockDataWithMetadata } from "@shared/schema";

export const DEFAULT_STOCKS = [
  // Market Indices
  { symbol: "SPX", companyName: "S&P 500 Index" },
  { symbol: "DJI", companyName: "Dow Jones Industrial Average" },
  { symbol: "NDX", companyName: "NASDAQ 100 Index" },
  { symbol: "FTSE", companyName: "FTSE 100 Index" },
  { symbol: "N225", companyName: "Nikkei 225 Index" },
  { symbol: "HSI", companyName: "Hang Seng Index" },
  
  // Tech Giants
  { symbol: "AAPL", companyName: "Apple Inc." },
  { symbol: "MSFT", companyName: "Microsoft Corp." },
  { symbol: "GOOG", companyName: "Alphabet Inc." },
  { symbol: "AMZN", companyName: "Amazon.com Inc." },
  { symbol: "META", companyName: "Meta Platforms Inc." },
  { symbol: "TSLA", companyName: "Tesla Inc." },
  { symbol: "NVDA", companyName: "NVIDIA Corp." },
  { symbol: "INTC", companyName: "Intel Corp." },
  { symbol: "CSCO", companyName: "Cisco Systems Inc." },
  { symbol: "ADBE", companyName: "Adobe Inc." },
  { symbol: "NFLX", companyName: "Netflix Inc." },
  { symbol: "AMD", companyName: "Advanced Micro Devices" },
  { symbol: "PYPL", companyName: "PayPal Holdings Inc." },
  { symbol: "CMCSA", companyName: "Comcast Corp." },
  { symbol: "SBUX", companyName: "Starbucks Corp." },
  
  // Financial Services
  { symbol: "JPM", companyName: "JPMorgan Chase & Co." },
  { symbol: "V", companyName: "Visa Inc." },
  { symbol: "MA", companyName: "Mastercard Inc." },
  { symbol: "BAC", companyName: "Bank of America Corp." },
  { symbol: "WFC", companyName: "Wells Fargo & Co." },
  { symbol: "GS", companyName: "Goldman Sachs Group Inc." },
  { symbol: "AXP", companyName: "American Express Co." },
  { symbol: "MS", companyName: "Morgan Stanley" },
  { symbol: "BLK", companyName: "BlackRock Inc." },
  
  // Consumer & Entertainment
  { symbol: "DIS", companyName: "The Walt Disney Co." },
  { symbol: "KO", companyName: "The Coca-Cola Co." },
  { symbol: "PEP", companyName: "PepsiCo Inc." },
  { symbol: "NKE", companyName: "Nike Inc." },
  { symbol: "MCD", companyName: "McDonald's Corp." },
  { symbol: "HD", companyName: "Home Depot Inc." },
  { symbol: "WMT", companyName: "Walmart Inc." },
  
  // Healthcare & Pharma
  { symbol: "JNJ", companyName: "Johnson & Johnson" },
  { symbol: "PFE", companyName: "Pfizer Inc." },
  { symbol: "MRNA", companyName: "Moderna Inc." },
  { symbol: "UNH", companyName: "UnitedHealth Group Inc." },
  { symbol: "ABT", companyName: "Abbott Laboratories" },
  { symbol: "MRK", companyName: "Merck & Co. Inc." },
  { symbol: "CVS", companyName: "CVS Health Corp." },
  { symbol: "ABBV", companyName: "AbbVie Inc." },
  { symbol: "TMO", companyName: "Thermo Fisher Scientific" },
  { symbol: "DHR", companyName: "Danaher Corp." },
  
  // Other Sectors
  { symbol: "XOM", companyName: "Exxon Mobil Corp." },
  { symbol: "CVX", companyName: "Chevron Corp." },
  { symbol: "CRM", companyName: "Salesforce Inc." },
  { symbol: "VZ", companyName: "Verizon Communications" },
  { symbol: "T", companyName: "AT&T Inc." },
  { symbol: "ORCL", companyName: "Oracle Corp." },
  { symbol: "IBM", companyName: "IBM Corp." },
  { symbol: "BA", companyName: "Boeing Co." },
  { symbol: "CAT", companyName: "Caterpillar Inc." },
  
  // London Stock Exchange (UK)
  { symbol: "HSBA", companyName: "HSBC Holdings" },
  { symbol: "BARC", companyName: "Barclays" },
  { symbol: "BP", companyName: "BP" },
  { symbol: "LLOY", companyName: "Lloyds Banking Group" },
  { symbol: "VOD", companyName: "Vodafone Group" },
  { symbol: "GSK", companyName: "GlaxoSmithKline" },
  { symbol: "AZN", companyName: "AstraZeneca" },
  { symbol: "RIO", companyName: "Rio Tinto" },
  { symbol: "ULVR", companyName: "Unilever" },
  { symbol: "SHEL", companyName: "Shell" },
  { symbol: "RDSB", companyName: "Royal Dutch Shell" },
  { symbol: "BT", companyName: "BT Group" },
  
  // Singapore Exchange (SGX)
  { symbol: "O39", companyName: "Oversea-Chinese Banking" },
  { symbol: "D05", companyName: "DBS Group Holdings" },
  { symbol: "U11", companyName: "United Overseas Bank" },
  { symbol: "Z74", companyName: "Singapore Airlines" },
  { symbol: "C6L", companyName: "Singapore Airlines (alternate)" },
  { symbol: "C38U", companyName: "CapitaLand Mall Trust" },
  { symbol: "C09", companyName: "City Developments" },
  
  // Tokyo Stock Exchange (Japan)
  { symbol: "7203", companyName: "Toyota Motor Corporation" },
  { symbol: "9984", companyName: "SoftBank Group" },
  { symbol: "6758", companyName: "Sony Group" },
  { symbol: "7751", companyName: "Canon" },
  { symbol: "6501", companyName: "Hitachi" },
  { symbol: "6502", companyName: "Toshiba" },
  { symbol: "7267", companyName: "Honda Motor" },
  { symbol: "9432", companyName: "Nippon Telegraph & Telephone" },
  
  // Australian Securities Exchange (ASX)
  { symbol: "BHP", companyName: "BHP Group" },
  { symbol: "CBA", companyName: "Commonwealth Bank of Australia" },
  { symbol: "WBC", companyName: "Westpac Banking" },
  { symbol: "NAB", companyName: "National Australia Bank" },
  { symbol: "ANZ", companyName: "Australia & New Zealand Banking" },
  { symbol: "CSL", companyName: "CSL Ltd" },
  { symbol: "WES", companyName: "Wesfarmers" },
  { symbol: "FMG", companyName: "Fortescue Metals Group" }
];

// Parses Solace message data into appropriate format
export const parseStockData = (messageData: any): Partial<StockDataWithMetadata> => {
  try {
    if (!messageData) return {};
    
    // Attempt to parse string data if received as string
    const data = typeof messageData === 'string' 
      ? JSON.parse(messageData) 
      : messageData;
    
    return {
      ...data,
      lastTweet: data.lastTweet ? {
        ...data.lastTweet,
        timestamp: data.lastTweet.timestamp ? new Date(data.lastTweet.timestamp) : new Date()
      } : null,
      tradingSignal: data.tradingSignal ? {
        ...data.tradingSignal,
        timestamp: data.tradingSignal.timestamp ? new Date(data.tradingSignal.timestamp) : new Date()
      } : null
    };
  } catch (error) {
    console.error('Failed to parse stock data:', error);
    return {};
  }
};

// Stock exchange and country mappings
export const STOCK_EXCHANGES: Record<string, {name: string, country: string}> = {
  // US Exchanges
  "NYSE": { name: "New York Stock Exchange", country: "US" },
  "NASDAQ": { name: "NASDAQ", country: "US" },
  "AMEX": { name: "American Stock Exchange", country: "US" },
  // UK Exchanges
  "LSE": { name: "London Stock Exchange", country: "UK" },
  "AIM": { name: "Alternative Investment Market", country: "UK" },
  // Singapore Exchange
  "SGX": { name: "Singapore Exchange", country: "SG" },
  // Japan Exchange
  "TSE": { name: "Tokyo Stock Exchange", country: "JP" },
  // Australia Exchange
  "ASX": { name: "Australian Securities Exchange", country: "AU" },
  // Index exchanges
  "INDEX": { name: "Market Index", country: "US" }
};

// Map stock symbols to exchanges
export const STOCK_EXCHANGE_MAP: Record<string, string> = {
  // Market Indices
  "SPX": "INDEX",
  "DJI": "INDEX", 
  "NDX": "INDEX",
  "FTSE": "INDEX", // FTSE 100 (UK)
  "N225": "INDEX", // Nikkei 225 (Japan)
  "HSI": "INDEX",  // Hang Seng Index (Hong Kong)
  
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
  "ORCL": "NYSE", "IBM": "NYSE", "BA": "NYSE", "CAT": "NYSE", 
  "MCD": "NYSE",
  
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

// Create Solace topic for market data
export const createMarketDataTopic = (symbol: string): string => {
  const exchange = STOCK_EXCHANGE_MAP[symbol] || "NYSE";
  const country = STOCK_EXCHANGES[exchange]?.country || "US";
  
  // For market indices, use the simple topic structure
  if (exchange === "INDEX") {
    return `market-data/${symbol}`;
  }
  
  // For regular stocks, use the standard hierarchical topic structure:
  // market-data/EQ/{country}/{exchange}/{symbol}
  return `market-data/EQ/${country}/${exchange}/${symbol}`;
};

// Create Solace topic for Twitter feed
export const createTwitterFeedTopic = (symbol: string): string => {
  return `twitter-feed/${symbol}`;
};

// Create Solace topic for trading signals
export const createTradingSignalTopic = (symbol: string): string => {
  return `trading-signal/${symbol}`;
};
