/**
 * Run the topic subscription tests in the browser
 */
import React, { useEffect, useState } from 'react';
import { TopicSubscriptionTester, runTopicSubscriptionTests } from './topic-subscription-test';

export default function SubscriptionTestRunner() {
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<string[]>([]);
  const [testPassed, setTestPassed] = useState<boolean | null>(null);
  
  const runTests = () => {
    setTestRunning(true);
    setTestResults([]);
    
    // Create a console logger that captures logs
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    
    const capturedLogs: string[] = [];
    
    // Override console.log and console.error to capture their outputs
    console.log = (...args) => {
      originalConsoleLog(...args);
      capturedLogs.push(args.join(' '));
    };
    
    console.error = (...args) => {
      originalConsoleError(...args);
      capturedLogs.push(`ERROR: ${args.join(' ')}`);
    };
    
    try {
      // Run the tests
      const result = runTopicSubscriptionTests();
      setTestPassed(result);
      setTestResults(capturedLogs);
    } catch (error) {
      console.error('Test error:', error);
      setTestPassed(false);
      setTestResults([...capturedLogs, `Exception: ${error}`]);
    } finally {
      // Restore original console methods
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      setTestRunning(false);
    }
  };
  
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Topic Subscription Test Runner</h1>
      
      <button
        onClick={runTests}
        disabled={testRunning}
        className="px-4 py-2 bg-blue-600 text-white rounded-md mb-4 hover:bg-blue-700 disabled:opacity-50"
      >
        {testRunning ? 'Running Tests...' : 'Run Subscription Tests'}
      </button>
      
      {testPassed !== null && (
        <div className={`p-3 mb-4 rounded-md ${testPassed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          <strong>{testPassed ? 'PASSED' : 'FAILED'}</strong>: Topic Subscription Tests
        </div>
      )}
      
      <div className="bg-gray-900 rounded-md p-4 text-white font-mono text-sm whitespace-pre-wrap overflow-auto max-h-[500px]">
        {testResults.map((log, index) => (
          <div key={index} className={`${log.includes('PASSED') ? 'text-green-500' : log.includes('FAILED') ? 'text-red-500' : 'text-gray-300'}`}>
            {log}
          </div>
        ))}
        {testResults.length === 0 && !testRunning && <div className="text-gray-500">Run tests to see results here</div>}
        {testRunning && <div className="text-blue-500">Running tests...</div>}
      </div>
    </div>
  );
}