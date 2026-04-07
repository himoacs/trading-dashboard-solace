import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  SimulationSettings, 
  StockDataWithMetadata, 
  StockSelection 
} from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { useSolaceConnection } from './useSolaceConnection';

export function useStockData(
  selectedStocks: StockSelection[],
  simulationSettings: SimulationSettings
) {
  const queryClient = useQueryClient();
  const [simulationActive, setSimulationActive] = useState(false);
  const { connected: isSolaceConnected } = useSolaceConnection();

  // Convert selected stocks to symbols array for API requests
  const symbols = selectedStocks.map(stock => stock.symbol);

  // Fetch stock data
  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<StockDataWithMetadata[]>({
    queryKey: ['/api/market-data', symbols.join(',')],
    enabled: symbols.length > 0 && simulationActive,
    refetchInterval: simulationActive ? simulationSettings.updateFrequency * 1000 : false,
    queryFn: async () => {
      if (symbols.length === 0) return [];
      console.log('Fetching market data for symbols:', symbols.join(','));
      const url = `/api/market-data?symbols=${encodeURIComponent(symbols.join(','))}`;
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json();
        console.error('API error:', error);
        throw new Error(`Failed to fetch market data: ${error.message || 'Unknown error'}`);
      }
      return response.json();
    }
  });

  // Start simulation
  const startSimulation = async () => {
    if (symbols.length === 0) return;
    
    // Verify Solace connection before starting simulation
    if (!isSolaceConnected) {
      throw new Error("No active Solace connection. Please configure Solace connection before starting simulation.");
    }
    
    try {
      console.log('Starting simulation with Solace for symbols:', symbols);
      
      const response = await apiRequest('POST', '/api/simulation/start', {
        symbols,
        // Include subscription settings to enable all data types
        subscription: {
          marketData: true,
          twitterFeed: true,
          signalData: true,
          newsFeed: true,
          economicData: true
        },
        updateFrequency: simulationSettings.updateFrequency
      });
      
      setSimulationActive(true);
      await refetch();
      return response;
    } catch (error: any) {
      console.error('Failed to start simulation:', error);
      
      // Get the error message from the response if available
      let errorMessage = "Failed to start simulation";
      if (error.json && typeof error.json === 'object') {
        errorMessage = error.json.message || errorMessage;
      }
      
      // Create a better error with the message from the server
      const enhancedError = new Error(errorMessage);
      
      // Add additional info to the error
      (enhancedError as any).originalError = error;
      (enhancedError as any).isSolaceConnectionError = 
        errorMessage.includes("No active Solace connection") || 
        errorMessage.includes("Please configure Solace connection");
      
      throw enhancedError;
    }
  };

  // Stop simulation
  const stopSimulation = async () => {
    try {
      console.log('Stopping simulation for symbols:', symbols);
      await apiRequest('POST', '/api/simulation/stop');
      setSimulationActive(false);
    } catch (error) {
      console.error('Failed to stop simulation:', error);
      throw error;
    }
  };

  // Effect to handle stock selection changes during active simulation
  useEffect(() => {
    // Only proceed if simulation is active and we have a valid Solace connection
    if (!simulationActive || !isSolaceConnected) return;
    
    // If symbols change during active simulation, restart simulation with new symbols
    const restartSimulation = async () => {
      try {
        console.log('Stock selection changed during active simulation, restarting with new symbols:', symbols);
        
        // First stop existing simulation
        await apiRequest('POST', '/api/simulation/stop');
        
        // Then start a new one with updated symbols
        await apiRequest('POST', '/api/simulation/start', {
          symbols,
          subscription: {
            marketData: true,
            twitterFeed: true,
            signalData: true,
            newsFeed: true,
            economicData: true
          },
          updateFrequency: simulationSettings.updateFrequency
        });
        
        await refetch();
      } catch (error) {
        console.error('Failed to restart simulation after symbol changes:', error);
      }
    };
    
    restartSimulation();
  }, [symbols, simulationActive, isSolaceConnected, refetch, simulationSettings.updateFrequency]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (simulationActive) {
        console.log('Component unmounting, stopping simulation');
        apiRequest('POST', '/api/simulation/stop').catch(console.error);
      }
    };
  }, [simulationActive]);

  return {
    data,
    isLoading,
    isError,
    error,
    startSimulation,
    stopSimulation,
    simulationActive
  };
}
