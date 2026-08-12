/**
 * Proxy between the dashboard's chat widget and Solace Agent Mesh's own chat API.
 *
 * WHY A BACKEND PROXY AND NOT A DIRECT BROWSER CALL:
 *
 * 1. CORS. Verified against the running platform: an OPTIONS preflight to
 *    /api/v1/message:stream with `Origin: http://localhost:47173` (the
 *    dashboard's origin) comes back with NO Access-Control-Allow-Origin header,
 *    so a real browser blocks the request. The dashboard's own origin is the
 *    only one it can call, hence this same-origin hop.
 *
 * 2. Blast radius. `sam api --help` is explicit that this API surface is Early
 *    Access: "its commands, flags, and output may change... Do not build
 *    external system integrations on top of it; the endpoints and response
 *    shapes it exposes are not a stable contract." Keeping it behind this one
 *    module means a breaking platform change is a fix here, not a hunt through
 *    React components.
 *
 * These are REAL Agent Mesh sessions, deliberately - not a parallel chat
 * mechanism invented for this dashboard. A session created here appears in the
 * same session list as one created in the Agent Mesh Web UI, so a conversation
 * started in the dashboard is visible (and continuable) there, and multi-turn
 * memory is the platform's own rather than context we re-send each turn.
 *
 * Every request/response shape below was verified against the live platform;
 * see the comment on each function for the specific finding.
 */

const DEFAULT_PLATFORM_URL = 'http://agent-mesh:8800';

/**
 * Which agent the chat talks to.
 *
 * The Orchestrator, deliberately - NOT a specific agent. It reads every
 * deployed agent's card (their `skills` blocks) and delegates, so one chat
 * window can field history questions, research requests, and signal questions
 * alike instead of being limited to whatever single agent we hardcoded. Point
 * SAM_CHAT_AGENT at a specific agent name to bypass delegation.
 */
const DEFAULT_AGENT_NAME = process.env.SAM_CHAT_AGENT ?? 'Orchestrator';

/**
 * How long to wait for an agent's reply before giving up. Generous because the
 * historian makes a real LLM call and may run several SQL queries first.
 */
const REPLY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 750;

function platformUrl(): string {
  return (process.env.SAM_PLATFORM_URL ?? DEFAULT_PLATFORM_URL).replace(/\/$/, '');
}

export interface SamChatTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/** Raw shape of GET /api/v1/sessions/{id}/messages entries (verified live). */
interface SamSessionMessage {
  id?: string;
  sessionId?: string;
  senderType?: string; // "user" | "agent"
  senderName?: string; // "sam_dev_user" | "agent_<uuid>"
  messageType?: string; // "text"
  message?: unknown; // plain string when messageType === "text"
  createdAt?: string;
}

class SamPlatformError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SamPlatformError';
  }
}

async function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${platformUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    // Almost always agent-mesh not up yet, or a wrong SAM_PLATFORM_URL.
    throw new SamPlatformError(
      `Cannot reach Agent Mesh at ${platformUrl()}: ${(err as Error).message}`,
    );
  }
  return res;
}

/**
 * Creates a real Agent Mesh session and returns its id.
 *
 * Verified: POST /api/v1/sessions with {"id": "<uuid>"} returns 201 and the
 * created session, owned by sam_dev_user. The id is CLIENT-supplied (the server
 * does not mint one), and `name` is rejected as an unknown field - so the body
 * must be exactly {id}.
 */
export async function createSession(): Promise<string> {
  const sessionId = crypto.randomUUID();
  const res = await platformFetch('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({ id: sessionId }),
  });

  if (res.status !== 201 && res.status !== 200) {
    const body = await res.text().catch(() => '');
    throw new SamPlatformError(
      `Agent Mesh rejected session creation (HTTP ${res.status}): ${body.slice(0, 300)}`,
      res.status,
    );
  }
  return sessionId;
}

/**
 * Reads a session's transcript.
 *
 * Verified against a real Web-UI conversation: each entry is
 *   { senderType: "user" | "agent", senderName, messageType: "text",
 *     message: "<the text>", createdAt }
 * with `message` a plain string when messageType is "text". Anything that isn't
 * a plain-string text message is skipped rather than rendered as "[object
 * Object]" - the platform may add richer part types later.
 */
export async function getSessionMessages(sessionId: string): Promise<SamChatTurn[]> {
  const res = await platformFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`);
  if (!res.ok) {
    throw new SamPlatformError(
      `Could not read session messages (HTTP ${res.status})`,
      res.status,
    );
  }
  const body = (await res.json()) as { data?: SamSessionMessage[] };
  const rows = Array.isArray(body?.data) ? body.data : [];

  const turns: SamChatTurn[] = [];
  for (const row of rows) {
    if (typeof row?.message !== 'string' || row.message.trim() === '') continue;
    turns.push({
      role: row.senderType === 'agent' ? 'assistant' : 'user',
      content: row.message,
      timestamp: row.createdAt ?? new Date().toISOString(),
    });
  }
  return turns;
}

/**
 * Digs the error out of a failed task.
 *
 * Verified on a real failed task: GET /api/v1/tasks/{id}/events returns JSON
 * whose event payloads carry the failure at
 *   data[].events[].full_payload.error.message
 * (e.g. "Bad request: Budget has been exceeded!"). Surfacing this is the
 * difference between the widget showing the real reason and just timing out.
 *
 * GET /api/v1/tasks/{id} also exists but returns YAML (the STIM file), so this
 * uses the JSON sibling.
 */
async function findTaskError(taskId: string): Promise<string | null> {
  try {
    const res = await platformFetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/events`);
    if (!res.ok) return null;
    const body = await res.json();

    let found: string | null = null;
    const walk = (node: unknown): void => {
      if (found || node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      const obj = node as Record<string, unknown>;
      const err = obj.error;
      if (err && typeof err === 'object') {
        const msg = (err as Record<string, unknown>).message;
        if (typeof msg === 'string' && msg.trim() !== '') {
          found = msg;
          return;
        }
      }
      for (const v of Object.values(obj)) walk(v);
    };
    walk(body);
    return found;
  } catch {
    return null;
  }
}

/**
 * Sends one user message to an agent within a session and waits for the reply.
 *
 * Verified request contract for POST /api/v1/message:stream:
 *  - It is JSON-RPC 2.0 (A2A). A body without `jsonrpc: "2.0"` is rejected
 *    with -32700 "invalid jsonrpc version".
 *  - `metadata.agent_name` MUST live at params.message.metadata. Putting it at
 *    the top level or at params.metadata both fail with
 *    -32602 "metadata.agent_name is required".
 *  - `contextId` set to a session id binds the task to that session - confirmed
 *    by the response echoing it back and the session then reporting that agent.
 *  - Despite the ":stream" name it responds immediately with the task id, NOT
 *    an SSE stream, even when Accept: text/event-stream is sent. The reply has
 *    to be collected separately, which is why this polls below.
 *
 * Polling the session transcript (rather than parsing an event stream) keeps
 * this simple and reuses the exact same endpoint that powers history reload.
 */
export async function sendMessage(
  sessionId: string,
  message: string,
  agentName: string = DEFAULT_AGENT_NAME,
): Promise<SamChatTurn> {
  const before = await getSessionMessages(sessionId).catch(() => [] as SamChatTurn[]);
  const assistantCountBefore = before.filter((t) => t.role === 'assistant').length;

  const res = await platformFetch('/api/v1/message:stream', {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'message/stream',
      params: {
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: message }],
          messageId: crypto.randomUUID(),
          contextId: sessionId,
          metadata: { agent_name: agentName },
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SamPlatformError(
      `Agent Mesh rejected the message (HTTP ${res.status}): ${body.slice(0, 300)}`,
      res.status,
    );
  }

  const rpc = (await res.json()) as {
    result?: { id?: string };
    error?: { message?: string };
  };
  if (rpc.error) {
    throw new SamPlatformError(rpc.error.message ?? 'Agent Mesh returned a JSON-RPC error');
  }
  const taskId = rpc.result?.id;

  // Poll for a new assistant turn, checking the task for a hard failure as we
  // go so a budget/config error surfaces immediately instead of timing out.
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const turns = await getSessionMessages(sessionId).catch(() => null);
    if (turns) {
      const assistantTurns = turns.filter((t) => t.role === 'assistant');
      if (assistantTurns.length > assistantCountBefore) {
        return assistantTurns[assistantTurns.length - 1];
      }
    }

    if (taskId) {
      const taskError = await findTaskError(taskId);
      if (taskError) throw new SamPlatformError(taskError);
    }
  }

  throw new SamPlatformError(
    `The agent did not reply within ${Math.round(REPLY_TIMEOUT_MS / 1000)}s.`,
  );
}

export { SamPlatformError, DEFAULT_AGENT_NAME };
