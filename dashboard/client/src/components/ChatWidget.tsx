/**
 * Ask-SAM chat widget: a floating bottom-right panel for asking questions about
 * recorded market history in natural language.
 *
 * Two deliberate departures from the rest of this dashboard:
 *
 * 1. It talks to our own backend over fetch, NOT to the broker. Chat uses Agent
 *    Mesh's own session API (proxied at /api/chat/* because that API sends no
 *    CORS headers for this origin), so these are real Agent Mesh sessions -
 *    the same ones its Web UI lists - and multi-turn memory is the platform's
 *    rather than context we re-send every turn. A consequence worth knowing:
 *    this widget works even when the Solace Connection panel is disconnected,
 *    which is why it mounts in App.tsx rather than inside Dashboard.tsx.
 *
 * 2. It is NOT built on Sheet or Dialog. Both are Radix modal primitives that
 *    render a full-viewport dimming overlay and trap focus - correct for
 *    ResearchPanel (a transient, one-shot answer), wrong for a panel someone
 *    keeps open while reading the ticker underneath. So: a plain fixed-position
 *    element, in the same spirit as ThemeToggle.
 *
 * Positioning has to coexist with the other fixed elements, which are each
 * hand-offset with no shared layout system:
 *   StatusBar   fixed bottom-0, h-10 (40px), z-50   - full width
 *   ThemeToggle fixed bottom-12 right-4, z-50
 *   toasts      fixed bottom-0 right-0, z-[100]     - must stay above this
 * Hence: launcher at bottom-24 right-4 (clears ThemeToggle), panel bottom-24
 * with a max-height that keeps it off the footer, both below the toast layer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, X, Send, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatTurn } from '@shared/schema';

/** Where the chat session id is remembered, so a reload resumes the same
 * Agent Mesh conversation instead of silently orphaning it. */
const SESSION_STORAGE_KEY = 'market-pulse-chat-session';

const SUGGESTIONS = [
  "What symbols do you have data for?",
  "What was NVDA's price range recently?",
  "How many Buy signals today?",
];

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isBusy]);

  /**
   * Starts a session (or restores the stored one). Agent Mesh holds the
   * transcript, so restoring means fetching it back rather than trusting
   * anything cached client-side.
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;

    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      try {
        const res = await fetch(`/api/chat/session/${encodeURIComponent(stored)}/messages`);
        if (res.ok) {
          const body = await res.json();
          if (Array.isArray(body?.turns)) setTurns(body.turns);
          setSessionId(stored);
          return stored;
        }
        // Session is gone (platform restarted, volume wiped): fall through and
        // mint a new one rather than leaving the widget permanently broken.
        localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }

    try {
      const res = await fetch('/api/chat/session', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Could not start a chat session (HTTP ${res.status})`);
      }
      const { sessionId: newId } = await res.json();
      localStorage.setItem(SESSION_STORAGE_KEY, newId);
      setSessionId(newId);
      setError(null);
      return newId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a chat session');
      return null;
    }
  }, [sessionId]);

  // Create/restore lazily on first open, so a user who never opens chat never
  // creates an Agent Mesh session.
  useEffect(() => {
    if (isOpen && !sessionId) void ensureSession();
  }, [isOpen, sessionId, ensureSession]);

  useEffect(() => {
    if (isOpen && !isBusy) inputRef.current?.focus();
  }, [isOpen, isBusy]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isBusy) return;

      const id = await ensureSession();
      if (!id) return;

      setError(null);
      setInput('');
      // Echo locally so the question appears instantly; the authoritative copy
      // lives in the Agent Mesh session.
      setTurns((prev) => [
        ...prev,
        { role: 'user', content: trimmed, timestamp: new Date().toISOString() },
      ]);
      setIsBusy(true);

      try {
        const res = await fetch('/api/chat/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: id, message: trimmed }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.message || `Request failed (HTTP ${res.status})`);
        }
        if (body?.reply?.content) {
          setTurns((prev) => [...prev, body.reply as ChatTurn]);
        } else {
          throw new Error('The agent replied with no content.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setIsBusy(false);
      }
    },
    [ensureSession, isBusy],
  );

  /** Abandons this conversation and starts a fresh Agent Mesh session. */
  const startNewChat = useCallback(async () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setSessionId(null);
    setTurns([]);
    setError(null);
    setInput('');
    await ensureSession();
  }, [ensureSession]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter for a newline, as in most chat UIs.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        title="Ask about market history"
        aria-label="Open market history chat"
        className="fixed bottom-24 right-4 z-50 h-12 w-12 rounded-full p-0 shadow-lg"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Market history chat"
      className="fixed bottom-24 right-4 z-40 flex w-[calc(100vw-2rem)] max-w-md flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
      style={{ maxHeight: 'min(32rem, calc(100vh - 8rem))' }}
    >
      <header className="flex flex-shrink-0 items-center justify-between border-b border-border bg-muted/50 px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Ask about market history</h2>
          <p className="truncate text-xs text-muted-foreground">
            Powered by Solace Agent Mesh
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void startNewChat()}
            disabled={isBusy}
            title="Start a new conversation"
            aria-label="Start a new conversation"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsOpen(false)}
            title="Close"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 && !isBusy && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Ask about recorded prices, posts, and trading signals — for example:
            </p>
            <div className="flex flex-col items-start gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="rounded-md border border-border px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div
            key={`${turn.timestamp}-${i}`}
            className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
                turn.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {turn.content}
            </div>
          </div>
        ))}

        {isBusy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {/* The agent may run several SQL queries before answering, so set
                expectations rather than implying it hung. */}
            <span>Querying market history&hellip;</span>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 items-end gap-2 border-t border-border p-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={isBusy}
          placeholder="Ask about past prices, posts, or signals..."
          aria-label="Chat message"
          className="max-h-24 min-h-[2.25rem] flex-1 resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
        />
        <Button
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={() => void send(input)}
          disabled={isBusy || input.trim() === ''}
          title="Send"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Same honesty as ResearchPanel's footer: this is model output over
          simulated demo data, not investment advice. */}
      <p className="flex-shrink-0 border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] leading-tight text-muted-foreground">
        Answers come from AI querying recorded demo data. Not financial advice.
      </p>
    </div>
  );
}
