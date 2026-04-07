/**
 * MacOS Feed Fix Script
 * 
 * This script helps fix issues with feeds not starting on macOS.
 * Run this script with: npx tsx server/fix-macos-feed.ts
 */

import { twitterPublisherService } from './services/twitterPublisherService';
import { publisherSolaceService } from './services/publisherSolaceService';

/**
 * Enable the Twitter feed on macOS
 */
async function enableTwitterFeed(): Promise<void> {
  console.log("Fixing Twitter feed for macOS...");
  
  // 1. Force set feed active
  twitterPublisherService.setFeedActive(true);
  
  // 2. Small delay to ensure state propagation
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // 3. Check if it worked
  const isActive = twitterPublisherService.isFeedActive();
  console.log(`Twitter feed active: ${isActive ? 'YES' : 'NO'}`);
  
  // 4. Force start feed with any active symbols
  const symbols = ["AAPL", "MSFT", "GOOG"];
  await twitterPublisherService.startFeed(symbols, 10);
  
  // 5. Check again
  const isActiveNow = twitterPublisherService.isFeedActive();
  console.log(`Twitter feed active after forced start: ${isActiveNow ? 'YES' : 'NO'}`);
}

/**
 * Enable the Market Data feed on macOS
 */
async function enableMarketDataFeed(): Promise<void> {
  console.log("Fixing Market Data feed for macOS...");
  
  // 1. Force set feed active
  publisherSolaceService.setFeedActive(true);
  
  // 2. Small delay to ensure state propagation
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // 3. Check if it worked
  const isActive = publisherSolaceService.isFeedActive();
  console.log(`Market Data feed active: ${isActive ? 'YES' : 'NO'}`);
  
  // 4. Force start feed
  const result = publisherSolaceService.startFeed();
  console.log("Start feed result:", result);
  
  // 5. Check again
  const isActiveNow = publisherSolaceService.isFeedActive();
  console.log(`Market Data feed active after forced start: ${isActiveNow ? 'YES' : 'NO'}`);
}

/**
 * Run the MacOS fixes
 */
async function runFixes(): Promise<void> {
  console.log("Running MacOS feed fixes...");
  
  try {
    // First fix Twitter feed
    await enableTwitterFeed();
    
    // Then fix Market Data feed
    await enableMarketDataFeed();
    
    console.log("MacOS feed fixes applied successfully!");
  } catch (error) {
    console.error("Error applying MacOS fixes:", error);
  }
}

// Execute the fixes
runFixes().catch(console.error);