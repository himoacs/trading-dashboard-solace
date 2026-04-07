export type Stock = {
  symbol: string;
  companyName?: string; // Optional, but good to have
  addedBy: 'user' | 'filter' | 'wildcard' | string; // How the stock was added
  countryCode?: string;     // e.g., 'US', 'JP'
  exchangeShortName?: string; // e.g., 'NASDAQ', 'TSE'
  // Add other relevant stock properties if known
};

// It's also good practice to have a more generic StockDefinition for lists if companyName is always present
export type StockDefinition = {
  symbol: string;
  companyName: string;
  countryCode?: string;
  exchangeShortName?: string;
  // Potentially other static data like industry, etc.
};

// You might also have a type for stock data that includes live updates
export type LiveStockData = Stock & {
  price?: number;
  change?: number;
  changePercent?: number;
  lastUpdated?: Date;
  // other live fields
}; 