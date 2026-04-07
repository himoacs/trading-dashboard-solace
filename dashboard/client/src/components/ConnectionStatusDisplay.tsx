import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Play, Square, Loader2, Settings } from 'lucide-react';
import { SolaceConnection } from '@shared/schema';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/hooks/use-toast';

export interface ConnectionStatusInfo {
  connected: boolean;
  connecting: boolean;
  currentConfig?: SolaceConnection | null;
  tcpPort?: string;
  lastError?: string;
  feedActive?: boolean;
  feedStarting?: boolean;
  frequency?: number;
  frequencyMs?: number;
  messageOptions?: {
    deliveryMode: "DIRECT" | "PERSISTENT";
    allowMessageEliding: boolean;
    dmqEligible: boolean;
  };
}

interface ConnectionStatusDisplayProps {
  serviceLabel: string;
  statusInfo: ConnectionStatusInfo;
  className?: string;
  showFeedControls?: boolean;
  showQoSControls?: boolean;
  onStartFeed?: () => Promise<void>;
  onStopFeed?: () => Promise<void>;
  onUpdateQoS?: (options: {
    deliveryMode: "DIRECT" | "PERSISTENT";
    allowMessageEliding: boolean;
    dmqEligible: boolean;
    frequency?: number;
    frequencyMs?: number;
  }) => Promise<void>;
}

export default function ConnectionStatusDisplay({ 
  serviceLabel, 
  statusInfo, 
  className,
  showFeedControls = false,
  showQoSControls = false,
  onStartFeed,
  onStopFeed,
  onUpdateQoS
}: ConnectionStatusDisplayProps) {
  const { 
    connected, 
    connecting, 
    currentConfig, 
    tcpPort, 
    lastError,
    feedActive = false,
    feedStarting = false,
    frequency,
    frequencyMs: propFrequencyMs,
    messageOptions = {
      deliveryMode: "DIRECT",
      allowMessageEliding: true,
      dmqEligible: true
    }
  } = statusInfo;
  
  // State for the popover
  const [popoverOpen, setPopoverOpen] = useState(false);
  
  // State for QoS settings with initial values from props
  const [qosSettings, setQosSettings] = useState({
    deliveryMode: messageOptions.deliveryMode,
    allowMessageEliding: messageOptions.allowMessageEliding ?? false,
    dmqEligible: messageOptions.dmqEligible
  });
  
  // Local state for more responsive UI
  const [localFeedStarting, setLocalFeedStarting] = useState(feedStarting);
  const [localFeedStopping, setLocalFeedStopping] = useState(false);
  const [localFeedActive, setLocalFeedActive] = useState(feedActive);
  
  // Feed frequency state (in milliseconds, for precise control)
  const [localFeedFrequencyMs, setLocalFeedFrequencyMs] = useState(
    serviceLabel.includes("Market Data") 
      ? (propFrequencyMs ?? 500) // Default to 500ms for Market Data
      : (propFrequencyMs ?? (frequency ?? 60) * 1000) // Existing logic for others
  );
  
  // Update local state when props change
  useEffect(() => {
    const newAllowEliding = messageOptions.allowMessageEliding ?? false;

    if (newAllowEliding !== qosSettings.allowMessageEliding ||
        messageOptions.deliveryMode !== qosSettings.deliveryMode ||
        messageOptions.dmqEligible !== qosSettings.dmqEligible) {
      // Added console log for clarity during debugging
      console.log(`[${serviceLabel} useEffect sync from props] Prop eliding: ${newAllowEliding}, Local eliding: ${qosSettings.allowMessageEliding}. Updating local state.`);
      setQosSettings({
        deliveryMode: messageOptions.deliveryMode,
        allowMessageEliding: newAllowEliding,
        dmqEligible: messageOptions.dmqEligible
      });
    }
  }, [messageOptions.deliveryMode, messageOptions.allowMessageEliding, messageOptions.dmqEligible, serviceLabel]); // Removed qosSettings from dependency array, added serviceLabel for log
  
  // Update local feed state when props change
  useEffect(() => {
    setLocalFeedActive(feedActive);
    setLocalFeedStarting(feedStarting);
    setLocalFeedStopping(false); // Reset stopping state when server updates
  }, [feedActive, feedStarting]);
  
  // When the frequency prop from statusInfo changes (e.g., after a successful update),
  // update our local copy for the slider.
  useEffect(() => {
    const newFrequencyMs = serviceLabel.includes("Market Data")
      ? (propFrequencyMs ?? 500) // Default to 500ms for Market Data if prop is undefined
      : (propFrequencyMs ?? (frequency ?? 60) * 1000); // Existing logic for others

    // Only update if it's different, to avoid overriding user input before submission
    if (newFrequencyMs !== localFeedFrequencyMs) {
        setLocalFeedFrequencyMs(newFrequencyMs);
    }
  }, [propFrequencyMs, frequency, serviceLabel]); // Added serviceLabel
  
  // ADDED: Log relevant props and local state for QoS visibility debugging
  useEffect(() => {
    console.log(`[${serviceLabel} QoS Debug] Props for QoS visibility:`, {
      showQoSControls,
      connected,
      feedActiveFromProp: feedActive, // from statusInfo
      localFeedActiveState: localFeedActive,
    });
  }, [serviceLabel, showQoSControls, connected, feedActive, localFeedActive]);

  // Handle QoS update
  const handleQoSUpdate = async () => {
    if (onUpdateQoS) {
      try {
        toast({
          title: "Applying Settings...",
          description: `Updating ${serviceLabel} feed settings`,
          duration: 2000
        });
        
        // Validate frequencyMs value before sending
        const minFreq = serviceLabel.includes("Market Data") ? 0 : 1000; // 0ms for Market Data, 1s for others
        const maxFreq = serviceLabel.includes("Market Data") ? 1000 : undefined; // 1000ms max for Market Data

        let validatedFrequencyMs = Math.max(minFreq, localFeedFrequencyMs);
        if (maxFreq !== undefined) {
          validatedFrequencyMs = Math.min(validatedFrequencyMs, maxFreq);
        }
        
        const calculatedFrequencyInSeconds = Math.round(validatedFrequencyMs / 1000);

        await onUpdateQoS({
          ...qosSettings,
          frequency: calculatedFrequencyInSeconds, // Send frequency in seconds for compatibility
          frequencyMs: validatedFrequencyMs // Send frequency in ms for precision
        });
        
        setPopoverOpen(false);
        toast({
          title: "Feed Settings Updated",
          description: `${serviceLabel} feed settings have been applied successfully.`,
          variant: "default"
        });
      } catch (error) {
        // Show error toast
        toast({
          title: "Error",
          description: `Could not update feed settings for ${serviceLabel}.`,
          variant: "destructive"
        });
      }
    }
  };

  // Enhanced logging for feed status tracking
  React.useEffect(() => {
    console.log(`[${serviceLabel}] Feed status updated:`, { 
      connected, 
      feedActive, 
      feedStarting,
      time: new Date().toISOString()
    });
  }, [serviceLabel, connected, feedActive, feedStarting]);
  
  // Determine status badge color and styling
  const getBadgeVariant = () => {
    if (connected) return "default";
    if (connecting) return "secondary";
    return "destructive";
  };
  
  // Get custom badge class based on status
  const getBadgeClass = () => {
    if (connected) return "bg-green-500 hover:bg-green-600";
    if (connecting) return "bg-yellow-500 hover:bg-yellow-600";
    return ""; // default for destructive
  };
  
  // Determine status text
  const getStatusText = () => {
    if (connected) return "Connected";
    if (connecting) return "Connecting...";
    return "Disconnected";
  };
  
  const showGenericError = lastError && !connected && !connecting;
  // Only treat "No configuration provided." as a non-displayable initial error if there is indeed no currentConfig visible to the frontend for this service.
  const isSuppressedInitialNoConfigError = lastError === "No configuration provided." && !currentConfig;

  return (
    <div className={cn("rounded-md border p-3 bg-card text-card-foreground", className)}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">{serviceLabel}</h3>
        <Badge variant={getBadgeVariant()} className={getBadgeClass()}>
          {getStatusText()}
        </Badge>
      </div>
      
      {/* Show connection details when connected or connecting */}
      {(connected || connecting) && currentConfig && (
        <div className="text-xs text-muted-foreground mt-1">
          <p>Host: {currentConfig.brokerUrl}</p>
          <p>VPN: {currentConfig.vpnName}</p>
        </div>
      )}
      
      {showGenericError && !isSuppressedInitialNoConfigError && (
        <div className="mt-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md">
          <h4 className="text-xs font-semibold text-destructive mb-1">Connection Error</h4>
          <p className="text-xs text-destructive/80 whitespace-pre-wrap break-words">{lastError}</p>
        </div>
      )}
      
      {/* Feed controls */}
      {showFeedControls && connected && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${serviceLabel}-feed-toggle`} className="text-xs flex-grow mr-2 text-muted-foreground">
              {localFeedActive ? 'Feed Active' : 'Feed Inactive'}
            </Label>
              <Button 
              id={`${serviceLabel}-feed-toggle`}
              variant={localFeedActive ? "destructive" : "default"}
                className="px-2 py-1 text-xs min-w-[60px] h-auto" // Further reduced padding, set min-width, ensure auto height
              onClick={async () => {
                if (localFeedActive) {
                  if (onStopFeed) {
                  setLocalFeedStopping(true);
                    try {
                      await onStopFeed();
                    } catch (e) { console.error("Error stopping feed",e); } 
                  }
                } else {
                  if (onStartFeed) {
                  setLocalFeedStarting(true);
                    try {
                      await onStartFeed();
                    } catch (e) { console.error("Error starting feed",e); }
                  }
                }
              }}
              disabled={localFeedStarting || localFeedStopping}
            >
              {localFeedStarting ? (
                <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Starting...</>
              ) : localFeedStopping ? (
                <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Stopping...</>
              ) : localFeedActive ? (
                <><Square className="mr-1 h-3 w-3" /> Stop</> 
              ) : (
                <><Play className="mr-1 h-3 w-3" /> Start</> 
              )}
            </Button>
          </div>
        </div>
      )}
            
      {/* QoS Info & Controls - only if showQoSControls is true, connected, and feed is active */}
      {showQoSControls && connected && localFeedActive && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {'Mode: '}
              <span className="font-semibold text-foreground">{qosSettings.deliveryMode}</span>
              {qosSettings.deliveryMode === "PERSISTENT" && (
                <>
                  {' | DMQ: '}
                  <span className="font-semibold text-foreground">{qosSettings.dmqEligible ? 'On' : 'Off'}</span>
                </>
              )}
              {' | Eliding: '}
              <span className="font-semibold text-foreground">{qosSettings.allowMessageEliding ? 'On' : 'Off'}</span>
              {localFeedFrequencyMs !== undefined && (
                <>
                  {' | Freq: '}
                  <span className="font-semibold text-foreground">
                    {serviceLabel.includes("Market Data") ? `${localFeedFrequencyMs}ms` : `${Math.round(localFeedFrequencyMs/1000)}s`}
                  </span>
                </>
              )}
            </div>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="ml-2">
                  <Settings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4 bg-popover text-popover-foreground">
                <div className="grid gap-y-4"> {/* Changed gap-y-6 to gap-y-4 */}
                  <div className="space-y-2">
                    <h3 className="font-medium leading-none text-sm text-foreground">Feed Settings</h3> {/* Changed h4 to h3 for consistency if needed, kept styling */}
                    <p className="text-xs text-muted-foreground">
                      Adjust QoS and update frequency for {serviceLabel}.
                    </p>
                  </div>
                  
                  {/* Delivery Mode Display (Read-only) */}
                  <div className="grid grid-cols-2 items-center gap-x-2">
                    <Label className="text-xs font-medium text-muted-foreground">Delivery Mode:</Label>
                    <span className="text-xs px-2 py-1 bg-muted text-muted-foreground rounded-md text-center">
                      {qosSettings.deliveryMode}
                    </span>
                  </div>
                    
                  {/* DMQ Eligible Switch (only for Persistent) */}
                  {qosSettings.deliveryMode === "PERSISTENT" && (
                    <div className="flex items-center justify-between space-x-2">
                      <Label htmlFor={`${serviceLabel}-dmq`} className="text-xs font-medium text-muted-foreground flex-shrink-0">
                        DMQ Eligible
                      </Label>
                      <Switch 
                        id={`${serviceLabel}-dmq`}
                        checked={qosSettings.dmqEligible}
                        onCheckedChange={(checked) => setQosSettings(prev => ({...prev, dmqEligible: checked}))}
                        className="data-[state=checked]:bg-primary"
                      />
                    </div>
                  )}

                  {/* Allow Message Eliding Switch */}
                  <div className="flex items-center justify-between space-x-2">
                    <Label htmlFor={`${serviceLabel}-eliding`} className="text-xs font-medium text-muted-foreground flex-shrink-0">
                      Allow Message Eliding
                    </Label>
                    <Switch 
                      id={`${serviceLabel}-eliding`}
                      checked={qosSettings.allowMessageEliding} 
                      onCheckedChange={(checked) => setQosSettings(prev => ({...prev, allowMessageEliding: checked}))}
                      className="data-[state=checked]:bg-primary"
                    />
                  </div>
                    
                  {/* Update Frequency Slider */}
                  <div className="space-y-3"> {/* Increased space-y */}
                    <Label htmlFor={`${serviceLabel}-frequency-slider`} className="text-xs font-medium text-muted-foreground">
                      Frequency: {localFeedFrequencyMs}ms 
                      (approx. {(localFeedFrequencyMs / 1000).toFixed(2)}s)
                    </Label>
                    <Slider
                      id={`${serviceLabel}-frequency-slider`}
                      min={serviceLabel.includes("Market Data") ? 0 : 1000} // 0ms min for Market Data
                      max={serviceLabel.includes("Market Data") ? 1000 : 60000} // 1000ms max for Market Data, 60s for others
                      step={serviceLabel.includes("Market Data") ? 10 : 1000} // 10ms step for Market Data
                      value={[localFeedFrequencyMs]}
                      onValueChange={(value) => setLocalFeedFrequencyMs(value[0])}
                      className="w-full"
                    />
                  </div>

                  <Button onClick={handleQoSUpdate} size="sm" className="w-full bg-primary hover:bg-primary/90 mt-4">
                    Apply Changes
                  </Button>
                </div> 
              </PopoverContent>
            </Popover>
          </div> 
        </div> 
      )}
    </div> 
  );
}
