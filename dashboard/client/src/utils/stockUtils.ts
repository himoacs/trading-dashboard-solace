import type { StockSelection } from '@shared/schema';

/**
 * Creates a canonical, comparable representation of a StockSelection object.
 * This ensures that comparisons are consistent by:
 * - Including a fixed set of relevant properties from StockSelection.
 * - Ensuring boolean properties are explicitly true/false.
 * - Providing default values (e.g., empty string) for optional string properties.
 */
export function getComparableStock(stock: StockSelection): Record<string, any> {
  return {
    symbol: stock.symbol,
    companyName: stock.companyName || '',
    selected: !!stock.selected,
    exchange: stock.exchange || '',
    addedByWildcard: !!stock.addedByWildcard,
    coveredByWildcard: !!stock.coveredByWildcard,
    individuallySelected: !!stock.individuallySelected,
  };
}

/**
 * Compares two arrays of StockSelection objects for deep equality.
 * It sorts the arrays by symbol and then compares the JSON stringification
 * of their canonical representations.
 * @param listA The first array of StockSelection objects.
 * @param listB The second array of StockSelection objects.
 * @returns True if the arrays are deeply equal, false otherwise.
 */
export function areStockSelectionsEqual(
  listA: StockSelection[],
  listB: StockSelection[]
): boolean {
  if (!listA && !listB) return true; // Both null or undefined
  if (!listA || !listB) return false; // One is null/undefined, the other isn't
  if (listA.length !== listB.length) return false;
  if (listA.length === 0 && listB.length === 0) return true; // Both empty

  // Create a copy before sorting to avoid mutating original arrays if they are state variables
  const sortedA = [...listA]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map(getComparableStock);
  const sortedB = [...listB]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map(getComparableStock);

  return JSON.stringify(sortedA) === JSON.stringify(sortedB);
} 