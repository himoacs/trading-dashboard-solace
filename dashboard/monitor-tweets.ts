/**
 * Direct Twitter frequency monitoring script
 * 
 * This version focuses only on verifying the 10-second interval
 * without waiting for tweets
 */
import { twitterService } from './server/services/twitterService';

// First, set up AAPL with 10-second frequency
console.log("Setting up AAPL with 10-second tweet frequency");
twitterService.startSimulation(['AAPL'], 10);

// Output what we've done
console.log(`Twitter service is now active for symbols: ${twitterService.getActiveSymbols().join(', ')}`);
const metrics = twitterService.getMetrics();
console.log(`Current frequency setting: ${metrics.configuredInterval} seconds`);

// Monitor tweets every second for 1 minute
console.log("\nMonitoring tweets for 60 seconds...");
console.log("Timestamp | Symbol | Message");
console.log("----------|--------|--------------------------------------------------");

const startTime = Date.now();
let lastTweetCounts: {[symbol: string]: number} = {};

// Initialize last tweet counts
for (const symbol of twitterService.getActiveSymbols()) {
  lastTweetCounts[symbol] = metrics.perSymbolMetrics[symbol]?.tweetsPublished || 0;
}

// Check every second
const interval = setInterval(() => {
  const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  
  // Get current metrics
  const currentMetrics = twitterService.getMetrics();
  
  // Check for new tweets
  for (const symbol of twitterService.getActiveSymbols()) {
    const currentCount = currentMetrics.perSymbolMetrics[symbol]?.tweetsPublished || 0;
    if (currentCount > (lastTweetCounts[symbol] || 0)) {
      console.log(`${elapsedSeconds}s | ${symbol} | New tweet detected (total: ${currentCount})`);
      lastTweetCounts[symbol] = currentCount;
    }
  }
  
  // Stop after 60 seconds
  if (elapsedSeconds >= 60) {
    clearInterval(interval);
    console.log("\nMonitoring complete");
    
    // Show final statistics
    const finalMetrics = twitterService.getMetrics();
    console.log("\nFinal tweet statistics:");
    for (const [symbol, data] of Object.entries(finalMetrics.perSymbolMetrics)) {
      console.log(`- ${symbol}: ${data.tweetsPublished} tweets, publishing rate: ${data.publishingRatePerMinute.toFixed(2)} per minute`);
    }
    
    // Verify 10-second interval (should be ~6 tweets per minute)
    const aaplRate = finalMetrics.perSymbolMetrics['AAPL']?.publishingRatePerMinute || 0;
    if (aaplRate >= 5.5 && aaplRate <= 6.5) {
      console.log("\n✅ VALIDATION PASSED: AAPL tweet frequency is consistent with 10-second interval");
    } else {
      console.log("\n❌ VALIDATION FAILED: AAPL tweet frequency does not match expected 10-second interval");
      console.log(`   Expected ~6 tweets/minute, got ${aaplRate.toFixed(2)}`);
    }
    
    // Exit
    process.exit(0);
  }
}, 1000);