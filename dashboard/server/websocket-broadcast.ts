/**
 * This file provides functions for broadcasting messages to WebSocket clients
 * We separate this into its own file to avoid circular dependencies
 */

// Store global reference to WebSocket clients and subscriptions
// These will be set from routes.ts
let globalClients: any[] = [];
let clientSubscriptions = new Map<any, Set<string>>();

/**
 * Update the global clients reference
 */
export function setGlobalClients(clients: any[]): void {
  globalClients = clients;
}

/**
 * Update the client subscriptions reference
 */
export function setClientSubscriptions(subscriptions: Map<any, Set<string>>): void {
  clientSubscriptions = subscriptions;
}

/**
 * Broadcast a message to all WebSocket clients subscribed to a specific topic
 */
export function broadcast(topic: string, message: any): void {
  let sentCount = 0;
  
  // Get WebSocket and isOpen function based on what's available
  const WebSocket = globalClients[0]?.constructor;
  const OPEN = WebSocket?.OPEN || 1;
  
  // Broadcast to all clients subscribed to this topic
  globalClients.forEach(client => {
    try {
      // Check if the client is open/connected
      if (client.readyState === OPEN) {
        // Check subscriptions (if available) or broadcast to all
        const clientSubs = clientSubscriptions.get(client);
        
        // Always send signal/output to everyone, or if client is specifically subscribed
        if (topic === 'signal/output' || 
            !clientSubs || // No subscription tracking
            clientSubs.has(topic) || // Explicitly subscribed
            clientSubs.has('*')) { // Wildcard subscription
          
          client.send(JSON.stringify(message));
          sentCount++;
        }
      }
    } catch (error) {
      console.error(`Error sending WebSocket message for topic ${topic}:`, error);
    }
  });
  
  // Only log non-frequent broadcasts to reduce console noise
  if (sentCount > 0 && topic !== 'signal/output' && topic !== 'ping' && Math.random() < 0.05) {
    console.log(`Broadcast ${topic} to ${sentCount} clients`);
  }
}