-- Market Pulse history database: tables and indexes.
--
-- Written by the market-history service (the only writer) from live broker
-- traffic; read by Solace Agent Mesh's market-historian-agent through the
-- sql/postgres connector, so the dashboard's chat window can answer questions
-- about what already happened. Roles/grants are in 002-roles.sh.
--
-- Runs automatically on first container start: the postgres image executes
-- everything in /docker-entrypoint-initdb.d/ in filename order, but ONLY
-- against a fresh data directory. It does not re-run once the volume has data,
-- so treat this as create-once - later changes need a new migration against a
-- fresh volume (or manual DDL), not an edit here.
--
-- Column shapes deliberately mirror the live payloads rather than improving on
-- them, so a row is traceable back to the message that produced it:
--   price_ticks <- market-data/EQ/{country}/{exchange}/{symbol}
--                  (MarketDataMessage in dashboard/client/src/types/generatorTypes.ts)
--   tweets      <- twitter-feed/{symbol}   (TweetData, same file)
--   signals     <- signal/{symbol}         (trading-signal-agent.yaml outputSchema)

-- Every field except symbol/recorded_at is nullable on purpose. These payloads
-- come from a generator (and, for signals, from an LLM), so a missing or
-- renamed field should cost one degraded column, not the whole row - the same
-- defensive posture dashboard/client/src/lib/agentPayload.ts takes on the read
-- side. `symbol` is the one hard requirement: a row we can't attribute to a
-- ticker is useless for every query this exists to serve.

CREATE TABLE price_ticks (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol         TEXT        NOT NULL,
  company_name   TEXT,
  current_price  NUMERIC(18, 4),
  percent_change NUMERIC(10, 4),
  price_change   NUMERIC(18, 4),
  volume         BIGINT,
  previous_close NUMERIC(18, 4),
  exchange       TEXT,
  country        TEXT,
  -- Publisher-supplied event time; may be absent or unparseable in a bad payload.
  event_ts       TIMESTAMPTZ,
  -- Server-side receipt time: always present, so time-range queries have a
  -- trustworthy column even when event_ts is missing. All times are UTC.
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tweets (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol      TEXT        NOT NULL,
  content     TEXT,
  author      TEXT,
  -- The generator's own bullish/bearish/neutral label. NOT the AI's verdict -
  -- that lands in signals.signal. Kept separate so a query can compare the two
  -- ("did the agent agree with the tweet's own tone?").
  sentiment   TEXT,
  event_ts    TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signals (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol       TEXT        NOT NULL,
  company_name TEXT,
  -- Buy | Sell | Hold per the agent's outputSchema enum. Deliberately NOT a
  -- CHECK constraint or enum type: this is LLM output, and a rejected INSERT
  -- would lose the row entirely. Let odd values land where they're visible.
  signal       TEXT,
  confidence   NUMERIC(5, 4),
  reasoning    TEXT,
  -- The tweet text the agent reasoned about, copied through by the agent.
  content      TEXT,
  event_ts     TIMESTAMPTZ,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every question this serves ("what happened to NVDA yesterday", "last signals
-- on TSLA") filters by symbol and orders by time, so each table gets one
-- composite index. recorded_at rather than event_ts because it's non-null.
CREATE INDEX idx_price_ticks_symbol_time ON price_ticks (symbol, recorded_at DESC);
CREATE INDEX idx_tweets_symbol_time      ON tweets      (symbol, recorded_at DESC);
CREATE INDEX idx_signals_symbol_time     ON signals     (symbol, recorded_at DESC);

-- Retention note: price_ticks grows fastest (the Market Data generator can
-- publish ~1000 msg/s). A long-lived instance will want periodic pruning;
-- there's deliberately none here, so a demo never silently loses the history
-- someone is about to ask about.
