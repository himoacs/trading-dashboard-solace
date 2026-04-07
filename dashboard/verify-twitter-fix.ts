/**
 * Quick verification of Twitter feed fix
 * 
 * This test:
 * 1. Connects to Twitter service
 * 2. Sets tweet frequency to 5 seconds
 * 3. Starts simulation for AAPL
 * 4. Forces a manual tweet
 * 5. Waits 10 seconds to verify the automatic tweet also works
 */

import { twitterService } from './server/services/twitterService';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyFix(): Promise<void> {
  console.log("🚀 Starting Twitter feed fix verification");
  
  // Set frequency to 5 seconds
  console.log("Setting tweet frequency to 5 seconds");
  twitterService.setTweetFrequency(5);
  
  // Start simulation
  console.log("Starting simulation for AAPL");
  await twitterService.startSimulation(['AAPL']);
  
  // Force a manual tweet
  console.log("Forcing manual tweet for AAPL");
  await twitterService.forcePublishTweet('AAPL');
  
  // Wait 10 seconds to see if the automatic tweet comes through
  console.log("Waiting 10 seconds to verify automatic tweet...");
  await sleep(10000);
  
  // Log metrics
  console.log("\nTwitter metrics after test:");
  twitterService.logMetrics();
  
  // Stop simulation
  console.log("Stopping simulation");
  await twitterService.stopSimulation(['AAPL']);
  
  console.log("Test complete! The Twitter feed should now be working correctly with centralized publishing.");
}

verifyFix().catch(error => {
  console.error("Test failed:", error);
});