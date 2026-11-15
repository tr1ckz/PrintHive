import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type DashboardWidgetId =
  | 'livePrinters'
  | 'healthSummary'
  | 'materialUsage'
  | 'queuePressure'
  | 'activityStream'
  | 'upcomingSchedule'
  | 'fleetAlerts'
  | 'failureWatch'
  | 'backgroundJobs'
  | 'mqttStatus';

export interface DashboardWidgetRegistryItem {
  id: DashboardWidgetId;
  title: string;
}

/**
 * One entry of the persisted layout. The dashboard is a content-sized flow
 * layout now, so only the ORDER matters — but the settings endpoint only
 * stores (and re-emits) react-grid-layout shaped items, so the order travels
 * inside that shape. See `encodeOrder` / `decodeOrder`.
 */
interface WireLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

type WireLayouts = Record<string, WireLayoutItem[]>;

export interface DashboardLayoutPreferences {
  version: number;
  layouts: WireLayouts;
  hiddenWidgetIds: DashboardWidgetId[];
}

interface UseDashboardLayoutOptions {
  storageKey?: string;
  backendState?: Partial<DashboardLayoutPreferences> | null;
  backendReady: boolean;
  onPersist?: (next: DashboardLayoutPreferences) => void;
  saveDebounceMs?: number;
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
};

function runWhenIdle(callback: () => void): void {
  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(callback, { timeout: 800 });
    return;
  }
  window.setTimeout(callback, 0);
}

/**
 * Default reading order. `healthSummary` (the stat strip) is pinned full-width
 * above the flow, so its position in this list is irrelevant.
 */
export const DEFAULT_WIDGET_ORDER: DashboardWidgetId[] = [
  'healthSummary',
  'livePrinters',
  'fleetAlerts',
  'activityStream',
  'upcomingSchedule',
  'materialUsage',
  'queuePressure',
  'backgroundJobs',
  'failureWatch',
  'mqttStatus',
];

/** Widgets rendered full-width above the flow; they can be hidden but not reordered. */
export const PINNED_WIDGET_IDS: DashboardWidgetId[] = ['healthSummary'];

const DEFAULT_HIDDEN_WIDGET_IDS: DashboardWidgetId[] = ['mqttStatus'];

export const dashboardWidgetRegistry: DashboardWidgetRegistryItem[] = [
  { id: 'healthSummary', title: 'Quick Stats' },
  { id: 'livePrinters', title: 'Printers' },
  { id: 'fleetAlerts', title: 'Needs Attention' },
  { id: 'activityStream', title: 'Recent Prints' },
  { id: 'upcomingSchedule', title: 'Maintenance' },
  { id: 'materialUsage', title: 'Material Usage' },
  { id: 'queuePressure', title: 'Queue Pressure' },
  { id: 'backgroundJobs', title: 'Background Jobs' },
  { id: 'failureWatch', title: 'Failure Watch' },
  { id: 'mqttStatus', title: 'MQTT Telemetry' },
];

const BREAKPOINT_KEYS = ['lg', 'md', 'sm', 'xs', 'xxs'] as const;

/**
 * Signature of a flow-order layout on the wire: every item is `w:12 h:2
 * minW:12 minH:2`. No layout saved by the old drag/resize grid can look like
 * this (its heights and minimums were always >= 4), so the marker cleanly
 * separates "order saved by this version" from "stale grid coordinates".
 */
const FLOW_W = 12;
const FLOW_H = 2;

const PREFERENCES_VERSION = 4;

function isWidgetId(value: string): value is DashboardWidgetId {
  return DEFAULT_WIDGET_ORDER.includes(value as DashboardWidgetId);
}

/** Dedupes, drops unknown ids, and appends any widget missing from the list. */
function normalizeOrder(input?: unknown): DashboardWidgetId[] {
  const out: DashboardWidgetId[] = [];
  if (Array.isArray(input)) {
    for (const rawId of input) {
      const id = String(rawId || '').trim();
      if (isWidgetId(id) && !out.includes(id)) {
        out.push(id);
      }
    }
  }
  for (const id of DEFAULT_WIDGET_ORDER) {
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

function normalizeHiddenIds(input?: unknown): DashboardWidgetId[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const out: DashboardWidgetId[] = [];
  for (const rawId of input) {
    const id = String(rawId || '').trim();
    if (!isWidgetId(id) || out.includes(id)) {
      continue;
    }
    out.push(id);
  }
  return out;
}

function encodeOrder(order: DashboardWidgetId[]): WireLayouts {
  const items: WireLayoutItem[] = order.map((id, index) => ({
    i: id,
    x: 0,
    y: index,
    w: FLOW_W,
    h: FLOW_H,
    minW: FLOW_W,
    minH: FLOW_H,
  }));

  const layouts: WireLayouts = {};
  for (const key of BREAKPOINT_KEYS) {
    layouts[key] = items;
  }
  return layouts;
}

/**
 * Reads the widget order out of a persisted layout. Returns null for anything
 * that is not a flow-order layout — legacy grid coordinates, the server's
 * generated defaults, or malformed data — so callers fall back to the default
 * order instead of trying to interpret stale positions.
 */
function decodeOrder(layouts: unknown): DashboardWidgetId[] | null {
  const list = (layouts as WireLayouts | null | undefined)?.lg;
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }

  const entries: Array<{ id: DashboardWidgetId; y: number }> = [];
  for (const item of list) {
    if (!item || typeof item.i !== 'string' || !isWidgetId(item.i)) {
      continue;
    }
    const isFlowItem = Number(item.w) === FLOW_W
      && Number(item.h) === FLOW_H
      && Number(item.minW) === FLOW_W
      && Number(item.minH) === FLOW_H;
    if (!isFlowItem) {
      return null;
    }
    entries.push({ id: item.i, y: Number(item.y) || 0 });
  }

  if (entries.length === 0) {
    return null;
  }

  entries.sort((a, b) => a.y - b.y);
  return normalizeOrder(entries.map((entry) => entry.id));
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

interface LocalState {
  order: DashboardWidgetId[];
  hiddenWidgetIds: DashboardWidgetId[];
}

function readLocalState(storageKey: string): LocalState | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DashboardLayoutPreferences>;
    const order = decodeOrder(parsed.layouts);
    if (!order) {
      return null;
    }
    return {
      order,
      hiddenWidgetIds: normalizeHiddenIds(parsed.hiddenWidgetIds),
    };
  } catch {
    return null;
  }
}

export function useDashboardLayout(options: UseDashboardLayoutOptions) {
  const {
    // New key: layouts saved by the old drag/resize grid are intentionally left behind.
    storageKey = 'printhive.command-center.layout.v6',
    backendState,
    backendReady,
    onPersist,
    saveDebounceMs = 800,
  } = options;

  const localState = useMemo(() => readLocalState(storageKey), [storageKey]);
  const [order, setOrder] = useState<DashboardWidgetId[]>(localState?.order || [...DEFAULT_WIDGET_ORDER]);
  const [hiddenWidgetIds, setHiddenWidgetIds] = useState<DashboardWidgetId[]>(localState?.hiddenWidgetIds || [...DEFAULT_HIDDEN_WIDGET_IDS]);
  const orderRef = useRef(order);
  const hiddenWidgetIdsRef = useRef(hiddenWidgetIds);

  const didHydrateBackendRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const onPersistRef = useRef(onPersist);
  const lastPersistSignatureRef = useRef('');

  const buildPayload = useCallback((nextOrder: DashboardWidgetId[], nextHiddenWidgetIds: DashboardWidgetId[]): DashboardLayoutPreferences => ({
    version: PREFERENCES_VERSION,
    layouts: encodeOrder(nextOrder),
    hiddenWidgetIds: nextHiddenWidgetIds,
  }), []);

  useEffect(() => {
    onPersistRef.current = onPersist;
  }, [onPersist]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    hiddenWidgetIdsRef.current = hiddenWidgetIds;
  }, [hiddenWidgetIds]);

  useEffect(() => {
    if (!backendReady || didHydrateBackendRef.current) {
      return;
    }

    if (backendState) {
      const backendOrder = decodeOrder(backendState.layouts);
      const backendHiddenIds = normalizeHiddenIds(backendState.hiddenWidgetIds);

      if (backendOrder) {
        // Saved by this version: the server copy wins over this browser's cache.
        orderRef.current = backendOrder;
        hiddenWidgetIdsRef.current = backendHiddenIds;
        setOrder(backendOrder);
        setHiddenWidgetIds(backendHiddenIds);
      } else if (!localState) {
        // Legacy grid layout (or server defaults): positions are discarded, but
        // the user's show/hide choices still mean something, so keep those.
        hiddenWidgetIdsRef.current = backendHiddenIds;
        setHiddenWidgetIds(backendHiddenIds);
      }
    }

    didHydrateBackendRef.current = true;
  }, [backendReady, backendState, localState]);

  useEffect(() => {
    const payload = buildPayload(order, hiddenWidgetIds);
    const payloadSignature = JSON.stringify(payload);

    try {
      window.localStorage.setItem(storageKey, payloadSignature);
    } catch {
      // Ignore storage errors and continue with in-memory layout.
    }

    if (!backendReady || !didHydrateBackendRef.current || !onPersistRef.current) {
      return;
    }

    if (!lastPersistSignatureRef.current) {
      lastPersistSignatureRef.current = payloadSignature;
      return;
    }

    if (lastPersistSignatureRef.current === payloadSignature) {
      return;
    }

    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = window.setTimeout(() => {
      lastPersistSignatureRef.current = payloadSignature;
      runWhenIdle(() => {
        onPersistRef.current?.(payload);
      });
    }, saveDebounceMs);

    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [order, hiddenWidgetIds, storageKey, backendReady, saveDebounceMs, buildPayload]);

  /** Visible widgets in user order (pinned widgets included). */
  const visibleWidgetIds = useMemo(
    () => order.filter((id) => !hiddenWidgetIds.includes(id)),
    [order, hiddenWidgetIds]
  );

  /**
   * Moves a widget one step earlier/later among the VISIBLE, reorderable
   * widgets — hidden and pinned ones are skipped over so every click produces
   * a change the user can see.
   */
  const moveWidget = useCallback((widgetId: DashboardWidgetId, direction: -1 | 1) => {
    setOrder((current) => {
      const hidden = hiddenWidgetIdsRef.current;
      const movable = current.filter((id) => !hidden.includes(id) && !PINNED_WIDGET_IDS.includes(id));
      const from = movable.indexOf(widgetId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= movable.length) {
        return current;
      }

      const swapWith = movable[to];
      const next = [...current];
      const a = next.indexOf(widgetId);
      const b = next.indexOf(swapWith);
      next[a] = swapWith;
      next[b] = widgetId;
      orderRef.current = next;
      return next;
    });
  }, []);

  const hideWidget = useCallback((widgetId: DashboardWidgetId) => {
    setHiddenWidgetIds((current) => {
      if (current.includes(widgetId)) return current;
      const next = [...current, widgetId];
      hiddenWidgetIdsRef.current = next;
      return next;
    });
  }, []);

  const showWidget = useCallback((widgetId: DashboardWidgetId) => {
    setHiddenWidgetIds((current) => {
      const next = current.filter((id) => id !== widgetId);
      hiddenWidgetIdsRef.current = next;
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    orderRef.current = [...DEFAULT_WIDGET_ORDER];
    hiddenWidgetIdsRef.current = [...DEFAULT_HIDDEN_WIDGET_IDS];
    setOrder([...DEFAULT_WIDGET_ORDER]);
    setHiddenWidgetIds([...DEFAULT_HIDDEN_WIDGET_IDS]);
  }, []);

  const isDefaultLayout = arraysEqual(order, DEFAULT_WIDGET_ORDER)
    && arraysEqual([...hiddenWidgetIds].sort(), [...DEFAULT_HIDDEN_WIDGET_IDS].sort());

  const flushPersist = useCallback(() => {
    const payload = buildPayload(orderRef.current, hiddenWidgetIdsRef.current);
    const payloadSignature = JSON.stringify(payload);

    try {
      window.localStorage.setItem(storageKey, payloadSignature);
    } catch {
      // Ignore storage errors and continue with in-memory layout.
    }

    if (!backendReady || !didHydrateBackendRef.current || !onPersistRef.current) {
      lastPersistSignatureRef.current = payloadSignature;
      return;
    }

    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    if (lastPersistSignatureRef.current === payloadSignature) {
      return;
    }

    lastPersistSignatureRef.current = payloadSignature;
    onPersistRef.current(payload);
  }, [storageKey, backendReady, buildPayload]);

  return {
    widgetRegistry: dashboardWidgetRegistry,
    order,
    hiddenWidgetIds,
    visibleWidgetIds,
    isDefaultLayout,
    moveWidget,
    hideWidget,
    showWidget,
    resetLayout,
    flushPersist,
  };
}

export default useDashboardLayout;
