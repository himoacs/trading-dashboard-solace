import { useCallback, useEffect, useRef, useState } from 'react';

interface UseResizablePanelOptions {
  defaultWidth: number;
  min: number;
  max: number;
  /** Which side of the panel the drag handle sits on - determines which
   * direction of pointer movement means "wider" for that panel's anchor side. */
  edge: 'left' | 'right';
  /** localStorage key the width is persisted under. */
  storageKey: string;
}

function loadStored(key: string, fallback: number, min: number, max: number): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) return Math.min(max, Math.max(min, parsed));
    }
  } catch {
    // ignore
  }
  return fallback;
}

/** Drag-to-resize for a fixed-side panel. Returns the current width and a
 * pointerdown handler for the drag handle - plain pointer events + window
 * listeners while dragging, not React state on every frame, so a fast drag
 * doesn't trigger a cascade of re-renders beyond the one that actually
 * changes displayed width. */
export function useResizablePanel({ defaultWidth, min, max, edge, storageKey }: UseResizablePanelOptions) {
  const [width, setWidth] = useState(() => loadStored(storageKey, defaultWidth, min, max));
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      // ignore storage errors
    }
  }, [width, storageKey]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragState.current = { startX: e.clientX, startWidth: width };

      const onMove = (ev: PointerEvent) => {
        if (!dragState.current) return;
        const delta = ev.clientX - dragState.current.startX;
        const signedDelta = edge === 'right' ? delta : -delta;
        setWidth(Math.min(max, Math.max(min, dragState.current.startWidth + signedDelta)));
      };
      const onUp = () => {
        dragState.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width, edge, min, max]
  );

  return { width, onPointerDown };
}
