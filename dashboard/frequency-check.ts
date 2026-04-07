/**
 * Simple frequency check to verify 10-second tweet intervals
 */
import { twitterService } from './server/services/twitterService';
import { twitterPublisherService } from './server/services/twitterPublisherService';

let lastTweetTime: Date | null = null;
let tweetCount = 0;

// Function to set tweet frequency to 10 seconds
async function setFrequency() {
  console.log('Setting tweet frequency to 10 seconds');
  twitterService.setTweetFrequency(10);
  console.log('Starting tweet simulation for AAPL');
  await twitterService.startSimulation(['AAPL']);
}

// Force tweet to verify everything is working
async function forceTweet() {
  console.log('Forcing an initial tweet');
  await twitterService.forcePublishTweet('AAPL');
  lastTweetTime = new Date();
  tweetCount++;
  console.log(`Initial tweet (${tweetCount}) published at ${lastTweetTime.toISOString()}`);
}

// Main function
async function run() {
  console.log('Starting Twitter feed frequency test');
  
  // 1. Set tweet frequency
  await setFrequency();
  
  // 2. Force initial tweet
  await forceTweet();
  
  // 3. Monitor for 60 seconds
  const startTime = new Date();
  console.log(`\nMonitoring tweets starting at ${startTime.toISOString()}`);
  console.log('Will check every 5 seconds for 60 seconds...');
  
  // Override the generateAndPublishTweet method to capture when tweets are generated
  const originalGenerateAndPublishTweet = (twitterService as any)['generateAndPublishTweet'];
  (twitterService as any)['generateAndPublishTweet'] = async function(symbol: string) {
    const now = new Date();
    tweetCount++;
    
    // Calculate time since last tweet
    let interval = 'N/A';
    if (lastTweetTime) {
      const secondsSinceLastTweet = (now.getTime() - lastTweetTime.getTime()) / 1000;
      interval = `${secondsSinceLastTweet.toFixed(1)}s`;
    }
    
    // Log tweet details
    const runTimeSeconds = (now.getTime() - startTime.getTime()) / 1000;
    console.log(`\n[${runTimeSeconds.toFixed(1)}s] Tweet ${tweetCount} generated at ${now.toISOString()}`);
    console.log(`Interval since last tweet: ${interval}`);
    
    // Update last tweet time
    lastTweetTime = now;
    
    // Call original method and return its result
    return await originalGenerateAndPublishTweet.call(this, symbol);
  };
  
  // Print details every 5 seconds for 60 seconds
  for (let i = 0; i < 12; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const now = new Date();
    const runTimeSeconds = (now.getTime() - startTime.getTime()) / 1000;
    console.log(`\n[Status Check at ${runTimeSeconds.toFixed(1)}s]`);
    
    // Calculate expected tweet count (1 forced + automatic tweets)
    // For 10-second interval, we'd expect a new tweet every 10 seconds
    const expectedTweetCount = 1 + Math.floor(runTimeSeconds / 10);
    console.log(`Expected tweet count: ~${expectedTweetCount}`);
    console.log(`Actual tweet count: ${tweetCount}`);
    
    // Print time since last tweet
    if (lastTweetTime) {
      const secondsSinceLastTweet = (now.getTime() - lastTweetTime.getTime()) / 1000;
      console.log(`Seconds since last tweet: ${secondsSinceLastTweet.toFixed(1)}s`);
    }
  }
  
  // Print summary
  console.log('\n===== TEST SUMMARY =====');
  console.log(`Total tweets: ${tweetCount}`);
  console.log(`Expected: ~7 tweets (1 forced + ~6 automatic at 10s intervals over 60 seconds)`);
  
  if (tweetCount >= 6) {
    console.log('\n✅ TEST PASSED: Automatic tweets are working properly');
  } else if (tweetCount >= 3) {
    console.log('\n⚠️ TEST PARTIAL: Some automatic tweets were generated, but not at the expected rate');
  } else {
    console.log('\n❌ TEST FAILED: Automatic tweets are not working properly');
  }
  
  // Restore original method
  (twitterService as any)['generateAndPublishTweet'] = originalGenerateAndPublishTweet;
  
  // Clean up
  console.log('\nCleaning up...');
  await twitterService.stopSimulation(['AAPL']);
  console.log('Test completed and simulation stopped');
}

// Run the test
run().catch(console.error);