import { STOCK_EXCHANGES } from "./stockUtils";

/**
 * Country information with Solace wildcard topic patterns
 * This allows subscribing to all stocks from a particular country
 */
export interface CountryInfo {
  id: string;
  name: string;
  solaceTopicPattern: string;
  exchanges: string[];
}

/**
 * Available countries with their respective exchanges and wildcard patterns
 */
export const COUNTRIES: CountryInfo[] = [
  {
    id: "US",
    name: "United States",
    solaceTopicPattern: "market-data/EQ/US/>",
    exchanges: ["NYSE", "NASDAQ"]
  },
  {
    id: "UK",
    name: "United Kingdom",
    solaceTopicPattern: "market-data/EQ/UK/>",
    exchanges: ["LSE", "AIM"]
  },
  {
    id: "SG",
    name: "Singapore",
    solaceTopicPattern: "market-data/EQ/SG/>",
    exchanges: ["SGX"]
  },
  {
    id: "JP",
    name: "Japan",
    solaceTopicPattern: "market-data/EQ/JP/>",
    exchanges: ["TSE"]
  },
  {
    id: "AU",
    name: "Australia",
    solaceTopicPattern: "market-data/EQ/AU/>",
    exchanges: ["ASX"]
  }
];

/**
 * Get country by ID
 */
export const getCountryById = (id: string): CountryInfo | undefined => {
  return COUNTRIES.find(country => country.id === id);
};

/**
 * Get the country code for a given exchange
 */
export const getCountryCodeForExchange = (exchangeId: string): string => {
  return STOCK_EXCHANGES[exchangeId]?.country || "US";
};

/**
 * Get wildcard topic pattern for a country
 */
export const getWildcardTopicForCountry = (countryId: string): string | undefined => {
  console.log(`===== COUNTRY WILDCARD DEBUG: Getting wildcard topic for country ${countryId} =====`);
  const country = getCountryById(countryId);
  const pattern = country?.solaceTopicPattern;
  console.log(`===== COUNTRY WILDCARD DEBUG: Country ${countryId} wildcard pattern: ${pattern} =====`);
  return pattern;
};

/**
 * Get all exchanges for a specific country
 */
export const getExchangesForCountry = (countryId: string): string[] => {
  const country = getCountryById(countryId);
  return country?.exchanges || [];
};

/**
 * Get the country for a specific stock symbol by looking up its exchange
 */
export const getCountryForSymbol = (symbol: string, exchangeMap: Record<string, string>): string => {
  const exchange = exchangeMap[symbol];
  return exchange ? getCountryCodeForExchange(exchange) : "US";
};