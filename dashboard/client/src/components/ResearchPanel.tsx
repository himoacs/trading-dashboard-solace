import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import type { ResearchState } from '@shared/schema';

interface ResearchPanelProps {
  /** Symbol whose briefing is shown; null closes the panel. */
  symbol: string | null;
  /** Research state for that symbol, if any. */
  state: ResearchState | undefined;
  onClose: () => void;
  onRetry: (symbol: string) => void;
}

const sentimentClass = (sentiment?: string) => {
  switch ((sentiment || '').toLowerCase()) {
    case 'bullish':
      return 'bg-green-500 text-white';
    case 'bearish':
      return 'bg-red-500 text-white';
    case 'neutral':
      return 'bg-yellow-400 text-gray-900';
    default:
      return 'bg-gray-300 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
};

/** Deterministic compliance/actionability classification - a business-rule
 * gate on the AI's output, not another AI judgment call. Colors mirror the
 * severity: red can't be acted on at all, green can, yellow/gray are
 * in-between. */
const categoryClass = (category?: string) => {
  switch (category) {
    case 'Blocked':
      return 'bg-red-600 text-white';
    case 'Actionable':
      return 'bg-green-600 text-white';
    case 'Advisory':
      return 'bg-amber-400 text-gray-900';
    case 'Watch Only':
      return 'bg-gray-400 text-white dark:bg-gray-600';
    default:
      return 'bg-gray-300 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
};

const BulletList: React.FC<{ title: string; items?: string[] }> = ({ title, items }) => {
  if (!items || items.length === 0) return null;
  return (
    <section className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

const LoadingBody = () => (
  <div className="mt-6" role="status" aria-live="polite">
    <p className="text-sm text-gray-500 dark:text-gray-400">
      Asking the Agent Mesh research agent&hellip;
    </p>
    <div className="mt-4 space-y-3">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-2/3" />
      <div className="pt-4 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </div>
  </div>
);

export const ResearchPanel: React.FC<ResearchPanelProps> = ({
  symbol,
  state,
  onClose,
  onRetry,
}) => {
  const briefing = state?.status === 'loaded' ? state.briefing : undefined;

  return (
    <Sheet open={symbol !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{symbol}</span>
            {briefing?.sentiment && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${sentimentClass(briefing.sentiment)}`}
              >
                {briefing.sentiment}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            {briefing?.companyName || 'AI market research, generated over the event mesh'}
          </SheetDescription>
        </SheetHeader>

        {state?.status === 'loading' && <LoadingBody />}

        {state?.status === 'error' && (
          <div className="mt-6">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              Research request failed
            </p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 break-words">
              {state.message}
            </p>
            {symbol && (
              <Button className="mt-4" size="sm" variant="outline" onClick={() => onRetry(symbol)}>
                Try again
              </Button>
            )}
          </div>
        )}

        {briefing && (
          <div className="mt-6">
            {/* Bottom line first: the deterministic category is a business-rule
                gate on top of the AI's reasoning, not more AI output - it leads
                the panel rather than sitting alongside the narrative content. */}
            {briefing.category && (
              <div className="mb-4">
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${categoryClass(briefing.category)}`}
                >
                  {briefing.category}
                </span>
                {briefing.categoryReason && (
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {briefing.categoryReason}
                    {briefing.agreement === false && ' - the fresh research disagrees with the existing signal.'}
                  </p>
                )}
              </div>
            )}
            {briefing.headline && (
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {briefing.headline}
              </h2>
            )}
            {briefing.summary && (
              <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {briefing.summary}
              </p>
            )}

            <BulletList title="Key points" items={briefing.keyPoints} />
            <BulletList title="Risks to watch" items={briefing.risks} />

            {briefing.outlook && (
              <section className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Outlook
                </h3>
                <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{briefing.outlook}</p>
              </section>
            )}

            {/* The briefing is model-generated; say so rather than letting it
                read as vetted investment research. */}
            <p className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
              Generated by the Solace Agent Mesh research agent from live event-mesh
              data. Not financial advice.
            </p>
          </div>
        )}

        {!state && symbol && (
          <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
            No research requested yet for {symbol}.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default ResearchPanel;
