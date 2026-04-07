/**
 * Tests to verify Solace publishing functionality
 * 
 * These tests verify:
 * 1. Twitter feed is properly publishing to Solace topics
 * 2. No direct WebSocket broadcasting is occurring
 * 3. Data is flowing directly from Solace to the frontend
 */

const { solaceService } = require('../services/solaceService');
const { twitterService } = require('../services/twitterService');
const { llmService } = require('../services/llmService');

// Mock solaceService
jest.mock('../services/solaceService', () => ({
  solaceService: {
    isConnected: jest.fn(),
    publish: jest.fn().mockResolvedValue(null),
    subscribe: jest.fn().mockResolvedValue(null),
    unsubscribe: jest.fn().mockResolvedValue(null)
  }
}));

// Mock storage
jest.mock('../storage', () => ({
  storage: {
    getStockBySymbol: jest.fn().mockResolvedValue({
      id: 1,
      symbol: 'AAPL',
      companyName: 'Apple Inc.',
      currentPrice: 150.0,
      percentChange: 0.5
    }),
    createTwitterFeed: jest.fn().mockResolvedValue({
      id: 1,
      stockId: 1,
      content: 'Test tweet',
      timestamp: new Date()
    }),
    createTradingSignal: jest.fn().mockResolvedValue({
      id: 1,
      stockId: 1,
      signal: 'BUY',
      confidence: 0.8,
      reasoning: 'Test reasoning'
    })
  }
}));

// Mock routes module to track WebSocket broadcasting
const mockBroadcastToWebSockets = jest.fn();
jest.mock('../routes', () => ({
  broadcastToWebSockets: mockBroadcastToWebSockets
}));

describe('Solace Publishing Tests', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Set solaceService as connected
    solaceService.isConnected.mockReturnValue(true);
  });
  
  /**
   * Test 1: Twitter feed should publish to Solace broker
   */
  test('TwitterService publishes tweets to Solace broker', async () => {
    // Call the method to update Twitter feed
    await twitterService.updateSymbolTwitterFeed('AAPL');
    
    // Verify the tweet was published to Solace
    expect(solaceService.publish).toHaveBeenCalledTimes(1);
    
    // Check the first call to publish
    const [topic, message] = solaceService.publish.mock.calls[0];
    
    // Verify the topic is correct
    expect(topic).toBe('twitter-feed/AAPL');
    
    // Verify the message contains the expected fields
    expect(message).toHaveProperty('symbol');
    expect(message).toHaveProperty('content');
    expect(message).toHaveProperty('timestamp');
    expect(message.symbol).toBe('AAPL');
  });
  
  /**
   * Test 2: LLM service should forward tweets to Agent Mesh via Solace
   */
  test('LLMService publishes tweets to Agent Mesh via Solace', async () => {
    // Call the method to publish tweet for processing
    await llmService.publishTweetForProcessing('AAPL', 'Test tweet', new Date());
    
    // Verify tweet was published to Solace
    expect(solaceService.publish).toHaveBeenCalledWith(
      'twitter-feed/AAPL',
      expect.objectContaining({
        symbol: 'AAPL',
        content: 'Test tweet'
      })
    );
    
    // Verify NO direct WebSocket broadcast was used
    expect(mockBroadcastToWebSockets).not.toHaveBeenCalled();
  });
  
  /**
   * Test 3: LLM service should receive signals from Solace without WebSocket broadcasting
   */
  test('LLMService processes signals from Solace without WebSocket broadcast', async () => {
    // Mock the subscription handler
    let storedCallback;
    solaceService.subscribe = jest.fn((topic, callback) => {
      storedCallback = callback;
    });
    
    // Start signal generation
    await llmService.startSignalGeneration(['AAPL']);
    
    // Verify subscription to signal/output topic
    expect(solaceService.subscribe).toHaveBeenCalledWith(
      'signal/output',
      expect.any(Function)
    );
    
    // Simulate receiving a signal from Solace
    const sampleSignal = {
      symbol: 'AAPL',
      signal: 'BUY',
      confidence: 0.85,
      reasoning: 'Test reasoning'
    };
    
    // Call the stored callback with the sample signal
    if (storedCallback) {
      await storedCallback(sampleSignal);
    }
    
    // Verify the signal was stored in the database
    expect(storage.createTradingSignal).toHaveBeenCalled();
    
    // Verify signal wasn't directly broadcasted to WebSockets
    expect(mockBroadcastToWebSockets).not.toHaveBeenCalled();
  });
});