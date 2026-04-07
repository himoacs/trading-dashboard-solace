/**
 * Script to fix Twitter service routes
 * 
 * This script will:
 * 1. Refresh server/routes.ts with correct references to simpleTwitterService
 * 2. Fix all the API endpoints
 */

import * as fs from 'fs';
import * as path from 'path';

async function fixRoutes(): Promise<void> {
  console.log('Fixing Twitter service routes in server/routes.ts');
  
  const routesPath = path.join(process.cwd(), 'server', 'routes.ts');
  let content = fs.readFileSync(routesPath, 'utf8');
  
  // Replace import
  content = content.replace(
    /import { twitterService } from "\.\/services\/twitterService";/g,
    '// Import our entirely new Twitter Service implementation\n' +
    '// that\'s simpler and more reliable\n' +
    'import { simpleTwitterService } from "./services/simpleTwitterService";'
  );
  
  // Replace stopSimulation calls
  content = content.replace(
    /await twitterService\.stopSimulation\(\);/g,
    'simpleTwitterService.stopAllTweets();'
  );
  
  // Replace stopSimulation with specific symbols
  content = content.replace(
    /await twitterService\.stopSimulation\(specificSymbols\);/g,
    'simpleTwitterService.stopSimulation(specificSymbols);'
  );
  
  // Replace setTweetFrequency calls
  content = content.replace(
    /twitterService\.setTweetFrequency\((\d+)\);/g,
    'simpleTwitterService.setFrequency($1);'
  );
  
  // Replace startSimulation calls with specific symbols and frequency
  content = content.replace(
    /await twitterService\.startSimulation\(\[symbol\], (\d+)\);/g,
    'await simpleTwitterService.startSimulation([symbol], $1);'
  );
  
  content = content.replace(
    /await twitterService\.startSimulation\(newSymbols, (\d+)\);/g,
    'await simpleTwitterService.startSimulation(newSymbols, $1);'
  );
  
  // Replace getActiveSymbols calls
  content = content.replace(
    /twitterService\.getActiveSymbols\(\)/g,
    'Object.keys(simpleTwitterService.getStatus().details)'
  );
  
  // Replace logMetrics calls
  content = content.replace(
    /twitterService\.logMetrics\(\);/g,
    'console.log("Twitter service status:", JSON.stringify(simpleTwitterService.getStatus(), null, 2));'
  );
  
  // Replace forcePublishTweet calls
  content = content.replace(
    /twitterService\.forcePublishTweet\(symbol\);/g,
    'simpleTwitterService.forceTweet(symbol);'
  );
  
  // Save the updated file
  fs.writeFileSync(routesPath, content, 'utf8');
  
  console.log('Routes fixed successfully');
}

fixRoutes().catch(error => {
  console.error('Failed to fix routes:', error);
  process.exit(1);
});