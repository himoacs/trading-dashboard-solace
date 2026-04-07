import { SolaceConnection } from "@shared/schema";
import { storage } from "../storage";
import solace from 'solclientjs';

// Define session types for different data categories
export enum SessionType {
  DEFAULT = "default",
  STOCK_MARKET_DATA = "stock_market_data",
  INDEX_MARKET_DATA = "index_market_data",
  SIGNALS = "signals"
}

class SolaceService {
  private connected: boolean = false;
  private connecting: boolean = false;
  private connectionConfig: SolaceConnection | null = null;
  private subscribers: Map<string, Set<(message: any) => void>> = new Map();
  private lastConnectionError: string = "";
  
  // Multiple sessions for different types of data
  private sessions: Map<SessionType, solace.Session> = new Map();
  private callbacks: Map<string, (topic: string, message: any) => void> = new Map();
  
  // Track subscriptions per session type
  private sessionSubscriptions: Map<SessionType, Set<string>> = new Map();
  
  // Backwards compatibility for code that uses the single session
  private session: solace.Session | null = null;
  
  // Global message handler for all topics
  public onMessage: ((topic: string, message: any) => void) | null = null;
  
  constructor() {
    // Initialize Solace client library
    const factoryProps = new solace.SolclientFactoryProperties();
    factoryProps.profile = solace.SolclientFactoryProfiles.version10;
    solace.SolclientFactory.init(factoryProps);
    
    // Initialize session subscriptions tracking
    Object.values(SessionType).forEach(type => {
      this.sessionSubscriptions.set(type, new Set<string>());
    });
    
    console.log("Solace initialized - waiting for connection credentials");
  }
  
  /**
   * Get a session by type, creating it only if necessary
   * This implements lazy initialization - sessions are created only when needed
   */
  private async getSession(type: SessionType): Promise<solace.Session> {
    // If session already exists, return it
    if (this.sessions.has(type)) {
      return this.sessions.get(type)!;
    }
    
    console.log(`Session of type ${type} doesn't exist yet, checking if we need to create it`);
    
    // Always prefer existing sessions to avoid creating multiple connections
    // First check if we have a default session already
    if (this.session) {
      console.log(`Using existing default session for ${type}`);
      
      // If we're requesting the default session, just return it
      if (type === SessionType.DEFAULT) {
        // Store it in the sessions map for consistency
        this.sessions.set(type, this.session);
        return this.session;
      }
      
      // For specific sessions, check if we really need a separate session
      const subscriptions = this.sessionSubscriptions.get(type) || new Set<string>();
      if (subscriptions.size === 0) {
        console.log(`No subscriptions for ${type}, using default session instead`);
        return this.session;
      }
    }
    
    // If we have any existing session, use it instead of creating a new connection
    if (this.sessions.size > 0 && !this.sessions.has(type)) {
      // Get the first available session
      const existingSession = this.sessions.values().next().value;
      if (existingSession) {
        console.log(`Using existing session for ${type} to avoid multiple connections`);
        this.sessions.set(type, existingSession);
        return existingSession;
      }
    }
    
    // Check if we have connection config
    if (!this.connectionConfig) {
      throw new Error("No Solace connection configuration available");
    }
    
    // Only create a new session if we absolutely have to
    console.log(`Creating new session for ${type}`);
    return this.createSessionForType(type, this.connectionConfig);
  }
  
  /**
   * Create a session for a specific data type
   * Note: This only creates a new connection for the DEFAULT session type.
   * All other session "types" reuse the same connection to avoid multiple connections.
   */
  private createSessionForType(type: SessionType, config: SolaceConnection): Promise<solace.Session> {
    console.log(`Creating Solace session for ${type}`);
    
    // If this is not the DEFAULT session and we already have a DEFAULT session,
    // we should reuse the DEFAULT session instead of creating a new connection
    if (type !== SessionType.DEFAULT && this.session) {
      console.log(`Reusing DEFAULT session for ${type} to avoid multiple connections`);
      this.sessions.set(type, this.session);
      return Promise.resolve(this.session);
    }
    
    // If this is not the DEFAULT session and we have any other session, use that one
    if (type !== SessionType.DEFAULT && this.sessions.size > 0) {
      // Get the first available session
      const existingSession = this.sessions.values().next().value;
      if (existingSession) {
        console.log(`Reusing existing session for ${type} to avoid multiple connections`);
        this.sessions.set(type, existingSession);
        return Promise.resolve(existingSession);
      }
    }
    
    // Create session properties with a client name based on the session type
    const sessionProperties = new solace.SessionProperties({
      url: config.brokerUrl,
      vpnName: config.vpnName,
      userName: config.username,
      password: config.password,
      clientName: `SolCapital_${Date.now()}`, // Use a single client name for all sessions
      connectRetries: 3,
      reconnectRetries: 5,
      connectTimeoutInMsecs: 10000,
      reconnectRetryWaitInMsecs: 3000,
      publisherProperties: {
        acknowledgeMode: solace.MessagePublisherAcknowledgeMode.PER_MESSAGE
      }
    });
    
    return new Promise((resolve, reject) => {
      try {
        // Create a new session for this type
        const session = solace.SolclientFactory.createSession(sessionProperties);
        
        // Define session event listeners
        session.on(solace.SessionEventCode.UP_NOTICE, () => {
          console.log(`Successfully connected ${type} Solace session`);
          // Store the session
          this.sessions.set(type, session);
          resolve(session);
        });
        
        session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (err) => {
          const errorMessage = `Connection to Solace broker for ${type} failed: ${err.toString()}`;
          console.error(errorMessage);
          this.lastConnectionError = errorMessage;
          reject(new Error(errorMessage));
        });
        
        session.on(solace.SessionEventCode.DISCONNECTED, () => {
          console.log(`Disconnected ${type} Solace session`);
          // Remove from sessions map
          this.sessions.delete(type);
        });
        
        session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, (err) => {
          console.error(`Cannot subscribe to topic in ${type} session:`, err);
        });
        
        session.on(solace.SessionEventCode.SUBSCRIPTION_OK, (response) => {
          console.log(`Successfully subscribed to topic: ${response.correlationKey} in ${type} session`);
        });
        
        session.on(solace.SessionEventCode.MESSAGE, (message: solace.Message) => {
          try {
            const destination = message.getDestination();
            if (!destination) {
              console.error('Message has no destination');
              return;
            }
            
            const topic = destination.getName();
            const payload = message.getBinaryAttachment();
            let parsedPayload: any;
            
            if (payload) {
              try {
                parsedPayload = JSON.parse(payload as string);
              } catch (e) {
                parsedPayload = payload;
              }
            } else {
              parsedPayload = null;
            }
            
            console.log(`Received message from topic ${topic} in ${type} session`);
            
            // Call the global message handler if set
            if (this.onMessage) {
              try {
                this.onMessage(topic, parsedPayload);
              } catch (error) {
                console.error(`Error in global message handler for topic ${topic}:`, error);
              }
            }
            
            // Notify all subscribers for this topic
            const topicSubscribers = this.subscribers.get(topic);
            if (topicSubscribers) {
              topicSubscribers.forEach(callback => {
                try {
                  callback(parsedPayload);
                } catch (error) {
                  console.error(`Error in subscriber callback for topic ${topic}:`, error);
                }
              });
            }
            
            // Notify any callback registered for this topic
            const callback = this.callbacks.get(topic);
            if (callback) {
              callback(topic, parsedPayload);
            }
          } catch (error) {
            console.error(`Error processing message in ${type} session:`, error);
          }
        });
        
        // Connect
        session.connect();
      } catch (error) {
        console.error(`Error creating ${type} Solace session:`, error);
        reject(error);
      }
    });
  }

  /**
   * Connect to the Solace message broker
   * This now creates the default session and stores the connection config
   */
  async connect(config: SolaceConnection): Promise<void> {
    // If already connected, return silently instead of throwing an error
    if (this.connected) {
      console.log("Already connected to Solace broker, ignoring duplicate connection request");
      return Promise.resolve();
    }
    
    // Prevent multiple simultaneous connection attempts
    if (this.connecting) {
      console.log("Connection to Solace already in progress, ignoring duplicate request");
      return Promise.resolve();
    }
    
    // Ensure brokerUrl has tcp:// prefix
    let brokerUrl = config.brokerUrl;
    if (!brokerUrl.startsWith('tcp://') && !brokerUrl.startsWith('ws://') && !brokerUrl.startsWith('wss://')) {
      brokerUrl = `tcp://${brokerUrl}`;
      console.log(`Added tcp:// prefix to broker URL: ${brokerUrl}`);
    }
    
    console.log(`Connecting to Solace broker at ${brokerUrl}`);
    
    try {
      // Set connecting flag to prevent duplicate connections
      this.connecting = true;
      
      // Store connection config for future sessions with corrected URL format
      this.connectionConfig = {
        ...config,
        brokerUrl
      };
      
      // Create the default session
      const defaultSession = await this.createSessionForType(SessionType.DEFAULT, this.connectionConfig);
      
      // Set the connected flag and alias the default session to the session property for backward compatibility
      this.connected = true;
      this.session = defaultSession;
      
      console.log("Successfully connected to Solace broker");
      
      // Now that we're connected, return success
      return Promise.resolve();
    } catch (error) {
      console.error('Error connecting to Solace:', error);
      throw error;
    } finally {
      // Clear connecting flag regardless of success or failure
      this.connecting = false;
    }
  }
  
  /**
   * Disconnect from the Solace message broker
   */
  async disconnect(): Promise<void> {
    // Already disconnected
    if (!this.connected && this.sessions.size === 0) {
      console.log("Already disconnected from Solace broker");
      // Reset flags to ensure clean state
      this.connecting = false;
      this.connected = false;
      return Promise.resolve();
    }
    
    console.log("Disconnecting from Solace broker");
    
    // Reset connecting flag to allow reconnection later
    this.connecting = false;
    
    return new Promise((resolve) => {
      try {
        // Get all active sessions
        const activeSessions = Array.from(this.sessions.values());
        
        // If no active sessions, just resolve
        if (activeSessions.length === 0) {
          console.log("No active Solace sessions to disconnect");
          this.connected = false;
          this.connectionConfig = null;
          this.subscribers.clear();
          this.callbacks.clear();
          resolve();
          return;
        }
        
        // Track how many sessions have been disconnected
        let disconnectedCount = 0;
        
        // Define one-time disconnected event listener for each session
        const onSessionDisconnected = (sessionType: SessionType) => {
          console.log(`Disconnected ${sessionType} Solace session`);
          disconnectedCount++;
          
          // If all sessions are disconnected, resolve the promise
          if (disconnectedCount === activeSessions.length) {
            console.log("All Solace sessions disconnected");
            this.connected = false;
            this.connectionConfig = null;
            this.subscribers.clear();
            this.callbacks.clear();
            this.sessions.clear();
            this.sessionSubscriptions.clear();
            this.session = null;
            resolve();
          }
        };
        
        // Disconnect each session
        activeSessions.forEach((session, index) => {
          const sessionType = Array.from(this.sessions.keys())[index];
          
          try {
            // Add our one-time disconnect handler
            session.on(solace.SessionEventCode.DISCONNECTED, () => onSessionDisconnected(sessionType));
            
            // Disconnect the session
            session.disconnect();
          } catch (disconnectError) {
            console.error(`Error disconnecting ${sessionType} session:`, disconnectError);
            onSessionDisconnected(sessionType); // Ensure we still mark it as disconnected
          }
        });
      } catch (error) {
        console.error('Error disconnecting from Solace:', error);
        
        // Force cleanup even if an error occurs
        this.connected = false;
        this.connectionConfig = null;
        this.subscribers.clear();
        this.callbacks.clear();
        
        // Clean up all sessions
        this.sessions.forEach((session, sessionType) => {
          try {
            session.dispose();
            console.log(`Disposed ${sessionType} session during error cleanup`);
          } catch (disposeError) {
            console.error(`Error disposing ${sessionType} session:`, disposeError);
          }
        });
        
        this.sessions.clear();
        this.sessionSubscriptions.clear();
        this.session = null;
        resolve();
      }
    });
  }
  
  /**
   * Check if connected to the Solace message broker
   * Returns true only for real connections
   */
  isConnected(): boolean {
    // Return true if we have a connection and at least one active session
    return this.connected && (
      (this.session !== null) || 
      (this.sessions.size > 0)
    );
  }
  
  /**
   * Get a specific Solace session for testing/debugging
   * @param sessionType The type of session to retrieve
   * @returns The session or null if not available
   */
  getSolaceSession(sessionType: string): solace.Session | null {
    // Map the string to our enum
    let type: SessionType;
    
    switch(sessionType) {
      case 'stock_market_data':
        type = SessionType.STOCK_MARKET_DATA;
        break;
      case 'index_market_data':
        type = SessionType.INDEX_MARKET_DATA;
        break;
      case 'signal_data':
      case 'signals':
        type = SessionType.SIGNALS;
        break;
      default:
        type = SessionType.DEFAULT;
    }
    
    // Return the session if it exists
    if (this.sessions.has(type)) {
      return this.sessions.get(type) || null;
    }
    
    // Fall back to the default session
    return this.session;
  }
  
  /**
   * Determine the appropriate session type for a given topic
   */
  private getSessionTypeForTopic(topic: string): SessionType {
    // Determine which session to use based on the topic pattern
    if (topic === 'signal/output' || topic.startsWith('trading-signal/')) {
      return SessionType.SIGNALS;
    } else if (topic.match(/^market-data\/(SPX|DJI|NDX)$/)) {
      return SessionType.INDEX_MARKET_DATA;
    } else if (topic.startsWith('market-data/EQ/')) {
      return SessionType.STOCK_MARKET_DATA;
    } else {
      return SessionType.DEFAULT;
    }
  }

  /**
   * Publish a message to a topic
   * 
   * @param topic The topic to publish to
   * @param message The message payload to publish
   * @param sessionTypeStr Optional session type string for backwards compatibility
   */
  async publish(topic: string, message: any, sessionTypeStr?: string): Promise<void> {
    // Require a real Solace connection
    if (!this.connected) {
      throw new Error("Not connected to Solace broker");
    }
    
    console.log(`Publishing message to Solace topic ${topic}`);
    
    try {
      // Determine the appropriate session type to use
      let sessionType: SessionType;
      
      if (sessionTypeStr) {
        // Map the string session type to enum
        switch (sessionTypeStr) {
          case 'stock_market_data':
            sessionType = SessionType.STOCK_MARKET_DATA;
            break;
          case 'index_market_data':
            sessionType = SessionType.INDEX_MARKET_DATA;
            break;
          case 'signal_data':
          case 'signals':
            sessionType = SessionType.SIGNALS;
            break;
          default:
            sessionType = SessionType.DEFAULT;
        }
      } else {
        // Auto-detect based on topic pattern
        sessionType = this.getSessionTypeForTopic(topic);
      }
      
      // Get or create the appropriate session for this topic
      let session: solace.Session;
      
      // Use the specified session if it exists
      if (this.sessions.has(sessionType)) {
        session = this.sessions.get(sessionType)!;
      } else {
        // Try to create a new session for this type
        try {
          session = await this.getSession(sessionType);
          console.log(`Created new ${sessionType} session for publishing to ${topic}`);
        } catch (error) {
          // Fall back to default session if we can't create a new one
          console.warn(`Failed to create ${sessionType} session, falling back to default: ${error}`);
          // Get the default session or create it if needed
          session = this.session ? this.session : await this.getSession(SessionType.DEFAULT);
        }
      }
      
      if (!session) {
        throw new Error(`No valid Solace session for topic type: ${sessionType}`);
      }
      
      console.log(`Publishing message to topic ${topic}`);
      
      // Create the message
      const solaceMessage = solace.SolclientFactory.createMessage();
      
      // Set destination
      solaceMessage.setDestination(solace.SolclientFactory.createTopicDestination(topic));
      
      // Check if the message contains QoS settings (applied by marketDataService)
      const hasQosSettings = message && message._qos;
      
      // Set content - remove _qos from the JSON if present to avoid sending it
      const messageToSend = hasQosSettings ? { ...message } : message;
      if (hasQosSettings) {
        delete messageToSend._qos;
      }
      
      const messageStr = typeof messageToSend === 'string' ? messageToSend : JSON.stringify(messageToSend);
      solaceMessage.setBinaryAttachment(messageStr);
      
      // Apply QoS settings if provided in the message, otherwise use defaults
      if (hasQosSettings) {
        // Apply delivery mode from message QoS settings
        const deliveryModeType = message._qos.deliveryMode === "PERSISTENT" 
          ? solace.MessageDeliveryModeType.PERSISTENT 
          : solace.MessageDeliveryModeType.DIRECT;
          
        solaceMessage.setDeliveryMode(deliveryModeType);
        
        // Apply other QoS settings if available
        if (message._qos.dmqEligible !== undefined) {
          solaceMessage.setDMQEligible(Boolean(message._qos.dmqEligible));
        }
        
        if (message._qos.allowMessageEliding !== undefined) {
          solaceMessage.setElidingEligible(Boolean(message._qos.allowMessageEliding));
        }
        
        console.log(`Applied QoS settings from message to topic ${topic}:`, {
          deliveryMode: message._qos.deliveryMode,
          dmqEligible: message._qos.dmqEligible, 
          allowMessageEliding: message._qos.allowMessageEliding
        });
      } else {
        // Use default DIRECT delivery mode if no QoS settings provided
        solaceMessage.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
      }
      
      // Send the message using the appropriate session
      session.send(solaceMessage);
      
      // Log
      const shortContent = messageStr.length > 50 ? messageStr.substring(0, 47) + '...' : messageStr;
      console.log(`Published message to topic ${topic} using ${sessionType} session: ${shortContent}`);
      
      // Notify local subscribers as well (maintain consistency with previous implementation)
      const topicSubscribers = this.subscribers.get(topic);
      if (topicSubscribers) {
        topicSubscribers.forEach(callback => {
          try {
            callback(message);
          } catch (error) {
            console.error(`Error in subscriber callback for topic ${topic}:`, error);
          }
        });
      }
    } catch (error) {
      console.error(`Error publishing message to topic ${topic}:`, error);
      throw error;
    }
  }
  
  /**
   * Subscribe to a topic
   */
  async subscribe(topic: string, callback: (message: any) => void): Promise<void> {
    // Require a real Solace connection
    if (!this.connected) {
      throw new Error("Not connected to Solace broker");
    }
    
    console.log(`Subscribing to topic ${topic}`);
    
    try {
      // Get the appropriate session type for this topic (for categorization only)
      const sessionType = this.getSessionTypeForTopic(topic);
      
      // Track this subscription in our session type mapping (for monitoring and categorization)
      const subscriptions = this.sessionSubscriptions.get(sessionType) || new Set<string>();
      subscriptions.add(topic);
      this.sessionSubscriptions.set(sessionType, subscriptions);
      
      // IMPORTANT: Always use the default session for all subscriptions
      // This ensures we only use one connection to the broker
      let activeSession: solace.Session | null = null;
      
      // Use the default session if it exists
      if (this.session) {
        activeSession = this.session;
        console.log(`Using default session for topic ${topic}`);
      } 
      // If we don't have a default session but have some other session, use that
      else if (this.sessions.size > 0) {
        const existingSession = this.sessions.values().next().value;
        if (existingSession) {
          activeSession = existingSession;
          console.log(`Using existing session for topic ${topic}`);
        }
      }
      
      // Only create a new session if absolutely necessary
      if (!activeSession) {
        console.log(`Creating new default session for topic ${topic}`);
        activeSession = await this.getSession(SessionType.DEFAULT);
      }
      
      if (!activeSession) {
        throw new Error(`No valid Solace session available for topic: ${topic}`);
      }
      
      // Add to local subscribers
      if (!this.subscribers.has(topic)) {
        this.subscribers.set(topic, new Set());
        
        // Subscribe to the Solace topic using the session
        activeSession.subscribe(
          solace.SolclientFactory.createTopicDestination(topic),
          true, // generate confirmation
          topic, // correlation key
          10000 // request timeout
        );
        
        console.log(`Subscribed to topic ${topic} using single Solace connection`);
      }
      
      // Add the callback
      const topicSubscribers = this.subscribers.get(topic)!;
      topicSubscribers.add(callback);
    } catch (error) {
      console.error(`Error subscribing to topic ${topic}:`, error);
      throw error;
    }
  }
  /**
   * Unsubscribe from a topic
   * 
   * @param topic The topic to unsubscribe from
   * @param callbackOrSessionType Optional callback function or session type string. 
   *        If a callback function is provided, only that specific callback is unsubscribed.
   *        If a string is provided, it's treated as a session type for backwards compatibility.
   *        If omitted, all subscribers for this topic are removed.
   */
  async unsubscribe(topic: string, callbackOrSessionType?: ((message: any) => void) | string): Promise<void> {
    // Require a real Solace connection
    if (!this.connected) {
      return;
    }
    
    console.log(`Unsubscribing from topic ${topic}`);
    
    try {
      // Get the session type for this topic
      const sessionType = this.getSessionTypeForTopic(topic);
      
      // Always use the default session for consistency since we're using a single connection
      let activeSession: solace.Session | null = null;
      
      // Use the default session if it exists
      if (this.session) {
        activeSession = this.session;
      } 
      // If we don't have a default session but have some other session, use that
      else if (this.sessions.size > 0) {
        const existingSession = this.sessions.values().next().value;
        if (existingSession) {
          activeSession = existingSession;
        }
      }
      
      if (!activeSession) {
        console.warn(`No session found for topic ${topic}, cannot unsubscribe`);
        return;
      }
      
      // Determine if we have a callback function
      const callback = typeof callbackOrSessionType === 'function' ? callbackOrSessionType : undefined;
      
      if (callback) {
        // Remove specific subscriber
        const topicSubscribers = this.subscribers.get(topic);
        if (topicSubscribers) {
          topicSubscribers.delete(callback);
          
          // If no more subscribers, unsubscribe from the Solace topic
          if (topicSubscribers.size === 0) {
            this.subscribers.delete(topic);
            
            activeSession.unsubscribe(
              solace.SolclientFactory.createTopicDestination(topic),
              true, // generate confirmation
              topic, // correlation key
              10000 // request timeout
            );
            
            // Remove from session tracking
            const topicSubscriptions = this.sessionSubscriptions.get(sessionType);
            if (topicSubscriptions) {
              topicSubscriptions.delete(topic);
              if (topicSubscriptions.size === 0) {
                // No more topics for this session type
                this.sessionSubscriptions.set(sessionType, new Set<string>());
              }
            }
            
            console.log(`Unsubscribed from topic ${topic} using ${sessionType} session`);
          }
        }
      } else {
        // Remove all subscribers for this topic
        this.subscribers.delete(topic);
        
        activeSession.unsubscribe(
          solace.SolclientFactory.createTopicDestination(topic),
          true, // generate confirmation
          topic, // correlation key
          10000 // request timeout
        );
        
        // Remove from session tracking
        const topicSubscriptions = this.sessionSubscriptions.get(sessionType);
        if (topicSubscriptions) {
          topicSubscriptions.delete(topic);
        }
        
        console.log(`Unsubscribed from all subscribers for topic ${topic} using ${sessionType} session`);
      }
    } catch (error) {
      console.error(`Error unsubscribing from topic ${topic}:`, error);
    }
  }
  
  /**
   * Register a callback for a specific topic
   * This is different from subscribe as it doesn't add to the subscribers list
   * and is meant for event-based message processing
   */
  registerTopicCallback(topic: string, callback: (topic: string, message: any) => void): void {
    this.callbacks.set(topic, callback);
  }
  
  /**
   * Unregister a callback for a specific topic
   */
  unregisterTopicCallback(topic: string): void {
    this.callbacks.delete(topic);
  }

  /**
   * Get connection status and configuration details
   * This method provides a standardized way to check connection status
   * across all Solace service implementations
   */
  getConnectionStatus(): { 
    connected: boolean; 
    connecting: boolean; 
    currentConfig: SolaceConnection | null;
    tcpPort: string | undefined;
    lastError: string;
  } {
    return {
      connected: this.isConnected(),
      connecting: this.connecting,
      currentConfig: this.connectionConfig,
      tcpPort: this.connectionConfig?.tcpPort || "55555", // Default TCP port if not specified
      lastError: this.lastConnectionError
    };
  }
}

export const solaceService = new SolaceService();
