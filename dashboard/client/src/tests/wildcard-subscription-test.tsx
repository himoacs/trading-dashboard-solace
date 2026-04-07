/**
 * Wildcard Subscription Test Component
 * 
 * This component allows testing of country-level and exchange-level
 * wildcard subscription functionality directly in the UI.
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useWebSocket } from '../hooks/useWebSocket';

const WildcardSubscriptionTest = () => {
  const [selectedCountry, setSelectedCountry] = useState('JP');
  const [testResults, setTestResults] = useState<Array<{topic: string, covered: boolean}>>([]);
  const [wildcardTestResults, setWildcardTestResults] = useState<{
    wildcardAdded: boolean;
    individualStocksAdded: string[];
    country: string;
    wildcardTopic: string;
  } | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  
  // Initialize WebSocket connection but don't subscribe to any topics yet
  const { isConnected, sendMessage } = useWebSocket([], true);
  
  // Helper function to subscribe to a topic with wildcard flag
  const subscribeToTopic = (topic: string, isWildcard: boolean) => {
    sendMessage({
      type: 'subscribe_topic',
      topic,
      isWildcard,
      wildcardType: 'country',
      timestamp: new Date().toISOString()
    });
  };
  
  // Test subscription to a country wildcard
  const testCountryWildcard = async () => {
    if (!isConnected) {
      setTestStatus('failed');
      setTestResults([{ topic: 'WebSocket not connected', covered: false }]);
      return;
    }
    
    setTestStatus('running');
    setTestResults([]);
    
    try {
      // Get initial client subscriptions to compare later
      await fetchWildcardSubscriptions();
      const initialClientSubscriptions = {...clientSubscriptions};
      const initialWildcardSubscriptions = [...wildcardSubscriptions];
      
      console.log('Initial subscriptions:', { 
        clientSubs: initialClientSubscriptions,
        wildcardSubs: initialWildcardSubscriptions
      });
      
      // Subscribe to country wildcard - use format market-data/EQ/{COUNTRY}/> (no trailing slash)
      // This is the format expected by the server
      const wildcardTopic = `market-data/EQ/${selectedCountry}/>`;
      console.log(`Subscribing to country wildcard: ${wildcardTopic}`);
      
      // First, unsubscribe from any existing country wildcard to clean up
      sendMessage({
        type: 'unsubscribe_topic',
        topic: wildcardTopic,
        timestamp: new Date().toISOString()
      });
      
      // Wait for unsubscribe to process
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Force the isWildcard flag to true explicitly
      sendMessage({
        type: 'subscribe_topic',
        topic: wildcardTopic,
        isWildcard: true,
        wildcardType: 'country',
        timestamp: new Date().toISOString()
      });
      
      // Give the server more time to process the subscription
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Refresh subscriptions to see what was added
      await fetchWildcardSubscriptions();
      
      console.log('After wildcard subscription:', { 
        clientSubs: clientSubscriptions,
        wildcardSubs: wildcardSubscriptions
      });
      
      // Test stocks from this country
      const countryStocks = getTestStocksForCountry(selectedCountry);
      const otherStocks = getTestStocksForOtherCountries(selectedCountry);
      
      // Test each stock's coverage via the API
      const results: Array<{topic: string, covered: boolean}> = [];
      
      // Test API endpoint directly first to verify it works
      console.log('Testing API endpoint directly...');
      try {
        const response = await fetch('/api/ws/test-wildcard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ debug: true })
        });
        const responseData = await response.json();
        console.log('Wildcard registry status:', responseData);
      } catch (error) {
        console.error('Error testing wildcard registry:', error);
      }
      
      // Test stocks from selected country (should be covered)
      for (const stock of countryStocks) {
        const result = await testTopicCoverage(stock);
        results.push({ topic: stock, covered: result });
      }
      
      // Test stocks from other countries (should NOT be covered)
      for (const stock of otherStocks) {
        const result = await testTopicCoverage(stock);
        results.push({ topic: stock, covered: result });
      }
      
      setTestResults(results);
      
      // CRITICAL TEST: Check if the wildcard was added but individual stocks were NOT added
      const wildcardWasAdded = wildcardSubscriptions.includes(wildcardTopic);
      
      // Check if any individual stock topics were added (they shouldn't be)
      const individualStocksAdded: string[] = [];
      
      // Compare client subscriptions before and after
      Object.entries(clientSubscriptions).forEach(([clientId, topics]) => {
        const initialTopics = initialClientSubscriptions[clientId] || [];
        
        // Find newly added topics
        const newTopics = topics.filter(topic => !initialTopics.includes(topic));
        
        // Check if any individual stock topics from this country were added
        newTopics.forEach(topic => {
          if (topic.startsWith(`market-data/EQ/${selectedCountry}/`) && !topic.includes('>')) {
            individualStocksAdded.push(topic);
          }
        });
      });
      
      // Store the wildcard test results
      setWildcardTestResults({
        wildcardAdded: wildcardWasAdded,
        individualStocksAdded,
        country: selectedCountry,
        wildcardTopic
      });
      
      console.log('Test results:', {
        wildcardWasAdded,
        individualStocksAdded,
        countryStocks,
        wildcardTopic
      });
      
      // Test passes if:
      // 1. The wildcard was added to the registry
      // 2. Individual stock topics were NOT added (we use the wildcard instead)
      // 3. Stock topics from this country are covered
      // 4. Stock topics from other countries are NOT covered
      const passed = 
        wildcardWasAdded && 
        individualStocksAdded.length === 0 &&
        countryStocks.every(stock => results.find(r => r.topic === stock)?.covered === true) && 
        otherStocks.every(stock => results.find(r => r.topic === stock)?.covered === false);
      
      setTestStatus(passed ? 'success' : 'failed');
      
      if (!passed) {
        console.error('Test failed. Issues:', {
          wildcardAdded: wildcardWasAdded ? 'Yes' : 'No',
          individualStocksAddedCount: individualStocksAdded.length,
          countryStocksCovered: countryStocks.every(stock => 
            results.find(r => r.topic === stock)?.covered === true
          ) ? 'Yes' : 'No',
          otherStocksNotCovered: otherStocks.every(stock => 
            results.find(r => r.topic === stock)?.covered === false
          ) ? 'Yes' : 'No'
        });
      }
    } catch (error) {
      console.error('Test failed:', error);
      setTestStatus('failed');
      setTestResults([{ topic: 'Error running test', covered: false }]);
    }
  };
  
  // Test if a topic is covered by the wildcard
  const testTopicCoverage = async (topic: string): Promise<boolean> => {
    try {
      console.log(`Testing coverage for topic: ${topic}`);
      
      const response = await fetch('/api/ws/test-topic-coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
      });
      
      const result = await response.json();
      console.log(`Coverage result for ${topic}:`, result);
      
      // For diagnostic purposes
      if (!result.covered) {
        console.log(`Topic ${topic} is NOT covered by any wildcards`);
      } else {
        console.log(`Topic ${topic} IS covered by wildcards`);
      }
      
      return result.covered === true;
    } catch (error) {
      console.error(`Error testing coverage for ${topic}:`, error);
      return false;
    }
  };
  
  // Helper to get test stocks for a specific country
  const getTestStocksForCountry = (country: string): string[] => {
    switch (country) {
      case 'JP':
        return [
          'market-data/EQ/JP/TSE/7203',
          'market-data/EQ/JP/TSE/9984'
        ];
      case 'UK':
        return [
          'market-data/EQ/UK/LSE/HSBA',
          'market-data/EQ/UK/LSE/BARC'
        ];
      case 'US':
        return [
          'market-data/EQ/US/NYSE/AAPL',
          'market-data/EQ/US/NASDAQ/MSFT'
        ];
      case 'AU':
        return [
          'market-data/EQ/AU/ASX/BHP',
          'market-data/EQ/AU/ASX/NAB'
        ];
      default:
        return [];
    }
  };
  
  // Helper to get test stocks from other countries
  const getTestStocksForOtherCountries = (excludeCountry: string): string[] => {
    const allCountries = ['JP', 'UK', 'US', 'AU'];
    const otherCountries = allCountries.filter(c => c !== excludeCountry);
    
    // Get one stock from each other country
    return otherCountries.map(country => getTestStocksForCountry(country)[0]);
  };
  
  // Fetch and display current wildcard subscriptions
  const [wildcardSubscriptions, setWildcardSubscriptions] = useState<string[]>([]);
  
  const [clientSubscriptions, setClientSubscriptions] = useState<Record<string, string[]>>({});
  
  const fetchWildcardSubscriptions = async () => {
    try {
      const response = await fetch('/api/ws/subscriptions');
      const data = await response.json();
      if (data.wildcard_subscriptions) {
        setWildcardSubscriptions(data.wildcard_subscriptions);
      }
      if (data.client_subscriptions) {
        setClientSubscriptions(data.client_subscriptions);
      }
      
      console.log('Subscription Data:', data);
    } catch (error) {
      console.error('Error fetching wildcard subscriptions:', error);
    }
  };
  
  // Fetch on component mount and when test completes
  useEffect(() => {
    fetchWildcardSubscriptions();
    
    // Refresh every 5 seconds
    const interval = setInterval(fetchWildcardSubscriptions, 5000);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <Card className="w-full max-w-3xl mx-auto mt-8">
      <CardHeader>
        <CardTitle>Wildcard Subscription Test</CardTitle>
        <CardDescription>
          Test country-level wildcard subscriptions to verify if they correctly cover individual stock topics
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          {/* Display current wildcard subscriptions */}
          <div className="bg-muted/50 p-4 rounded-md">
            <h3 className="text-lg font-medium mb-2">Current Wildcard Subscriptions</h3>
            {wildcardSubscriptions.length === 0 ? (
              <p className="text-muted-foreground">No wildcard subscriptions registered</p>
            ) : (
              <div className="space-y-2">
                {wildcardSubscriptions.map((wildcard, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-background rounded border">
                    <code className="text-sm font-mono">{wildcard}</code>
                    <Badge>Active</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Display client subscriptions to check if individual topics are being added */}
          <div className="bg-muted/50 p-4 rounded-md">
            <h3 className="text-lg font-medium mb-2">Client Topic Subscriptions</h3>
            
            {Object.keys(clientSubscriptions).length === 0 ? (
              <p className="text-muted-foreground">No client subscriptions found</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(clientSubscriptions).map(([clientId, topics], index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">Client {clientId}</h4>
                      <Badge variant="outline">{topics.length} topics</Badge>
                    </div>
                    
                    <div className="max-h-40 overflow-y-auto bg-background rounded border p-2">
                      {topics.map((topic, i) => {
                        // Check if this is a wildcard subscription
                        const isWildcard = topic.includes('>');
                        // Check if this is an individual stock topic
                        const isStockTopic = topic.startsWith('market-data/EQ/') && !topic.includes('>');
                        
                        return (
                          <div key={i} className="flex items-center justify-between py-1">
                            <code className="text-xs font-mono truncate max-w-[300px]">{topic}</code>
                            {isWildcard ? (
                              <Badge variant="default" className="ml-2">Wildcard</Badge>
                            ) : isStockTopic ? (
                              <Badge variant="secondary" className="ml-2">Stock</Badge>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div>
            <h3 className="text-lg font-medium mb-2">Select Country for Wildcard</h3>
            <RadioGroup 
              value={selectedCountry} 
              onValueChange={setSelectedCountry}
              className="flex space-x-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="JP" id="jp" />
                <Label htmlFor="jp">Japan (JP)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="UK" id="uk" />
                <Label htmlFor="uk">United Kingdom (UK)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="US" id="us" />
                <Label htmlFor="us">United States (US)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="AU" id="au" />
                <Label htmlFor="au">Australia (AU)</Label>
              </div>
            </RadioGroup>
          </div>
          
          <div className="flex items-center space-x-2">
            <Button 
              onClick={testCountryWildcard} 
              disabled={!isConnected || testStatus === 'running'}
            >
              Test {selectedCountry} Wildcard Subscription
            </Button>
            
            <Button 
              variant="outline"
              onClick={async () => {
                if (!isConnected || testStatus === 'running') return;
                
                // Test all countries in sequence
                const countries = ['JP', 'UK', 'US', 'AU'];
                let allPassed = true;
                
                for (const country of countries) {
                  setSelectedCountry(country);
                  setTestStatus('running');
                  setTestResults([]);
                  
                  try {
                    // Get initial subscriptions
                    await fetchWildcardSubscriptions();
                    const initialClientSubscriptions = {...clientSubscriptions};
                    const initialWildcardSubscriptions = [...wildcardSubscriptions];
                    
                    // Subscribe to country wildcard
                    const wildcardTopic = `market-data/EQ/${country}/>`;
                    console.log(`Subscribing to country wildcard: ${wildcardTopic}`);
                    
                    // First, unsubscribe from any existing country wildcard to clean up
                    sendMessage({
                      type: 'unsubscribe_topic',
                      topic: wildcardTopic,
                      timestamp: new Date().toISOString()
                    });
                    
                    // Wait for unsubscribe to process
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Force the isWildcard flag to true explicitly
                    sendMessage({
                      type: 'subscribe_topic',
                      topic: wildcardTopic,
                      isWildcard: true,
                      wildcardType: 'country',
                      timestamp: new Date().toISOString()
                    });
                    
                    // Give the server more time to process the subscription
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Refresh to see what was added
                    await fetchWildcardSubscriptions();
                    
                    console.log('After wildcard subscription:', { 
                      clientSubs: clientSubscriptions,
                      wildcardSubs: wildcardSubscriptions
                    });
                    
                    // Test API endpoint directly first to verify it works
                    console.log(`Testing API endpoint for ${country} directly...`);
                    try {
                      const response = await fetch('/api/ws/test-wildcard', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ debug: true })
                      });
                      const responseData = await response.json();
                      console.log(`Wildcard registry status for ${country}:`, responseData);
                    } catch (error) {
                      console.error(`Error testing wildcard registry for ${country}:`, error);
                    }
                    
                    // Test if the wildcard itself was added to the registry
                    const wildcardWasAdded = wildcardSubscriptions.includes(wildcardTopic);
                    
                    // Check if any individual stock topics were added (they shouldn't be)
                    const individualStocksAdded: string[] = [];
                    
                    // Compare client subscriptions before and after
                    Object.entries(clientSubscriptions).forEach(([clientId, topics]) => {
                      const initialTopics = initialClientSubscriptions[clientId] || [];
                      
                      // Find newly added topics
                      const newTopics = topics.filter(topic => !initialTopics.includes(topic));
                      
                      // Check if any individual stock topics were added
                      newTopics.forEach(topic => {
                        if (topic.startsWith(`market-data/EQ/${country}/`) && !topic.includes('>')) {
                          individualStocksAdded.push(topic);
                        }
                      });
                    });
                    
                    // Test stocks from this country
                    const countryStocks = getTestStocksForCountry(country);
                    const otherStocks = getTestStocksForOtherCountries(country);
                    
                    // Test each stock's coverage via the API
                    const results: Array<{topic: string, covered: boolean}> = [];
                    
                    // Test stocks from selected country (should be covered)
                    for (const stock of countryStocks) {
                      const result = await testTopicCoverage(stock);
                      results.push({ topic: stock, covered: result });
                    }
                    
                    // Test stocks from other countries (should NOT be covered)
                    for (const stock of otherStocks.slice(0, 1)) { // Just test one other country to keep it fast
                      const result = await testTopicCoverage(stock);
                      results.push({ topic: stock, covered: result });
                    }
                    
                    setTestResults(results);
                    
                    // Test passes if:
                    // 1. The wildcard was added to the registry
                    // 2. Individual stock topics were NOT added (we use the wildcard instead)
                    // 3. Stock topics from this country are covered by the wildcard
                    // 4. Stock topics from other countries are NOT covered
                    const passed = 
                      wildcardWasAdded && 
                      individualStocksAdded.length === 0 &&
                      countryStocks.every(stock => results.find(r => r.topic === stock)?.covered === true) && 
                      otherStocks.some(stock => results.find(r => r.topic === stock)?.covered === false);
                    
                    // Store the wildcard test results for this country
                    setWildcardTestResults({
                      wildcardAdded: wildcardWasAdded,
                      individualStocksAdded,
                      country: country,
                      wildcardTopic: wildcardTopic
                    });
                    
                    console.log(`Test results for ${country}:`, {
                      wildcardWasAdded,
                      individualStocksAdded,
                      countryStocksCovered: countryStocks.every(stock => 
                        results.find(r => r.topic === stock)?.covered === true
                      ),
                      otherStocksNotCovered: otherStocks.some(stock => 
                        results.find(r => r.topic === stock)?.covered === false
                      )
                    });
                    
                    if (!passed) {
                      allPassed = false;
                      console.error(`Test failed for ${country}`);
                    }
                  } catch (error) {
                    console.error(`Test failed for ${country}:`, error);
                    allPassed = false;
                  }
                  
                  // Pause between countries
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // Update final status
                setTestStatus(allPassed ? 'success' : 'failed');
                
                // Refresh subscriptions
                fetchWildcardSubscriptions();
              }}
              disabled={!isConnected || testStatus === 'running'}
            >
              Test All Countries
            </Button>
            
            <Badge variant={
              testStatus === 'idle' ? 'outline' :
              testStatus === 'running' ? 'secondary' :
              testStatus === 'success' ? 'default' :
              'destructive'
            }>
              {testStatus === 'idle' ? 'Ready' :
               testStatus === 'running' ? 'Testing...' :
               testStatus === 'success' ? 'Success ✓' :
               'Failed ✗'}
            </Badge>
          </div>
          
          {testStatus !== 'idle' && (
            <>
              <Separator className="my-4" />
              
              <div className="space-y-4">
                <h3 className="text-lg font-medium mb-2">Test Results</h3>
                
                {testStatus === 'running' ? (
                  <Alert>
                    <AlertTitle>Running test...</AlertTitle>
                    <AlertDescription>
                      Testing wildcard subscription for {selectedCountry}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    {/* Wildcard analysis results */}
                    {wildcardTestResults && (
                      <div className="bg-muted p-4 rounded-md">
                        <h4 className="font-medium mb-2">Wildcard Analysis</h4>
                        
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex justify-between p-2 border rounded bg-background">
                            <span className="font-medium">Country:</span>
                            <span>{wildcardTestResults.country}</span>
                          </div>
                          
                          <div className="flex justify-between p-2 border rounded bg-background">
                            <span className="font-medium">Wildcard Topic:</span>
                            <code className="text-xs font-mono">{wildcardTestResults.wildcardTopic}</code>
                          </div>
                          
                          <div className="flex justify-between p-2 border rounded bg-background">
                            <span className="font-medium">Wildcard Added:</span>
                            <Badge variant={wildcardTestResults.wildcardAdded ? 'default' : 'destructive'}>
                              {wildcardTestResults.wildcardAdded ? 'Yes ✓' : 'No ✗'}
                            </Badge>
                          </div>
                          
                          <div className="flex justify-between p-2 border rounded bg-background">
                            <span className="font-medium">Individual Stock Topics:</span>
                            {wildcardTestResults.individualStocksAdded.length === 0 ? (
                              <Badge variant="default">None Added ✓</Badge>
                            ) : (
                              <Badge variant="destructive">
                                {wildcardTestResults.individualStocksAdded.length} Added ✗
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        {wildcardTestResults.individualStocksAdded.length > 0 && (
                          <div className="mt-2 p-2 border rounded bg-background max-h-20 overflow-y-auto">
                            <p className="text-sm font-medium text-destructive mb-1">Individual stock topics incorrectly added:</p>
                            {wildcardTestResults.individualStocksAdded.map((topic, i) => (
                              <div key={i} className="text-xs font-mono">{topic}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Topic coverage results */}
                    <div className="space-y-2">
                      <h4 className="font-medium mb-2">Topic Coverage</h4>
                      {testResults.map((result, i) => (
                        <div key={i} className="flex justify-between items-center p-2 border rounded bg-background">
                          <div className="text-sm font-mono">{result.topic}</div>
                          <Badge variant={result.covered ? 'default' : 'destructive'}>
                            {result.covered ? 'Covered ✓' : 'Not Covered ✗'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </CardContent>
      
      <CardFooter className="flex justify-between border-t pt-4">
        <div className="text-sm">
          {isConnected ? 
            <span className="text-green-600">WebSocket Connected ✓</span> : 
            <span className="text-red-600">WebSocket Disconnected ✗</span>
          }
        </div>
        
        <div className="text-sm text-muted-foreground">
          Will test wildcard pattern: market-data/EQ/{selectedCountry}/{'>'} 
        </div>
      </CardFooter>
    </Card>
  );
};

export default WildcardSubscriptionTest;