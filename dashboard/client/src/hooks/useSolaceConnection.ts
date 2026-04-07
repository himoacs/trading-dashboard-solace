import { useState, useEffect, useRef } from 'react';
import { SolaceConnection } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import * as solace from 'solclientjs'; // Import Solace library

// Define session types
export type SolaceSessionType = 'stock' | 'index' | 'signal';

// Define session status object
export interface SolaceSessions {
  stockMarketData: boolean;
  indexMarketData: boolean;
  signalData: boolean;
}

export function useSolaceConnection() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [solaceSession, setSolaceSession] = useState<solace.Session | null>(null); // State for Solace session
  const [solaceLastMessage, setSolaceLastMessage] = useState<solace.Message | null>(null); // State for last Solace message
  const [connectionConfig, setConnectionConfig] = useState<SolaceConnection | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  // Track individual session states
  const [session, setSession] = useState<SolaceSessions>({
    stockMarketData: false,
    indexMarketData: false,
    signalData: false
  });
  
  // Get websocket data for communication
  // const { 
  //   lastMessage, 
  //   isConnected: wsConnected,
  //   sendMessage
  // } = useWebSocket([], true);

  // Listen for session status messages
  // useEffect(() => {
  //   if (lastMessage && lastMessage.type === 'session_status') {
  //     try {
  //       const sessionData = lastMessage.data;
  //       if (sessionData) {
  //         setSession({
  //           stockMarketData: !!sessionData.stockMarketData,
  //           indexMarketData: !!sessionData.indexMarketData,
  //           signalData: !!sessionData.signalData
  //         });
  //       }
  //     } catch (error) {
  //       console.error('Failed to parse session status message:', error);
  //     }
  //   }
  // }, [lastMessage]);

  const connect = async (config: SolaceConnection) => {
    // If solaceSession is null, it means it's either never been created or has been disposed/disconnected.
    // If it exists and we are connecting or already connected, then disconnect first.
    if (solaceSession && (connecting || connected)) {
      console.log('[SolaceConnection] Already have an active or connecting session. Disconnecting before creating a new one.');
      await disconnect(); // Ensure clean state if trying to connect again
      // After disconnect, solaceSession should become null via its event handler, 
      // and connected/connecting states should be false.
    }
    // If, after a potential disconnect, the session object still exists (e.g. disconnect failed or is async and not yet complete),
    // explicitly dispose it and nullify to prevent issues with SolclientFactory.createSession if it complains about live sessions.
    if (solaceSession) {
        console.warn('[SolaceConnection] Stale session object found before connect. Disposing explicitly.');
        try {
            solaceSession.dispose();
        } catch (e) {
            console.error('[SolaceConnection] Error disposing stale session:', e);
        }
        setSolaceSession(null);
    }

    try {
      setConnecting(true);
      setError(null);
      setConnectionConfig(config); // Store the passed config

      // Initialize SolclientFactory properties
      const factoryProps = new solace.SolclientFactoryProperties();
      factoryProps.profile = solace.SolclientFactoryProfiles.version10;
      solace.SolclientFactory.init(factoryProps);

      // Create a new session
      const session = solace.SolclientFactory.createSession({
        url: config.brokerUrl,
        vpnName: config.vpnName,
        userName: config.username,
        password: config.password,
        connectRetries: 3, // Added: Limit initial connection retries
        connectTimeoutInMsecs: 2000, // Changed: Timeout for each connection attempt (2 seconds)
      });

      // Session event listeners
      session.on(solace.SessionEventCode.UP_NOTICE, (sessionEvent: solace.SessionEvent) => {
        console.log('[SolaceConnection UP_NOTICE] Successfully connected to Solace broker. Event:', sessionEvent);
        setConnected(true);
        setConnecting(false);
        setSolaceSession(session);
        setError(null); // Clear any previous error on successful connection
      });

      session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (sessionEvent: solace.SessionEvent) => {
        console.error('[SolaceConnection CONNECT_FAILED_ERROR] Connection failed. Event:', sessionEvent);
        const subCode = (sessionEvent as any).subCode !== undefined ? (sessionEvent as any).subCode : 'N/A';
        const connectError = new Error(`Connection failed: ${sessionEvent.infoStr} (Subcode: ${subCode})`);
        setError(connectError);
        setConnected(false);
        setConnecting(false);
        setSolaceSession(null);
      });

      session.on(solace.SessionEventCode.DISCONNECTED, (sessionEvent: solace.SessionEvent) => {
        console.log('[SolaceConnection DISCONNECTED] Disconnected from Solace broker. Event:', sessionEvent);
        // Only set error if it's an unexpected disconnect
        if (connected) { // If we were previously connected, this is an unexpected disconnect
          const subCode = (sessionEvent as any).subCode !== undefined ? (sessionEvent as any).subCode : 'N/A';
          setError(new Error(`Disconnected: ${sessionEvent.infoStr} (Subcode: ${subCode})`));
        }
        setConnected(false);
        setConnecting(false);
        setSolaceSession(null);
        // Clear subscribed topics as the session is gone
        subscribedTopics.current.clear();
      });

      session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, (sessionEvent: solace.SessionEvent) => {
        console.error('[SolaceConnection SUBSCRIPTION_ERROR] Subscription error. Event:', sessionEvent);
        // Potentially remove topic from subscribedTopics.current if correlationKey is available and mapped
        const subCode = (sessionEvent as any).subCode !== undefined ? (sessionEvent as any).subCode : 'N/A';
        setError(new Error(`Subscription error for topic '${sessionEvent.correlationKey}': ${sessionEvent.infoStr} (Subcode: ${subCode})`));
      });

      session.on(solace.SessionEventCode.SUBSCRIPTION_OK, (sessionEvent: solace.SessionEvent) => {
        console.log('[SolaceConnection SUBSCRIPTION_OK] Subscription OK. Event:', sessionEvent);
        // The actual topic string is in sessionEvent.correlationKey if set during session.subscribe()
        // We are managing subscribedTopics.current optimistically, so this is more of a confirmation.
      });

      // Message event listener
      session.on(solace.SessionEventCode.MESSAGE, (message: solace.Message) => {
        // console.debug('[SolaceConnection] Received message:', message.getDestination().getName(), message.getBinaryAttachment());
        setSolaceLastMessage(message);
      });
      
      console.log('[SolaceConnection] Attempting to connect to Solace...');
      session.connect();

      // The old API call for backend to connect is removed.
      // const response = await apiRequest('POST', '/api/solace/connect', connectionConfig);
      // if (!response.ok) {
      //   const errorData = await response.json();
      //   throw new Error(errorData.message || 'Failed to connect to Solace broker');
      // }
      // const responseData = await response.json();
      // setConnectionConfig(connectionConfig);
      // setConnected(true);
      // return responseData;

    } catch (err) {
      console.error('[SolaceConnection] Error during Solace connect setup:', err);
      setError(err instanceof Error ? err : new Error('Unknown error during connection setup'));
      setConnected(false);
      setConnecting(false);
      setSolaceSession(null); // Ensure session state is cleared
      // No need to throw err further, allow UI to react to error state
    }
    // Removed finally block that setConnecting(false) as it's handled by event listeners now.
  };

  const disconnect = async () => {
    try {
      setConnecting(true); // Indicate we are in the process of disconnecting
      
      if (solaceSession) {
        console.log(`[SolaceConnection] Disconnecting from Solace broker.`);
        // No need to clear subscribedTopics.current here, DISCONNECTED event handler will do it.
        // No need to reset unsubscribedTopics.current here either.
        
        // Call the Solace session disconnect
        solaceSession.disconnect();
        // The DISCONNECTED event handler will set solaceSession to null, connected to false, and connecting to false.
      } else {
        console.log('[SolaceConnection] No active Solace session to disconnect.');
        // Ensure states are reset if disconnect is called without a session
        setConnected(false);
        setConnecting(false); 
      }
      
      // Remove the backend API call for disconnection
      // await apiRequest('POST', '/api/solace/disconnect');
      
      // The session state for stockMarketData etc. is not managed here anymore
      // setSession({
      //   stockMarketData: false,
      //   indexMarketData: false,
      //   signalData: false
      // });
      
      return true;
    } catch (err) {
      console.error('[SolaceConnection] Error during Solace disconnection:', err);
      setError(err instanceof Error ? err : new Error('Unknown error during disconnection'));
      // Ensure connecting is false even if there was an error during the disconnect attempt
      setConnecting(false);
      // We might still be connected if solaceSession.disconnect() failed internally before emitting event
      // Or we might be disconnected. The DISCONNECTED event should be the source of truth.
      throw err; // Re-throw the error so callers can be aware
    }
    // The finally block is removed as connecting state is managed within try/catch and by event handlers
  };
  
  // Track subscribed topics to avoid duplicates
  const subscribedTopics = useRef(new Set<string>());
  
  // Subscribe to a topic on a specific session type
  const subscribe = async (topicString: string, sessionType: SolaceSessionType, isWildcard: boolean = false) => {
    if (!solaceSession || !connected) {
      console.error('[SolaceConnection] Cannot subscribe: Solace session not available or not connected.');
      throw new Error('Not connected to Solace');
    }
    
    // Check if already subscribed to this topic
    if (subscribedTopics.current.has(topicString)) {
      console.log(`[SolaceConnection] Already subscribed to topic: ${topicString}, skipping duplicate subscription`);
      return; // Or resolve promise if returning one
    }
    
    console.log(`[SolaceConnection] Subscribing to ${isWildcard ? 'wildcard' : 'specific'} topic: ${topicString}`);
    
    try {
      const solaceTopic = solace.SolclientFactory.createTopicDestination(topicString);
      solaceSession.subscribe(
        solaceTopic,
        true, // Request confirmation
        topicString, // Correlation key (can be the topic string)
        10000 // Subscription timeout in milliseconds
      );
      // Add to our tracking set optimistically. 
      // SUBSCRIPTION_ERROR handler could potentially remove it if subscription fails.
      subscribedTopics.current.add(topicString);
      console.log(`[SolaceConnection] Subscription request sent for: ${topicString}`);
    
      // Remove old WebSocket send and session state updates
      // sendMessage({
      //   type: 'subscribe_topic',
      //   topic: topic,
      //   isWildcard: isWildcard // Add isWildcard flag to message
      // });
      // if (sessionType === 'stock') {
      //   setSession(prev => ({ ...prev, stockMarketData: true }));
      // } else if (sessionType === 'index') {
      //   setSession(prev => ({ ...prev, indexMarketData: true }));
      // } else if (sessionType === 'signal') {
      //   setSession(prev => ({ ...prev, signalData: true }));
      // }
    } catch (err) {
      console.error(`[SolaceConnection] Error subscribing to topic ${topicString}:`, err);
      // Remove from subscribedTopics if we added it optimistically and an immediate error occurred
      subscribedTopics.current.delete(topicString);
      setError(err instanceof Error ? err : new Error(`Subscription to ${topicString} failed`));
      throw err; // Re-throw
    }
  };
  
  // Track unsubscribed topics to avoid duplicates
  const unsubscribedTopics = useRef(new Set<string>());
  
  // Unsubscribe from a topic on a specific session type
  const unsubscribe = async (topicString: string, sessionType: SolaceSessionType) => {
    console.log(`[SolaceConnection] Unsubscribing from topic: ${topicString}`);
    
    if (!solaceSession || !connected) {
      console.warn(`[SolaceConnection] Cannot unsubscribe - Solace session not available or not connected. Topic: ${topicString}`);
      // Do not throw an error here, as this might be called during cleanup when session is already gone.
      // Allow to proceed and check subscribedTopics.current.
    }
    
    // First, check if this topic is in our subscription tracking
    if (!subscribedTopics.current.has(topicString)) {
      console.log(`[SolaceConnection] Topic ${topicString} is not in our active subscription tracking, might be a redundant unsubscribe or already unsubscribed.`);
      // If we've already unsubscribed from this topic recently (according to unsubscribedTopics ref), skip.
      if (unsubscribedTopics.current.has(topicString)) {
        console.log(`[SolaceConnection] Already attempted to unsubscribe from topic: ${topicString}, skipping duplicate unsubscription request.`);
        return; // Or resolve promise
      }
    }
    
    try {
      if (solaceSession && connected) { // Only attempt SDK call if session seems usable
        const solaceTopic = solace.SolclientFactory.createTopicDestination(topicString);
        solaceSession.unsubscribe(
          solaceTopic,
          true, // Request confirmation
          topicString, // Correlation key
          10000 // Timeout
        );
        console.log(`[SolaceConnection] Unsubscription request sent for: ${topicString}`);
      } else {
        console.log(`[SolaceConnection] Solace session not active, cannot send unsubscription request for: ${topicString}. Will only update local tracking.`);
      }
      
      // Add to unsubscribed topics ref to avoid quick re-unsubscribing
      unsubscribedTopics.current.add(topicString);
      // Remove from subscribed topics tracking
      subscribedTopics.current.delete(topicString);
      
      // Remove old WebSocket send and direct API call
      // sendMessage({
      //   type: 'unsubscribe_topic',
      //   topic: topic
      // });
      // const response = await apiRequest('POST', '/api/solace/unsubscribe', { topic });
      // ... (old API response check)

      // Remove old session state updates
      // if (topic === 'signal/output' && sessionType === 'signal') {
      //   setSession(prev => ({ ...prev, signalData: false }));
      // } ... (other else ifs)
      
    } catch (err) {
      console.error(`[SolaceConnection] Error unsubscribing from topic ${topicString}:`, err);
      // If unsubscribe failed, topic might still be considered subscribed by the broker.
      // We have removed it from subscribedTopics.current optimistically.
      // Depending on desired retry logic, we might re-add it or handle via SUBSCRIPTION_ERROR events if applicable to unsubs.
      setError(err instanceof Error ? err : new Error(`Unsubscription from ${topicString} failed`));
      throw err; // Re-throw
    }
  };
  
  // Computed connected state
  // const isConnected = connected && wsConnected;

  return {
    connected: connected,
    connecting,
    connectionConfig,
    error,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    session,
    solaceLastMessage, // Expose last Solace message
    // wsConnected     // Expose WebSocket connection status
  };
}
