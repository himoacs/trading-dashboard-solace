/**
 * Helper utility to explicitly connect the market data publisher to Solace
 * and ensure it has an active connection for backend publishing.
 */

import { publisherSolaceService } from './publisherSolaceService';
import { storage } from '../storage';
import { SolaceConnection } from '@shared/schema';

/**
 * Retrieves the latest Solace configuration and ensures the publisher is connected
 * @returns True if connection is successful, false otherwise
 */
export async function ensureMarketDataPublisherConnected(): Promise<boolean> {
  try {
    console.log("Ensuring market data publisher is connected to Solace...");
    
    // Perform a strict check for connection
    const strictCheck = publisherSolaceService.isConnected();
    if (strictCheck) {
      console.log("Publisher connection verified: Already connected to Solace");
      return true;
    } else {
      console.log("Publisher connection verified: Not currently connected to Solace");
    }
    
    // Always attempt to fetch a fresh configuration
    console.log("Fetching latest Solace backend configuration...");
    const config = await storage.getActiveBackendSolaceConfig();
    
    if (!config) {
      console.log("No active backend Solace configuration found - cannot connect publisher");
      console.warn("CRITICAL SECURITY CHECK: Market data publisher requires dedicated backend credentials");
      console.warn("Publisher will NOT fall back to frontend connection - this is by design for security");
      return false;
    }
    
    // Verify this is a backend config before proceeding
    if (config.configType !== 'backend') {
      console.error("CRITICAL SECURITY ERROR: Non-backend config detected for market data publisher");
      console.error("Market data publisher MUST use backend credentials only");
      return false;
    }
    
    // Log the configuration (excluding password)
    console.log(`Found backend configuration: ${config.brokerUrl}, VPN: ${config.vpnName}, Username: ${config.username}`);
    
    // Convert to proper connection type with TCP port
    const connection: SolaceConnection = {
      brokerUrl: config.brokerUrl,
      vpnName: config.vpnName,
      username: config.username,
      password: config.password,
      configType: 'backend',
      tcpPort: config.tcpPort || '55555'
    };
    
    // First disconnect any existing session
    console.log("Ensuring clean slate - disconnecting any existing publisher session");
    await publisherSolaceService.disconnect();
    
    // Connect with the fresh configuration
    console.log(`Connecting market data publisher with config: ${connection.brokerUrl}, VPN: ${connection.vpnName}`);
    await publisherSolaceService.connect(connection);
    
    // Wait a moment for connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify connection was successful with a second check
    const isConnected = publisherSolaceService.isConnected();
    console.log(`Market data publisher connection ${isConnected ? 'successful' : 'failed'}`);
    
    if (isConnected) {
      console.log("Publisher successfully connected to Solace - ready to publish market data");
    } else {
      console.error("Publisher failed to connect to Solace - check credentials and network");
    }
    
    return isConnected;
  } catch (error) {
    console.error("Error ensuring market data publisher connection:", error);
    return false;
  }
}