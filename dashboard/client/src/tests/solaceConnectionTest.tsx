import React, { useEffect, useState } from 'react';
import { useSolaceConnection } from '../hooks/useSolaceConnection';

/**
 * SolaceConnectionTest component
 * 
 * Tests the webapp's Solace connection functionality
 * Verifies that:
 * 1. Connection is established with provided credentials
 * 2. Three sessions are created for different data types
 * 3. Topic subscriptions work correctly based on user actions
 * 4. Cleanup happens correctly on exit
 */
export function SolaceConnectionTest() {
  const [testResults, setTestResults] = useState<Array<{name: string, status: 'pending' | 'success' | 'failure', message: string}>>([]);
  const [testInProgress, setTestInProgress] = useState(false);
  
  // Test Solace credentials - use the proper broker URL, not localhost
  const testCredentials = {
    brokerUrl: 'wss://mr-connection-k60c74ep7lj.messaging.solace.cloud:443',
    vpnName: 'himanshu-demo',
    username: 'test',
    password: 'test',
  };
  
  // Use the Solace connection hook
  const { 
    connect, 
    disconnect, 
    connected: isConnected, 
    subscribe, 
    unsubscribe, 
    session 
  } = useSolaceConnection();
  
  const addTestResult = (name: string, status: 'pending' | 'success' | 'failure', message: string) => {
    setTestResults(prev => [...prev, { name, status, message }]);
  };
  
  const runTest = async () => {
    setTestResults([]);
    setTestInProgress(true);
    
    try {
      // Test 1: Connect to Solace
      addTestResult('Solace Connection', 'pending', 'Attempting to connect to Solace broker...');
      await connect(testCredentials);
      
      if (isConnected) {
        addTestResult('Solace Connection', 'success', 'Successfully connected to Solace broker');
      } else {
        addTestResult('Solace Connection', 'failure', 'Failed to connect to Solace broker');
        throw new Error('Failed to connect to Solace broker');
      }
      
      // Test 2: Verify Stock Market Data Session
      addTestResult('Stock Market Data Session', 'pending', 'Checking stock market data session...');
      
      if (session.stockMarketData) {
        addTestResult('Stock Market Data Session', 'success', 'Stock market data session created successfully');
      } else {
        addTestResult('Stock Market Data Session', 'failure', 'Failed to create stock market data session');
        throw new Error('Failed to create stock market data session');
      }
      
      // Test 3: Verify Index Market Data Session
      addTestResult('Index Market Data Session', 'pending', 'Checking index market data session...');
      
      if (session.indexMarketData) {
        addTestResult('Index Market Data Session', 'success', 'Index market data session created successfully');
      } else {
        addTestResult('Index Market Data Session', 'failure', 'Failed to create index market data session');
        throw new Error('Failed to create index market data session');
      }
      
      // Test 4: Verify Signal Data Session
      addTestResult('Signal Data Session', 'pending', 'Checking signal data session...');
      
      if (session.signalData) {
        addTestResult('Signal Data Session', 'success', 'Signal data session created successfully');
      } else {
        addTestResult('Signal Data Session', 'failure', 'Failed to create signal data session');
        throw new Error('Failed to create signal data session');
      }
      
      // Test 5: Subscribe to Stock Market Data Topic
      addTestResult('Stock Topic Subscription', 'pending', 'Subscribing to stock market data topic...');
      
      try {
        await subscribe('market-data/EQ/US/NASDAQ/MSFT', 'stock');
        addTestResult('Stock Topic Subscription', 'success', 'Successfully subscribed to stock market data topic');
      } catch (err) {
        const error = err as Error;
        addTestResult('Stock Topic Subscription', 'failure', `Failed to subscribe to stock market data topic: ${error.message}`);
        throw error;
      }
      
      // Test 6: Subscribe to Index Market Data Topic
      addTestResult('Index Topic Subscription', 'pending', 'Subscribing to index market data topic...');
      
      try {
        await subscribe('market-data/SPX', 'index');
        addTestResult('Index Topic Subscription', 'success', 'Successfully subscribed to index market data topic');
      } catch (err) {
        const error = err as Error;
        addTestResult('Index Topic Subscription', 'failure', `Failed to subscribe to index market data topic: ${error.message}`);
        throw error;
      }
      
      // Test 7: Subscribe to Signal Output Topic
      addTestResult('Signal Topic Subscription', 'pending', 'Subscribing to signal output topic...');
      
      try {
        await subscribe('signal/output', 'signal');
        addTestResult('Signal Topic Subscription', 'success', 'Successfully subscribed to signal output topic');
      } catch (err) {
        const error = err as Error;
        addTestResult('Signal Topic Subscription', 'failure', `Failed to subscribe to signal output topic: ${error.message}`);
        throw error;
      }
      
      // Test 8: Unsubscribe from Topics
      addTestResult('Topic Unsubscription', 'pending', 'Unsubscribing from topics...');
      
      try {
        await unsubscribe('market-data/EQ/US/NASDAQ/MSFT', 'stock');
        await unsubscribe('market-data/SPX', 'index');
        await unsubscribe('signal/output', 'signal');
        addTestResult('Topic Unsubscription', 'success', 'Successfully unsubscribed from all topics');
      } catch (err) {
        const error = err as Error;
        addTestResult('Topic Unsubscription', 'failure', `Failed to unsubscribe from topics: ${error.message}`);
        throw error;
      }
      
      // Test 9: Disconnect from Solace
      addTestResult('Solace Disconnection', 'pending', 'Disconnecting from Solace broker...');
      
      await disconnect();
      
      if (!isConnected) {
        addTestResult('Solace Disconnection', 'success', 'Successfully disconnected from Solace broker');
      } else {
        addTestResult('Solace Disconnection', 'failure', 'Failed to disconnect from Solace broker');
        throw new Error('Failed to disconnect from Solace broker');
      }
      
      // All tests completed
      addTestResult('ALL TESTS', 'success', 'All Solace connection tests passed successfully!');
      
    } catch (err) {
      const error = err as Error;
      addTestResult('TEST FAILURE', 'failure', `Test execution failed: ${error.message}`);
      
      // Cleanup in case of error
      if (isConnected) {
        try {
          await disconnect();
          addTestResult('Cleanup', 'success', 'Successfully cleaned up Solace connection after test failure');
        } catch (err) {
          const cleanupError = err as Error;
          addTestResult('Cleanup', 'failure', `Failed to clean up Solace connection: ${cleanupError.message}`);
        }
      }
    } finally {
      setTestInProgress(false);
    }
  };
  
  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (isConnected) {
        disconnect().catch((err: unknown) => {
          const error = err as Error;
          console.error('Failed to disconnect during cleanup:', error);
        });
      }
    };
  }, [isConnected, disconnect]);
  
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Solace Connection Test</h1>
      
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Test Configuration</h2>
        <div className="bg-slate-800 p-4 rounded mb-4">
          <p><strong>Broker URL:</strong> {testCredentials.brokerUrl}</p>
          <p><strong>Message VPN:</strong> {testCredentials.vpnName}</p>
          <p><strong>Username:</strong> {testCredentials.username}</p>
          <p><strong>Password:</strong> ******</p>
        </div>
        
        <button 
          onClick={runTest}
          disabled={testInProgress}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-500 text-white rounded"
        >
          {testInProgress ? 'Running Tests...' : 'Run Connection Tests'}
        </button>
      </div>
      
      <div>
        <h2 className="text-lg font-semibold mb-2">Test Results</h2>
        
        {testResults.length === 0 ? (
          <p className="text-gray-400">No tests have been run yet.</p>
        ) : (
          <div className="space-y-2">
            {testResults.map((result, index) => (
              <div 
                key={index} 
                className={`p-3 rounded ${
                  result.status === 'pending' ? 'bg-yellow-800/20 border border-yellow-800' : 
                  result.status === 'success' ? 'bg-green-800/20 border border-green-800' : 
                  'bg-red-800/20 border border-red-800'
                }`}
              >
                <div className="flex items-center">
                  <span className={`mr-2 text-xl ${
                    result.status === 'pending' ? 'text-yellow-500' : 
                    result.status === 'success' ? 'text-green-500' : 
                    'text-red-500'
                  }`}>
                    {result.status === 'pending' ? '⏳' : result.status === 'success' ? '✅' : '❌'}
                  </span>
                  <span className="font-medium">{result.name}</span>
                </div>
                <p className="ml-7 text-sm text-gray-300">{result.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SolaceConnectionTest;