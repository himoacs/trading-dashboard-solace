import { useState, useEffect, useRef, useCallback } from "react";
import { StockDataWithMetadata } from "@shared/schema";
import { STOCK_EXCHANGE_MAP } from "../lib/stockUtils";
import { getCountryCodeForExchange } from "../lib/countryUtils";
import { Button } from "@/components/ui/button";
import HoverTooltip from "./HoverTooltip";
import { StockDataRow } from "./StockDataRow";

// Use STOCK_EXCHANGE_MAP directly to get exchange for stock
const getExchangeForStock = (symbol: string): string => {
  return STOCK_EXCHANGE_MAP[symbol] || '';
};

// Helper function to intelligently display tweet content
const getDisplayTweet = (tweetData: any): string => {
  if (!tweetData) return 'N/A';

  let contentToParse = tweetData;
  // If tweetData has a 'content' field, and that field might be the JSON string or the actual text
  if (tweetData && typeof tweetData === 'object' && tweetData.content !== undefined) {
    contentToParse = tweetData.content;
  } else if (typeof tweetData !== 'string' && typeof tweetData !== 'object') {
    // If it's not a string or object directly, try to stringify it if it's a primitive that might represent content
    // but generally, we expect string or object.
    return String(tweetData);
  }


  if (typeof contentToParse === 'string') {
    try {
      const parsed = JSON.parse(contentToParse);
      // If parsed is an object, look for common text fields
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.text === 'string') return parsed.text;
        if (typeof parsed.full_text === 'string') return parsed.full_text;
        if (typeof parsed.message === 'string') return parsed.message;
        // If it's an array of tweets (less likely for 'lastTweet' but good to check)
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]) {
          const firstTweet = parsed[0];
          if (typeof firstTweet.text === 'string') return firstTweet.text;
          if (typeof firstTweet.full_text === 'string') return firstTweet.full_text;
          if (typeof firstTweet.message === 'string') return firstTweet.message;
        }
      }
      // If parsing succeeded but it's not an object with known fields, or it's a primitive JSON value
      return contentToParse; // Return original string if no specific field found after parsing
    } catch (e) {
      // Not a valid JSON string, assume the string itself is the tweet content
      return contentToParse;
    }
  } else if (contentToParse && typeof contentToParse === 'object') {
    // If it's already an object (e.g. stock.lastTweet was already parsed upstream)
    if (typeof contentToParse.text === 'string') return contentToParse.text;
    if (typeof contentToParse.full_text === 'string') return contentToParse.full_text;
    if (typeof contentToParse.message === 'string') return contentToParse.message;
    // Fallback: stringify the object if no known field found, though this might lead to [object Object]
    // A better fallback might be a specific field or a generic "Tweet data object"
    // For now, let's return a placeholder if it's an object with no known text fields.
    return "Tweet object (no text found)"; 
  }
  
  // Fallback for other types or if contentToParse became null/undefined through logic
  return tweetData && tweetData.content ? String(tweetData.content) : 'N/A';
};

// Extract exchange from topic if available and return abbreviation
const extractExchangeFromTopic = (symbol: string): string => {
  // Already using exchange abbreviations (NYSE, NASDAQ, etc.)
  return STOCK_EXCHANGE_MAP[symbol] || 'UNK';
};

// Helper function to convert country code to abbreviated country name
const getCountryNameFromCode = (code: string): string => {
  // Using country codes directly as abbreviations
  return code;
};

// Get country name for a stock based on its exchange
const getCountryNameForStock = (stock: StockDataWithMetadata): string => {
  if (stock.exchange) {
    const countryCode = getCountryCodeForExchange(stock.exchange);
    return getCountryNameFromCode(countryCode);
  }
  
  // Try getting exchange from symbol map
  const exchange = STOCK_EXCHANGE_MAP[stock.symbol];
  if (exchange) {
    const countryCode = getCountryCodeForExchange(exchange);
    return getCountryNameFromCode(countryCode);
  }
  
  return 'Unknown';
};

interface DataTableProps {
  data: StockDataWithMetadata[];
  isLoading: boolean;
  error: boolean;
  onStockSelectionChange: (symbol: string, selected: boolean) => void;
  onClearAllStocks?: () => void; // New prop for clearing all stocks
  selectedStocks: { symbol: string; companyName?: string; selected?: boolean; exchange?: string }[];
  onForceTweet: (symbol: string) => Promise<void>;
  onForceSignal?: (symbol: string) => Promise<void>;
  selectedExchanges?: string[]; // Add prop for selected exchanges with wildcards
  selectedCountries?: string[]; // Add prop for selected countries with wildcards
}

export default function DataTable({ 
  data, 
  isLoading, 
  error,
  onStockSelectionChange,
  onClearAllStocks,
  selectedStocks,
  onForceTweet,
  onForceSignal,
  selectedExchanges = [], // Default to empty array if not provided
  selectedCountries = [] // Default to empty array if not provided
}: DataTableProps) {
  // Format time ago
  const formatTimeAgo = (dateInput?: Date | string | null) => {
    if (!dateInput) return 'N/A';
    
    // Convert to Date object if it's a string
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    
    try {
      const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
      
      let interval = seconds / 31536000;
      if (interval > 1) return Math.floor(interval) + ' years ago';
      
      interval = seconds / 2592000;
      if (interval > 1) return Math.floor(interval) + ' months ago';
      
      interval = seconds / 86400;
      if (interval > 1) return Math.floor(interval) + ' days ago';
      
      interval = seconds / 3600;
      if (interval > 1) return Math.floor(interval) + ' hours ago';
      
      interval = seconds / 60;
      if (interval > 1) return Math.floor(interval) + ' mins ago';
      
      return Math.floor(seconds) + ' secs ago';
    } catch (error) {
      console.error('Error formatting time ago:', error);
      return 'N/A';
    }
  };

  // Format price with currency symbol
  const formatPrice = (price: number | null | undefined) => {
    if (price === null || price === undefined || isNaN(price)) {
      return <span className="font-mono font-semibold text-gray-400">N/A</span>;
    }
    return (
      <span className="font-mono font-semibold gradient-text">
        ${parseFloat(price.toString()).toFixed(2)}
      </span>
    );
  };

  // Format percent change
  const formatPercentChange = (change: number | null | undefined) => {
    if (change === null || change === undefined || isNaN(change)) {
      return <span className="text-gray-400">N/A</span>;
    }
    
    const numericChange = parseFloat(change.toString());
    const formattedChange = `${numericChange >= 0 ? '+' : ''}${numericChange.toFixed(2)}%`;
    const trendClass = numericChange > 0 ? 'trend-up' : numericChange < 0 ? 'trend-down' : '';
    
    return (
      <div className={`${trendClass} flex items-center`}>
        {numericChange > 0 ? (
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        ) : numericChange < 0 ? (
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        ) : null}
        <span>{formattedChange}</span>
      </div>
    );
  };

  // Signal class based on signal value
  const getSignalClass = (signal: string) => {
    switch (signal.toUpperCase()) {
      case 'BUY': return 'bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold inline-block';
      case 'SELL': return 'bg-red-500 text-white px-3 py-1 rounded-full text-xs font-semibold inline-block';
      case 'HOLD': return 'bg-yellow-400 text-gray-800 px-3 py-1 rounded-full text-xs font-semibold inline-block';
      default: return 'text-xs inline-block px-3 py-1';
    }
  };

  if (isLoading) {
    return (
      <main className="flex-1 overflow-x-auto overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
        <div className="data-card overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-lg gradient-text">Live Market Intelligence</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 table-fixed">
              <thead className="dark:bg-gradient-to-r dark:from-gray-900 dark:to-black">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-28">Symbol</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Exchange</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Country</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Price</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">% Change</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-96">Latest Tweet</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Signal</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                <tr>
                  <td colSpan={7} className="px-6 py-12">
                    <div className="flex flex-col justify-center items-center">
                      <div className="relative w-16 h-16">
                        <div className="absolute top-0 left-0 w-full h-full rounded-full border-4 border-t-primary border-r-transparent border-b-primary border-l-transparent animate-spin"></div>
                        <div className="absolute top-2 left-2 w-12 h-12 rounded-full border-4 border-t-transparent border-r-blue-500 border-b-transparent border-l-blue-500 animate-spin"></div>
                      </div>
                      <span className="mt-4 text-sm gradient-text">Loading market data...</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex-1 overflow-x-auto overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
        <div className="data-card overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-lg gradient-text">Live Market Intelligence</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 table-fixed">
              <thead className="dark:bg-gradient-to-r dark:from-gray-900 dark:to-black">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-28">Symbol</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Exchange</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Country</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Price</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">% Change</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-96">Latest Tweet</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Signal</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                <tr>
                  <td colSpan={7} className="px-6 py-12">
                    <div className="text-center">
                      <div className="bg-gradient-to-r from-red-500 to-rose-600 inline-block p-4 rounded-full text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h3 className="mt-4 text-lg font-medium text-gray-700 dark:text-gray-300">Connection Error</h3>
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Unable to connect to Solace broker</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    );
  }

  if (!data || data.length === 0) {
    return (
      <main className="flex-1 overflow-x-auto overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
        <div className="data-card overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-lg gradient-text">Live Market Intelligence</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 table-fixed">
              <thead className="dark:bg-gradient-to-r dark:from-gray-900 dark:to-black">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-28">Symbol</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Exchange</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Country</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Price</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">% Change</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-96">Latest Tweet</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Signal</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center bg-card text-card-foreground">
                    <div className="flex flex-col items-center justify-center text-center">
                      <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                      <h3 className="mt-2 text-sm font-medium text-foreground">No stocks selected</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Select stocks in the configuration panel to view market intelligence
                      </p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-x-auto overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
      <div className="data-card overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg gradient-text">Live Market Intelligence</h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 table-fixed">
            <thead className="dark:bg-gradient-to-r dark:from-gray-900 dark:to-black">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-28">Symbol</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Exchange</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Country</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Price</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">% Change</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-96">Latest Tweet</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Signal</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
              {data.map((stock) => {
                const displayTweetContent = getDisplayTweet(stock.lastTweet);
                const isSelected = selectedStocks.some(s => s.symbol === stock.symbol && s.selected);
                
                return (
                  <StockDataRow
                    key={stock.id || stock.symbol}
                    stock={stock}
                    displayTweetContent={displayTweetContent}
                    isSelected={isSelected}
                    onStockSelectionChange={onStockSelectionChange}
                    formatPrice={formatPrice}
                    formatPercentChange={formatPercentChange}
                    getSignalClass={getSignalClass}
                    getCountryNameForStock={getCountryNameForStock}
                    extractExchangeFromTopic={extractExchangeFromTopic}
                  />
                );
              })}
              
              {data.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                      No data available. Select stocks or check connection.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}