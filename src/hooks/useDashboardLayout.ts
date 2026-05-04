import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, ResponsiveLayouts } from 'react-grid-layout/legacy';

type Layouts = ResponsiveLayouts;

export type DashboardWidgetId =
  | 'livePrinters'
  | 'healthSummary'
  | 'activityStream'
  | 'heatmap'
  | 'storageTrend'
  | 'upcomingSchedule'
  | 'queuePressure'
  | 'backupTelemetry'
  | 'duplicatePressure'
  | 'backgroundJobs';

export interface DashboardWidgetRegistryItem {
  id: DashboardWidgetId;
  title: string;
}

export interface DashboardLayoutPreferences {
  version: number;
  layouts: Layouts;
  hiddenWidgetIds: DashboardWidgetId[];
}

interface UseDashboardLayoutOptions {
  storageKey?: string;
  backendState?: Partial<DashboardLayoutPreferences> | null;
  backendReady: boolean;
  onPersist?: (next: DashboardLayoutPreferences) => void;
  saveDebounceMs?: number;
}

type SnapProfile = {
  widths: number[];
  heights: number[];
};

const DASHBOARD_WIDGET_IDS: DashboardWidgetId[] = [
  'livePrinters',
  'healthSummary',
  'backgroundJobs',
  'activityStream',
  'heatmap',
  'storageTrend',
  'upcomingSchedule',
  'queuePressure',
  'backupTelemetry',
  'duplicatePressure',
];

export const dashboardWidgetRegistry: DashboardWidgetRegistryItem[] = [
  { id: 'livePrinters', title: 'Live Printers' },
  { id: 'healthSummary', title: 'Health Summary' },
  { id: 'backgroundJobs', title: 'Background Jobs' },
  { id: 'activityStream', title: 'Activity Stream' },
  { id: 'heatmap', title: 'Heatmap' },
  { id: 'storageTrend', title: 'Storage Trend' },
  { id: 'upcomingSchedule', title: 'Upcoming Schedule' },
  { id: 'queuePressure', title: 'Queue Pressure' },
  { id: 'backupTelemetry', title: 'Backup Telemetry' },
  { id: 'duplicatePressure', title: 'Duplicate Pressure' },
];

export const defaultDashboardLayouts: Layouts = {
  lg: [
    { i: 'livePrinters', x: 0, y: 0, w: 5, h: 6, minW: 4, minH: 5 },
    { i: 'healthSummary', x: 5, y: 0, w: 3, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 8, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'backupTelemetry', x: 5, y: 5, w: 3, h: 5, minW: 3, minH: 4 },
    { i: 'backgroundJobs', x: 8, y: 5, w: 4, h: 6, minW: 3, minH: 5 },
    { i: 'activityStream', x: 0, y: 6, w: 7, h: 8, minW: 5, minH: 6 },
    { i: 'storageTrend', x: 7, y: 11, w: 5, h: 8, minW: 4, minH: 6 },
    { i: 'heatmap', x: 0, y: 14, w: 7, h: 6, minW: 4, minH: 5 },
    { i: 'upcomingSchedule', x: 7, y: 19, w: 5, h: 6, minW: 4, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 20, w: 7, h: 5, minW: 4, minH: 4 },
  ],
  md: [
    { i: 'livePrinters', x: 0, y: 0, w: 10, h: 6, minW: 4, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 5, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 5, y: 6, w: 5, h: 5, minW: 3, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 11, w: 5, h: 5, minW: 3, minH: 4 },
    { i: 'backgroundJobs', x: 5, y: 11, w: 5, h: 6, minW: 3, minH: 5 },
    { i: 'activityStream', x: 0, y: 17, w: 10, h: 8, minW: 5, minH: 6 },
    { i: 'storageTrend', x: 0, y: 25, w: 10, h: 8, minW: 5, minH: 6 },
    { i: 'heatmap', x: 0, y: 33, w: 10, h: 6, minW: 4, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 39, w: 10, h: 6, minW: 4, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 45, w: 10, h: 5, minW: 4, minH: 4 },
  ],
  sm: [
    { i: 'livePrinters', x: 0, y: 0, w: 6, h: 6, minW: 3, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 0, y: 11, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 16, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'backgroundJobs', x: 0, y: 21, w: 6, h: 6, minW: 3, minH: 5 },
    { i: 'activityStream', x: 0, y: 27, w: 6, h: 8, minW: 4, minH: 6 },
    { i: 'storageTrend', x: 0, y: 35, w: 6, h: 8, minW: 4, minH: 6 },
    { i: 'heatmap', x: 0, y: 43, w: 6, h: 6, minW: 4, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 49, w: 6, h: 6, minW: 4, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 55, w: 6, h: 5, minW: 4, minH: 4 },
  ],
  xs: [
    { i: 'livePrinters', x: 0, y: 0, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'queuePressure', x: 0, y: 11, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 16, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'backgroundJobs', x: 0, y: 21, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'activityStream', x: 0, y: 27, w: 4, h: 8, minW: 2, minH: 6 },
    { i: 'storageTrend', x: 0, y: 35, w: 4, h: 8, minW: 2, minH: 6 },
    { i: 'heatmap', x: 0, y: 43, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 49, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 55, w: 4, h: 5, minW: 2, minH: 4 },
  ],
  xxs: [
    { i: 'livePrinters', x: 0, y: 0, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'queuePressure', x: 0, y: 11, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 16, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'backgroundJobs', x: 0, y: 21, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'activityStream', x: 0, y: 27, w: 2, h: 8, minW: 2, minH: 6 },
    { i: 'storageTrend', x: 0, y: 35, w: 2, h: 8, minW: 2, minH: 6 },
    { i: 'heatmap', x: 0, y: 43, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 49, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 55, w: 2, h: 5, minW: 2, minH: 4 },
  ],
};

const BREAKPOINT_ORDER: Array<keyof Layouts> = ['lg', 'md', 'sm', 'xs', 'xxs'];
const BREAKPOINT_COLUMNS: Record<keyof Layouts, number> = {
  lg: 12,
  md: 10,
  sm: 6,
  xs: 4,
  xxs: 2,
};

const DEFAULT_SNAP_PROFILE: SnapProfile = {
  widths: [2, 3, 4, 5, 6, 7, 8, 10, 12],
  heights: [4, 5, 6, 7, 8, 10, 12],
};

const WIDGET_SNAP_PROFILES: Record<DashboardWidgetId, SnapProfile> = {
  livePrinters: { widths: [4, 5, 6, 8, 10, 12], heights: [5, 6, 7, 8, 10] },
  healthSummary: { widths: [3, 4, 5, 6], heights: [4, 5, 6, 7] },
  backgroundJobs: { widths: [3, 4, 5, 6], heights: [5, 6, 7, 8] },
  activityStream: { widths: [4, 6, 8, 10, 12], heights: [6, 8, 10, 12] },
  heatmap: { widths: [4, 6, 7, 8, 10, 12], heights: [5, 6, 7, 8] },
  storageTrend: { widths: [4, 6, 8, 10, 12], heights: [6, 8, 10] },
  upcomingSchedule: { widths: [4, 5, 6, 7, 8], heights: [5, 6, 7, 8, 10] },
  queuePressure: { widths: [3, 4, 5, 6], heights: [4, 5, 6, 7] },
  backupTelemetry: { widths: [3, 4, 5, 6], heights: [4, 5, 6, 7] },
  duplicatePressure: { widths: [3, 4, 5, 6, 7, 8], heights: [4, 5, 6, 7] },
};

function isWidgetId(value: string): value is DashboardWidgetId {
  return DASHBOARD_WIDGET_IDS.includes(value as DashboardWidgetId);
}

function parseNumber(input: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(input), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function nearestSnap(value: number, options: number[], fallback: number): number {
  if (!options.length) return fallback;
  let best = options[0];
  let bestDistance = Math.abs(options[0] - value);
  for (let index = 1; index < options.length; index += 1) {
    const distance = Math.abs(options[index] - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = options[index];
    }
  }
  return best;
}

function sanitizeLayoutItem(item: Partial<Layout>, fallback: Layout): Layout {
  const snapProfile = isWidgetId(fallback.i) ? WIDGET_SNAP_PROFILES[fallback.i] : DEFAULT_SNAP_PROFILE;
  const minW = parseNumber(item.minW, fallback.minW || 1, 1, 24);
  const minH = parseNumber(item.minH, fallback.minH || 2, 2, 24);
  const rawW = parseNumber(item.w, fallback.w, minW, 24);
  const rawH = parseNumber(item.h, fallback.h, minH, 24);

  return {
    i: fallback.i,
    x: parseNumber(item.x, fallback.x, 0, 24),
    y: parseNumber(item.y, fallback.y, 0, 999),
    w: Math.max(minW, nearestSnap(rawW, snapProfile.widths, fallback.w)),
    h: Math.max(minH, nearestSnap(rawH, snapProfile.heights, fallback.h)),
    minW,
    minH,
  };
}

function intersects(a: Layout, b: Layout): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function resolveCollisions(items: Layout[], columns: number): Layout[] {
  const sorted = [...items].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.i.localeCompare(b.i);
  });

  const placed: Layout[] = [];

  for (const rawItem of sorted) {
    const next: Layout = {
      ...rawItem,
      w: Math.max(1, Math.min(rawItem.w, columns)),
      x: Math.max(0, Math.min(rawItem.x, Math.max(0, columns - Math.min(rawItem.w, columns)))),
      y: Math.max(0, rawItem.y),
    };

    while (placed.some((existing) => intersects(existing, next))) {
      next.y += 1;
    }

    placed.push(next);
  }

  return placed;
}

function normalizeLayouts(input?: Partial<Layouts> | null): Layouts {
  const next: Layouts = {};

  BREAKPOINT_ORDER.forEach((breakpoint) => {
    const columns = BREAKPOINT_COLUMNS[breakpoint];
    const defaults = defaultDashboardLayouts[breakpoint] || [];
    const defaultMap = new Map<string, Layout>(defaults.map((item) => [item.i, { ...item }]));
    const incoming = input?.[breakpoint];

    if (Array.isArray(incoming)) {
      for (const item of incoming) {
        if (!item || typeof item.i !== 'string' || !isWidgetId(item.i)) {
          continue;
        }
        const fallback = defaultMap.get(item.i) || {
          i: item.i,
          x: 0,
          y: 0,
          w: 4,
          h: 4,
          minW: 2,
          minH: 2,
        };
        defaultMap.set(item.i, sanitizeLayoutItem(item, fallback));
      }
    }

    const ordered = DASHBOARD_WIDGET_IDS.map((id) => {
      const fallback = defaults.find((entry) => entry.i === id) || {
        i: id,
        x: 0,
        y: 0,
        w: 4,
        h: 4,
        minW: 2,
        minH: 2,
      };
      return defaultMap.get(id) || fallback;
    });

    next[breakpoint] = resolveCollisions(ordered, columns);
  });

  return next;
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

function readLocalState(storageKey: string): DashboardLayoutPreferences | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DashboardLayoutPreferences>;
    return {
      version: 2,
      layouts: normalizeLayouts(parsed.layouts),
      hiddenWidgetIds: normalizeHiddenIds(parsed.hiddenWidgetIds),
    };
  } catch {
    return null;
  }
}

export function useDashboardLayout(options: UseDashboardLayoutOptions) {
  const {
    storageKey = 'printhive.command-center.layout.v3',
    backendState,
    backendReady,
    onPersist,
    saveDebounceMs = 800,
  } = options;

  const localState = useMemo(() => readLocalState(storageKey), [storageKey]);
  const [layouts, setLayouts] = useState<Layouts>(localState?.layouts || normalizeLayouts(defaultDashboardLayouts));
  const [hiddenWidgetIds, setHiddenWidgetIds] = useState<DashboardWidgetId[]>(localState?.hiddenWidgetIds || []);

  const didHydrateBackendRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!backendReady || didHydrateBackendRef.current) {
      return;
    }

    if (backendState) {
      setLayouts(normalizeLayouts(backendState.layouts));
      setHiddenWidgetIds(normalizeHiddenIds(backendState.hiddenWidgetIds));
    }

    didHydrateBackendRef.current = true;
  }, [backendReady, backendState]);

  useEffect(() => {
    const payload: DashboardLayoutPreferences = {
      version: 2,
      layouts,
      hiddenWidgetIds,
    };

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage errors and continue with in-memory layout.
    }

    if (!backendReady || !didHydrateBackendRef.current || !onPersist) {
      return;
    }

    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = window.setTimeout(() => {
      onPersist(payload);
    }, saveDebounceMs);

    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [layouts, hiddenWidgetIds, storageKey, backendReady, saveDebounceMs, onPersist]);

  const visibleWidgetIds = useMemo(
    () => DASHBOARD_WIDGET_IDS.filter((id) => !hiddenWidgetIds.includes(id)),
    [hiddenWidgetIds]
  );

  const visibleLayouts = useMemo(() => {
    const visibleSet = new Set(visibleWidgetIds);
    const next: Layouts = {};
    BREAKPOINT_ORDER.forEach((breakpoint) => {
      next[breakpoint] = (layouts[breakpoint] || []).filter((entry) => visibleSet.has(entry.i as DashboardWidgetId));
    });
    return next;
  }, [layouts, visibleWidgetIds]);

  const handleLayoutsChange = useCallback((nextLayouts: Layouts) => {
    setLayouts(normalizeLayouts(nextLayouts));
  }, []);

  const snapBreakpointLayout = useCallback((breakpoint: keyof Layouts, incomingLayout: Layout[]) => {
    setLayouts((current) => {
      const existing = current[breakpoint] || [];
      const byId = new Map<string, Layout>(existing.map((item) => [item.i, item]));

      for (const item of incomingLayout) {
        if (!item || typeof item.i !== 'string' || !isWidgetId(item.i)) {
          continue;
        }
        const fallback = byId.get(item.i) || {
          i: item.i,
          x: 0,
          y: 0,
          w: 4,
          h: 4,
          minW: 2,
          minH: 2,
        };
        byId.set(item.i, sanitizeLayoutItem(item, fallback));
      }

      return normalizeLayouts({
        ...current,
        [breakpoint]: Array.from(byId.values()),
      });
    });
  }, []);

  const hideWidget = useCallback((widgetId: DashboardWidgetId) => {
    setHiddenWidgetIds((current) => {
      if (current.includes(widgetId)) return current;
      return [...current, widgetId];
    });
  }, []);

  const showWidget = useCallback((widgetId: DashboardWidgetId) => {
    setHiddenWidgetIds((current) => current.filter((id) => id !== widgetId));
  }, []);

  const setAllVisible = useCallback(() => {
    setHiddenWidgetIds([]);
  }, []);

  const snapAllWidgets = useCallback(() => {
    setLayouts((current) => normalizeLayouts(current));
  }, []);

  return {
    widgetRegistry: dashboardWidgetRegistry,
    layouts,
    visibleLayouts,
    hiddenWidgetIds,
    visibleWidgetIds,
    handleLayoutsChange,
    snapBreakpointLayout,
    hideWidget,
    showWidget,
    setAllVisible,
    snapAllWidgets,
  };
}

export default useDashboardLayout;
