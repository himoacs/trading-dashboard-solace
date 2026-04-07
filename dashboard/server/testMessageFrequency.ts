/**
 * Test script to verify Twitter message publishing frequency
 * 
 * This script connects to Solace, subscribes to Twitter feed topics,
 * and monitors the frequency of tweets published to each topic.
 * 
 * To run:
 * npx tsx server/testMessageFrequency.ts
 */

import { solaceService } from './services/solaceService';
import { twitterService } from './services/twitterService';
import { storage } from './storage';

interface TopicStats {
  topic: string;
  messageCount: number;
  firstMessage?: Date;
  lastMessage?: Date;
  messages: Array<{
    timestamp: Date;
    content: string;
  }>;
}

class MessageFrequencyTest {
  private testDurationSeconds = 120; // Run test for 2 minutes
  private testSymbols = ['AAPL', 'MSFT', 'AMZN']; // Test with these symbols
  private topicStats: Map<string, TopicStats> = new Map();
  private isConnected = false;
  private testStartTime: Date = new Date();
  private testEndTime: Date = new Date();
  private messageHandler: (topic: string, message: any) => void;

  constructor() {
    // Create a message handler that tracks messages
    this.messageHandler = (topic: string, message: any) => this.recordMessage(topic, message);
  }

  /**
   * Run the test
   */
  async runTest(): Promise<void> {
    try {
      // Connect to Solace
      await this.connectToSolace();
      
      // Subscribe to topics
      await this.subscribeToTopics();
      
      // Start the services with test symbols
      await this.startServices();
      
      // Run the test for the specified duration
      await this.runTestDuration();
      
      // Print results
      this.printResults();
      
      // Cleanup
      await this.cleanup();
      
    } catch (error) {
      console.error('Error running test:', error);
    } finally {
      process.exit(0);
    }
  }

  /**
   * Connect to Solace
   */
  private async connectToSolace(): Promise<void> {
    console.log('Connecting to Solace...');
    
    // Use example credentials for testing
    // In a real scenario, these credentials would be provided by the user via the config panel
    try {
      await solaceService.connect({
        brokerUrl: 'wss://example.messaging.solace.cloud:443',
        vpnName: 'example-vpn',
        username: 'example-user',
        password: 'example-password',
        configType: 'backend'
      });
      
      this.isConnected = true;
      console.log('Connected to Solace successfully');
    } catch (error) {
      console.error('Failed to connect to Solace:', error);
      throw new Error('Failed to connect to Solace');
    }
  }

  /**
   * Subscribe to Twitter feed topics
   */
  private async subscribeToTopics(): Promise<void> {
    console.log('Subscribing to Twitter feed topics...');
    
    // Subscribe to Twitter feed topics only
    for (const symbol of this.testSymbols) {
      const twitterTopic = `twitter-feed/${symbol}`;
      
      // Initialize stats for this topic
      this.topicStats.set(twitterTopic, {
        topic: twitterTopic,
        messageCount: 0,
        messages: []
      });
      
      // Subscribe to the topic
      await solaceService.subscribe(twitterTopic, (message: any) => {
        this.recordMessage(twitterTopic, message);
      });
      console.log(`Subscribed to ${twitterTopic}`);
    }
  }

  /**
   * Start the Twitter service
   */
  private async startServices(): Promise<void> {
    console.log(`Starting Twitter service with symbols: ${this.testSymbols.join(', ')}`);
    
    // Start Twitter service with proper frequency (60-180 seconds between tweets)
    twitterService.setTweetFrequency(60, 180); // Set proper frequency first
    await twitterService.startSimulation(this.testSymbols, 60); // Use higher frequency to reduce load
    console.log('Started Twitter service');
  }

  /**
   * Record a received message
   */
  private recordMessage(topic: string, message: any): void {
    const now = new Date();
    
    // Get stats for this topic
    const stats = this.topicStats.get(topic);
    
    if (!stats) {
      console.warn(`Received message for untracked topic: ${topic}`);
      return;
    }
    
    // Update stats
    stats.messageCount++;
    
    // Update first message timestamp if this is the first message
    if (!stats.firstMessage) {
      stats.firstMessage = now;
    }
    
    // Update last message timestamp
    stats.lastMessage = now;
    
    // Add message to the list
    let content = '';
    try {
      // Try to extract some meaningful content from the message
      if (typeof message === 'object') {
        if (message.content) {
          content = message.content.substring(0, 30) + '...';
        } else if (message.headline) {
          content = message.headline.substring(0, 30) + '...';
        } else if (message.symbol) {
          content = `${message.symbol} update`;
        }
      } else if (typeof message === 'string') {
        content = message.substring(0, 30) + '...';
      }
    } catch (e) {
      content = 'Error extracting content';
    }
    
    stats.messages.push({
      timestamp: now,
      content
    });
    
    console.log(`Received message #${stats.messageCount} for topic ${topic}: ${content}`);
  }

  /**
   * Run the test for the specified duration
   */
  private async runTestDuration(): Promise<void> {
    this.testStartTime = new Date();
    this.testEndTime = new Date(this.testStartTime.getTime() + (this.testDurationSeconds * 1000));
    
    console.log(`Running test from ${this.testStartTime.toISOString()} to ${this.testEndTime.toISOString()} (${this.testDurationSeconds} seconds)`);
    
    // Wait for test duration
    await new Promise(resolve => setTimeout(resolve, this.testDurationSeconds * 1000));
  }

  /**
   * Print the test results
   */
  private printResults(): void {
    console.log('\n------------ TEST RESULTS ------------');
    console.log(`Test ran from ${this.testStartTime.toISOString()} to ${new Date().toISOString()}`);
    console.log(`Test duration: ${this.testDurationSeconds} seconds\n`);
    
    for (const stats of this.topicStats.values()) {
      // Calculate frequency if we have messages
      if (stats.messageCount > 0 && stats.firstMessage && stats.lastMessage) {
        const durationMs = stats.lastMessage.getTime() - stats.firstMessage.getTime();
        const durationSeconds = durationMs / 1000;
        
        const frequency = stats.messageCount / durationSeconds;
        const averageIntervalSeconds = durationSeconds / stats.messageCount;
        
        console.log(`Topic: ${stats.topic}`);
        console.log(`  Total messages: ${stats.messageCount}`);
        console.log(`  First message: ${stats.firstMessage.toISOString()}`);
        console.log(`  Last message: ${stats.lastMessage.toISOString()}`);
        console.log(`  Average frequency: ${frequency.toFixed(2)} messages per second`);
        console.log(`  Average interval: ${averageIntervalSeconds.toFixed(2)} seconds between messages`);
        
        // Calculate intervals between messages
        if (stats.messages.length > 1) {
          const intervals = [];
          for (let i = 1; i < stats.messages.length; i++) {
            const interval = (stats.messages[i].timestamp.getTime() - stats.messages[i-1].timestamp.getTime()) / 1000;
            intervals.push(interval);
          }
          
          // Calculate min, max, and average interval
          const minInterval = Math.min(...intervals);
          const maxInterval = Math.max(...intervals);
          const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
          
          console.log(`  Minimum interval: ${minInterval.toFixed(2)} seconds`);
          console.log(`  Maximum interval: ${maxInterval.toFixed(2)} seconds`);
          console.log(`  Average interval: ${avgInterval.toFixed(2)} seconds`);
        }
        
        console.log(''); // Add a blank line
      } else {
        console.log(`Topic: ${stats.topic}`);
        console.log(`  No messages received`);
        console.log(''); // Add a blank line
      }
    }
    
    console.log('------------ END RESULTS ------------\n');
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    console.log('Cleaning up...');
    
    // Stop services
    await twitterService.stopSimulation();
    
    // Disconnect from Solace
    if (this.isConnected) {
      await solaceService.disconnect();
      console.log('Disconnected from Solace');
    }
  }
}

// Run the test
const test = new MessageFrequencyTest();
test.runTest();