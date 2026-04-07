import React, { useState } from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription 
} from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ExchangeSelector } from './ExchangeSelector';
import { CountrySelector } from './CountrySelector';
import { StockDataWithMetadata } from '@shared/schema';

interface FiltersPanelProps {
  selectedExchanges: string[];
  onExchangeSelectionChange: (exchangeId: string, selected: boolean) => void;
  selectedCountries: string[];
  onCountrySelectionChange: (countryId: string, selected: boolean) => void;
  className?: string;
  availableStocks?: StockDataWithMetadata[];
}

export function FiltersPanel({
  selectedExchanges,
  onExchangeSelectionChange,
  selectedCountries,
  onCountrySelectionChange,
  className,
  availableStocks
}: FiltersPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <Card className={cn("w-full bg-white dark:bg-card border-slate-200 dark:border-muted/30 shadow-sm", className)}>
      <CardHeader className="py-3 flex flex-col justify-center">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-semibold text-green-800 dark:text-primary">
            Filters
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 w-7 p-0 text-green-700 dark:text-primary hover:text-green-600 dark:hover:text-primary/80 hover:bg-green-50 dark:hover:bg-primary/10"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </Button>
        </div>
        <CardDescription className="text-slate-600 dark:text-muted-foreground text-xs">
          Configure wildcard topic subscriptions for Solace PubSub+ message broker
        </CardDescription>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="pt-0">
          <div className="space-y-4">
            {/* Exchange Filter */}
            <div className="border-b border-slate-200 dark:border-muted/30 pb-4 bg-white dark:bg-transparent rounded-md">
              <ExchangeSelector 
                selectedExchanges={selectedExchanges}
                onExchangeSelectionChange={onExchangeSelectionChange}
                className="bg-transparent border-none shadow-none"
              />
            </div>
            
            {/* Country Filter */}
            <div className="bg-white dark:bg-transparent rounded-md">
              <CountrySelector 
                selectedCountries={selectedCountries}
                onCountrySelectionChange={onCountrySelectionChange}
                availableStocks={availableStocks}
                className="bg-transparent border-none shadow-none"
              />
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}