// Ported from solace-feed-visualizer's lib/topicNode.ts - the data model the
// Topic Explorer's sunburst/icicle chart and its rollup logic are built against.

export interface TopicNode {
  name: string;
  value: number;
  bytes: number;
  children: TopicNode[];
  path: string;
  lastArrivalMs?: number;
  topicCount?: number;
  isOthers?: boolean;
  isRollup?: boolean;
  /** This prefix is ALSO itself a real published topic, not just an ancestor. */
  ownValue?: number;
  ownBytes?: number;
}

export interface TopicStats {
  totalMessages: number;
  totalBytes: number;
  uniqueTopics: number;
  messageRate: number;
  startTime: number | null;
  topicCapReached: boolean;
}

export function createEmptyTopicNode(name: string = 'root'): TopicNode {
  return {
    name,
    value: 0,
    bytes: 0,
    children: [],
    path: name === 'root' ? '' : name,
  };
}

export function createEmptyTopicStats(): TopicStats {
  return {
    totalMessages: 0,
    totalBytes: 0,
    uniqueTopics: 0,
    messageRate: 0,
    startTime: null,
    topicCapReached: false,
  };
}

export interface TopicMapEntry {
  count: number;
  bytes: number;
  lastArrivalMs: number;
}

/** Builds the tree from a flat topic -> {count,bytes,lastArrivalMs} map. */
export function buildTopicTree(topicMap: Map<string, TopicMapEntry>): TopicNode {
  const root: TopicNode = createEmptyTopicNode();

  topicMap.forEach((data, topic) => {
    const parts = topic.split('/');
    let current = root;
    let path = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      path = path ? `${path}/${part}` : part;

      const existingChild = current.children.find((c) => c.name === part);
      if (existingChild) {
        if (i === parts.length - 1) {
          existingChild.value = data.count;
          existingChild.bytes = data.bytes;
          existingChild.lastArrivalMs = data.lastArrivalMs;
          existingChild.ownValue = data.count;
          existingChild.ownBytes = data.bytes;
        }
        current = existingChild;
      } else {
        const newChild: TopicNode = {
          name: part,
          value: i === parts.length - 1 ? data.count : 0,
          bytes: i === parts.length - 1 ? data.bytes : 0,
          lastArrivalMs: i === parts.length - 1 ? data.lastArrivalMs : undefined,
          ownValue: i === parts.length - 1 ? data.count : undefined,
          ownBytes: i === parts.length - 1 ? data.bytes : undefined,
          children: [],
          path,
        };
        current.children.push(newChild);
        current = newChild;
      }
    }
  });

  propagateValues(root);
  return root;
}

/** Sums each node's own value/bytes up into ancestors, in place. */
export function propagateValues(node: TopicNode): { value: number; bytes: number; lastArrivalMs: number; topicCount: number } {
  if (node.children.length === 0) {
    return { value: node.value, bytes: node.bytes, lastArrivalMs: node.lastArrivalMs || 0, topicCount: 1 };
  }

  let totalValue = node.value;
  let totalBytes = node.bytes;
  let maxLastArrival = node.lastArrivalMs || 0;
  let totalTopicCount = 0;
  for (const child of node.children) {
    const childTotals = propagateValues(child);
    totalValue += childTotals.value;
    totalBytes += childTotals.bytes;
    maxLastArrival = Math.max(maxLastArrival, childTotals.lastArrivalMs);
    totalTopicCount += childTotals.topicCount;
  }

  node.value = totalValue;
  node.bytes = totalBytes;
  node.lastArrivalMs = maxLastArrival || undefined;
  node.topicCount = totalTopicCount;
  return { value: totalValue, bytes: totalBytes, lastArrivalMs: maxLastArrival, topicCount: totalTopicCount };
}
