/**
 * Simple twitter frequency checker
 */
import { twitterService } from './server/services/twitterService';

async function run() {
  console.log("Twitter Service Test - Monitoring tweets at 10-second interval");
  console.log("=============================================================");
  
  // Check initial status
  const initialStatus = twitterService.getStatus();
  console.log("Initial status:");
  console.log("- Active: ", initialStatus.isActive);
  console.log("- Active symbols: ", initialStatus.activeSymbols);
  console.log("- Tweet frequency: ", initialStatus.tweetFrequencySeconds, "seconds");
  
  // Set up with 10-second tweet frequency for AAPL
  console.log("\nStarting Twitter service for AAPL with 10-second frequency");
  await twitterService.startSimulation(['AAPL'], 10);
  
  // Check updated status
  const updatedStatus = twitterService.getStatus();
  console.log("\nUpdated status:");
  console.log("- Active: ", updatedStatus.isActive);
  console.log("- Active symbols: ", updatedStatus.activeSymbols);
  console.log("- Tweet frequency: ", updatedStatus.tweetFrequencySeconds, "seconds");

  // Force first tweet immediately
  console.log("\nForcing initial tweet for AAPL");
  try {
    await twitterService.forceTweet('AAPL');
    console.log("✅ Initial tweet successfully sent");
  } catch (err) {
    console.error("❌ Failed to send initial tweet:", err);
  }
  
  // Now monitor for 30 seconds to see if tweets are published at the expected interval
  console.log("\nMonitoring tweets for 60 seconds...");
  console.log("\nTimestamp            | Event");
  console.log("--------------------|------------------------------------------");
  
  // Track tweet counts
  let tweetCounts = {};
  let lastCheck = Date.now();
  let checkInterval = 2000; // Check every 2 seconds
  
  // Monitor for 60 seconds
  for (let i = 0; i < 30; i++) {
    // Sleep for 2 seconds
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    
    // Get current metrics
    const metrics = twitterService.getMetrics();
    const now = new Date();
    const tweetCount = metrics.perSymbolMetrics['AAPL']?.tweetsPublished || 0;
    
    // Store tweet count if not already tracked
    if (!tweetCounts[tweetCount]) {
      tweetCounts[tweetCount] = now;
    }
    
    // Calculate elapsed time
    const elapsed = Math.floor((Date.now() - lastCheck) / 1000);
    lastCheck = Date.now();
    
    // Log current status
    console.log(`${now.toISOString()} | Check #${i+1} - AAPL tweet count: ${tweetCount} (elapsed: ${elapsed}s)`);
  }
  
  // Print tweet timestamps to verify intervals
  console.log("\nTweet Publication Timeline:");
  console.log("---------------------------");
  let tweetNumbers = Object.keys(tweetCounts).map(Number).sort((a, b) => a - b);
  
  if (tweetNumbers.length <= 1) {
    console.log("❌ ERROR: No new tweets detected after initial tweet!");
    
    // Debug timer implementation
    console.log("\nDEBUG Timer Implementation:");
    const monitorStatus = twitterService.getDebugInfo ? twitterService.getDebugInfo() : "Debug info not available";
    
    console.log("Timer status:", monitorStatus);
    if (monitorStatus && monitorStatus.timers) {
      console.log("Active timers:", Object.keys(monitorStatus.timers).length);
      console.log("Timer details:", JSON.stringify(monitorStatus.timers, null, 2));
    }
    
  } else {
    for (let i = 0; i < tweetNumbers.length; i++) {
      const count = tweetNumbers[i];
      const timestamp = tweetCounts[count];
      
      // Calculate interval from previous tweet
      let interval = "-";
      if (i > 0) {
        const prevTimestamp = tweetCounts[tweetNumbers[i-1]];
        interval = ((timestamp.getTime() - prevTimestamp.getTime()) / 1000).toFixed(1) + "s";
      }
      
      console.log(`Tweet #${count}: ${timestamp.toISOString()} (interval: ${interval})`);
    }
    
    // Calculate average interval
    if (tweetNumbers.length > 1) {
      const firstTimestamp = tweetCounts[tweetNumbers[0]];
      const lastTimestamp = tweetCounts[tweetNumbers[tweetNumbers.length - 1]];
      const totalDuration = (lastTimestamp.getTime() - firstTimestamp.getTime()) / 1000;
      const avgInterval = totalDuration / (tweetNumbers.length - 1);
      
      console.log(`\nAverage interval between tweets: ${avgInterval.toFixed(1)} seconds`);
      console.log(`Expected interval: 10.0 seconds`);
      
      if (Math.abs(avgInterval - 10) <= 1) {
        console.log("✅ SUCCESS: Tweet interval approximately matches expected 10-second interval");
      } else {
        console.log("❌ ERROR: Tweet interval does not match expected 10-second interval");
      }
    }
  }
  
  // Clean up
  console.log("\nStopping Twitter service");
  await twitterService.stopSimulation(['AAPL']);
  console.log("Test complete");
}

// Run the test
run().catch(console.error);