/**
 * StockChart Component
 * 
 * Real-time stock price chart using TradingView's lightweight-charts.
 * Receives price updates from Solace market data topics.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, ColorType, LineSeries } from 'lightweight-charts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface PricePoint {
  time: Time;
  value: number;
}

export interface StockChartProps {
  symbol: string;
  companyName?: string;
  exchange?: string;
  onRemove?: () => void;
  className?: string;
}

// Keep track of price history per symbol
const priceHistoryMap = new Map<string, PricePoint[]>();

export function StockChart({ symbol, companyName, exchange, onRemove, className }: StockChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [percentChange, setPercentChange] = useState<number>(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.1)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.1)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 200,
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
          color: 'rgba(255, 255, 255, 0.3)',
          width: 1,
          style: 2,
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.3)',
          width: 1,
          style: 2,
        },
      },
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = lineSeries;

    // Load existing history for this symbol
    const existingHistory = priceHistoryMap.get(symbol) || [];
    if (existingHistory.length > 0) {
      lineSeries.setData(existingHistory);
      const lastPoint = existingHistory[existingHistory.length - 1];
      setCurrentPrice(lastPoint.value);
      if (existingHistory.length > 1) {
        const prevPoint = existingHistory[existingHistory.length - 2];
        const change = lastPoint.value - prevPoint.value;
        setPriceChange(change);
        setPercentChange((change / prevPoint.value) * 100);
      }
    }

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
      chart.remove();
    };
  }, [symbol]);

  // Update chart color based on price direction
  useEffect(() => {
    if (seriesRef.current) {
      const color = percentChange >= 0 ? '#22c55e' : '#ef4444';
      seriesRef.current.applyOptions({ color });
    }
  }, [percentChange]);

  return (
    <Card className={`bg-card border-border ${className}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg text-foreground">{symbol}</span>
            {exchange && (
              <Badge variant="outline" className="text-xs">
                {exchange}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentPrice !== null && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-semibold text-foreground">
                  ${currentPrice.toFixed(2)}
                </span>
                <div className={`flex items-center gap-1 text-sm ${
                  percentChange >= 0 ? 'text-green-500' : 'text-red-500'
                }`}>
                  {percentChange > 0 ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : percentChange < 0 ? (
                    <TrendingDown className="w-4 h-4" />
                  ) : (
                    <Minus className="w-4 h-4" />
                  )}
                  <span className="font-mono">
                    {percentChange >= 0 ? '+' : ''}{percentChange.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
            {onRemove && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={onRemove}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {companyName && (
          <p className="text-xs text-muted-foreground truncate">{companyName}</p>
        )}
      </CardHeader>
      <CardContent className="p-2 pt-0">
        <div ref={chartContainerRef} className="w-full" />
        {lastUpdate && (
          <p className="text-xs text-muted-foreground text-right mt-1">
            Last update: {lastUpdate.toLocaleTimeString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Utility function to add a price point to a chart
export function addPricePoint(symbol: string, price: number, timestamp?: Date): void {
  const time = Math.floor((timestamp || new Date()).getTime() / 1000) as Time;
  const point: PricePoint = { time, value: price };
  
  let history = priceHistoryMap.get(symbol);
  if (!history) {
    history = [];
    priceHistoryMap.set(symbol, history);
  }
  
  // Avoid duplicate timestamps
  if (history.length > 0 && history[history.length - 1].time >= time) {
    // Update the last point instead
    history[history.length - 1].value = price;
  } else {
    history.push(point);
  }
  
  // Keep only last 500 points
  if (history.length > 500) {
    history.shift();
  }
}

// Get price history for a symbol
export function getPriceHistory(symbol: string): PricePoint[] {
  return priceHistoryMap.get(symbol) || [];
}

// Clear price history for a symbol
export function clearPriceHistory(symbol: string): void {
  priceHistoryMap.delete(symbol);
}

export default StockChart;
