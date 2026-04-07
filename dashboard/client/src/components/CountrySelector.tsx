import React, { useMemo } from 'react';
import { 
  Card, 
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { COUNTRIES, getCountryCodeForExchange } from '@/lib/countryUtils';
import { STOCK_EXCHANGE_MAP } from '@/lib/stockUtils';
import { cn } from '@/lib/utils';
import { StockDataWithMetadata } from '@shared/schema';

interface CountrySelectorProps {
  selectedCountries: string[];
  onCountrySelectionChange: (countryId: string, selected: boolean) => void;
  className?: string;
  availableStocks?: StockDataWithMetadata[];
}

export function CountrySelector({ 
  selectedCountries, 
  onCountrySelectionChange,
  className,
  availableStocks = []
}: CountrySelectorProps) {

  const countryStockCounts = useMemo(() => {
    const counts: { [countryCode: string]: number } = {};
    if (!availableStocks || availableStocks.length === 0) {
      COUNTRIES.forEach(country => {
        counts[country.id] = 0;
      });
      return counts;
    }

    COUNTRIES.forEach(country => {
      counts[country.id] = 0;
    });

    availableStocks.forEach(stock => {
      const exchange = stock.exchange || STOCK_EXCHANGE_MAP[stock.symbol];
      if (exchange) {
        const countryCode = getCountryCodeForExchange(exchange);
        if (countryCode) {
          if (counts[countryCode] === undefined) {
          }
          counts[countryCode] = (counts[countryCode] || 0) + 1;
        }
      }
    });
    return counts;
  }, [availableStocks]);

  return (
    <Card className={cn("w-full bg-white dark:bg-black/60 border-slate-200 dark:border-green-800/30", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl font-semibold text-green-700 dark:text-green-500 flex items-center">
          Country Filter
        </CardTitle>
        <CardDescription className="text-slate-500 dark:text-gray-300 text-xs">
          Subscribe to all stocks from specific countries using wildcards
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-row flex-wrap gap-2">
          {COUNTRIES.map((country) => {
            const isSelected = selectedCountries.includes(country.id);
            const stockCount = countryStockCounts[country.id] || 0;
            return (
              <Button
                key={country.id}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                className={cn(
                  isSelected 
                    ? "bg-green-700 hover:bg-green-800 border-green-800 text-white" 
                    : "bg-slate-50 dark:bg-black/40 text-green-700 dark:text-green-300 hover:text-green-600 dark:hover:text-green-200 border-green-200 dark:border-green-800/50"
                )}
                onClick={() => onCountrySelectionChange(country.id, !isSelected)}
              >
                {country.name} 
                <Badge variant="outline" className="ml-2 text-[9px] py-0 h-4 border-green-300 dark:border-green-800/50 text-green-700 dark:text-green-400/90">
                  {stockCount}
                </Badge>
              </Button>
            );
          })}
        </div>
        
        <div className="text-xs text-slate-500 dark:text-gray-400 mt-4">
          <p>Country topic pattern: <code>market-data/EQ/[countryCode]/&gt;</code></p>
        </div>
      </CardContent>
    </Card>
  );
}