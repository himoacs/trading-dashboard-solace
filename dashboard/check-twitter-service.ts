/**
 * Check Twitter service frequency implementation
 */

import { twitterService } from './server/services/twitterService';

// Print the current state
console.log('=== TWITTER SERVICE STATE ===');
console.log('Active symbols:', twitterService.getActiveSymbols());

// Get the metrics which includes the frequency
const initialMetrics = twitterService.getMetrics();
console.log('Tweet frequency from metrics:', initialMetrics.configuredInterval, 'seconds');

// Force AAPL to 10-second interval directly
console.log('\nSetting AAPL to 10-second frequency...');
twitterService.startSimulation(['AAPL'], 10);

// Print updated state
console.log('\n=== UPDATED TWITTER SERVICE STATE ===');
console.log('Active symbols:', twitterService.getActiveSymbols());
console.log('Tweet frequency:', twitterService.getTweetFrequency(), 'seconds');

// Internal status
console.log('\n=== TWEET SCHEDULE DETAILS ===');
// @ts-ignore - accessing private property for debugging
const schedules = (twitterService as any).tweetSchedules;
if (schedules) {
  console.log('Tweet schedules:');
  for (const [symbol, timer] of Object.entries(schedules)) {
    console.log(`- ${symbol}: Interval ID ${timer}`);
  }
} else {
  console.log('No tweet schedules available');
}

// Metrics
console.log('\n=== TWEET METRICS ===');
const finalMetrics = twitterService.getMetrics();
console.log('Configured interval:', finalMetrics.configuredInterval, 'seconds');
console.log('Symbol metrics:');
for (const [symbol, data] of Object.entries(finalMetrics.perSymbolMetrics)) {
  console.log(`- ${symbol}: ${data.tweetsPublished} tweets, last publish: ${data.lastPublishAgo}`);
}