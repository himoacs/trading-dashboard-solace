import solace from 'solclientjs';
import { broadcastToWebSocketSubscribers } from '../routes';
import { storage } from '../storage';
import { SolaceConnection } from '@shared/schema';

/**
 * PublisherSolaceService - Dedicated service for backend market data publishing
 * This service uses the user-provided Solace credentials (with tcp:// protocol) instead of hardcoded values
 */
class PublisherSolaceService {
  private connected: boolean = false;
  private connecting: boolean = false;
  private session: solace.Session | null = null;
  private currentConfig: SolaceConnection | null = null;
  private lastConnectionError: string = "";
  private feedActive: boolean = false;
  private feedStarting: boolean = false;
  private currentUpdateFrequencyMs: number = 100; // Default frequency of 100 milliseconds
  private updateFrequency: number = 60; // Default frequency in seconds
  private lastError: string | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private deliveryMode: solace.MessageDeliveryModeType = solace.MessageDeliveryModeType.DIRECT;
  private allowMessageEliding: boolean = true;
  private dmqEligible: boolean = true;
  
  constructor() {
    // Initialize Solace client library
    try {
      const factoryProps = new solace.SolclientFactoryProperties();
      factoryProps.profile = solace.SolclientFactoryProfiles.version10;
      solace.SolclientFactory.init(factoryProps);
      console.log("Publisher Solace service initialized");
      
      // Default update frequency
      this.currentUpdateFrequencyMs = 100;
      this.updateFrequency = Math.round(this.currentUpdateFrequencyMs / 1000);
      
      // SECURITY FIX: Reset all configuration and connection state
      this.resetAllState();
      
      // SECURITY FIX: Do not automatically connect or check for configuration
      // The connection must be initiated manually through the API with user-provided credentials
      console.log("SECURITY: No automatic connection - will ONLY connect when user provides credentials");
      
      // Removed automatic connection check to ensure we ONLY connect when user explicitly provides credentials
    } catch (error) {
      console.error("Error initializing publisher Solace service:", error);
    }
  }
  
  /**
   * Reset all configuration and connection state
   * This is a critical security measure to ensure no hardcoded credentials are used
   * Public method to allow explicit resets from other system components
   */
  public resetAllState(): void {
    console.log("SECURITY: Completely resetting publisher service state");
    
    // Reset connection state
    this.connected = false;
    this.connecting = false;
    
    // Disconnect any existing session
    if (this.session) {
      try {
        // console.log("SECURITY: Disconnecting existing Solace session");
        this.session.disconnect();
      } catch (e) {
        console.error("Error disconnecting session:", e);
      }
      this.session = null;
    }
    
    // Reset configuration - IMPORTANT: this removes any stored credentials
    this.currentConfig = null;
    this.lastConnectionError = "";
    
    // Reset feed state
    this.feedActive = false;
    this.feedStarting = false;
    
    this.currentUpdateFrequencyMs = 100; // Reset frequency to 100ms
    this.lastError = null;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Reset QoS settings to their initial defaults
    this.deliveryMode = solace.MessageDeliveryModeType.DIRECT;
    this.allowMessageEliding = true;
    this.dmqEligible = true;
    
    console.log("SECURITY: Publisher service reset complete - all connection information cleared");
  }
  
  /**
   * Check if a configuration exists and connect if it does (DISABLED FOR SECURITY)
   * This method is intentionally disabled as all connections must be initiated 
   * explicitly by the user through the web interface.
   */
  private async checkAndConnect(): Promise<void> {
    // SECURITY FIX: Automatic connections are disabled
    // All connections must be initiated explicitly by the user through the web interface
    // console.log("SECURITY: Automatic Solace connections are disabled");
    // console.log("Connection can only be established with user-provided credentials via the web UI");
    return Promise.resolve();
  }
  
  /**
   * Convert database config to SolaceConnection format
   * This handles type conversion to match the expected format
   */
  private convertConfigToConnection(dbConfig: any): SolaceConnection {
    return {
      brokerUrl: dbConfig.brokerUrl,
      vpnName: dbConfig.vpnName,
      username: dbConfig.username,
      password: dbConfig.password,
      configType: dbConfig.configType || "backend",
      tcpPort: dbConfig.tcpPort || undefined
    };
  }

  /**
   * Connect to the Solace message broker using user-provided credentials
   * @param config Optional SolaceConnection config. If not provided, will try to get it from storage
   * @returns A Promise that resolves when connection completes, may return boolean false if no config found
   */
  async connect(config?: SolaceConnection): Promise<void | boolean> {
    // If already connected, return silently
    if (this.connected) {
      // console.log("Publisher already connected to Solace broker");
      return Promise.resolve();
    }
    
    // Prevent multiple simultaneous connection attempts
    if (this.connecting) {
      // console.log("Publisher connection to Solace already in progress");
      return Promise.resolve();
    }
    
    // SECURITY FIX: Always require explicit credentials
    // Never use stored configurations without explicit user action
    
    if (!config) {
      console.log("SECURITY: No Solace credentials provided for publisher service");
      // console.warn("SECURITY CHECK: Publisher service requires explicit credentials");
      // console.warn("Connection requires user-provided credentials via the UI");
      this.connecting = false;
      return false; // Return false without rejection to avoid crashing
    }
    
    // Verify this is a backend config before proceeding
    if (config.configType !== 'backend') {
      console.error("SECURITY ERROR: Non-backend config detected for publisher service");
      console.error("Publisher service MUST use backend credentials only");
      this.connecting = false;
      return false;
    }
    
    // Use the provided configuration only, never fall back to stored configs
    // console.log("Using provided backend configuration for publisher service");
    const activeConfig = config;
    
    // Store the current configuration
    this.currentConfig = config;
    
    // Ensure brokerUrl has tcp:// prefix for publisher service (instead of ws://)
    let brokerUrl = this.currentConfig.brokerUrl;
    const defaultTcpPort = "55555"; // Default port for TCP connections
    
    // Check if there's a specified TCP port in the config
    const tcpPort = this.currentConfig.tcpPort || defaultTcpPort;
    
    // Extract the host part without protocol and port
    let hostPart = brokerUrl;
    
    // Extract just the hostname from any protocol and port
    if (brokerUrl.startsWith('ws://')) {
      hostPart = brokerUrl.replace('ws://', '').split(':')[0];
    } else if (brokerUrl.startsWith('wss://')) {
      hostPart = brokerUrl.replace('wss://', '').split(':')[0];
    } else if (brokerUrl.startsWith('tcp://')) {
      hostPart = brokerUrl.replace('tcp://', '').split(':')[0];
    } else if (brokerUrl.startsWith('tcps://')) {
      hostPart = brokerUrl.replace('tcps://', '').split(':')[0];
    } else {
      // If no protocol, just extract hostname in case there's a port
      hostPart = brokerUrl.split(':')[0];
    }
    
    // Always use tcp:// protocol with provided TCP port
    brokerUrl = `tcp://${hostPart}:${tcpPort}`;
    
    console.log(`Publisher connecting to Solace broker at ${brokerUrl}`);
    
    try {
      // Set connecting flag to prevent duplicate connections
      this.connecting = true;
      
      // Return a promise that resolves when connected
      return new Promise((resolve, reject) => {
        try {
          // Create session properties with user-provided credentials but tcp:// protocol
          const sessionProperties = new solace.SessionProperties({
            url: brokerUrl,
            vpnName: activeConfig.vpnName,
            userName: activeConfig.username,
            password: activeConfig.password,
            clientName: `SolCapital_Publisher_${Date.now()}`,
            connectRetries: 3,
            reconnectRetries: 5,
            connectTimeoutInMsecs: 10000,
            reconnectRetryWaitInMsecs: 3000,
            publisherProperties: {
              acknowledgeMode: solace.MessagePublisherAcknowledgeMode.PER_MESSAGE
            }
          });
          
          // Create a session for publishing
          const session = solace.SolclientFactory.createSession(sessionProperties);
          
          // Define session event listeners
          session.on(solace.SessionEventCode.UP_NOTICE, () => {
            console.log("Publisher successfully connected to Solace broker using user credentials");
            this.session = session;
            this.connected = true;
            this.connecting = false;
            resolve();
          });
          
          session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (err) => {
            console.error("Publisher connection to Solace broker failed:", JSON.stringify(err));
            this.connecting = false;
            
            // Instead of rejecting, resolve and set an error message
            // This allows the app to continue without crashing
            this.lastConnectionError = err.toString();
            resolve();
          });
          
          session.on(solace.SessionEventCode.DISCONNECTED, () => {
            console.log("Publisher disconnected from Solace broker");
            this.session = null;
            this.connected = false;
          });
          
          // Connect
          session.connect();
        } catch (error) {
          console.error("Error creating publisher Solace session:", error);
          this.connecting = false;
          reject(error);
        }
      });
    } catch (error) {
      console.error('Error connecting publisher to Solace:', error);
      this.connecting = false;
      throw error;
    }
  }
  
  /**
   * Disconnect from the Solace message broker
   */
  async disconnect(): Promise<void> {
    // Already disconnected
    if (!this.connected || !this.session) {
      console.log("Publisher already disconnected from Solace broker");
      return Promise.resolve();
    }
    
    console.log("Publisher disconnecting from Solace broker");
    
    return new Promise((resolve) => {
      try {
        // Add a one-time disconnected event handler
        this.session!.on(solace.SessionEventCode.DISCONNECTED, () => {
          console.log("Publisher disconnected from Solace broker");
          this.session = null;
          this.connected = false;
          this.connecting = false;
          resolve();
        });
        
        // Disconnect
        this.session!.disconnect();
      } catch (error) {
        console.error('Error disconnecting publisher from Solace:', error);
        
        // Force cleanup even if an error occurs
        this.session = null;
        this.connected = false;
        this.connecting = false;
        resolve();
      }
    });
  }
  
  /**
   * Check if connected to the Solace message broker
   */
  isConnected(): boolean {
    return this.connected && this.session !== null;
  }
  
  /**
   * Get the current connection status and config information
   */
  getConnectionStatus(): { 
    connected: boolean, 
    connecting: boolean, 
    connectionInfo: {
      configType: string,
      isConfigPresent: boolean
    },
    tcpPort: string, 
    lastError: string,
    feedActive: boolean,
    feedStarting: boolean,
    messageOptions: {
      deliveryMode: "DIRECT" | "PERSISTENT",
      allowMessageEliding: boolean,
      dmqEligible: boolean
    },
    updateFrequency: number,
    frequencyMs: number
  } {
    // SECURITY FIX: Only report as connected if we actually have user credentials and a valid session
    const reallyConnected = this.connected && this.session !== null && this.currentConfig !== null;
    
    // SECURITY FIX: Don't return actual credentials, only connection status
    return {
      connected: reallyConnected, // Only report as connected with valid credentials and session
      connecting: this.connecting,
      connectionInfo: {
        configType: this.currentConfig?.configType || 'none',
        isConfigPresent: this.currentConfig !== null
      },
      tcpPort: this.currentConfig?.brokerUrl.startsWith('tcp') ? this.currentConfig.brokerUrl.split(':').pop() || '' : '',
      lastError: this.lastConnectionError, // Include last connection error
      feedActive: reallyConnected ? this.feedActive : false, // Can't have active feed without connection
      feedStarting: reallyConnected ? this.feedStarting : false, // Can't be starting without connection
      messageOptions: {
        deliveryMode: this.deliveryMode === solace.MessageDeliveryModeType.PERSISTENT ? "PERSISTENT" : "DIRECT",
        allowMessageEliding: this.allowMessageEliding,
        dmqEligible: this.dmqEligible
      },
      updateFrequency: this.updateFrequency, // Report in seconds for compatibility
      frequencyMs: this.currentUpdateFrequencyMs // Also report in ms
    };
  }
  
  /**
   * Set the feed active status - controls whether market data is published
   * @param active Whether the feed should be active
   */
  setFeedActive(active: boolean): boolean {
    // console.log(`Explicitly ${active ? 'activating' : 'deactivating'} market data feed (Platform: ${process.platform})`);
    
    // Store previous state for comparison
    const previousActive = this.feedActive;
    this.feedActive = active;
    
    // For macOS, we need special handling to ensure events fire correctly
    if (process.platform === 'darwin' && active && !previousActive) {
      // console.log("macOS platform detected - using delayed activation for market data feed");
      
      // We need to use setTimeout to ensure the event loop processes correctly on macOS
      setTimeout(() => {
        // console.log("macOS delayed feed activation executing");
        this.feedActive = true;
        
        // Verify the state was properly set
        // console.log(`Feed active verification after delay: ${this.feedActive}`);
      }, 100);
    }
    
    // If activating and not connected, log a warning
    if (active && !this.connected) {
      console.warn("WARNING: Market data feed activated but no Solace connection is available. Data will not be published until connected.");
    }
    
    // Log clear status message
    if (active) {
      console.log("✓ Feed active: Market data will be published to Solace (if connected)");
    } else {
      console.log("✗ Feed inactive: Market data will NOT be published to Solace");
    }
    
    return this.feedActive;
  }
  
  /**
   * Start the market data feed
   */
  async startFeed(): Promise<{ 
    success: boolean, 
    feedActive: boolean,
    connected: boolean
  }> {
    return new Promise((resolve, reject) => {
      // console.log(`publisherSolaceService.startFeed() called (Platform: ${process.platform})`);
      // console.log("Initial state:", {
      //   feedActive: this.feedActive,
      //   feedStarting: this.feedStarting,
      //   connected: this.connected
      // });
      
      // Set flag to indicate feed is starting to prevent race conditions
      this.feedStarting = true;
      // console.log("Set feedStarting to true");
      
      // CRITICAL: Always set feedActive to true immediately - essential for macOS
      this.feedActive = true;
      // console.log("Set feedActive to true immediately to ensure activation");
      
      try {
        // Enhanced macOS compatibility for market data feed
        if (process.platform === 'darwin') {
          // console.log("macOS platform detected - using enhanced activation sequence");
          
          // Multiple approaches to ensure reliable activation on macOS
          
          // 1. Force state updates with immediate effect
          this.feedActive = true;
          
          // 2. Set up a redundant activation with minimal delay for macOS reliability
          setTimeout(() => {
            try {
              // Use arrow function to preserve context
              // console.log("macOS delayed feed activation executing");
              
              // Double-check feed is still active (prevent race conditions)
              if (!this.feedActive) {
                // console.log("Reapplying feed active state for macOS");
                this.feedActive = true;
              }
              
              // Verify the state was properly set
              // console.log(`Feed active verification after macOS optimization: ${this.feedActive}`);
              
              // Complete the setup regardless of platform (inside setTimeout for macOS)
              this.feedStarting = false;
              // console.log("Set feedStarting back to false (macOS path)");

              if (this.connected) {
                // console.log("Market data feed started successfully - connection active (macOS path)");
              } else {
                // console.log("Market data feed activated but connection not available - will publish when connected (macOS path)");
              }
              
              const result = {
                success: true,
                feedActive: this.feedActive,
                connected: this.connected
              };
              // console.log("Resolving result from startFeed (macOS path):", result);
              resolve(result);
            } catch (macOsError) {
              console.error("Error during macOS delayed feed activation:", macOsError);
              this.feedActive = false;
              this.feedStarting = false;
              reject(macOsError); // Reject the main promise if setTimeout callback fails
            }
          }, 10); // Ultra-short delay for macOS
        } else {
          // Non-macOS path: complete synchronously
          this.feedStarting = false;
          // console.log("Set feedStarting back to false (non-macOS path)");

          if (this.connected) {
            // console.log("Market data feed started successfully - connection active (non-macOS path)");
          } else {
            // console.log("Market data feed activated but connection not available - will publish when connected (non-macOS path)");
          }
          
          const result = {
            success: true,
            feedActive: this.feedActive,
            connected: this.connected
          };
          // console.log("Resolving result from startFeed (non-macOS path):", result);
          resolve(result);
        }
      } catch (error) {
        console.error("Error starting market data feed (outer try-catch):", error);
        this.feedActive = false;
        this.feedStarting = false;
        console.log("Error occurred, set feedActive and feedStarting to false");
        
        // Reject the promise with the error
        reject(error);
      }
    });
  }
  
  /**
   * Stop the market data feed
   */
  stopFeed(): { 
    success: boolean, 
    feedActive: boolean,
    connected: boolean
  } {
    try {
      // Deactivate the feed
      this.feedActive = false;
      this.feedStarting = false;
      
      console.log("✓ Market data feed stopped - no data will be published");
      
      return {
        success: true,
        feedActive: false,
        connected: this.connected
      };
    } catch (error) {
      console.error("Error stopping market data feed:", error);
      
      // Ensure feed is deactivated even if error occurs
      this.feedActive = false;
      this.feedStarting = false;
      
      return {
        success: true, // Still return success since we've deactivated the feed
        feedActive: false,
        connected: this.connected
      };
    }
  }
  
  /**
   * Check if the market data feed is active
   */
  isFeedActive(): boolean {
    return this.feedActive;
  }
  
  /**
   * Set the update frequency for the publisher service in milliseconds
   * @param frequencyMs How often to publish messages (in milliseconds)
   * @returns Whether the update was successful
   */
  public setUpdateFrequencyMs(frequencyMs: number): boolean {
    // Updated validation to match API route: 10ms to 60000ms
    if (frequencyMs < 10 || frequencyMs > 60000) {
        console.warn(`Invalid frequency ${frequencyMs}ms - must be between 10 and 60000 milliseconds for market data. Publisher frequency NOT changed.`);
        return false; // Indicate failure or invalid value
    }
    // Store the current frequency before changing, in case we need to revert or compare
    const previousFrequencyMs = this.currentUpdateFrequencyMs;
    this.currentUpdateFrequencyMs = frequencyMs;
    this.updateFrequency = Math.round(this.currentUpdateFrequencyMs / 1000); // updateFrequency is in seconds

    console.log(`Publisher service update frequency changed from ${previousFrequencyMs}ms to ${this.currentUpdateFrequencyMs}ms (${this.updateFrequency}s)`);
    
    // If the feed is active, we need to stop and restart the interval with the new frequency
    if (this.feedActive) {
      this.stopFeed();
      this.startFeed();
    }
    
    return true;
  }
  
  /**
   * Set the update frequency for the publisher service (legacy support)
   * @param frequencySeconds How often to publish messages (in seconds)
   * @returns The current update frequency in seconds
   */
  setUpdateFrequency(frequencySeconds: number): number {
    // Convert seconds to milliseconds and use the new method
    const frequencyMs = frequencySeconds * 1000;
    this.setUpdateFrequencyMs(frequencyMs);
    
    // Return the current frequency in seconds for backward compatibility
    return Math.round(this.currentUpdateFrequencyMs / 1000);
  }
  
  /**
   * Set message delivery options for Market Data
   * @param options Options for message delivery
   * @returns Whether the update was successful
   */
  async setMessageOptions(options: {
    deliveryMode?: "DIRECT" | "PERSISTENT";
    allowMessageEliding?: boolean | string;
    dmqEligible?: boolean | string;
  }): Promise<boolean> {
    try {
      // Log received options with details for debugging
      // console.log("MarketDataPublisherService received message options:", JSON.stringify({
      //   receivedDeliveryMode: options.deliveryMode,
      //   receivedEliding: options.allowMessageEliding,
      //   receivedDmq: options.dmqEligible,
      //   typeof_deliveryMode: typeof options.deliveryMode,
      //   typeof_allowMessageEliding: typeof options.allowMessageEliding,
      //   typeof_dmqEligible: typeof options.dmqEligible
      // }));
      
      // Output current settings for debugging
      // console.log("Market Data Publisher BEFORE update:", {
      //   currentDeliveryMode: this.deliveryMode === solace.MessageDeliveryModeType.PERSISTENT ? "PERSISTENT" : "DIRECT",
      //   currentEliding: this.allowMessageEliding,
      //   currentDmq: this.dmqEligible
      // });
      
      // Apply default values if needed and ensure proper type conversion
      const deliveryModeString = options.deliveryMode || "DIRECT";
      
      // Explicitly convert to boolean with proper type handling to ensure correct behavior
      let allowMessageEliding = true;
      if (options.allowMessageEliding !== undefined) {
        // Handle string conversion explicitly
        if (typeof options.allowMessageEliding === 'string') {
          const stringValue = options.allowMessageEliding as string;
          allowMessageEliding = stringValue.toLowerCase() === 'true';
        } else {
          // For non-string types, use Boolean constructor
          allowMessageEliding = Boolean(options.allowMessageEliding);
        }
      }
      
      let dmqEligible = true;
      if (options.dmqEligible !== undefined) {
        // Handle string conversion explicitly
        if (typeof options.dmqEligible === 'string') {
          const stringValue = options.dmqEligible as string;
          dmqEligible = stringValue.toLowerCase() === 'true';
        } else {
          // For non-string types, use Boolean constructor
          dmqEligible = Boolean(options.dmqEligible);
        }
      }
      
      // Validate deliveryMode
      if (deliveryModeString !== "DIRECT" && deliveryModeString !== "PERSISTENT") {
        console.error(`Invalid deliveryMode value: ${deliveryModeString}. Must be "DIRECT" or "PERSISTENT"`);
        return false;
      }
      
      // Update QoS settings
      this.deliveryMode = deliveryModeString === "PERSISTENT" 
        ? solace.MessageDeliveryModeType.PERSISTENT 
        : solace.MessageDeliveryModeType.DIRECT;
      this.allowMessageEliding = allowMessageEliding;
      this.dmqEligible = dmqEligible;
      
      // Create special log entry for message options that will stand out in logs
      console.log("================================================================");
      console.log(`✅ MARKET DATA PUBLISHER QOS SETTINGS UPDATED: DeliveryMode: ${this.deliveryMode === solace.MessageDeliveryModeType.PERSISTENT ? "PERSISTENT" : "DIRECT"}, Eliding: ${this.allowMessageEliding}, DMQ: ${this.dmqEligible}`);
      // console.log(`   → Delivery Mode: ${this.deliveryMode}`);
      // console.log(`   → Allow Message Eliding: ${this.allowMessageEliding} (${typeof this.allowMessageEliding})`);
      // console.log(`   → DMQ Eligible: ${this.dmqEligible} (${typeof this.dmqEligible})`);
      console.log("================================================================");
      
      return true;
    } catch (error) {
      console.error('Error setting Market Data message options:', error);
      return false;
    }
  }
  
  /**
   * Publish a message to a topic with enhanced reliability and security checks
   */
  async publish(topic: string, message: any): Promise<void> {
    // SECURITY CHECK: Verify we're using a backend connection before publishing
    if (!this.currentConfig || this.currentConfig.configType !== 'backend') {
      const error = "CRITICAL SECURITY ERROR: Cannot publish using non-backend connection";
      console.error(error);
      throw new Error(error);
    }
    // Initial connection check
    if (!this.connected || !this.session) {
      throw new Error("Publisher not connected to Solace broker");
    }
    
    // Initial feed activity check
    if (!this.feedActive) {
      console.log(`Feed not active - skipping publish to ${topic}`);
      return Promise.resolve();
    }
    
    // ENHANCED RELIABILITY: Perform an additional connection check
    // Check at the last moment if we're still connected
    if (!this.connected || !this.session) {
      console.error(`Cannot publish to topic ${topic}: Session no longer connected or null`);
      throw new Error(`Publisher session no longer connected`);
    }
    
    // Another feedActive check right before publishing
    if (!this.feedActive) {
      console.error(`Feed became inactive during preparation for topic ${topic}`);
      throw new Error('Feed is no longer active');
    }
    
    return new Promise((resolve, reject) => {
      try {
        // Create a message
        const solaceMessage = solace.SolclientFactory.createMessage();
        
        // Set the destination
        solaceMessage.setDestination(solace.SolclientFactory.createTopicDestination(topic));
        
        // ENHANCED QOS SETTINGS: Use the internal solace.MessageDeliveryModeType directly
        solaceMessage.setDeliveryMode(this.deliveryMode);
        
        // Ensure proper boolean conversion and application of settings
        const dmqEligible = Boolean(this.dmqEligible);
        const allowEliding = Boolean(this.allowMessageEliding);
        
        solaceMessage.setDMQEligible(dmqEligible);
        solaceMessage.setElidingEligible(allowEliding);
        
        // Add enhanced debug logging specifically for QoS settings
        // console.log(`[SOLACE QOS] Message to ${topic}:`, {
        //   deliveryMode: this.deliveryMode === solace.MessageDeliveryModeType.PERSISTENT ? "PERSISTENT" : "DIRECT",
        //   solaceDeliveryModeType: this.deliveryMode,
        //   dmqEligible: dmqEligible,
        //   allowMessageEliding: allowEliding,
        //   messageProperties: {
        //     getDeliveryMode: solaceMessage.getDeliveryMode(),
        //     getDMQEligible: solaceMessage.isDMQEligible(), 
        //     getElidingEligible: solaceMessage.isElidingEligible()
        //   }
        // });
        
        // Convert message to JSON string and set as payload
        const messageText = (typeof message === 'string') ? message : JSON.stringify(message);
        solaceMessage.setBinaryAttachment(messageText);
        
        // Set a message ID for potential correlation
        solaceMessage.setCorrelationId(topic + '-' + Date.now());
        
        // Before sending to Solace, also broadcast to WebSocket clients for debug panel
        try {
          // Format the message for WebSocket clients with topic and type information
          const wsMessage = {
            type: topic.includes('market-data') ? 'market-data' : 
                  topic.includes('twitter-feed') ? 'twitter-feed' : 
                  topic.includes('trading-signal') ? 'trading-signal' : 
                  topic,
            topic: topic,
            data: message,
            symbol: message.symbol || '',
            timestamp: new Date().toISOString(),
            rawData: messageText, // Include raw data for debugging
            direction: 'outgoing' // Mark as outgoing message for debug panel
          };
          
          // Broadcast to all WebSocket clients subscribed to this topic
          broadcastToWebSocketSubscribers(topic, wsMessage);
        } catch (wsError) {
          console.error(`Error broadcasting message to WebSocket clients:`, wsError);
          // Continue with Solace publish even if WebSocket broadcast fails
        }
        
        // Send the message to Solace with enhanced QoS tracing and double-checks
        try {
          // ENHANCED RELIABILITY: Final connection check right before send
          if (!this.session || !this.connected) {
            console.error(`Final check failed: Cannot send to topic ${topic}: Session no longer connected or null`);
            this.connected = false; // Reset connected flag to match actual state
            reject(new Error(`Publisher session no longer connected in final check`));
            return;
          }
          
          // ENHANCED RELIABILITY: Final feed activity check right before send
          if (!this.feedActive) {
            console.error(`Final check failed: Feed became inactive during message preparation for topic ${topic}`);
            reject(new Error('Feed is no longer active'));
            return;
          }
          
          // Log the final message settings right before sending (reduced logging to avoid spam)
          //if (Math.random() < 0.001) { // Only log 0.1% of messages (very infrequent)
          //  console.log(`[SOLACE PUBLISH] Sending message to ${topic} with final settings:`, {
          //    deliveryMode: solaceMessage.getDeliveryMode() === solace.MessageDeliveryModeType.PERSISTENT ? "PERSISTENT" : "DIRECT",
          //    dmqEligible: solaceMessage.isDMQEligible(),
          //    elidingEligible: solaceMessage.isElidingEligible()
          //  });
          //}
          
          // Send the message with the QoS settings applied above
          this.session.send(solaceMessage);
          resolve();
        } catch (sendError) {
          console.error(`Error sending message to topic ${topic}:`, sendError);
          reject(sendError);
        }
      } catch (error) {
        console.error(`Error creating message for topic ${topic}:`, error);
        reject(error);
      }
    });
  }

  // Logging helper
  private log(message: string) {
    console.log(`[PublisherSolaceService] ${message}`);
  }
}

// Export a singleton instance
export const publisherSolaceService = new PublisherSolaceService();