/**
 * market-history: records Market Pulse broker traffic into Postgres.
 *
 * This is a plain, non-AI app component, deliberately. Solace Agent Mesh never
 * writes to this database - it only ever READS it, through its sql/postgres
 * connector as the SELECT-only `history_reader` role, so the dashboard's chat
 * window can answer questions about what already happened. Persisting through
 * an LLM would be slow, expensive, and pointless for raw ticks.
 *
 * Subscribes:
 *   market-data/EQ/>    price ticks   (browser Traffic Generator)
 *   twitter-feed/>      tweets        (browser Traffic Generator)
 *   signal/>            trading signals (Agent Mesh, via the market-events entrypoint)
 *
 * KNOWN, ACCEPTED LIMITATION: these are plain topic subscriptions on a DIRECT
 * (non-persistent) session, not a durable queue like the entrypoint's own
 * tweet_to_signal queue. Messages published while this service is down or
 * restarting are gone, and the dashboard's user-facing "Allow Message Eliding"
 * toggle can drop ticks under load by design. So history can legitimately have
 * gaps. That is fine for a demo, but it is why the agent's system prompt tells
 * it to state plainly when data doesn't cover a question rather than guessing.
 * Making this gap-free would mean binding to a durable queue instead.
 */
import solace from 'solclientjs';
import { HistoryWriter } from './db.js';
import {
  parseJsonPayload,
  toPriceTickRow,
  toTweetRow,
  toSignalRow,
} from './parse.js';

const TOPIC_MARKET_DATA = 'market-data/EQ/>';
const TOPIC_TWITTER_FEED = 'twitter-feed/>';
const TOPIC_SIGNAL = 'signal/>';

/**
 * `signal/>` also matches the entrypoint's static error topic (see
 * solace-agent-mesh/entrypoints/market-events.yaml errorOutput). Those carry an
 * error shape, not a verdict, so they must not land in the signals table - the
 * same care Dashboard.tsx takes separating research/error/ from
 * research/response/.
 */
const TOPIC_SIGNAL_ERRORS = 'signal/errors';

function requireEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) {
    console.error(`[market-history] ${name} is not set`);
    process.exit(1);
  }
  return v;
}

function buildPostgresUrl(): string {
  const host = process.env.POSTGRES_HOST ?? 'postgres';
  const port = process.env.POSTGRES_PORT ?? '5432';
  const db = process.env.POSTGRES_DB ?? 'market_history';
  const user = process.env.POSTGRES_USER ?? 'history_writer';
  const password = requireEnv('POSTGRES_PASSWORD');
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

/** Normalizes to native SMF, which is what the Go/Node clients need (not ws://). */
function normalizeBrokerUrl(raw: string): string {
  if (raw.startsWith('tcp://') || raw.startsWith('tcps://')) return raw;
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) {
    console.warn(`[market-history] broker URL ${raw} is a web-transport URL; this client needs native SMF (tcp://)`);
    return raw;
  }
  return `tcp://${raw}`;
}

async function main(): Promise<void> {
  const brokerUrl = normalizeBrokerUrl(process.env.SOLACE_BROKER_URL ?? 'tcp://broker:55555');
  const vpnName = process.env.SOLACE_BROKER_VPN ?? 'default';
  const userName = process.env.SOLACE_BROKER_USERNAME ?? 'default';
  const password = process.env.SOLACE_BROKER_PASSWORD ?? 'default';

  const writer = new HistoryWriter(buildPostgresUrl());

  // Fail loudly at boot on bad credentials/schema rather than silently
  // buffering rows that can never be written. Compose gates this service on
  // postgres's healthcheck, so a failure here is real misconfiguration, and
  // `restart: unless-stopped` will retry in case it's a startup race.
  await writer.verifyConnection();
  console.log('[market-history] connected to Postgres as writer');
  writer.start();

  const factoryProps = new solace.SolclientFactoryProperties();
  factoryProps.profile = solace.SolclientFactoryProfiles.version10;
  solace.SolclientFactory.init(factoryProps);

  const session = solace.SolclientFactory.createSession({
    url: brokerUrl,
    vpnName,
    userName,
    password,
    clientName: `market-history-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
    // Keep trying forever: this is a background recorder, and a broker restart
    // shouldn't permanently end persistence for the rest of the demo.
    connectRetries: -1,
    reconnectRetries: -1,
    reconnectRetryWaitInMsecs: 3000,
  });

  session.on(solace.SessionEventCode.UP_NOTICE, () => {
    console.log(`[market-history] connected to broker at ${brokerUrl} (vpn: ${vpnName})`);
    for (const topic of [TOPIC_MARKET_DATA, TOPIC_TWITTER_FEED, TOPIC_SIGNAL]) {
      try {
        session.subscribe(
          solace.SolclientFactory.createTopicDestination(topic),
          false, // don't wait for confirm; SUBSCRIPTION_ERROR reports failures
          topic,
          10_000,
        );
        console.log(`[market-history] subscribed: ${topic}`);
      } catch (err) {
        console.error(`[market-history] subscribe failed for ${topic}:`, (err as Error).message);
      }
    }
  });

  session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (e: solace.SessionEvent) => {
    console.error('[market-history] broker connect failed:', e.infoStr);
  });
  session.on(solace.SessionEventCode.DISCONNECTED, () => {
    console.warn('[market-history] disconnected from broker');
  });
  session.on(solace.SessionEventCode.RECONNECTING_NOTICE, () => {
    console.warn('[market-history] reconnecting to broker...');
  });
  session.on(solace.SessionEventCode.RECONNECTED_NOTICE, () => {
    console.log('[market-history] reconnected to broker');
  });
  session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, (e: solace.SessionEvent) => {
    console.error('[market-history] subscription error:', e.correlationKey, e.infoStr);
  });

  session.on(solace.SessionEventCode.MESSAGE, (message: solace.Message) => {
    // One bad message must never take down the recorder.
    try {
      const topic = message.getDestination()?.getName();
      if (!topic) return;

      const raw = message.getBinaryAttachment();
      const text = typeof raw === 'string' ? raw : raw?.toString();
      if (!text) return;

      const payload = parseJsonPayload(text);
      if (!payload) {
        console.warn(`[market-history] unparseable payload on ${topic}`);
        return;
      }

      if (topic.startsWith('market-data/')) {
        const row = toPriceTickRow(topic, payload);
        if (row) writer.addPriceTick(row);
      } else if (topic.startsWith('twitter-feed/')) {
        const row = toTweetRow(topic, payload);
        if (row) writer.addTweet(row);
      } else if (topic === TOPIC_SIGNAL_ERRORS) {
        // Agent failure notice, not a verdict - deliberately not recorded as a
        // signal. Logged so it isn't invisible.
        console.warn('[market-history] agent error on signal/errors:', text.slice(0, 300));
      } else if (topic.startsWith('signal/')) {
        const row = toSignalRow(topic, payload);
        if (row) writer.addSignal(row);
      }
    } catch (err) {
      console.error('[market-history] error handling message:', (err as Error).message);
    }
  });

  session.connect();

  // Periodic heartbeat so `docker compose logs market-history` shows whether
  // recording is actually happening, without logging every row.
  const statsTimer = setInterval(() => {
    const s = writer.stats();
    console.log(
      `[market-history] inserted: ${s.priceTicks} ticks, ${s.tweets} tweets, ${s.signals} signals` +
        ` | buffered: ${s.buffered}${s.dropped ? ` | dropped: ${s.dropped}` : ''}`,
    );
  }, 30_000);

  const shutdown = async (signal: string) => {
    console.log(`[market-history] ${signal} received, flushing and shutting down...`);
    clearInterval(statsTimer);
    try {
      session.disconnect();
    } catch {
      // Already gone; nothing to do.
    }
    try {
      await writer.stop(); // final flush
    } catch (err) {
      console.error('[market-history] error during final flush:', (err as Error).message);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Stay alive through unexpected errors: a recorder that quietly dies mid-demo
  // is worse than one that logs and keeps going. Deliberately does NOT exit,
  // unlike the Node default.
  process.on('uncaughtException', (err) => {
    console.error('[market-history] uncaught exception (continuing):', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[market-history] unhandled rejection (continuing):', reason);
  });
}

main().catch((err) => {
  console.error('[market-history] fatal startup error:', err);
  process.exit(1);
});
