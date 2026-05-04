import { useMemo, useState } from 'react';
import { Layout, Layouts, ResponsiveGridLayout } from 'react-grid-layout';
import { LayoutGrid, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { useRealtimeTick } from '../hooks/useRealtimeTick';
import useDashboardLayout, { DashboardLayoutPreferences, DashboardWidgetId, dashboardWidgetRegistry } from '../hooks/useDashboardLayout';
import WidgetShell from './dashboard/WidgetShell';
import HealthSummaryWidget from './dashboard/widgets/HealthSummaryWidget';
import ActivityStreamWidget, { ActivityRow } from './dashboard/widgets/ActivityStreamWidget';
import HeatmapWidget, { HeatmapBucket } from './dashboard/widgets/HeatmapWidget';
import StorageTrendWidget, { TrendPoint } from './dashboard/widgets/StorageTrendWidget';
import UpcomingScheduleWidget, { ScheduleItem } from './dashboard/widgets/UpcomingScheduleWidget';
import QueuePressureWidget, { QueuePressureSummary } from './dashboard/widgets/QueuePressureWidget';
import BackupTelemetryWidget, { BackupTelemetrySummary } from './dashboard/widgets/BackupTelemetryWidget';
import LivePrintersWidget, { LivePrinterRow } from './dashboard/widgets/LivePrintersWidget';
import DuplicatePressureWidget, { DuplicatePressureSummary } from './dashboard/widgets/DuplicatePressureWidget';
import BackgroundJobsWidget, { BackgroundJobRow } from './dashboard/widgets/BackgroundJobsWidget';
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
  title: string;
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

interface DatabaseSettings {
  backupScheduleEnabled: boolean;
  backupInterval: number;
  backupRetention: number;
  remoteBackupEnabled: boolean;
  lastBackupDate?: string | null;
}

interface DuplicateGroup {
  name: string;
  totalSize?: number;
  files?: Array<{ id: number; fileSize?: number }>;
}

interface BackgroundJobStatusResponse {
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

const BREAKPOINTS = { lg: 1320, md: 1100, sm: 860, xs: 620, xxs: 0 };
const COLUMNS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await fetchWithRetry(url, { credentials: 'include' });
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function mapStatus(status: number): string {
  if (status === 2) return 'Success';
  if (status === 3) return 'Failed';
  if (status === 1 || status === 4) return 'Running';
  return 'Unknown';
}

function widgetDensity(layouts: Layouts, breakpoint: keyof Layouts, id: string): 'compact' | 'comfortable' | 'expanded' {
  const entry = (layouts[breakpoint] || []).find((l) => l.i === id);
  const area = (entry?.w || 4) * (entry?.h || 5);
  return area <= 24 ? 'compact' : area <= 42 ? 'comfortable' : 'expanded';
}

function DashboardHome({ onNavigate }: DashboardHomeProps) {
  const queryClient = useQueryClient();
  const [isEditMode, setIsEditMode] = useState(false);
  const [showWidgetLibrary, setShowWidgetLibrary] = useState(false);
  const [currentBreakpoint, setCurrentBreakpoint] = useState<keyof Layouts>('lg');

  const printersQuery = useQuery({
    queryKey: ['dashboard', 'printers'],
    queryFn: () => fetchJson<PrinterStatusResponse>(API_ENDPOINTS.PRINTERS.STATUS, { printers: [], online: 0, total: 0 }),
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const statsQuery = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => fetchJson<StatisticsResponse>(API_ENDPOINTS.STATISTICS.HISTORY, { totalPrints: 0, successRate: 0, failedPrints: 0, totalWeight: 0, totalTime: 0 }),
    staleTime: 30000,
  });

  const activityQuery = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => fetchJson<PrintActivityApiRow[]>(`${API_ENDPOINTS.PRINTS.LIST}?limit=40`, []),
    staleTime: 20000,
  });

  const maintenanceQuery = useQuery({
    queryKey: ['dashboard', 'maintenance'],
    queryFn: () => fetchJson<MaintenanceTask[]>(API_ENDPOINTS.MAINTENANCE.LIST, []),
    staleTime: 20000,
  });

  const libraryQuery = useQuery({
    queryKey: ['dashboard', 'library'],
    queryFn: async () => {
      const data = await fetchJson<unknown>(API_ENDPOINTS.LIBRARY.LIST, []);
      if (Array.isArray(data)) return data;
      if (Array.isArray((data as { files?: unknown[] })?.files)) return (data as { files: unknown[] }).files;
      return [];
    },
    staleTime: 45000,
  });

  const backupSettingsQuery = useQuery({
    queryKey: ['dashboard', 'backup-settings'],
    queryFn: () => fetchJson<DatabaseSettings>(API_ENDPOINTS.SETTINGS.DATABASE, {
      backupScheduleEnabled: false,
      backupInterval: 7,
      backupRetention: 30,
      remoteBackupEnabled: false,
      lastBackupDate: null,
    }),
    staleTime: 45000,
  });

  const duplicateGroupsQuery = useQuery({
    queryKey: ['dashboard', 'duplicates'],
    queryFn: async () => {
      const data = await fetchJson<{ duplicates?: DuplicateGroup[] }>(API_ENDPOINTS.LIBRARY.DUPLICATES('hash'), { duplicates: [] });
      return Array.isArray(data.duplicates) ? data.duplicates : [];
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const backgroundJobsQuery = useQuery({
    queryKey: ['dashboard', 'background-jobs'],
    queryFn: async (): Promise<BackgroundJobRow[]> => {
      const definitions = [
        { id: 'video-match', name: 'Video Matching', endpoint: API_ENDPOINTS.VIDEO.MATCH_STATUS },
        { id: 'library-scan', name: 'Library Scan', endpoint: API_ENDPOINTS.LIBRARY.SCAN_STATUS },
        { id: 'auto-tag', name: 'Auto Tagging', endpoint: API_ENDPOINTS.LIBRARY.AUTO_TAG_STATUS },
        { id: 'bulk-delete', name: 'Bulk Delete', endpoint: API_ENDPOINTS.LIBRARY.BULK_DELETE_STATUS },
      ];

      const results = await Promise.all(definitions.map(async (definition) => {
        const data = await fetchJson<BackgroundJobStatusResponse>(definition.endpoint, {});
        const completed = data.completed ?? data.matched ?? data.added ?? data.deleted ?? 0;
        const failed = data.failed ?? data.unmatched ?? data.skipped ?? 0;

        return {
          id: definition.id,
          name: definition.name,
          running: Boolean(data.running),
          processed: Number(data.processed || 0),
          total: Number(data.total || 0),
          completed: Number(completed || 0),
          failed: Number(failed || 0),
        } as BackgroundJobRow;
      }));

      return results.filter((job) => job.running);
    },
    staleTime: 3000,
    refetchInterval: 5000,
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
    onPersist: (next) => {
      persistDashboardLayout.mutate(next);
    },
  });

  useRealtimeTick(() => {
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }, { minIntervalMs: 8000 });

  const printers = printersQuery.data?.printers || [];
  const stats = statsQuery.data;
  const activityRaw = useMemo(() => {
    const value = activityQuery.data;
    return Array.isArray(value) ? value : [];
  }, [activityQuery.data]);

  const healthSummary = useMemo(() => {
    const onlinePrinters = printers.filter((printer) => printer.online).length;
    const activeJobs = printers.filter((printer) => printer.online && printer.currentPrint).length;

    return {
      fleet: [
        {
          label: 'Online Ratio',
          value: `${onlinePrinters}/${printers.length || 0}`,
          tone: onlinePrinters < Math.max(1, printers.length) ? 'warn' : 'good',
        },
        {
          label: 'Active Jobs',
          value: `${activeJobs}`,
          tone: activeJobs > 0 ? 'good' : 'neutral',
        },
        {
          label: 'Library Size',
          value: `${libraryQuery.data?.length || 0}`,
          tone: 'neutral',
        },
        {
          label: 'Maintenance Alerts',
          value: `${(maintenanceQuery.data || []).filter((task) => task.isOverdue).length}`,
          tone: (maintenanceQuery.data || []).some((task) => task.isOverdue) ? 'bad' : 'good',
        },
      ] as const,
      quality: [
        {
          label: 'Success Rate',
          value: `${Math.round(stats?.successRate || 0)}%`,
          tone: (stats?.successRate || 0) >= 90 ? 'good' : (stats?.successRate || 0) >= 75 ? 'warn' : 'bad',
        },
        {
          label: 'Failed Prints',
          value: `${stats?.failedPrints || 0}`,
          tone: (stats?.failedPrints || 0) > 10 ? 'bad' : (stats?.failedPrints || 0) > 0 ? 'warn' : 'good',
        },
        {
          label: 'Total Prints',
          value: `${stats?.totalPrints || 0}`,
          tone: 'neutral',
        },
        {
          label: 'Print Hours',
          value: formatDuration(stats?.totalTime || 0),
          tone: 'neutral',
        },
      ] as const,
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
    }));
  }, [activityRaw]);

  const heatmapBuckets = useMemo<HeatmapBucket[]>(() => {
    const bucketMap = new Map<string, number>();

    activityRaw.forEach((entry) => {
      if (!entry.startTime) return;
      const date = new Date(entry.startTime);
      if (Number.isNaN(date.getTime())) return;
      const key = date.toISOString().slice(0, 10);
      bucketMap.set(key, (bucketMap.get(key) || 0) + 1);
    });

    const days: HeatmapBucket[] = [];
    for (let index = 83; index >= 0; index -= 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - index);
      const key = date.toISOString().slice(0, 10);
      days.push({
        dateLabel: key,
        dayShort: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2),
        count: bucketMap.get(key) || 0,
      });
    }

    return days;
  }, [activityRaw]);

  const storageTrendSeries = useMemo<TrendPoint[]>(() => {
    const monthMap = new Map<string, TrendPoint>();

    activityRaw.forEach((entry) => {
      const date = entry.startTime ? new Date(entry.startTime) : new Date();
      const label = date.toLocaleDateString(undefined, { month: 'short' });

      const existing = monthMap.get(label) || {
        label,
        filamentKg: 0,
        printHours: 0,
        jobs: 0,
      };

      existing.filamentKg += (entry.weight || 0) / 1000;
      existing.printHours += (entry.costTime || 0) / 3600;
      existing.jobs += 1;
      monthMap.set(label, existing);
    });

    const values = Array.from(monthMap.values());
    return values.slice(-8);
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

  const queuePressureSummary = useMemo<QueuePressureSummary>(() => {
    const activeJobs = printers.filter((printer) => printer.online && printer.currentPrint).length;
    const offlinePrinters = printers.filter((printer) => !printer.online).length;
    const overdueTasks = (maintenanceQuery.data || []).filter((task) => task.isOverdue).length;

    const pressureScore = Math.min(100, activeJobs * 18 + overdueTasks * 24 + offlinePrinters * 12);

    let recommendation = 'Queue is stable. Continue normal operations.';
    if (pressureScore >= 75) {
      recommendation = 'Queue is under pressure. Prioritize overdue maintenance and rebalance printers.';
    } else if (pressureScore >= 45) {
      recommendation = 'Moderate pressure detected. Monitor active jobs and upcoming tasks.';
    }

    return {
      pressureScore,
      activeJobs,
      overdueTasks,
      offlinePrinters,
      recommendation,
    };
  }, [printers, maintenanceQuery.data]);

  const backupSummary = useMemo<BackupTelemetrySummary>(() => {
    const settings = backupSettingsQuery.data;

    return {
      scheduleEnabled: Boolean(settings?.backupScheduleEnabled),
      intervalDays: settings?.backupInterval || 7,
      retentionDays: settings?.backupRetention || 30,
      remoteEnabled: Boolean(settings?.remoteBackupEnabled),
      lastBackupLabel: settings?.lastBackupDate
        ? new Date(settings.lastBackupDate).toLocaleString()
        : 'No backup recorded',
    };
  }, [backupSettingsQuery.data]);

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

  const duplicatePressureSummary = useMemo<DuplicatePressureSummary>(() => {
    const groups = duplicateGroupsQuery.data || [];
    const duplicateFileCount = groups.reduce((sum, group) => sum + Math.max(0, (group.files?.length || 1) - 1), 0);
    const totalSize = groups.reduce((sum, group) => sum + Number(group.totalSize || 0), 0);

    return {
      groupCount: groups.length,
      duplicateFileCount,
      estimatedWasteLabel: formatBytes(totalSize),
      topGroups: groups.slice(0, 8).map((group) => ({
        name: group.name || 'Untitled Group',
        fileCount: group.files?.length || 0,
        sizeLabel: formatBytes(Number(group.totalSize || 0)),
      })),
    };
  }, [duplicateGroupsQuery.data]);

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
      duplicateGroups: duplicatePressureSummary.groupCount,
      duplicateFiles: duplicatePressureSummary.duplicateFileCount,
    };
  }, [printers, maintenanceQuery.data, backgroundJobRows.length, duplicatePressureSummary.groupCount, duplicatePressureSummary.duplicateFileCount]);

  const isInitialLoading =
    printersQuery.isLoading &&
    statsQuery.isLoading &&
    activityQuery.isLoading &&
    maintenanceQuery.isLoading &&
    backupSettingsQuery.isLoading;

  const queryErrorCount = [
    printersQuery.isError,
    statsQuery.isError,
    activityQuery.isError,
    maintenanceQuery.isError,
    libraryQuery.isError,
    backupSettingsQuery.isError,
    duplicateGroupsQuery.isError,
    backgroundJobsQuery.isError,
    dashboardLayoutSettingsQuery.isError,
  ].filter(Boolean).length;

  if (isInitialLoading) {
    return (
      <div className="flex min-h-[38vh] items-center justify-center rounded-md border border-white/10 bg-black/20 text-sm text-white/60">
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
            <p className="command-kpi-label">Duplicate Pressure</p>
            <p className="command-kpi-value">{operationalSnapshot.duplicateGroups}g / {operationalSnapshot.duplicateFiles}f</p>
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
          breakpoints={BREAKPOINTS}
          cols={COLUMNS}
          rowHeight={30}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          layouts={visibleLayouts}
          isDraggable={isEditMode}
          isResizable={isEditMode}
          compactType="vertical"
          preventCollision
          isBounded
          resizeHandles={['se']}
          draggableHandle=".widget-drag-handle"
          onBreakpointChange={(nextBreakpoint) => setCurrentBreakpoint(nextBreakpoint as keyof Layouts)}
          onLayoutChange={(_currentLayout, allLayouts) => handleLayoutsChange(allLayouts as Layouts)}
          onDragStop={(currentLayout) => snapBreakpointLayout(currentBreakpoint, currentLayout as Layout[])}
          onResizeStop={(currentLayout) => snapBreakpointLayout(currentBreakpoint, currentLayout as Layout[])}
        >
          {visibleWidgetIds.includes('livePrinters') ? (
            <div key="livePrinters">
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
            <div key="healthSummary">
              <WidgetShell title="Health Summary" isEditMode={isEditMode} onHide={() => hideWidget('healthSummary')}>
                <HealthSummaryWidget
                  fleetMetrics={[...healthSummary.fleet]}
                  qualityMetrics={[...healthSummary.quality]}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'healthSummary')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('backgroundJobs') ? (
            <div key="backgroundJobs">
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

          {visibleWidgetIds.includes('queuePressure') ? (
            <div key="queuePressure">
              <WidgetShell title="Queue Pressure" isEditMode={isEditMode} onHide={() => hideWidget('queuePressure')}>
                <QueuePressureWidget
                  summary={queuePressureSummary}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'queuePressure')}
                  onRefresh={() => { void queryClient.invalidateQueries({ queryKey: ['dashboard'] }); }}
                  onOpenMaintenance={() => onNavigate('maintenance')}
                  onOpenPrinters={() => onNavigate('printers')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('backupTelemetry') ? (
            <div key="backupTelemetry">
              <WidgetShell title="Backup Telemetry" isEditMode={isEditMode} onHide={() => hideWidget('backupTelemetry')}>
                <BackupTelemetryWidget
                  summary={backupSummary}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'backupTelemetry')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('activityStream') ? (
            <div key="activityStream">
              <WidgetShell title="Activity Stream" isEditMode={isEditMode} onHide={() => hideWidget('activityStream')}>
                <ActivityStreamWidget
                  rows={activityRows}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'activityStream')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('storageTrend') ? (
            <div key="storageTrend">
              <WidgetShell title="Storage Trend" isEditMode={isEditMode} onHide={() => hideWidget('storageTrend')}>
                <StorageTrendWidget
                  points={storageTrendSeries}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'storageTrend')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('heatmap') ? (
            <div key="heatmap">
              <WidgetShell title="Print Heatmap" isEditMode={isEditMode} onHide={() => hideWidget('heatmap')}>
                <HeatmapWidget buckets={heatmapBuckets} />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('upcomingSchedule') ? (
            <div key="upcomingSchedule">
              <WidgetShell title="Upcoming Schedule" isEditMode={isEditMode} onHide={() => hideWidget('upcomingSchedule')}>
                <UpcomingScheduleWidget
                  items={upcomingScheduleItems}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'upcomingSchedule')}
                />
              </WidgetShell>
            </div>
          ) : null}

          {visibleWidgetIds.includes('duplicatePressure') ? (
            <div key="duplicatePressure">
              <WidgetShell title="Duplicate Pressure" isEditMode={isEditMode} onHide={() => hideWidget('duplicatePressure')}>
                <DuplicatePressureWidget
                  summary={duplicatePressureSummary}
                  density={widgetDensity(visibleLayouts, currentBreakpoint, 'duplicatePressure')}
                  onOpenDuplicates={() => onNavigate('duplicates')}
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

