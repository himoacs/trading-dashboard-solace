import { useState, useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { 
  SimulationSettings, 
  SolaceConnection, 
  solaceConnectionSchema, 
  StockSelection
} from "@shared/schema";
import { UpdateOptionsParams } from "../hooks/useSolaceConnectionStatus";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { ChevronDown, ChevronUp, Search, X, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import ConnectionStatusDisplay, { ConnectionStatusInfo } from "./ConnectionStatusDisplay";
import { areStockSelectionsEqual } from '../utils/stockUtils';
import { useSolaceConnection } from '../hooks/useSolaceConnection';
import TrafficGeneratorPanel from "./TrafficGeneratorPanel";
import { BrokerConfig } from "../types/generatorTypes";

interface ConfigPanelProps {
  connected: boolean;
  connecting: boolean;
  backendConnected?: boolean;
  backendConnecting?: boolean;
  connectionStatus?: ConnectionStatusInfo;
  twitterStatus?: ConnectionStatusInfo;
  publisherStatus?: ConnectionStatusInfo;
  onConnect: (config: SolaceConnection) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onBackendConnect?: (config: SolaceConnection) => Promise<void>;
  onBackendDisconnect?: () => Promise<void>;
  selectedStocks: StockSelection[];
  onStockSelectionChange: (stocks: StockSelection[]) => void;
  onStockSelection?: (symbol: string, selected: boolean) => void;
  simulationSettings: SimulationSettings;
  onSimulationSettingsChange: (settings: SimulationSettings) => void;
  isSimulating: boolean;
  onStartSimulation: () => Promise<void>;
  onStopSimulation: () => Promise<void>;
  onStartMarketDataFeed?: () => Promise<void>;
  onStopMarketDataFeed?: () => Promise<void>;
  onUpdateMarketDataFeedOptions?: (options: UpdateOptionsParams) => Promise<void>;
  onStartTwitterFeed?: () => Promise<void>;
  onStopTwitterFeed?: () => Promise<void>;
  onUpdateTwitterFeedOptions?: (options: UpdateOptionsParams) => Promise<void>;
  isCollapsed?: boolean;
}

export default function ConfigPanel({
  connected,
  connecting,
  backendConnected = false,
  backendConnecting = false,
  connectionStatus,
  twitterStatus,
  publisherStatus,
  onConnect,
  onDisconnect,
  onBackendConnect,
  onBackendDisconnect,
  selectedStocks,
  onStockSelectionChange,
  onStockSelection,
  simulationSettings,
  onSimulationSettingsChange,
  isSimulating,
  onStartSimulation,
  onStopSimulation,
  onStartMarketDataFeed,
  onStopMarketDataFeed,
  onUpdateMarketDataFeedOptions,
  onStartTwitterFeed,
  onStopTwitterFeed,
  onUpdateTwitterFeedOptions,
  isCollapsed = false
}: ConfigPanelProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [connectionSectionCollapsed, setConnectionSectionCollapsed] = useState(false);
  const [useSameBroker, setUseSameBroker] = useState(false);
  
  // Local state for selected stocks, derived from props
  // Sort by symbol to ensure consistent order for comparison
  const [localSelectedStocks, setLocalSelectedStocks] = useState<StockSelection[]>(
    [...selectedStocks].sort((a, b) => a.symbol.localeCompare(b.symbol))
  );
  
  // Backend Solace Connection Form with dummy tcp://host:port placeholder
  const backendConnectionForm = useForm<SolaceConnection>({
    resolver: zodResolver(solaceConnectionSchema),
    defaultValues: {
      brokerUrl: "",
      vpnName: "",
      username: "",
      password: "",
      configType: "backend"
    }
  });
  
  // Memoize statusInfo objects to prevent unnecessary re-renders of ConnectionStatusDisplay
  const memoizedConnectionStatus = useMemo(() => connectionStatus, [connectionStatus]);
  const memoizedTwitterStatus = useMemo(() => twitterStatus, [twitterStatus]);
  const memoizedPublisherStatus = useMemo(() => publisherStatus, [publisherStatus]);
  
  const defaultConnectionStatusInfo: ConnectionStatusInfo = {
    connected: false,
    connecting: false,
    feedActive: false,
    feedStarting: false,
    lastError: "",
    currentConfig: null,
    tcpPort: undefined,
    frequency: 0.1,
    frequencyMs: 100,
    messageOptions: {
      deliveryMode: "DIRECT",
      allowMessageEliding: true,
      dmqEligible: true,
    },
  };
  
  const getDisplayStatusInfo = (baseStatus?: ConnectionStatusInfo, serviceLabel?: string): ConnectionStatusInfo => {
    const defaults = { ...defaultConnectionStatusInfo };
    if (backendConnected && backendConnectionForm.formState.isSubmitted) {
      const backendConfig = backendConnectionForm.getValues();
      defaults.currentConfig = {
        brokerUrl: backendConfig.brokerUrl,
        vpnName: backendConfig.vpnName,
        username: backendConfig.username, // Viser disse?
        password: '', // Viser aldri passord
        configType: backendConfig.configType,
      };
    }
    
    let mergedStatus = {
      ...defaults,
      ...(baseStatus || {}), // Merge baseStatus, ensuring it's at least an empty object
      currentConfig: baseStatus?.currentConfig ?? defaults.currentConfig,
    };

    // Service-specific adjustments
    if (serviceLabel && serviceLabel.includes("Market Data Publisher")) {
      // If frequencyMs is NOT provided by baseStatus (the actual status from the hook), default it to 500 for Market Data Publisher
      if (baseStatus?.frequencyMs === undefined) {
        mergedStatus.frequencyMs = 500;
      }
      // Always ensure frequency (seconds) is derived from frequencyMs
      // At this point, mergedStatus.frequencyMs is guaranteed to be a number for Market Data Publisher.
      const currentFrequencyMs = mergedStatus.frequencyMs as number;
      mergedStatus.frequency = Math.round(currentFrequencyMs / 1000);
      
      // Disable message eliding by default for Market Data Publisher
      // Provide a fallback for baseMsgOpts to satisfy the linter, matching the structure of messageOptions.
      const baseMsgOpts = defaultConnectionStatusInfo.messageOptions ?? { deliveryMode: "DIRECT", allowMessageEliding: true, dmqEligible: true };
      const providedMsgOpts = mergedStatus.messageOptions;

      mergedStatus.messageOptions = {
        deliveryMode: providedMsgOpts?.deliveryMode ?? baseMsgOpts.deliveryMode,
        allowMessageEliding: false, // Explicitly set for Market Data Publisher
        dmqEligible: providedMsgOpts?.dmqEligible ?? baseMsgOpts.dmqEligible,
      };
      
      // If frequency was explicitly provided by baseStatus and frequencyMs was not,
      // this scenario is less likely for market data now, but we ensure consistency if it happens.
      // However, the above block (baseStatus?.frequencyMs === undefined) should handle the primary default case.
      if (baseStatus?.frequency !== undefined && baseStatus?.frequencyMs === undefined) {
        // This recalculates frequencyMs if only frequency (seconds) was given,
        // but it would be immediately overwritten by the block above if baseStatus.frequencyMs was truly undefined.
        // For safety, if baseStatus provides 'frequency' but not 'frequencyMs', let's prioritize that for calculation.
        // This state is a bit contradictory if baseStatus.frequencyMs is undefined and baseStatus.frequency is defined.
        // Given the new logic, we primarily rely on defaulting frequencyMs to 500 if not present in baseStatus.
      }

    } else {
      // For other services (e.g., Twitter)
      // If frequencyMs is missing but frequency (seconds) is there, calculate it.
      if (mergedStatus.frequencyMs === undefined && mergedStatus.frequency !== undefined) {
        mergedStatus.frequencyMs = mergedStatus.frequency * 1000;
      } 
      // If frequencyMs is there but frequency (seconds) is missing, calculate it.
      else if (mergedStatus.frequencyMs !== undefined && mergedStatus.frequency === undefined) {
        // Ensure frequencyMs is a number before using it for calculation
        const currentTwitterFrequencyMs = mergedStatus.frequencyMs ?? defaults.frequencyMs;
        mergedStatus.frequency = Math.round(currentTwitterFrequencyMs / 1000);
      }
      // If neither are defined (e.g. for a new service or incomplete default), they'll take from defaultConnectionStatusInfo
    }
    return mergedStatus;
  };

  const displayPublisherStatus = useMemo(() => getDisplayStatusInfo(memoizedPublisherStatus, "Market Data Publisher"), [memoizedPublisherStatus, backendConnected, backendConnectionForm.formState.isSubmitted, backendConnectionForm.getValues()]);
  const displayTwitterStatus = useMemo(() => getDisplayStatusInfo(memoizedTwitterStatus, "Twitter Feed Publisher"), [memoizedTwitterStatus, backendConnected, backendConnectionForm.formState.isSubmitted, backendConnectionForm.getValues()]);

  // Frontend Solace Connection Form
  const connectionForm = useForm<SolaceConnection>({
    resolver: zodResolver(solaceConnectionSchema),
    defaultValues: {
      brokerUrl: "ws://localhost:8008",
      vpnName: "default",
      username: "demo",
      password: "demo",
      configType: "frontend"
    }
  });
  
  // Start with the backend connection panel expanded when not connected
  const [backendConnectionSectionCollapsed, setBackendConnectionSectionCollapsed] = useState(false);

  // Watch frontend form values for syncing with backend when useSameBroker is enabled
  const frontendFormValues = connectionForm.watch();

  // Sync backend form with frontend form when "use same broker" is enabled
  useEffect(() => {
    if (useSameBroker && !backendConnected) {
      const frontendValues = connectionForm.getValues();
      // Use the same WebSocket URL for backend traffic generators (browser-native)
      backendConnectionForm.reset({
        brokerUrl: frontendValues.brokerUrl,
        vpnName: frontendValues.vpnName,
        username: frontendValues.username,
        password: frontendValues.password,
        configType: "backend"
      });
    }
  }, [useSameBroker, frontendFormValues, backendConnected]);

  // Get available stocks for selection
  const { data: availableStocks = [], isLoading: loadingStocks } = useQuery<StockSelection[]>({
    queryKey: ['/api/stocks/available'],
  });
  
  // Ensure all stock objects are properly structured before filtering
  const safeAvailableStocks = (availableStocks || []).map(stock => ({
    ...stock,
    symbol: stock.symbol || '',
    companyName: stock.companyName || '',
    exchange: stock.exchange || '',
    selected: !!stock.selected
  }));
  
  // const stockList = useStore(state => state.stockList); // This line seems unused now, can be removed if not needed elsewhere
  // const { solaceSession } = useSolaceConnection(); // This line seems unused now, can be removed if not needed elsewhere

  const excludedSymbols = ['SPX', 'DJI', 'NDX', 'HSI']; // Define the list of excluded symbols

  const filteredStocks = useMemo(() => {
    if (!safeAvailableStocks) return [];
    const lowerSearchTerm = searchQuery.toLowerCase();
    // Define a set of specific index symbols to exclude, ensuring case-insensitivity by checking uppercase version
    const excludedIndexSymbols = new Set(["SPX", "DJI", "NDX", "HSI", "FTSE"]);

    return safeAvailableStocks
      .filter((stock) => {
        const upperSymbol = stock.symbol.toUpperCase();
        return (
          !stock.symbol.startsWith("^") && // General index filter (e.g., ^IXIC)
          !stock.symbol.includes(".") && // Other potential index/suffix filter
          !excludedIndexSymbols.has(upperSymbol) && // Specific index filter (SPX, DJI, etc.)
          (stock.symbol.toLowerCase().includes(lowerSearchTerm) ||
            (stock.companyName && stock.companyName.toLowerCase().includes(lowerSearchTerm)))
        );
      })
      .slice(0, 100);
  }, [safeAvailableStocks, searchQuery]);

  // Don't auto-collapse the panel when connecting
  // We only collapse the connection section inside the panel
  
  // Effect to expand the backend connection panel and set initial defaults when frontend is connected,
  // backend is not already connected, and the backend form has not been manually edited by the user.
  useEffect(() => {
    if (connected && !backendConnected && !backendConnectionForm.formState.isDirty) {
      // When frontend connection is established, auto-expand the backend section
      setBackendConnectionSectionCollapsed(false);
      
      // Only set default values if backend is not already connected and form is not dirty
      // to avoid overwriting user input or established connection details.
      console.log("[ConfigPanel] Frontend connected. Backend section expanded. Backend form values will not be reset by this effect.");
    } else {
      if (connected && backendConnectionForm.formState.isDirty) {
        console.log("[ConfigPanel] Frontend connected, but backend form is dirty. Not overriding backend defaults.");
      }
    }
  }, [connected, backendConnected, backendConnectionForm.formState.isDirty, backendConnectionForm]); // Added backendConnectionForm.formState.isDirty to dependencies

  // Effect to update localSelectedStocks when the selectedStocks prop changes
  useEffect(() => {
    // Use the new utility for robust comparison
    // This effect should ONLY run if the selectedStocks prop itself has changed.
    if (!areStockSelectionsEqual(selectedStocks, localSelectedStocks)) {
      console.log("[ConfigPanel DEBUG] Props selectedStocks changed, updating localSelectedStocks. New:", selectedStocks, "Old:", localSelectedStocks);
      // Sort before setting local state to maintain consistency internally
      setLocalSelectedStocks([...selectedStocks].sort((a, b) => a.symbol.localeCompare(b.symbol)));
    }
    // NOTE: localSelectedStocks is intentionally NOT in the dependency array here.
    // This hook is meant to react to changes in the `selectedStocks` prop from the parent (Dashboard).
    // If localSelectedStocks were included, updates to it from within ConfigPanel (e.g., checkbox changes that call onStockSelectionChange)
    // could trigger this effect again, potentially leading to loops if not handled carefully.
    // The comparison with areStockSelectionsEqual should prevent unnecessary updates if the prop hasn't meaningfully changed.
  }, [selectedStocks]);

  // Handle frontend connection submission
  const handleConnectionSubmit = async (data: SolaceConnection) => {
    if (connected) {
      await onDisconnect();
      // Reset form data after disconnection
      connectionForm.reset({
        brokerUrl: data.brokerUrl,
        vpnName: data.vpnName,
        username: data.username,
        password: data.password,
        configType: "frontend"
      });
      // Expand the connection section after disconnect
      setConnectionSectionCollapsed(false);
    } else {
      // Add the configType to ensure it's set as frontend
      await onConnect({...data, configType: "frontend"});
      // Collapse the connection section after successful connect
      setConnectionSectionCollapsed(true);
      // Auto-expand the backend connection section
      setBackendConnectionSectionCollapsed(false);
    }
  };
  
  // Handle backend connection submission
  const handleBackendConnectionSubmit = async (data: SolaceConnection) => {
    // Parse port from brokerUrl if present and set tcpPort
    let brokerUrl = data.brokerUrl;
    let tcpPort: string | undefined = undefined;
    try {
      // Remove protocol if present
      let urlNoProto = brokerUrl.replace(/^\w+:\/\//, '');
      // Split host:port
      const parts = urlNoProto.split(':');
      if (parts.length === 2) {
        // e.g. localhost:55554
        brokerUrl = parts[0];
        tcpPort = parts[1];
      } else if (parts.length === 3 && brokerUrl.startsWith('[')) {
        // IPv6 [::1]:55554
        brokerUrl = parts[0] + ':' + parts[1];
        tcpPort = parts[2];
      } else {
        // No port specified
        brokerUrl = urlNoProto;
      }
    } catch (e) {
      // fallback: do nothing
    }
    if (backendConnected && onBackendDisconnect) {
      await onBackendDisconnect();
      // Reset form data after disconnection
      backendConnectionForm.reset({
        brokerUrl: data.brokerUrl,
        vpnName: data.vpnName,
        username: data.username,
        password: data.password,
        configType: "backend"
      });
      // Expand the backend connection section after disconnect
      setBackendConnectionSectionCollapsed(false);
    } else if (onBackendConnect) {
      // Add the configType to ensure it's set as backend, and set tcpPort if found
      await onBackendConnect({
        ...data,
        brokerUrl,
        tcpPort,
        configType: "backend"
      });
      // Collapse the backend connection section after successful connect
      setBackendConnectionSectionCollapsed(true);
    }
  };

  // Handle stock selection
  const handleAddStock = (stock: StockSelection) => {
    if (!selectedStocks.find(s => s.symbol === stock.symbol)) {
      // Add the stock with individuallySelected flag set to true
      const newSelectedStocks = [...selectedStocks, {
        ...stock,
        individuallySelected: true,
        selected: true // ensure selected is true
      }];
      // Sort before passing up
      onStockSelectionChange(newSelectedStocks.sort((a, b) => a.symbol.localeCompare(b.symbol)));
    }
  };

  const handleRemoveStock = (symbol: string) => {
    const newSelectedStocks = selectedStocks.filter(s => s.symbol !== symbol);
    // Sort before passing up
    onStockSelectionChange(newSelectedStocks.sort((a, b) => a.symbol.localeCompare(b.symbol)));
  };

  // Handler for checkbox changes on individual stocks within the ConfigPanel
  const handleStockCheckboxChange = (symbol: string, checked: boolean) => {
    let updatedStocks;
    if (checked) {
      const stockToAdd = availableStocks.find(s => s.symbol === symbol);
      // Use localSelectedStocks for current state before modification
      if (stockToAdd && !localSelectedStocks.find(s => s.symbol === symbol)) {
        updatedStocks = [...localSelectedStocks, { ...stockToAdd, selected: true, individuallySelected: true }];
      } else {
        // If already present, ensure it's marked selected and individuallySelected
        updatedStocks = localSelectedStocks.map(s => s.symbol === symbol ? { ...s, selected: true, individuallySelected: true } : s);
      }
    } else {
      // Use localSelectedStocks for current state before modification
      updatedStocks = localSelectedStocks.filter(s => s.symbol !== symbol);
      }
    if (updatedStocks) {
      // Sort before passing up to the parent
      const sortedUpdatedStocks = updatedStocks.sort((a,b) => a.symbol.localeCompare(b.symbol));
      // setLocalSelectedStocks(sortedUpdatedStocks); // Let useEffect handle this from prop change
      onStockSelectionChange(sortedUpdatedStocks); // Notify parent
    }
  };

  const handleClearAllStocks = () => {
    // No need to sort an empty array
    onStockSelectionChange([]);
  };

  // Handle simulation frequency change
  const handleFrequencyChange = (value: number[]) => {
    onSimulationSettingsChange({
      ...simulationSettings,
      updateFrequency: value[0]
    });
  };

  return (
    <aside className="bg-card text-card-foreground border-r border flex-shrink-0 h-full overflow-hidden">
      <div className={`p-4 ${isCollapsed ? 'hidden' : 'block'} overflow-y-auto h-full space-y-6`}>
        {/* Frontend Solace Connection Section */}
        <div className="mb-0">
          <div 
            className="flex justify-between items-center cursor-pointer mb-2" 
            onClick={() => setConnectionSectionCollapsed(!connectionSectionCollapsed)}
          >
            <h2 className="text-xl font-semibold text-foreground mt-2">
              Solace Connection {connected && <span className="text-sm text-green-500 ml-2">(Connected)</span>}
            </h2>
            {connectionSectionCollapsed ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          
          {!connectionSectionCollapsed && (
            <>
              {/* Connection status displays */}
              {connectionForm.formState.isSubmitted && (connectionStatus || connecting) && (
                <div className="mt-4">
                  <ConnectionStatusDisplay
                    serviceLabel="Broker Connection"
                    statusInfo={memoizedConnectionStatus || { connected: false, connecting: false }}
                  />
                </div>
              )}
              
              <Form {...connectionForm}>
                <form onSubmit={connectionForm.handleSubmit(handleConnectionSubmit)} className="space-y-4">
                  <FormField
                    control={connectionForm.control}
                    name="brokerUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-muted-foreground">Broker URL</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="ws://localhost:8080"
                            className={`font-mono text-sm bg-input text-foreground ${!field.value ? 'placeholder:text-muted-foreground' : ''}`}
                            disabled={connected}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={connectionForm.control}
                    name="vpnName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-muted-foreground">Message VPN</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="default"
                            className={`font-mono text-sm bg-input text-foreground ${!field.value ? 'placeholder:text-muted-foreground' : ''}`}
                            disabled={connected}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={connectionForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-muted-foreground">Username</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="solace-client"
                            className={`font-mono text-sm bg-input text-foreground ${!field.value ? 'placeholder:text-muted-foreground' : ''}`}
                            disabled={connected}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={connectionForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-muted-foreground">Password</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="password" 
                            placeholder="••••••••"
                            className={`font-mono text-sm bg-input text-foreground ${!field.value ? 'placeholder:text-muted-foreground' : ''}`}
                            disabled={connected}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <Button 
                    type="submit" 
                    className={`w-full ${connected ? 'bg-destructive hover:bg-red-600' : 'bg-primary hover:bg-primary/90'}`}
                    disabled={connecting}
                  >
                    {connecting ? 'Connecting...' : connected ? 'Disconnect' : 'Connect'}
                  </Button>
                </form>
              </Form>
            </>
          )}
        </div>
        
        {/* Traffic Generators Section - separate from Solace Connection */}
        {connected && (
          <div className="mb-0">
            <TrafficGeneratorPanel
              brokerConfig={{
                url: connectionForm.getValues('brokerUrl'),
                vpnName: connectionForm.getValues('vpnName'),
                username: connectionForm.getValues('username'),
                password: connectionForm.getValues('password'),
              } as BrokerConfig}
              className=""
            />
          </div>
        )}
          
        {/* Stock Selection Section */}
        <div className="mb-0">
          <h2 className="text-base font-semibold mb-2 block text-foreground">Stock Selection</h2>
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search stocks (e.g., AAPL, TSLA)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 w-full"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {searchQuery && (
            <div className="border border-border rounded-md max-h-60 overflow-y-auto bg-card shadow-sm">
              {loadingStocks ? (
                <p className="p-3 text-sm text-muted-foreground">Loading...</p>
              ) : filteredStocks.length > 0 ? (
                filteredStocks.slice(0, 50).map((stock) => (
                  <div
                    key={stock.symbol}
                    className="flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer border-b border-border last:border-b-0"
                    onClick={() => handleAddStock(stock)}
                  >
                    <div>
                      <span className="font-medium text-sm">{stock.symbol}</span>
                      <span className="text-xs text-muted-foreground ml-2 truncate">
                        {stock.companyName}
                      </span>
                    </div>
                    <Button variant="ghost" size="sm" className="text-primary hover:text-primary/90">
                      <Plus className="h-4 w-4 mr-1" /> Add
                    </Button>
                  </div>
                ))
              ) : (
                <p className="p-3 text-sm text-muted-foreground">No stocks found.</p>
              )}
            </div>
          )}
        </div>

        {/* Selected Stocks Box - Positioned AFTER search section */}
        <div className="border border-border rounded-md overflow-hidden mb-0">
          <div className="bg-muted px-3 py-2 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Selected Stocks</span>
              <Button variant="outline" size="sm" onClick={handleClearAllStocks} className="text-xs">
                Clear All
              </Button>
            </div>
          </div>
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1">
            {localSelectedStocks.length > 0 ? (
              localSelectedStocks.map((stock) => (
                <div
                  key={stock.symbol}
                  className="flex items-center justify-between p-2 mx-1 rounded-md hover:bg-muted/50"
                >
                  <div className="flex items-center">
                    <Checkbox
                      id={`stock-${stock.symbol}`}
                      checked={stock.selected}
                      onCheckedChange={(checked) => handleStockCheckboxChange(stock.symbol, !!checked)}
                      className="mr-2"
                    />
                    <label htmlFor={`stock-${stock.symbol}`} className="text-sm cursor-pointer">
                      <span className="font-medium">{stock.symbol}</span>
                      {stock.companyName && (
                        <span className="text-xs text-muted-foreground ml-1 truncate">
                          ({stock.companyName})
                        </span>
                      )}
                    </label>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveStock(stock.symbol)}
                    className="h-7 w-7"
                  >
                    <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="p-3 text-xs text-muted-foreground text-center">No stocks selected yet.</p>
            )}
          </div>
        </div>

        {/* Simulation Settings */}
        <div className="space-y-3 mb-0">
          {/* ... other settings ... */}
        </div>
        
        {/* Spacer to push connect buttons to bottom */}
        <div className="flex-grow"></div>

        {/* Connect/Disconnect Buttons */}
        {/* ... (Connect/Disconnect buttons for Frontend and Backend - should be at the very bottom) ... */}
      </div>
    </aside>
  );
}