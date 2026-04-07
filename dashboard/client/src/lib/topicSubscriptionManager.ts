/**
 * Topic Subscription Manager
 * 
 * This utility helps manage topic subscriptions for exchange and country wildcards vs individual stocks.
 * It ensures that we don't subscribe to individual stock topics when they're already covered
 * by exchange or country wildcards.
 */

/**
 * Structure to hold exchange wildcard subscription data
 */
interface ExchangeWildcardSubscription {
  id: string; // e.g., "LSE"
  country: string; // e.g., "UK" 
  topic: string; // e.g., "market-data/EQ/UK/LSE/>"
  subscriptionDate: Date;
}

/**
 * Structure to hold country wildcard subscription data
 */
interface CountryWildcardSubscription {
  id: string; // e.g., "JP"
  topic: string; // e.g., "market-data/EQ/JP/>"
  subscriptionDate: Date;
}

class TopicSubscriptionManager {
  private exchangeWildcards: ExchangeWildcardSubscription[] = [];
  private countryWildcards: CountryWildcardSubscription[] = [];
  private individualTopics: Set<string> = new Set();
  
  /**
   * Determine if a stock is already covered by an exchange or country wildcard
   */
  isStockCoveredByWildcard(exchange: string, country: string, symbol: string): boolean {
    // First check if we have a country wildcard that covers this stock
    const coveredByCountry = this.countryWildcards.some(wildcard => wildcard.id === country);
    
    if (coveredByCountry) {
      console.log(`Stock ${symbol} is covered by country-level wildcard for ${country}`);
      return true;
    }
    
    // Then check if we have an exchange wildcard that covers this stock
    return this.exchangeWildcards.some(wildcard => 
      wildcard.id === exchange && 
      (wildcard.country === country || wildcard.country === '*')
    );
  }
  
  /**
   * Check if a specific topic is covered by any wildcard subscription
   */
  isTopicCoveredByWildcard(topic: string): boolean {
    if (!topic) return false;
    
    // Parse the topic to extract components
    const parts = topic.split('/');
    if (parts.length !== 5) return false; // Not a standard market data topic
    
    // Extract topic components - market-data/EQ/JP/TSE/6758
    const type = parts[0]; // market-data
    const assetClass = parts[1]; // EQ
    const country = parts[2]; // JP
    const exchange = parts[3]; // TSE
    const symbol = parts[4]; // 6758
    
    // Check if covered by a country wildcard first (more efficient)
    if (this.countryWildcards.some(w => w.id === country)) {
      console.log(`Topic ${topic} is covered by country wildcard for ${country}`);
      return true;
    }
    
    // Then check if covered by an exchange wildcard
    return this.exchangeWildcards.some(w => 
      w.id === exchange && 
      (w.country === country || w.country === '*')
    );
  }
  
  /**
   * Add an exchange wildcard subscription
   */
  addExchangeWildcard(exchange: string, country: string): string {
    // Create the wildcard topic
    const topic = `market-data/EQ/${country}/${exchange}/>`;
    
    // Check if it already exists
    const existing = this.exchangeWildcards.find(w => 
      w.id === exchange && w.country === country
    );
    
    if (existing) {
      console.log(`Exchange wildcard for ${exchange}/${country} already exists, not adding again`);
      return existing.topic;
    }
    
    // Add the new wildcard
    this.exchangeWildcards.push({
      id: exchange,
      country,
      topic,
      subscriptionDate: new Date()
    });
    
    console.log(`Added exchange wildcard: ${topic}`);
    
    // Return the topic for subscription purposes
    return topic;
  }
  
  /**
   * Remove an exchange wildcard subscription
   */
  removeExchangeWildcard(exchange: string, country: string): string | null {
    const index = this.exchangeWildcards.findIndex(w => 
      w.id === exchange && w.country === country
    );
    
    if (index === -1) {
      console.log(`No exchange wildcard found for ${exchange}/${country}`);
      return null;
    }
    
    const removed = this.exchangeWildcards.splice(index, 1)[0];
    console.log(`Removed exchange wildcard: ${removed.topic}`);
    
    return removed.topic;
  }
  
  /**
   * Add an individual stock topic if it's not already covered by a wildcard
   */
  addStockTopic(exchange: string, country: string, symbol: string): string | null {
    // First check if this stock is already covered by a wildcard
    if (this.isStockCoveredByWildcard(exchange, country, symbol)) {
      console.log(`Stock ${symbol} is already covered by an exchange wildcard, not adding individual topic`);
      return null;
    }
    
    // Create the individual stock topic
    const topic = `market-data/EQ/${country}/${exchange}/${symbol}`;
    
    // Check if it's already in our individual topics
    if (this.individualTopics.has(topic)) {
      console.log(`Individual topic ${topic} already exists, not adding again`);
      return topic;
    }
    
    // Add to our individual topics set
    this.individualTopics.add(topic);
    console.log(`Added individual stock topic: ${topic}`);
    
    return topic;
  }
  
  /**
   * Remove an individual stock topic
   * Enhanced with detailed logging for better tracking
   * @returns The topic that was removed, or null if not found
   */
  removeStockTopic(exchange: string, country: string, symbol: string): string | null {
    const topic = `market-data/EQ/${country}/${exchange}/${symbol}`;
    
    // Check if it's in our individual topics list
    if (!this.individualTopics.has(topic)) {
      console.log(`[TopicManager] Individual topic ${topic} not found in tracking list, nothing to remove`);
      
      // Even though it's not in our list, we'll return the topic for unsubscription
      // This is a safeguard to ensure we attempt unsubscription even if our tracking is out of sync
      console.log(`[TopicManager] Returning topic ${topic} for Solace unsubscription anyway`);
      return topic;
    }
    
    // Remove it from our tracking
    this.individualTopics.delete(topic);
    console.log(`[TopicManager] Removed individual stock topic from tracking: ${topic}`);
    
    // Return the topic for unsubscription from Solace
    return topic;
  }
  
  /**
   * Add a country-level wildcard subscription
   */
  addCountryWildcard(country: string): string {
    // Create the country wildcard topic
    const topic = `market-data/EQ/${country}/>`;
    
    // Check if it already exists
    const existing = this.countryWildcards.find(w => w.id === country);
    
    if (existing) {
      console.log(`Country wildcard for ${country} already exists, not adding again`);
      return existing.topic;
    }
    
    // Add the new country wildcard
    this.countryWildcards.push({
      id: country,
      topic,
      subscriptionDate: new Date()
    });
    
    console.log(`Added country wildcard: ${topic}`);
    
    return topic;
  }
  
  /**
   * Remove a country wildcard subscription
   */
  removeCountryWildcard(country: string): string | null {
    const index = this.countryWildcards.findIndex(w => w.id === country);
    
    if (index === -1) {
      console.log(`No country wildcard found for ${country}`);
      return null;
    }
    
    const removed = this.countryWildcards.splice(index, 1)[0];
    console.log(`Removed country wildcard: ${removed.topic}`);
    
    return removed.topic;
  }
  
  /**
   * Find stocks that would be covered by a new country wildcard
   */
  findStocksCoveredByNewCountryWildcard(country: string): string[] {
    const coveredTopics: string[] = [];
    
    this.individualTopics.forEach(topic => {
      // Parse the topic to extract the country
      const parts = topic.split('/');
      if (parts.length !== 5) return; // Invalid topic format
      
      const topicCountry = parts[2];
      
      if (topicCountry === country) {
        coveredTopics.push(topic);
      }
    });
    
    return coveredTopics;
  }
  
  /**
   * Get all topics that need to be subscribed to (wildcards + individual)
   */
  getAllTopics(): string[] {
    const exchangeWildcardTopics = this.exchangeWildcards.map(w => w.topic);
    const countryWildcardTopics = this.countryWildcards.map(w => w.topic);
    
    return [
      ...exchangeWildcardTopics, 
      ...countryWildcardTopics, 
      ...Array.from(this.individualTopics)
    ];
  }
  
  /**
   * Get all wildcard topics (both exchange and country wildcards)
   */
  getWildcardTopics(): string[] {
    const exchangeWildcardTopics = this.exchangeWildcards.map(w => w.topic);
    const countryWildcardTopics = this.countryWildcards.map(w => w.topic);
    
    return [...exchangeWildcardTopics, ...countryWildcardTopics];
  }
  
  /**
   * Get all country wildcard subscriptions
   */
  getCountryWildcards(): CountryWildcardSubscription[] {
    return [...this.countryWildcards];
  }
  
  /**
   * Get all exchange wildcard subscriptions
   */
  getExchangeWildcards(): ExchangeWildcardSubscription[] {
    return [...this.exchangeWildcards];
  }
  
  /**
   * Get all individual stock topics
   */
  getIndividualTopics(): string[] {
    return Array.from(this.individualTopics);
  }
  
  /**
   * Find stocks that would be covered by a new exchange wildcard
   */
  findStocksCoveredByNewWildcard(exchange: string, country: string): string[] {
    const coveredTopics: string[] = [];
    
    this.individualTopics.forEach(topic => {
      // Parse the topic to extract exchange, country, and symbol
      const parts = topic.split('/');
      if (parts.length !== 5) return; // Invalid topic format
      
      const topicCountry = parts[2];
      const topicExchange = parts[3];
      
      if (topicExchange === exchange && topicCountry === country) {
        coveredTopics.push(topic);
      }
    });
    
    return coveredTopics;
  }
  
  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.exchangeWildcards = [];
    this.countryWildcards = [];
    this.individualTopics.clear();
    console.log('Cleared all topic subscriptions');
  }
}

export const topicManager = new TopicSubscriptionManager();
export default TopicSubscriptionManager;