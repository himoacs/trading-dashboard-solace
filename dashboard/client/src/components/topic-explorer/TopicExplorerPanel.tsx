import { useEffect, useMemo, useState } from 'react';
import type { SolaceConnection } from '@shared/schema';
import { useTopicMonitor } from '@/hooks/useTopicMonitor';
import { useResizablePanel } from '@/hooks/useResizablePanel';
import { buildDisplayTree, type TopicSortBy } from '@/lib/topicRollup';
import { SunburstChart, type SunburstSizingMode, type SunburstTheme, type SunburstViewType } from './SunburstChart';

// Native, in-app replacement for the old iframe-to-explorer.solace.dev modal.
// Ported from solace-feed-visualizer's SunburstPanel.tsx; the SEMP-provisioned
// "monitor client" identity it used is dropped entirely here in favor of
// reusing whatever connection is already active in the dashboard's own Solace
// Connection panel (see useTopicMonitor.ts).

interface TopicExplorerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  connectionConfig: SolaceConnection | null;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// The chart-hosting div below has `p-4` padding (32px total) plus some
// breathing room so the circle doesn't touch the panel's edges - clamped so
// it stays legible at the panel's minimum width and doesn't balloon at its
// maximum.
function computeChartSize(panelWidth: number): number {
  return Math.max(240, Math.min(640, panelWidth - 48));
}

export function TopicExplorerPanel({ isOpen, onClose, connectionConfig }: TopicExplorerPanelProps) {
  const { width, onPointerDown } = useResizablePanel({
    defaultWidth: 560,
    min: 360,
    max: 900,
    edge: 'left',
    storageKey: 'trading-dashboard-topic-explorer-panel-width',
  });

  const [theme, setTheme] = useState<SunburstTheme>('dark');
  const [sizingMode, setSizingMode] = useState<SunburstSizingMode>('messages');
  const [viewType, setViewType] = useState<SunburstViewType>('sunburst');
  const [sortBy, setSortBy] = useState<TopicSortBy>('messages');
  const [detailLevel, setDetailLevel] = useState(4);
  const [maxElementsPerLevel, setMaxElementsPerLevel] = useState(12);
  const [accurateOthersSizes, setAccurateOthersSizes] = useState(false);
  const [zoomedPath, setZoomedPath] = useState('');
  // Debounced separately from the panel's own (instant, CSS-only) width so a
  // drag doesn't force a full D3 re-layout/redraw on every intermediate
  // pointermove - only once the drag settles.
  const [chartSize, setChartSize] = useState(() => computeChartSize(width));
  useEffect(() => {
    const timer = setTimeout(() => setChartSize(computeChartSize(width)), 120);
    return () => clearTimeout(timer);
  }, [width]);

  const { state, stats, topicTree, pause, resume, reset, error } = useTopicMonitor({
    connectionConfig,
    enabled: isOpen,
    topicFilter: '>',
  });

  const elapsedSeconds = stats.startTime ? (Date.now() - stats.startTime) / 1000 : 0;

  const displayTree = useMemo(
    () =>
      buildDisplayTree(topicTree, {
        detailLevel,
        maxElementsPerLevel,
        sortBy,
        sizingMode,
        zoomedPath,
        accurateOthersSizes,
        elapsedSeconds,
      }),
    [topicTree, detailLevel, maxElementsPerLevel, sortBy, sizingMode, zoomedPath, accurateOthersSizes, elapsedSeconds]
  );

  const dark = theme === 'dark';
  const panelBg = dark ? 'bg-slate-900' : 'bg-slate-50';
  const text = dark ? 'text-slate-200' : 'text-slate-800';
  const dim = dark ? 'text-slate-400' : 'text-slate-500';
  const selectClass = `rounded border px-1.5 py-1 text-xs ${dark ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-slate-300 bg-white text-slate-800'}`;

  if (!isOpen) return null;

  return (
    <div
      className={`relative flex shrink-0 flex-col border-l ${dark ? 'border-slate-700' : 'border-slate-300'} ${panelBg} ${text} shadow-2xl`}
      style={{ width }}
    >
      <div
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-emerald-500/50 active:bg-emerald-500"
        onPointerDown={onPointerDown}
      />
      <div className={`flex items-center justify-between border-b px-4 py-3 ${dark ? 'border-slate-700' : 'border-slate-300'}`}>
        <div>
          <h2 className="font-semibold">Topic Explorer</h2>
          <p className={`text-xs ${dim}`}>Own colors/theme, independent of the dashboard's theme</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`rounded px-2 py-1 text-xs ${dark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300'}`}
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            title="Toggle this view's own light/dark theme"
          >
            {dark ? '☀︎ Light' : '☾ Dark'}
          </button>
          <button className={dim} onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div className={`border-b px-4 py-2 text-xs ${dark ? 'border-slate-700' : 'border-slate-300'} ${dim}`}>
        {!connectionConfig ? (
          <span>Connect to Solace first (Solace Connection panel).</span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              state: <span className={state === 'connected' ? 'text-emerald-400' : state === 'error' ? 'text-red-400' : ''}>{state}</span>
            </span>
            <span>msgs: {formatNumber(stats.totalMessages)}</span>
            <span>topics: {formatNumber(stats.uniqueTopics)}</span>
            <span>rate: {stats.messageRate.toFixed(1)}/s</span>
            {error && <span className="text-red-400">{error}</span>}
            <div className="ml-auto flex gap-1.5">
              <button
                className={`rounded px-2 py-0.5 ${dark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300'}`}
                onClick={() => (state === 'paused' ? resume() : pause())}
                disabled={state !== 'connected' && state !== 'paused'}
              >
                {state === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button className={`rounded px-2 py-0.5 ${dark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300'}`} onClick={reset}>
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={`flex flex-wrap items-center gap-2 border-b px-4 py-2 ${dark ? 'border-slate-700' : 'border-slate-300'}`}>
        <select className={selectClass} value={viewType} onChange={(e) => setViewType(e.target.value as SunburstViewType)}>
          <option value="sunburst">Sunburst</option>
          <option value="icicle">Icicle</option>
        </select>
        <select className={selectClass} value={sizingMode} onChange={(e) => setSizingMode(e.target.value as SunburstSizingMode)}>
          <option value="messages">Size: messages</option>
          <option value="bytes">Size: bytes</option>
          <option value="topics">Size: topics</option>
          <option value="equal">Size: equal</option>
        </select>
        <select className={selectClass} value={sortBy} onChange={(e) => setSortBy(e.target.value as TopicSortBy)}>
          <option value="messages">Sort: messages</option>
          <option value="bytes">Sort: bytes</option>
          <option value="topics">Sort: topics</option>
          <option value="busy">Sort: busy (msg/s)</option>
          <option value="lastArrival">Sort: last arrival</option>
          <option value="name">Sort: name</option>
          <option value="depth">Sort: depth</option>
        </select>
        <label className={`flex items-center gap-1 text-xs ${dim}`}>
          Detail
          <input type="range" min={1} max={10} value={detailLevel} onChange={(e) => setDetailLevel(Number(e.target.value))} className="w-16" />
          {detailLevel}
        </label>
        <label className={`flex items-center gap-1 text-xs ${dim}`}>
          Max/level
          <input
            type="range"
            min={5}
            max={30}
            value={maxElementsPerLevel}
            onChange={(e) => setMaxElementsPerLevel(Number(e.target.value))}
            className="w-16"
          />
          {maxElementsPerLevel}
        </label>
        <label className={`flex items-center gap-1 text-xs ${dim}`}>
          <input type="checkbox" checked={accurateOthersSizes} onChange={(e) => setAccurateOthersSizes(e.target.checked)} />
          True *OTHERS* size
        </label>
      </div>

      {/* `items-center justify-center` here (instead of `m-auto` on the
          child) would still center the chart when it fits, but flex
          centering has a well-known bug: once the child is TALLER than the
          container, centering pushes its top edge above the visible area,
          and that portion becomes permanently unreachable by scrolling
          (`overflow-auto` can't scroll to a negative offset). `m-auto` on the
          child instead: still centers when there's room, but degrades to a
          normal top-anchored, fully-scrollable overflow when the chart (now
          able to grow up to 640px) doesn't fit. */}
      <div className="flex flex-1 overflow-auto p-4">
        <div className="m-auto">
          <SunburstChart
            data={displayTree}
            width={chartSize}
            height={chartSize}
            sizingMode={sizingMode}
            viewType={viewType}
            theme={theme}
            accurateOthersSizes={accurateOthersSizes}
            onZoomChange={setZoomedPath}
          />
        </div>
      </div>
    </div>
  );
}
