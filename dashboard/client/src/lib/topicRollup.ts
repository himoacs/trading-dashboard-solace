import type { TopicNode } from './topicNode';
import type { SunburstSizingMode } from '../components/topic-explorer/SunburstChart';

/**
 * Turns the raw topic tree from useTopicMonitor into a *display* tree for
 * SunburstChart, matching explorer.solace.dev's Detail-level / Max-elements-per-level
 * / Sort-by controls. The raw tree is never mutated - this always returns new nodes.
 * Ported from solace-feed-visualizer's lib/topicRollup.ts.
 */

export type TopicSortBy = 'messages' | 'bytes' | 'topics' | 'busy' | 'lastArrival' | 'name' | 'depth';

// Below this share of its own siblings' combined size (by the active sizingMode
// metric), a child is rolled into *OTHERS* instead of rendered on its own -
// otherwise a long tail of near-zero children each still gets a proportional
// sliver of arc, which at 5 levels of depth becomes a physically imperceptible,
// unhoverable ring. A parent-relative share is self-calibrating at every depth.
const MIN_SHARE_OF_PARENT = 0.05;

export interface RollupOptions {
  /** 1-10. Nodes at this depth are rendered as leaves - their subtree is already
   *  summed into them by useTopicMonitor's own propagateValues pass. */
  detailLevel: number;
  /** 5-30. A parent with more children than this keeps its top N-1 (by message
   *  count) and rolls the rest into one synthetic "*OTHERS*" child. */
  maxElementsPerLevel: number;
  sortBy: TopicSortBy;
  /** Mirrors SunburstChart's own Size-By control - what actually determines arc
   *  width, so it's what the MIN_SHARE_OF_PARENT cutoff above is measured against. */
  sizingMode: SunburstSizingMode;
  /** Path of the node the sunburst is currently zoomed to ('' = root). The
   *  detailLevel depth budget resets to 0 at this node, so drilling into any one
   *  branch always affords `detailLevel` more levels from there. */
  zoomedPath: string;
  /** false (default): clamp *OTHERS*'s displayed size to roughly its smallest kept
   *  sibling's, so a long tail of tiny topics can't swamp (or disappear from) the
   *  chart. true: show its true summed value/bytes. */
  accurateOthersSizes: boolean;
  /** Session duration so far, for the 'busy' sort metric (value / elapsedSeconds). */
  elapsedSeconds: number;
}

function subtreeDepth(node: TopicNode): number {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(subtreeDepth));
}

function metricFor(node: TopicNode, sortBy: TopicSortBy, elapsedSeconds: number): number {
  switch (sortBy) {
    case 'messages':
      return node.value;
    case 'bytes':
      return node.bytes;
    case 'topics':
      return node.topicCount || 0;
    case 'busy':
      return elapsedSeconds > 0 ? node.value / elapsedSeconds : 0;
    case 'lastArrival':
      return node.lastArrivalMs || 0;
    case 'depth':
      return subtreeDepth(node);
    case 'name':
      return 0; // handled separately - string compare, not numeric
  }
}

// Mirrors SunburstChart's own getSizeValue - the metric that actually determines
// arc width, so it's what MIN_SHARE_OF_PARENT is measured against. Deliberately
// separate from metricFor/sortBy above: sizingMode and sortBy are independent
// controls (sorting by name shouldn't change what's "too small to show").
function sizeMetricFor(node: TopicNode, sizingMode: SunburstSizingMode): number {
  switch (sizingMode) {
    case 'bytes':
      return node.bytes;
    case 'topics':
      return node.topicCount || 0;
    case 'equal':
    case 'messages':
    default:
      return node.value;
  }
}

function sortChildren(children: TopicNode[], sortBy: TopicSortBy, elapsedSeconds: number): TopicNode[] {
  const sorted = [...children];
  if (sortBy === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    sorted.sort((a, b) => metricFor(b, sortBy, elapsedSeconds) - metricFor(a, sortBy, elapsedSeconds));
  }
  return sorted;
}

function makeOthersNode(rolledUp: TopicNode[], parentPath: string, accurate: boolean, smallestKeptValue: number | null): TopicNode {
  let value = 0;
  let bytes = 0;
  let topicCount = 0;
  let lastArrivalMs: number | undefined;
  for (const n of rolledUp) {
    value += n.value;
    bytes += n.bytes;
    topicCount += n.topicCount || 0;
    if (n.lastArrivalMs && (!lastArrivalMs || n.lastArrivalMs > lastArrivalMs)) {
      lastArrivalMs = n.lastArrivalMs;
    }
  }
  const displayValue = !accurate && smallestKeptValue != null ? Math.min(value, smallestKeptValue) : value;
  return {
    name: '*OTHERS*',
    path: `${parentPath}/*OTHERS*`,
    value: displayValue,
    bytes,
    topicCount,
    lastArrivalMs,
    children: [],
    isOthers: true,
  };
}

function transform(node: TopicNode, depth: number, opts: RollupOptions): TopicNode {
  const effectiveDepth = node.path === opts.zoomedPath ? 0 : depth;

  if (node.children.length === 0) {
    return { ...node, children: [] };
  }

  if (effectiveDepth >= opts.detailLevel) {
    return { ...node, children: [], isRollup: true };
  }

  const transformedChildren = node.children.map((c) => transform(c, effectiveDepth + 1, opts));

  const byMessages = [...transformedChildren].sort((a, b) => b.value - a.value);
  const keepCount = Math.max(0, opts.maxElementsPerLevel - 1);

  const sizeTotal =
    opts.sizingMode === 'equal' ? 0 : transformedChildren.reduce((sum, c) => sum + sizeMetricFor(c, opts.sizingMode), 0);
  const tooSmall =
    sizeTotal > 0
      ? new Set(transformedChildren.filter((c) => sizeMetricFor(c, opts.sizingMode) / sizeTotal < MIN_SHARE_OF_PARENT))
      : new Set<TopicNode>();

  const kept: TopicNode[] = [];
  const rolledUp: TopicNode[] = [];
  for (const c of byMessages) {
    if (kept.length < keepCount && !tooSmall.has(c)) kept.push(c);
    else rolledUp.push(c);
  }

  let children = kept;
  let isRollup = false;
  if (rolledUp.length > 0) {
    isRollup = true;
    const smallestKeptValue = kept.length > 0 ? kept[kept.length - 1].value : null;
    children = [...kept, makeOthersNode(rolledUp, node.path, opts.accurateOthersSizes, smallestKeptValue)];
  }

  const others = children.find((c) => c.isOthers);
  const rest = sortChildren(
    children.filter((c) => !c.isOthers),
    opts.sortBy,
    opts.elapsedSeconds
  );
  children = others ? [...rest, others] : rest;

  return { ...node, children, isRollup };
}

export function buildDisplayTree(root: TopicNode, opts: RollupOptions): TopicNode {
  return transform(root, 0, opts);
}
