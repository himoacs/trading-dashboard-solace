/**
 * macOS Compatibility Module
 * 
 * This module provides enhanced compatibility for macOS platforms
 * to ensure reliable feed activation and timer management.
 */

/**
 * Detects if the current platform is macOS
 * Uses both process.platform check and additional verification
 */
export function isMacOS(): boolean {
  // Primary detection via Node.js platform
  const isPlatformDarwin = process.platform === 'darwin';
  
  // Secondary detection via environment variables (some macOS environments set these)
  const hasAppleEnv = 
    process.env.TERM_PROGRAM === 'Apple_Terminal' || 
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    (process.env.PATH && process.env.PATH.includes('/usr/local/bin')) ||
    !!process.env.HOME?.includes('/Users/');
  
  // Log detailed platform detection info
  console.log(`Platform detection details:
    - process.platform: ${process.platform}
    - isPlatformDarwin: ${isPlatformDarwin}
    - hasAppleEnv: ${hasAppleEnv}
    - TERM_PROGRAM: ${process.env.TERM_PROGRAM}
    - DETECTED AS MACOS: ${isPlatformDarwin || hasAppleEnv}
  `);
  
  return isPlatformDarwin || hasAppleEnv;
}

/**
 * Enhanced feed activation for macOS systems 
 * Uses multiple approaches to ensure reliable activation
 */
export async function enableMacOSTwitterFeed(twitterService: any): Promise<boolean> {
  if (!isMacOS()) {
    console.log("Not a macOS platform, skipping enhanced activation");
    return false;
  }
  
  console.log("⚠️ MACOS DETECTED - Using enhanced Twitter feed activation sequence");
  
  try {
    // 1. First attempt: Direct feed activation
    let feedActive = twitterService.isFeedActive();
    console.log(`Initial feed status: ${feedActive ? 'ACTIVE' : 'INACTIVE'}`);
    
    if (!feedActive) {
      // 2. Force feed activation with explicit method
      console.log("Applying macOS-specific feed activation");
      twitterService.setFeedActive(true);
      
      // 3. Small delay to ensure state propagation (critical for macOS)
      await new Promise(resolve => setTimeout(resolve, 30));
      
      // 4. Verify the status after forced activation
      feedActive = twitterService.isFeedActive();
      console.log(`Feed status after direct activation: ${feedActive ? 'ACTIVE' : 'INACTIVE'}`);
      
      // 5. If still not active, try with the internal method
      if (!feedActive) {
        console.log("Using internal activation mechanism for macOS");
        
        // Force timer recreation with minimal delay 
        await new Promise(resolve => setTimeout(resolve, 20));
        
        // Verify one more time
        feedActive = twitterService.isFeedActive();
        console.log(`Feed status after internal activation: ${feedActive ? 'ACTIVE' : 'INACTIVE'}`);
      }
    }
    
    return !!feedActive;
  } catch (error) {
    console.error("Error during macOS feed activation:", error);
    return false;
  }
}

/**
 * Enhanced market data feed activation for macOS
 */
export async function enableMacOSMarketDataFeed(publisherService: any): Promise<boolean> {
  if (!isMacOS()) {
    console.log("Not a macOS platform, skipping enhanced market data activation");
    return false;
  }
  
  console.log("⚠️ MACOS DETECTED - Using enhanced Market Data feed activation sequence");
  
  try {
    // 1. Check initial feed status
    let feedActive = publisherService.isFeedActive();
    console.log(`Initial market data feed status: ${feedActive ? 'ACTIVE' : 'INACTIVE'}`);
    
    if (!feedActive) {
      // 2. Force activation with explicit method
      console.log("Applying macOS-specific market data feed activation");
      publisherService.setFeedActive(true);
      
      // 3. Small delay to ensure state propagation (critical for macOS)
      await new Promise(resolve => setTimeout(resolve, 30));
      
      // 4. Verify again
      feedActive = publisherService.isFeedActive();
      console.log(`Market data feed status after direct activation: ${feedActive ? 'ACTIVE' : 'INACTIVE'}`);
      
      // 5. Double check with internal method if needed
      if (!feedActive) {
        console.log("Using startFeed method for macOS market data");
        const result = publisherService.startFeed();
        console.log("Start feed result:", result);
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 30));
        
        // One final check
        feedActive = publisherService.isFeedActive();
        console.log(`Final market data feed status: ${feedActive ? 'ACTIVE' : 'INACTIVE'}`);
      }
    }
    
    return !!feedActive;
  } catch (error) {
    console.error("Error during macOS market data feed activation:", error);
    return false;
  }
}