import { Switch, Route } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import ThemeToggle from "./components/ThemeToggle";
import SolaceConnectionTest from "./tests/solaceConnectionTest";
import SubscriptionTestRunner from "./tests/run-subscription-tests";
import WildcardSubscriptionTest from "./tests/wildcard-subscription-test";
import { useEffect, useState } from "react";
import { useSolaceConnection } from "./hooks/useSolaceConnection";

function SolaceConnectionManager() {
  const { toast } = useToast();
  const { connect, connected, connecting } = useSolaceConnection();
  
  // Removed auto-connect functionality
  // Test credentials are only for running tests and should not be used for auto-connecting
  
  useEffect(() => {
    console.log('Solace connection status:', connected ? 'Connected' : 'Not connected');
    
    // Clean up any WebSocket subscriptions when component unmounts
    return () => {
      console.log('Cleaning up Solace connection manager');
    };
  }, [connected]);
  
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/test/solace" component={SolaceConnectionTest} />
      <Route path="/test/subscriptions" component={SubscriptionTestRunner} />
      <Route path="/test/wildcard" component={WildcardSubscriptionTest} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // Set initial theme based on localStorage or system preference
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.classList.add('dark-mode');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.classList.add('light-mode');
    }
  }, []);
  
  // Handle browser window close to terminate Solace connection
  useEffect(() => {
    // Flag to track if disconnection is in progress
    let disconnecting = false;
    
    // Function to call disconnect endpoint with better error handling
    const disconnectFromSolace = async () => {
      if (disconnecting) return; // Prevent multiple disconnect calls
      
      try {
        disconnecting = true;
        console.log('Disconnecting from Solace...');
        
        // Use a timeout to prevent hanging if disconnect takes too long
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Disconnect timeout')), 2000)
        );
        
        // Race between the actual disconnect and the timeout
        await Promise.race([
          apiRequest('POST', '/api/solace/disconnect'),
          timeoutPromise
        ]);
        
        console.log('Successfully disconnected from Solace');
      } catch (error) {
        console.error('Error disconnecting from Solace:', error);
      } finally {
        disconnecting = false;
      }
    };

    // Add event listeners for page unload/close
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Attempt to disconnect from Solace
      disconnectFromSolace();
      
      // Standard beforeunload handling
      event.preventDefault();
      event.returnValue = '';
    };
    
    // Handle visibility change (tab switching/minimizing)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Browser tab is being hidden, consider disconnecting if needed
        console.log('Tab hidden, may disconnect if browser closes');
      }
    };

    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Cleanup event listeners when component unmounts
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Also attempt to disconnect when component unmounts
      disconnectFromSolace();
    };
  }, []);
  
  return (
    <QueryClientProvider client={queryClient}>
      <SolaceConnectionManager />
      <ThemeToggle className="fixed bottom-12 right-4 z-50" />
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
