/**
 * Traffic Generator Panel
 * 
 * UI panel for controlling browser-native traffic generators.
 * Provides start/stop controls, rate adjustment, and QoS settings.
 */
import { useState, useEffect } from 'react';
import { useGeneratorState, useTrafficGenerator } from '../contexts/TrafficGeneratorContext';
import { DEFAULT_MARKET_DATA_CONFIG, DEFAULT_TWITTER_CONFIG, BrokerConfig } from '../types/generatorTypes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Play, 
  Square, 
  Activity, 
  MessageSquare, 
  ChevronDown, 
  ChevronUp,
  Zap,
  AlertCircle,
  CheckCircle2,
  Loader2
} from 'lucide-react';

interface TrafficGeneratorPanelProps {
  brokerConfig: BrokerConfig | null;
  className?: string;
}

function GeneratorCard({ 
  generatorId, 
  brokerConfig 
}: { 
  generatorId: string; 
  brokerConfig: BrokerConfig | null;
}) {
  const { startGenerator, stopGenerator, updateGeneratorConfig } = useTrafficGenerator();
  const state = useGeneratorState(generatorId);
  const [showOutput, setShowOutput] = useState(false);
  
  const isMarketData = state.config.type === 'market-data';
  const Icon = isMarketData ? Activity : MessageSquare;
  
  const handleStart = () => {
    if (!brokerConfig) {
      console.error('No broker config available');
      return;
    }
    startGenerator(generatorId, brokerConfig);
  };
  
  const handleStop = () => {
    stopGenerator(generatorId);
  };
  
  const handleRateChange = (value: number[]) => {
    updateGeneratorConfig(generatorId, { messageRate: value[0] });
  };
  
  const handleElidingChange = (checked: boolean) => {
    updateGeneratorConfig(generatorId, { allowMessageEliding: checked });
  };
  
  const handleDmqChange = (checked: boolean) => {
    updateGeneratorConfig(generatorId, { dmqEligible: checked });
  };
  
  const getStatusBadge = () => {
    switch (state.status) {
      case 'running':
        return (
          <Badge variant="default" className="bg-green-500 animate-pulse">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Running
          </Badge>
        );
      case 'starting':
        return (
          <Badge variant="secondary" className="bg-yellow-500">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Starting
          </Badge>
        );
      case 'stopping':
        return (
          <Badge variant="secondary" className="bg-orange-500">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Stopping
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive">
            <AlertCircle className="w-3 h-3 mr-1" />
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            Stopped
          </Badge>
        );
    }
  };
  
  const formatRate = (rate: number) => {
    if (rate >= 1000) {
      return `${(rate / 1000).toFixed(1)}k`;
    }
    return rate.toFixed(1);
  };
  
  const isActive = state.status === 'running' || state.status === 'starting';
  const canStart = brokerConfig && state.status === 'stopped';
  
  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">{state.config.name}</CardTitle>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats display */}
        {isActive && (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="text-center p-2 bg-muted rounded">
              <div className="text-muted-foreground text-xs">Sent</div>
              <div className="font-mono font-bold">{state.stats.messagesSent.toLocaleString()}</div>
            </div>
            <div className="text-center p-2 bg-muted rounded">
              <div className="text-muted-foreground text-xs">Rate</div>
              <div className="font-mono font-bold">{formatRate(state.stats.publishRate)}/s</div>
            </div>
            <div className="text-center p-2 bg-muted rounded">
              <div className="text-muted-foreground text-xs">Errors</div>
              <div className={`font-mono font-bold ${state.stats.errors > 0 ? 'text-red-500' : ''}`}>
                {state.stats.errors}
              </div>
            </div>
          </div>
        )}
        
        {/* Rate control */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {isMarketData ? 'Message Rate' : 'Tweet Rate (per stock)'}
            </span>
            <span className="font-mono">
              {state.config.messageRate} {isMarketData ? 'msg/s' : '/min/stock'}
            </span>
          </div>
          <Slider
            value={[state.config.messageRate]}
            onValueChange={handleRateChange}
            min={isMarketData ? 1 : 1}
            max={isMarketData ? 500 : 30}
            step={1}
          />
        </div>
        
        {/* QoS Settings */}
        <div className="flex items-center gap-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`${generatorId}-eliding`}
              checked={state.config.allowMessageEliding}
              onCheckedChange={handleElidingChange}
              disabled={isActive}
            />
            <label
              htmlFor={`${generatorId}-eliding`}
              className={`text-sm cursor-pointer ${isActive ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}
            >
              Allow Eliding
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`${generatorId}-dmq`}
              checked={state.config.dmqEligible}
              onCheckedChange={handleDmqChange}
              disabled={isActive}
            />
            <label
              htmlFor={`${generatorId}-dmq`}
              className={`text-sm cursor-pointer ${isActive ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}
            >
              DMQ Eligible
            </label>
          </div>
        </div>
        
        {/* Start/Stop buttons */}
        <div className="flex gap-2">
          {!isActive ? (
            <Button
              onClick={handleStart}
              disabled={!canStart}
              className="flex-1"
              variant="default"
            >
              <Play className="w-4 h-4 mr-2" />
              Start
            </Button>
          ) : (
            <Button
              onClick={handleStop}
              className="flex-1"
              variant="destructive"
            >
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          )}
        </div>
        
        {/* Error display */}
        {state.error && (
          <div className="p-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-sm">
            {state.error}
          </div>
        )}
        
        {/* Output log (collapsible) */}
        {state.output.length > 0 && (
          <Collapsible open={showOutput} onOpenChange={setShowOutput}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                Output Log ({state.output.length})
                {showOutput ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 p-2 bg-muted rounded font-mono text-xs max-h-40 overflow-y-auto">
                {state.output.slice(-20).map((line, i) => (
                  <div key={i} className="text-muted-foreground">{line}</div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        
        {/* No broker warning */}
        {!brokerConfig && state.status === 'stopped' && (
          <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Connect to Solace broker to enable generator
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TrafficGeneratorPanel({ brokerConfig, className }: TrafficGeneratorPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { setBrokerConfig } = useTrafficGenerator();
  
  // Sync broker config with context
  useEffect(() => {
    setBrokerConfig(brokerConfig);
  }, [brokerConfig, setBrokerConfig]);
  
  return (
    <div className={className}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between cursor-pointer mb-2 p-2 hover:bg-muted rounded">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Traffic Generators</h2>
            </div>
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <GeneratorCard 
            generatorId={DEFAULT_MARKET_DATA_CONFIG.id} 
            brokerConfig={brokerConfig}
          />
          <GeneratorCard 
            generatorId={DEFAULT_TWITTER_CONFIG.id} 
            brokerConfig={brokerConfig}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
