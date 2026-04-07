import React, { useState } from 'react';
import { StockDataWithMetadata } from '@shared/schema'; // Assuming this type can be used or adapted
import { Skeleton } from '@/components/ui/skeleton'; // For loading state
import { Button } from '@/components/ui/button'; // Added Button
import { ChevronDown, ChevronUp } from 'lucide-react'; // Added Chevron icons

interface MarketOverviewPanelProps {
  topSecuritiesData: StockDataWithMetadata[];
  isLoading: boolean;
  error?: string | null;
}

const MarketOverviewItem: React.FC<{ item: StockDataWithMetadata }> = ({ item }) => {
  const price = item.currentPrice?.toFixed(2) ?? 'N/A';
  const change = item.percentChange?.toFixed(2) ?? 'N/A';
  const changeColor = item.percentChange && item.percentChange > 0 ? 'text-green-500' :
                      item.percentChange && item.percentChange < 0 ? 'text-red-500' :
                      'text-gray-500';

  return (
    <div className="flex flex-col items-start px-4 py-2 border-r border-border bg-background rounded-lg shadow flex-grow">
      <span className="text-sm font-semibold text-foreground truncate max-w-full">
        {item.symbol} 
      </span>
      <span className="text-base font-bold text-foreground">{price}</span>
      <span className={`text-sm font-medium ${changeColor}`}>
        {item.percentChange && item.percentChange > 0 ? '+' : ''}{change}%
      </span>
    </div>
  );
};

const MarketOverviewPanel: React.FC<MarketOverviewPanelProps> = ({ 
  topSecuritiesData,
  isLoading,
  error 
}) => {
  const [isExpanded, setIsExpanded] = useState(true); // State for expand/collapse

  if (isLoading) {
    return (
      <div className="bg-card border-b border-border rounded-md mb-4"> {/* Added mb-4 for gap */}
        <div className="flex justify-between items-center p-3 pb-1"> {/* Wrapper for title and button */}
          <h3 className="text-xl font-semibold text-green-800 dark:text-primary">
            Stocks Overview
          </h3>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 w-7 p-0 text-green-700 dark:text-primary hover:text-green-600 dark:hover:text-primary/80 hover:bg-green-50 dark:hover:bg-primary/10"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </Button>
        </div>
        {isExpanded && (
          <div className="flex items-center justify-between p-3 pt-2 bg-card overflow-x-auto scrollbar-thin scrollbar-thumb-muted-foreground/50 scrollbar-track-transparent">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex flex-col items-start px-4 py-2 border-r border-border bg-background rounded-lg shadow flex-grow">
                <Skeleton className="h-5 w-24 mb-1" />
                <Skeleton className="h-6 w-20 mb-0.5" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-center text-red-500 bg-card border-b border-border rounded-md mb-4">
        Error loading market overview: {error}
      </div>
    );
  }

  if (!topSecuritiesData || topSecuritiesData.length === 0) {
    return (
      <div className="p-3 text-center text-muted-foreground bg-card border-b border-border rounded-md mb-4">
        No market overview data available.
      </div>
    );
  }

  return (
    <div className="bg-card border-b border-border rounded-md mb-4"> {/* Added mb-4 for gap */}
      <div className="flex justify-between items-center p-3 pb-1"> {/* Wrapper for title and button */}
        <h3 className="text-xl font-semibold text-green-800 dark:text-primary">
          Stocks Overview
        </h3>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-7 w-7 p-0 text-green-700 dark:text-primary hover:text-green-600 dark:hover:text-primary/80 hover:bg-green-50 dark:hover:bg-primary/10"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </Button>
      </div>
      {isExpanded && (
        <div className="flex items-center justify-between p-3 pt-2 bg-card overflow-x-auto scrollbar-thin scrollbar-thumb-muted-foreground/50 scrollbar-track-transparent">
          {topSecuritiesData.map(item => (
            <MarketOverviewItem key={item.symbol} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default MarketOverviewPanel; 