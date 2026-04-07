/**
 * Debug script for TwitterService timer issues
 * 
 * This script replaces the TwitterPublisherService with a mock version that always succeeds
 * so we can test the timer function in isolation.
 */

import { twitterService } from './server/services/twitterService';
import { twitterPublisherService } from './server/services/twitterPublisherService';

// Track tweets
const tweets: {symbol: string, timestamp: Date}[] = [];

// Replace the publish method with a mock that always succeeds
const originalPublishTweet = twitterPublisherService.publishTweet;
twitterPublisherService.publishTweet = async (symbol: string, content: string, companyName: string, timestamp: Date): Promise<boolean> => {
  console.log(`MOCK: Successfully published tweet for ${symbol} at ${timestamp.toISOString()}`);
  tweets.push({symbol, timestamp});
  return true;
};

// Also make sure the connection status appears connected
const originalIsConnected = twitterPublisherService.isConnected;
twitterPublisherService.isConnected = (): boolean => {
  return true;
};

console.log('Starting TwitterService Timer Debug Test');
console.log('=======================================');

// Use a very short interval for testing (5 seconds)
const TWEET_INTERVAL = 5; // seconds
console.log(`Setting tweet frequency to ${TWEET_INTERVAL} seconds`);
twitterService.setTweetFrequency(TWEET_INTERVAL);

// Setup monitoring
async function runTest() {
  console.log('Starting tweet simulation for AAPL');
  await twitterService.startSimulation(['AAPL'], TWEET_INTERVAL);
  
  // Force an initial tweet
  console.log('Forcing initial tweet...');
  await twitterService.forcePublishTweet('AAPL');
  
  // Monitor for 30 seconds
  console.log(`\nMonitoring tweets for 30 seconds...`);
  console.log(`You should see ~6 tweets (1 initial + ~5 automated tweets at ${TWEET_INTERVAL} second intervals)`);
  
  let lastTweetCount = 1; // We start with 1 forced tweet
  
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Every 5 seconds, log status
    if (i % 5 === 0) {
      const elapsedSeconds = i + 1;
      console.log(`\n[Status at ${elapsedSeconds}s]`);
      console.log(`Tweet count: ${tweets.length}`);
      console.log(`Expected tweets: ~${1 + Math.floor(elapsedSeconds / TWEET_INTERVAL)}`);
      
      // Check for new tweets
      if (tweets.length > lastTweetCount) {
        console.log(`New tweets received: ${tweets.length - lastTweetCount}`);
        
        // List the timestamps of new tweets
        for (let j = lastTweetCount; j < tweets.length; j++) {
          console.log(`  Tweet ${j+1}: ${tweets[j].timestamp.toISOString()}`);
        }
        
        lastTweetCount = tweets.length;
      } else {
        console.log('No new tweets since last check');
      }
    }
  }
  
  // Final status
  console.log('\nFinal status:');
  console.log(`Total tweets: ${tweets.length}`);
  
  // Analyze intervals between tweets
  if (tweets.length > 1) {
    console.log('\nTweet intervals:');
    for (let i = 1; i < tweets.length; i++) {
      const prevTime = tweets[i-1].timestamp.getTime();
      const currTime = tweets[i].timestamp.getTime();
      const intervalSeconds = (currTime - prevTime) / 1000;
      console.log(`Interval between tweets ${i} and ${i+1}: ${intervalSeconds.toFixed(1)}s`);
    }
  }
  
  // Stop simulation
  console.log('\nStopping tweet simulation...');
  await twitterService.stopSimulation();
  
  // Restore original methods
  twitterPublisherService.publishTweet = originalPublishTweet;
  twitterPublisherService.isConnected = originalIsConnected;
  
  console.log('Test completed');
}

// Run the test
runTest().catch(console.error);