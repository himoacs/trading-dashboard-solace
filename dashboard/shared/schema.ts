import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Original user table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Solace connection configuration
export const solaceConfig = pgTable("solace_config", {
  id: serial("id").primaryKey(),
  brokerUrl: text("broker_url").notNull(),
  vpnName: text("vpn_name").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  tcpPort: text("tcp_port").default("55555"),  // Default TCP port for backend connections
  configType: text("config_type").default("frontend").notNull(), // 'frontend', 'backend', 'twitter', or 'twitter-publisher'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const insertSolaceConfigSchema = createInsertSchema(solaceConfig).omit({
  id: true,
  createdAt: true,
});

export type InsertSolaceConfig = z.infer<typeof insertSolaceConfigSchema>;
export type SolaceConfig = typeof solaceConfig.$inferSelect;

// Stock data
export const stocks = pgTable("stocks", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 10 }).notNull().unique(),
  companyName: text("company_name").notNull(),
  currentPrice: real("current_price"),
  percentChange: real("percent_change"),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
});

export const insertStockSchema = createInsertSchema(stocks).omit({
  id: true,
  lastUpdated: true,
});

export type InsertStock = z.infer<typeof insertStockSchema>;
export type Stock = typeof stocks.$inferSelect;

// Twitter feed
export const twitterFeeds = pgTable("twitter_feeds", {
  id: serial("id").primaryKey(),
  stockId: integer("stock_id").notNull().references(() => stocks.id),
  content: text("content").notNull(),
  sentiment: real("sentiment"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const insertTwitterFeedSchema = createInsertSchema(twitterFeeds).omit({
  id: true,
  timestamp: true,
});

export type InsertTwitterFeed = z.infer<typeof insertTwitterFeedSchema>;
export type TwitterFeed = typeof twitterFeeds.$inferSelect;

// News feed
export const newsFeeds = pgTable("news_feeds", {
  id: serial("id").primaryKey(),
  stockId: integer("stock_id").notNull().references(() => stocks.id),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  source: text("source").notNull(),
  url: text("url").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const insertNewsFeedSchema = createInsertSchema(newsFeeds).omit({
  id: true,
  timestamp: true,
});

export type InsertNewsFeed = z.infer<typeof insertNewsFeedSchema>;
export type NewsFeed = typeof newsFeeds.$inferSelect;

// Economic Indicators
export const economicIndicators = pgTable("economic_indicators", {
  id: serial("id").primaryKey(),
  stockId: integer("stock_id").notNull().references(() => stocks.id),
  indicatorType: text("indicator_type").notNull(), // GDP, Inflation, Unemployment, etc.
  value: real("value").notNull(),
  previousValue: real("previous_value").notNull(),
  percentChange: real("percent_change").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const insertEconomicIndicatorSchema = createInsertSchema(economicIndicators).omit({
  id: true,
  timestamp: true,
});

export type InsertEconomicIndicator = z.infer<typeof insertEconomicIndicatorSchema>;
export type EconomicIndicator = typeof economicIndicators.$inferSelect;

// Trading signals
export const tradingSignals = pgTable("trading_signals", {
  id: serial("id").primaryKey(),
  stockId: integer("stock_id").notNull().references(() => stocks.id),
  signal: text("signal").notNull(), // BUY, SELL, HOLD
  confidence: real("confidence").notNull(),
  reasoning: text("reasoning"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const insertTradingSignalSchema = createInsertSchema(tradingSignals).omit({
  id: true,
  timestamp: true,
});

export type InsertTradingSignal = z.infer<typeof insertTradingSignalSchema>;
export type TradingSignal = typeof tradingSignals.$inferSelect;

// Stock subscription
export const stockSubscriptions = pgTable("stock_subscriptions", {
  id: serial("id").primaryKey(),
  stockId: integer("stock_id").notNull().references(() => stocks.id),
  subscriberType: text("subscriber_type").notNull(), // MARKET_DATA, TWITTER_FEED, TRADING_SIGNAL
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertStockSubscriptionSchema = createInsertSchema(stockSubscriptions).omit({
  id: true,
  createdAt: true,
});

export type InsertStockSubscription = z.infer<typeof insertStockSubscriptionSchema>;
export type StockSubscription = typeof stockSubscriptions.$inferSelect;

// Combined types for frontend use
export type StockDataWithMetadata = {
  id: number;
  symbol: string;
  companyName: string;   // Company name is required but might be defaulted in code
  currentPrice: number | null;
  percentChange: number | null;
  priceChange?: number | null; // Added: Price change from previous close
  volume?: number | null; // Added: Trading volume
  previousClose?: number | null; // Added: Previous closing price
  lastUpdated?: string; // ISO string timestamp of the last update
  selected?: boolean;    // Flag to indicate if this stock is selected
  exchange?: string;     // Exchange identifier (NYSE, NASDAQ, etc.)
  country?: string;      // Country code (US, UK, JP, etc.)
  addedByWildcard?: boolean; // Flag to indicate if stock was added by wildcard subscription
  coveredByWildcard?: boolean; // Flag to indicate if stock is covered by wildcard subscription
  individuallySelected?: boolean; // Flag to indicate if the stock was specifically selected by the user
  tradingSignal: {
    signal: string;
    confidence: number;
    timestamp: string; // ISO date string
  } | null;
  latestNews: {
    headline: string;
    summary: string;
    source: string;
    url: string;
    timestamp: string; // ISO date string
  } | null;
  economicIndicator: {
    indicatorType: string;
    value: number;
    previousValue: number;
    percentChange: number;
    timestamp: string; // ISO date string
  } | null;
  // Support for signal messages that include tweet content
  lastTweet?: {
    content: string;
    timestamp: string; // ISO date string
  } | null;
};

// Solace client connection schema
export const solaceConnectionSchema = z.object({
  brokerUrl: z.string().min(1, "Broker URL is required"),
  vpnName: z.string().min(1, "VPN Name is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  tcpPort: z.string().default("55555").optional(), // TCP port used for backend connections with default 55555
  configType: z.enum(["frontend", "backend", "twitter", "twitter-publisher"]).default("frontend")
});

export type SolaceConnection = z.infer<typeof solaceConnectionSchema>;

// Stock selection schema
export const stockSelectionSchema = z.object({
  symbol: z.string().min(1).max(10),
  companyName: z.string().optional(),
  selected: z.boolean().optional(),
  exchange: z.string().optional(), // Exchange property 
  addedByWildcard: z.boolean().optional(), // Flag for stocks added by wildcard subscription
  coveredByWildcard: z.boolean().optional(), // Flag for stocks covered by a wildcard subscription
  individuallySelected: z.boolean().optional() // Flag for stocks that were individually selected by the user
});

export type StockSelection = z.infer<typeof stockSelectionSchema>;

// Exchange information schema
export const exchangeInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  solaceTopicPattern: z.string(),
  stocks: z.array(z.string()).optional(),
});

export type ExchangeInfo = z.infer<typeof exchangeInfoSchema>;

// Exchange subscription schema for wildcard selections
export const exchangeSubscriptionSchema = z.object({
  exchangeId: z.string(),
  subscribed: z.boolean(),
});

export type ExchangeSubscription = z.infer<typeof exchangeSubscriptionSchema>;

// Data subscription schema
export const dataSubscriptionSchema = z.object({
  marketData: z.boolean().default(true),
  signalData: z.boolean().default(true),
  newsFeed: z.boolean().default(true),
  economicData: z.boolean().default(true),
  twitterFeed: z.boolean().default(true) // Added for Twitter feed support
});

export type DataSubscription = z.infer<typeof dataSubscriptionSchema>;

// Simulation settings schema
export const simulationSettingsSchema = z.object({
  updateFrequency: z.number().int().min(1).max(30).default(5)
});

export type SimulationSettings = z.infer<typeof simulationSettingsSchema>;

// Publisher configuration schema
export const publisherConfigSchema = z.object({
  // Tweet frequency in seconds (10-300 seconds)
  tweetFrequency: z.number().int().min(10).max(300).default(60),
  // Market data update frequency in seconds (1-30 seconds)
  marketDataFrequency: z.number().int().min(1).max(30).default(5),
  // QoS options
  deliveryMode: z.enum(["DIRECT", "PERSISTENT"]).default("DIRECT"),
  // Message eliding options
  allowMessageEliding: z.boolean().default(false),
  // DMQ eligible option
  dmqEligible: z.boolean().default(true)
});

export type PublisherConfig = z.infer<typeof publisherConfigSchema>;
