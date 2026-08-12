/**
 * Batched Postgres writer.
 *
 * Batching is not premature optimization here: the dashboard's Market Data
 * generator publishes up to ~1000 msg/s (its rate slider goes to 1000/s and it
 * batch-publishes to get there), and one INSERT round-trip per message would
 * fall behind and grow an unbounded in-memory queue. Rows are buffered and
 * flushed as a single multi-row INSERT per table, on whichever comes first:
 * FLUSH_INTERVAL_MS elapsing, or MAX_BATCH rows accumulating.
 *
 * Connects as `history_writer`, which Postgres grants INSERT + SELECT and
 * deliberately NOT update/delete - see db/init/002-roles.sh. Nothing in this
 * file can rewrite history even if it tried to.
 */
import { Pool } from 'pg';
import type { PriceTickRow, TweetRow, SignalRow } from './parse.js';

const FLUSH_INTERVAL_MS = 500;
/**
 * Caps rows per INSERT statement. Postgres has a hard limit of 65535 bind
 * parameters per statement; at 10 columns that is ~6500 rows, so 2000 leaves
 * generous headroom while still being one round-trip for a busy half-second.
 */
const MAX_BATCH = 2000;
/**
 * Backpressure ceiling. If Postgres is unreachable, buffers would otherwise
 * grow until the process OOMs. Past this we drop the OLDEST rows: for a
 * market-pulse demo, the most recent history is what someone is about to ask
 * about, and a bounded gap beats a crashed recorder.
 */
const MAX_BUFFER = 50_000;

export class HistoryWriter {
  private pool: Pool;
  private priceTicks: PriceTickRow[] = [];
  private tweets: TweetRow[] = [];
  private signals: SignalRow[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private droppedRows = 0;
  private insertedCounts = { priceTicks: 0, tweets: 0, signals: 0 };

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 4,
      // Fail fast and retry on the next flush rather than hanging the writer.
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });

    // A pool-level 'error' with no listener would crash the process on an idle
    // client dropping (e.g. Postgres restarting). Log and let the pool
    // reconnect on the next acquire.
    this.pool.on('error', (err) => {
      console.error('[db] idle client error (pool will reconnect):', err.message);
    });
  }

  /** Verifies credentials/connectivity at boot so misconfiguration fails loudly. */
  async verifyConnection(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    await this.pool.end();
  }

  private enqueue<T>(buffer: T[], row: T): void {
    if (buffer.length >= MAX_BUFFER) {
      buffer.shift();
      this.droppedRows++;
      if (this.droppedRows % 1000 === 1) {
        console.error(
          `[db] buffer full (${MAX_BUFFER}); dropping oldest rows. Total dropped: ${this.droppedRows}. Is Postgres reachable?`,
        );
      }
    }
    buffer.push(row);
  }

  addPriceTick(row: PriceTickRow): void {
    this.enqueue(this.priceTicks, row);
    if (this.priceTicks.length >= MAX_BATCH) void this.flush();
  }

  addTweet(row: TweetRow): void {
    this.enqueue(this.tweets, row);
  }

  addSignal(row: SignalRow): void {
    this.enqueue(this.signals, row);
  }

  stats() {
    return {
      ...this.insertedCounts,
      buffered: this.priceTicks.length + this.tweets.length + this.signals.length,
      dropped: this.droppedRows,
    };
  }

  /**
   * Flushes all three buffers. Rows are taken out of the buffer BEFORE the
   * await and put back on failure, so a slow/failed flush can't lose rows and
   * can't double-insert them either.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (!this.priceTicks.length && !this.tweets.length && !this.signals.length) return;

    this.flushing = true;
    const takenTicks = this.priceTicks.splice(0, MAX_BATCH);
    const takenTweets = this.tweets.splice(0, MAX_BATCH);
    const takenSignals = this.signals.splice(0, MAX_BATCH);

    try {
      if (takenTicks.length) {
        await this.insertPriceTicks(takenTicks);
        this.insertedCounts.priceTicks += takenTicks.length;
      }
      if (takenTweets.length) {
        await this.insertTweets(takenTweets);
        this.insertedCounts.tweets += takenTweets.length;
      }
      if (takenSignals.length) {
        await this.insertSignals(takenSignals);
        this.insertedCounts.signals += takenSignals.length;
      }
    } catch (err) {
      // Put them back at the FRONT to preserve ordering, then let the next
      // interval retry. enqueue() bounds growth if Postgres stays down.
      this.priceTicks.unshift(...takenTicks);
      this.tweets.unshift(...takenTweets);
      this.signals.unshift(...takenSignals);
      console.error('[db] flush failed, rows re-queued for retry:', (err as Error).message);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Builds a multi-row INSERT: ($1,...,$10),($11,...,$20),...
   * Parameterized (never string-interpolated) so payload text cannot be
   * construed as SQL, even though these payloads are partly LLM-authored.
   */
  private buildValues(rowCount: number, colCount: number): string {
    const groups: string[] = [];
    for (let r = 0; r < rowCount; r++) {
      const placeholders: string[] = [];
      for (let c = 1; c <= colCount; c++) placeholders.push(`$${r * colCount + c}`);
      groups.push(`(${placeholders.join(',')})`);
    }
    return groups.join(',');
  }

  private async insertPriceTicks(rows: PriceTickRow[]): Promise<void> {
    const cols = 10;
    const params: unknown[] = [];
    for (const r of rows) {
      params.push(
        r.symbol, r.companyName, r.currentPrice, r.percentChange, r.priceChange,
        r.volume, r.previousClose, r.exchange, r.country, r.eventTs,
      );
    }
    await this.pool.query(
      `INSERT INTO price_ticks
         (symbol, company_name, current_price, percent_change, price_change,
          volume, previous_close, exchange, country, event_ts)
       VALUES ${this.buildValues(rows.length, cols)}`,
      params,
    );
  }

  private async insertTweets(rows: TweetRow[]): Promise<void> {
    const cols = 5;
    const params: unknown[] = [];
    for (const r of rows) {
      params.push(r.symbol, r.content, r.author, r.sentiment, r.eventTs);
    }
    await this.pool.query(
      `INSERT INTO tweets (symbol, content, author, sentiment, event_ts)
       VALUES ${this.buildValues(rows.length, cols)}`,
      params,
    );
  }

  private async insertSignals(rows: SignalRow[]): Promise<void> {
    const cols = 7;
    const params: unknown[] = [];
    for (const r of rows) {
      params.push(r.symbol, r.companyName, r.signal, r.confidence, r.reasoning, r.content, r.eventTs);
    }
    await this.pool.query(
      `INSERT INTO signals
         (symbol, company_name, signal, confidence, reasoning, content, event_ts)
       VALUES ${this.buildValues(rows.length, cols)}`,
      params,
    );
  }
}
