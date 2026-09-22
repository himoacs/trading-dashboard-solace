import { useCallback, useEffect, useRef, useState } from 'react';
import solace from 'solclientjs';
import type { SolaceConnection } from '@shared/schema';
import {
  buildTopicTree,
  createEmptyTopicNode,
  createEmptyTopicStats,
  type TopicMapEntry,
  type TopicNode,
  type TopicStats,
} from '@/lib/topicNode';

// Ported from solace-feed-visualizer's useSolaceMonitor.ts - a dedicated,
// broker-wide read-only session (default subscription ">") independent of the
// app's main useSolaceConnection session, so the Topic Explorer reflects real
// traffic on the VPN as a whole rather than only this app's own topics.
//
// Unlike the reference (which authenticates as its own SEMP-provisioned
// monitor client-username), this reuses whatever credentials are already
// active in the dashboard's own Solace Connection panel - no separate
// identity needed, since this is the same trusted browser tab/user.

// Initialize Solace factory if not already done. Same guarded pattern already
// used by TrafficGeneratorContext.tsx: useSolaceConnection.ts also calls
// SolclientFactory.init() unconditionally on connect, so whichever
// solclientjs-using module runs first "wins" and every later init() throws.
try {
  const factoryProps = new solace.SolclientFactoryProperties();
  factoryProps.profile = solace.SolclientFactoryProfiles.version10;
  solace.SolclientFactory.init(factoryProps);
} catch {
  // Already initialized
}

export type TopicMonitorState = 'disconnected' | 'connecting' | 'connected' | 'paused' | 'error';

interface UseTopicMonitorOptions {
  /** The dashboard's own active frontend connection (already has brokerUrl/
   *  vpnName/username/password). null = nothing to connect with yet. */
  connectionConfig: SolaceConnection | null;
  /** Connects when true AND connectionConfig is non-null; disconnects
   *  otherwise - driven off the panel's own open/closed state. */
  enabled: boolean;
  topicFilter?: string;
}

interface UseTopicMonitorReturn {
  state: TopicMonitorState;
  stats: TopicStats;
  topicTree: TopicNode;
  reset: () => void;
  pause: () => void;
  resume: () => void;
  error: string | null;
}

const MAX_TRACKED_TOPICS = 2000;

export function useTopicMonitor({ connectionConfig, enabled, topicFilter = '>' }: UseTopicMonitorOptions): UseTopicMonitorReturn {
  const [state, setState] = useState<TopicMonitorState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<TopicStats>(createEmptyTopicStats);
  const [topicTree, setTopicTree] = useState<TopicNode>(createEmptyTopicNode);

  const sessionRef = useRef<solace.Session | null>(null);
  const topicMapRef = useRef<Map<string, TopicMapEntry>>(new Map());
  const messageCountRef = useRef(0);
  const bytesCountRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const topicCapReachedRef = useRef(false);
  const isPausedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const updateStats = useCallback(() => {
    const now = Date.now();
    const elapsed = startTimeRef.current ? (now - startTimeRef.current) / 1000 : 0;
    setStats({
      totalMessages: messageCountRef.current,
      totalBytes: bytesCountRef.current,
      uniqueTopics: topicMapRef.current.size,
      messageRate: elapsed > 0 ? messageCountRef.current / elapsed : 0,
      startTime: startTimeRef.current,
      topicCapReached: topicCapReachedRef.current,
    });
    setTopicTree(buildTopicTree(topicMapRef.current));
  }, []);

  const handleMessage = useCallback((message: solace.Message) => {
    if (isPausedRef.current) return;

    const topic = message.getDestination()?.getName() || 'unknown';
    const size = message.getBinaryAttachment()?.length || 0;
    const now = Date.now();

    const existing = topicMapRef.current.get(topic);
    if (existing) {
      existing.count++;
      existing.bytes += size;
      existing.lastArrivalMs = now;
    } else if (topicMapRef.current.size < MAX_TRACKED_TOPICS) {
      topicMapRef.current.set(topic, { count: 1, bytes: size, lastArrivalMs: now });
    } else if (!topicCapReachedRef.current) {
      topicCapReachedRef.current = true;
    }

    messageCountRef.current++;
    bytesCountRef.current += size;
  }, []);

  const connect = useCallback(() => {
    if (sessionRef.current || !connectionConfig) return;
    setState('connecting');
    setError(null);

    try {
      const session = solace.SolclientFactory.createSession({
        url: connectionConfig.brokerUrl,
        vpnName: connectionConfig.vpnName,
        userName: connectionConfig.username,
        password: connectionConfig.password,
        // Distinct client name so this session shows up separately from the
        // main one in the broker's client-connections view - cosmetic only.
        clientName: `${connectionConfig.username}-topic-explorer-${Date.now()}`,
        connectRetries: 3,
        reconnectRetries: 3,
        reconnectRetryWaitInMsecs: 1000,
        publisherProperties: { enabled: false }, // read-only monitor - never publishes
      });

      session.on(solace.SessionEventCode.UP_NOTICE, () => {
        setState('connected');
        startTimeRef.current = Date.now();
        try {
          session.subscribe(solace.SolclientFactory.createTopicDestination(topicFilter), true, '', 10000);
        } catch {
          setError('Failed to subscribe to topics');
        }
        updateIntervalRef.current = setInterval(updateStats, 500);
      });

      session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (event: solace.SessionEvent) => {
        sessionRef.current = null;
        setState('error');
        setError(`Connection failed: ${event.infoStr}`);
      });

      session.on(solace.SessionEventCode.DISCONNECTED, () => {
        setState('disconnected');
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
          updateIntervalRef.current = null;
        }
      });

      session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, (event: solace.SessionEvent) => {
        setError(`Subscription error: ${event.infoStr}`);
      });

      session.on(solace.SessionEventCode.MESSAGE, (message: solace.Message) => {
        handleMessage(message);
      });

      sessionRef.current = session;
      session.connect();
    } catch (err) {
      setState('error');
      setError(`Failed to create session: ${(err as Error).message}`);
    }
  }, [connectionConfig, topicFilter, handleMessage, updateStats]);

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      try {
        sessionRef.current.disconnect();
      } catch {
        // already gone
      }
      sessionRef.current = null;
    }
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
    isPausedRef.current = false;
    setState('disconnected');
  }, []);

  const reset = useCallback(() => {
    topicMapRef.current.clear();
    messageCountRef.current = 0;
    bytesCountRef.current = 0;
    topicCapReachedRef.current = false;
    startTimeRef.current = stateRef.current === 'connected' || stateRef.current === 'paused' ? Date.now() : null;
    setStats(createEmptyTopicStats());
    setTopicTree(createEmptyTopicNode());
  }, []);

  const pause = useCallback(() => {
    if (stateRef.current !== 'connected') return;
    isPausedRef.current = true;
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    if (stateRef.current !== 'paused') return;
    isPausedRef.current = false;
    setState('connected');
    updateIntervalRef.current = setInterval(updateStats, 500);
  }, [updateStats]);

  // Connect when enabled AND we actually have credentials; disconnect
  // otherwise. The `&& connectionConfig` matters beyond just `enabled`: if the
  // main frontend connection drops (connectionConfig -> null) while the panel
  // is still open, this must tear the monitor session down too, not silently
  // no-op inside connect()'s own guard.
  useEffect(() => {
    if (enabled && connectionConfig) {
      connect();
    } else {
      disconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, connectionConfig, topicFilter]);

  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        try {
          sessionRef.current.disconnect();
        } catch {
          // ignore
        }
      }
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
    };
  }, []);

  return { state, stats, topicTree, reset, pause, resume, error };
}
