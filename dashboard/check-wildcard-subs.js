/**
 * Simple script to check wildcard subscriptions
 * 
 * This script directly accesses the server-side wildcard list
 * without going through Vite middleware which can interfere with API routes
 */

// This is a "backdoor" approach to get information directly from the app.locals

// Get access to the app instance
const { app } = require('./server/index');

// Get the active WS clients and active wildcard subscriptions
if (app && app.locals) {
  const { clients, wildcardSubscriptions } = app.locals;
  
  console.log('===== WILDCARD SUBSCRIPTION CHECK =====');
  console.log('Active WS clients:', (clients || []).length);
  console.log('Wildcard subscriptions:', Array.from(wildcardSubscriptions || []));
  
  // Get client subscriptions
  const subscriptions = {};
  (app.locals.clientSubscriptions || new Map()).forEach((topics, client) => {
    subscriptions[`client_${client.readyState}`] = Array.from(topics);
  });
  
  console.log('Client subscriptions:', subscriptions);
  console.log('=======================================');
} else {
  console.error('App or app.locals not accessible');
}