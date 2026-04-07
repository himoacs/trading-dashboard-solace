import React from 'react';
import { StockDataWithMetadata } from "@shared/schema";
import HoverTooltip from "./HoverTooltip";
import { Button } from "@/components/ui/button"; // Assuming Button might be used for actions in the future

// Define the props for StockDataRow
// These will include the stock data and any formatting functions or event handlers
interface StockDataRowProps {
  stock: StockDataWithMetadata;
  displayTweetContent: string;
  isSelected: boolean;
  onStockSelectionChange: (symbol: string, selected: boolean) => void;
  formatPrice: (price: number | null | undefined) => JSX.Element;
  formatPercentChange: (change: number | null | undefined) => JSX.Element;
  getSignalClass: (signal: string) => string;
  getCountryNameForStock: (stock: StockDataWithMetadata) => string;
  extractExchangeFromTopic: (symbol: string) => string; // Or pass stock.exchange directly if always available
  // Add onForceTweet, onForceSignal if actions are directly on the row
  // onForceTweet: (symbol: string) => Promise<void>;
  // onForceSignal?: (symbol: string) => Promise<void>;
}

const StockDataRowComponent: React.FC<StockDataRowProps> = ({
  stock,
  displayTweetContent,
  isSelected, // This prop might be needed if checkbox is part of the row
  onStockSelectionChange,
  formatPrice,
  formatPercentChange,
  getSignalClass,
  getCountryNameForStock,
  extractExchangeFromTopic,
  // onForceTweet,
  // onForceSignal
}) => {
  // The 'isSelected' prop is not directly used in the provided JSX for the row itself,
  // as the checkbox was in the example in ConfigPanel, not DataTable.
  // If DataTable had a per-row selection checkbox, it would be used here.
  // For now, onStockSelectionChange is likely called from outside the row (e.g. a master checkbox or a click on the row)

  // If actions like "Force Tweet" or "Force Signal" were buttons within each row,
  // they would be implemented here using onForceTweet and onForceSignal.

  return (
    <tr key={stock.id || stock.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-800">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center">
          <div className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
            {/* Placeholder for a potential stock logo or initial */}
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {stock.symbol.charAt(0)}
            </span>
          </div>
          <div className="ml-4">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {stock.symbol}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {stock.companyName || `${stock.symbol} Stock Placeholder`}
            </div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          {stock.exchange || extractExchangeFromTopic(stock.symbol)}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          {getCountryNameForStock(stock)}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        {formatPrice(stock.currentPrice)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center text-sm">
          {formatPercentChange(stock.percentChange)}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        {displayTweetContent !== 'N/A' ? (
          <HoverTooltip 
            tooltipContent={displayTweetContent}
            tooltipClassName="max-w-sm whitespace-pre-wrap break-words" // Allow wrapping in tooltip
          >
            <div className="w-96 truncate overflow-hidden whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
              {displayTweetContent}
            </div>
          </HoverTooltip>
        ) : (
          <span className="text-gray-400 text-sm">N/A</span>
        )}
      </td>
      <td className="pl-6 pr-3 py-4 whitespace-nowrap text-left">
        <span className={`${getSignalClass(stock.tradingSignal?.signal || '')}`}>
          {stock.tradingSignal?.signal || 'N/A'}
        </span>
        {/* Example for action buttons if they were per row:
        {onForceSignal && (
          <Button onClick={() => onForceSignal(stock.symbol)} size="sm" variant="ghost" className="ml-2">Force Signal</Button>
        )}
        {onForceTweet && (
          <Button onClick={() => onForceTweet(stock.symbol)} size="sm" variant="ghost" className="ml-2">Force Tweet</Button>
        )}
        */}
      </td>
    </tr>
  );
};

// Memoize the component to prevent re-renders if props haven't changed
export const StockDataRow = React.memo(StockDataRowComponent);

// Helper to compare stock objects for React.memo, if needed for more complex scenarios
// For now, React.memo's default shallow comparison of props should be sufficient
// if functions passed as props are stable (memoized with useCallback or defined outside).
// constareStocksEqual = (prevProps: StockDataRowProps, nextProps: StockDataRowProps) => {
//   // Compare individual fields of the stock object if necessary,
//   // and other props.
//   return prevProps.stock.symbol === nextProps.stock.symbol &&
//          prevProps.stock.currentPrice === nextProps.stock.currentPrice &&
//          prevProps.stock.percentChange === nextProps.stock.percentChange &&
//          prevProps.stock.lastTweet?.timestamp === nextProps.stock.lastTweet?.timestamp && // Example deep check
//          prevProps.stock.tradingSignal?.signal === nextProps.stock.tradingSignal?.signal &&
//          prevProps.isSelected === nextProps.isSelected &&
//          prevProps.displayTweetContent === nextProps.displayTweetContent;
//   // Add other props comparisons: formatPrice, formatPercentChange etc. are functions,
//   // so they need to be stable references (useCallback in parent or defined outside).
// };
// export const StockDataRow = React.memo(StockDataRowComponent, areStocksEqual); 