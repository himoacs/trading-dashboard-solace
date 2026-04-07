import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { EXCHANGES } from '../lib/exchangeUtils';
import { cn } from '@/lib/utils';

interface ExchangeSelectorProps {
  onExchangeSelectionChange: (exchangeId: string, selected: boolean) => void;
  selectedExchanges: string[];
  className?: string;
}

export function ExchangeSelector({ 
  onExchangeSelectionChange, 
  selectedExchanges,
  className
}: ExchangeSelectorProps) {
  
  return (
    <Card className={cn("w-full bg-white dark:bg-black/60 border-slate-200 dark:border-green-800/30", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl font-semibold text-green-700 dark:text-green-500 flex items-center">
          Exchange Filter
        </CardTitle>
        <CardDescription className="text-slate-500 dark:text-gray-300 text-xs">
          Subscribe to all stocks from specific exchanges using wildcards
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-row flex-wrap gap-2">
          {EXCHANGES.map((exchange) => {
            const isSelected = selectedExchanges.includes(exchange.id);
            return (
              <Button
                key={exchange.id}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                className={cn(
                  isSelected 
                    ? "bg-green-700 hover:bg-green-800 border-green-800 text-white" 
                    : "bg-slate-50 dark:bg-black/40 text-green-700 dark:text-green-300 hover:text-green-600 dark:hover:text-green-200 border-green-200 dark:border-green-800/50"
                )}
                onClick={() => onExchangeSelectionChange(exchange.id, !isSelected)}
              >
                {exchange.name} 
                <Badge variant="outline" className="ml-2 text-[9px] py-0 h-4 border-green-300 dark:border-green-800/50 text-green-700 dark:text-green-400/90">
                  {exchange.stocks?.length || 0}
                </Badge>
              </Button>
            );
          })}
        </div>
        
        <div className="text-xs text-slate-500 dark:text-gray-400 mt-4">
          <p>Exchange topic pattern: <code>market-data/EQ/[country]/[exchange]/&gt;</code></p>

        </div>
      </CardContent>
    </Card>
  );
}