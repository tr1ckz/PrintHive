import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Layouts } from 'react-grid-layout';

export type DashboardWidgetId =
  | 'healthSummary'
  | 'activityStream'
  | 'heatmap'
  | 'storageTrend'
  | 'upcomingSchedule'
  | 'queuePressure'
  | 'backupTelemetry';

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
  'healthSummary',
  'activityStream',
  'heatmap',
  'storageTrend',
  'upcomingSchedule',
  'queuePressure',
  'backupTelemetry',
];

export const dashboardWidgetRegistry: DashboardWidgetRegistryItem[] = [
  { id: 'healthSummary', title: 'Health Summary' },
  { id: 'activityStream', title: 'Activity Stream' },
  { id: 'heatmap', title: 'Heatmap' },
  { id: 'storageTrend', title: 'Storage Trend' },
  { id: 'upcomingSchedule', title: 'Upcoming Schedule' },
  { id: 'queuePressure', title: 'Queue Pressure' },
  { id: 'backupTelemetry', title: 'Backup Telemetry' },
];

export const defaultDashboardLayouts: Layouts = {
  lg: [
    { i: 'healthSummary', x: 0, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 4, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'backupTelemetry', x: 8, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'activityStream', x: 0, y: 5, w: 6, h: 8, minW: 4, minH: 5 },
    { i: 'storageTrend', x: 6, y: 5, w: 6, h: 8, minW: 4, minH: 5 },
    { i: 'heatmap', x: 0, y: 13, w: 7, h: 6, minW: 4, minH: 4 },
    { i: 'upcomingSchedule', x: 7, y: 13, w: 5, h: 6, minW: 4, minH: 4 },
  ],
  md: [
    { i: 'healthSummary', x: 0, y: 0, w: 5, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 5, y: 0, w: 5, h: 5, minW: 3, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 5, w: 10, h: 5, minW: 3, minH: 4 },
    { i: 'activityStream', x: 0, y: 10, w: 10, h: 8, minW: 4, minH: 5 },
    { i: 'storageTrend', x: 0, y: 18, w: 10, h: 8, minW: 4, minH: 5 },
    { i: 'heatmap', x: 0, y: 26, w: 10, h: 6, minW: 4, minH: 4 },
    { i: 'upcomingSchedule', x: 0, y: 32, w: 10, h: 6, minW: 4, minH: 4 },
  ],
  sm: [
    { i: 'healthSummary', x: 0, y: 0, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 0, y: 5, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 10, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'activityStream', x: 0, y: 15, w: 6, h: 8, minW: 4, minH: 5 },
    { i: 'storageTrend', x: 0, y: 23, w: 6, h: 8, minW: 4, minH: 5 },
    { i: 'heatmap', x: 0, y: 31, w: 6, h: 6, minW: 4, minH: 4 },
    { i: 'upcomingSchedule', x: 0, y: 37, w: 6, h: 6, minW: 4, minH: 4 },
  ],
  xs: [
    { i: 'healthSummary', x: 0, y: 0, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'queuePressure', x: 0, y: 5, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 10, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'activityStream', x: 0, y: 15, w: 4, h: 8, minW: 2, minH: 5 },
    { i: 'storageTrend', x: 0, y: 23, w: 4, h: 8, minW: 2, minH: 5 },
    { i: 'heatmap', x: 0, y: 31, w: 4, h: 6, minW: 2, minH: 4 },
    { i: 'upcomingSchedule', x: 0, y: 37, w: 4, h: 6, minW: 2, minH: 4 },
  ],
  xxs: [
    { i: 'healthSummary', x: 0, y: 0, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'queuePressure', x: 0, y: 5, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 10, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'activityStream', x: 0, y: 15, w: 2, h: 8, minW: 2, minH: 5 },
    { i: 'storageTrend', x: 0, y: 23, w: 2, h: 8, minW: 2, minH: 5 },
    { i: 'heatmap', x: 0, y: 31, w: 2, h: 6, minW: 2, minH: 4 },
    { i: 'upcomingSchedule', x: 0, y: 37, w: 2, h: 6, minW: 2, minH: 4 },
  ],
};

const BREAKPOINT_ORDER: Array<keyof Layouts> = ['lg', 'md', 'sm', 'xs', 'xxs'];

const DEFAULT_SNAP_PROFILE: SnapProfile = {
  widths: [2, 3, 4, 5, 6, 7, 8, 10, 12],
  heights: [4, 5, 6, 7, 8, 10, 12],
};

const WIDGET_SNAP_PROFILES: Record<DashboardWidgetId, SnapProfile> = {
  healthSummary: { widths: [3, 4, 5, 6], heights: [4, 5, 6, 7] },
  activityStream: { widths: [4, 6, 8, 10, 12], heights: [6, 8, 10, 12] },
  heatmap: { widths: [4, 6, 7, 8, 10, 12], heights: [5, 6, 7, 8] },
  storageTrend: { widths: [4, 6, 8, 10, 12], heights: [6, 8, 10] },
  upcomingSchedule: { widths: [4, 5, 6, 7, 8], heights: [5, 6, 7, 8, 10] },
  queuePressure: { widths: [3, 4, 5, 6], heights: [4, 5, 6, 7] },
  backupTelemetry: { widths: [3, 4, 5, 6], heights: [4, 5, 6, 7] },
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

function normalizeLayouts(input?: Partial<Layouts> | null): Layouts {
  const next: Layouts = {};

  BREAKPOINT_ORDER.forEach((breakpoint) => {
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

    next[breakpoint] = ordered;
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
    storageKey = 'printhive.command-center.layout.v2',
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
    hideWidget,
    showWidget,
    setAllVisible,
    snapAllWidgets,
  };
}

export default useDashboardLayout;
