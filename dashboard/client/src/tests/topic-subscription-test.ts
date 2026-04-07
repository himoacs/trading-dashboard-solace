/**
 * Topic Subscription Test
 * 
 * This module tests the wildcard/individual topic subscription logic to ensure
 * that when exchange wildcards are used, individual stock topics are not created.
 */

type MockSolaceSubscription = {
  topic: string;
  isWildcard: boolean;
  addedAt: Date;
  source: 'exchange-wildcard' | 'individual-stock';
};

class TopicSubscriptionTester {
  private solaceSubscriptions: MockSolaceSubscription[] = [];
  private wildcardPrefixes: string[] = [];
  
  /**
   * Subscribe to a Solace topic
   */
  subscribeTopic(topic: string, isWildcard: boolean, source: 'exchange-wildcard' | 'individual-stock'): boolean {
    // First, check if we're already subscribed to this exact topic
    if (this.solaceSubscriptions.some(sub => sub.topic === topic)) {
      console.log(`[TEST] Already subscribed to ${topic}, skipping`);
      return false;
    }
    
    // For exchange wildcards, update our wildcard prefixes list
    if (isWildcard && topic.includes('>')) {
      // Extract the prefix (remove the > at the end)
      const wildcardPrefix = topic.substring(0, topic.length - 1);
      this.wildcardPrefixes.push(wildcardPrefix);
      
      // Add the subscription
      this.solaceSubscriptions.push({
        topic,
        isWildcard,
        addedAt: new Date(),
        source
      });
      
      console.log(`[TEST] Added wildcard subscription: ${topic}`);
      return true;
    }
    
    // For individual stocks, check if they're already covered by a wildcard
    if (!isWildcard) {
      // Check if this topic is already covered by any wildcard prefix
      const isAlreadyCovered = this.wildcardPrefixes.some(prefix => topic.startsWith(prefix));
      
      if (isAlreadyCovered) {
        console.log(`[TEST] Topic ${topic} is already covered by a wildcard, SKIPPING SUBSCRIPTION`);
        return false;
      } else {
        // Not covered by a wildcard, proceed with subscription
        this.solaceSubscriptions.push({
          topic,
          isWildcard,
          addedAt: new Date(),
          source
        });
        
        console.log(`[TEST] Added individual subscription: ${topic}`);
        return true;
      }
    }
    
    // Default case - add the subscription
    this.solaceSubscriptions.push({
      topic,
      isWildcard,
      addedAt: new Date(),
      source
    });
    
    console.log(`[TEST] Added subscription: ${topic}, isWildcard: ${isWildcard}`);
    return true;
  }
  
  /**
   * Clear all subscriptions
   */
  clearSubscriptions() {
    this.solaceSubscriptions = [];
    this.wildcardPrefixes = [];
  }
  
  /**
   * Get statistics about subscriptions
   */
  getStats() {
    const wildcardCount = this.solaceSubscriptions.filter(sub => sub.isWildcard).length;
    const individualCount = this.solaceSubscriptions.filter(sub => !sub.isWildcard).length;
    const exchangeWildcardCount = this.solaceSubscriptions.filter(sub => 
      sub.source === 'exchange-wildcard').length;
    const individualStockCount = this.solaceSubscriptions.filter(sub => 
      sub.source === 'individual-stock').length;
    
    return {
      total: this.solaceSubscriptions.length,
      wildcardCount,
      individualCount,
      exchangeWildcardCount,
      individualStockCount,
      topics: this.solaceSubscriptions.map(sub => sub.topic),
    };
  }
  
  /**
   * Test exchange wildcard subscriptions to make sure individual stocks are not duplicated
   */
  runExchangeWildcardTest() {
    this.clearSubscriptions();
    console.log('\n[TEST] Running Exchange Wildcard Test');
    
    // STEP 1: Add exchange wildcard for LSE
    this.subscribeTopic('market-data/EQ/UK/LSE/>', true, 'exchange-wildcard');
    
    // STEP 2: Try to add individual stocks from LSE - should be skipped
    const lseStocks = ['HSBA', 'BARC', 'BP', 'LLOY', 'VOD'];
    lseStocks.forEach(symbol => {
      const topic = `market-data/EQ/UK/LSE/${symbol}`;
      this.subscribeTopic(topic, false, 'individual-stock');
    });
    
    // STEP 3: Add exchange wildcard for NYSE
    this.subscribeTopic('market-data/EQ/US/NYSE/>', true, 'exchange-wildcard');
    
    // STEP 4: Try to add individual stocks from NYSE - should be skipped
    const nyseStocks = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META'];
    nyseStocks.forEach(symbol => {
      const topic = `market-data/EQ/US/NYSE/${symbol}`;
      this.subscribeTopic(topic, false, 'individual-stock');
    });
    
    // STEP 5: Add individual stocks from NASDAQ - should be added since no wildcard
    const nasdaqStocks = ['TSLA', 'NVDA', 'INTC', 'CSCO', 'ADBE'];
    nasdaqStocks.forEach(symbol => {
      const topic = `market-data/EQ/US/NASDAQ/${symbol}`;
      this.subscribeTopic(topic, false, 'individual-stock');
    });
    
    // Analyze results
    const stats = this.getStats();
    console.log('\n[TEST] Subscription Stats:', stats);
    
    // Verify exchange wildcard test
    const allLseTopics = this.solaceSubscriptions.filter(sub => 
      sub.topic.includes('LSE/') && !sub.isWildcard);
    const allNyseTopics = this.solaceSubscriptions.filter(sub => 
      sub.topic.includes('NYSE/') && !sub.isWildcard);
    const allNasdaqTopics = this.solaceSubscriptions.filter(sub => 
      sub.topic.includes('NASDAQ/') && !sub.isWildcard);
    
    console.log(`[TEST] LSE individual topics (should be 0): ${allLseTopics.length}`);
    console.log(`[TEST] NYSE individual topics (should be 0): ${allNyseTopics.length}`);
    console.log(`[TEST] NASDAQ individual topics (should be 5): ${allNasdaqTopics.length}`);
    
    // Test pass/fail
    const testPassed = 
      allLseTopics.length === 0 && 
      allNyseTopics.length === 0 && 
      allNasdaqTopics.length === 5;
    
    console.log(`\n[TEST] Exchange Wildcard Test: ${testPassed ? 'PASSED ✓' : 'FAILED ✗'}`);
    return testPassed;
  }
}

/**
 * Run the topic subscription tests
 */
function runTopicSubscriptionTests() {
  const tester = new TopicSubscriptionTester();
  const testPassed = tester.runExchangeWildcardTest();
  
  if (testPassed) {
    console.log('\n✅ All topic subscription tests PASSED');
  } else {
    console.error('\n❌ Topic subscription tests FAILED');
  }
  
  return testPassed;
}

export { TopicSubscriptionTester, runTopicSubscriptionTests };