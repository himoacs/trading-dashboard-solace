/**
 * ChartsTab Component
 * 
 * Single real-time chart displaying multiple stock price lines.
 * Starts blank, allows user to add stocks to compare.
 */
import { useState, useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, ColorType, LineSeries } from 'lightweight-charts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, X, LineChart, Trash2 } from 'lucide-react';
import { STOCK_EXCHANGE_MAP } from '@/lib/stockUtils';
import { StockDataWithMetadata } from '@shared/schema';

interface PricePoint {
  time: Time;
  value: number;
}

interface StockSeriesData {
  symbol: string;
  companyName: string;
  color: string;
  history: PricePoint[];
  currentPrice: number | null;
  percentChange: number;
}

interface ChartsTabProps {
  liveStockData: StockDataWithMetadata[];
  availableStocks: StockDataWithMetadata[];
  selectedStocks: { symbol: string; selected: boolean }[];
  className?: string;
  onSelectedSymbolsChange?: (symbols: string[]) => void;
}

// Colors for different stock lines
const LINE_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
];

export default function ChartsTab({ liveStockData, availableStocks, selectedStocks, className, onSelectedSymbolsChange }: ChartsTabProps) {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [stockDataMap, setStockDataMap] = useState<Map<string, StockSeriesData>>(new Map());
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesMapRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());

  // Get the list of stocks that user has selected on the main page (left panel)
  const userSelectedStockSymbols = selectedStocks
    .filter(s => s.selected)
    .map(s => s.symbol)
    .filter(symbol => !['SPX', 'DJI', 'NDX', 'FTSE', 'N225', 'HSI'].includes(symbol));

  // Remove any charted stocks that are no longer in the user's selected list
  useEffect(() => {
    setSelectedSymbols(prev => 
      prev.filter(symbol => userSelectedStockSymbols.includes(symbol))
    );
  }, [userSelectedStockSymbols.join(',')]);

  // Notify parent of selected symbols changes
  useEffect(() => {
    onSelectedSymbolsChange?.(selectedSymbols);
  }, [selectedSymbols, onSelectedSymbolsChange]);
  
  // Available stocks for dropdown: only stocks from "Selected Stocks" that aren't already charted
  const stocksForDropdown = availableStocks.filter(
    stock => userSelectedStockSymbols.includes(stock.symbol) && 
             !selectedSymbols.includes(stock.symbol)
  );

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: 2,
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: 2,
        },
      },
    });

    chartRef.current = chart;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      seriesMapRef.current.clear();
      chart.remove();
    };
  }, []);

  // Manage series when selected symbols change
  useEffect(() => {
    if (!chartRef.current) return;

    const currentSeries = seriesMapRef.current;
    
    // Add series for new symbols
    selectedSymbols.forEach((symbol, index) => {
      if (!currentSeries.has(symbol)) {
        const color = LINE_COLORS[index % LINE_COLORS.length];
        const series = chartRef.current!.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
          priceLineVisible: false,
          lastValueVisible: true,
          title: symbol,
        });
        currentSeries.set(symbol, series);
        
        // Initialize stock data
        const stockInfo = availableStocks.find(s => s.symbol === symbol);
        setStockDataMap(prev => {
          const newMap = new Map(prev);
          newMap.set(symbol, {
            symbol,
            companyName: stockInfo?.companyName || symbol,
            color,
            history: [],
            currentPrice: null,
            percentChange: 0,
          });
          return newMap;
        });
      }
    });

    // Remove series for deselected symbols
    currentSeries.forEach((series, symbol) => {
      if (!selectedSymbols.includes(symbol)) {
        chartRef.current!.removeSeries(series);
        currentSeries.delete(symbol);
        setStockDataMap(prev => {
          const newMap = new Map(prev);
          newMap.delete(symbol);
          return newMap;
        });
      }
    });
  }, [selectedSymbols, availableStocks]);

  // Update chart data when live stock data arrives
  useEffect(() => {
    if (liveStockData.length === 0 || selectedSymbols.length === 0) return;

    setStockDataMap(prevMap => {
      const newMap = new Map(prevMap);
      
      liveStockData.forEach(stock => {
        if (selectedSymbols.includes(stock.symbol) && stock.currentPrice) {
          const existing = newMap.get(stock.symbol);
          if (existing) {
            const now = Math.floor(Date.now() / 1000) as Time;
            const newHistory = [...existing.history];
            const lastPoint = newHistory[newHistory.length - 1];
            
            // Only add new point if price has changed (prevents flat lines when publisher stops)
            const priceChanged = !lastPoint || Math.abs(lastPoint.value - stock.currentPrice) > 0.001;
            
            if (priceChanged) {
              // Avoid duplicate timestamps - if same timestamp, update value
              if (newHistory.length === 0 || lastPoint.time < now) {
                newHistory.push({ time: now, value: stock.currentPrice });
              } else {
                // Update last point value
                newHistory[newHistory.length - 1].value = stock.currentPrice;
              }
              
              // Keep only last 300 points
              while (newHistory.length > 300) {
                newHistory.shift();
              }
              
              newMap.set(stock.symbol, {
                ...existing,
                history: newHistory,
                currentPrice: stock.currentPrice,
                percentChange: stock.percentChange || 0,
              });
              
              // Update the chart series
              const series = seriesMapRef.current.get(stock.symbol);
              if (series) {
                series.setData(newHistory);
              }
            }
          }
        }
      });
      
      return newMap;
    });
  }, [liveStockData, selectedSymbols]);

  const handleAddStock = (symbol: string) => {
    if (selectedSymbols.length < 8 && !selectedSymbols.includes(symbol)) {
      setSelectedSymbols(prev => [...prev, symbol]);
    }
  };

  const handleRemoveStock = (symbol: string) => {
    setSelectedSymbols(prev => prev.filter(s => s !== symbol));
  };

  const handleClearAll = () => {
    setSelectedSymbols([]);
  };

  return (
    <div className={`flex flex-col gap-4 ${className || ''}`}>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 p-2 bg-muted/30 rounded-lg">
        <div className="flex items-center gap-2">
          <LineChart className="w-5 h-5 text-primary" />
          <span className="font-medium text-sm">Live Price Chart</span>
        </div>
        
        <div className="flex-1" />
        
        {stocksForDropdown.length > 0 ? (
          <Select
            value=""
            onValueChange={handleAddStock}
            disabled={selectedSymbols.length >= 8}
          >
            <SelectTrigger className="w-[180px] h-8">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                <span>Add Stock</span>
              </div>
            </SelectTrigger>
            <SelectContent>
              {stocksForDropdown.slice(0, 30).map(stock => (
                <SelectItem key={stock.symbol} value={stock.symbol}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{stock.symbol}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                      {stock.companyName}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-muted/50 rounded-md">
            <span>Select stocks from Data Table first</span>
          </div>
        )}
        
        {selectedSymbols.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            className="h-8"
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Clear All
          </Button>
        )}
      </div>

      {/* Main Chart Card */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Stock Price Comparison</span>
              <Badge variant="secondary" className="text-xs">
                {selectedSymbols.length} stock{selectedSymbols.length !== 1 ? 's' : ''}
              </Badge>
            </div>
          </div>
          
          {/* Legend - Selected Stocks */}
          {selectedSymbols.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {selectedSymbols.map(symbol => {
                const data = stockDataMap.get(symbol);
                if (!data) return null;
                
                return (
                  <div
                    key={symbol}
                    className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 rounded-md text-sm"
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: data.color }}
                    />
                    <span className="font-medium">{symbol}</span>
                    {data.currentPrice !== null && (
                      <span className="text-muted-foreground">
                        ${data.currentPrice.toFixed(2)}
                      </span>
                    )}
                    {data.currentPrice !== null && (
                      <span className={data.percentChange >= 0 ? 'text-green-500' : 'text-red-500'}>
                        {data.percentChange >= 0 ? '+' : ''}{data.percentChange.toFixed(2)}%
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 ml-1 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveStock(symbol)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardHeader>
        
        <CardContent className="p-2 pt-0">
          {selectedSymbols.length === 0 ? (
            <div className="h-[400px] flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <LineChart className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium mb-2">No Stocks to Chart</p>
                {userSelectedStockSymbols.length === 0 ? (
                  <p className="text-sm">Select stocks from the "Selected Stocks" panel on the left to add them here</p>
                ) : (
                  <p className="text-sm">Use the "Add Stock" dropdown above to chart your selected stocks</p>
                )}
              </div>
            </div>
          ) : null}
          <div ref={chartContainerRef} className="w-full h-[400px]" />
        </CardContent>
      </Card>

      {/* Status Bar */}
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground px-2">
        <span>
          Receiving live data from Solace market-data topics
        </span>
        <span>
          {liveStockData.length > 0 ? (
            <span className="text-green-500">● Connected</span>
          ) : (
            <span className="text-yellow-500">○ Waiting for data...</span>
          )}
        </span>
      </div>
    </div>
  );
}
