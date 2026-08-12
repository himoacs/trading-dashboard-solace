/**
 * Turning broker payloads into rows.
 *
 * Two different levels of trust are at work here:
 *
 *  - market-data and twitter-feed messages come from the dashboard's own
 *    Traffic Generators, so their shape is known and stable
 *    (MarketDataMessage / TweetData in
 *    dashboard/client/src/types/generatorTypes.ts).
 *
 *  - signal messages are LLM output relayed by Agent Mesh. The repo's README
 *    documents these arriving wrapped in a ```json fence, and
 *    trading-signal-agent.yaml's own comments record a reply that omitted a
 *    required field and renamed another being published anyway. So they get
 *    the same defensive treatment the dashboard applies in
 *    dashboard/client/src/lib/agentPayload.ts.
 *
 * Everything is best-effort by design: a field we can't read becomes NULL
 * rather than costing us the row, because a partial row still answers "what
 * was happening around 14:32" and a dropped one doesn't.
 */

export interface PriceTickRow {
  symbol: string;
  companyName: string | null;
  currentPrice: number | null;
  percentChange: number | null;
  priceChange: number | null;
  volume: number | null;
  previousClose: number | null;
  exchange: string | null;
  country: string | null;
  eventTs: Date | null;
}

export interface TweetRow {
  symbol: string;
  content: string | null;
  author: string | null;
  sentiment: string | null;
  eventTs: Date | null;
}

export interface SignalRow {
  symbol: string;
  companyName: string | null;
  signal: string | null;
  confidence: number | null;
  reasoning: string | null;
  content: string | null;
  eventTs: Date | null;
}

/** Strips a leading/trailing markdown code fence, if present. */
function stripCodeFence(text: string): string {
  const fenced = text
    .trim()
    .match(/^```(?:json|JSON)?\s*\r?\n?([\s\S]*?)\r?\n?```$/);
  return fenced ? fenced[1].trim() : text.trim();
}

/**
 * Parses a raw broker payload into an object, tolerating the ways LLM-authored
 * JSON arrives malformed: fenced, double-encoded (a JSON *string* containing
 * JSON), or surrounded by prose.
 */
export function parseJsonPayload(raw: string): Record<string, any> | null {
  const candidate = stripCodeFence(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    // Model added prose around the JSON: take the widest {...} span.
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first === -1 || last <= first) return null;
    try {
      parsed = JSON.parse(candidate.slice(first, last + 1));
    } catch {
      return null;
    }
  }

  // Double-encoded: JSON.parse yielded another JSON string. Unwrap one level.
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(stripCodeFence(parsed));
    } catch {
      return null;
    }
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, any>;
  }
  return null;
}

/** First present, non-empty string among the given keys. */
function str(obj: Record<string, any>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return null;
}

/** First present, finite number among the given keys (tolerates numeric strings). */
function num(obj: Record<string, any>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Parses a timestamp field. Returns null rather than an Invalid Date, so a
 * garbage value becomes NULL instead of an INSERT error - the `recorded_at`
 * column is always there as a reliable fallback for time-range queries.
 */
function ts(obj: Record<string, any>, ...keys: string[]): Date | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' || typeof v === 'number') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/**
 * The symbol from the topic is more trustworthy than the symbol in the payload.
 * The dashboard makes the same call for research replies, with the comment
 * "Trust the topic for the symbol, not the payload... has been observed
 * renaming fields" - the topic is constructed by the publisher (or by the
 * entrypoint from the original request) and can't drift the way a model's
 * output field can.
 *
 * market-data/EQ/{country}/{exchange}/{symbol} -> last segment
 * twitter-feed/{symbol}, signal/{symbol}       -> last segment
 */
export function symbolFromTopic(topic: string): string | null {
  const parts = topic.split('/').filter((p) => p !== '');
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  return last && last.trim() !== '' ? last : null;
}

export function toPriceTickRow(topic: string, payload: Record<string, any>): PriceTickRow | null {
  const symbol = symbolFromTopic(topic) ?? str(payload, 'symbol');
  if (!symbol) return null;
  return {
    symbol,
    companyName: str(payload, 'companyName', 'company_name'),
    currentPrice: num(payload, 'currentPrice', 'current_price', 'price'),
    percentChange: num(payload, 'percentChange', 'percent_change'),
    priceChange: num(payload, 'priceChange', 'price_change'),
    volume: num(payload, 'volume'),
    previousClose: num(payload, 'previousClose', 'previous_close'),
    exchange: str(payload, 'exchange'),
    country: str(payload, 'country'),
    eventTs: ts(payload, 'timestamp', 'time', 'ts'),
  };
}

export function toTweetRow(topic: string, payload: Record<string, any>): TweetRow | null {
  const symbol = symbolFromTopic(topic) ?? str(payload, 'symbol');
  if (!symbol) return null;
  return {
    symbol,
    content: str(payload, 'content', 'text', 'tweet'),
    author: str(payload, 'author', 'user', 'username'),
    sentiment: str(payload, 'sentiment'),
    eventTs: ts(payload, 'timestamp', 'time', 'ts'),
  };
}

export function toSignalRow(topic: string, payload: Record<string, any>): SignalRow | null {
  const symbol = symbolFromTopic(topic) ?? str(payload, 'symbol', 'ticker');
  if (!symbol) return null;

  // `confidence` is documented 0.0-1.0, but a model that emits 85 for "85%"
  // would otherwise overflow NUMERIC(5,4) and fail the whole batch INSERT.
  let confidence = num(payload, 'confidence');
  if (confidence !== null) {
    if (confidence > 1 && confidence <= 100) confidence = confidence / 100;
    if (confidence < 0 || confidence > 1) confidence = null;
  }

  return {
    symbol,
    companyName: str(payload, 'companyName', 'company_name'),
    // `ticker` is the specific wrong key the agent's prompt warns against, so
    // accept `signal`'s known aliases rather than silently storing NULL.
    signal: str(payload, 'signal', 'verdict', 'recommendation', 'action'),
    confidence,
    reasoning: str(payload, 'reasoning', 'rationale', 'reason'),
    content: str(payload, 'content', 'tweet', 'text'),
    eventTs: ts(payload, 'timestamp', 'time', 'ts'),
  };
}
