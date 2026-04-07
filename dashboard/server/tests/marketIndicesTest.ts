import { solaceService } from "../services/solaceService";
import { storage } from "../storage";

/**
 * Test function to verify that market indices are being properly published to Solace
 */
export async function testMarketIndicesPublishing(): Promise<boolean> {
  console.log("==========================================");
  console.log("TESTING MARKET INDICES PUBLISHING TO SOLACE");
  console.log("==========================================");

  if (!solaceService.isConnected()) {
    console.log("❌ Test failed: Solace is not connected");
    return false;
  }

  // Check if market indices are in the storage
  const indices = ["SPX", "DJI", "NDX"];
  let allIndicesFound = true;
  
  for (const symbol of indices) {
    const stock = await storage.getStockBySymbol(symbol);
    if (!stock) {
      console.log(`❌ Market index ${symbol} not found in storage`);
      allIndicesFound = false;
    } else {
      console.log(`✅ Market index ${symbol} found in storage: ${JSON.stringify(stock)}`);
    }
  }
  
  if (!allIndicesFound) {
    console.log("❌ Test failed: Not all market indices found in storage");
    return false;
  }
  
  // Create a counter to track published messages
  const publishedCounts: Record<string, number> = {
    "SPX": 0,
    "DJI": 0,
    "NDX": 0
  };
  
  // Mock the solaceService.publish method temporarily to count calls
  const originalPublish = solaceService.publish;
  
  // Override the publish method to track calls for market indices
  solaceService.publish = async (topic: string, message: any) => {
    if (topic === "market-data/SPX") publishedCounts["SPX"]++;
    if (topic === "market-data/DJI") publishedCounts["DJI"]++;
    if (topic === "market-data/NDX") publishedCounts["NDX"]++;
    
    // Call the original method
    return originalPublish.call(solaceService, topic, message);
  };
  
  console.log("Waiting for 5 seconds to observe market indices publishing...");
  
  // Wait for a few seconds to let the market data service run
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Restore the original publish method
  solaceService.publish = originalPublish;
  
  // Report the results
  console.log("Market indices publish counts:");
  for (const [symbol, count] of Object.entries(publishedCounts)) {
    if (count > 0) {
      console.log(`✅ Market index ${symbol} was published ${count} times`);
    } else {
      console.log(`❌ Market index ${symbol} was not published`);
      allIndicesFound = false;
    }
  }
  
  console.log("==========================================");
  console.log(`TEST RESULT: ${allIndicesFound ? '✅ PASSED' : '❌ FAILED'}`);
  console.log("==========================================");
  
  return allIndicesFound;
}