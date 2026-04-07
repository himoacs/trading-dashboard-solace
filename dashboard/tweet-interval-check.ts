/**
 * Simple script to verify 10-second tweet interval for AAPL
 */
import { twitterService } from './server/services/twitterService';

// Set up AAPL with 10-second tweet frequency
console.log("Setting AAPL tweet frequency to 10 seconds...");
twitterService.startSimulation(['AAPL'], 10);

// Force first tweet immediately
console.log("\nForcing initial tweet for AAPL...");
twitterService.forceTweet('AAPL')
  .then(() => console.log("Initial tweet sent successfully"))
  .catch(err => console.error("Error sending initial tweet:", err));

// Get initial tweet count
let lastTweetCount = twitterService.getMetrics().perSymbolMetrics['AAPL']?.tweetsPublished || 0;
console.log(`Initial tweet count for AAPL: ${lastTweetCount}`);

// Function to check for new tweets
function checkForNewTweets() {
  const metrics = twitterService.getMetrics();
  const currentCount = metrics.perSymbolMetrics['AAPL']?.tweetsPublished || 0;
  
  if (currentCount > lastTweetCount) {
    console.log(`New tweet detected at ${new Date().toLocaleTimeString()}`);
    console.log(`  Tweet count: ${currentCount} (increased by ${currentCount - lastTweetCount})`);
    lastTweetCount = currentCount;
  }
}

// Check every 2 seconds for 30 seconds total to catch tweet generation
console.log("\nMonitoring for tweets every 2 seconds for 30 seconds total...");
console.log("Timestamp     | Event");
console.log("--------------|------------------------------------------");

let checkCount = 0;
const interval = setInterval(() => {
  checkCount++;
  const now = new Date().toLocaleTimeString();
  console.log(`${now} | Check #${checkCount}...`);
  checkForNewTweets();
  
  // Stop after 15 checks (30 seconds)
  if (checkCount >= 15) {
    clearInterval(interval);
    
    // Final stats
    const finalMetrics = twitterService.getMetrics();
    console.log("\nFinal Statistics:");
    console.log(`Total AAPL tweets: ${finalMetrics.perSymbolMetrics['AAPL']?.tweetsPublished || 0}`);
    console.log(`Configured interval: ${finalMetrics.configuredInterval} seconds`);
    console.log(`Publishing rate: ${finalMetrics.perSymbolMetrics['AAPL']?.publishingRatePerMinute || 0} tweets/minute`);
    
    // Validate 10-second interval (should be around 6 tweets/minute)
    const rate = finalMetrics.perSymbolMetrics['AAPL']?.publishingRatePerMinute || 0;
    if (rate >= 5 && rate <= 7) {
      console.log("\n✅ Validation PASSED: Publishing rate is consistent with 10-second interval");
    } else {
      console.log("\n❌ Validation FAILED: Publishing rate does not match expected 10-second interval");
      console.log(`   Expected ~6 tweets/minute, actual: ${rate.toFixed(2)}`);
    }
    
    process.exit(0);
  }
}, 2000);