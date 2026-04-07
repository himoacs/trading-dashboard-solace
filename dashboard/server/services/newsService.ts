import { solaceService } from "./solaceService";
import { storage } from "../storage";

class NewsService {
  private simulationInterval: NodeJS.Timeout | null = null;
  private symbols: string[] = [];
  
  /**
   * Start news feed simulation for the specified symbols
   * Using randomized intervals for less frequent updates
   */
  async startSimulation(symbols: string[], updateFrequencySeconds: number): Promise<void> {
    // Stop any existing simulation
    this.stopSimulation();
    
    this.symbols = [...symbols];
    
    console.log(`Starting news feed simulation for symbols: ${symbols.join(', ')}`);
    
    // Don't run initial update immediately to avoid flooding
    
    // Set interval with much longer delay - aim for 60-120 seconds
    // But base it on the provided frequency with a minimum of 60 seconds
    const baseNewsFrequency = Math.max(60, updateFrequencySeconds * 2);
    
    // Calculate a random interval for first update (15-30 seconds)
    // This avoids clustering of initial updates with other services
    const initialDelay = Math.floor(Math.random() * 15000) + 15000;
    console.log(`News feeds will update approximately every ${baseNewsFrequency} seconds`);
    console.log(`First news update in ${Math.round(initialDelay/1000)} seconds`);
    
    // Use a timeout for initial update to avoid clustering at startup
    setTimeout(async () => {
      try {
        await this.updateNewsFeeds();
      } catch (error) {
        console.error("Error in initial news feed update:", error);
      }
      
      // Then set up the regular interval with randomization
      // Use a self-adjusting timeout instead of setInterval to allow for random timing
      const setupNextUpdate = () => {
        // Random interval between baseNewsFrequency and baseNewsFrequency*1.5
        // This adds variability to the update frequency (60-180 seconds)
        const randomInterval = Math.floor(
          (baseNewsFrequency + Math.random() * baseNewsFrequency * 0.5) * 1000
        );
        
        console.log(`Next news update scheduled in ${Math.round(randomInterval/1000)} seconds`);
        
        this.simulationInterval = setTimeout(async () => {
          try {
            await this.updateNewsFeeds();
          } catch (error) {
            console.error("Error in scheduled news feed update:", error);
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
   * Stop news feed simulation
   */
  async stopSimulation(): Promise<void> {
    if (this.simulationInterval) {
      clearTimeout(this.simulationInterval);
      this.simulationInterval = null;
    }
    
    this.symbols = [];
    
    console.log("Stopped news feed simulation");
    return;
  }
  
  /**
   * Generate initial feeds for all symbols
   * Used when initially connecting to Solace to ensure data is available immediately
   */
  async generateInitialFeeds(symbols: string[]): Promise<void> {
    console.log(`Generating initial news feeds for ${symbols.length} symbols`);
    
    if (!solaceService.isConnected()) {
      console.log("Cannot generate initial news feeds: Not connected to Solace");
      return;
    }
    
    for (const symbol of symbols) {
      try {
        await this.updateSymbolNewsFeed(symbol);
      } catch (error) {
        console.error(`Error generating initial news feed for ${symbol}:`, error);
      }
    }
  }
  
  /**
   * Update news feeds for all symbols
   * This should run less frequently than Twitter
   */
  private async updateNewsFeeds(): Promise<void> {
    // Check preconditions - only proceed if we have an active connection and symbols
    if (!solaceService.isConnected()) {
      // Don't spam logs, just silently return
      return;
    }
    
    if (this.symbols.length === 0) {
      // Don't spam logs, just silently return
      return;
    }
    
    // Add a random delay to stagger news updates (1-5 seconds)
    const randomDelay = Math.floor(Math.random() * 5000) + 1000;
    await new Promise(resolve => setTimeout(resolve, randomDelay));
    
    console.log("Updating news feeds for all symbols");
    
    // Select a subset of symbols to update (20-30% of tracked symbols per interval)
    // This reduces the overall news frequency while still providing updates
    const symbolsToUpdate = this.symbols.filter(() => Math.random() < 0.25);
    
    if (symbolsToUpdate.length === 0) {
      // No symbols selected this time, skip update
      return;
    }
    
    console.log(`Selected ${symbolsToUpdate.length} symbols for news updates this cycle`);
    
    // Process each selected symbol with some delay between each
    for (const symbol of symbolsToUpdate) {
      try {
        await this.updateSymbolNewsFeed(symbol);
        
        // Add a small delay between publishing news for different symbols
        // This prevents clustering of news feed messages
        if (symbolsToUpdate.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`Error updating news feed for ${symbol}:`, error);
      }
    }
  }
  
  /**
   * Update news feed for a specific symbol
   */
  private async updateSymbolNewsFeed(symbol: string): Promise<void> {
    // Get the stock from storage
    const stock = await storage.getStockBySymbol(symbol);
    
    if (!stock) {
      console.error(`Stock not found for symbol ${symbol}`);
      return;
    }
    
    // Generate a simulated news item
    const { headline, summary, source, url } = this.generateNewsItem(symbol, stock.companyName);
    
    // Store the news in the database
    const newsFeed = await storage.createNewsFeed({
      stockId: stock.id,
      headline,
      summary,
      source,
      url
    });
    
    // Publish the news to Solace broker
    const topic = `news-feed/${symbol}`;
    const message = {
      symbol,
      headline: newsFeed.headline,
      summary: newsFeed.summary,
      source: newsFeed.source,
      url: newsFeed.url,
      timestamp: newsFeed.timestamp
    };
    
    await solaceService.publish(topic, message);
    
    console.log(`Published news feed for ${symbol}: "${headline}"`);
  }
  
  /**
   * Generate a simulated news item for a symbol
   */
  private generateNewsItem(symbol: string, companyName: string): {
    headline: string;
    summary: string;
    source: string;
    url: string;
  } {
    const newsTemplates = [
      // Positive news
      {
        headline: `${companyName} Exceeds Quarterly Earnings Expectations`,
        summary: `${companyName} reported quarterly earnings today that surpassed analyst expectations. Revenue was up 15% year-over-year, driven by strong product demand and expanded market share.`,
        source: "Financial Times",
        url: `https://example.com/financial-times/${symbol.toLowerCase()}/earnings`
      },
      {
        headline: `${companyName} Announces Strategic Acquisition`,
        summary: `${companyName} has acquired a leading competitor in a move to expand its market presence. The acquisition is expected to be accretive to earnings within 12 months.`,
        source: "Wall Street Journal",
        url: `https://example.com/wsj/${symbol.toLowerCase()}/acquisition`
      },
      {
        headline: `${companyName} Expands into New International Markets`,
        summary: `${companyName} announced plans to expand operations into emerging markets, targeting significant growth opportunities in Asia and Latin America.`,
        source: "Bloomberg",
        url: `https://example.com/bloomberg/${symbol.toLowerCase()}/expansion`
      },
      
      // Neutral news
      {
        headline: `${companyName} Releases New Product Line`,
        summary: `${companyName} unveiled its latest product lineup today at an industry conference. Analysts provided mixed reactions, noting both innovative features and intense competitive pressure.`,
        source: "Reuters",
        url: `https://example.com/reuters/${symbol.toLowerCase()}/product-launch`
      },
      {
        headline: `${companyName} CFO Speaks at Industry Conference`,
        summary: `The Chief Financial Officer of ${companyName} presented at a major industry conference, discussing the company's financial outlook and long-term strategic vision.`,
        source: "CNBC",
        url: `https://example.com/cnbc/${symbol.toLowerCase()}/conference`
      },
      {
        headline: `${companyName} Maintains Market Position Despite Industry Changes`,
        summary: `${companyName} is holding steady in a rapidly evolving market landscape. Industry analysts note the company's resilience but question long-term growth prospects.`,
        source: "MarketWatch",
        url: `https://example.com/marketwatch/${symbol.toLowerCase()}/market-position`
      },
      
      // Negative news
      {
        headline: `${companyName} Faces Regulatory Scrutiny`,
        summary: `Regulators have initiated an investigation into ${companyName}'s business practices, causing investor concern. The company stated it is fully cooperating with authorities.`,
        source: "The Economist",
        url: `https://example.com/economist/${symbol.toLowerCase()}/regulatory-issues`
      },
      {
        headline: `${companyName} Misses Revenue Targets`,
        summary: `${companyName} reported quarterly results below analyst expectations, citing supply chain challenges and increased competition. The stock dropped 5% in after-hours trading.`,
        source: "Business Insider",
        url: `https://example.com/business-insider/${symbol.toLowerCase()}/earnings-miss`
      },
      {
        headline: `${companyName} Announces Restructuring, Layoffs`,
        summary: `${companyName} revealed plans to cut 8% of its workforce as part of a major restructuring effort aimed at reducing costs and improving operational efficiency.`,
        source: "Fortune",
        url: `https://example.com/fortune/${symbol.toLowerCase()}/restructuring`
      }
    ];
    
    // Select a random news template
    return newsTemplates[Math.floor(Math.random() * newsTemplates.length)];
  }
}

export const newsService = new NewsService();