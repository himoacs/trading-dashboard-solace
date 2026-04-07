/**
 * Traffic Generator Types
 * 
 * Types for browser-native traffic generators that publish market data
 * and tweets directly from the browser to Solace using solclientjs.
 */

export type GeneratorType = 'market-data' | 'twitter';

export type GeneratorStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface GeneratorConfig {
  id: string;
  type: GeneratorType;
  name: string;
  // Publishing rate in messages per second (market data) or tweets per minute (twitter)
  messageRate: number;
  // QoS options
  deliveryMode: 'DIRECT' | 'PERSISTENT';
  allowMessageEliding: boolean;
  dmqEligible: boolean;
  // Topic pattern for publishing
  topicPattern: string;
  // Whether the generator is enabled
  enabled: boolean;
}

export interface GeneratorStats {
  messagesSent: number;
  bytesSent: number;
  publishRate: number;  // messages per second
  errors: number;
  startTime: number;
  elapsed: number;  // seconds
  lastPublishTime: number | null;
}

export interface GeneratorState {
  config: GeneratorConfig;
  status: GeneratorStatus;
  stats: GeneratorStats;
  output: string[];
  error: string | null;
}

export interface BrokerConfig {
  url: string;  // WebSocket URL (ws:// or wss://)
  vpnName: string;
  username: string;
  password: string;
}

// Stock data for market data generator - matches the existing StockSelection pattern
export interface StockInfo {
  symbol: string;
  companyName: string;
  exchange: string;
  country: string;
  currentPrice: number;
  previousClose: number;
}

// Tweet data for twitter generator
export interface TweetData {
  symbol: string;
  content: string;
  author: string;
  timestamp: string;
  sentiment?: 'bullish' | 'bearish' | 'neutral';
}

// Market data message format - matches what the dashboard expects
export interface MarketDataMessage {
  symbol: string;
  companyName: string;
  currentPrice: number;
  percentChange: number;
  priceChange: number;
  volume: number;
  previousClose: number;
  exchange: string;
  country: string;
  timestamp: string;
}

// Default configurations
export const DEFAULT_MARKET_DATA_CONFIG: GeneratorConfig = {
  id: 'market-data-generator',
  type: 'market-data',
  name: 'Market Data Publisher',
  messageRate: 10,  // 10 messages per second
  deliveryMode: 'DIRECT',
  allowMessageEliding: false,
  dmqEligible: true,
  topicPattern: 'market-data/EQ/{country}/{exchange}/{symbol}',
  enabled: false,
};

export const DEFAULT_TWITTER_CONFIG: GeneratorConfig = {
  id: 'twitter-generator',
  type: 'twitter',
  name: 'Twitter Feed Publisher',
  messageRate: 2,  // 2 tweets per minute
  deliveryMode: 'DIRECT',
  allowMessageEliding: true,
  dmqEligible: true,
  topicPattern: 'twitter-feed/{symbol}',
  enabled: false,
};

// Storage key for persisting generator state
export const GENERATOR_STORAGE_KEY = 'solcapital-traffic-generators';
