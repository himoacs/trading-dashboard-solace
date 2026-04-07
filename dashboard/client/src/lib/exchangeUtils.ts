import { ExchangeInfo } from "@shared/schema";
import { STOCK_EXCHANGES, STOCK_EXCHANGE_MAP } from "./stockUtils";

/**
 * Exchange information with Solace wildcard topic patterns
 * This allows subscribing to all stocks from a particular exchange
 */
export const EXCHANGES: ExchangeInfo[] = [
  // US Exchanges
  {
    id: "NYSE",
    name: STOCK_EXCHANGES["NYSE"].name,
    country: STOCK_EXCHANGES["NYSE"].country,
    solaceTopicPattern: "market-data/EQ/US/NYSE/>",
    stocks: Object.keys(STOCK_EXCHANGE_MAP).filter(symbol => STOCK_EXCHANGE_MAP[symbol] === "NYSE")
  },
  {
    id: "NASDAQ",
    name: STOCK_EXCHANGES["NASDAQ"].name,
    country: STOCK_EXCHANGES["NASDAQ"].country, 
    solaceTopicPattern: "market-data/EQ/US/NASDAQ/>",
    stocks: Object.keys(STOCK_EXCHANGE_MAP).filter(symbol => STOCK_EXCHANGE_MAP[symbol] === "NASDAQ")
  },
  // UK Exchange
  {
    id: "LSE",
    name: STOCK_EXCHANGES["LSE"].name,
    country: STOCK_EXCHANGES["LSE"].country,
    solaceTopicPattern: "market-data/EQ/UK/LSE/>",
    stocks: Object.keys(STOCK_EXCHANGE_MAP).filter(symbol => STOCK_EXCHANGE_MAP[symbol] === "LSE")
  },
  // Singapore Exchange
  {
    id: "SGX",
    name: STOCK_EXCHANGES["SGX"].name,
    country: STOCK_EXCHANGES["SGX"].country,
    solaceTopicPattern: "market-data/EQ/SG/SGX/>",
    stocks: Object.keys(STOCK_EXCHANGE_MAP).filter(symbol => STOCK_EXCHANGE_MAP[symbol] === "SGX")
  },
  // Japan Exchange
  {
    id: "TSE",
    name: STOCK_EXCHANGES["TSE"].name,
    country: STOCK_EXCHANGES["TSE"].country,
    solaceTopicPattern: "market-data/EQ/JP/TSE/>",
    stocks: Object.keys(STOCK_EXCHANGE_MAP).filter(symbol => STOCK_EXCHANGE_MAP[symbol] === "TSE")
  },
  // Australia Exchange
  {
    id: "ASX",
    name: STOCK_EXCHANGES["ASX"].name,
    country: STOCK_EXCHANGES["ASX"].country,
    solaceTopicPattern: "market-data/EQ/AU/ASX/>",
    stocks: Object.keys(STOCK_EXCHANGE_MAP).filter(symbol => STOCK_EXCHANGE_MAP[symbol] === "ASX")
  },
  // Market Indices have been removed
];

/**
 * Get specific exchange by ID
 */
export const getExchangeById = (id: string): ExchangeInfo | undefined => {
  return EXCHANGES.find(exchange => exchange.id === id);
};

/**
 * Get the exchange for a specific stock symbol
 */
export const getExchangeForSymbol = (symbol: string): ExchangeInfo | undefined => {
  const exchangeId = STOCK_EXCHANGE_MAP[symbol];
  if (!exchangeId) return undefined;
  return getExchangeById(exchangeId);
};

/**
 * Get the exchange ID for a specific stock symbol
 */
export const getExchangeForStock = (symbol: string): string => {
  return STOCK_EXCHANGE_MAP[symbol] || '';
};

/**
 * Get all stock symbols for a specific exchange
 */
export const getStocksForExchange = (exchangeId: string): string[] => {
  const exchange = getExchangeById(exchangeId);
  return exchange?.stocks || [];
};

/**
 * Get wildcard topic pattern for an exchange
 */
export const getWildcardTopicForExchange = (exchangeId: string): string | undefined => {
  const exchange = getExchangeById(exchangeId);
  return exchange?.solaceTopicPattern;
};