import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SolaceConnection } from '@shared/schema'; // Assuming this path is correct

interface TopicExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionDetails?: SolaceConnection | null;
}

const TOPIC_EXPLORER_URL = 'https://explorer.solace.dev/';

export function TopicExplorerModal({
  isOpen,
  onClose,
  connectionDetails,
}: TopicExplorerModalProps) {
  // Attempt to construct URL with parameters if connectionDetails are provided
  // This is speculative and depends on whether explorer.solace.dev supports these URL params.
  // Example params: ?host=your_host&vpn=your_vpn&username=your_user&port=your_port&url=your_ws_url
  // For now, we will just load the base URL. We can refine this if URL params are confirmed.
  
  const explorerSrc = TOPIC_EXPLORER_URL; // Always use the base URL

  // TODO: Investigate if explorer.solace.dev supports URL parameters for pre-filling connection info.
  // If so, construct the URL here using connectionDetails.
  // Example (needs verification and correct parameter names for solace.dev):
  // if (connectionDetails?.brokerUrl && connectionDetails?.vpnName && connectionDetails?.username) {
  //   try {
  //     const url = new URL(connectionDetails.brokerUrl);
  //     const params = new URLSearchParams();
  //     params.append('url', connectionDetails.brokerUrl); // Or just host/port if that's how it works
  //     params.append('host', url.hostname);
  //     if (url.port) params.append('port', url.port);
  //     params.append('vpn', connectionDetails.vpnName);
  //     params.append('username', connectionDetails.username);
  //     // Password is typically not passed in URL for security.
  //     // Topic could be a default or user-configurable
  //     params.append('topics', '#LOG/>'); // Default topic
  //     explorerSrc = `${TOPIC_EXPLORER_URL}?${params.toString()}`;
  //   } catch (e) {
  //     console.error("Error parsing broker URL for Topic Explorer:", e);
  //     // Fallback to base URL
  //   }
  // }


  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[95vw] md:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] h-[90vh] flex flex-col p-2">
        <DialogHeader className="p-3 pb-1">
          <DialogTitle className="text-xl">Solace Topic Explorer</DialogTitle>
          <DialogDescription className="text-xs">
            Explore your Solace topic hierarchy. Connection details from your frontend connection will be shown below for manual entry if not auto-filled.
            The explorer is an external tool loaded from <a href={TOPIC_EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="underline text-primary">{TOPIC_EXPLORER_URL}</a>.
          </DialogDescription>
        </DialogHeader>
        
        {connectionDetails && (
          <div className="px-6 py-2 text-xs text-muted-foreground bg-muted/50 border-y">
            <p className="mb-1"><strong>Use these details for manual connection in the explorer if needed:</strong></p>
            <p><strong>Broker URL:</strong> {connectionDetails.brokerUrl || 'N/A'}</p>
            <p><strong>Message VPN:</strong> {connectionDetails.vpnName || 'N/A'}</p>
            <p><strong>Username:</strong> {connectionDetails.username || 'N/A'}</p>
            {/* Password is intentionally not displayed */}
          </div>
        )}

        <div className="flex-1 p-0 m-0 border-0 overflow-hidden">
          <iframe
            src={explorerSrc}
            title="Solace Topic Explorer"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups" // Sandbox for security, allow-same-origin might be needed if it redirects within its own domain after param processing
          />
        </div>
      </DialogContent>
    </Dialog>
  );
} 