/**
 * Direct monitoring script for Twitter feed
 * 
 * This script will:
 * 1. Connect to Solace using the provided credentials
 * 2. Set the tweet frequency to 10 seconds
 * 3. Subscribe to Twitter feeds for AAPL
 * 4. Start tweet generation for AAPL
 * 5. Monitor for 5 minutes and log each tweet received
 */

import { solaceService } from './server/services/solaceService';
import { twitterService } from './server/services/twitterService';
import { twitterPublisherService } from './server/services/twitterPublisherService';

// Credentials should be provided as environment variables or command-line arguments
// NEVER hardcode credentials in source code
const TWITTER_PUBLISHER_CREDENTIALS = {
  host: process.env.SOLACE_HOST || '',
  vpn: process.env.SOLACE_VPN || '',
  username: process.env.SOLACE_USERNAME || '',
  password: process.env.SOLACE_PASSWORD || '',
};

// Received tweets counter
let tweetCount = 0;
const startTime = new Date();
const tweetTimestamps: Date[] = [];

// Listen for tweets 
async function setupTweetListener() {
  console.log('Setting up tweet listener...');
  
  // Connect to Solace using the publisher credentials
  await solaceService.connect({
    host: TWITTER_PUBLISHER_CREDENTIALS.host,
    vpn: TWITTER_PUBLISHER_CREDENTIALS.vpn,
    username: TWITTER_PUBLISHER_CREDENTIALS.username,
    password: TWITTER_PUBLISHER_CREDENTIALS.password
  });
  
  // Wait for connection to establish
  while (!solaceService.isConnected()) {
    console.log('Waiting for Solace connection...');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('Connected to Solace broker');
  
  // Subscribe to twitter feed for AAPL
  await solaceService.subscribe('twitter-feed/AAPL', (message) => {
    tweetCount++;
    const now = new Date();
    const runTime = Math.floor((now.getTime() - startTime.getTime()) / 1000);
    
    // Parse message for better display
    let displayMessage = '';
    try {
      const parsedMessage = JSON.parse(message);
      displayMessage = parsedMessage.content.substring(0, 30) + '...';
    } catch {
      displayMessage = message.substring(0, 30) + '...';
    }
    
    // Store timestamp
    tweetTimestamps.push(now);
    
    // Calculate time since last tweet if not the first one
    let timeSinceLastTweet = 'N/A';
    if (tweetTimestamps.length > 1) {
      const lastTweet = tweetTimestamps[tweetTimestamps.length - 2];
      const seconds = Math.floor((now.getTime() - lastTweet.getTime()) / 1000);
      timeSinceLastTweet = `${seconds}s`;
    }
    
    console.log(`[${runTime}s] Tweet #${tweetCount} received: "${displayMessage}" (Time since last: ${timeSinceLastTweet})`);
  });
  
  console.log('Subscribed to twitter-feed/AAPL');
}

// Start tweet generation
async function setupTwitterFeed() {
  console.log('Setting up tweet generation for AAPL...');
  
  // Set tweet frequency to 10 seconds
  twitterService.setTweetFrequency(10);
  console.log('Set tweet frequency to 10 seconds');
  
  // Start tweet simulation
  await twitterService.startSimulation(['AAPL'], 10);
  console.log('Started tweet simulation for AAPL');
}

// Run for 5 minutes and monitor tweets
async function runTest() {
  console.log('Starting Twitter feed monitoring test');
  console.log('======================================');
  console.log('Start time:', startTime.toISOString());
  console.log('Test duration: 5 minutes');
  console.log('Expected tweets: ~30 (one every 10 seconds for 5 minutes)');
  console.log('======================================');
  
  // Setup tweet listener
  await setupTweetListener();
  
  // Setup tweet generation
  await setupTwitterFeed();
  
  // Run for 5 minutes (300 seconds)
  console.log('\nMonitoring tweets for 5 minutes...');
  const testDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
  
  // Print progress every 30 seconds
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 30 * 1000)); // Wait 30 seconds
    const elapsed = Math.floor((new Date().getTime() - startTime.getTime()) / 1000);
    const expectedTweets = Math.floor(elapsed / 10); // one per 10 seconds
    console.log(`\n[Progress] ${elapsed}s elapsed - ${tweetCount} tweets received (Expected: ~${expectedTweets})`);
    
    // Calculate average interval if we have multiple tweets
    if (tweetTimestamps.length > 1) {
      let totalInterval = 0;
      for (let j = 1; j < tweetTimestamps.length; j++) {
        const interval = (tweetTimestamps[j].getTime() - tweetTimestamps[j-1].getTime()) / 1000;
        totalInterval += interval;
      }
      const avgInterval = totalInterval / (tweetTimestamps.length - 1);
      console.log(`Average interval between tweets: ${avgInterval.toFixed(1)}s`);
    }
  }
  
  // Print summary
  console.log('\n======================================');
  console.log('TEST SUMMARY');
  console.log('======================================');
  console.log(`Total tweets received: ${tweetCount}`);
  console.log(`Expected tweets: ~30 (one every 10 seconds for 5 minutes)`);
  
  if (tweetCount >= 25) {
    console.log('\n✅ TEST PASSED: Received ~30 tweets as expected');
  } else if (tweetCount >= 10) {
    console.log('\n⚠️ TEST PARTIAL: Received some tweets, but fewer than expected');
  } else {
    console.log('\n❌ TEST FAILED: Received very few tweets');
  }
  
  // Print actual intervals
  if (tweetTimestamps.length > 1) {
    console.log('\nActual intervals between tweets:');
    for (let i = 1; i < tweetTimestamps.length; i++) {
      const interval = (tweetTimestamps[i].getTime() - tweetTimestamps[i-1].getTime()) / 1000;
      console.log(`Tweet ${i}: ${interval.toFixed(1)}s after previous`);
    }
  }
  
  // Clean up
  console.log('\nCleaning up...');
  await twitterService.stopSimulation(['AAPL']);
  await solaceService.disconnect();
  console.log('Test completed');
}

// Run the test
runTest().catch(console.error);