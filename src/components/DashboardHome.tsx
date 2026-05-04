import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout, ResponsiveLayouts, Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { LayoutGrid, Plus } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import useDashboardLayout, { DashboardLayoutPreferences, dashboardWidgetRegistry } from '../hooks/useDashboardLayout';
import WidgetShell from './dashboard/WidgetShell';
import QuickStatsWidget from './dashboard/widgets/QuickStatsWidget';
import ActivityStreamWidget, { ActivityRow } from './dashboard/widgets/ActivityStreamWidget';
import UpcomingScheduleWidget, { ScheduleItem } from './dashboard/widgets/UpcomingScheduleWidget';
import LivePrintersWidget, { LivePrinterRow } from './dashboard/widgets/LivePrintersWidget';
import BackgroundJobsWidget, { BackgroundJobRow } from './dashboard/widgets/BackgroundJobsWidget';
import FailureWatchWidget, { FailureWatchRow } from './dashboard/widgets/FailureWatchWidget';
import FleetAlertsWidget, { FleetAlertsData } from './dashboard/widgets/FleetAlertsWidget';
import PrintStatusMqttWidget, { MqttPrinterRow } from './dashboard/widgets/PrintStatusMqttWidget';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './DashboardHome.css';

interface DashboardHomeProps {
  onNavigate: (tab: string) => void;
}

interface PrinterStatus {
  id: string;
  name: string;
  model: string;
  status: string;
  progress?: number;
  currentPrint?: string;
  online: boolean;
  mqttConnected?: boolean;
  nozzleTemp?: number;
  bedTemp?: number;
}

interface PrinterStatusResponse {
  printers: PrinterStatus[];
  online: number;
  total: number;
}

interface StatisticsResponse {
  totalPrints: number;
  successRate: number;
  failedPrints: number;
  totalWeight: number;
  totalTime: number;
}

interface PrintActivityApiRow {
  id: number;
  modelId?: string;
  title: string;
  cover?: string | null;
  status: number;
  startTime?: string;
  deviceName?: string;
  weight?: number;
  costTime?: number;
}

interface MaintenanceTask {
  id: number;
  task_name: string;
  printer_name?: string | null;
  printer_id?: string | null;
  hours_until_due?: number | null;
  isOverdue?: boolean;
}

interface BackgroundJobStatusResponse {
  jobs?: Array<{
    id: string;
    name: string;
    running?: boolean;
    total?: number;
    processed?: number;
    completed?: number;
    failed?: number;
  }>;
  running?: boolean;
  total?: number;
  processed?: number;
  completed?: number;
  matched?: number;
  added?: number;
  deleted?: number;
  failed?: number;
  unmatched?: number;
  skipped?: number;
}

const BREAKPOINTS = { lg: 1320, md: 1100, sm: 860, xs: 620, xxs: 0 } as const;
const COLUMNS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 } as const;
type Breakpoint = keyof typeof BREAKPOINTS;
const ResponsiveGridLayout = WidthProvider(Responsive);

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await fetchWithRetry(url, { credentials: 'include' }, {
      maxRetries: 1,
      delayMs: 400,
      backoffMultiplier: 1.5,
      timeoutMs: 10000,
    });
    if (!response.ok) {
      return fallback;
    }
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatDateLabel(input?: string): string {
  if (!input) return 'Unknown';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString();
}

function mapStatus(status: number): string {
  if (status === 2) return 'Success';
  if (status === 3) return 'Failed';
  if (status === 1 || status === 4) return 'Running';
  return 'Unknown';
}

function widgetDensity(layouts: Record<string, Array<{ i: string; w?: number; h?: number }>>, breakpoint: string, id: string): 'compact' | 'comfortable' | 'expanded' {
  const entry = (layouts[breakpoint] || []).find((l) => l.i === id);
  const area = (entry?.w || 4) * (entry?.h || 5);
  return area <= 24 ? 'compact' : area <= 42 ? 'comfortable' : 'expanded';
}

function DashboardHome({ onNavigate }: DashboardHomeProps) {
  const [isEditMode, setIsEditMode] = useState(true);
  const [showWidgetLibrary, setShowWidgetLibrary] = useState(false);
  const [currentBreakpoint, setCurrentBreakpoint] = useState<Breakpoint>('lg');
  const [isPageVisible, setIsPageVisible] = useState<boolean>(() => (
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  ));

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const printersQuery = useQuery({
    queryKey: ['dashboard', 'printers'],
    queryFn: () => fetchJson<PrinterStatusResponse>(API_ENDPOINTS.PRINTERS.STATUS, { printers: [], online: 0, total: 0 }),
    staleTime: 15000,
    refetchInterval: isPageVisible ? 45000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const statsQuery = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => fetchJson<StatisticsResponse>(API_ENDPOINTS.STATISTICS.HISTORY, { totalPrints: 0, successRate: 0, failedPrints: 0, totalWeight: 0, totalTime: 0 }),
    staleTime: 30000,
    refetchInterval: isPageVisible ? 120000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const activityQuery = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => fetchJson<PrintActivityApiRow[]>(`${API_ENDPOINTS.PRINTS.LIST}?limit=40`, []),
    staleTime: 30000,
    refetchInterval: isPageVisible ? 90000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const maintenanceQuery = useQuery({
    queryKey: ['dashboard', 'maintenance'],
    queryFn: () => fetchJson<MaintenanceTask[]>(API_ENDPOINTS.MAINTENANCE.LIST, []),
    staleTime: 30000,
    refetchInterval: isPageVisible ? 120000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const libraryQuery = useQuery({
    queryKey: ['dashboard', 'library'],
    queryFn: async () => {
      const data = await fetchJson<unknown>(API_ENDPOINTS.LIBRARY.LIST, []);
      if (Array.isArray(data)) return data;
      if (Array.isArray((data as { files?: unknown[] })?.files)) return (data as { files: unknown[] }).files;
      return [];
    },
    staleTime: 60000,
    refetchInterval: isPageVisible ? 180000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const dashboardLayoutSettingsQuery = useQuery({
    queryKey: ['dashboard', 'layout-settings'],
    queryFn: async () => {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DASHBOARD_WIDGETS, { credentials: 'include' });
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return (data?.preferences || null) as Partial<DashboardLayoutPreferences> | null;
    },
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const persistDashboardLayout = useMutation({
    mutationFn: async (payload: DashboardLayoutPreferences) => {
      await fetchWithRetry(API_ENDPOINTS.SETTINGS.DASHBOARD_WIDGETS, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
  });

  const handlePersistDashboardLayout = useCallback((next: DashboardLayoutPreferences) => {
    persistDashboardLayout.mutate(next);
  }, [persistDashboardLayout]);

  const {
    visibleWidgetIds,
    hiddenWidgetIds,
    visibleLayouts,
    snapBreakpointLayout,
    showWidget,
    hideWidget,
    snapAllWidgets,
    handleLayoutsChange,
  } = useDashboardLayout({
    backendState: dashboardLayoutSettingsQuery.data,
    backendReady: dashboardLayoutSettingsQuery.isFetched || dashboardLayoutSettingsQuery.isError,
    onPersist: handlePersistDashboardLayout,
  });

  const shouldPollBackgroundJobs = isPageVisible && visibleWidgetIds.includes('backgroundJobs');

  const backgroundJobsQuery = useQuery({
    queryKey: ['dashboard', 'background-jobs-summary'],
    queryFn: async (): Promise<BackgroundJobRow[]> => {
      const data = await fetchJson<BackgroundJobStatusResponse>(API_ENDPOINTS.SYSTEM.BACKGROUND_JOBS_SUMMARY, { jobs: [] });
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];

      return jobs
        .map((job) => ({
          id: job.id,
          name: job.name,
          running: Boolean(job.running),
          processed: Number(job.processed || 0),
          total: Number(job.total || 0),
          completed: Number(job.completed || 0),
          failed: Number(job.failed || 0),
        } as BackgroundJobRow))
        .filter((job) => job.running);
    },
    enabled: shouldPollBackgroundJobs,
    staleTime: 20000,
    refetchInterval: shouldPollBackgroundJobs ? 25000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const printers = printersQuery.data?.printers || [];
  const stats = statsQuery.data;
  const activityRaw = useMemo(() => {
    const value = activityQuery.data;
    return Array.isArray(value) ? value : [];
  }, [activityQuery.data]);

  const quickStats = useMemo(() => {
    const onlinePrinters = printers.filter((printer) => printer.online).length;
    const activeJobs = printers.filter((printer) => printer.online && printer.currentPrint).length;

    return {
      printersOnlineLabel: `${onlinePrinters}/${printers.length || 0}`,
      totalPrints: Number(stats?.totalPrints || 0),
      successRate: Math.round(stats?.successRate || 0),
      libraryModels: Number(libraryQuery.data?.length || 0),
      activeJobs,
    };
  }, [printers, libraryQuery.data, maintenanceQuery.data, stats]);

  const activityRows = useMemo<ActivityRow[]>(() => {
    return activityRaw.slice(0, 20).map((row) => ({
      id: String(row.id),
      title: row.title || 'Untitled print',
      printer: row.deviceName || 'Unknown printer',
      status: mapStatus(Number(row.status || 0)),
      startedAt: formatDateLabel(row.startTime),
      durationLabel: formatDuration(row.costTime),
      weightLabel: row.weight && row.weight > 0 ? `${Math.round(row.weight)}g` : 'n/a',
      thumbnailUrl: row.cover || (row.modelId ? `/images/covers/${row.modelId}.jpg` : null),
      progressPct: Number(row.status || 0) === 1 || Number(row.status || 0) === 4 ? 55 : 100,
    }));
  }, [activityRaw]);

  const upcomingScheduleItems = useMemo<ScheduleItem[]>(() => {
    return (maintenanceQuery.data || [])
      .slice()
      .sort((a, b) => {
        const aHours = typeof a.hours_until_due === 'number' ? a.hours_until_due : Number.POSITIVE_INFINITY;
        const bHours = typeof b.hours_until_due === 'number' ? b.hours_until_due : Number.POSITIVE_INFINITY;
        return aHours - bHours;
      })
      .slice(0, 12)
      .map((task) => {
        const hoursUntilDue = typeof task.hours_until_due === 'number' ? task.hours_until_due : null;
        const overdue = Boolean(task.isOverdue || (hoursUntilDue !== null && hoursUntilDue < 0));

        return {
          id: String(task.id),
          title: task.task_name,
          printer: task.printer_name || task.printer_id || 'All printers',
          dueLabel: overdue
            ? 'Overdue'
            : hoursUntilDue === null
              ? 'Scheduled'
              : `${Math.max(0, Math.round(hoursUntilDue))}h`,
          overdue,
          hoursUntilDue,
        };
      });
  }, [maintenanceQuery.data]);

  const livePrintersRows = useMemo<LivePrinterRow[]>(() => (
    printers.map((printer) => ({
      id: printer.id,
      name: printer.name,
      model: printer.model,
      status: printer.status,
      online: printer.online,
      progress: Number(printer.progress || 0),
      currentPrint: printer.currentPrint || null,
    }))
  ), [printers]);

  const mqttStatusRows = useMemo<MqttPrinterRow[]>(() => (
    printers.map((printer) => ({
      id: printer.id,
      name: printer.name,
      online: printer.online,
      mqttConnected: Boolean(printer.mqttConnected),
      status: printer.status || 'IDLE',
      progress: Number(printer.progress || 0),
      currentPrint: printer.currentPrint || null,
      nozzleTemp: Number(printer.nozzleTemp || 0),
      bedTemp: Number(printer.bedTemp || 0),
    }))
  ), [printers]);

  const failureWatchRows = useMemo<FailureWatchRow[]>(() => {
    return activityRaw
      .filter((entry) => Number(entry.status || 0) === 3)
      .slice(0, 16)
      .map((entry) => ({
        id: String(entry.id),
        title: entry.title || 'Untitled print',
        printer: entry.deviceName || 'Unknown printer',
        startedAt: formatDateLabel(entry.startTime),
      }));
  }, [activityRaw]);

  const failure24hCount = useMemo(() => {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000);
    return activityRaw.filter((entry) => {
      if (Number(entry.status || 0) !== 3) return false;
      if (!entry.startTime) return true;
      const timestamp = new Date(entry.startTime).getTime();
      if (Number.isNaN(timestamp)) return true;
      return timestamp >= cutoff;
    }).length;
  }, [activityRaw]);

  const fleetAlertsData = useMemo<FleetAlertsData>(() => {
    const offline = printers.filter((printer) => !printer.online);

    return {
      totalPrinters: printers.length,
      onlinePrinters: printers.length - offline.length,
      activePrints: printers.filter((printer) => printer.online && Boolean(printer.currentPrint)).length,
      overdueMaintenance: (maintenanceQuery.data || []).filter((task) => task.isOverdue).length,
      offlineNames: offline.map((printer) => printer.name),
    };
  }, [printers, maintenanceQuery.data]);

  const backgroundJobRows = useMemo<BackgroundJobRow[]>(() => (
    backgroundJobsQuery.data || []
  ), [backgroundJobsQuery.data]);

  const operationalSnapshot = useMemo(() => {
    const onlinePrinters = printers.filter((printer) => printer.online).length;
    const activePrints = printers.filter((printer) => printer.online && printer.currentPrint).length;
    const overdueTasks = (maintenanceQuery.data || []).filter((task) => task.isOverdue).length;

    return {
      onlinePrinters,
      activePrints,
      overdueTasks,
      activeJobs: backgroundJobRows.length,
      failed24h: failure24hCount,
    };
  }, [printers, maintenanceQuery.data, backgroundJobRows.length, failure24hCount]);

  const isInitialLoading =
    printersQuery.isLoading &&
    statsQuery.isLoading &&
    activityQuery.isLoading &&
    maintenanceQuery.isLoading;

  const queryErrorCount = [
    printersQuery.isError,
    statsQuery.isError,
    activityQuery.isError,
    maintenanceQuery.isError,
    libraryQuery.isError,
    backgroundJobsQuery.isError,
    dashboardLayoutSettingsQuery.isError,
  ].filter(Boolean).length;

  if (isInitialLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-base text-white/50">
        Loading command center data...
      </div>
    );
  }

  return (
    <section className="dashboard-home command-center-stage px-0">
      <header className="command-center-hero mb-3 rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--theme-accent-strong)]">Command Center</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Operations Grid</h2>
            <p className="mt-1 text-xs text-white/60">
              Modular dashboard · drag/resize widgets · persisted layout
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !isEditMode;
                setIsEditMode(next);
                setShowWidgetLibrary(next);
              }}
              className={`inline-flex items-center gap-1.5 rounded border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] ${isEditMode ? 'border-[color:var(--theme-accent)] bg-[color:var(--color-accent-soft)] text-white' : 'border-white/20 bg-white/5 text-white/80 hover:border-white/35'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {isEditMode ? 'Done Editing' : 'Edit Dashboard'}
            </button>

            {isEditMode ? (
              <button
                type="button"
                onClick={snapAllWidgets}
                className="rounded border border-white/20 bg-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/80 hover:border-white/35"
              >
                Snap Layout
              </button>
            ) : null}

            {isEditMode ? (
              <button
                type="button"
                onClick={() => setShowWidgetLibrary((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded border border-white/20 bg-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/80 hover:border-white/35"
              >
                <Plus className="h-3.5 w-3.5" /> Widget Library
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => onNavigate('statistics')}
              className="rounded border border-white/20 bg-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/80 hover:border-white/35"
            >
              Open Full Stats
            </button>
          </div>
        </div>

        <div className="command-center-kpi-grid mt-3">
          <div className="command-kpi-card">
            <p className="command-kpi-label">Fleet Online</p>
            <p className="command-kpi-value">{operationalSnapshot.onlinePrinters}/{printers.length || 0}</p>
          </div>
          <div className="command-kpi-card">
            <p className="command-kpi-label">Active Prints</p>
            <p className="command-kpi-value">{operationalSnapshot.activePrints}</p>
          </div>
          <div className="command-kpi-card">
            <p className="command-kpi-label">Background Jobs</p>
            <p className="command-kpi-value">{operationalSnapshot.activeJobs}</p>
          </div>
          <div className="command-kpi-card">
            <p className="command-kpi-label">Maintenance Overdue</p>
            <p className="command-kpi-value">{operationalSnapshot.overdueTasks}</p>
          </div>
          <div className="command-kpi-card">
            <p className="command-kpi-label">Failures 24h</p>
            <p className="command-kpi-value">{operationalSnapshot.failed24h}</p>
          </div>
        </div>
      </header>

      {queryErrorCount > 0 ? (
        <div className="mb-3 rounded border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-amber-200">
          Some data sources are unavailable ({queryErrorCount}). Widgets are showing partial data.
        </div>
      ) : null}

      <div className="relative">
        <ResponsiveGridLayout
          className="command-center-grid"
          measureBeforeMount={false}
          breakpoints={BREAKPOINTS}
          cols={COLUMNS}
          rowHeight={30}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          layouts={visibleLayouts as ResponsiveLayouts}
          isDraggable
          isResizable
          compactType="vertical"
          preventCollision={false}
          isBounded={false}
          resizeHandles={['se']}
          draggableHandle=".widget-drag-handle"
          draggableCancel=".widget-no-drag,.react-resizable-handle,button,a,input,textarea,select"
          onBreakpointChange={(nextBreakpoint) => setCurrentBreakpoint(nextBreakpoint as Breakpoint)}
          onLayoutChange={(_currentLayout, allLayouts) => handleLayoutsChange(allLayouts as unknown as Record<string, Layout[]>)}
          onDragStop={(currentLayout) => snapBreakpointLayout(currentBreakpoint, currentLayout as Layout[])}
          onResizeStop={(currentLayout) => snapBreakpointLayout(currentBreakpoint, currentLayout as Layout[])}
        >
          {visibleWidgetIds.includes('livePrinters') ? (
            <div key="livePrinters" className="h-full">
              <WidgetShell title="Live Printers" isEditMode={isEditMode} onHide={() => hideWidget('livePrinters')}>
                <LivePrintersWidget
                  printers={livePrintersRows}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'livePrinters')}
                  onOpenPrinters={() => onNavigate('printers')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('healthSummary') ? (
            <div key="healthSummary" className="h-full">
              <WidgetShell title="Quick Stats" isEditMode={isEditMode} onHide={() => hideWidget('healthSummary')}>
                <QuickStatsWidget
                  printersOnlineLabel={quickStats.printersOnlineLabel}
                  totalPrints={quickStats.totalPrints}
                  successRate={quickStats.successRate}
                  libraryModels={quickStats.libraryModels}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('backgroundJobs') ? (
            <div key="backgroundJobs" className="h-full">
              <WidgetShell title="Background Jobs" isEditMode={isEditMode} onHide={() => hideWidget('backgroundJobs')}>
                <BackgroundJobsWidget
                  jobs={backgroundJobRows}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'backgroundJobs')}
                  onOpenLibrary={() => onNavigate('library')}
                  onOpenHistory={() => onNavigate('history')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('mqttStatus') ? (
            <div key="mqttStatus" className="h-full">
              <WidgetShell title="Print Status (MQTT)" isEditMode={isEditMode} onHide={() => hideWidget('mqttStatus')}>
                <PrintStatusMqttWidget
                  rows={mqttStatusRows}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'mqttStatus')}
                  onOpenPrinters={() => onNavigate('printers')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('fleetAlerts') ? (
            <div key="fleetAlerts" className="h-full">
              <WidgetShell title="Fleet Alerts" isEditMode={isEditMode} onHide={() => hideWidget('fleetAlerts')}>
                <FleetAlertsWidget
                  data={fleetAlertsData}
                  onOpenMaintenance={() => onNavigate('maintenance')}
                  onOpenPrinters={() => onNavigate('printers')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('activityStream') ? (
            <div key="activityStream" className="h-full">
              <WidgetShell title="Activity Stream" isEditMode={isEditMode} onHide={() => hideWidget('activityStream')}>
                <ActivityStreamWidget
                  rows={activityRows}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'activityStream')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('upcomingSchedule') ? (
            <div key="upcomingSchedule" className="h-full">
              <WidgetShell title="Maintenance Upcoming" isEditMode={isEditMode} onHide={() => hideWidget('upcomingSchedule')}>
                <UpcomingScheduleWidget
                  items={upcomingScheduleItems}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'upcomingSchedule')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('failureWatch') ? (
            <div key="failureWatch" className="h-full">
              <WidgetShell title="Failure Watch" isEditMode={isEditMode} onHide={() => hideWidget('failureWatch')}>
                <FailureWatchWidget
                  rows={failureWatchRows}
                  failed24hCount={failure24hCount}
                  onOpenHistory={() => onNavigate('history')}
                />
              </WidgetShell>
            </div>
          ) : null}
        </ResponsiveGridLayout>

        {isEditMode && showWidgetLibrary ? (
          <aside className="absolute right-0 top-0 z-10 w-64 rounded-lg border border-white/15 bg-[rgba(10,12,17,0.97)] p-3 shadow-xl">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90">Widget Library</h3>
            <p className="mb-2 mt-0.5 text-[10px] text-white/45">Re-enable hidden widgets</p>
            <div className="space-y-2">
              {dashboardWidgetRegistry.map((widget) => {
                const hidden = hiddenWidgetIds.includes(widget.id);
                return (
                  <button
                    key={widget.id}
                    type="button"
                    disabled={!hidden}
                    onClick={() => showWidget(widget.id)}
                    className={`w-full rounded border px-2 py-1.5 text-left text-xs ${hidden ? 'border-[color:var(--theme-accent)]/40 text-[color:var(--theme-accent)] hover:bg-[color:var(--theme-accent)]/10' : 'border-white/15 text-white/40 opacity-60'}`}
                  >
                    {widget.title}
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

export default DashboardHome;

