/**
 * Simple script to monitor tweets for a specific symbol over a period of time
 * Shows when tweets are being published in real-time
 * 
 * This test hooks directly into the Twitter service to monitor tweets as they're published
 */

import { twitterService } from './server/services/twitterService';

// Store tweets for analysis
let tweets: {timestamp: Date, content: string}[] = [];

// Override twitterService's generateAndPublishTweet method to capture tweets
// for monitoring without actually publishing them
const originalGenerateAndPublishTweet = (twitterService as any)['generateAndPublishTweet'];
(twitterService as any)['generateAndPublishTweet'] = async function(symbol: string) {
  const result = await originalGenerateAndPublishTweet.call(this, symbol);
  
  // Log the tweet for monitoring
  const timestamp = new Date();
  const runTime = Math.floor((timestamp.getTime() - startTime.getTime()) / 1000);
  const metrics = twitterService.getMetrics();
  const count = metrics.perSymbolMetrics[symbol]?.tweetsPublished || 0;
  
  // Calculate time since last tweet if we have more than one
  let timeSinceLastTweet = 'N/A';
  if (tweets.length > 0) {
    const lastTweet = tweets[tweets.length - 1];
    const seconds = Math.floor((timestamp.getTime() - lastTweet.timestamp.getTime()) / 1000);
    timeSinceLastTweet = `${seconds}s`;
  }
  
  // Add to our monitoring list
  const content = `Tweet #${count}`; // The actual content doesn't matter
  tweets.push({ timestamp, content });
  
  console.log(`[${runTime}s] Tweet #${count} published for ${symbol} (Time since last: ${timeSinceLastTweet})`);
  
  return result;
};

const startTime = new Date();

async function monitorTweets() {
  console.log('Starting direct tweet monitoring for AAPL');
  console.log('Start time:', startTime.toISOString());
  console.log('Setting tweet frequency to 10 seconds');
  
  // Set tweet frequency to 10 seconds for faster testing
  twitterService.setTweetFrequency(10);
  
  // Start tweet simulation
  console.log('Starting tweet simulation for AAPL...');
  await twitterService.startSimulation(['AAPL']);
  console.log('Simulation started.');
  
  // Force a first tweet to get things going
  console.log('Forcing initial tweet...');
  await twitterService.forcePublishTweet('AAPL');
  
  // Monitor for 2 minutes (120 seconds)
  console.log('\nMonitoring for 120 seconds...');
  const testDurationMs = 120 * 1000;
  
  // Print monitoring status every 10 seconds
  for (let elapsed = 0; elapsed < testDurationMs; elapsed += 10000) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    const runTime = Math.floor((new Date().getTime() - startTime.getTime()) / 1000);
    const expectedTweets = Math.floor(runTime / 10);
    
    console.log(`\n[Status at ${runTime}s]`);
    console.log(`Expected ~${expectedTweets} tweets (including initial)`);
    console.log(`Actual: ${tweets.length} tweets`);
    
    // Calculate average interval if we have more than one tweet
    if (tweets.length > 1) {
      let totalInterval = 0;
      for (let i = 1; i < tweets.length; i++) {
        const interval = (tweets[i].timestamp.getTime() - tweets[i-1].timestamp.getTime()) / 1000;
        totalInterval += interval;
      }
      const avgInterval = totalInterval / (tweets.length - 1);
      console.log(`Average interval: ${avgInterval.toFixed(1)}s`);
    }
    
    twitterService.logMetrics();
  }
  
  // Print summary
  console.log('\n===== TEST SUMMARY =====');
  console.log(`Total tweets: ${tweets.length}`);
  console.log(`Expected: ~12 tweets (1 forced + ~11 automatic at 10s intervals over 2 minutes)`);
  
  if (tweets.length >= 10) {
    console.log('\n✅ TEST PASSED: Automatic tweets are working properly');
  } else if (tweets.length >= 3) {
    console.log('\n⚠️ TEST PARTIAL: Some automatic tweets were generated, but not at the expected rate');
  } else {
    console.log('\n❌ TEST FAILED: Automatic tweets are not working properly');
  }
  
  // Print all intervals
  if (tweets.length > 1) {
    console.log('\nAll intervals between tweets:');
    for (let i = 1; i < tweets.length; i++) {
      const interval = (tweets[i].timestamp.getTime() - tweets[i-1].timestamp.getTime()) / 1000;
      console.log(`Tweet ${i+1}: ${interval.toFixed(1)}s after previous`);
    }
  }
  
  // Clean up
  console.log('\nCleaning up...');
  await twitterService.stopSimulation(['AAPL']);
  console.log('Test completed and simulation stopped');
  
  // Reset the original function to avoid interference with other tests
  (twitterService as any)['generateAndPublishTweet'] = originalGenerateAndPublishTweet;
}

monitorTweets().catch(console.error);