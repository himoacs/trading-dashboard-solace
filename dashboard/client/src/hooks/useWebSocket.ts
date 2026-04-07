import { useEffect, useState, useRef, useCallback } from 'react';
import { createMarketDataTopic } from '../lib/stockUtils';
import { topicManager } from '../lib/topicSubscriptionManager';
import { Stock } from '../types/stockTypes';

export type WebSocketMessage = {
  type: string;
  symbol?: string;
  data?: any;
  timestamp?: string;
  message?: string;
  symbols?: string[]; // For subscription acknowledgments
  topic?: string;     // Solace topic
  rawData?: string;   // Original raw message data
  direction?: 'incoming' | 'outgoing'; // Direction of the message (incoming from Solace, outgoing to Solace)
  isWildcard?: boolean; // Flag to indicate this is a wildcard subscription
  wildcardType?: 'country' | 'exchange' | 'other'; // Type of wildcard for more precise handling
  isCriticalTest?: boolean; // Flag for testing operations
  
  // Properties for signal/output messages
  content?: string;        // Tweet content in format 2
  Signal?: string;         // Signal value (uppercase) in format 2
  signal?: string;         // Signal value (lowercase) in format 2
  confidence?: number;     // Confidence value for signals
  companyName?: string;    // Company name for display
};

// Type for message handlers
type MessageHandler = (message: WebSocketMessage) => void;

// Define message types for better type safety
export const MessageTypes = {
  MARKET_DATA: 'market-data',
  TWITTER_FEED: 'twitter-feed',
  NEWS_FEED: 'news-feed',
  ECONOMIC_INDICATOR: 'economic-indicator',
  TRADING_SIGNAL: 'trading-signal',
  SIGNAL: 'signal',
  SIGNAL_OUTPUT: 'signal/output',
  CONNECTION: 'connection',
  PING: 'ping',
  PONG: 'pong',
  SUBSCRIPTION_ACK: 'subscription_ack'
};

export function useWebSocket(selectedStocks: Stock[] = [], enabled: boolean = true) {
  const [isConnected, setIsConnected] = useState(false);
  const [didDisconnect, setDidDisconnect] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [subscribedTopics, setSubscribedTopics] = useState<string[]>([]);
  const webSocketRef = useRef<WebSocket | null>(null);
  const messageHandlersRef = useRef<Record<string, MessageHandler>>({});
  
  // Keep track of subscriptions to avoid duplicates
  const subscribedTopicsRef = useRef<Set<string>>(new Set());

  const prevSelectedStocksPropRef = useRef<Stock[]>([]); // Ref to store the previous selectedStocks prop

  // Refs for managing message queueing during subscription updates
  const deferMessageProcessingRef = useRef(false); // Renamed from needsInitialSubscriptionsRef
  const queuedMessagesRef = useRef<MessageEvent[]>([]);

  // Moved addMessageToLimitedCollection to the hook's scope
  const addMessageToLimitedCollection = useCallback((msg: WebSocketMessage) => {
    setLastMessage(msg);
    setMessages(prev => {
      const updatedMessages = [...prev, msg];
      return updatedMessages.slice(-50); // Limit to last 50 messages
    });
  }, []); // Empty dependency as setLastMessage & setMessages are stable from useState

  // Helper function to check effective subscription (direct or wildcard)
  const checkEffectiveSubscription = (topic: string, currentSubscriptions: Set<string>): boolean => {
    if (currentSubscriptions.has(topic)) {
      return true; // Direct subscription
    }
    // Check for wildcard coverage
    for (const sub of currentSubscriptions) {
      if (sub.endsWith('/>')) { // It's a wildcard
        const wildcardPrefix = sub.substring(0, sub.length - 2); // Remove '/>'
        if (topic.startsWith(wildcardPrefix)) {
          return true; // Covered by this wildcard
        }
      }
    }
    return false; // Not covered
  };

  // Callback to send a raw message to the WebSocket server
  const sendDirectMessageToServer = useCallback((message: WebSocketMessage) => {
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      try {
        // Add direction for outgoing messages
        const outgoingMessage = { ...message, direction: 'outgoing' as const };
        webSocketRef.current.send(JSON.stringify(outgoingMessage));
        // Optionally, log outgoing messages or add to a separate collection
        // console.log('Sent message:', outgoingMessage.type, outgoingMessage.topic || '');
      } catch (err) {
        console.error('Error sending message:', err);
        setError(err as Error);
      }
    } else {
      console.warn('WebSocket not connected or not open. Message not sent.');
      //setError(new Error('WebSocket not connected. Cannot send message.'));
    }
  }, []); // No dependencies as it relies on webSocketRef.current

  // Expose a function to send messages (handles topics and symbols)
  const sendMessage = useCallback(
    (message: WebSocketMessage) => {
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        // Add direction for outgoing messages
        const outgoingMessage = { ...message, direction: 'outgoing' as const };
        // Log all outgoing messages for debugging
        console.log('Sending WS message:', outgoingMessage);
        webSocketRef.current.send(JSON.stringify(outgoingMessage));
      } else {
        console.warn(
          'WebSocket is not connected. Message not sent:', message.type, 
          message.symbols ? `Symbols: ${message.symbols.join(', ')}` : '',
          message.topic ? `Topic: ${message.topic}` : ''
        );
      }
    },
    [] // Empty dependency array as it uses webSocketRef directly
  );

  // Function to send a ping (keepalive)
  const sendPing = useCallback(() => {
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      const pingMsg: WebSocketMessage = {
        type: MessageTypes.PING,
        timestamp: new Date().toISOString(),
        direction: 'outgoing'
      };
      sendDirectMessageToServer(pingMsg);
    }
  }, [sendDirectMessageToServer]);
  
  // Track whether the effect is still mounted to prevent memory leaks
  const isMounted = useRef(true); // isMounted is a ref
  const manuallyClosed = useRef(false); // Ref to track if WebSocket was closed manually

  // Extracted message handling logic
  const handleIncomingMessage = useCallback((
    messageOrEvent: MessageEvent | WebSocketMessage,
    isQueuedMessage: boolean = false // Flag to know if it's from the queue
  ) => {
    if (!isMounted.current) {
      console.log("[HANDLE_INCOMING_MESSAGE] Component unmounted, ignoring message.");
      return;
    }

    let parsedMessage: WebSocketMessage | null = null;
    let rawDataForParsing: string | undefined = undefined;

    // Determine if it's a MessageEvent or already a WebSocketMessage (from queue)
    if ((messageOrEvent as MessageEvent).data !== undefined) { // It's a MessageEvent
      rawDataForParsing = (messageOrEvent as MessageEvent).data as string;
      // NEW LOG FOR ALL INCOMING RAW DATA if not queued, specifically checking for TSE
      if (!isQueuedMessage && typeof rawDataForParsing === 'string' && rawDataForParsing.includes('market-data/EQ/JP/TSE/')) {
        console.log(`[RAW_TSE_CHECK] handleIncomingMessage received raw event with TSE market data: ${rawDataForParsing.substring(0, 250)}...`);
      }
    } else { // It's already a WebSocketMessage (likely from queue, or internal)
      const preParsed = messageOrEvent as WebSocketMessage;
      if (preParsed.rawData) { // If rawData exists, prefer to re-parse for consistency
        rawDataForParsing = preParsed.rawData;
      } else {
        // If no rawData, it's an internal message or already fully processed
        parsedMessage = preParsed;
        // console.log(`[HANDLE_INCOMING_MESSAGE] Processing pre-parsed message (no rawData): ${parsedMessage.type} - ${parsedMessage.topic}`);
      }
    }

    if (rawDataForParsing && !parsedMessage) { // Only parse if we have raw data and haven't used a pre-parsed message
      try {
        parsedMessage = JSON.parse(rawDataForParsing) as WebSocketMessage;
        parsedMessage.rawData = rawDataForParsing; // Ensure rawData is attached

        // NEW LOG: Dump parsed topic if it's TSE market data
        if (parsedMessage.topic && parsedMessage.topic.startsWith('market-data/EQ/JP/TSE/')) {
          console.log(`[RAW_TSE_PARSE_CHECK] Parsed TSE Message. Topic: ${parsedMessage.topic}, Symbol in payload: ${parsedMessage.symbol}, Data keys: ${parsedMessage.data ? Object.keys(parsedMessage.data) : 'N/A'}`);
        }
      } catch (error) {
        console.error('[HANDLE_INCOMING_MESSAGE] Error parsing WebSocket message:', rawDataForParsing, error);
        setError(new Error(`Error parsing message: ${error instanceof Error ? error.message : String(error)}`));
        return; // Stop processing if parsing fails
      }
    }

    if (!parsedMessage) {
      console.error('[HANDLE_INCOMING_MESSAGE] Message could not be parsed and was not an internal message. Aborting.');
              return;
            }
            
    // Add direction for incoming messages if not already present
    if (parsedMessage.direction !== 'incoming') {
      parsedMessage.direction = 'incoming';
    }

    const messageTopic = parsedMessage.topic || '';
    const messageType = parsedMessage.type;
    const messageSymbol = parsedMessage.symbol; // Symbol from message payload

    const isEffectivelySubscribed = checkEffectiveSubscription(messageTopic, subscribedTopicsRef.current);

    // NEW LOG: Check effective subscription for TSE topics
    if (messageTopic.startsWith('market-data/EQ/JP/TSE/')) {
      console.log(`[RAW_TSE_SUB_CHECK] Effective subscription for TSE topic ${messageTopic}? ${isEffectivelySubscribed}. Ref content: ${JSON.stringify(Array.from(subscribedTopicsRef.current))}`);
    }

    if (!isEffectivelySubscribed && messageTopic) {
      console.log(`[HANDLE_INCOMING_MESSAGE] Got message for topic we're not effectively subscribed to (direct or wildcard): ${messageTopic}`);
      // Optional: Add logic for handling unsolicited messages if necessary
      // For now, we will still process it through addMessageToLimitedCollection if it's a known type.
    }
    
    // Call registered handlers for this message type
    if (messageType && messageHandlersRef.current[messageType]) {
      try {
        // console.log(`[HANDLE_INCOMING_MESSAGE] Calling handler for type ${messageType}`);
        messageHandlersRef.current[messageType](parsedMessage);
      } catch (handlerError) {
        console.error(`[HANDLE_INCOMING_MESSAGE] Error in message handler for type ${messageType}:`, handlerError);
      }
    }

    // DETAILED WILDCARD TRACKING LOG for TSE market data
    if (messageTopic.startsWith('market-data/EQ/JP/TSE/')) {
      console.log(`[WILDCARD_TRACE_WS] Processing JAPAN TSE Market Data: Topic: ${messageTopic}, Payload: ${JSON.stringify(parsedMessage.data).substring(0,100)}...`);
      console.log(`[WILDCARD_TRACE_WS] Current subscribedTopicsRef: ${JSON.stringify(Array.from(subscribedTopicsRef.current))}`);
    }

    // Determine the effective symbol for processing (e.g., for market-data messages where topic has symbol)
    let effectiveSymbolFromTopic = messageSymbol; // Default to symbol from message payload
    if (messageTopic.startsWith('market-data/') || messageTopic.startsWith('signal/')) {
      const topicParts = messageTopic.split('/');
      if (topicParts.length > 0) {
        const lastPart = topicParts[topicParts.length - 1];
        if (lastPart !== '>') { // Ensure it's not the wildcard character itself
            effectiveSymbolFromTopic = lastPart; 
        } else if (topicParts.length > 1) { // If last part is '>', try the one before
            effectiveSymbolFromTopic = topicParts[topicParts.length - 2];
        }
      }
    }
    
    // Log for any TSE market data BEFORE onMessageCallback / setLastMessage
    if (parsedMessage.topic && parsedMessage.topic.startsWith('market-data/EQ/JP/TSE/')) {
        console.log(`[DEBUG WS MSG TSE PRE-CALLBACK] Parsed TSE market data: Topic: ${parsedMessage.topic}, Symbol in Payload: ${parsedMessage.symbol}, EffectiveSymbol from topic: ${effectiveSymbolFromTopic}, Data Preview: ${JSON.stringify(parsedMessage.data).substring(0,100)}`);
    }
    
    // Update the main message object if we derived a better symbol from topic
    if (effectiveSymbolFromTopic && effectiveSymbolFromTopic !== parsedMessage.symbol) {
        console.log(`[EFFECTIVE_SYMBOL_UPDATE] Updating parsedMessage.symbol from "${parsedMessage.symbol || 'undefined'}" to "${effectiveSymbolFromTopic}" for topic ${messageTopic}`);
        parsedMessage.symbol = effectiveSymbolFromTopic;
    }

    // NEW LOG: Specifically for TSE market data, before calling onMessageCallback
    if (parsedMessage.topic && parsedMessage.topic.startsWith('market-data/EQ/JP/TSE/')) {
      console.log(`[TSE_FINAL_CHECK_BEFORE_CALLBACK] TSE Market Data. Topic: ${parsedMessage.topic}, Symbol: ${parsedMessage.symbol}, EffectiveSub: ${isEffectivelySubscribed}, Data: ${JSON.stringify(parsedMessage.data).substring(0,100)}...`);
    }

    // Update general message history and last message state
    // This will make the message available to the Dashboard via setLastMessage
    addMessageToLimitedCollection(parsedMessage);
    
  }, [isMounted, messageHandlersRef, addMessageToLimitedCollection]); // Added addMessageToLimitedCollection to dependencies

  const processQueuedMessages = useCallback(() => {
    if (!webSocketRef.current) {
      console.log("[PROCESS_QUEUE] WebSocket ref is null, cannot process queue.");
      queuedMessagesRef.current = []; // Clear queue as WS is gone
                return;
              }
    const currentWs = webSocketRef.current; // Capture the current instance for the loop

    if (queuedMessagesRef.current.length > 0) {
      console.log(`[[WebSocket PROCESS_QUEUED_MESSAGES]] Processing ${queuedMessagesRef.current.length} queued messages.`);
      const messagesToProcess = [...queuedMessagesRef.current];
      queuedMessagesRef.current = []; // Clear queue before processing
      messagesToProcess.forEach(event => handleIncomingMessage(event, true));
    } else {
      // console.log("[[WebSocket PROCESS_QUEUED_MESSAGES]] No messages in queue.");
    }
  }, [handleIncomingMessage]); // Depends on handleIncomingMessage
  
  // Connect to WebSocket with automatic reconnection
  useEffect(() => {
    // ADDED THIS LOG to detect multiple executions of this effect
    console.log(`[[useWebSocket CONNECTION useEffect RUNNING]] ID: ${Math.random().toString(36).substring(2, 7)}, Enabled: ${enabled}, Current WebSocket Ref: ${webSocketRef.current ? 'EXISTS' : 'NULL'}`);

    if (!enabled) {
      console.log(`[[useWebSocket CONNECTION useEffect]] Not enabled, returning early. ID: ${Math.random().toString(36).substring(2, 7)}`);
      // If was previously connected, ensure cleanup
      if (webSocketRef.current) {
        console.log(`[[useWebSocket CONNECTION useEffect]] Closing existing WebSocket as hook is now disabled. ID: ${Math.random().toString(36).substring(2, 7)}`);
        webSocketRef.current.close();
        webSocketRef.current = null; // Clear the ref
        setIsConnected(false); 
      }
      prevSelectedStocksPropRef.current = []; // Explicitly reset prevSelectedStocksPropRef
      subscribedTopicsRef.current.clear(); // Clear current subscriptions
      setSubscribedTopics([]); // Reset subscribed topics state
      return;
    }
    
    // Track reconnection attempts
    let reconnectAttempt = 0;
    const maxReconnectAttempts = 5;
    
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//localhost:5000/ws`;
      
      // Only log on first attempt or after several failures
      if (reconnectAttempt === 0 || reconnectAttempt % 5 === 0) {
        console.log(`[[useWebSocket CONNECTION useEffect RUNNING]] ID: ${Math.random().toString(36).substring(2, 7)}, WebSocket connecting to: ${wsUrl} (Attempt ${reconnectAttempt + 1}/${maxReconnectAttempts})`);
      }
      
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        if (reconnectAttempt === 0) console.log("WebSocket already connected.");
        setIsConnected(true);
        return;
      }

      try {
        // Create WebSocket connection
        const ws = new WebSocket(wsUrl);
        if (isMounted.current) {
          webSocketRef.current = ws;
        }
        
        // Setup event handlers
        ws.onopen = () => {
          if (webSocketRef.current !== ws) { // Check if this is still the current ws
            console.log('[ONOPEN STALE] Stale "onopen" event for a previous WebSocket instance. Ignoring.');
            return;
          }
          if (!isMounted.current) return;
          
          // Reset reconnect attempts on successful connection
          reconnectAttempt = 0;
          setIsConnected(true);
          setError(null);
          
          console.log("[[WebSocket ONOPEN]] WebSocket opened. Activating message deferral for initial subscriptions.");
          deferMessageProcessingRef.current = true; // Activate deferral
          setIsConnected(true); // This will trigger the subscription useEffect
          setError(null);

          // We no longer auto-subscribe to symbols or signal/output topic on connection
          // This prevents duplicate subscriptions when reconnecting
          // The Dashboard component will manage all subscriptions explicitly
        };
        
        ws.onmessage = (event: MessageEvent) => {
          if (webSocketRef.current !== ws) { // Check if this is the WebSocket instance that this handler belongs to
            console.log(`[ONMESSAGE STALE] Stale message on old WebSocket instance. Data: ${event.data?.substring(0,100)}. Ref is: ${webSocketRef.current ? 'different' : 'null'}. Ignoring.`);
            return;
          }

          if (deferMessageProcessingRef.current) { // Check deferral flag
            console.log(`[[WebSocket ONMESSAGE]] Deferring message as subscriptions are being updated. Topic: ${JSON.parse(event.data)?.topic || 'N/A'}`);
            queuedMessagesRef.current.push(event);
            return;
          }
          handleIncomingMessage(event, false); // CORRECTED: Was true, should be false for non-queued messages
        };
        
        ws.onerror = (event: Event) => {
          if (webSocketRef.current !== ws && webSocketRef.current !== null) { // Allow if ref is null (meaning it's being cleaned up)
            console.error('[ONERROR STALE] Stale "onerror" event for a previous WebSocket instance. Ignoring.');
            return;
          }
          console.error('WebSocket error:', event);
          if (!isMounted.current) return;
          
          setIsConnected(false); // Explicitly set connected state to false on error
          setError(new Error('WebSocket connection error'));
          
          // Attempt to close the WebSocket if it's still open or connecting
          // This can help ensure the onclose event fires reliably
          if (webSocketRef.current && 
              (webSocketRef.current.readyState === WebSocket.OPEN || 
               webSocketRef.current.readyState === WebSocket.CONNECTING)) {
            try {
              console.log('Attempting to close WebSocket after error...');
              webSocketRef.current.close();
            } catch (closeError) {
              console.error('Error trying to close WebSocket after error:', closeError);
            }
          }
        };
        
        ws.onclose = (event: CloseEvent) => {
          // Check if this is the current WebSocket instance that is closing.
          // If webSocketRef.current is already null (cleaned up by this handler from a previous call for THIS ws)
          // or points to a newer instance, this onclose is for a stale WebSocket or already handled.
          if (webSocketRef.current !== ws && webSocketRef.current !== null) {
            console.log(`[[WebSocket ONCLOSE STALE]] Stale 'onclose' event for a previous WebSocket instance. Code: ${event.code}. Ref is already: ${webSocketRef.current ? 'different' : 'null'}. Ignoring.`);
            return; // Do nothing if this is a stale onclose or already handled for this instance
          }

          console.log(`[[WebSocket ONCLOSE ACTIVE]] Code: ${event.code}, Reason: "${event.reason}", Clean: ${event.wasClean}, Type: ${event.type}`);
          console.dir(event); // Log the full event object for more details

          // If this specific ws instance is indeed the one in webSocketRef.current, nullify it.
          // This ensures that if onclose is somehow called multiple times for the same ws instance,
          // the main logic below only runs once for that instance.
          if (webSocketRef.current === ws) {
            webSocketRef.current = null; // Clear the ref as this one is now closed.
          }

          if (isMounted.current) {
          setIsConnected(false);
            setDidDisconnect(true); // Indicate that a disconnection event occurred

            // !!! CRITICAL FIX: Clear current subscriptions and previous symbols on disconnect
            // This ensures a full re-subscription attempt upon successful reconnect.
            console.log("[[WebSocket ONCLOSE]] Clearing subscribedTopicsRef, prevSelectedStocksPropRef, message queue, and deferral flag.");
            subscribedTopicsRef.current.clear();
            prevSelectedStocksPropRef.current = []; // Clear the previous selectedStocks prop ref on disconnect
            queuedMessagesRef.current = []; // Clear any pending messages
            deferMessageProcessingRef.current = false; // Reset deferral flag

            // if (onDisconnect) { // Temporarily commented out as onDisconnect is not a prop
            //   onDisconnect();
            // }

            // Reconnection logic (only if enabled and not deliberately closing)
            const shouldReconnect = enabled && !manuallyClosed.current && event.code !== 1000; // CORRECTED

            if (shouldReconnect && reconnectAttempt < maxReconnectAttempts) {
            reconnectAttempt++;
              // Define reconnectInterval based on attempt number (exponential backoff)
              const reconnectInterval = Math.min(1000 * Math.pow(2, reconnectAttempt -1 ), 30000); // Max 30 seconds, -1 because first attempt is immediate
            
              console.log(`WebSocket disconnected - will attempt to reconnect (attempt ${reconnectAttempt}/${maxReconnectAttempts}) in ${reconnectInterval}ms`);
            
            setTimeout(() => {
                if (isMounted.current && enabled && !manuallyClosed.current) { // CORRECTED & RE-CHECKED
                  console.log(`Attempting reconnect now (attempt ${reconnectAttempt}).`);
                  connect(); // Attempt to reconnect
                } else {
                  console.log("Reconnect attempt aborted as conditions changed (unmounted, disabled, or manually closed).");
                }
              }, reconnectInterval);
            } else if (manuallyClosed.current) { // CORRECTED
              console.log("WebSocket closed manually, no reconnect attempt.");
            } else if (enabled && event.code !== 1000) { // only log error if not a normal closure and was enabled
              console.error(`Maximum reconnect attempts (${reconnectAttempt} attempts or due to other reasons, no more retries.`);
              // Optionally set an error state here if needed
              // setError(new Error(`Failed to connect after ${reconnectAttempt} attempts`));
            }
          } else {
            console.log("WebSocket closed, but component is unmounted. No further action.");
          }
        };
      } catch (error) {
        console.error('Error creating WebSocket connection:', error);
        if (isMounted.current) {
          setError(new Error('Failed to create WebSocket connection'));
        }
      }
    };
    
    // Initial connection attempt
    connect();
    
    // Cleanup function
    return () => {
      console.log(`[[useWebSocket CONNECTION useEffect CLEANUP]] ID: ${Math.random().toString(36).substring(2, 7)}. Closing WebSocket and cleaning up.`);
      isMounted.current = false; // Set isMounted to false when the component unmounts or effect re-runs
      manuallyClosed.current = true; // Indicate manual closure on cleanup to prevent auto-reconnect
      if (webSocketRef.current) {
        try {
          if (webSocketRef.current.readyState === WebSocket.OPEN || 
              webSocketRef.current.readyState === WebSocket.CONNECTING) {
            console.log('[[useWebSocket Connection useEffect CLEANUP]] Closing WebSocket.');
            webSocketRef.current.close();
          }
        } catch (err) {
          console.error('Error closing WebSocket during cleanup:', err);
        }
        webSocketRef.current = null;
      }
      // Reset states related to connection and subscriptions
      setIsConnected(false);
      setError(null);
      setDidDisconnect(false); // Reset disconnect flag
      prevSelectedStocksPropRef.current = []; // Clear the previous selectedStocks prop ref on cleanup/disable
      subscribedTopicsRef.current.clear(); // Clear current subscriptions
      setSubscribedTopics([]); // Reset subscribed topics state
    };
  }, [enabled]);
  
  // ENHANCED: Update subscriptions when selectedStocks change (with improved wildcard awareness)
  useEffect(() => {
    const currentSymbolsForComparison = selectedStocks.map(s => s.symbol).sort();
    const prevSymbolsForComparison = prevSelectedStocksPropRef.current.map(s => s.symbol).sort();
    
    console.log(`[[useWebSocket Subscription useEffect INPUT]] Current selectedStocks (symbols: ${JSON.stringify(currentSymbolsForComparison)}), Previous selectedStocks from ref (symbols: ${JSON.stringify(prevSymbolsForComparison)}), isConnected: ${isConnected}, enabled: ${enabled}, deferringMessages: ${deferMessageProcessingRef.current}`);
    
    const selectedStocksActuallyChanged = JSON.stringify(currentSymbolsForComparison) !== JSON.stringify(prevSymbolsForComparison);

    if (selectedStocksActuallyChanged) {
      console.log(`[[useWebSocket Subscription useEffect]] Detected change in selectedStocks prop. New: ${JSON.stringify(currentSymbolsForComparison)}, Old from ref: ${JSON.stringify(prevSymbolsForComparison)}`);
    } else {
      console.log(`[[useWebSocket Subscription useEffect]] selectedStocks prop has NOT changed compared to ref.`);
    }

    // DO NOT update prevSelectedStocksPropRef.current here yet.
    // It should only be updated if we are connected and process the current selectedStocks.

    if (!isConnected || !webSocketRef.current || webSocketRef.current.readyState !== WebSocket.OPEN) {
      if (webSocketRef.current && webSocketRef.current.readyState !== WebSocket.OPEN) {
        console.log('WebSocket not open, delaying subscription update.');
      }
      // If not connected, prevSelectedStocksPropRef.current remains as it was (e.g., cleared by onclose, or from a previous connected run).
      // This ensures that when connection DOES establish, the comparison is against the state from the last successful processing or clean state.
      return;
    }
    
    // If selected stocks have changed (or if deferral is already active from onopen),
    // ensure message deferral is active while we update subscriptions.
    if (selectedStocksActuallyChanged || deferMessageProcessingRef.current) {
        if (!deferMessageProcessingRef.current) { // Activate if not already active
             console.log("[[Subscription Effect]] Stocks changed or initial setup, activating message deferral for this update cycle.");
             deferMessageProcessingRef.current = true;
        }
    }
    
    // If we are connected and processing, NOW update the ref for the NEXT run, reflecting the stocks we are about to process.
    prevSelectedStocksPropRef.current = selectedStocks;
    
    console.log(`Updating WebSocket subscriptions for selected stocks. Count: ${selectedStocks.length}`);
    
    // Identify all wildcards in current subscriptions: both exchange and country level
    const allWildcards = Array.from(subscribedTopicsRef.current).filter(topic => 
      topic.startsWith('market-data/EQ/') && topic.endsWith('>')
    );

    // Enhanced wildcard tracking for better organization and debugging
    type WildcardInfo = {
      topic: string;
      assetClass: string;
      country: string;
      exchange: string;
      isCountryWildcard: boolean; // True if this is a country-level wildcard (market-data/EQ/US/>)
      isExchangeWildcard: boolean; // True if this is an exchange-level wildcard (market-data/EQ/US/NYSE/>)
    };
    
    // Create a structured representation of wildcards for more accurate matching
    const parsedWildcards: WildcardInfo[] = allWildcards.map(wildcard => {
      const parts = wildcard.split('/');
      
      // Country-level wildcard: market-data/EQ/US/>
      if (parts.length === 4 && parts[0] === 'market-data' && parts[3] === '>') {
        return {
          topic: wildcard,
          assetClass: parts[1],
          country: parts[2],
          exchange: '', // No specific exchange for country wildcards
          isCountryWildcard: true,
          isExchangeWildcard: false
        };
      }
      // Exchange-level wildcard: market-data/EQ/US/NYSE/>
      else if (parts.length === 5 && parts[0] === 'market-data' && parts[4] === '>') {
        return {
          topic: wildcard,
          assetClass: parts[1],
          country: parts[2],
          exchange: parts[3],
          isCountryWildcard: false,
          isExchangeWildcard: true
        };
      }
      // Just store the whole topic if format is unexpected
      return {
        topic: wildcard,
        assetClass: '',
        country: '',
        exchange: '',
        isCountryWildcard: false,
        isExchangeWildcard: false
      };
    });
    
    // Count how many of each type we have
    const countryWildcards = parsedWildcards.filter(w => w.isCountryWildcard);
    const exchangeWildcards = parsedWildcards.filter(w => w.isExchangeWildcard);
    
    if (parsedWildcards.length > 0) {
      console.log(`Identified ${parsedWildcards.length} active wildcards (${countryWildcards.length} country-level, ${exchangeWildcards.length} exchange-level):`);
      parsedWildcards.forEach(wildcard => {
        if (wildcard.isCountryWildcard) {
          console.log(`  - COUNTRY wildcard: ${wildcard.topic} [${wildcard.country}/*]`);
        } else if (wildcard.isExchangeWildcard) {
          console.log(`  - EXCHANGE wildcard: ${wildcard.topic} [${wildcard.country}/${wildcard.exchange}]`);
        } else {
          console.log(`  - Unknown wildcard format: ${wildcard.topic}`);
        }
      });
    }
    
    // Create a set of topics we want to manage (desired topics)
    const desiredTopics = new Set<string>();
    const requiredWildcards = new Set<string>(); // Collect necessary exchange or country wildcards

    selectedStocks.forEach(stock => {
      if (stock && stock.symbol) {
        // 1. Always add signal topic for the specific symbol
        desiredTopics.add(`signal/${stock.symbol}`);

        // 2. Handle market data topic based on how stock was added
        if (stock.addedBy === 'user') {
          const marketDataTopic = createMarketDataTopic(stock.symbol);
          if (marketDataTopic) {
            desiredTopics.add(marketDataTopic);
          }
        } else { // 'filter', 'wildcard', or other non-user (group) additions
          // Prefer exchange wildcard if stock has exchange info
          if (stock.countryCode && stock.exchangeShortName) {
            requiredWildcards.add(`market-data/EQ/${stock.countryCode}/${stock.exchangeShortName}/>`);
          } 
          // Fallback to country wildcard if only country code is available (e.g. from a country-wide filter)
          else if (stock.countryCode) { 
            console.log(`Stock ${stock.symbol} (added by ${stock.addedBy}) has country (${stock.countryCode}) but no exchange. Requesting country wildcard.`);
            requiredWildcards.add(`market-data/EQ/${stock.countryCode}/>`);
        } else {
            console.warn(`Stock ${stock.symbol} (added by ${stock.addedBy}) is missing countryCode/exchangeShortName for wildcard generation.`);
        }
        }
      }
    });

    // Add all collected required wildcards to desiredTopics
    requiredWildcards.forEach(wildcardTopic => {
      desiredTopics.add(wildcardTopic);
    });
    
    // Convert desired topics to an array for easier processing
    const desiredTopicsArray = Array.from(desiredTopics);
    
    console.log("Topics desired for subscription (client-side calculation):", desiredTopicsArray);
    
    // Calculate topics to add and remove based on the ref (what WS is currently subscribed to server-side)
    const topicsToAdd = desiredTopicsArray.filter(topic => !subscribedTopicsRef.current.has(topic));
    const topicsToRemove = Array.from(subscribedTopicsRef.current).filter(
      topic => !desiredTopicsArray.includes(topic) 
      // Keep wildcard unsubscriptions separate or handle more carefully if needed
      // For now, let's assume wildcards are managed by adding them when needed and not explicitly removed by this generic diff
      // Or, if they are removed, ensure Dashboard logic re-adds them if a filter is still active.
      // The current filter `!topic.includes('>')` prevents auto-removal of wildcards by this diff.
       && !topic.includes('>') 
    );
    
    console.log(`Changes to send to WebSocket server: add ${topicsToAdd.length} topics, remove ${topicsToRemove.length} topics (based on subscribedTopicsRef)`);

    let refChangedByTopicManagement = false;
    
    // Only attempt WebSocket operations if it's in OPEN state
    if (webSocketRef.current.readyState === WebSocket.OPEN) {
      // First clean up subscriptions that are no longer needed
      if (topicsToRemove.length > 0) {
        topicsToRemove.forEach(topic => {
          console.log(`Unsubscribing from topic ${topic} (MAIN EFFECT)`);
          try {
            webSocketRef.current?.send(JSON.stringify({
              type: 'unsubscribe_topic',
              topic: topic
            }));
            if (subscribedTopicsRef.current.delete(topic)) {
              refChangedByTopicManagement = true;
            }
          } catch (error) {
            console.error(`Error unsubscribing from topic ${topic}:`, error);
          }
        });
      }
      
      // Subscribe to ALL new topics in topicsToAdd (both non-wildcard and wildcard)
      // This ensures subscribedTopicsRef.current is updated immediately for onmessage checks.
      if (topicsToAdd.length > 0) {
        topicsToAdd.forEach(topic => {
          console.log(`[ADD LOOP] Processing new topic: ${topic}. Ref state before add: ${subscribedTopicsRef.current.has(topic)}`);
          try {
            // Add to ref *before* sending, to make local state more immediately consistent
            // This check is mostly a safeguard; topicsToAdd implies it's not in the ref.
            if (!subscribedTopicsRef.current.has(topic)) {
              subscribedTopicsRef.current.add(topic);
              refChangedByTopicManagement = true; 
              console.log(`[ADD LOOP] Added ${topic} to subscribedTopicsRef.current. New size: ${subscribedTopicsRef.current.size}`);
            } else {
              // This path should be rare if topicsToAdd is calculated correctly against the current ref state.
              console.log(`[ADD LOOP] Topic ${topic} was in topicsToAdd but ALREADY in subscribedTopicsRef.current. Not re-adding to ref.`);
            }

            const isWildcardTopic = topic.includes('>');
            let wildcardTypeVal: 'country' | 'exchange' | 'other' = 'other';
            if (isWildcardTopic) {
              const parts = topic.split('/');
              if (parts.length === 4 && parts[3] === '>') wildcardTypeVal = 'country';
              else if (parts.length === 5 && parts[4] === '>') wildcardTypeVal = 'exchange';
            }

            const subscribeMsg: WebSocketMessage = {
                  type: 'subscribe_topic',
                  topic: topic,
                  direction: 'outgoing',
                  timestamp: new Date().toISOString(),
              isWildcard: isWildcardTopic,
              wildcardType: isWildcardTopic ? wildcardTypeVal : undefined
            };
            webSocketRef.current?.send(JSON.stringify(subscribeMsg));
            console.log(`[ADD LOOP] Sent initial subscribe message for ${topic}. Wildcard: ${isWildcardTopic}`);
              } catch (error) {
            console.error(`Error subscribing to topic ${topic} in main add loop:`, error);
              }
            });
      }
      
      // Always send a bulk subscription message for server-side tracking IF symbols changed
      if (selectedStocksActuallyChanged) { // Use the refined change detection
        console.log(`[[useWebSocket Subscription useEffect]] Actual selectedStocks prop changed, sending bulk subscribe. New symbols: ${JSON.stringify(currentSymbolsForComparison)}`);
      try {
        webSocketRef.current.send(JSON.stringify({
          type: 'subscribe',
            symbols: currentSymbolsForComparison, // Send the current, sorted symbols from selectedStocks
          timestamp: new Date().toISOString()
        }));
      } catch (error) {
        console.error('Error sending bulk symbol subscription:', error);
      }
      } else {
        console.log(`[[useWebSocket Subscription useEffect]] Actual selectedStocks prop unchanged (${JSON.stringify(currentSymbolsForComparison)}), skipping bulk subscribe.`);
      }
      
      // After ALL subscription operations for the current selectedStocks are done (ref updated, WS messages sent),
      // if message deferral was active, it's time to process the queue and deactivate deferral.
      if (deferMessageProcessingRef.current) {
        // MODIFIED CONDITION:
        // Only process queue and deactivate deferral if:
        // 1. We were in a deferral state.
        // 2. The current selectedStocks prop is NOT empty (meaning we intended to subscribe to something).
        // 3. EITHER:
        //    a. The subscribedTopicsRef is now NOT empty (meaning some subscriptions were made or already existed).
        //    b. OR topicsToAdd was empty (meaning all desiredTopics for the current non-empty selectedStocks were already in the ref).
        if (selectedStocks.length > 0 && (subscribedTopicsRef.current.size > 0 || topicsToAdd.length === 0)) {
          const prevQueueLength = queuedMessagesRef.current.length;
          console.log(`[[Subscription Effect]] Conditions met. Deactivating deferral and processing ${prevQueueLength} queued messages. selectedStocks: ${selectedStocks.length}, refSize: ${subscribedTopicsRef.current.size}, topicsToAdd: ${topicsToAdd.length}`);
          deferMessageProcessingRef.current = false;
          processQueuedMessages();
          if (prevQueueLength > 0 && queuedMessagesRef.current.length > 0) {
            console.warn(`[[Subscription Effect]] WARNING: Queue was not fully emptied by processQueuedMessages. Remaining: ${queuedMessagesRef.current.length}`);
          }
        } else {
          console.log(`[[Subscription Effect]] Deferral was active, but conditions to process queue not met. Keeping deferral. selectedStocks: ${selectedStocks.length}, refSize: ${subscribedTopicsRef.current.size}, topicsToAdd: ${topicsToAdd.length}`);
          // Deferral remains true. Queue will be processed on a subsequent run when selectedStocks is populated and subscriptions are confirmed.
        }
      }
    } else {
      console.warn(`Cannot manage subscriptions: WebSocket not in OPEN state (current state: ${webSocketRef.current?.readyState})`);
    }
    
    // Sync subscribedTopics state with the ref
    // This ref helps in managing subscriptions across renders and reconnections.
    if (refChangedByTopicManagement || 
        JSON.stringify(Array.from(subscribedTopicsRef.current).sort()) !== JSON.stringify(subscribedTopics.sort())) {
      console.log('Syncing subscribedTopics state from ref in useWebSocket (subscription useEffect)', Array.from(subscribedTopicsRef.current));
      setSubscribedTopics(Array.from(subscribedTopicsRef.current).sort());
    }
  }, [selectedStocks, isConnected, sendMessage, enabled]);
  
  // Clear messages
  const clearMessages = useCallback(() => {
    setMessages([]);
    setLastMessage(null);
  }, []);
  
  // Get messages by type
  const getMessagesByType = useCallback((type: string) => {
    return messages.filter(msg => msg.type === type);
  }, [messages]);
  
  // Get last message by type
  const getLastMessageByType = useCallback((type: string) => {
    const typeMessages = messages.filter(msg => msg.type === type);
    if (typeMessages.length === 0) return null;
    return typeMessages[typeMessages.length - 1];
  }, [messages]);

  // Subscribe to a specific topic with optional wildcard pattern support
  const subscribeTopic = useCallback((topic: string, isWildcard: boolean = false) => {
    // Only send if the WebSocket is actually OPEN (not just connected flag)
    if (!webSocketRef.current || webSocketRef.current.readyState !== WebSocket.OPEN) {
      console.warn(`Cannot subscribe to topic ${topic}: WebSocket not in OPEN state (current state: ${webSocketRef.current?.readyState})`);
      
      // Still update the topics we want to subscribe to, so we can retry later
      setSubscribedTopics(prev => {
        if (prev.includes(topic)) return prev;
        return [...prev, topic];
      });
      return;
    }
    
    // Check if we're already subscribed to this topic to avoid duplicates
    if (subscribedTopicsRef.current.has(topic)) {
      console.log(`Already subscribed to topic: ${topic}, skipping duplicate subscription`);
      return;
    }
    
    // Auto-detect wildcard topics if not explicitly specified
    if (!isWildcard && topic.includes('>')) {
      console.log(`Auto-detected wildcard in topic: ${topic}, setting isWildcard=true`);
      isWildcard = true;
    }
    
    // For wildcard topics, check if we should skip individual stock topics that would be covered by this wildcard
    if (isWildcard && topic.includes('>')) {
      // If this is a wildcard topic, find individual topics that would be covered by it
      // For example, if subscribing to market-data/EQ/AU/ASX/>, we should unsubscribe from market-data/EQ/AU/ASX/BHP
      const topicsToRemove: string[] = [];
      
      // Extract the prefix from the wildcard topic (remove the > at the end)
      const wildcardPrefix = topic.substring(0, topic.length - 1);
      
      // If it's a market data wildcard (either country or exchange level), register it with our topic manager
      if (topic.startsWith('market-data/EQ/')) {
        const parts = topic.split('/');
        
        // Check for country-level wildcard: market-data/EQ/US/>
        if (parts.length === 4 && parts[3] === '>') {
          const country = parts[2];
          
          console.log(`🌍 Processing COUNTRY-level wildcard for ${country} (${topic})`);
          
          // Register this with the topic manager
          topicManager.addCountryWildcard(country);
          console.log(`✅ Registered country wildcard for ${country} in topic manager`);
          
          // Find any individual stock topics that would be covered by this country wildcard
          const coveredTopics = Array.from(subscribedTopicsRef.current).filter(existingTopic => {
            if (existingTopic.includes('>')) return false; // Skip other wildcards
            
            // Check if this is a stock topic for this country
            if (existingTopic.startsWith(`market-data/EQ/${country}/`)) {
              return true; // This is covered by our country wildcard
            }
            return false;
          });
          
          if (coveredTopics.length > 0) {
            console.log(`Country wildcard ${topic} will cover ${coveredTopics.length} individual topics`);
            
            // Add these to topics to remove
            coveredTopics.forEach(individualTopic => {
              if (!topicsToRemove.includes(individualTopic)) {
                topicsToRemove.push(individualTopic);
                console.log(`Topic ${individualTopic} is now covered by COUNTRY wildcard ${topic}`);
              }
            });
          }
        }
        // Check for exchange-level wildcard: market-data/EQ/US/NYSE/>
        else if (parts.length === 5 && parts[4] === '>') {
          const country = parts[2];
          const exchange = parts[3];
          
          // Register this wildcard with the topic manager
          topicManager.addExchangeWildcard(exchange, country);
          console.log(`Registered exchange wildcard for ${exchange}/${country} in topic manager`);
          
          // Find any stocks that would be covered by this wildcard to remove their individual subscriptions
          const coveredStocks = topicManager.findStocksCoveredByNewWildcard(exchange, country);
          if (coveredStocks.length > 0) {
            console.log(`Identified ${coveredStocks.length} stocks that will be covered by wildcard ${topic}`);
            
            // Convert stock symbols to topics for unsubscription
            coveredStocks.forEach(symbol => {
              const individualTopic = `market-data/EQ/${country}/${exchange}/${symbol}`;
              if (subscribedTopicsRef.current.has(individualTopic)) {
                topicsToRemove.push(individualTopic);
                console.log(`Stock ${symbol} is now covered by exchange wildcard, will remove individual topic: ${individualTopic}`);
              }
            });
          }
        }
      }
      
      // Also check all current subscriptions using the prefix method (backup)
      subscribedTopicsRef.current.forEach(existingTopic => {
        // Skip if this is a wildcard topic itself
        if (existingTopic.includes('>')) return;
        
        // If the existing topic starts with the wildcard prefix, it will be covered by the new wildcard
        if (existingTopic.startsWith(wildcardPrefix)) {
          if (!topicsToRemove.includes(existingTopic)) {
            topicsToRemove.push(existingTopic);
            console.log(`Topic ${existingTopic} will be covered by new wildcard ${topic}, planning to remove individual subscription`);
          }
        }
      });
      
      // Remove individual topics that will be covered by the wildcard
      if (topicsToRemove.length > 0) {
        console.log(`Unsubscribing from ${topicsToRemove.length} individual topics that will be covered by wildcard ${topic}`);
        topicsToRemove.forEach(topicToRemove => {
          unsubscribeTopic(topicToRemove);
        });
      }
    }
    
    // Check if the individual topic is already covered by a wildcard (either country or exchange level)
    if (!isWildcard) {
      // First check using our topic manager if it's a market data topic
      if (topic.startsWith('market-data/EQ/')) {
        // Format: market-data/EQ/<country>/<exchange>/<symbol>
        const parts = topic.split('/');
        if (parts.length === 5) {
          const country = parts[2];
          const exchange = parts[3];
          const symbol = parts[4];
          
          // First check for country-level wildcard coverage
          const countryWildcardTopic = `market-data/EQ/${country}/>`;
          if (subscribedTopicsRef.current.has(countryWildcardTopic)) {
            console.log(`🌍 Topic ${topic} is already covered by COUNTRY wildcard ${countryWildcardTopic}, skipping individual subscription`);
            
            // Add to our tracking but don't actually subscribe
            subscribedTopicsRef.current.add(topic);
            setSubscribedTopics(prev => {
              if (prev.includes(topic)) return prev;
              return [...prev, topic];
            });
            
            return; // Skip the subscription since it's covered by a country wildcard
          }
          
          // Then check if this stock is covered by any exchange wildcard subscription
          if (topicManager.isStockCoveredByWildcard(exchange, country, symbol)) {
            console.log(`🏢 Topic manager confirms ${topic} is already covered by an EXCHANGE wildcard, skipping individual subscription`);
            
            // Add to our tracking but don't actually subscribe
            subscribedTopicsRef.current.add(topic);
            setSubscribedTopics(prev => {
              if (prev.includes(topic)) return prev;
              return [...prev, topic];
            });
            
            // Make sure the corresponding wildcard is subscribed
            const exchangeWildcardTopic = `market-data/EQ/${country}/${exchange}/>`;
            if (!subscribedTopicsRef.current.has(exchangeWildcardTopic)) {
              console.log(`Need to subscribe to exchange wildcard ${exchangeWildcardTopic} to cover ${symbol}`);
              subscribeTopic(exchangeWildcardTopic, true);
            }
            
            return; // Skip the subscription since it's covered by an exchange wildcard
          } else {
            // Register this as an individual topic in the manager
            console.log(`Adding individual stock topic to manager: ${exchange}/${country}/${symbol}`);
            topicManager.addStockTopic(exchange, country, symbol);
          }
        }
      }
      
      // Fallback to our existing check logic
      const existingWildcardCoverage = Array.from(subscribedTopicsRef.current).some((existingTopic: string) => {
        // Must be a wildcard topic
        if (!existingTopic.includes('>')) return false;
        
        // Extract prefix (remove the > at the end)
        const wildcardPrefix = existingTopic.substring(0, existingTopic.length - 1);
        
        // If the topic starts with the wildcard prefix, it's already covered
        return topic.startsWith(wildcardPrefix);
      });
      
      if (existingWildcardCoverage) {
        console.log(`Topic ${topic} is already covered by an existing wildcard, skipping individual subscription`);
        
        // Still track it in our local state so we know we want it
        subscribedTopicsRef.current.add(topic);
        setSubscribedTopics(prev => {
          if (prev.includes(topic)) return prev;
          return [...prev, topic];
        });
        
        return;
      }
    }
    
    console.log(`Subscribing to ${isWildcard ? 'wildcard' : 'specific'} topic: ${topic}`);
    try {
      // Always double-check isWildcard flag based on topic content
      const isWildcardTopic = isWildcard || topic.includes('>');
      
      // If this is a country wildcard, add special logging
      const parts = topic.split('/');
      if (parts.length === 4 && parts[0] === 'market-data' && parts[1] === 'EQ' && parts[3] === '>') {
        console.log(`🌍 COUNTRY WILDCARD SUBSCRIPTION: ${topic} with isWildcard=${isWildcardTopic}`);
      }
      
      const subscribeMsg: WebSocketMessage = {
        type: 'subscribe_topic',
        topic: topic,
        direction: 'outgoing',
        timestamp: new Date().toISOString(),
        isWildcard: isWildcardTopic, // Set isWildcard flag directly on the message
        // Add extra data for wildcards to ensure server recognizes it properly
        data: isWildcardTopic ? { isWildcard: true } : undefined
      };
      
      console.log(`💬 Sending WebSocket message for topic ${topic}:`, JSON.stringify(subscribeMsg));
      webSocketRef.current.send(JSON.stringify(subscribeMsg));
      
      // Add to messages for debugging
      setMessages(prev => {
        const updatedMessages: WebSocketMessage[] = [...prev, subscribeMsg];
        return updatedMessages.slice(-50); // Limit to last 50 messages
      });
      
      // Add to our local tracking
      subscribedTopicsRef.current.add(topic);
      
      // Update state
      setSubscribedTopics(prev => {
        if (prev.includes(topic)) return prev;
        return [...prev, topic];
      });
    } catch (error) {
      console.error(`Error subscribing to topic ${topic}:`, error);
    }
  }, [isConnected, subscribedTopics]);
  
  // Unsubscribe from a specific topic
  const unsubscribeTopic = useCallback((topic: string) => {
    // Always update our local state regardless of connection status
    setSubscribedTopics(prev => prev.filter(t => t !== topic));
    
    // Remove from our ref tracking
    subscribedTopicsRef.current.delete(topic);
    
    // Only try to send if socket is actually OPEN
    if (!webSocketRef.current || webSocketRef.current.readyState !== WebSocket.OPEN) {
      console.warn(`Cannot unsubscribe from topic ${topic}: WebSocket not in OPEN state (current state: ${webSocketRef.current?.readyState})`);
      return;
    }
    
    console.log(`Unsubscribing from topic: ${topic}`);
    try {
      const unsubscribeMsg: WebSocketMessage = {
        type: 'unsubscribe_topic',
        topic: topic,
        direction: 'outgoing',
        timestamp: new Date().toISOString()
      };
      webSocketRef.current.send(JSON.stringify(unsubscribeMsg));
      
      // Add to messages for debugging
      setMessages(prev => {
        const updatedMessages: WebSocketMessage[] = [...prev, unsubscribeMsg];
        return updatedMessages.slice(-50); // Limit to last 50 messages
      });
    } catch (error) {
      console.error(`Error unsubscribing from topic ${topic}:`, error);
    }
  }, [isConnected]);
  
  // Register a message handler
  const registerHandler = useCallback((handlerId: string, handler: MessageHandler) => {
    console.log(`Registering WebSocket message handler: ${handlerId}`);
    messageHandlersRef.current[handlerId] = handler;
  }, []);

  // Remove a message handler
  const removeHandler = useCallback((handlerId: string) => {
    console.log(`Removing WebSocket message handler: ${handlerId}`);
    if (messageHandlersRef.current[handlerId]) {
      delete messageHandlersRef.current[handlerId];
    }
  }, []);
  
  return {
    isConnected,
    lastMessage,
    messages,
    error,
    clearMessages,
    getMessagesByType,
    getLastMessageByType,
    subscribeTopic,
    unsubscribeTopic,
    subscribedTopics,
    webSocketRef, // Expose the WebSocket reference for debugging
    registerHandler,
    removeHandler,
    sendMessage    // Add the new sendMessage function
  };
}