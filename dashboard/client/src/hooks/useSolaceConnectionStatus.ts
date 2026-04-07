import React from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
// import { fetchWrapper, ApiResponse } from "../lib/utils"; // Removed unused import
import { toast } from "./use-toast";
import { SolaceConnection } from "@shared/schema";

export interface ConnectionStatusInfo {
  connected: boolean;
  connecting: boolean;
  feedActive: boolean;
  feedStarting?: boolean;
  lastError?: string;
  currentConfig?: SolaceConnection | null;
  tcpPort?: string;
  frequency?: number;
  frequencyMs?: number;
  messageOptions?: {
    deliveryMode: "DIRECT" | "PERSISTENT";
    allowMessageEliding: boolean;
    dmqEligible: boolean;
  };
  updateFrequency?: number; 
  activeSymbols?: string[]; 
}

export interface SolaceStatusResponse {
  success: boolean;
  frontend: boolean;
  publisher: boolean;
  twitter: boolean;
  connecting: boolean;
  publisherTcpPort?: string;
  twitterTcpPort?: string;
  lastError?: string;
  connectionStatus: ConnectionStatusInfo;
  publisherStatus: ConnectionStatusInfo;
  twitterStatus: ConnectionStatusInfo;
}

interface StopMarketDataFeedResponse {
  success: boolean;
  message: string;
  publisherStatus: ConnectionStatusInfo;
  feedActive: boolean; 
}

interface StopTwitterFeedResponse {
  success: boolean;
  message: string;
  previousActiveSymbols?: string[];
  twitterStatus: ConnectionStatusInfo;
  serviceStatus?: any; 
  feedActive: boolean;
}

interface StartFeedResponse {
  success: boolean;
  message: string;
  status?: Partial<ConnectionStatusInfo> & { feedActive?: boolean };
  feedActive?: boolean;
  publisherStatus?: ConnectionStatusInfo;
  twitterStatus?: ConnectionStatusInfo;  
  activeSymbols?: string[];
  frequency?: number;
  frequencyMs?: number;
}

export interface UpdateOptionsParams {
  deliveryMode?: "DIRECT" | "PERSISTENT";
  allowMessageEliding?: boolean;
  dmqEligible?: boolean;
  frequency?: number;
  frequencyMs?: number;
}

interface UpdateMarketDataOptionsResponse {
  success: boolean;
  message: string;
  publisherStatus: ConnectionStatusInfo;
  frequency?: number;
  frequencyMs?: number;
  options?: UpdateOptionsParams;
}

interface UpdateTwitterOptionsResponse {
  success: boolean;
  message: string;
  twitterStatus: ConnectionStatusInfo;
  frequency?: number;
  frequencyMs?: number;
  options?: UpdateOptionsParams;
}

interface TwitterStartParams {
  symbols?: string[];
  frequency?: number;
}

const defaultStatus: ConnectionStatusInfo = {
  connected: false,
  connecting: false,
  feedActive: false,
  feedStarting: false,
  lastError: "",
  currentConfig: null,
  tcpPort: undefined,
  frequency: 0.1, // Default to 0.1 seconds
  frequencyMs: 100, // Default to 100 ms
  messageOptions: {
    deliveryMode: "DIRECT",
    allowMessageEliding: true,
    dmqEligible: true,
  },
};

export function useSolaceConnectionStatus() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<SolaceStatusResponse>({
    queryKey: ['/api/solace/status'],
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
  });
  
  React.useEffect(() => {
    if (data) {
      console.log("Connection status poll success:", {
        publisher: data.publisherStatus?.feedActive,
        twitter: data.twitterStatus?.feedActive,
        time: new Date().toISOString()
      });
    }
  }, [data]);

  const memoizedConnectionStatus = React.useMemo(() => {
    return data?.connectionStatus || defaultStatus;
  }, [
    data?.connectionStatus?.connected,
    data?.connectionStatus?.connecting,
    data?.connectionStatus?.feedActive,
    data?.connectionStatus?.lastError,
    data?.connectionStatus?.currentConfig?.brokerUrl,
    data?.connectionStatus?.currentConfig?.vpnName,
    data?.connectionStatus?.currentConfig?.username,
  ]);

  const memoizedPublisherStatus = React.useMemo(() => {
    return data?.publisherStatus || defaultStatus;
  }, [
    data?.publisherStatus?.connected,
    data?.publisherStatus?.connecting,
    data?.publisherStatus?.feedActive,
    data?.publisherStatus?.feedStarting,
    data?.publisherStatus?.lastError,
    data?.publisherStatus?.tcpPort,
    data?.publisherStatus?.frequencyMs,
    data?.publisherStatus?.messageOptions?.deliveryMode,
    data?.publisherStatus?.messageOptions?.allowMessageEliding,
    data?.publisherStatus?.messageOptions?.dmqEligible,
    JSON.stringify((data?.publisherStatus?.activeSymbols || []).slice().sort()),
    data?.publisherStatus?.currentConfig?.brokerUrl,
    data?.publisherStatus?.currentConfig?.vpnName,
    data?.publisherStatus?.currentConfig?.username,
  ]);

  const memoizedTwitterStatus = React.useMemo(() => {
    return data?.twitterStatus || defaultStatus;
  }, [
    data?.twitterStatus?.connected,
    data?.twitterStatus?.connecting,
    data?.twitterStatus?.feedActive,
    data?.twitterStatus?.feedStarting,
    data?.twitterStatus?.lastError,
    data?.twitterStatus?.tcpPort,
    data?.twitterStatus?.frequencyMs,
    data?.twitterStatus?.messageOptions?.deliveryMode,
    data?.twitterStatus?.messageOptions?.allowMessageEliding,
    data?.twitterStatus?.messageOptions?.dmqEligible,
    JSON.stringify((data?.twitterStatus?.activeSymbols || []).slice().sort()),
    data?.twitterStatus?.currentConfig?.brokerUrl,
    data?.twitterStatus?.currentConfig?.vpnName,
    data?.twitterStatus?.currentConfig?.username,
  ]);

  const startMarketDataFeed = useMutation<StartFeedResponse, Error, void>({
    mutationFn: async () => {
      console.log("Starting market data feed...");
      
      try {
        const response = await fetch('/api/market-data-feed/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          console.error("Failed to start market data feed:", errorData);
          throw new Error(errorData.message || 'Failed to start market data feed');
        }
        
        const result = await response.json();
        console.log("Market data feed started successfully:", result);
        return result;
      } catch (error) {
        console.error("Error starting market data feed:", error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log("Market data feed start succeeded, invalidating queries", data);
      console.log("Market data feed start response feedActive:", data.feedActive);
      console.log("Market data feed start response publisherStatus:", data.publisherStatus);
      
      setTimeout(() => refetch(), 100);
      queryClient.invalidateQueries({ queryKey: ['/api/solace/status'] });
      toast({ title: "Market Data Feed", description: data.message || "Feed started." });
    },
    onError: (error) => {
      console.error("Market data feed start failed:", error);
    }
  });

  const stopMarketDataFeed = useMutation<StopMarketDataFeedResponse, Error, void>({
    mutationFn: async () => {
      console.log("Stopping market data feed...");
        const response = await fetch('/api/market-data-feed/stop', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to stop market data feed');
        }
      return response.json();
    },
    onSuccess: (data: StopMarketDataFeedResponse) => {
      console.log("Market data feed stop succeeded.", data);
      queryClient.setQueryData<SolaceStatusResponse>(['/api/solace/status'], (oldQueryData) => {
        if (oldQueryData) {
          return {
            ...oldQueryData,
            publisherStatus: {
              ...(oldQueryData.publisherStatus || defaultStatus),
              ...data.publisherStatus,
              feedActive: data.publisherStatus.feedActive,
            },
          };
        }
        return oldQueryData;
      });
      queryClient.invalidateQueries({ queryKey: ['/api/solace/status'] });
      toast({ title: "Market Data Feed", description: "Market data feed stopped." });
    },
    onError: (error) => {
      console.error("Market data feed stop failed:", error);
    }
  });

  const updateMarketDataFeedOptions = useMutation<UpdateMarketDataOptionsResponse, Error, UpdateOptionsParams>({
    mutationFn: async (options: UpdateOptionsParams) => {
      const payload = {
        ...options,
        frequencyMs: options.frequencyMs ?? (options.frequency ? options.frequency * 1000 : undefined)
      };
      if (payload.frequencyMs && payload.frequency) {
        delete payload.frequency;
      }

      const response = await fetch('/api/market-data-feed/message-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update market data options');
      }
      return response.json();
    },
    onSuccess: (data: UpdateMarketDataOptionsResponse) => {
      toast({ title: "Market Data Feed", description: data.message || "Options updated successfully." });
      queryClient.setQueryData<SolaceStatusResponse>(['/api/solace/status'], (oldQueryData) => {
        if (oldQueryData) {
          if (!data.publisherStatus) {
            return oldQueryData; // Return old data if publisherStatus is missing
          }

          const oldPubStatus = oldQueryData.publisherStatus || defaultStatus;
          const newPubStatusFromServer = data.publisherStatus;

          // Preserve old messageOptions if new ones are not provided
          const resolvedMessageOptions =
            newPubStatusFromServer.messageOptions // If new options exist from server
            ? newPubStatusFromServer.messageOptions // THEN use them
            : oldPubStatus.messageOptions; // ELSE (if server didn't send messageOptions) use old options

          // Preserve old frequencyMs if new one is not provided or is identical
          const resolvedFrequencyMs =
            newPubStatusFromServer.frequencyMs !== undefined && newPubStatusFromServer.frequencyMs !== oldPubStatus.frequencyMs
            ? newPubStatusFromServer.frequencyMs
            : oldPubStatus.frequencyMs;
            
          const resolvedFrequency = resolvedFrequencyMs !== undefined ? Math.round(resolvedFrequencyMs / 1000) : oldPubStatus.frequency;

          const newData = {
            ...oldQueryData,
            publisherStatus: {
              ...oldPubStatus, // Base on old or default
              ...newPubStatusFromServer, // Overlay with whatever came from server (like feedActive, connected)
              messageOptions: resolvedMessageOptions, // Explicitly set the resolved stable messageOptions
              frequencyMs: resolvedFrequencyMs, // Explicitly set the resolved stable frequencyMs
              frequency: resolvedFrequency, // Update frequency (seconds) based on resolvedFrequencyMs
            },
          };
          return newData;
        }
        return oldQueryData;
      });
      queryClient.invalidateQueries({ queryKey: ['/api/solace/status'] }); 
    },
    onError: (error: Error) => {
      console.error("Mutation error in updateMarketDataFeedOptions:", error.message);
      toast({ title: "Error", description: `Failed to update market data options: ${error.message}`, variant: "destructive" });
    }
  });

  // Twitter feed is now browser-native via TrafficGeneratorPanel
  // These mutations are kept as no-ops for compatibility
  const startTwitterFeed = useMutation<StartFeedResponse, Error, TwitterStartParams | void>({
    mutationFn: async () => {
      // Twitter feed is now browser-native
      toast({ 
        title: "Use Traffic Generator", 
        description: "Twitter feed is now controlled via the Traffic Generator panel in the sidebar." 
      });
      return { success: true, message: "Twitter feed is now browser-native" } as StartFeedResponse;
    },
    onSuccess: () => {
      console.log("Twitter feed is now browser-native via TrafficGeneratorPanel");
    }
  });

  const stopTwitterFeed = useMutation<StopTwitterFeedResponse, Error, void>({
    mutationFn: async () => {
      // Twitter feed is now browser-native
      toast({ 
        title: "Use Traffic Generator", 
        description: "Twitter feed is now controlled via the Traffic Generator panel in the sidebar." 
      });
      return { success: true, message: "Twitter feed is now browser-native", twitterStatus: defaultStatus } as StopTwitterFeedResponse;
    },
    onSuccess: () => {
      console.log("Twitter feed is now browser-native via TrafficGeneratorPanel");
    }
  });

  const updateTwitterFeedOptions = useMutation<UpdateTwitterOptionsResponse, Error, UpdateOptionsParams>({
    mutationFn: async () => {
      // Twitter feed is now browser-native
      toast({ 
        title: "Use Traffic Generator", 
        description: "Twitter feed options are now controlled via the Traffic Generator panel." 
      });
      return { success: true, message: "Twitter feed is now browser-native", twitterStatus: defaultStatus } as UpdateTwitterOptionsResponse;
    },
    onSuccess: () => {
      console.log("Twitter feed options are now browser-native via TrafficGeneratorPanel");
    }
  });

  return {
    isLoading,
    error,
    refetch,
    frontend: data?.frontend || false,
    publisher: data?.publisher || false,
    twitter: data?.twitter || false,
    connecting: data?.connecting || false,
    connectionStatus: memoizedConnectionStatus,
    publisherStatus: memoizedPublisherStatus,
    twitterStatus: memoizedTwitterStatus,
    
    startMarketDataFeed: startMarketDataFeed.mutate,
    stopMarketDataFeed: stopMarketDataFeed.mutate,
    updateMarketDataFeedOptions: updateMarketDataFeedOptions.mutate,

    startTwitterFeed: startTwitterFeed.mutate,
    stopTwitterFeed: stopTwitterFeed.mutate,
    updateTwitterFeedOptions: updateTwitterFeedOptions.mutate,
    
    marketDataFeedStarting: startMarketDataFeed.isPending,
    marketDataFeedStopping: stopMarketDataFeed.isPending,
    marketDataFeedOptionsUpdating: updateMarketDataFeedOptions.isPending,

    twitterFeedStarting: startTwitterFeed.isPending,
    twitterFeedStopping: stopTwitterFeed.isPending,
    twitterFeedOptionsUpdating: updateTwitterFeedOptions.isPending,
  };
}