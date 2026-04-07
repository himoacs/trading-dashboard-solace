/**
 * Twitter Feed Publisher Service
 * 
 * Dedicated service for publishing Twitter feed messages to Solace
 * using the user-provided Solace credentials with tcp:// protocol.
 */
import solace from "solclientjs";
import { storage } from "../storage";
import { SolaceConnection } from "@shared/schema";

class TwitterPublisherService {
  private session: solace.Session | null = null;
  private connected: boolean = false;
  private connecting: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000; // 5 seconds initial delay
  private messageQueue: { topic: string, message: any }[] = [];
  private messageQueueProcessing: boolean = false;
  private lastConnectionError: string = "";
  private publishingEnabled: boolean = true;
  private currentConfig: SolaceConnection | null = null;
  private feedActive: boolean = false;
  private feedStarting: boolean = false;
  private tweetFrequencySeconds: number = 30; // Default frequency in seconds (now 30s)
  private tweetFrequencyMs: number = 30000; // Default frequency of 30 seconds (30000 milliseconds)
  private tweetTimer: NodeJS.Timeout | null = null; // Timer for scheduled tweets
  private activeSymbols: Set<string> = new Set(); // Store active symbols for tweet publishing
  
  // QoS settings
  private deliveryMode: "DIRECT" | "PERSISTENT" = "DIRECT";
  private allowMessageEliding: boolean = true;
  private dmqEligible: boolean = true;

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
  
  constructor() {
    console.log("Initializing TwitterPublisherService - will use user-provided credentials");
    
    // Initialize Solace factory
    try {
      const factoryProps = new solace.SolclientFactoryProperties();
      factoryProps.profile = solace.SolclientFactoryProfiles.version10;
      solace.SolclientFactory.init(factoryProps);
      console.log("Successfully initialized Solace factory for Twitter publisher");
    } catch (error) {
      console.log("Solace factory may already be initialized, continuing");
    }
    
    // Do not connect immediately - wait for explicit connect call with config
    console.log("TwitterPublisherService initialized but not connected - waiting for configuration");
    
    // Set up a periodic connection check to ensure we stay connected once configured
    setInterval(() => {
      if (!this.connected && !this.connecting && this.currentConfig) {
        console.log("TwitterPublisherService connection check - reconnecting with stored config...");
        this.connect().catch(console.error);
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Connect to Solace using the user-provided credentials (with tcp:// protocol)
   * @param config Optional SolaceConnection config. If not provided, will try to get it from storage
   */
  async connect(config?: SolaceConnection): Promise<boolean> {
    // If already connected, return silently
    if (this.connected) {
      console.log("TWITTER_PUB: Already connected to Solace broker");
      return Promise.resolve(true);
    }
    
    // Prevent multiple simultaneous connection attempts
    if (this.connecting) {
      console.log("TWITTER_PUB: Connection to Solace already in progress");
      return Promise.resolve(false); // Indicate that a new connection was not initiated by this call
    }
    
    console.log("TWITTER_PUB: Attempting to connect.");
    this.lastConnectionError = ""; // Clear last error

    if (!config) {
      console.error("TWITTER_PUB: ERROR - No Solace credentials provided for publisher service.");
        this.connecting = false;
      this.lastConnectionError = "No configuration provided.";
      return Promise.resolve(false);
    }
    
    if (config.configType !== 'backend') {
      console.error("TWITTER_PUB: SECURITY ERROR - Non-backend config detected.");
        this.connecting = false;
      this.lastConnectionError = "Non-backend config provided.";
      return Promise.resolve(false);
      }
      
    console.log("TWITTER_PUB: Using provided backend configuration.");
    const activeConfig = config;
    this.currentConfig = config;
    
    let brokerUrl = this.currentConfig.brokerUrl;
    const defaultTcpPort = "55555";
    const tcpPort = this.currentConfig.tcpPort || defaultTcpPort;
    let hostPart = brokerUrl;
    
    if (brokerUrl.startsWith('ws://')) hostPart = brokerUrl.replace('ws://', '').split(':')[0];
    else if (brokerUrl.startsWith('wss://')) hostPart = brokerUrl.replace('wss://', '').split(':')[0];
    else if (brokerUrl.startsWith('tcp://')) hostPart = brokerUrl.replace('tcp://', '').split(':')[0];
    else if (brokerUrl.startsWith('tcps://')) hostPart = brokerUrl.replace('tcps://', '').split(':')[0];
    else hostPart = brokerUrl.split(':')[0];
    
    brokerUrl = `tcp://${hostPart}:${tcpPort}`;
    console.log(`TWITTER_PUB: Connecting to Solace broker at ${brokerUrl}`);
    
    try {
      this.connecting = true;
      return new Promise((resolve, reject) => {
        try {
          const sessionProperties = new solace.SessionProperties({
            url: brokerUrl,
            vpnName: activeConfig.vpnName,
            userName: activeConfig.username,
            password: activeConfig.password,
            clientName: `SolCapital_TwitterPub_${Date.now()}`,
            connectRetries: 3,
            reconnectRetries: 5,
            connectTimeoutInMsecs: 10000,
            reconnectRetryWaitInMsecs: 3000,
            publisherProperties: {
              acknowledgeMode: solace.MessagePublisherAcknowledgeMode.PER_MESSAGE
            }
          });
          const session = solace.SolclientFactory.createSession(sessionProperties);
          
          session.on(solace.SessionEventCode.UP_NOTICE, () => {
            console.log("TWITTER_PUB: Successfully connected to Solace broker.");
            this.session = session;
            this.connected = true;
            this.connecting = false;
            this.reconnectAttempts = 0;
            this.lastConnectionError = "";
            if (this.feedActive) {
              console.log("TWITTER_PUB: Feed is active - ensuring tweet scheduler runs after connection.");
              this.scheduleRegularTweets();
            }
            this.processMessageQueue();
            resolve(true);
          });
          
          session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (event: solace.SessionEvent) => {
            console.error("TWITTER_PUB: Connection to Solace broker FAILED:", JSON.stringify(event));
            this.connecting = false;
            this.lastConnectionError = event.infoStr || "Connection failed";
            this.currentConfig = null; // Clear config on failure
            resolve(false); // Resolve with false instead of rejecting
          });
          
          session.on(solace.SessionEventCode.DISCONNECTED, (event: solace.SessionEvent) => {
            console.log("TWITTER_PUB: Disconnected from Solace broker.", event ? JSON.stringify(event) : '');
            this.session = null;
            this.connected = false;
            this.lastConnectionError = event.infoStr || "Disconnected";
          });

          session.on(solace.SessionEventCode.RECONNECTING_NOTICE, (event: solace.SessionEvent) => {
            console.log("TWITTER_PUB: Reconnecting to Solace broker...", JSON.stringify(event));
            this.connecting = true; // Explicitly set connecting during reconnect attempts
            this.connected = false;
          });

          session.on(solace.SessionEventCode.RECONNECTED_NOTICE, (event: solace.SessionEvent) => {
            console.log("TWITTER_PUB: Successfully RECONNECTED to Solace broker.", JSON.stringify(event));
            this.connected = true;
            this.connecting = false;
            this.lastConnectionError = "";
            if (this.feedActive) {
              console.log("TWITTER_PUB: Feed is active - ensuring tweet scheduler runs after reconnection.");
              this.scheduleRegularTweets();
            }
            this.processMessageQueue();
          });
          
          console.log("TWITTER_PUB: Initiating session.connect().");
          session.connect();
        } catch (error) {
          console.error("TWITTER_PUB: Error creating Solace session:", error);
          this.connecting = false;
          this.lastConnectionError = error instanceof Error ? error.message : String(error);
          this.currentConfig = null; // Clear config on error
          reject(error); // This catch is for synchronous errors in session creation
        }
      });
    } catch (error) {
      console.error('TWITTER_PUB: Outer error connecting to Solace:', error);
      this.connecting = false;
      this.lastConnectionError = error instanceof Error ? error.message : String(error);
      this.currentConfig = null; // Clear config on error
      // throw error; // Propagating this might crash, better to return Promise.resolve(false)
      return Promise.resolve(false);
    }
  }

  /**
   * Disconnect from Solace
   */
  async disconnect(): Promise<void> {
    // Already disconnected
    if (!this.connected || !this.session) {
      console.log("Twitter publisher already disconnected from Solace broker");
      return Promise.resolve();
    }
    
    console.log("Twitter publisher disconnecting from Solace broker");
    
    return new Promise((resolve) => {
      try {
        // Add a one-time disconnected event handler
        this.session!.on(solace.SessionEventCode.DISCONNECTED, () => {
          console.log("Twitter publisher disconnected from Solace broker");
          this.session = null;
          this.connected = false;
          this.connecting = false;
          
          // Stop the tweet scheduler when disconnecting to prevent phantom tweets
          if (this.tweetTimer) {
            console.log("Stopping tweet scheduler due to disconnection");
            this.stopTweetTimer();
          }
          
          resolve();
        });
        
        // Disconnect
        this.session!.disconnect();
      } catch (error) {
        console.error('Error disconnecting Twitter publisher from Solace:', error);
        
        // Force cleanup even if an error occurs
        this.session = null;
        this.connected = false;
        this.connecting = false;
        
        // Stop the tweet scheduler on error as well
        if (this.tweetTimer) {
          console.log("Stopping tweet scheduler due to disconnection error");
          this.stopTweetTimer();
        }
        
        resolve();
      }
    });
  }

  /**
   * Publish a tweet message to Solace
   * @param topic The topic to publish to (format: twitter-feed/{SYMBOL})
   * @param message The message to publish
   */
  async publish(topic: string, message: any): Promise<boolean> {
    // SECURITY CHECK: Verify we're using a backend connection before publishing
    if (!this.currentConfig || this.currentConfig.configType !== 'backend') {
      const error = "CRITICAL SECURITY ERROR: Cannot publish Twitter data using non-backend connection";
      console.error(error);
      return false; // Return false instead of throwing to maintain compatibility
    }
    
    // Check if publishing is enabled and feed is active
    if (!this.publishingEnabled || !this.feedActive) {
      console.log(`Twitter publishing disabled or feed not active - not publishing to ${topic}`);
      return false;
    }
    
    // Validate that it's a twitter-feed topic
    if (!topic.startsWith('twitter-feed/')) {
      console.error(`Invalid topic for Twitter publisher: ${topic} - must start with 'twitter-feed/'`);
      return false;
    }
    
    // If not connected, queue the message and attempt to connect
    if (!this.connected || !this.session) {
      console.log(`Twitter publisher not connected - queueing message for topic ${topic}`);
      this.messageQueue.push({ topic, message });
      
      // Attempt to connect if not already connecting
      if (!this.connecting) {
        // Use a promise to better handle connection attempts
        try {
          await this.connect();
          // If we successfully connected, try to process the queue
          if (this.connected && this.session) {
            this.processMessageQueue();
            return true;
          }
        } catch (error) {
          console.error("Failed to connect Twitter publisher while trying to publish:", error);
        }
      }
      
      return false;
    }
    
    try {
      // Create a message
      const solaceMessage = solace.SolclientFactory.createMessage();
      
      // Set the destination
      solaceMessage.setDestination(solace.SolclientFactory.createTopicDestination(topic));
      
      // Set the message delivery mode based on configuration
      const deliveryModeType = this.deliveryMode === "PERSISTENT" 
        ? solace.MessageDeliveryModeType.PERSISTENT 
        : solace.MessageDeliveryModeType.DIRECT;
      solaceMessage.setDeliveryMode(deliveryModeType);
      
      // Set message eligibility for Dead Message Queue (DMQ)
      solaceMessage.setDMQEligible(this.dmqEligible);
      
      // Set message eliding eligibility (allows broker to skip messages if consumers are falling behind)
      solaceMessage.setElidingEligible(this.allowMessageEliding);
      
      // Convert message to JSON string and set as payload
      const messageText = (typeof message === 'string') ? message : JSON.stringify(message);
      solaceMessage.setBinaryAttachment(messageText);
      
      // Log QoS settings being used - use console.log for better visibility in logs
      // console.log(`[TwitterMessageQoS] Publishing to topic ${topic} with properties:`, {
      //  deliveryMode: this.deliveryMode,
      //  dmqEligible: this.dmqEligible,
      //  allowMessageEliding: this.allowMessageEliding,
      //  actualDeliveryMode: this.deliveryMode === "PERSISTENT" ? "PERSISTENT" : "DIRECT"
      // });
      
      // Send the message
      this.session.send(solaceMessage);
      // console.log(`Published message to topic ${topic} using dedicated Twitter publisher session`);
      return true;
    } catch (error) {
      console.error(`Error publishing message to topic ${topic}:`, error);
      
      // Queue the message for retry
      this.messageQueue.push({ topic, message });
      
      // If session is supposedly connected but publishing failed, check connection
      if (this.connected && this.session) {
        console.log("Publishing error may indicate connection issue - checking connection");
        
        // Don't immediately disconnect/reconnect - just check connection
        // This helps prevent the connection churn
        try {
          // Check if session is still valid
          if (this.session) {
            // Mark as disconnected first - will be reset if connection is valid
            this.connected = false;
            
            // Try to reconnect if not already connecting
            if (!this.connecting) {
              console.log("Attempting to reconnect Twitter publisher...");
              this.connect().catch(error => {
                console.error("Failed to reconnect Twitter publisher after publish error:", error);
              });
            }
          }
        } catch (err) {
          console.error("Error checking Twitter publisher session state:", err);
        }
      }
      
      return false;
    }
  }

  /**
   * Process any queued messages
   */
  private async processMessageQueue(): Promise<void> {
    // If already processing, not connected, or queue is empty, exit early
    if (this.messageQueueProcessing || this.messageQueue.length === 0) {
      return;
    }
    
    // If not connected, try to connect first
    if (!this.connected) {
      console.log(`Twitter publisher not connected - attempting to connect before processing ${this.messageQueue.length} queued messages`);
      try {
        await this.connect();
      } catch (error) {
        console.error("Failed to connect Twitter publisher while trying to process queue:", error);
        return; // Exit early if can't connect
      }
    }
    
    // Set processing flag to prevent concurrent processing
    this.messageQueueProcessing = true;
    
    try {
      console.log(`Processing Twitter publisher message queue: ${this.messageQueue.length} messages`);
      
      // Create a copy of the queue and clear the original to avoid processing the same messages multiple times
      const queueCopy = [...this.messageQueue];
      this.messageQueue = [];
      
      // Track messages that failed to publish so we can retry them
      const failedMessages: { topic: string, message: any }[] = [];
      
      // Process all messages in the queue copy
      for (const queueItem of queueCopy) {
        const { topic, message } = queueItem;
        
        try {
          // Skip regular publish method to avoid infinite recursion
          // Create a message
          const solaceMessage = solace.SolclientFactory.createMessage();
          
          // Set the destination
          solaceMessage.setDestination(solace.SolclientFactory.createTopicDestination(topic));
          
          // Set the message delivery mode
          solaceMessage.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
          
          // Convert message to JSON string and set as payload
          const messageText = (typeof message === 'string') ? message : JSON.stringify(message);
          solaceMessage.setBinaryAttachment(messageText);
          
          // Only try to send if we have a valid session
          if (this.session && this.connected) {
            // Send the message
            this.session.send(solaceMessage);
            console.log(`Published queued message to topic ${topic}`);
            
            // Small delay to avoid flooding
            await new Promise(resolve => setTimeout(resolve, 50));
          } else {
            // Add back to failed messages if session isn't available
            failedMessages.push({ topic, message });
            console.log(`Cannot publish queued message to ${topic} - no active session`);
          }
        } catch (error) {
          console.error(`Error publishing queued message to ${topic}:`, error);
          
          // Add to failed messages for retry
          failedMessages.push({ topic, message });
          
          // Check connection state
          if (this.connected && this.session) {
            // Mark as disconnected to trigger reconnection
            this.connected = false;
          }
        }
      }
      
      // Add failed messages back to the queue
      if (failedMessages.length > 0) {
        console.log(`Adding ${failedMessages.length} failed messages back to queue for retry`);
        this.messageQueue.push(...failedMessages);
        
        // Attempt to reconnect if we had failures but thought we were connected
        if (this.connected && failedMessages.length > 0) {
          console.log("Connection state inconsistent - attempting to reconnect");
          this.connected = false;
          
          // Try to reconnect
          if (!this.connecting) {
            setTimeout(() => this.connect(), 1000);
          }
        }
      }
    } finally {
      this.messageQueueProcessing = false;
      
      // If there are still messages, process them again after a short delay
      if (this.messageQueue.length > 0) {
        setTimeout(() => this.processMessageQueue(), 1000);
      }
    }
  }

  /**
   * Publish a tweet for a specific stock
   * @param symbol Stock symbol
   * @param content Tweet content
   * @param companyName Company name
   * @param timestamp Timestamp
   */
  async publishTweet(symbol: string, content: string, companyName: string, timestamp: Date): Promise<boolean> {
    // First check if feed is active and if the symbol is in our activeSymbols set
    if (!this.feedActive || !this.activeSymbols.has(symbol)) {
      const reason = !this.feedActive ? 'feed inactive' : 'symbol not tracked';
      
      console.log(`TWITTER_PUB: Skipping tweet for ${symbol}: ${reason}. Feed Active: ${this.feedActive}, Symbol Tracked: ${this.activeSymbols.has(symbol)}, Active Symbols: ${Array.from(this.activeSymbols).join(", ")}`);
      
      // We still want to broadcast to WebSocket for UI debugging, but mark it appropriately
      try {
        const topic = `twitter-feed/${symbol}`;
        const message = {
          symbol,
          companyName,
          content,
          timestamp
        };
        
        const wsMessage = {
          type: 'twitter-feed-debug', // Changed type to indicate this is for debug only
          topic: topic,
          data: message,
          symbol: symbol,
          timestamp: timestamp.toISOString(),
          rawData: JSON.stringify(message),
          direction: 'debug', // Mark as debug message
          status: reason === 'feed inactive' ? 'feed_inactive' : 'not_tracked' // Indicate reason
        };
        
        // Broadcast to WebSocket clients for debug panel only
        // broadcastToWebSocketSubscribers(topic, wsMessage);
      } catch (error) {
        console.error(`Error broadcasting debug Twitter feed to WebSocket:`, error);
      }
      
      // Always return false when feed is inactive to prevent other services from thinking it worked
      return false;
    }
    
    const topic = `twitter-feed/${symbol}`;
    const message = {
      symbol,
      companyName,
      content,
      timestamp
    };
    
    // Send to debug panel via WebSocket before publishing to Solace
    // try {
    //   const wsMessage = {
    //     type: 'twitter-feed',
    //     topic: topic,
    //     data: message,
    //     symbol: symbol,
    //     timestamp: timestamp.toISOString(),
    //     rawData: JSON.stringify(message),
    //     direction: 'outgoing' // Add direction marker to show this is an outgoing message
    //   };
    //   
    //   // Broadcast to WebSocket clients for debug panel
    //   broadcastToWebSocketSubscribers(topic, wsMessage);
    // } catch (error) {
    //   console.error(`Error broadcasting Twitter feed to WebSocket:`, error);
    //   // Continue with Solace publish even if WebSocket broadcast fails
    // }
    
    // Double-check if feed is still active before publishing
    if (!this.feedActive) {
      console.log(`Feed became inactive during tweet processing for ${symbol} - cancelling publish`);
      return false;
    }
    
    // Only publish to Solace if feed is active
    // console.log(`TWITTER_PUB: Publishing tweet for ${symbol} to Solace (Feed Active: ${this.feedActive}, Connected: ${this.connected})`);
    return this.publish(topic, message);
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): { 
    connected: boolean, 
    connecting: boolean, 
    lastError: string, 
    tcpPort: string | undefined,
    feedActive: boolean,
    feedStarting: boolean,
    currentConfig: SolaceConnection | null
  } {
    return {
      connected: this.connected,
      connecting: this.connecting,
      lastError: this.lastConnectionError,
      tcpPort: this.currentConfig?.tcpPort || "55555", // Include TCP port in status
      feedActive: this.feedActive,
      feedStarting: this.feedStarting,
      currentConfig: this.currentConfig
    };
  }
  
  /**
   * Start feed for specified symbols
   * @param symbols Array of stock symbols to start tweets for
   * @param frequency Frequency in seconds for tweet generation
   */
  async startFeed(symbols: string[] = ['AAPL', 'MSFT', 'AMZN', 'GOOG'], frequency: number = 30): Promise<boolean> {
    return new Promise((resolve, reject) => {
    console.log(`Starting Twitter feed with ${symbols.length} symbols at ${frequency}s frequency (Platform: ${process.platform})`);
    this.feedStarting = true;
    
    try {
      this.tweetFrequencySeconds = frequency;
      this.tweetFrequencyMs = frequency * 1000;
      console.log(`Setting tweet frequency to ${this.tweetFrequencyMs}ms (${frequency}s)`);
      
        this.activeSymbols.clear();
      symbols.forEach(symbol => {
        this.activeSymbols.add(symbol);
      });
      console.log(`Stored ${this.activeSymbols.size} symbols for Twitter feed publishing:`, 
        Array.from(this.activeSymbols).join(', '));
      
      this.publishingEnabled = true;
      console.log("Setting feedActive to true regardless of platform");
      this.feedActive = true;
      
      if (process.platform === 'darwin') {
        console.log("DETECTED macOS - using direct timer implementation");
        this.stopTweetTimer();
          const self = this; 
        console.log(`Creating macOS timer with interval of ${this.tweetFrequencyMs}ms`);
        this.tweetTimer = setInterval(function() {
          console.log("macOS timer tick executing");
          if (self.feedActive && self.activeSymbols.size > 0) {
            self.generateAndPublishTweets();
          }
        }, this.tweetFrequencyMs);
        
        setTimeout(function() {
            try {
          console.log("Generating immediate tweet on macOS");
          self.generateAndPublishTweets();
              console.log(`macOS feed activation complete: timer active=${!!self.tweetTimer}, feedActive=${self.feedActive}`);
              self.feedStarting = false;
              // Log appropriate status message
              if (!self.connected) {
                console.log("Twitter feed activated but not connected to Solace - tweets will be published when connected (macOS path)");
              } else {
                console.log(`Twitter feed activated for symbols: ${Array.from(self.activeSymbols).join(', ')} with ${self.tweetFrequencyMs}ms frequency (macOS path)`);
              }
              resolve(true);
            } catch (macOsError) {
              console.error("Error during macOS immediate tweet generation:", macOsError);
              self.feedStarting = false; 
              self.feedActive = false; // Ensure feedActive is false on error
              reject(macOsError);
            }
        }, 10);
      } else {
        console.log("Using standard feed activation sequence for non-macOS platform");
        this.feedStarting = false;
        this.scheduleRegularTweets();
      // Log appropriate status message
      if (!this.connected) {
            console.log("Twitter feed activated but not connected to Solace - tweets will be published when connected (non-macOS path)");
      } else {
            console.log(`Twitter feed activated for symbols: ${Array.from(this.activeSymbols).join(', ')} with ${this.tweetFrequencyMs}ms frequency (non-macOS path)`);
      }
          resolve(true);
        }
    } catch (error) {
        console.error("Error starting Twitter feed (outer try-catch):", error);
      this.feedStarting = false;
        this.feedActive = false; // Ensure feedActive is false on error
        reject(error); // Reject the main promise
    }
    });
  }
  
  // UPDATED: This is now a synchronous method.
  stopFeed(): boolean {
    console.log("TWITTER_PUB: Stopping feed...");
    if (!this.feedActive) {
      console.log("TWITTER_PUB: Feed is already inactive.");
      return true;
    }

    this.feedActive = false;
    this.feedStarting = false;
    this.stopTweetTimer(); // This clears the interval
    this.activeSymbols.clear();
    
    console.log("TWITTER_PUB: Feed stopped and tweet scheduler cleared.");
    return true;
  }
  
  /**
   * Check if the Twitter feed is active
   * @returns boolean indicating whether the feed is active
   */
  isFeedActive(): boolean {
    return this.feedActive;
  }
  
  /**
   * Set feed active status - explicitly controls whether tweets are published
   * This method is primarily for macOS compatibility where timer binding needs extra handling
   * @param active Whether the feed should be active
   * @returns Current feed active status
   */
  setFeedActive(active: boolean): boolean {
    console.log(`Explicitly ${active ? 'activating' : 'deactivating'} Twitter feed (Platform: ${process.platform})`);
    
    const previousValue = this.feedActive;
    this.feedActive = active;
    
    // Enhanced activation for macOS with extremely reliable binding
    if (process.platform === 'darwin' && active) {
      console.log("macOS platform detected - using ultra-reliable activation for Twitter feed");
      
      // Use direct approach for maximum macOS reliability
      
      // Completely reset any existing timers
      this.stopTweetTimer();
      
      // Force active state to be true
      this.feedActive = true;
      
      // Create timer with direct approach for macOS
      console.log("Using MacOS-optimized direct timer creation");
      
      try {
        // For macOS, use a direct inline function to ensure proper context
        this.tweetTimer = setInterval(() => {
          console.log("MacOS timer tick");
          // Direct call with explicit this reference
          if (this.feedActive && this.activeSymbols.size > 0) {
            this.generateAndPublishTweets();
          }
        }, this.tweetFrequencyMs);
        
        // Verify timer was created
        console.log(`Timer active after setup: ${!!this.tweetTimer}`);
        
        // Generate immediate tweet with minimal delay
        setTimeout(() => {
          console.log("Generating immediate tweet on macOS");
          this.generateAndPublishTweets();
        }, 20);
        
        // Set up secondary verification to ensure timer stays active
        setTimeout(() => {
          if (!this.tweetTimer && this.feedActive) {
            console.log("MacOS recovery: Timer lost - recreating");
            this.tweetTimer = setInterval(() => this.generateAndPublishTweets(), this.tweetFrequencyMs);
          }
        }, 500);
      } catch (error) {
        console.error("Error setting up macOS timer:", error);
        // Emergency fallback
        try {
          console.log("Attempting emergency timer creation for macOS");
          this.tweetTimer = setInterval(() => this.generateAndPublishTweets(), this.tweetFrequencyMs);
        } catch (e) {
          console.error("Emergency timer creation failed:", e);
        }
      }
    } 
    // Standard activation for non-macOS platforms or deactivation
    else if (active && !previousValue) {
      // Stop any existing timer to avoid duplicates
      this.stopTweetTimer();
      
      // Standard activation with slight delay
      setTimeout(() => {
        // Setup tweet scheduling timer
        this.scheduleRegularTweets();
        console.log(`Tweet scheduling timer ${this.tweetTimer ? 'started' : 'failed to start'} after standard activation`);
      }, 100);
    } 
    // If deactivating and feed was previously active, ensure the tweet timer is stopped
    else if (!active && previousValue) {
      this.stopTweetTimer();
    }
    
    return this.feedActive;
  }
  
  /**
   * Set tweet frequency in seconds (for backward compatibility)
   * This method converts seconds to milliseconds and calls setTweetFrequencyMs
   * @param frequency Frequency in seconds
   */
  async setTweetFrequency(frequency: number): Promise<boolean> {
    try {
      // Validate the input (minimum 1 second, maximum 60 seconds)
      if (frequency < 1 || frequency > 60) {
        console.warn(`Invalid Twitter feed frequency: ${frequency}s - must be between 1 and 60 seconds`);
        
        // Apply validation by clamping to valid range
        frequency = Math.max(1, Math.min(60, frequency));
        console.warn(`Twitter feed frequency adjusted to valid range: ${frequency}s`);
      }
      
      // Store the value in seconds for backward compatibility
      this.tweetFrequencySeconds = frequency;
      
      // Convert to milliseconds and use the milliseconds method
      const frequencyMs = frequency * 1000;
      
      // Use the millisecond-based method to maintain a single implementation
      return await this.setTweetFrequencyMs(frequencyMs);
    } catch (error) {
      console.error("Error setting tweet frequency:", error);
      return false;
    }
  }
  
  /**
   * Schedule tweet generation for all active symbols
   * This starts a recurring timer that generates tweets at the configured frequency
   */
  private scheduleRegularTweets(): void {
    // Clear any existing timer first
    this.stopTweetTimer();
    
    // Only schedule if feed is active
    if (!this.feedActive) {
      console.log("Twitter feed not active - not scheduling regular tweets");
      return;
    }
    
    console.log(`Setting up Twitter feed timer with ${this.tweetFrequencyMs}ms interval for ${this.activeSymbols.size} symbols (Platform: ${process.platform})`);
    
    // Explicitly bind the method to this instance to prevent macOS context issues
    const boundGenerateAndPublishTweets = this.generateAndPublishTweets.bind(this);
    
    // Create a new interval timer for regular tweets with proper binding
    this.tweetTimer = setInterval(boundGenerateAndPublishTweets, this.tweetFrequencyMs);
    
    // Generate initial tweets right away (with slight stagger)
    setTimeout(boundGenerateAndPublishTweets, 500);
    
    // Additional verification for macOS - check that timer is working after a short delay
    setTimeout(() => {
      console.log("Verifying Twitter feed timer is functioning properly");
      if (this.feedActive && !this.tweetTimer) {
        console.warn("Timer verification failed - recreating timer");
        this.tweetTimer = setInterval(boundGenerateAndPublishTweets, this.tweetFrequencyMs);
      }
    }, 2000);
  }
  
  /**
   * Stop the tweet timer if it's running
   */
  private stopTweetTimer(): void {
    if (this.tweetTimer) {
      console.log("Stopping existing tweet timer");
      clearInterval(this.tweetTimer);
      this.tweetTimer = null;
    }
  }
  
  /**
   * Generate and publish tweets for all active symbols
   * Enhanced for cross-platform compatibility, especially macOS
   * Ensures tweets are published for all active stocks in live market intelligence
   */
  private generateAndPublishTweets(): void {
    // Verify context is properly bound (macOS compatibility check)
    if (!this.activeSymbols) {
      console.error("TWITTER_PUB: Context binding error detected in tweet generation - 'this' reference is incorrect. Aborting.");
      // Don't attempt to continue with incorrect context
      return;
    }
    
    // Record execution for debugging
    // console.log(`TWITTER_PUB: Tweet generator executing at ${new Date().toISOString()} (Platform: ${process.platform}, Feed Active: ${this.feedActive}, Connected: ${this.connected})`);
    
    // Skip if feed is not active
    if (!this.feedActive) {
      console.log("TWITTER_PUB: Feed not active - skipping tweet generation.");
      return;
    }
    
    // Skip if no symbols are active
    if (this.activeSymbols.size === 0) {
      console.log("TWITTER_PUB: No active symbols - skipping tweet generation.");
      return;
    }
    
    // console.log(`TWITTER_PUB: Generating tweets for ${this.activeSymbols.size} active symbols: ${Array.from(this.activeSymbols).join(", ")}`);
    
    // CRITICAL: Make a defensive copy of the active symbols to avoid any race conditions
    const symbolsToProcess = Array.from(this.activeSymbols);
    // console.log(`TWITTER_PUB: Processing tweets for symbols: ${symbolsToProcess.join(', ')}`);
    
    // For macOS, use a more direct approach to ensure all tweets are published
    // For other platforms, use sequential processing as well for consistency and simpler debugging.
    // console.log(`TWITTER_PUB: Using sequential tweet generation approach for platform: ${process.platform}`);
      
    // Process symbols sequentially for better reliability and simpler async handling
      (async () => {
        for (const symbol of symbolsToProcess) {
        // Check feed status before processing each symbol, as it might have changed.
        if (!this.feedActive) {
          console.log(`TWITTER_PUB: Feed became inactive while processing symbol ${symbol}. Stopping further generation.`);
          break; // Exit the loop if feed is no longer active
        }
        if (!this.activeSymbols.has(symbol)){
            console.log(`TWITTER_PUB: Symbol ${symbol} is no longer in activeSymbols set. Skipping.`);
            continue; // Skip if symbol was removed during processing
        }

        try {
          // console.log(`TWITTER_PUB: Generating tweet for symbol: ${symbol}`);
            // Get company name
            const companyName = this.getCompanyName(symbol);
            
            // Generate tweet content
            const content = this.generateTweetContent(symbol, companyName);
            
            // Publish the tweet
            try {
            // console.log(`TWITTER_PUB: Attempting to publish tweet for ${symbol}: "${content.substring(0,30)}..."`);
            const published = await this.publishTweet(symbol, content, companyName, new Date());
            if (published) {
                // console.log(`TWITTER_PUB: Successfully published tweet for ${symbol}`);
            } else {
              console.log(`TWITTER_PUB: Failed to publish tweet for ${symbol} (publishTweet returned false)`);
            }
            } catch (publishError) {
            console.error(`TWITTER_PUB: Error publishing tweet for ${symbol}:`, publishError);
            }
            
          // Add a small delay between tweets for better stability and to avoid rate limiting (if any)
          await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
          } catch (error) {
          console.error(`TWITTER_PUB: Error generating or publishing tweet for ${symbol}:`, error);
          }
        }
      // console.log(`TWITTER_PUB: Tweet generation cycle complete for all ${symbolsToProcess.length} symbols processed.`);
      })().catch(finalError => {
      console.error("TWITTER_PUB: Unhandled error in main tweet generation process:", finalError);
      });
  }

  async setTweetFrequencyMs(frequencyMs: number): Promise<boolean> {
    try {
      // Validate the input (minimum 1000ms = 1s, maximum 60000ms = 1min)
      // This matches the range specified in routes.ts
      if (frequencyMs < 1000 || frequencyMs > 60000) {
        console.warn(`Invalid Twitter feed frequency: ${frequencyMs}ms - must be between 1000 and 60000 milliseconds`);
        
        // Apply validation by clamping to valid range
        frequencyMs = Math.max(1000, Math.min(60000, frequencyMs));
        console.warn(`Twitter feed frequency adjusted to valid range: ${frequencyMs}ms`);
      }
      
      // Store the validated value in milliseconds
      this.tweetFrequencyMs = frequencyMs;
      
      // Update seconds value for backward compatibility
      this.tweetFrequencySeconds = Math.round(frequencyMs / 1000);
      
      console.log(`Twitter feed frequency set to ${frequencyMs}ms (${this.tweetFrequencySeconds}s)`);
      
      // If feed is active, restart the tweet timer with the new frequency
      if (this.feedActive) {
        console.log("Feed is active - restarting tweet timer with new frequency");
        this.scheduleRegularTweets();
      }
      
      return true;
    } catch (error) {
      console.error("Error setting tweet frequency in milliseconds:", error);
      return false;
    }
  }
  
  /**
   * Set QoS and message options for Twitter feed publishing
   * @param options QoS options for message delivery
   */
  async setMessageOptions(options: { 
    deliveryMode: "DIRECT" | "PERSISTENT", 
    allowMessageEliding: boolean, 
    dmqEligible: boolean 
  }): Promise<boolean> {
    try {
      // Log received options
      console.log("TwitterPublisherService received message options:", JSON.stringify({
        receivedDeliveryMode: options.deliveryMode,
        receivedEliding: options.allowMessageEliding,
        receivedDmq: options.dmqEligible,
        typeof_deliveryMode: typeof options.deliveryMode,
        typeof_allowMessageEliding: typeof options.allowMessageEliding,
        typeof_dmqEligible: typeof options.dmqEligible
      }));
      
      // Apply default values if needed
      const deliveryMode = options.deliveryMode || "DIRECT";
      const allowMessageEliding = options.allowMessageEliding !== undefined ? options.allowMessageEliding : true;
      const dmqEligible = options.dmqEligible !== undefined ? options.dmqEligible : true;
      
      // Validate deliveryMode
      if (deliveryMode !== "DIRECT" && deliveryMode !== "PERSISTENT") {
        console.error(`Invalid deliveryMode value: ${deliveryMode}. Must be "DIRECT" or "PERSISTENT"`);
        return false;
      }
      
      // Update QoS settings
      this.deliveryMode = deliveryMode;
      this.allowMessageEliding = allowMessageEliding;
      this.dmqEligible = dmqEligible;
      
      console.log(`Successfully updated Twitter feed message options: deliveryMode=${this.deliveryMode}, allowMessageEliding=${this.allowMessageEliding}, dmqEligible=${this.dmqEligible}`);
      return true;
    } catch (error) {
      console.error('Error setting Twitter feed message options:', error);
      return false;
    }
  }

  /**
   * Get feed status including QoS settings
   */
  getFeedStatus(): {
    active: boolean,
    starting: boolean,
    frequency: number,
    frequencyMs: number,
    activeSymbols: string[],
    messageOptions: {
      deliveryMode: "DIRECT" | "PERSISTENT",
      allowMessageEliding: boolean,
      dmqEligible: boolean
    }
  } {
    return {
      active: this.isFeedActive(), // Use the isFeedActive method for consistency
      starting: this.feedStarting,
      frequency: this.tweetFrequencySeconds,
      frequencyMs: this.tweetFrequencyMs,
      activeSymbols: Array.from(this.activeSymbols),
      messageOptions: {
        deliveryMode: this.deliveryMode,
        allowMessageEliding: this.allowMessageEliding,
        dmqEligible: this.dmqEligible
      }
    };
  }
  
  /**
   * Update active symbols for tweet publishing
   * This can be used to sync with wildcard filters when new stocks are added
   * @param symbols Array of stock symbols that are currently visible/filtered
   * @returns Success status
   */
  updateActiveSymbols(symbols: string[]): boolean {
    try {
      // Always update symbols list, regardless of feed status
      // This ensures that when the feed is later activated, it will have the correct symbols
      
      // Store previous set for later comparison
      const previousSymbols = new Set(this.activeSymbols);
      const previousCount = previousSymbols.size;
      
      // Track new symbols for special processing
      const newSymbols: string[] = [];
      
      // Clear and re-add all symbols
      this.activeSymbols.clear();
      symbols.forEach(symbol => {
        this.activeSymbols.add(symbol);
        // If this is a new symbol that wasn't in the previous set, track it
        if (!previousSymbols.has(symbol)) {
          newSymbols.push(symbol);
        }
      });
      
      if (!this.feedActive) {
        // console.log(`FIXED TWITTER FEED: Stored ${this.activeSymbols.size} symbols for future Twitter feed activation`);
        // console.log(`These symbols will be used when the Twitter feed is started: ${Array.from(this.activeSymbols).join(', ')}`);
      } else {
        // console.log(`FIXED TWITTER FEED: Updated active symbols: ${previousCount} → ${this.activeSymbols.size} symbols`);
        //console.log(`Active symbols: ${Array.from(this.activeSymbols).join(', ')}`);
        
        // If feed is active and we have new symbols, immediately schedule tweets for them
        if (newSymbols.length > 0) {
          console.log(`Scheduling immediate tweets for ${newSymbols.length} newly added symbols:`, newSymbols);
          
          // For each new symbol, immediately create a random initial tweet
          newSymbols.forEach(symbol => {
            // Set tweet frequency to match current global setting (using seconds value for backward compatibility)
            this.setTweetFrequency(this.tweetFrequencySeconds);
            
            // Force an immediate tweet for newly added symbols to ensure they appear right away
            setTimeout(() => {
              // Instead of calling a separate method, we'll directly generate and publish a tweet
              // This ensures newly added symbols get tweets without requiring a separate method
              try {
                // Instead of maintaining a separate company name list here,
                // use the existing getCompanyName method to ensure consistency
                const companyName = this.getCompanyName(symbol);
                
                // Generate a simple tweet content instead of calling an external method
                const tweetTemplates = [
                  `Analysts are bullish on $${symbol} as ${companyName} plans to expand operations.`,
                  `$${symbol} released strong quarterly earnings. ${companyName} continues to outperform.`,
                  `${companyName} ($${symbol}) is trending on social media after recent news.`
                ];
                const content = tweetTemplates[Math.floor(Math.random() * tweetTemplates.length)];
                
                // Publish tweet via the publishTweet method
                this.publishTweet(symbol, content, companyName, new Date());
                
                console.log(`Generated initial tweet for newly added symbol: ${symbol}`);
              } catch (error) {
                console.error(`Error generating initial tweet for ${symbol}:`, error);
              }
            }, 1000 + Math.random() * 5000); // Slight random delay to avoid bursts
          });
        }
      }
      
      // Print a reminder about this fix for future debugging
      console.log(`IMPORTANT: This is using the enhanced updateActiveSymbols implementation that works with wildcards`);
      
      return true;
    } catch (error) {
      console.error('Error updating active symbols:', error);
      return false;
    }
  }

  /**
   * Enable or disable publishing
   */
  setPublishingEnabled(enabled: boolean): void {
    this.publishingEnabled = enabled;
    console.log(`Twitter publishing ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if connected to the Solace message broker
   */
  isConnected(): boolean {
    return this.connected && this.session !== null;
  }

  /**
   * Helper method to get company name for a symbol
   * @param symbol Stock symbol
   * @returns Company name
   */
  private getCompanyName(symbol: string): string {
    // Map of stock symbols to company names
    const companyNames: Record<string, string> = {
      // US Tech Companies
      'AAPL': 'Apple Inc.',
      'MSFT': 'Microsoft Corporation',
      'GOOG': 'Alphabet Inc.',
      'AMZN': 'Amazon.com Inc.',
      'META': 'Meta Platforms Inc.',
      'TSLA': 'Tesla Inc.',
      'NFLX': 'Netflix Inc.',
      'JPM': 'JPMorgan Chase & Co.',
      'NVDA': 'NVIDIA Corporation',
      'IBM': 'International Business Machines',
      'INTC': 'Intel Corporation',
      'AMD': 'Advanced Micro Devices',
      'CSCO': 'Cisco Systems Inc.',
      'ORCL': 'Oracle Corporation',
      
      // Australian Banks
      'BHP': 'BHP Group Limited',
      'NAB': 'National Australia Bank',
      'CBA': 'Commonwealth Bank of Australia',
      'WBC': 'Westpac Banking Corporation',
      
      // UK Companies (London Stock Exchange)
      'HSBA': 'HSBC Holdings plc',
      'BARC': 'Barclays plc',
      'BP': 'BP plc',
      'LLOY': 'Lloyds Banking Group plc',
      'VOD': 'Vodafone Group plc',
      'GSK': 'GlaxoSmithKline plc',
      'AZN': 'AstraZeneca plc',
      'RIO': 'Rio Tinto plc',
      'ULVR': 'Unilever plc',
      'SHEL': 'Shell plc',
      'RDSB': 'Royal Dutch Shell plc',
      'BT': 'BT Group plc'
    };
    
    // Return company name or use symbol if not found
    return companyNames[symbol] || `${symbol} Corp`;
  }
  
  /**
   * Generate tweet content for a symbol
   * @param symbol Stock symbol
   * @param companyName Company name
   * @returns Tweet content
   */
  private generateTweetContent(symbol: string, companyName: string): string {
    // Template tweets organized by categories for maximum variety
    
    // Category 1: Analyst opinions and ratings
    const analystTweets = [
      `Analysts at Global Securities have upgraded $${symbol} from Hold to Buy, citing ${companyName}'s strong market position.`,
      `$${symbol} received a price target increase to $215 from Morgan Stanley analysts after ${companyName}'s impressive quarterly results.`,
      `Analysts remain bullish on $${symbol} as ${companyName} expands operations in emerging Asian markets.`,
      `Goldman Sachs maintains Outperform rating on $${symbol}, praising ${companyName}'s cost-cutting initiatives.`,
      `JPMorgan analysts highlight $${symbol} as a top pick in the sector, expecting ${companyName} to outperform peers.`,
      `$${symbol} downgraded by Credit Suisse despite ${companyName}'s recent product launches, citing competitive pressures.`,
      `Barclays initiates coverage of $${symbol} with Overweight rating, forecasting strong growth for ${companyName}.`,
      `Technical analysts see bullish patterns forming on $${symbol} charts as ${companyName} breaks resistance levels.`,
      `Wells Fargo raised their outlook on $${symbol}, predicting ${companyName} will benefit from industry tailwinds.`,
      `Bank of America has issued a rare "double upgrade" on $${symbol}, moving ${companyName} from Underperform to Buy.`
    ];
    
    // Category 2: Financial performance and earnings
    const earningsTweets = [
      `$${symbol} beats earnings estimates by 15%, ${companyName}'s CEO attributes success to expansion into new markets.`,
      `${companyName} ($${symbol}) reports record quarterly revenue of $4.2B, exceeding analyst expectations.`,
      `$${symbol} misses on earnings but ${companyName}'s forward guidance remains strong, sending shares higher.`,
      `${companyName} ($${symbol}) Q2 earnings show 23% year-over-year growth driven by strong product adoption.`,
      `$${symbol} rallies after ${companyName} raises full-year guidance following impressive quarterly performance.`,
      `Investors react positively to ${companyName}'s ($${symbol}) better-than-expected profit margins in latest report.`,
      `$${symbol} announces special dividend after ${companyName} reports record profits for the fiscal year.`,
      `${companyName} ($${symbol}) beats on top and bottom lines, announces $1B stock buyback program.`,
      `$${symbol} shares drop despite earnings beat as ${companyName}'s growth rate shows signs of slowing.`,
      `${companyName} ($${symbol}) posts surprising profit after three consecutive quarters of losses.`
    ];
    
    // Category 3: Product and innovation news
    const productTweets = [
      `${companyName} ($${symbol}) unveils revolutionary new product line expected to disrupt the market.`,
      `$${symbol} files patent for groundbreaking technology that could transform how ${companyName} competes in the space.`,
      `${companyName} ($${symbol}) showcases next-generation innovation at industry tradeshow, impressing attendees.`,
      `$${symbol} announces accelerated R&D investment as ${companyName} positions for technological leadership.`,
      `${companyName} ($${symbol}) receives regulatory approval for highly anticipated new product launch.`,
      `$${symbol} reveals strategic pivot to AI-driven solutions, signaling new direction for ${companyName}.`,
      `${companyName} ($${symbol}) demonstrates impressive results from beta testing of upcoming flagship product.`,
      `$${symbol} acquires promising startup to bolster ${companyName}'s innovation pipeline and IP portfolio.`,
      `${companyName} ($${symbol}) partners with leading research university to develop cutting-edge technologies.`,
      `$${symbol} opens new innovation center in Silicon Valley as ${companyName} doubles down on tech development.`
    ];
    
    // Category 4: Market trends and trading patterns
    const marketTrendsTweets = [
      `$${symbol} trending among retail investors on social trading platforms as ${companyName}'s visibility grows.`,
      `Unusual options activity detected in $${symbol} ahead of ${companyName}'s scheduled announcement.`,
      `${companyName} ($${symbol}) seeing increased institutional accumulation according to recent 13F filings.`,
      `$${symbol} breaks key resistance level on high volume, signaling potential uptrend for ${companyName}.`,
      `Short interest in ${companyName} ($${symbol}) drops to 12-month low as bearish sentiment wanes.`,
      `$${symbol} joins major index, expected to drive passive inflows to ${companyName} shares.`,
      `${companyName} ($${symbol}) trading at premium to sector peers despite valuation concerns.`,
      `$${symbol} forms golden cross pattern on daily chart, generating technical buy signals for ${companyName}.`,
      `Insider buying at ${companyName} ($${symbol}) reaches highest level in two years, boosting investor confidence.`,
      `$${symbol} experiencing unusually high trading volume after ${companyName}'s mention in influential industry report.`
    ];
    
    // Category 5: Strategic business moves
    const strategicTweets = [
      `${companyName} ($${symbol}) announces strategic restructuring to better position for future growth.`,
      `$${symbol} confirms ongoing talks for major acquisition that would expand ${companyName}'s market reach.`,
      `${companyName} ($${symbol}) divests non-core business unit to focus on high-margin segments.`,
      `$${symbol} enters joint venture with industry leader, creating new opportunities for ${companyName}.`,
      `${companyName} ($${symbol}) secures exclusive distribution deal in rapidly growing Asian markets.`,
      `$${symbol} appoints new CFO from major competitor, signaling ${companyName}'s aggressive growth plans.`,
      `${companyName} ($${symbol}) announces global expansion strategy targeting 15 new markets by 2026.`,
      `$${symbol} restructures debt, improving ${companyName}'s balance sheet and financial flexibility.`,
      `${companyName} ($${symbol}) launches strategic review of operations, exploring "all options" according to statement.`,
      `$${symbol} wins major government contract worth $1.2B, largest in ${companyName}'s history.`
    ];
    
    // Category 6: Industry and competitive positioning
    const industryTweets = [
      `$${symbol} gains market share as ${companyName} capitalizes on competitor's missteps in key segment.`,
      `Industry report names ${companyName} ($${symbol}) as sector leader in customer satisfaction for third consecutive year.`,
      `$${symbol} stands to benefit from new regulations that align with ${companyName}'s existing practices.`,
      `${companyName} ($${symbol}) outperforming industry index by 17% YTD as sector consolidation continues.`,
      `$${symbol} launches aggressive pricing strategy as ${companyName} looks to pressure smaller competitors.`,
      `Market research firm ranks ${companyName} ($${symbol}) #1 in product quality across industry comparison.`,
      `$${symbol} leveraging first-mover advantage as ${companyName} pioneers new approach to industry challenges.`,
      `${companyName} ($${symbol}) CEO warns of industry headwinds but positions firm to weather the storm.`,
      `$${symbol} could face margin pressure as new entrant disrupts category where ${companyName} has dominated.`,
      `Industry experts highlight ${companyName} ($${symbol}) as best positioned to capitalize on emerging trends.`
    ];
    
    // Category 7: Executive and management changes
    const executiveTweets = [
      `${companyName} ($${symbol}) names new CEO following planned retirement of industry veteran leader.`,
      `$${symbol} board initiates search for new executive leadership as ${companyName} enters next growth phase.`,
      `Activist investors gain board seat at ${companyName} ($${symbol}), pushing for operational changes.`,
      `$${symbol} announces unexpected departure of CTO who led ${companyName}'s digital transformation efforts.`,
      `${companyName} ($${symbol}) brings on former Google executive to head global expansion initiatives.`,
      `$${symbol} creates new C-suite position focused on sustainability as ${companyName} emphasizes ESG commitments.`,
      `Founder returns to ${companyName} ($${symbol}) in advisory role after three-year absence.`,
      `$${symbol} board approves ambitious performance incentives for ${companyName}'s executive team.`,
      `${companyName} ($${symbol}) appoints tech industry veteran to lead cloud services division.`,
      `$${symbol} executive team completes major stock purchase, showing confidence in ${companyName}'s direction.`
    ];
    
    // Category 8: Technology and digital transformation
    const technologyTweets = [
      `$${symbol} completes migration to cloud infrastructure, enhancing ${companyName}'s operational efficiency.`,
      `${companyName} ($${symbol}) launches AI-powered platform to revolutionize customer experience.`,
      `$${symbol} partners with Microsoft to accelerate ${companyName}'s digital transformation journey.`,
      `${companyName} ($${symbol}) adopts blockchain technology for supply chain transparency initiative.`,
      `$${symbol} investing $500M in cybersecurity upgrades following ${companyName}'s digital expansion.`,
      `${companyName} ($${symbol}) receives industry award for innovative use of big data analytics.`,
      `$${symbol} becoming industry leader in IoT implementation as ${companyName} digitizes operations.`,
      `${companyName} ($${symbol}) unveils digital twin technology to optimize manufacturing processes.`,
      `$${symbol} acquires data analytics startup to enhance ${companyName}'s predictive capabilities.`,
      `${companyName} ($${symbol}) embraces hybrid work model with new digital collaboration tools.`
    ];
    
    // Category 9: Financial actions and capital allocation
    const financialTweets = [
      `$${symbol} announces 15% dividend increase, reflecting ${companyName}'s strong free cash flow generation.`,
      `${companyName} ($${symbol}) authorizes additional $5B for share repurchase program.`,
      `$${symbol} completes successful bond offering, raising $2B to fund ${companyName}'s expansion plans.`,
      `${companyName} ($${symbol}) implements cost-cutting measures expected to save $400M annually.`,
      `$${symbol} receives upgraded credit rating as ${companyName}'s balance sheet continues to strengthen.`,
      `${companyName} ($${symbol}) announces intention to split into two separate publicly traded entities.`,
      `$${symbol} exploring strategic alternatives for underperforming division, ${companyName} confirms.`,
      `${companyName} ($${symbol}) institutes first-ever share repurchase program with $3B authorization.`,
      `$${symbol} increases capital expenditure forecast as ${companyName} accelerates growth investments.`,
      `${companyName} ($${symbol}) achieves debt reduction milestone ahead of schedule, pleasing creditors.`
    ];
    
    // Category 10: Market sentiment and general updates
    const sentimentTweets = [
      `Market sentiment shifting positive on $${symbol} as ${companyName} outperforms expectations.`,
      `${companyName} ($${symbol}) mentioned as potential takeover target in industry consolidation rumors.`,
      `$${symbol} hosting investor day next week where ${companyName} expected to unveil 5-year strategic plan.`,
      `Social media buzz around ${companyName} ($${symbol}) surges following viral marketing campaign.`,
      `$${symbol} reaches 52-week high as momentum builds for ${companyName}'s core business segments.`,
      `Retail investors flock to ${companyName} ($${symbol}) following favorable mention by popular financial influencer.`,
      `$${symbol} trending in online investment communities as ${companyName} gains cultural relevance.`,
      `${companyName} ($${symbol}) sentiment analysis shows increasingly positive online mentions over past quarter.`,
      `$${symbol} options suggest traders expecting significant move after ${companyName}'s upcoming announcement.`,
      `${companyName} ($${symbol}) insiders haven't sold shares in over 6 months, possibly signaling bullish outlook.`
    ];
    
    // Combine all categories into one mega array of templates
    const allTweetTemplates = [
      ...analystTweets,
      ...earningsTweets,
      ...productTweets,
      ...marketTrendsTweets,
      ...strategicTweets,
      ...industryTweets,
      ...executiveTweets,
      ...technologyTweets,
      ...financialTweets,
      ...sentimentTweets
    ];
    
    // Select a random tweet template from all available options
    const randomIndex = Math.floor(Math.random() * allTweetTemplates.length);
    return allTweetTemplates[randomIndex];
  }
}

export const twitterPublisherService = new TwitterPublisherService();