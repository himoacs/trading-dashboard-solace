import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ConfigPanel from "./ConfigPanel";
import DataTable from "./DataTable";
import StatusBar from "./StatusBar";
import { FiltersPanel } from "./FiltersPanel";
import { useStockData } from "../hooks/useStockData";
import { useSolaceConnection } from "../hooks/useSolaceConnection";
import { useSolaceConnectionStatus, UpdateOptionsParams } from "../hooks/useSolaceConnectionStatus";
import { apiRequest } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  DataSubscription, 
  SimulationSettings, 
  SolaceConnection, 
  StockSelection,
  StockDataWithMetadata,
  ExchangeSubscription
} from "@shared/schema";
import { getWildcardTopicForExchange, getStocksForExchange } from "../lib/exchangeUtils";
import { STOCK_EXCHANGE_MAP, STOCK_EXCHANGES } from "../lib/stockUtils";
import { getWildcardTopicForCountry, getExchangesForCountry, getCountryCodeForExchange } from "../lib/countryUtils";
import { topicManager } from "../lib/topicSubscriptionManager";
import { areStockSelectionsEqual } from "../utils/stockUtils";
import { PanelLeftClose, PanelRightClose, Cable } from "lucide-react"; // Import icons
import { Button } from "@/components/ui/button"; // Import Button
import { TopicExplorerModal } from "./TopicExplorerModal"; // Import the new modal
import MarketOverviewPanel from "./MarketOverviewPanel"; // Import the new MarketOverviewPanel

import dashboardIcon from '@/assets/solcapitalicon.png'; // Changed: Use solcapitalicon.png
import solaceLogo from '@/assets/solace-logo.png';
import topicExplorerIcon from '@/assets/topic-explorer-icon.png'; // Import the new icon
import eventPortalIcon from '@/assets/eventPortalIcon.png'; // Added: Import Event Portal icon

export default function Dashboard() {
  const { toast } = useToast();
  const [selectedStocks, setSelectedStocks] = useState<StockSelection[]>([]);
  console.log('[Dashboard LOG] selectedStocks state:', JSON.stringify(selectedStocks.map(s => s.symbol)));
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const prevLiveStockDataRef = useRef<Record<string, StockDataWithMetadata>>({});
  const [isConfigPanelCollapsed, setIsConfigPanelCollapsed] = useState(false); // State for ConfigPanel
  const [isConfigPanelHidden, setIsConfigPanelHidden] = useState<boolean>(false);
  const [isTopicExplorerOpen, setIsTopicExplorerOpen] = useState<boolean>(false); // State for Topic Explorer Modal
  const [currentFrontendConnection, setCurrentFrontendConnection] = useState<SolaceConnection | null>(null);
  
  // Keep a local copy of the stock data that we can update (now directly from Solace or API)
  const [liveStockData, setLiveStockData] = useState<StockDataWithMetadata[]>([]); // MOVED UP - RENAMED from wsStockData
  
  // Define a broader list of candidates for the dynamic Market Overview Panel
  // These should ideally be symbols your market data publisher is likely to cover.
  const ALL_CANDIDATE_TOP_SYMBOLS = useMemo(() => [
    'AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA', 'TSLA', 'JPM', 'V', 'JNJ', 'UNH',
    'XOM', 'CVX', 'HD', 'BAC', 'PFE', 'KO', 'MCD', 'DIS', 'CSCO',
    'IBM', 'INTC', 'CRM', 'NFLX', 'PYPL', 'ADBE' 
  ], []);

  const NUMBER_OF_STOCKS_FOR_OVERVIEW = 6; // Or 5, or any number you prefer

  // State to hold the randomly selected symbols for the Market Overview Panel
  const [dynamicTopDisplaySymbols, setDynamicTopDisplaySymbols] = useState<string[]>([]);

  // useEffect to select random top symbols on component mount
  useEffect(() => {
    const shuffled = [...ALL_CANDIDATE_TOP_SYMBOLS].sort(() => 0.5 - Math.random());
    setDynamicTopDisplaySymbols(shuffled.slice(0, NUMBER_OF_STOCKS_FOR_OVERVIEW));
  }, [ALL_CANDIDATE_TOP_SYMBOLS, NUMBER_OF_STOCKS_FOR_OVERVIEW]); // Dependencies ensure this runs if constants change, though they are memoized.

  // Derive topSecuritiesData from liveStockData for the Market Overview Panel using dynamic symbols
  const topSecuritiesForOverview = useMemo(() => {
    if (dynamicTopDisplaySymbols.length === 0) return [];

    // Helper to generate numeric ID (already in Dashboard.tsx, ensure it's accessible or defined here if not)
    const generateNumericId = (str: string): number => { 
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(i);
          hash |= 0; 
      }
      return Math.abs(hash);
    };

    return dynamicTopDisplaySymbols.map(symbol => {
      const liveData = liveStockData.find(s => s.symbol === symbol);
      if (liveData) {
        return liveData;
      } else {
        // Create a placeholder if live data for this random symbol isn't available yet
        // Ensure all fields expected by StockDataWithMetadata and MarketOverviewItem are present
        const exchange = STOCK_EXCHANGE_MAP[symbol] || 'N/A'; // Get exchange or default
        return {
          id: generateNumericId(symbol),
          symbol: symbol,
          companyName: symbol, // Default to symbol if no other name source for placeholders
          exchange: exchange,
          country: getCountryCodeForExchange(exchange), // Requires getCountryCodeForExchange to be in scope
          currentPrice: null,
          priceChange: null,
          percentChange: null,
          volume: null,
          previousClose: null,
          lastUpdated: new Date().toISOString(),
          selected: false, // Not relevant for overview panel in this context
          addedByWildcard: false,
          individuallySelected: false,
          tradingSignal: null,
          latestNews: null,
          economicIndicator: null,
          lastTweet: null,
        } as StockDataWithMetadata;
      }
    });
  }, [liveStockData, dynamicTopDisplaySymbols, getCountryCodeForExchange]); // Added getCountryCodeForExchange to dependencies
  
  // Debugging logs for selectedStocks and symbols
  useEffect(() => {
    console.log('[Dashboard LOG] selectedStocks state changed (useEffect):', JSON.stringify(selectedStocks.map(s => s.symbol)));
  }, [selectedStocks]);
  
  // Helper function to determine which exchange a stock belongs to
  const getExchangeForStock = (symbol: string): string => {
    const existingStock = selectedStocks.find(s => s.symbol === symbol);
    if (existingStock?.exchange) {
      return existingStock.exchange;
    }
    return STOCK_EXCHANGE_MAP[symbol] || 'NYSE';
  };
  
  const isStockCoveredByExchangeWildcard = (symbol: string): boolean => {
    const stockExchange = getExchangeForStock(symbol);
    return selectedExchanges.includes(stockExchange);
  };
  
  const isStockCoveredByCountryWildcard = (symbol: string): boolean => {
    const stockExchange = getExchangeForStock(symbol);
    const stockCountry = getCountryCodeForExchange(stockExchange);
    return selectedCountries.includes(stockCountry);
  };
  
  const isStockCoveredByWildcard = (symbol: string): boolean => {
    return isStockCoveredByExchangeWildcard(symbol) || isStockCoveredByCountryWildcard(symbol);
  };

  const [simulationSettings, setSimulationSettings] = useState<SimulationSettings>({
    updateFrequency: 5
  });
  const [isSimulating, setIsSimulating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isNavCollapsed, setIsNavCollapsed] = useState<boolean>(false);
  
  // Backend Solace connection state (for backend publishers, not this frontend's direct connection)
  const [backendConnected, setBackendConnected] = useState(false);
  const [backendConnecting, setBackendConnecting] = useState(false);
  
  // Fetch Solace connection status from the API
  const fetchSolaceStatus = async () => {
    try {
      const response = await fetch('/api/solace/status');
      const data = await response.json();
      if (data.success) {
        setBackendConnected(data.publisher === true);
      }
    } catch (error) {
      console.error('Error fetching Solace status:', error);
    }
  };
  
  // Fetch Solace status on component mount and then every 10 seconds
  useEffect(() => {
    fetchSolaceStatus();
    
    const intervalId = setInterval(() => {
      fetchSolaceStatus();
    }, 10000);
    
    // Clear interval on component unmount
    return () => clearInterval(intervalId);
  }, []);

  const { 
    connected, 
    connecting, 
    connect, 
    disconnect,
    subscribe,
    unsubscribe,
    solaceLastMessage: incomingSolaceMessage, 
    error: solaceConnectionHookError 
  } = useSolaceConnection();
  
  // Get detailed connection status for all Solace services
  const {
    connectionStatus,
    publisherStatus,
    twitterStatus,
    startMarketDataFeed,
    stopMarketDataFeed,
    updateMarketDataFeedOptions, // Destructure new mutation
    startTwitterFeed,
    stopTwitterFeed,
    updateTwitterFeedOptions, // Destructure new mutation
    marketDataFeedStarting,
    twitterFeedStarting,
    marketDataFeedOptionsUpdating, // Destructure new loading state
    twitterFeedOptionsUpdating // Destructure new loading state
  } = useSolaceConnectionStatus();

  const [allMarketStocks, setAllMarketStocks] = useState<StockDataWithMetadata[]>([]); // New state for all stocks

  // Fetch all available stocks for filter panel counts
  useEffect(() => {
    const fetchAllStocks = async () => {
      try {
        // Assuming apiRequest can be used or a direct fetch
        const response = await fetch('/api/stocks/available'); 
        if (!response.ok) {
          throw new Error('Failed to fetch all available stocks');
        }
        const data: StockDataWithMetadata[] = await response.json();
        setAllMarketStocks(data);
        console.log("[Dashboard fetchAllStocks] Successfully fetched all market stocks:", data);
      } catch (error) {
        console.error("Error fetching all market stocks for filters:", error);
        toast({
          title: "Error Loading Filter Data",
          description: "Could not load all stocks for country filter counts.",
          variant: "destructive",
        });
      }
    };
    fetchAllStocks();
  }, [toast]); // Added toast to dependency array as it's used in catch

  const { 
    data: availableStocks, // This is likely based on selectedStocks
    isLoading: loadingStockData, 
    isError: stockDataError,
    startSimulation,
    stopSimulation
  } = useStockData(selectedStocks, simulationSettings);
  
  // NEW: State for direct Solace connection message and error handling for this frontend client
  // const [solaceLastMessage, setSolaceLastMessage] = useState<any | null>(null); // REMOVED - use incomingSolaceMessage from hook
  // const [solaceError, setSolaceError] = useState<Error | null>(null); // REMOVED - use solaceConnectionHookError from hook
  
  // NEW: State to track what this frontend client is subscribed to on Solace
  const [solaceSubscribedTopics, setSolaceSubscribedTopics] = useState<string[]>([]);

  // NEW: Effect to log Solace connection errors (from this frontend's direct connection)
  useEffect(() => {
    if (solaceConnectionHookError) { // Use error from hook
      console.error('Solace direct connection error for frontend:', solaceConnectionHookError);
      toast({
        title: 'Solace Connection Issue',
        description: solaceConnectionHookError.message,
        variant: 'destructive',
      });
    }
  }, [solaceConnectionHookError]); // Depend on error from hook
  
  // Attempt to connect to Solace on component mount if a configuration is available
  useEffect(() => {
    // Example: Try to load config from localStorage or use a default
    // This is a placeholder for actual config loading logic
    const savedConfigString = localStorage.getItem('solaceConfig');
    let defaultConfig: SolaceConnection | null = null;

    // if (savedConfigString) {
    //   try {
    //     defaultConfig = JSON.parse(savedConfigString) as SolaceConnection;
    //     console.log('[Dashboard Solace Autoconnect] Found saved Solace config:', defaultConfig);
    //   } catch (e) {
    //     console.error('[Dashboard Solace Autoconnect] Error parsing saved Solace config:', e);
    //   }
    // } else {
    //   // Define a default configuration if none is saved
    //   // IMPORTANT: Replace with your actual default Solace connection details
    //   defaultConfig = {
    //     brokerUrl: 'ws://localhost:8080', // Replace with your broker URL
    //     vpnName: 'default',             // Replace with your VPN name
    //     username: 'default_user',       // Replace with your username
    //     password: '',                   // Replace with your password
    //     configType: 'frontend'
    //   };
    //   console.log('[Dashboard Solace Autoconnect] No saved config, using default:', defaultConfig);
    // }

    if (defaultConfig && !connected && !connecting) {
      console.log('[Dashboard Solace Autoconnect] Attempting to auto-connect to Solace with config:', defaultConfig);
      handleSolaceConnect(defaultConfig).catch(err => {
        console.error('[Dashboard Solace Autoconnect] Auto-connect failed:', err);
        // Toast is handled within handleSolaceConnect or useSolaceConnection
      });
    } else if (connected) {
      console.log('[Dashboard Solace Autoconnect] Already connected to Solace.');
    } else if (connecting) {
      console.log('[Dashboard Solace Autoconnect] Already attempting to connect to Solace.');
    }
  }, []); // Empty dependency array ensures this runs only on mount
  
  // Handle country selection with wildcard topics
  const handleCountrySelection = (countryId: string, selected: boolean) => {
    if (selected) {
      // STEP 1: Get wildcard topic pattern for this country first
      const wildcardTopic = getWildcardTopicForCountry(countryId);
      if (!wildcardTopic) {
        console.error(`No wildcard topic pattern found for country ${countryId}`);
        return;
      }
      
      // Register the country wildcard in the topic manager before other operations
      topicManager.addCountryWildcard(countryId);
      
      // STEP 3: Add to selected countries state 
      setSelectedCountries(prev => [...prev, countryId]);
      
      // Get all exchanges and stocks for this country
      const countryExchanges = getExchangesForCountry(countryId);
      
      // For all stocks from these exchanges, mark them as covered by country wildcard
      const allStocksForCountry: string[] = [];
      countryExchanges.forEach(exchange => {
        const exchangeStocks = getStocksForExchange(exchange);
        allStocksForCountry.push(...exchangeStocks);
      });
      
      // STEP 5: Update selectedStocks to mark all stocks from this country as covered by wildcard
      // Only mark existing stocks as covered by wildcard, do NOT add new individual stocks
      setSelectedStocks(prevSelectedStocks => {
        const countryStockSymbolsSet = new Set(allStocksForCountry);

        // 1. Update existing stocks that belong to this country.
        let updatedAndExistingStocks = prevSelectedStocks.map(stock => {
          const stockExchange = getExchangeForStock(stock.symbol);
          const stockCountry = getCountryCodeForExchange(stockExchange);
          
          if (stockCountry === countryId || countryStockSymbolsSet.has(stock.symbol)) {
            return {
              ...stock, // Preserves existing individuallySelected
              selected: true, 
              addedByWildcard: true, 
            };
          }
          return stock;
        });
        
        // 2. Identify and add new stocks from this country that are not already in selectedStocks.
        const currentSelectedSymbolsSet = new Set(updatedAndExistingStocks.map(s => s.symbol));
        const newStocksToAddFromCountryToSelectedStocks = allStocksForCountry
          .filter(symbol => !currentSelectedSymbolsSet.has(symbol))
          .map(symbol => {
            const stockExchange = STOCK_EXCHANGE_MAP[symbol] || 'Unknown'; 
            return {
              symbol: symbol,
              companyName: `${symbol} Stock`, 
              exchange: stockExchange, 
              selected: true,
              addedByWildcard: true,
              individuallySelected: false, 
            };
          });

        return [...updatedAndExistingStocks, ...newStocksToAddFromCountryToSelectedStocks];
      });
      
      // NEW: Add placeholders to liveStockData for all stocks in the selected country
      if (allStocksForCountry.length > 0) {
        setLiveStockData(prevLiveStockData => {
          const currentLiveSymbols = new Set(prevLiveStockData.map(stock => stock.symbol));
          const countryStockSymbolsSet = new Set(allStocksForCountry); // Re-declare for safety in this scope

          // Update existing live data entries that are part of this country
          const updatedExistingLiveStocks = prevLiveStockData.map(liveStock => {
            const stockExchange = liveStock.exchange || getExchangeForStock(liveStock.symbol);
            const stockCountry = getCountryCodeForExchange(stockExchange);
            if (stockCountry === countryId || countryStockSymbolsSet.has(liveStock.symbol)) {
              // Preserve individual selection if it was set
              const selectionInfo = selectedStocks.find(s => s.symbol === liveStock.symbol);
              return {
                ...liveStock,
                country: countryId, // Ensure country is set
                addedByWildcard: true,
                selected: true, // Mark as selected because country is selected
                individuallySelected: selectionInfo?.individuallySelected || false,
              };
            }
            return liveStock;
          });

          // Identify and create new placeholder entries for stocks from this country not yet in liveStockData
          const newPlaceholdersToAdd = allStocksForCountry
            .filter(symbol => !currentLiveSymbols.has(symbol))
            .map((symbol, index) => {
              const stockExchange = STOCK_EXCHANGE_MAP[symbol] || 'Unknown';
              const selectionInfo = selectedStocks.find(s => s.symbol === symbol);
              const generateNumericId = (str: string): number => { 
                  let hash = 0;
                  for (let i = 0; i < str.length; i++) {
                      hash = ((hash << 5) - hash) + str.charCodeAt(i);
                      hash |= 0; 
                  }
                  return Math.abs(hash);
              };
              return {
                id: generateNumericId(symbol), // Or use a more robust ID generation
                symbol: symbol,
                companyName: `${symbol} Stock Placeholder`, // Default name
                exchange: stockExchange,
                country: countryId,
                currentPrice: null,
                priceChange: null,
                percentChange: null,
                volume: null,
                previousClose: null,
                lastUpdated: new Date().toISOString(),
                selected: true, // Selected due to country selection
                addedByWildcard: true,
                individuallySelected: selectionInfo?.individuallySelected || false,
                tradingSignal: null,
                latestNews: null,
                economicIndicator: null,
                lastTweet: null,
              } as StockDataWithMetadata;
            });
          
          if (newPlaceholdersToAdd.length > 0) {
            console.log(`[handleCountrySelection] Adding ${newPlaceholdersToAdd.length} placeholder stocks to liveStockData for country ${countryId}`);
          }
          return [...updatedExistingLiveStocks, ...newPlaceholdersToAdd];
        });
      }
      
      // STEP 6: If connected to Solace, update subscriptions
      if (connected) { // 'connected' now refers to this frontend's direct Solace connection
        console.log(`🔴 COUNTRY WILDCARD: Setting up Solace country wildcard subscription for ${countryId}: ${wildcardTopic}`);
        
        // Find all individual stock topics from this country that we're subscribed to that can now be replaced
        // This logic will be handled by the main subscription useEffect based on selectedCountries and selectedStocks state changes.
        // let topicsToUnsubscribeFromSolace: string[] = []; 
        // solaceSubscribedTopics.forEach(topicString => { ... });
        // console.log(`🔴 COUNTRY WILDCARD: Found ${topicsToUnsubscribeFromSolace.length} individual topics from ${countryId} that will be replaced by wildcard`);
        
        // Check if we're already subscribed to this wildcard topic to avoid redundant subscription
        // This logic will be handled by the main subscription useEffect.
        // const isAlreadySubscribedToSolace = solaceSubscribedTopics.includes(wildcardTopic);
        // if (isAlreadySubscribedToSolace) { ... } else { ... subscribe calls ... }
        
        // For each individual topic covered by the new wildcard, unsubscribe
        // This logic will be handled by the main subscription useEffect.
        // if (topicsToUnsubscribeFromSolace.length > 0) { ... unsubscribe calls ... }
        
        // Check if we need to subscribe to signal/output (consistent with exchange implementation)
        // This logic will be handled by the main subscription useEffect.
        // const signalWildcard = 'signal/>'; 
        // if (!solaceSubscribedTopics.includes(signalWildcard)) { ... subscribe call ... } 
        
        // Add final toast notification of successful subscription
        const wildcardTopicForToast = getWildcardTopicForCountry(countryId);
        toast({
          title: `${countryId} Country Subscribed`,
          description: `Subscribed to all stocks using wildcard pattern: ${wildcardTopicForToast || 'country wildcard'}`
        });
        
        console.log(`✨ COUNTRY WILDCARD SETUP COMPLETE FOR ${countryId} ✨`);
      } else {
        // Even if not connected, show a toast
        toast({
          title: `${countryId} Country Selected`,
          description: `Country selected for wildcard subscription when Solace connects`
        });
      }
      
      // Step 7: Add empty placeholders for all stocks from this country to liveStockData for UI display
      // This ensures they show up in the UI even before we receive data from Solace
      if (allStocksForCountry.length > 0) {
          // Find which stocks from this country are already individually selected
          const individuallySelectedStocks = selectedStocks
            .filter(stock => stock.individuallySelected === true)
            .map(stock => stock.symbol);
            
          console.log(`Found ${individuallySelectedStocks.length} individually selected stocks from country ${countryId}`);
      } // This closes if (allStocksForCountry.length > 0)
    } else {
      // COUNTRY DESELECTION LOGIC
      console.log(`🔴 COUNTRY WILDCARD: Processing country DEselection for ${countryId}`);
      
      // Step 1: Get wildcard topic pattern for this country
      const wildcardTopic = getWildcardTopicForCountry(countryId);
      if (!wildcardTopic) {
        console.error(`No wildcard topic pattern found for country ${countryId}`);
        return;
      }
      
      // Step 2: Remove country from selected countries state
      setSelectedCountries(prev => prev.filter(id => id !== countryId));
      
      // Step 3: Remove the country wildcard from the topic manager (if still used for frontend state)
      console.log(`🔴 COUNTRY WILDCARD: Removing country wildcard from topic manager: ${countryId}`);
      topicManager.removeCountryWildcard(countryId);
      console.log(`🔴 COUNTRY WILDCARD: Topic manager country wildcards after removal:`, 
                  topicManager.getCountryWildcards().map(w => w.id));
      
      // Step 4: Get all exchanges and stocks for this country that need to be removed
      const countryExchanges = getExchangesForCountry(countryId);
      console.log(`Country ${countryId} includes ${countryExchanges.length} exchanges to remove: ${countryExchanges.join(', ')}`);
      
      // Get all stocks from these exchanges that were covered by the country wildcard
      const allStocksForCountry: string[] = [];
      countryExchanges.forEach(exchange => {
        const exchangeStocks = getStocksForExchange(exchange);
        allStocksForCountry.push(...exchangeStocks);
      });
      
      // Step 5: Update selectedStocks to clear addedByWildcard flag for all stocks from this country
      // ONLY keep stocks that were individually selected
      setSelectedStocks(prevSelectedStocks => {
        // Filter out stocks from this country that are not individually selected
        return prevSelectedStocks
          .filter(stock => {
            const stockExchange = getExchangeForStock(stock.symbol);
            const stockCountry = getCountryCodeForExchange(stockExchange);
            
            // Keep if:
            // 1. Not from this country, OR
            // 2. Individually selected (even if from this country)
            return stockCountry !== countryId || stock.individuallySelected === true;
          })
          .map(stock => {
            // For any remaining stocks from this country that were individually selected,
            // make sure the addedByWildcard flag is cleared
            const stockExchange = getExchangeForStock(stock.symbol);
            const stockCountry = getCountryCodeForExchange(stockExchange);
            
            if (stockCountry === countryId) {
              return {
                ...stock,
                addedByWildcard: false, // Clear wildcard flag
              };
            }
            return stock;
          });
      });
      
      // Step 6: If connected to Solace, update subscriptions
      if (connected) { // 'connected' is Solace direct connection
        console.log(`🔴 COUNTRY WILDCARD: Removing country wildcard Solace subscription for ${countryId}: ${wildcardTopic}`);
        
        // Unsubscribe from the wildcard topic
        // This will be handled by the main subscription useEffect when selectedCountries changes.
        
        toast({
          title: `Country Wildcard Removed`,
          description: `Unsubscribed from ${wildcardTopic}`,
          variant: "default",
        });
        
        console.log(`✨ COUNTRY WILDCARD REMOVAL COMPLETE FOR ${countryId} ✨`);
      } // This closes if (connected) for deselection

      // NEW: Clean up liveStockData after country deselection
      setLiveStockData(prevLiveStockData => {
        const stillSelectedCountryCodes = new Set(selectedCountries.filter(c => c !== countryId)); // Countries still selected
        const stillSelectedExchangeIds = new Set(selectedExchanges);

        return prevLiveStockData.filter(liveStock => {
          const stockSelectionInfo = selectedStocks.find(s => s.symbol === liveStock.symbol);
          
          // If stock no longer in selectedStocks at all (was purely from this country wildcard and not re-added by another filter)
          if (!stockSelectionInfo || !stockSelectionInfo.selected) {
            // Check if it was part of the *just deselected* country
            const stockExchange = liveStock.exchange || getExchangeForStock(liveStock.symbol);
            const stockCountryForLiveStock = getCountryCodeForExchange(stockExchange);
            if (stockCountryForLiveStock === countryId) {
              console.log(`[handleCountrySelection DESELECT] Removing ${liveStock.symbol} from liveStockData as it was part of deselected country ${countryId} and is no longer selected.`);
              return false; // Remove
            }
          }
          
          // If it is still in selectedStocks, keep it. Its selected/addedByWildcard flags are already updated by setSelectedStocks above.
          // The displayStockData memo will then use these flags.
          // However, we can do an explicit check here for robustness:
          if (stockSelectionInfo?.individuallySelected) return true; // Always keep if individually selected

          const stockExchange = liveStock.exchange || getExchangeForStock(liveStock.symbol);
          const stockCountryForLiveStock = getCountryCodeForExchange(stockExchange);

          // Keep if covered by another active country wildcard
          if (stillSelectedCountryCodes.has(stockCountryForLiveStock)) return true;
          
          // Keep if covered by an active exchange wildcard (and that exchange's country isn't the one being removed, unless it's also covered by another country)
          if (stillSelectedExchangeIds.has(stockExchange)) {
            // If this exchange is selected, keep the stock regardless of country, 
            // as exchange selection takes precedence for display over country in this context.
            return true;
          }

          // If it belonged to the deselected country and is not individually selected or covered by another active wildcard, remove it.
          if (stockCountryForLiveStock === countryId && !stockSelectionInfo?.individuallySelected) {
            console.log(`[handleCountrySelection DESELECT] Removing ${liveStock.symbol} (from ${countryId}) from liveStockData as it's not individually selected or covered by other active wildcards.`);
            return false;
          }
          
          return true; // Keep by default if none of the above removal conditions met
        });
      });
    } // This closes the main else block for country deselection
  }; // END OF handleCountrySelection

  // Handle exchange selection with wildcard topics
  const handleExchangeSelection = (exchangeId: string, selected: boolean) => {
    const exchangeStocks = getStocksForExchange(exchangeId); 
    const exchangeStockSymbolsSet = new Set(exchangeStocks);

    if (selected) {
      // Add to selected exchanges
      setSelectedExchanges(prev => [...prev, exchangeId]);
      
      // First, update the selectedStocks state to mark all stocks from this exchange as covered by wildcard
      // This is critical for preventing redundant individual subscriptions
      console.log(`Found ${exchangeStocks.length} stocks from ${exchangeId} exchange that will be covered by wildcard subscription`);
      
      // Update selectedStocks to mark all stocks from this exchange as covered by wildcard
      setSelectedStocks(prevSelectedStocks => {
        // const exchangeStockSymbolsSet = new Set(exchangeStocks); // No longer needed here

        // 1. Update existing stocks that belong to this exchange or are now part of it.
        let updatedAndExistingStocks = prevSelectedStocks.map(stock => {
          if (stock.exchange === exchangeId || exchangeStockSymbolsSet.has(stock.symbol)) {
            return {
              ...stock, // Preserves existing individuallySelected
              exchange: exchangeId, 
              selected: true, 
              addedByWildcard: true, 
            };
          }
          return stock;
        });
        
        // 2. Identify and add new stocks from this exchange that are not already in selectedStocks.
        const currentSelectedSymbolsSet = new Set(updatedAndExistingStocks.map(s => s.symbol));
        const newStocksToAdd = exchangeStocks
          .filter(symbol => !currentSelectedSymbolsSet.has(symbol))
          .map(symbol => {
            return {
              symbol: symbol,
              companyName: `${symbol} Stock`, 
              exchange: exchangeId,
              selected: true,
              addedByWildcard: true,
              individuallySelected: false, 
            };
          });

        return [...updatedAndExistingStocks, ...newStocksToAdd];
      });
      
      if (connected) { // 'connected' is Solace direct connection
        // Get wildcard topic pattern for this exchange
        const wildcardTopic = getWildcardTopicForExchange(exchangeId);
        if (wildcardTopic) {
          console.log(`Subscribing to Solace wildcard topic for ${exchangeId}: ${wildcardTopic}`);
          
          // We will need to manage the WebSocket and Solace subscriptions
          // Step 1: Get stocks covered by this exchange wildcard (used for UI display only)
          console.log(`Found ${exchangeStocks.length} stocks from ${exchangeId} exchange - covered by wildcard subscription`);
          
          // Step 2: Create a set of topics to unsubscribe from and a set of topics to subscribe to
          // for consistent and efficient topic management
          // This logic will be handled by the main subscription useEffect based on selectedExchanges and selectedStocks state changes.
          // let topicsToUnsubscribeFromSolace: string[] = [];
          // let topicsToSubscribeToSolace: string[] = [wildcardTopic]; 
          
          // Unsubscribe from ANY individual stock topics for this exchange - the wildcard covers ALL of them
          // This logic will be handled by the main subscription useEffect.
          // const existingSubscribedStocks = selectedStocks.filter(...);
          // if (existingSubscribedStocks.length > 0) { ... topicsToUnsubscribeFromSolace.push(topic) ... }
          
          // This logic will be handled by the main subscription useEffect.
          // const isAlreadySubscribedToSolaceWildcard = solaceSubscribedTopics.includes(wildcardTopic);
          // if (isAlreadySubscribedToSolaceWildcard) { ... unsubscribe calls ... } else { ... subscribe and unsubscribe calls ... }
            
          // Check if we need to subscribe to signal/output (global signal wildcard)
          // This logic will be handled by the main subscription useEffect.
          // const signalWildcard = 'signal/>'; 
          // if (!solaceSubscribedTopics.includes(signalWildcard)) { ... subscribe call ... } 
            
            // Log the current subscription status
            console.log(`Subscription update complete. Current topics include wildcard ${wildcardTopic}`);
        } // End of if (wildcardTopic)
          
        // Step 3: Add all exchange stocks to liveStockData for UI display (renamed from wsStockData)
          if (exchangeStocks.length > 0) {
            // Find which stocks from this exchange are already individually selected
            const individuallySelectedStocks = selectedStocks
              .filter(stock => stock.individuallySelected === true)
              .map(stock => stock.symbol);
              
            console.log(`Found ${individuallySelectedStocks.length} individually selected stocks from this exchange`);
            
          setLiveStockData(prev => { // RENAMED setWsStockData
              const currentSymbols = prev.map(stock => stock.symbol);
              
              // First, update any existing stocks from this exchange to mark them as covered by wildcard
              const updatedExistingStocks = prev.map(stock => {
                if (stock.exchange === exchangeId || exchangeStockSymbolsSet.has(stock.symbol)) {
                  // If it was individually selected, preserve that flag
                  const wasIndividuallySelected = 
                    stock.individuallySelected === true || 
                    individuallySelectedStocks.includes(stock.symbol);
                    
                  return {
                    ...stock,
                    exchange: exchangeId,
                    addedByWildcard: true, // Mark ALL stocks in exchange as added by wildcard
                    individuallySelected: wasIndividuallySelected // Preserve individual selection status
                  };
                }
                return stock;
              });
              
              // Create placeholder entries for new stocks from this exchange
              const newStockData = exchangeStocks
                .filter(symbol => !currentSymbols.includes(symbol))
                .map((symbol, index) => {
                  // Check if this stock was individually selected
                  const isIndividuallySelected = individuallySelectedStocks.includes(symbol);
                  
                  const newStock: StockDataWithMetadata = {
                    id: prev.length + index + 1,
                    symbol: symbol,
                    companyName: `${symbol} Stock`, // Default name until we get real data
                    currentPrice: null, // Will be filled when real data arrives
                    percentChange: null,
                    lastUpdated: new Date().toISOString(),
                    selected: true,
                    tradingSignal: null,
                    latestNews: null,
                    economicIndicator: null,
                    exchange: exchangeId, // Store exchange information
                    addedByWildcard: true, // Mark ALL stocks in exchange as added by wildcard
                    individuallySelected: isIndividuallySelected, // Flag for individual selection
                    lastTweet: null
                  };
                  return newStock;
                });
                
              if (newStockData.length > 0) {
                console.log(`Added ${newStockData.length} placeholder stock entries for exchange ${exchangeId} display`);
              }
              
              return [...updatedExistingStocks, ...newStockData];
            });
          }
          
        // Step 4: Solace connection already handled by `subscribe` calls above.
          
          toast({
            title: `${exchangeId} Exchange Subscribed`,
          description: `Subscribed to all stocks using wildcard pattern: ${getWildcardTopicForExchange(exchangeId)}` // Added getWildcardTopicForExchange here
        });
      } // This closes if (connected) for selection
    } else {
      // Remove from selected exchanges
      setSelectedExchanges(prev => prev.filter(id => id !== exchangeId));
      
      // Update the selectedStocks state to mark stocks from this exchange as no longer covered by wildcard
      // const exchangeStocks = getStocksForExchange(exchangeId); // No longer needed here

      // Create a list of stock symbols that will be removed (needed for liveStockData cleanup)
      const stocksToRemove = exchangeStocks.filter(symbol => {
        const stock = selectedStocks.find(s => s.symbol === symbol);
        return stock && stock.addedByWildcard && !stock.individuallySelected;
      });
      
      // Update selectedStocks to reflect the wildcard removal
      setSelectedStocks(prevSelectedStocks => {
        // For each stock from this exchange:
        // - If it was individually selected, keep it but mark as not covered by wildcard
        // - If it was only added by wildcard, remove it entirely
        return prevSelectedStocks.filter(stock => {
          const isFromThisExchange = stock.exchange === exchangeId || exchangeStockSymbolsSet.has(stock.symbol);
          
          // If the stock is from a different exchange, keep it as is
          if (!isFromThisExchange) {
            return true;
          }
          
          // If the stock was individually selected, keep it but without wildcard coverage
          if (stock.individuallySelected === true) {
            return true; // We'll update its properties below
          }
          
          // If it was only added by wildcard, remove it
          return false;
        }).map(stock => {
          const isFromThisExchange = stock.exchange === exchangeId || exchangeStockSymbolsSet.has(stock.symbol);
          
          // If the stock is from this exchange and was individually selected,
          // keep it but mark it as not covered by wildcard anymore
          if (isFromThisExchange && stock.individuallySelected === true) {
            return {
              ...stock,
              addedByWildcard: false // No longer covered by wildcard
            };
          }
          
          return stock;
        });
      });
      
      if (connected) { // 'connected' is Solace direct connection
        // Get wildcard topic pattern for this exchange
        const wildcardTopic = getWildcardTopicForExchange(exchangeId);
        if (wildcardTopic) {
          console.log(`Unsubscribing from Solace wildcard topic for ${exchangeId}: ${wildcardTopic}`);
          
          // Unsubscribe via WebSocket
          // This will be handled by the main subscription useEffect when selectedExchanges changes.
          // unsubscribe(wildcardTopic, 'stock').catch(err => { ... });
          
          // Also unsubscribe from Solace if connected
          // This will be handled by the main subscription useEffect.
          // unsubscribe(wildcardTopic, 'stock').catch(err => { ... });
          
          // We should NOT add individual stock subscriptions when removing an exchange wildcard
          // as this contradicts the desired behavior. Just log the info for debugging.
          const individuallySelectedStocks = selectedStocks.filter(
            stock => (stock.exchange === exchangeId || exchangeStockSymbolsSet.has(stock.symbol)) && 
                    stock.individuallySelected === true
          );
          
          console.log(`Found ${individuallySelectedStocks.length} individually selected stocks from ${exchangeId} - NOT adding individual subscriptions`);
          
          // Do NOT subscribe to individual stocks when removing an exchange - this would be incorrect behavior
          
          // When removing an exchange wildcard, we need to:
          // 1. Remove stocks from liveStockData that were only added by wildcard (not individually selected)
          // 2. Update selectedStocks to reflect the same changes
          // 3. Update individually selected stocks to show they're no longer covered by wildcard
          
          // Remove stocks that were only added by this exchange's wildcard from liveStockData (UI display)
          setLiveStockData(prev =>  // RENAMED setWsStockData
            prev.filter(stock => {
              // Keep all stocks not from this exchange
              if (stock.exchange !== exchangeId && !exchangeStockSymbolsSet.has(stock.symbol)) {
                return true;
              }
              
              // For stocks from this exchange, only keep individually selected ones
              return stock.individuallySelected === true;
            }).map(stock => {
              // For individually selected stocks from this exchange, mark as not covered by wildcard
              const isFromThisExchange = 
                stock.exchange === exchangeId || 
                exchangeStockSymbolsSet.has(stock.symbol);
              
              if (isFromThisExchange && stock.individuallySelected === true) {
                return {
                  ...stock,
                  addedByWildcard: false // No longer covered by wildcard
                };
              }
              return stock;
            })
          );
          
          // Update selectedStocks state to match the same filtering
          setSelectedStocks(prevSelectedStocks => {
            return prevSelectedStocks.filter(stock => {
              const isFromThisExchange = 
                stock.exchange === exchangeId || 
                exchangeStockSymbolsSet.has(stock.symbol);
              
              // Only keep individually selected stocks from this exchange
              return !isFromThisExchange || stock.individuallySelected === true;
            }).map(stock => {
              // For individually selected stocks from this exchange, mark as not covered by wildcard
              const isFromThisExchange = 
                stock.exchange === exchangeId || 
                exchangeStockSymbolsSet.has(stock.symbol);
              
              if (isFromThisExchange && stock.individuallySelected === true) {
                return {
                  ...stock,
                  addedByWildcard: false // No longer covered by wildcard
                };
              }
              return stock;
            });
          });
          
          toast({
            title: `${exchangeId} Exchange Unsubscribed`,
            description: `Unsubscribed from wildcard pattern: ${getWildcardTopicForExchange(exchangeId)}` // Added getWildcardTopicForExchange here
          });
        } // This closes if (wildcardTopic) inside if(connected) for deselection
      } else {
        // Even if Solace is not connected, we still need to update the UI to show the exchange is unselected
        
        // Remove stocks that were added by wildcards from liveStockData for visualization
        if (exchangeStocks.length > 0) {
          // Step 1: Update the liveStockData (UI visualization)
          setLiveStockData(prev => { // RENAMED setWsStockData
            // Keep stocks that are not from this exchange OR that are individually selected
            return prev.filter(stock => {
              // When removing exchange filtering, we should keep all stocks that:
              // 1. Don't belong to this exchange, OR
              // 2. Were individually selected (not added by wildcard)
              const isFromThisExchange = 
                stock.exchange !== exchangeId && !exchangeStockSymbolsSet.has(stock.symbol);
              
              // Check both addedByWildcard flag and individuallySelected flag
              const addedByWildcard = stock.addedByWildcard === true;
              const individuallySelected = stock.individuallySelected === true;
              
              // Keep if it's not from this exchange OR it was individually selected
              return !isFromThisExchange || individuallySelected;
            });
          });
          
          // Step 2: Update the selectedStocks state to remove non-individually selected stocks from this exchange
          setSelectedStocks(prevSelectedStocks => {
            return prevSelectedStocks.filter(stock => {
              const isFromThisExchange = 
                stock.exchange !== exchangeId && !exchangeStockSymbolsSet.has(stock.symbol);
              
              // Only keep individually selected stocks from this exchange
              return !isFromThisExchange || stock.individuallySelected === true;
            });
          });
          
          // Remove ALL stocks from this exchange that aren't individually selected
          setLiveStockData(prev =>  // RENAMED setWsStockData
            prev.filter(stock => {
              // Keep all stocks not from this exchange
              if (stock.exchange !== exchangeId && !exchangeStockSymbolsSet.has(stock.symbol)) {
                return true;
              }
              
              // For stocks from this exchange, only keep individually selected ones
              return stock.individuallySelected === true;
            })
          );
          
          toast({
            title: `${exchangeId} Exchange Unselected`,
            description: `Exchange removed from wildcard subscriptions`
          });
        } // This closes if (exchangeStocks.length > 0) for UI updates when not connected
      } // This closes else for 'if (connected)' during deselection
    } // This closes the main else block for exchange deselection
  }; // END OF handleExchangeSelection

  // Track if we've already subscribed to signal/output via Solace
  // This state is now managed by solaceSubscribedTopics or directly by useSolaceConnection's internal state
  
  // Initialize local stock data from the API data
  useEffect(() => {
    if (availableStocks && availableStocks.length > 0) {
      console.log('Setting initial stock data from API:', availableStocks);
      
      if (liveStockData.length > 0) { // Use liveStockData
        const mergedData = availableStocks.map(apiStock => {
          const localStock = liveStockData.find(s => s.symbol === apiStock.symbol); // Use liveStockData
          
          if (!localStock) return apiStock;
          
          return {
            ...apiStock,
            lastTweet: apiStock.lastTweet || localStock.lastTweet,
            tradingSignal: apiStock.tradingSignal || localStock.tradingSignal
          };
        });
        
        setLiveStockData(mergedData); // Use setLiveStockData
        console.log('Merged API data with existing live Solace data to preserve signals and tweets');
      } else {
        setLiveStockData(availableStocks); // Use setLiveStockData
      }
    }
  }, [availableStocks]); // liveStockData removed from deps to avoid loop, API data is the source
  
  // Process Solace messages to update UI
  useEffect(() => {
    if (!incomingSolaceMessage) return;

    const message = incomingSolaceMessage; 
    const destination = message.getDestination();
    
    if (!destination) {
      console.warn("[SOLACE_TRACE_DASH] Received Solace message with no destination:", message);
      return;
    }
    const topicName = destination.getName();
    const payloadString = message.getBinaryAttachment() as string | null; 

    console.log(`[SOLACE_TRACE_DASH] START: Processing Solace message. Topic: ${topicName}`);
    if (payloadString) {
      console.log(`[SOLACE_TRACE_DASH] Raw payload string: ${payloadString.substring(0, 500)}${payloadString.length > 500 ? '...' : ''}`);
    } else {
      console.log("[SOLACE_TRACE_DASH] Payload is null or not a binary attachment.");
    }
    
    let parsedPayload: any = null;
    if (payloadString) {
        try {
            parsedPayload = JSON.parse(payloadString);
            console.log(`[SOLACE_TRACE_DASH] Successfully parsed payload JSON.`);
        } catch (e) {
            console.warn(`[SOLACE_TRACE_DASH] Payload for topic ${topicName} is not valid JSON. Error:`, e);
      return;
    }
    }
    
    let messageType = parsedPayload?.type || parsedPayload?.Signal || parsedPayload?.action;
    let messageSymbol = parsedPayload?.symbol || parsedPayload?.id;
    const messageTimestamp = parsedPayload?.timestamp || (parsedPayload?.data?.timestamp);
    let actualMessageData = parsedPayload; 

    // Explicitly determine messageType from topic first, then refine symbol
    if (topicName.startsWith('market-data/EQ/')) {
      messageType = 'market-data';
      if (!messageSymbol) { // If symbol wasn't in payload, try to get from topic
        const parts = topicName.split('/');
        if (parts.length >= 5 && parts[parts.length - 1] !== '>' && parts[parts.length - 1] !== '*') {
          messageSymbol = parts[parts.length - 1];
          console.log(`[SOLACE_TRACE_DASH] Inferred symbol ${messageSymbol} for market-data topic ${topicName} (payload had no symbol).`);
        }
      }
      console.log(`[SOLACE_TRACE_DASH] Topic is market-data. Type: '${messageType}', Symbol from payload/topic: '${messageSymbol}'`);
    } else if (topicName.startsWith('signal/')) {
      messageType = 'signal';
      if (!messageSymbol) { // If symbol wasn't in payload, try to get from topic
        const parts = topicName.split('/');
        if (parts.length > 1 && parts[0] === 'signal' && parts[1] && parts[1] !== '>' && parts[1] !== '*') {
          messageSymbol = parts[1];
          console.log(`[SOLACE_TRACE_DASH] Inferred symbol ${messageSymbol} for signal topic ${topicName} (payload had no symbol).`);
        }
      }
      console.log(`[SOLACE_TRACE_DASH] Topic is signal. Type: '${messageType}', Symbol from payload/topic: '${messageSymbol}'`);
    } else if (topicName.startsWith('#SYS.') || topicName.startsWith('$SYS.') || topicName.startsWith('SOLACE/CLIENT/')) {
      console.log('[SOLACE_TRACE_DASH] Skipping system-like or client event message from Solace:', topicName, messageType);
      return;
    } else if (messageType === 'twitter' || messageType === 'twitter-feed' || topicName.startsWith('twitter/')) {
      console.log(`[SOLACE_TRACE_DASH] Skipping direct Twitter feed message from Solace topic ${topicName}. Type was ${messageType}`);
      return;
    }
    // If messageType is still not set by topic, it might be an unhandled case or rely purely on payload type
    if (!messageType && parsedPayload?.type) {
        messageType = parsedPayload.type;
        console.log(`[SOLACE_TRACE_DASH] Message type '${messageType}' was derived SOLELY from payload.type for topic ${topicName}`);
    }

    // Fallback for symbol if still not found (e.g. for pure payload-defined messages)
    if (!messageSymbol && parsedPayload?.symbol) {
        messageSymbol = parsedPayload.symbol;
    } else if (!messageSymbol && parsedPayload?.id) {
        messageSymbol = parsedPayload.id;
    }
    
    if (!messageSymbol && !topicName.startsWith('connection/status') && messageType !== 'market-data' && messageType !== 'signal') {
      // Allow market-data and signal to proceed if symbol is missing (could be wildcard, symbol to be confirmed in setLiveStockData)
      // but for other types, if no symbol, it is an issue.
      console.warn(`[SOLACE_TRACE_DASH] Could not determine symbol for UNHANDLED message on topic: ${topicName}, Type: ${messageType}. Payload:`, parsedPayload);
      return;
    }
    
    console.log(`[SOLACE_TRACE_DASH] Identified Message. Type: '${messageType}', Symbol: '${messageSymbol || "N/A"}', Topic: '${topicName}'`);
    setLastUpdated(new Date()); 
        
    setLiveStockData(prevLiveData => {
      console.log(`[SOLACE_TRACE_DASH] setLiveStockData invoked for Symbol: '${messageSymbol || "N/A"}'.`);
      console.log(`[SOLACE_TRACE_DASH] Full previous liveStockData (${prevLiveData.length} items) relevant preview (NVDA, TSE):`, JSON.stringify(prevLiveData.filter(s => s.symbol === 'NVDA' || s.exchange === 'TSE').map(s => ({sym: s.symbol, price: s.currentPrice, sig: s.tradingSignal?.signal}))));
      
      const stockIndex = messageSymbol ? prevLiveData.findIndex(stock => stock.symbol === messageSymbol) : -1;
      let stockToUpdate: StockDataWithMetadata;
      let newEntry = false;

      if (stockIndex !== -1) {
        stockToUpdate = { ...prevLiveData[stockIndex] };
        console.log(`[SOLACE_TRACE_DASH] Found existing stock '${messageSymbol}' at index ${stockIndex}. Previous data:`, JSON.parse(JSON.stringify(stockToUpdate)));
      } else if (messageSymbol) {
        newEntry = true;
        console.log(`[SOLACE_TRACE_DASH] Stock '${messageSymbol}' not found in liveStockData. Creating new entry.`);
        const exchange = getExchangeForStock(messageSymbol);
        const countryCode = getCountryCodeForExchange(exchange);
        const generateNumericId = (str: string): number => { 
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0; 
            }
            return Math.abs(hash);
        };
        stockToUpdate = {
          id: generateNumericId(messageSymbol),
          symbol: messageSymbol,
          companyName: messageSymbol, 
          exchange: exchange,
          country: countryCode,
          currentPrice: null,
          priceChange: null,
          percentChange: null,
          volume: null,
          previousClose: null,
          lastUpdated: new Date().toISOString(),
          individuallySelected: !!selectedStocks.find(s => s.symbol === messageSymbol && s.individuallySelected),
          addedByWildcard: !!selectedStocks.find(s => s.symbol === messageSymbol && s.addedByWildcard),
          selected: !!selectedStocks.find(s => s.symbol === messageSymbol && s.selected),
          tradingSignal: null,
          latestNews: null,
          economicIndicator: null,
          lastTweet: null,
        };
                    } else {
        console.warn('[SOLACE_TRACE_DASH] No messageSymbol, cannot process update within setLiveStockData.');
        return prevLiveData; 
      }
      
      stockToUpdate.lastUpdated = new Date().toISOString(); 

      // Helper function to robustly extract JSON from a string, even if it's embedded.
      const extractJsonFromString = (str: string): any | null => {
        try {
          // First, try to parse the whole string directly.
          return JSON.parse(str);
        } catch (e) {
          // If direct parsing fails, find the first '{' and the last '}'.
          const startIndex = str.indexOf('{');
          const endIndex = str.lastIndexOf('}');
          if (startIndex !== -1 && endIndex > startIndex) {
            const jsonStr = str.substring(startIndex, endIndex + 1);
            try {
              // Try to parse the extracted substring.
              return JSON.parse(jsonStr);
            } catch (e2) {
              // Still failed, give up.
              return null;
            }
          }
        }
        return null;
      };

      if (messageType === 'signal' && topicName.startsWith('signal/')) {
        console.log(`[SOLACE_TRACE_DASH] Processing 'signal' for ${messageSymbol}. Payload:`, actualMessageData);
        if (actualMessageData && typeof actualMessageData === 'object') { 
            const signalPayload = actualMessageData; 
            const signalValue = signalPayload.Signal || signalPayload.signal;
            const confidenceValue = signalPayload.confidence;
            const signalTimestamp = signalPayload.timestamp || messageTimestamp || new Date().toISOString();
            const tweetContentString = signalPayload.body || signalPayload.message || signalPayload.content;
            let actualTweetMessage = tweetContentString;
            let actualSignalFromContent = signalValue;

            if (typeof tweetContentString === 'string') {
                const parsedInnerContent = extractJsonFromString(tweetContentString);
                if (parsedInnerContent) {
                    // Successfully parsed/extracted the object. Now find the message within it.
                    actualTweetMessage = parsedInnerContent.message || parsedInnerContent.content || parsedInnerContent.text || JSON.stringify(parsedInnerContent);
                    if (parsedInnerContent.signal) actualSignalFromContent = parsedInnerContent.signal;
                } else {
                    // Not a JSON string or couldn't be parsed. Assume tweetContentString is the message itself.
                    console.warn(`[SOLACE_TRACE_DASH] Could not parse or extract JSON from content for ${messageSymbol}:`, tweetContentString);
                }
            } else if (typeof tweetContentString === 'object' && tweetContentString !== null) {
                // It's already an object. Find the message within it.
                actualTweetMessage = tweetContentString.message || tweetContentString.content || tweetContentString.text || JSON.stringify(tweetContentString);
                actualSignalFromContent = tweetContentString.signal || actualSignalFromContent;
            }
            
            if (actualSignalFromContent) { 
                stockToUpdate.tradingSignal = {
                    signal: String(actualSignalFromContent), 
                    confidence: typeof confidenceValue === 'number' ? confidenceValue : 0.75, 
                    timestamp: signalTimestamp
                };
                console.log(`[SOLACE_TRACE_DASH] Updated tradingSignal for ${messageSymbol}:`, stockToUpdate.tradingSignal);
                    } else {
              console.warn(`[SOLACE_TRACE_DASH] No actualSignalFromContent for ${messageSymbol}. Creating error signal.`);
              stockToUpdate.tradingSignal = { signal: "Error: No Signal Content", confidence: 0, timestamp: new Date().toISOString() };
            }
            if (actualTweetMessage) {
                stockToUpdate.lastTweet = {
                    content: String(actualTweetMessage),
                    timestamp: signalTimestamp
                };
                console.log(`[SOLACE_TRACE_DASH] Updated lastTweet for ${messageSymbol}:`, stockToUpdate.lastTweet);
            }
                    } else {
             console.warn(`[SOLACE_TRACE_DASH] Signal message for ${messageSymbol}, but payload is not an object or is null. Creating error signal.`);
             stockToUpdate.tradingSignal = { signal: "Error: Invalid Signal Payload", confidence: 0, timestamp: new Date().toISOString() };
        }
      } 
      else if (messageType === 'market-data' && topicName.startsWith('market-data/') && messageSymbol) {
        console.log(`[SOLACE_TRACE_DASH] Processing 'market-data' for ${messageSymbol}. Payload:`, actualMessageData);
        const marketDataPayload = actualMessageData; 
        if (marketDataPayload && typeof marketDataPayload === 'object') {
          console.log(`[SOLACE_TRACE_DASH] Applying market data for ${stockToUpdate.symbol}. Raw:`, JSON.stringify(marketDataPayload));

          if (marketDataPayload.currentPrice !== undefined && marketDataPayload.currentPrice !== null) {
            stockToUpdate.currentPrice = Number(marketDataPayload.currentPrice);
          }
          if (typeof marketDataPayload.percentChange === 'number') {
            stockToUpdate.percentChange = Number(marketDataPayload.percentChange);
            if (typeof stockToUpdate.currentPrice === 'number') {
                const prevPrice = stockToUpdate.currentPrice / (1 + (stockToUpdate.percentChange / 100));
                stockToUpdate.priceChange = stockToUpdate.currentPrice - prevPrice;
            }
          } else if (typeof marketDataPayload.priceChange === 'number') {
            stockToUpdate.priceChange = Number(marketDataPayload.priceChange);
            if (typeof marketDataPayload.previousClose === 'number' && marketDataPayload.previousClose !== 0 && typeof stockToUpdate.currentPrice === 'number') {
                 stockToUpdate.percentChange = ((stockToUpdate.currentPrice - marketDataPayload.previousClose) / marketDataPayload.previousClose) * 100;
            } else if (typeof stockToUpdate.currentPrice === 'number' && stockToUpdate.currentPrice !== Number(marketDataPayload.priceChange)) {
                const inferredPreviousClose = stockToUpdate.currentPrice - Number(marketDataPayload.priceChange);
                if (inferredPreviousClose !== 0) {
                    stockToUpdate.percentChange = (Number(marketDataPayload.priceChange) / inferredPreviousClose) * 100;
                }
            }
          }
          if (marketDataPayload.volume !== undefined) stockToUpdate.volume = Number(marketDataPayload.volume);
          if (marketDataPayload.previousClose !== undefined) stockToUpdate.previousClose = Number(marketDataPayload.previousClose);

          stockToUpdate.currentPrice = typeof stockToUpdate.currentPrice === 'number' ? stockToUpdate.currentPrice : null;
          stockToUpdate.priceChange = typeof stockToUpdate.priceChange === 'number' ? stockToUpdate.priceChange : null;
          stockToUpdate.percentChange = typeof stockToUpdate.percentChange === 'number' ? stockToUpdate.percentChange : null;
          stockToUpdate.volume = typeof stockToUpdate.volume === 'number' ? stockToUpdate.volume : null;
          stockToUpdate.previousClose = typeof stockToUpdate.previousClose === 'number' ? stockToUpdate.previousClose : null;

          console.log(`[SOLACE_TRACE_DASH] Market data applied for ${messageSymbol}. New values: currentPrice=${stockToUpdate.currentPrice}, priceChange=${stockToUpdate.priceChange}, percentChange=${stockToUpdate.percentChange}`);
        } else {
          console.warn(`[SOLACE_TRACE_DASH] Market data for ${messageSymbol} is null, not an object, or critical fields missing.`);
        }
      } 
      else if (topicName && !topicName.startsWith('connection/status')) {
        console.log(`[SOLACE_TRACE_DASH] No specific processing rule for Type: '${messageType}', Symbol: '${messageSymbol || "N/A"}', Topic: '${topicName}'. Payload:`, actualMessageData);
      }
      
      const finalUpdatedData = [...prevLiveData];
      if (newEntry && messageSymbol) { 
        finalUpdatedData.push(stockToUpdate);
        console.log(`[SOLACE_TRACE_DASH] Added new stock '${messageSymbol}' to liveData. Total items: ${finalUpdatedData.length}`);
      } else if (stockIndex !== -1) {
        finalUpdatedData[stockIndex] = stockToUpdate;
        console.log(`[SOLACE_TRACE_DASH] Updated existing stock '${messageSymbol}' in liveData.`);
      }

      console.log(`[SOLACE_TRACE_DASH] END: setLiveStockData for Symbol: '${messageSymbol || "N/A"}'.`);
      console.log(`[SOLACE_TRACE_DASH] Full new liveStockData (${finalUpdatedData.length} items) relevant preview (NVDA, TSE):`, JSON.stringify(finalUpdatedData.filter(s => s.symbol === 'NVDA' || s.exchange === 'TSE').map(s => ({sym: s.symbol, price: s.currentPrice, sig: s.tradingSignal?.signal}))));
      
      prevLiveStockDataRef.current = finalUpdatedData.reduce((acc, stock) => {
        if (stock.symbol) acc[stock.symbol] = stock;
        return acc;
      }, {} as Record<string, StockDataWithMetadata>);

      return finalUpdatedData;
    });
  }, [incomingSolaceMessage, selectedStocks, getExchangeForStock, getCountryCodeForExchange]);
  
  // Helper function to subscribe to stock with exchange info (will use Solace subscribe)
  const subscribeToStock = (symbol: string, exchange: string) => {
    const countryCode = getCountryCodeForExchange(exchange);
    const topicString = `market-data/EQ/${countryCode}/${exchange}/${symbol}`;
    console.log(`Attempting to subscribe to Solace topic: ${topicString}`);
    if (connected) { // 'connected' is Solace direct connection
      subscribe(topicString, 'stock', false) // false for isWildcard
        .then(() => console.log(`Successfully subscribed to Solace topic: ${topicString}`))
        .catch(err => {
          console.error(`Error subscribing to Solace topic ${topicString}:`, err);
          // setSolaceError(err); // REMOVED - error should be set by the hook and caught by solaceConnectionHookError
        });
    } else {
      console.warn(`Solace not connected. Cannot subscribe to ${topicString}`);
    }
  };
  
  // Helper function to unsubscribe from stock with exchange info (will use Solace unsubscribe)
  const unsubscribeFromStock = (symbol: string, exchange: string) => {
    const countryCode = getCountryCodeForExchange(exchange);
    const topicString = `market-data/EQ/${countryCode}/${exchange}/${symbol}`;
    console.log(`Attempting to unsubscribe from Solace topic: ${topicString}`);
    if (connected) { // 'connected' is Solace direct connection
      unsubscribe(topicString, 'stock') // Assuming 'stock' is the type
        .then(() => console.log(`Successfully unsubscribed from Solace topic: ${topicString}`))
        .catch(err => {
          console.error(`Error unsubscribing from Solace topic ${topicString}:`, err);
          // setSolaceError(err); // REMOVED - error should be set by the hook and caught by solaceConnectionHookError
        });
    } else {
      console.warn(`Solace not connected. Cannot unsubscribe from ${topicString}`);
    }
    // UI state updates (selectedStocks, liveStockData) for unsubscription should still happen here or be triggered.
    // For example:
    // setSelectedStocks(prev => prev.filter(s => s.symbol !== symbol && !(s.exchange === exchange && s.addedByWildcard)));
    // setLiveStockData(prev => prev.filter(s => s.symbol !== symbol));
  };
  
  // Using getExchangeForStock defined at the top of the component

  // Handle stock selection changes (mostly for UI state, actual sub/unsub via main effect or direct calls)
  const handleStockSelectionChange = (selection: StockSelection[]) => {
    console.log('[Dashboard LOG] handleStockSelectionChange (intended for bulk updates) received selection:', JSON.stringify(selection.map(s => s.symbol)));
    if (!areStockSelectionsEqual(selectedStocks, selection)) {
      console.log('[Dashboard LOG] handleStockSelectionChange: Applying new selection.');
      setSelectedStocks(selection);
    } else {
      console.log('[Dashboard LOG] handleStockSelectionChange: Selection is the same, no update.');
    }
  };

  // New handler for DataTable's onStockSelectionChange prop
  const handleDataTableRowSelectionChange = (symbol: string, newSelectedState: boolean) => {
    console.log(`[Dashboard LOG] handleDataTableRowSelectionChange: Symbol: ${symbol}, Selected: ${newSelectedState}`);
    setSelectedStocks(prevSelectedStocks => {
      const existingStockIndex = prevSelectedStocks.findIndex(s => s.symbol === symbol);
      let newSelectedStocksList = [...prevSelectedStocks];

      if (newSelectedState) { // Checkbox is checked (stock selected)
        if (existingStockIndex !== -1) {
          // Stock exists, update its selected state and ensure it's marked as individually selected
          newSelectedStocksList[existingStockIndex] = {
            ...newSelectedStocksList[existingStockIndex],
            selected: true,
                individuallySelected: true,
            addedByWildcard: false, // User took explicit action
              };
        } else {
          // Stock doesn't exist, add it. Get details from availableStocks (which is dataFromHook).
          // Note: 'availableStocks' here refers to already fetched/selected data.
          // If the symbol is entirely new, info might be incomplete until a re-fetch.
          const stockInfoFromFetchedData = availableStocks ? availableStocks.find((as: StockDataWithMetadata) => as.symbol === symbol) : undefined;
          const exchange = stockInfoFromFetchedData?.exchange || STOCK_EXCHANGE_MAP[symbol] || 'Unknown';
          const companyName = stockInfoFromFetchedData?.companyName || symbol;
          newSelectedStocksList.push({
            symbol,
            companyName,
            exchange,
            selected: true,
            individuallySelected: true,
            addedByWildcard: false,
          });
        }
      } else { // Checkbox is unchecked (stock deselected)
        if (existingStockIndex !== -1) {
          const stockToUpdate = newSelectedStocksList[existingStockIndex];
          // If it's covered by a wildcard, keep it in the list and selected, but mark as not individually selected
          if (isStockCoveredByWildcard(symbol)) {
            newSelectedStocksList[existingStockIndex] = {
              ...stockToUpdate,
              selected: true, // Still selected due to wildcard
              individuallySelected: false,
              addedByWildcard: true, // It's covered by a wildcard
            };
    } else {
            // Not covered by wildcard, so actually remove it from the list
            newSelectedStocksList.splice(existingStockIndex, 1);
          }
        }
      }
      console.log('[Dashboard LOG] handleDataTableRowSelectionChange newSelectedStocksList:', JSON.stringify(newSelectedStocksList.map(s => s.symbol)));
      return newSelectedStocksList;
    });
  };
  
  // Start simulation when requested - updated to return a Promise
  const handleStartSimulation = async (): Promise<void> => {
    try {
      if (!isSimulating) {
        // Start the simulation
        setIsSimulating(true);
        await startSimulation();
        setLastUpdated(new Date());
        
        toast({
          title: 'Simulation Started',
          description: `Simulating data for ${selectedStocks.length} stocks every ${simulationSettings.updateFrequency}s`
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast({
        title: 'Error Starting Simulation',
        description: errorMessage,
        variant: 'destructive'
      });
      throw error;
    }
  }

  // Handle stopping simulation - separate from start to match interface requirements
  const handleStopSimulation = async (): Promise<void> => {
    try {
      if (isSimulating) {
        // Stop the simulation
        setIsSimulating(false);
        
        // Make sure to call the hook function
        if (stopSimulation) await stopSimulation();
        
        toast({
          title: 'Simulation Stopped',
          description: 'Data simulation has been stopped'
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast({
        title: 'Error Stopping Simulation',
        description: errorMessage,
        variant: 'destructive'
      });
      throw error;
    }
  };
  
  // Function to toggle side panel
  const handleCollapseChange = () => {
    setIsNavCollapsed(prev => !prev);
  };
  
  // Potentially re-evaluate initialSolaceSubscriptions if they are meant for this client
  const initialSolaceSubscriptionsMemo = useMemo(() => { // Renamed to avoid conflict if original is still in useSolaceConnection
    // These are topics this frontend client should subscribe to on connect
    // e.g., global status or notifications, if any.
    // For market data and signals, those are dynamic based on user selection.
    return ['connection/status', 'signal/*']; // ADDED 'signal/*' as a default subscription
  }, []);
  
  // NEW/REVISED useEffect for Solace Subscription Management (placeholder, full logic next)
  useEffect(() => {
    if (!connected) { // `connected` is from useSolaceConnection, for this frontend client
      console.log('Solace (frontend) not connected, skipping Solace subscription management.');
      if (solaceSubscribedTopics.length > 0) {
        console.log('[Solace Sub Man] Clearing local Solace subscribed topics due to disconnect.');
        setSolaceSubscribedTopics([]);
      }
      return;
    }
    console.log('[Solace Sub Man] Solace (frontend) connected, managing Solace topic subscriptions...');

    const desiredSolaceTopics = new Set<string>();
    
    // MOVED UP: Declare active wildcard sets here so they are in scope for overview stock logic
    const activeCountryWildcards = new Set<string>();
    const activeExchangeWildcards = new Set<string>();

    // 1. Add initial/static subscriptions (e.g., connection status)
    initialSolaceSubscriptionsMemo.forEach(topic => desiredSolaceTopics.add(topic));

    // 2. Add Market Data Topics for randomly selected overview stocks
    dynamicTopDisplaySymbols.forEach(symbol => {
      // Do not add if already covered by an active country or exchange wildcard,
      // or if explicitly selected by the user (as that will be handled next).
      // This check is more for optimization; the Set inherently de-duplicates.
      const stockExchange = getExchangeForStock(symbol); // Assumes getExchangeForStock can resolve for any candidate
      const countryCode = getCountryCodeForExchange(stockExchange);
      const isCoveredByCountryWildcard = activeCountryWildcards.has(countryCode);
      const isCoveredByExchangeWildcard = activeExchangeWildcards.has(stockExchange);
      const isSelectedByUser = selectedStocks.some(s => s.symbol === symbol && s.selected);

      if (!isCoveredByCountryWildcard && !isCoveredByExchangeWildcard && !isSelectedByUser) {
        const marketDataTopic = `market-data/EQ/${countryCode}/${stockExchange}/${symbol}`;
        desiredSolaceTopics.add(marketDataTopic);
        console.log(`[Solace Sub Man] Desiring explicit market data topic for OVERVIEW stock ${symbol}: ${marketDataTopic}`);
      }
    });

    // 3. Market Data Topics for user selections and wildcards:
    selectedCountries.forEach(countryId => {
      const wildcardTopic = getWildcardTopicForCountry(countryId);
      if (wildcardTopic) {
        console.log(`[Solace Sub Man] Desiring Solace country market data wildcard for ${countryId}: ${wildcardTopic}`);
        desiredSolaceTopics.add(wildcardTopic);
        activeCountryWildcards.add(countryId); // Now this populates the already declared Set
      }
    });

    selectedExchanges.forEach(exchangeId => {
      const countryCodeOfExchange = getCountryCodeForExchange(exchangeId);
      if (!activeCountryWildcards.has(countryCodeOfExchange)) { // Check against the populated Set
      const wildcardTopic = getWildcardTopicForExchange(exchangeId);
      if (wildcardTopic) {
          console.log(`[Solace Sub Man] Desiring Solace exchange market data wildcard for ${exchangeId}: ${wildcardTopic}`);
          desiredSolaceTopics.add(wildcardTopic);
          activeExchangeWildcards.add(exchangeId); // Now this populates the already declared Set
        }
      } else {
        console.log(`[Solace Sub Man] Skipping exchange wildcard for ${exchangeId} as its country (${countryCodeOfExchange}) is already covered.`);
      }
    });
    
    selectedStocks.forEach(stock => {
      if (stock.selected) {
      const stockExchange = getExchangeForStock(stock.symbol);
      const countryCode = getCountryCodeForExchange(stockExchange);
        const isCoveredByCountryWildcard = activeCountryWildcards.has(countryCode);
        const isCoveredByExchangeWildcard = activeExchangeWildcards.has(stockExchange);
        // Ensure we don't re-add if it was already added for overview panel (Set handles this, but good for clarity)
        if (!isCoveredByCountryWildcard && !isCoveredByExchangeWildcard) {
          const marketDataTopic = `market-data/EQ/${countryCode}/${stockExchange}/${stock.symbol}`;
          desiredSolaceTopics.add(marketDataTopic);
          console.log(`[Solace Sub Man] Desiring explicit market data topic for USER-SELECTED stock ${stock.symbol} (not covered by wildcard): ${marketDataTopic}`);
        } else {
          console.log(`[Solace Sub Man] Skipping explicit market data for ${stock.symbol} as it's covered by an active country/exchange wildcard.`);
        }
      }
    });

    const desiredTopicsArray = Array.from(desiredSolaceTopics);
    console.log('[Solace Sub Man] All desired Solace topics based on refined logic:', desiredTopicsArray);
    
    const currentSolaceSubs = [...solaceSubscribedTopics]; 
    console.log('[Solace Sub Man] Current actual Solace subscribed topics (local state):', currentSolaceSubs);
    
    const topicsToUnsubscribeFrom = currentSolaceSubs.filter((topic: string) => !desiredTopicsArray.includes(topic));
    const topicsToSubscribeTo = desiredTopicsArray.filter((topic: string) => !currentSolaceSubs.includes(topic));
    
    console.log(`[Solace Sub Man] Solace Changes Required: Unsubscribe from ${topicsToUnsubscribeFrom.length} topics, Subscribe to ${topicsToSubscribeTo.length} topics.`);
    if (topicsToUnsubscribeFrom.length > 0) console.log(`[Solace Sub Man] Topics to UNSUBSCRIBE: ${topicsToUnsubscribeFrom.join(', ')}`);
    if (topicsToSubscribeTo.length > 0) console.log(`[Solace Sub Man] Topics to SUBSCRIBE: ${topicsToSubscribeTo.join(', ')}`);

    let subscriptionChanged = false;

    if (topicsToUnsubscribeFrom.length > 0) {
        subscriptionChanged = true;
        topicsToUnsubscribeFrom.forEach((topic: string) => {
            console.log(`  [Solace Sub Man] Unsubscribing from Solace: ${topic}`);
            const type = topic.startsWith('signal/') || topic.startsWith('connection/status') ? 'signal' : 'stock';
            unsubscribe(topic, type)
                .then(() => console.log(`  [Solace Sub Man] Successfully unsubscribed from ${topic}`))
                .catch(err => {
                    console.error(`  [Solace Sub Man] Solace unsubscribe error for ${topic}:`, err);
                });
        });
    }
    
    if (topicsToSubscribeTo.length > 0) {
        subscriptionChanged = true;
        topicsToSubscribeTo.forEach((topic: string) => {
            console.log(`  [Solace Sub Man] Subscribing to Solace: ${topic}`);
            const type = topic.startsWith('signal/') || topic.startsWith('connection/status') ? 'signal' : 'stock';
            const isWildcard = topic.includes('>') || topic.includes('*');
            subscribe(topic, type, isWildcard)
                .then(() => console.log(`  [Solace Sub Man] Successfully subscribed to ${topic}`))
                .catch(err => {
                    console.error(`  [Solace Sub Man] Solace subscribe error for ${topic}:`, err);
                });
        });
    }

    if (subscriptionChanged) {
        console.log('[Solace Sub Man] Updating local solaceSubscribedTopics state to reflect desired state after sub/unsub attempts.');
        setSolaceSubscribedTopics(desiredTopicsArray);
    }

  }, [
    connected, 
    selectedExchanges, 
    selectedCountries, 
    selectedStocks, 
    dynamicTopDisplaySymbols, // Added: overview symbols can trigger subscription changes
    subscribe, 
    unsubscribe, 
    initialSolaceSubscriptionsMemo, 
    solaceSubscribedTopics, // Important: include to re-run if it changes externally or after our updates
    // Utility functions from component scope needed for logic:
    getWildcardTopicForExchange, 
    getWildcardTopicForCountry, 
    getStocksForExchange, 
    getExchangesForCountry,
    getExchangeForStock, 
    getCountryCodeForExchange
  ]);
  
  // Handle simulation settings change
  const handleSimulationSettingsChange = (newSettings: SimulationSettings) => {
    setSimulationSettings(newSettings);
  };
  
  // Handler for Solace connection - updated to return a Promise
  const handleSolaceConnect = async (config: SolaceConnection): Promise<void> => {
    try {
      console.log('[Dashboard Solace] Attempting to connect to Solace with config:', config);
      // Store the current connection config
      setCurrentFrontendConnection(config);
      await connect(config); // connect is from useSolaceConnection; this will trigger 'connected' state change
      // The main useEffect dependent on 'connected' state will handle initial subscriptions like 'signal/*'
        toast({
        title: 'Solace Connection Initiated',
        description: `Attempting to connect to ${config.brokerUrl} / ${config.vpnName}. Status will update shortly.`,
      });
      // REMOVED: Explicit subscribe('signal/*') and setSolaceSubscribedTopics for 'signal/*'
      // REMOVED: console.log('[Dashboard Solace] Subscribed to signal/*');

      // Persist successful config (consider moving this to after 'connected' is true if needed)
      localStorage.setItem('solaceConfig', JSON.stringify(config));
      
    } catch (error: any) {
      console.error('[Dashboard Solace] Connection initiation failed:', error);
      setCurrentFrontendConnection(null); // Clear connection info on failure
        toast({
        title: 'Solace Connection Failed',
        description: error.message || 'Unknown error occurred during connection attempt',
        variant: 'destructive',
      });
    }
  };

  const handleSolaceDisconnect = async (): Promise<void> => {
    try {
      console.log('[Dashboard Solace] Attempting to disconnect from Solace.');

      // Unsubscribe from all topics currently in solaceSubscribedTopics
      if (solaceSubscribedTopics.length > 0) {
        console.log('[Dashboard Solace] Unsubscribing from all known topics:', solaceSubscribedTopics);
        for (const topic of solaceSubscribedTopics) {
          // Determine sessionType based on topic prefix
          const type = topic.startsWith('signal/') || topic.startsWith('connection/status') ? 'signal' : 'stock';
          try {
            console.log(`[Dashboard Solace] Attempting to unsubscribe from: ${topic} (type: ${type})`);
            await unsubscribe(topic, type);
            console.log(`[Dashboard Solace] Successfully unsubscribed from: ${topic}`);
          } catch (unsubError) {
            console.error(`[Dashboard Solace] Error unsubscribing from ${topic}:`, unsubError);
            // Continue trying to unsubscribe from other topics
          }
        }
        // Clear the local tracking state after attempting unsubscriptions
        setSolaceSubscribedTopics([]); 
        console.log('[Dashboard Solace] Cleared local solaceSubscribedTopics state.');
      }

      await disconnect(); // disconnect is from useSolaceConnection, will set 'connected' state to false
      setCurrentFrontendConnection(null); // Clear connection info
        toast({
        title: 'Solace Disconnected',
        description: 'Successfully disconnected from Solace.',
      });
      // Clear persisted config on explicit disconnect
      localStorage.removeItem('solaceConfig');
    } catch (error: any) {
      console.error('[Dashboard Solace] Disconnection failed:', error);
        toast({
        title: 'Solace Disconnection Failed',
        description: error.message || 'Unknown error occurred',
        variant: 'destructive',
      });
    }
  };
  
  // Handler for starting market data feed (example, ensure it returns Promise<void>)
  const handleStartMarketDataFeed = async () => {
    if (startMarketDataFeed) {
    try {
      await startMarketDataFeed();
        toast({ title: "Market Data Feed", description: "Attempting to start market data feed..." });
      } catch (error: any) {
        toast({ title: "Error", description: `Failed to start market data feed: ${error.message}`, variant: "destructive" });
      }
    }
  };

  // Handler for stopping market data feed (example, ensure it returns Promise<void>)
  const handleStopMarketDataFeed = async () => {
    if (stopMarketDataFeed) {
    try {
      await stopMarketDataFeed();
        // Toast is handled by the mutation's onSuccess/onError
      } catch (error: any) {
        // Error toast is also handled by mutation's onError, but can have a fallback here if needed
        toast({ title: "Error", description: `Failed to stop market data feed: ${error.message}`, variant: "destructive" });
      }
    }
  };
  
  // Handler for updating market data feed options
  const handleUpdateMarketDataFeedOptions = async (options: UpdateOptionsParams) => {
    if (updateMarketDataFeedOptions) {
      try {
        await updateMarketDataFeedOptions(options);
        // Toast is handled by the mutation's onSuccess/onError
      } catch (error: any) {
        toast({ title: "Error", description: `Failed to update market data options: ${error.message}`, variant: "destructive" });
      }
    }
  };

  // Handler for starting Twitter feed (example, ensure it returns Promise<void>)
  const handleStartTwitterFeed = async () => {
    if (startTwitterFeed) {
      try {
        // Pass appropriate params if needed, e.g., selected stocks for Twitter
        const currentSymbols = selectedStocks.map(s => s.symbol);
        await startTwitterFeed({ symbols: currentSymbols }); 
        toast({ title: "Twitter Feed", description: "Attempting to start Twitter feed..." });
      } catch (error: any) {
        toast({ title: "Error", description: `Failed to start Twitter feed: ${error.message}`, variant: "destructive" });
      }
    }
  };

  // Handler for stopping Twitter feed (example, ensure it returns Promise<void>)
  const handleStopTwitterFeed = async () => {
    if (stopTwitterFeed) {
      try {
        await stopTwitterFeed();
        // Toast is handled by the mutation's onSuccess/onError
      } catch (error: any) {
        toast({ title: "Error", description: `Failed to stop Twitter feed: ${error.message}`, variant: "destructive" });
      }
    }
  };

  // Handler for updating Twitter feed options
  const handleUpdateTwitterFeedOptions = async (options: UpdateOptionsParams) => {
    if (updateTwitterFeedOptions) {
      try {
        await updateTwitterFeedOptions(options);
        // Toast is handled by the mutation's onSuccess/onError
      } catch (error: any) {
        toast({ title: "Error", description: `Failed to update Twitter options: ${error.message}`, variant: "destructive" });
      }
    }
  };
  
  // UI should display both API-loaded data and live Solace data
  const displayStockData = useMemo(() => {
    console.log('[Dashboard LOG] displayStockData recalculating. liveStockData symbols:', JSON.stringify(liveStockData.map(s=>s.symbol)), 'selectedStocks symbols:', JSON.stringify(selectedStocks.map(s=>s.symbol)));
    
    // The DataTable should ONLY show stocks that are in the selectedStocks array.
    // We then enrich these selected stocks with the latest live data.
    const dataToDisplay = selectedStocks.map(selection => {
      const liveDataItem = liveStockData.find(live => live.symbol === selection.symbol);
      if (liveDataItem) {
        // If live data exists, merge it with selection flags
        return {
          ...liveDataItem,
          selected: selection.selected, // This should always be true if it's in selectedStocks and meant for display
          individuallySelected: selection.individuallySelected,
          addedByWildcard: selection.addedByWildcard,
        };
      } else {
        // If no live data yet (e.g., just selected, waiting for Solace message or API poll for initial data),
        // return a basic structure based on the selection, so it appears in the table.
        const generateNumericId = (str: string): number => { 
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0; 
            }
            return Math.abs(hash);
        };
        return {
          id: generateNumericId(selection.symbol),
          symbol: selection.symbol,
          companyName: selection.companyName || selection.symbol,
          exchange: selection.exchange || STOCK_EXCHANGE_MAP[selection.symbol] || 'N/A',
          country: getCountryCodeForExchange(selection.exchange || STOCK_EXCHANGE_MAP[selection.symbol] || 'N/A'),
          currentPrice: null,
          priceChange: null,
          percentChange: null,
          volume: null,
          previousClose: null,
          lastUpdated: new Date().toISOString(), // Or perhaps null/undefined until data arrives
          selected: selection.selected,
          individuallySelected: selection.individuallySelected,
          addedByWildcard: selection.addedByWildcard,
          tradingSignal: null,
          latestNews: null,
          economicIndicator: null,
          lastTweet: null,
        } as StockDataWithMetadata;
      }
    }).filter(stock => stock.selected); // Ensure only actually selected items are passed to DataTable

    console.log(`[SOLACE_TRACE_DASH displayStockData] OUTPUT dataToDisplay for DataTable (${dataToDisplay.length} items):`, JSON.stringify(dataToDisplay.map(s => ({ sym: s.symbol, selected: s.selected, indSel: s.individuallySelected, addWild: s.addedByWildcard }))));
    return dataToDisplay;

  }, [liveStockData, selectedStocks, getCountryCodeForExchange]); // Removed selectedExchanges, selectedCountries, getExchangeForStock as they are implicitly handled via selectedStocks structure
  
  /**
   * Update the Twitter feed active symbols based on currently visible stocks
   * This syncs the Twitter publisher with stocks that might come from wildcards
   * Always update the symbol list regardless of feed status so it's ready when feed is activated
   */
  const updateTwitterFeedSymbols = async () => {
    // We'll still try to update even if disconnected - symbols will be stored for later activation
    if (!connected) {
      console.log('Warning: Updating Twitter feed symbols while disconnected - changes will be queued for reconnection');
    }

    try {
      // Get visible stocks by directly using displayStockData
      // This ensures we include stocks from both direct selection and wildcard filters
      const visibleStocks = displayStockData ? displayStockData : [];
      
      const activeSymbols = visibleStocks.map(stock => stock.symbol);
      
      if (twitterStatus?.feedActive) {
        console.log(`Updating active Twitter feed with ${activeSymbols.length} visible symbols:`, activeSymbols);
      } else {
        console.log(`Storing ${activeSymbols.length} symbols for future Twitter feed activation:`, activeSymbols);
      }
      
      if (activeSymbols.length === 0) {
        console.log('No visible stocks to update Twitter feed with');
        return;
      }
      
      // Include wildcard information to help server better manage topics
      console.log(`Sending update with wildcards - Exchanges: ${selectedExchanges.join(', ')}, Countries: ${selectedCountries.join(', ')}`);
      
      // Call the API endpoint to update active symbols with retry logic
      const maxRetries = 3;
      let retryCount = 0;
      let success = false;
      
      while (retryCount < maxRetries && !success) {
        try {
          const response = await fetch('/api/twitter-feed/update-symbols', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              symbols: activeSymbols,
              wildcards: {
                exchanges: selectedExchanges,
                countries: selectedCountries
              }
            })
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to update Twitter feed symbols (attempt ${retryCount + 1}/${maxRetries}):`, errorText);
            retryCount++;
            
            if (retryCount < maxRetries) {
              console.log(`Retrying in ${retryCount * 1000}ms...`);
              await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
            }
          } else {
            const result = await response.json();
            success = true;
            console.log('Twitter feed symbols updated successfully:', result);
          }
        } catch (error) {
          console.error(`Error during Twitter feed update attempt ${retryCount + 1}:`, error);
          retryCount++;
          
          if (retryCount < maxRetries) {
            console.log(`Retrying in ${retryCount * 1000}ms after error...`);
            await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
          }
        }
      }
      
      if (!success) {
        console.error(`Failed to update Twitter feed symbols after ${maxRetries} attempts`);
      }
    } catch (error) {
      console.error('Error in Twitter feed symbol update process:', error);
    }
  };
  
  // Add a useEffect to keep Twitter feed symbols in sync with exchange/country filters
  useEffect(() => {
    // When exchanges or countries change, we need to update the Twitter feed symbols
    // to ensure new stocks added through wildcards are included
    if (twitterStatus?.feedActive) {
      console.log('Exchange or country filters changed, updating Twitter feed symbols');
      updateTwitterFeedSymbols();
    }
  }, [selectedExchanges, selectedCountries, twitterStatus?.feedActive]);
  
  // Monitor connection state to ensure Twitter feed symbols are updated on reconnection
  useEffect(() => {
    // When the connection state changes to connected, update Twitter feed symbols
    if (connected && twitterStatus?.feedActive) {
      console.log('Connection established or restored while Twitter feed is active, syncing symbols');
      updateTwitterFeedSymbols();
    }
  }, [connected, twitterStatus?.feedActive]);
  
  // Monitor displayStockData to ensure Twitter feed symbols stay in sync with visible stocks
  // This is especially important when wildcard subscriptions bring in new stocks
  useEffect(() => {
    // Only update if feed is active and we have displayed stocks
    if (twitterStatus?.feedActive && displayStockData && displayStockData.length > 0) {
      // Use a debounce approach to avoid too many rapid updates
      const timer = setTimeout(() => {
        console.log('Display stock data changed while Twitter feed is active, syncing symbols');
        updateTwitterFeedSymbols();
      }, 1000); // Delay by 1 second to batch rapid changes
      
      return () => clearTimeout(timer);
    }
  }, [displayStockData, twitterStatus?.feedActive]);
  
  // Handler for forcing a Twitter tweet with improved validation
  const handleForceTweet = async (symbol: string) => {
    if (!connected) {
      toast({
        title: 'Connection Required',
        description: 'Please connect to Solace before generating tweets',
        variant: 'destructive'
      });
      return;
    }
    
    // Check if the symbol is in our visible stocks (including those added via wildcards)
    // This is more accurate than just checking selectedStocks
    const isVisible = displayStockData?.some(s => s.symbol === symbol) || false;
    
    if (!isVisible) {
      toast({
        title: 'Stock Not Displayed',
        description: `Stock ${symbol} is not displayed in the data table. Please ensure it's visible before generating tweets.`,
        variant: 'destructive'
      });
      return;
    }
    
    try {
      console.log(`Forcing tweet generation for symbol: ${symbol}`);
      
      // First, ensure the Twitter service is enabled
      const enableResponse = await fetch('/api/twitter-feed/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'start',
          symbols: [symbol],
          frequency: 60
        })
      });
      
      if (!enableResponse.ok) {
        console.warn("Warning: Twitter service may not be fully enabled:", await enableResponse.text());
      }
      
      // Call API endpoint to force a tweet
      const response = await fetch('/api/twitter-feed/force-tweet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ symbol })
      });
      
      if (response.ok) {
        const data = await response.json();
        
        toast({
          title: 'Tweet Generated',
          description: `A new tweet for ${symbol} has been generated and published`
        });
        
        // The tweet will come back through the WebSocket
        setLastUpdated(new Date());
        
        // Log the response for debugging
        console.log('Force tweet response:', data);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to generate tweet');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Error forcing tweet:', errorMessage);
      
      toast({
        title: 'Error Generating Tweet',
        description: errorMessage || 'Failed to generate tweet',
        variant: 'destructive'
      });
    }
  };
  
  // Handle bulk stock selection change from ConfigPanel
  const [displayedStocks, setDisplayedStocks] = useState<StockSelection[]>([]);

  // Memoized and sorted version of selectedStocks for ConfigPanel prop
  // This ensures that the prop reference only changes if the content (sorted) changes
  const configPanelStocks = useMemo(() => {
    return [...selectedStocks].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [selectedStocks]);

  // This useEffect ensures that displayedStocks is updated whenever selectedStocks changes
  useEffect(() => {
    setDisplayedStocks(selectedStocks);
  }, [selectedStocks]);

  const handleConfigPanelStockChange = (newSelectionFromPanel: StockSelection[]): void => {
    console.log('[Dashboard LOG] handleConfigPanelStockChange received selection:', JSON.stringify(newSelectionFromPanel.map(s => s.symbol)));
    
    const sortedNewStocksFromPanel = [...newSelectionFromPanel].sort((a, b) => a.symbol.localeCompare(b.symbol));

    setSelectedStocks(prevSelectedStocks => {
      const sortedPrevSelectedStocks = [...prevSelectedStocks].sort((a, b) => a.symbol.localeCompare(b.symbol));

      if (areStockSelectionsEqual(sortedNewStocksFromPanel, sortedPrevSelectedStocks)) {
        console.log("[Dashboard DEBUG] handleConfigPanelStockChange - Stocks from panel are identical to current state. No update.");
        return prevSelectedStocks;
      }

      console.log("[Dashboard DEBUG] handleConfigPanelStockChange - Stocks differ, proceeding with update.");

      const stocksToAdd = sortedNewStocksFromPanel.filter(
        (newStock) => !sortedPrevSelectedStocks.some((s) => s.symbol === newStock.symbol)
      );
      const stocksToRemove = sortedPrevSelectedStocks.filter(
        (oldStock) => !sortedNewStocksFromPanel.some((s) => s.symbol === oldStock.symbol)
      );

      if (stocksToRemove.length > 0) {
        console.log(`Handling removal of ${stocksToRemove.length} stocks from ConfigPanel`);
        stocksToRemove.forEach(stockToRemove => { // Renamed to stockToRemove for clarity
        if (stockToRemove.symbol) { // Use stockToRemove
            // const stockExchange = stockToRemove.exchange || getExchangeForStock(stockToRemove.symbol); // getExchangeForStock is in scope
            // Unsubscription is handled by the main Solace subscription useEffect when selectedStocks changes.
            
            setLiveStockData(prevData => prevData.filter(s => s.symbol !== stockToRemove.symbol)); 
        }
      });
    }

      if (stocksToAdd.length > 0) {
        console.log(`Handling addition of ${stocksToAdd.length} stocks from ConfigPanel`);
        stocksToAdd.forEach(stockToAdd => { // Renamed to stockToAdd for clarity
        if (stockToAdd.symbol) { // Use stockToAdd
          const stockExchangeForAdded = stockToAdd.exchange || getExchangeForStock(stockToAdd.symbol); // Renamed variable
          const isExchangeSelectedForAdded = selectedExchanges.includes(stockExchangeForAdded); // Renamed variable
          
            setLiveStockData(prevData => { // Changed from prevLiveData
              const stockExists = prevData.some(s => s.symbol === stockToAdd.symbol);
            if (stockExists) {
                return prevData.map(s => 
                s.symbol === stockToAdd.symbol 
                    ? { ...s, individuallySelected: true, addedByWildcard: isExchangeSelectedForAdded } 
                  : s
              );
            } else {
              const countryCode = getCountryCodeForExchange(stockExchangeForAdded);
              const generateNumericId = (str: string): number => {
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                  hash = ((hash << 5) - hash) + str.charCodeAt(i);
                    hash |= 0;
                }
                  return Math.abs(hash);
              };
                const newWsStock: StockDataWithMetadata = {
                id: generateNumericId(stockToAdd.symbol),
                symbol: stockToAdd.symbol,
                  companyName: stockToAdd.companyName || stockToAdd.symbol,
                exchange: stockExchangeForAdded, // Use stockExchangeForAdded
                country: countryCode,
                  currentPrice: null,
                  percentChange: null,
                lastUpdated: new Date().toISOString(),
                individuallySelected: true,
                addedByWildcard: isExchangeSelectedForAdded, // Use isExchangeSelectedForAdded
                tradingSignal: null,
                latestNews: null,
                  economicIndicator: null,
                  lastTweet: null,
              };
                return [...prevData, newWsStock];
            }
          });
          
          // Subscription is handled by the main Solace subscription useEffect when selectedStocks changes.
        }
      });
    }
    
      if (stocksToAdd.length > 0 || stocksToRemove.length > 0) {
        updateTwitterFeedSymbols(); 
      }

      return sortedNewStocksFromPanel;
    });
  };

  // Helper function to get all selected stocks for a specific exchange (used for wildcard unsub)
  const getSelectedStocksForExchange = (exchangeId: string): StockSelection[] => {
    return selectedStocks.filter(stock => stock.exchange === exchangeId);
  };

  // Handler for forcing a trading signal
  const handleForceSignal = async (symbol: string) => {
    if (!connected) { // 'connected' is Solace direct connection
      toast({
        title: 'Connection Required',
        description: 'Please connect to Solace before generating signals',
        variant: 'destructive'
      });
      return;
    }
    
    try {
      // Generate a trading signal
      const signals = ['Buy', 'Sell', 'Hold', 'Strong Buy', 'Strong Sell'];
      const signal = signals[Math.floor(Math.random() * signals.length)];
      const confidence = (Math.random() * 0.5 + 0.5).toFixed(2); // 0.5-1.0
      
      // Create a message to publish
      const message = {
        type: 'signal',
        symbol,
        data: {
          Signal: signal,
          confidence: parseFloat(confidence),
          timestamp: new Date().toISOString()
        }
      };
      
      // NEW: Call backend API to force signal, backend will publish to Solace
      try {
        console.log(`Requesting backend to publish signal for ${symbol} with payload:`, message);
        const response = await fetch('/api/solace/force-signal', { // Ensure this API endpoint exists on your backend
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ symbol: symbol, signalPayload: message }), // Backend can decide the Solace topic
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Failed to force signal, unknown API error' }));
            throw new Error(errorData.message || 'Failed to force signal via API');
        }
        const responseData = await response.json();
        console.log('Force signal API response:', responseData); // Log backend's response
        
        toast({
          title: 'Signal Generation Requested',
          description: `Request to generate ${signal} signal for ${symbol} sent to backend. It will appear shortly via Solace.`
        });
        // setLastUpdated(new Date()); // Data will update when Solace message for this signal arrives
      } catch (apiError) {
          console.error('Error calling force signal API:', apiError);
          const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
          toast({
            title: 'Error Requesting Signal Generation',
            description: errorMessage,
            variant: 'destructive',
          });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast({
        title: 'Error Generating Signal',
        description: errorMessage || 'Failed to generate signal',
        variant: 'destructive'
      });
    }
  };
  
  const toggleConfigPanel = () => {
    setIsConfigPanelHidden(!isConfigPanelHidden);
  };

  const toggleTopicExplorer = () => {
    setIsTopicExplorerOpen(!isTopicExplorerOpen);
  };

  // Memoized value for available stocks to prevent re-renders if it hasn't changed
  const memoizedAvailableStocks = useMemo(() => availableStocks || [], [availableStocks]);
  console.log("[Dashboard RENDER] memoizedAvailableStocks for FiltersPanel:", memoizedAvailableStocks);
  
  const handleBackendConnect = async (config: SolaceConnection): Promise<void> => {
                try {
                  setBackendConnecting(true);
      console.log("[Dashboard] Connecting to backend Solace with config:", config);
      // Assuming apiRequest is set up for this
      await apiRequest("POST", "/api/solace/connect", { ...config, configType: "backend" }); // Swapped method and URL
      console.log("[Dashboard] Backend connection successful.");
                  setBackendConnected(true);
      toast({
        title: "Backend Connected",
        description: "Successfully connected to the backend Solace broker.",
      });
                } catch (error) {
      console.error("[Dashboard] Backend connection error:", error);
                  toast({
                    title: "Backend Connection Error",
                    description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
      throw error; // Re-throw to allow ConfigPanel to handle its state
    } finally {
      setBackendConnecting(false);
    }
  };

  const handleBackendDisconnect = async (): Promise<void> => {
    try {
      setBackendConnecting(true); // Indicate disconnecting activity
      console.log("[Dashboard] Disconnecting from backend Solace");
      await apiRequest("POST", "/api/solace/disconnect", { configType: "backend" }); // Swapped method and URL
      console.log("[Dashboard] Backend disconnection successful.");
                  setBackendConnected(false);
      toast({
        title: "Backend Disconnected",
        description: "Successfully disconnected from the backend Solace broker.",
      });
                } catch (error) {
      console.error("[Dashboard] Backend disconnect error:", error);
                  toast({
                    title: "Backend Disconnect Error",
                    description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
      throw error; // Re-throw to allow ConfigPanel to handle its state
    } finally {
      setBackendConnecting(false);
    }
  };

  // Render the dashboard
  return (
    <div className="dashboard-container flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* NEW BRANDING BANNER - Fixed background and text color for consistent appearance */}
      <div className="p-2 bg-gradient-to-r from-[#004d40] to-[#00695c] text-gray-100 shadow-md flex items-center justify-between space-x-4"> {/* Changed p-4 to p-2 */}
        <div className="flex items-center space-x-2"> {/* Changed space-x-4 to space-x-2 */}
          <img src={dashboardIcon} alt="Dashboard Icon" className="h-24 w-24 mt-2" /> {/* Added mt-2 */}
          <div>
            <h1 className="text-3xl font-bold">El SolCapital Trading Dashboard</h1>
            <div className="flex items-center text-base mt-1">
              <span>Powered by&nbsp;</span>
              <img src={solaceLogo} alt="Solace Logo" className="h-4 relative top-[-1px]" /> 
              <span className="ml-1">Event Mesh</span>
              <span className="ml-1"> / Built by AI</span>
            </div>
          </div>
        </div>
        {/* Grouped Icon Buttons */}
        <div className="flex items-center space-x-2"> {/* Added a div to group buttons and control their spacing */}
          {/* Event Portal Button - Moved to be first in the group */}
          <a
            href="https://solace-sso.solace.cloud/ep/designer/domains/b0gt448qjwh/graph?domainName=Demothon-SKO-2026"
            target="_blank"
            rel="noopener noreferrer"
            title="Open Solace Event Portal"
            // className="ml-2" // Removed ml-2, parent div will handle spacing
          >
            <Button 
              variant="outline"
              size="icon" 
              className="bg-transparent hover:bg-gray-100/20 text-gray-100 hover:text-white border-gray-100/50 hover:border-white p-2"
            >
              <img src={eventPortalIcon} alt="Event Portal" className="h-5 w-5" />
            </Button>
          </a>
          {/* Topic Explorer Button - Now second in the group */}
          <Button 
            variant="outline"
            size="icon" 
            onClick={toggleTopicExplorer}
            className="bg-transparent hover:bg-gray-100/20 text-gray-100 hover:text-white border-gray-100/50 hover:border-white p-2"
            title="Open Solace Topic Explorer"
          >
            <img src={topicExplorerIcon} alt="Topic Explorer" className="h-5 w-5" /> {/* Use img tag for the icon */}
          </Button>
        </div>
      </div>

      {/* Topic Explorer Modal */}
      <TopicExplorerModal 
        isOpen={isTopicExplorerOpen} 
        onClose={toggleTopicExplorer} 
        connectionDetails={currentFrontendConnection}
      />

      <div className="flex flex-1 min-h-0"> {/* Added min-h-0 to ensure child flex containers can scroll */}
        {/* Config Panel Wrapper - controls visibility */}
        <div
          className={`transition-all duration-300 ease-in-out relative \
                      ${isConfigPanelHidden ? 'w-0 min-w-0' : 'w-1/4 min-w-[380px] max-w-[500px]'}`}
        >
          {!isConfigPanelHidden && (
            <div className="h-full bg-card text-card-foreground border-r border-border overflow-y-auto p-1">
              <ConfigPanel
                connected={connected}
                connecting={connecting}
                backendConnected={backendConnected}
                backendConnecting={backendConnecting}
                connectionStatus={connectionStatus || undefined}
                twitterStatus={twitterStatus || undefined}
                publisherStatus={publisherStatus || undefined}
                onConnect={handleSolaceConnect}
                onDisconnect={handleSolaceDisconnect}
                onBackendConnect={handleBackendConnect}
                onBackendDisconnect={handleBackendDisconnect}
                selectedStocks={selectedStocks}
                onStockSelectionChange={handleConfigPanelStockChange} // Use the new handler
                simulationSettings={simulationSettings}
                onSimulationSettingsChange={handleSimulationSettingsChange}
                isSimulating={isSimulating}
                onStartSimulation={handleStartSimulation}
                onStopSimulation={handleStopSimulation}
                onStartMarketDataFeed={handleStartMarketDataFeed}
                onStopMarketDataFeed={handleStopMarketDataFeed}
                onUpdateMarketDataFeedOptions={handleUpdateMarketDataFeedOptions}
                onStartTwitterFeed={handleStartTwitterFeed}
                onStopTwitterFeed={handleStopTwitterFeed}
                onUpdateTwitterFeedOptions={handleUpdateTwitterFeedOptions}
                // No isCollapsed prop needed for ConfigPanel itself anymore, managed by Dashboard
              />
            </div>
          )}
        </div>

        {/* Main Content Area with Toggle Button */}
        <div className="flex-1 flex flex-col bg-background text-foreground relative overflow-y-auto"> 
          {/* Toggle Button for Config Panel - Adjusted Positioning and Styling */}
          <Button
            // variant="outline" // Removed variant outline
            size="icon"
            className="absolute top-2 left-2 z-50 bg-primary hover:bg-primary/90 text-primary-foreground" // Applied primary button styling
            onClick={toggleConfigPanel}
            title={isConfigPanelHidden ? "Show Config Panel" : "Hide Config Panel"}
          >
            {isConfigPanelHidden ? <PanelRightClose className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </Button>

          {/* Filters and Data Table container (ensure it starts below the button or provide padding) */}
          <div className="flex flex-1 overflow-hidden pt-12"> {/* pt-12 to make space for the button */}
            <div className="flex-1 flex flex-col overflow-hidden p-4">
        <StatusBar 
          marketDataActive={publisherStatus?.feedActive || false}
          twitterFeedActive={twitterStatus?.feedActive || false}
                  signalDataActive={false} // TODO: Determine how to show signal activity with direct Solace
          lastUpdated={lastUpdated}
                  solaceConnected={connected} // Ensure this is solaceConnected
        />
        <main className="flex-1 p-4 overflow-y-auto">
            <MarketOverviewPanel 
              topSecuritiesData={topSecuritiesForOverview} // Use derived data
              isLoading={loadingStockData} // Use main loading state
              error={stockDataError ? "Error fetching stock data" : null} // Use main error state
            />
            {/* Ensure no console.log here */}
            <FiltersPanel 
              selectedExchanges={selectedExchanges}
              onExchangeSelectionChange={handleExchangeSelection}
              selectedCountries={selectedCountries}
              onCountrySelectionChange={handleCountrySelection}
              availableStocks={allMarketStocks} // Use allMarketStocks now
              className="bg-transparent border-none"
            />
            <DataTable 
                  data={displayStockData} 
              isLoading={loadingStockData}
                    error={stockDataError || !!solaceConnectionHookError} // CORRECTED: Ensure boolean for error prop
                  onStockSelectionChange={handleDataTableRowSelectionChange} 
              onClearAllStocks={() => {
                console.log('===== CLEAR ALL: Beginning cleanup of subscriptions =====');
              console.log('Current state: ' + JSON.stringify(selectedStocks.map(s => s.symbol)));
              // ... rest of clear all logic ...
              }}
              selectedStocks={selectedStocks || []}
              onForceTweet={handleForceTweet}
              onForceSignal={handleForceSignal}
              selectedExchanges={selectedExchanges}
              selectedCountries={selectedCountries}
            />
        </main>
            </div>
          </div>
        </div>
          </div>
    </div>
  );
} // This closes the Dashboard component


