import { solaceService } from "./solaceService";
import { storage } from "../storage";

class EconomicIndicatorService {
  private simulationInterval: NodeJS.Timeout | null = null;
  private symbols: string[] = [];
  
  /**
   * Start economic indicator simulation for the specified symbols
   * Using randomized intervals for very infrequent updates (120-240 sec)
   */
  async startSimulation(symbols: string[], updateFrequencySeconds: number): Promise<void> {
    // Stop any existing simulation
    this.stopSimulation();
    
    this.symbols = [...symbols];
    
    console.log(`Starting economic indicator simulation for symbols: ${symbols.join(', ')}`);
    
    // Don't run initial update immediately to avoid flooding
    
    // Set interval with much longer delay - aim for 120-240 seconds
    // These should be the least frequent updates of all data types
    const baseEconomicFrequency = Math.max(120, updateFrequencySeconds * 4);
    
    // Calculate a random interval for first update (30-45 seconds)
    // This staggers updates well after Twitter and News services start
    const initialDelay = Math.floor(Math.random() * 15000) + 30000;
    console.log(`Economic indicators will update approximately every ${baseEconomicFrequency} seconds`);
    console.log(`First economic indicator update in ${Math.round(initialDelay/1000)} seconds`);
    
    // Use a timeout for initial update with delay to avoid clustering at startup
    setTimeout(async () => {
      try {
        await this.updateEconomicIndicators();
      } catch (error) {
        console.error("Error in initial economic indicator update:", error);
      }
      
      // Then set up a self-adjusting interval with randomization
      const setupNextUpdate = () => {
        // Random interval between baseEconomicFrequency and baseEconomicFrequency*2
        // Adds significant variability (120-240 seconds intervals)
        const randomInterval = Math.floor(
          (baseEconomicFrequency + Math.random() * baseEconomicFrequency) * 1000
        );
        
        console.log(`Next economic indicator update scheduled in ${Math.round(randomInterval/1000)} seconds`);
        
        this.simulationInterval = setTimeout(async () => {
          try {
            await this.updateEconomicIndicators();
          } catch (error) {
            console.error("Error in scheduled economic indicator update:", error);
          }
          // Schedule the next update after this one completes
          setupNextUpdate();
        }, randomInterval);
      };
      
      // Start the cycle of self-scheduling updates
      setupNextUpdate();
    }, initialDelay);
    
    return;
  }
  
  /**
   * Stop economic indicator simulation
   */
  async stopSimulation(): Promise<void> {
    if (this.simulationInterval) {
      clearTimeout(this.simulationInterval);
      this.simulationInterval = null;
    }
    
    this.symbols = [];
    
    console.log("Stopped economic indicator simulation");
    return;
  }
  
  /**
   * Update economic indicators for all symbols
   * This should be the least frequent update type
   */
  private async updateEconomicIndicators(): Promise<void> {
    // Check preconditions - only proceed if we have an active connection and symbols
    if (!solaceService.isConnected()) {
      // Don't spam logs, just silently return
      return;
    }
    
    if (this.symbols.length === 0) {
      // Don't spam logs, just silently return
      return;
    }
    
    // Add a random delay to stagger economic updates (3-8 seconds)
    const randomDelay = Math.floor(Math.random() * 5000) + 3000;
    await new Promise(resolve => setTimeout(resolve, randomDelay));
    
    console.log(`Updating economic indicators for selected symbols: ${this.symbols.join(', ')}`);
    
    // Select a subset of symbols to update (40-60% of tracked symbols per interval)
    // We can update more symbols per cycle since these updates are so infrequent
    const symbolsToUpdate = this.symbols.filter(() => Math.random() < 0.5);
    
    if (symbolsToUpdate.length === 0) {
      // No symbols selected this time, skip update
      return;
    }
    
    // Process each selected symbol with some delay between each
    for (const symbol of symbolsToUpdate) {
      try {
        console.log(`Generating economic indicator for ${symbol}`);
        await this.updateSymbolEconomicIndicator(symbol);
        
        // Add a small delay between publishing indicators for different symbols
        // This prevents clustering of economic indicator messages
        if (symbolsToUpdate.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 2500));
        }
      } catch (error) {
        console.error(`Error updating economic indicator for ${symbol}:`, error);
      }
    }
  }
  
  /**
   * Update economic indicator for a specific symbol
   */
  private async updateSymbolEconomicIndicator(symbol: string): Promise<void> {
    // Get the stock from storage
    const stock = await storage.getStockBySymbol(symbol);
    
    if (!stock) {
      console.error(`Stock not found for symbol ${symbol}`);
      return;
    }
    
    // Get the industry-appropriate indicator
    const { indicatorType, value, previousValue, percentChange } = this.generateEconomicIndicator(symbol, stock.companyName);
    
    // Store the indicator in the database
    const economicIndicator = await storage.createEconomicIndicator({
      stockId: stock.id,
      indicatorType,
      value,
      previousValue,
      percentChange
    });
    
    // Publish the indicator to Solace broker
    const topic = `economic-indicator/${symbol}`;
    const message = {
      symbol,
      indicatorType: economicIndicator.indicatorType,
      value: economicIndicator.value,
      previousValue: economicIndicator.previousValue,
      percentChange: economicIndicator.percentChange,
      timestamp: economicIndicator.timestamp
    };
    
    await solaceService.publish(topic, message);
    
    console.log(`Published economic indicator for ${symbol}: ${indicatorType} at ${value} (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(2)}%)`);
  }
  
  /**
   * Generate a simulated economic indicator for a symbol
   */
  private generateEconomicIndicator(symbol: string, companyName: string): {
    indicatorType: string;
    value: number;
    previousValue: number;
    percentChange: number;
  } {
    // Different stock types should have different relevant indicators
    // Map stock symbols to industry sectors (simplified for demo)
    const stockToSector: Record<string, string> = {
      AAPL: 'Technology',
      MSFT: 'Technology',
      GOOGL: 'Technology',
      AMZN: 'Technology',
      META: 'Technology',
      TSLA: 'Automotive',
      JPM: 'Finance',
      BAC: 'Finance',
      WFC: 'Finance',
      GS: 'Finance',
      XOM: 'Energy',
      CVX: 'Energy',
      PFE: 'Healthcare',
      JNJ: 'Healthcare',
      UNH: 'Healthcare',
      PG: 'ConsumerGoods',
      KO: 'ConsumerGoods',
      WMT: 'Retail',
      TGT: 'Retail',
      MCD: 'Restaurant',
      SBUX: 'Restaurant',
      // Default
      DEFAULT: 'General',
    };
    
    const sector = stockToSector[symbol] || stockToSector.DEFAULT;
    let indicators: { name: string, baseValue: number, volatility: number }[] = [];
    
    // Industry-specific indicators
    switch (sector) {
      case 'Technology':
        indicators = [
          { name: 'Semiconductor Demand Index', baseValue: 125.6, volatility: 3 },
          { name: 'Cloud Computing Growth Rate', baseValue: 18.4, volatility: 2 },
          { name: 'Tech Sector Employment', baseValue: 2.5, volatility: 0.5 },
          { name: 'R&D Spending Growth', baseValue: 9.2, volatility: 1.5 }
        ];
        break;
      case 'Finance':
        indicators = [
          { name: 'Interest Rate Spread', baseValue: 2.35, volatility: 0.3 },
          { name: 'Consumer Credit Growth', baseValue: 4.7, volatility: 0.8 },
          { name: 'Banking Sector Stability Index', baseValue: 87.3, volatility: 2 },
          { name: 'Financial Stress Index', baseValue: 12.6, volatility: 3 }
        ];
        break;
      case 'Energy':
        indicators = [
          { name: 'Crude Oil Inventory Change', baseValue: -2.1, volatility: 3 },
          { name: 'Natural Gas Demand', baseValue: 94.2, volatility: 2.5 },
          { name: 'Renewable Energy Adoption', baseValue: 15.8, volatility: 1 },
          { name: 'Energy Sector Cap-Ex', baseValue: 105.3, volatility: 4 }
        ];
        break;
      case 'Healthcare':
        indicators = [
          { name: 'Healthcare Spending Growth', baseValue: 5.2, volatility: 0.7 },
          { name: 'Drug Approval Rate', baseValue: 32.8, volatility: 3 },
          { name: 'Health Insurance Enrollment', baseValue: 1.5, volatility: 0.5 },
          { name: 'Biotech Funding Index', baseValue: 142.7, volatility: 5 }
        ];
        break;
      case 'ConsumerGoods':
        indicators = [
          { name: 'Consumer Confidence Index', baseValue: 95.6, volatility: 2 },
          { name: 'Retail Sales Growth', baseValue: 3.2, volatility: 0.8 },
          { name: 'Brand Value Ranking', baseValue: 78.4, volatility: 1.5 },
          { name: 'Product Pricing Power Index', baseValue: 6.3, volatility: 0.5 }
        ];
        break;
      case 'Retail':
        indicators = [
          { name: 'Same-Store Sales Growth', baseValue: 2.8, volatility: 1 },
          { name: 'E-commerce Penetration', baseValue: 22.5, volatility: 1.5 },
          { name: 'Inventory Turnover', baseValue: 8.4, volatility: 0.8 },
          { name: 'Retail Foot Traffic', baseValue: -1.2, volatility: 2 }
        ];
        break;
      case 'Automotive':
        indicators = [
          { name: 'Vehicle Sales Growth', baseValue: 3.1, volatility: 2 },
          { name: 'EV Adoption Rate', baseValue: 12.8, volatility: 1.8 },
          { name: 'Manufacturing Capacity Utilization', baseValue: 83.5, volatility: 3 },
          { name: 'Supply Chain Resilience Score', baseValue: 68.2, volatility: 2.5 }
        ];
        break;
      case 'Restaurant':
        indicators = [
          { name: 'Restaurant Industry Growth', baseValue: 4.2, volatility: 1 },
          { name: 'Food Cost Inflation', baseValue: 3.8, volatility: 0.7 },
          { name: 'Consumer Dining Frequency', baseValue: 5.3, volatility: 0.5 },
          { name: 'Delivery Service Adoption', baseValue: 25.7, volatility: 2 }
        ];
        break;
      default:
        indicators = [
          { name: 'GDP Growth Rate', baseValue: 2.5, volatility: 0.4 },
          { name: 'Inflation Rate', baseValue: 2.9, volatility: 0.3 },
          { name: 'Unemployment Rate', baseValue: 3.7, volatility: 0.2 },
          { name: 'Consumer Sentiment Index', baseValue: 102.3, volatility: 3 }
        ];
    }
    
    // Select a random indicator for this sector
    const indicator = indicators[Math.floor(Math.random() * indicators.length)];
    
    // Calculate previous and current values with some randomness
    const previousValue = indicator.baseValue;
    const percentChange = (Math.random() * 2 - 1) * indicator.volatility; // Between -volatility and +volatility
    const value = previousValue * (1 + percentChange / 100);
    
    return {
      indicatorType: indicator.name,
      value: parseFloat(value.toFixed(2)),
      previousValue: previousValue,
      percentChange: parseFloat(percentChange.toFixed(2))
    };
  }
}

export const economicIndicatorService = new EconomicIndicatorService();