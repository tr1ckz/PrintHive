import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, EyeOff, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import useDashboardLayout, { DashboardLayoutPreferences, DashboardWidgetId, dashboardWidgetRegistry, PINNED_WIDGET_IDS } from '../hooks/useDashboardLayout';
import useElementWidth from '../hooks/useElementWidth';
import WidgetShell from './dashboard/WidgetShell';
import { Pill } from './dashboard/primitives';
import { columnCountForWidth, distributeIntoColumns } from './dashboard/flowLayout';
import QuickStatsWidget, { QuickStat } from './dashboard/widgets/QuickStatsWidget';
import ActivityStreamWidget, { ActivityRow } from './dashboard/widgets/ActivityStreamWidget';
import UpcomingScheduleWidget, { ScheduleItem } from './dashboard/widgets/UpcomingScheduleWidget';
import LivePrintersWidget, { LivePrinterRow, PrinterConnection } from './dashboard/widgets/LivePrintersWidget';
import BackgroundJobsWidget, { BackgroundJobRow } from './dashboard/widgets/BackgroundJobsWidget';
import FailureWatchWidget, { FailureWatchRow } from './dashboard/widgets/FailureWatchWidget';
import FleetAlertsWidget, { buildFleetAlerts, FleetAlertsData } from './dashboard/widgets/FleetAlertsWidget';
import PrintStatusMqttWidget, { MqttPrinterRow } from './dashboard/widgets/PrintStatusMqttWidget';
import MaterialUsageWidget from './dashboard/widgets/MaterialUsageWidget';
import QueuePressureWidget from './dashboard/widgets/QueuePressureWidget';

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
  connection?: PrinterConnection | null;
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

/** Time for today's prints, short date otherwise: "14:05" / "Nov 12". */
function formatDateLabel(input?: string): string {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function mapStatus(status: number): string {
  if (status === 2) return 'Success';
  if (status === 3) return 'Failed';
  if (status === 1 || status === 4) return 'Running';
  return 'Unknown';
}

/** "in 31h" under two days, otherwise "in 9d". */
function formatDueIn(hours: number): string {
  const rounded = Math.max(0, Math.round(hours));
  if (rounded < 48) return `in ${rounded}h`;
  return `in ${Math.round(rounded / 24)}d`;
}

function formatHours(seconds?: number): string {
  const hours = Math.max(0, Number(seconds || 0)) / 3600;
  if (hours >= 100) return `${Math.round(hours).toLocaleString()}h`;
  return `${hours.toFixed(1)}h`;
}

function DashboardHome({ onNavigate }: DashboardHomeProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [flowRef, flowWidth] = useElementWidth<HTMLDivElement>(typeof window === 'undefined' ? 1200 : window.innerWidth);
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
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DASHBOARD_WIDGETS, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Failed to persist dashboard layout (${response.status})`);
      }
    },
  });

  const handlePersistDashboardLayout = useCallback((next: DashboardLayoutPreferences) => {
    persistDashboardLayout.mutate(next);
  }, [persistDashboardLayout]);

  const {
    visibleWidgetIds,
    hiddenWidgetIds,
    isDefaultLayout,
    moveWidget,
    showWidget,
    hideWidget,
    resetLayout,
    flushPersist,
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

  const overdueTasks = useMemo(
    () => (maintenanceQuery.data || []).filter((task) => task.isOverdue),
    [maintenanceQuery.data]
  );
  const onlineCount = printers.filter((printer) => printer.online).length;
  const activePrintCount = printers.filter((printer) => printer.online && printer.currentPrint).length;

  // The single home for the headline numbers; widgets below never repeat them.
  const quickStats = useMemo<QuickStat[]>(() => {
    const total = printers.length;
    const offline = total - onlineCount;
    const totalPrints = Number(stats?.totalPrints || 0);
    const failedPrints = Number(stats?.failedPrints || 0);
    const libraryModels = Number(libraryQuery.data?.length || 0);

    return [
      {
        key: 'online',
        label: 'Printers online',
        value: `${onlineCount}`,
        suffix: `/${total}`,
        hint: total === 0 ? 'None configured' : offline === 0 ? 'All online' : `${offline} offline`,
        tone: total > 0 && offline === 0 ? 'success' : 'neutral',
      },
      {
        key: 'printing',
        label: 'Printing now',
        value: `${activePrintCount}`,
        hint: activePrintCount > 0 ? `${Math.max(0, onlineCount - activePrintCount)} idle` : 'No active prints',
        tone: activePrintCount > 0 ? 'accent' : 'neutral',
      },
      {
        key: 'success',
        label: 'Success rate',
        value: totalPrints > 0 ? `${Math.round(stats?.successRate || 0)}%` : '\u2014',
        hint: totalPrints > 0 ? `${failedPrints} failed` : 'No prints yet',
      },
      {
        key: 'prints',
        label: 'Total prints',
        value: totalPrints.toLocaleString(),
        hint: 'All time',
      },
      {
        key: 'time',
        label: 'Print time',
        value: formatHours(stats?.totalTime),
        hint: 'All time',
      },
      {
        key: 'library',
        label: 'Library models',
        value: libraryModels.toLocaleString(),
        hint: 'In your library',
      },
    ];
  }, [printers.length, onlineCount, activePrintCount, libraryQuery.data, stats]);

  const activityRows = useMemo<ActivityRow[]>(() => {
    return activityRaw.slice(0, 20).map((row) => ({
      id: String(row.id),
      title: row.title || 'Untitled print',
      printer: row.deviceName || 'Unknown printer',
      status: mapStatus(Number(row.status || 0)),
      startedAt: formatDateLabel(row.startTime),
      durationLabel: formatDuration(row.costTime),
      weightLabel: row.weight && row.weight > 0 ? `${Math.round(row.weight)} g` : null,
      thumbnailUrl: row.cover || (row.modelId ? `/images/covers/${row.modelId}.jpg` : null),
    }));
  }, [activityRaw]);

  const printerNameById = useMemo(
    () => new Map(printers.map((printer) => [printer.id, printer.name])),
    [printers]
  );

  const upcomingScheduleItems = useMemo<ScheduleItem[]>(() => {
    return (maintenanceQuery.data || [])
      .slice()
      .sort((a, b) => {
        const aHours = typeof a.hours_until_due === 'number' ? a.hours_until_due : Number.POSITIVE_INFINITY;
        const bHours = typeof b.hours_until_due === 'number' ? b.hours_until_due : Number.POSITIVE_INFINITY;
        return aHours - bHours;
      })
      .map((task) => {
        const hoursUntilDue = typeof task.hours_until_due === 'number' ? task.hours_until_due : null;
        const overdue = Boolean(task.isOverdue || (hoursUntilDue !== null && hoursUntilDue < 0));

        return {
          id: String(task.id),
          title: task.task_name,
          printer: task.printer_name || (task.printer_id && printerNameById.get(task.printer_id)) || task.printer_id || 'All printers',
          dueLabel: overdue
            ? 'Overdue'
            : hoursUntilDue === null
              ? 'Scheduled'
              : formatDueIn(hoursUntilDue),
          overdue,
          hoursUntilDue,
        };
      });
  }, [maintenanceQuery.data, printerNameById]);

  const livePrintersRows = useMemo<LivePrinterRow[]>(() => (
    printers.map((printer) => ({
      id: printer.id,
      name: printer.name,
      model: printer.model,
      status: printer.status,
      online: printer.online,
      progress: Number(printer.progress || 0),
      currentPrint: printer.currentPrint || null,
      connection: printer.connection || null,
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

  const materialUsage = useMemo(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;
    const thirtyDays = 30 * oneDay;

    let todayWeight = 0;
    let weekWeight = 0;
    let monthWeight = 0;
    let successMonthWeight = 0;

    for (const row of activityRaw) {
      const weight = Number(row.weight || 0);
      if (!Number.isFinite(weight) || weight <= 0) {
        continue;
      }

      if (!row.startTime) {
        monthWeight += weight;
        continue;
      }

      const timestamp = new Date(row.startTime).getTime();
      if (Number.isNaN(timestamp)) {
        monthWeight += weight;
        continue;
      }

      const age = now - timestamp;

      if (age <= oneDay) {
        todayWeight += weight;
      }
      if (age <= sevenDays) {
        weekWeight += weight;
      }
      if (age <= thirtyDays) {
        monthWeight += weight;
        if (Number(row.status || 0) === 2) {
          successMonthWeight += weight;
        }
      }
    }

    const successSharePct = monthWeight > 0 ? (successMonthWeight / monthWeight) * 100 : 0;

    return {
      todayWeight,
      weekWeight,
      monthWeight,
      allTimeWeight: Number(stats?.totalWeight || 0),
      successSharePct,
    };
  }, [activityRaw, stats?.totalWeight]);

  const fleetAlertsData = useMemo<FleetAlertsData>(() => ({
    totalPrinters: printers.length,
    offlineNames: printers.filter((printer) => !printer.online).map((printer) => printer.name),
    overdueTaskNames: overdueTasks.map((task) => task.task_name),
  }), [printers, overdueTasks]);

  const backgroundJobRows = useMemo<BackgroundJobRow[]>(() => (
    backgroundJobsQuery.data || []
  ), [backgroundJobsQuery.data]);

  const queuePressureSummary = useMemo(() => {
    const offlinePrinters = Math.max(0, printers.length - onlineCount);
    const activeJobs = backgroundJobRows.length;

    const pressureScore = Math.max(
      0,
      Math.min(100, Math.round((activePrintCount * 16) + (overdueTasks.length * 14) + (offlinePrinters * 18) + (activeJobs * 22)))
    );

    let recommendation = 'Load is healthy. Keep the current cadence.';
    if (pressureScore >= 75) {
      recommendation = 'Prioritize overdue maintenance and reduce concurrent starts.';
    } else if (pressureScore >= 45) {
      recommendation = 'Watch printer uptime and clear near-due tasks.';
    }

    return {
      pressureScore,
      activePrints: activePrintCount,
      activeJobs,
      overdueTasks: overdueTasks.length,
      offlinePrinters,
      recommendation,
    };
  }, [printers.length, onlineCount, activePrintCount, overdueTasks.length, backgroundJobRows.length]);

  const mqttConnectedCount = printers.filter((printer) => printer.mqttConnected).length;

  const lastUpdatedAt = Math.max(printersQuery.dataUpdatedAt, statsQuery.dataUpdatedAt, activityQuery.dataUpdatedAt);
  const lastUpdatedLabel = lastUpdatedAt > 0
    ? new Date(lastUpdatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '';

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

  const fleetAlertCount = buildFleetAlerts(fleetAlertsData, { onOpenPrinters: () => {}, onOpenMaintenance: () => {} }).length;

  const flowWidgetIds = useMemo(
    () => visibleWidgetIds.filter((id) => !PINNED_WIDGET_IDS.includes(id)),
    [visibleWidgetIds]
  );

  // Rough rendered heights (px) from the row counts each widget will show.
  // Only used to balance columns, so being a few pixels off is harmless.
  const estimatedHeights = useMemo<Record<DashboardWidgetId, number>>(() => {
    const list = (rows: number, max: number, rowHeight: number, emptyHeight = 80) =>
      rows === 0 ? emptyHeight : 64 + Math.min(rows, max) * rowHeight;
    return {
      healthSummary: 0,
      livePrinters: list(printers.length, 8, 52) + (printers.length >= 4 ? 44 : 0),
      fleetAlerts: list(fleetAlertCount, 4, 52),
      activityStream: list(activityRows.length, 7, 53) + (activityRows.length > 0 ? 44 : 0),
      upcomingSchedule: list(upcomingScheduleItems.length, 5, 53)
        + (overdueTasks.length > 0 && overdueTasks.length < upcomingScheduleItems.length ? 44 : 0),
      materialUsage: 180,
      queuePressure: 170,
      backgroundJobs: list(backgroundJobRows.length, 4, 76),
      failureWatch: list(failureWatchRows.length, 4, 53),
      mqttStatus: list(printers.length, 6, 56),
    };
  }, [printers.length, fleetAlertCount, activityRows.length, upcomingScheduleItems.length, overdueTasks.length, backgroundJobRows.length, failureWatchRows.length]);

  const columns = useMemo(
    () => distributeIntoColumns(flowWidgetIds, columnCountForWidth(flowWidth), (id) => estimatedHeights[id]),
    [flowWidgetIds, flowWidth, estimatedHeights]
  );

  if (isInitialLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">
        Loading dashboard…
      </div>
    );
  }

  const shellProps = (id: DashboardWidgetId) => {
    const index = flowWidgetIds.indexOf(id);
    return {
      isEditMode,
      onHide: () => hideWidget(id),
      onMoveEarlier: index > 0 ? () => moveWidget(id, -1) : undefined,
      onMoveLater: index >= 0 && index < flowWidgetIds.length - 1 ? () => moveWidget(id, 1) : undefined,
    };
  };

  const renderWidget: Record<DashboardWidgetId, () => React.ReactNode> = {
    healthSummary: () => <QuickStatsWidget stats={quickStats} />,
    livePrinters: () => (
      <WidgetShell title="Printers" actionLabel="All printers" onAction={() => onNavigate('printers')} {...shellProps('livePrinters')}>
        <LivePrintersWidget printers={livePrintersRows} />
      </WidgetShell>
    ),
    fleetAlerts: () => (
      <WidgetShell
        title="Needs Attention"
        badge={fleetAlertCount > 0 ? <Pill tone="danger">{fleetAlertCount}</Pill> : null}
        {...shellProps('fleetAlerts')}
      >
        <FleetAlertsWidget
          data={fleetAlertsData}
          onOpenMaintenance={() => onNavigate('maintenance')}
          onOpenPrinters={() => onNavigate('printers')}
        />
      </WidgetShell>
    ),
    activityStream: () => (
      <WidgetShell title="Recent Prints" actionLabel="History" onAction={() => onNavigate('history')} {...shellProps('activityStream')}>
        <ActivityStreamWidget rows={activityRows} />
      </WidgetShell>
    ),
    upcomingSchedule: () => (
      <WidgetShell
        title="Maintenance"
        badge={overdueTasks.length > 0 ? <Pill tone="danger">{overdueTasks.length} overdue</Pill> : null}
        actionLabel="Open"
        onAction={() => onNavigate('maintenance')}
        {...shellProps('upcomingSchedule')}
      >
        <UpcomingScheduleWidget items={upcomingScheduleItems} />
      </WidgetShell>
    ),
    materialUsage: () => (
      <WidgetShell title="Material Usage" actionLabel="Statistics" onAction={() => onNavigate('statistics')} {...shellProps('materialUsage')}>
        <MaterialUsageWidget
          todayWeight={materialUsage.todayWeight}
          weekWeight={materialUsage.weekWeight}
          monthWeight={materialUsage.monthWeight}
          allTimeWeight={materialUsage.allTimeWeight}
          successSharePct={materialUsage.successSharePct}
        />
      </WidgetShell>
    ),
    queuePressure: () => (
      <WidgetShell title="Queue Pressure" {...shellProps('queuePressure')}>
        <QueuePressureWidget summary={queuePressureSummary} />
      </WidgetShell>
    ),
    backgroundJobs: () => (
      <WidgetShell
        title="Background Jobs"
        badge={backgroundJobRows.length > 0 ? <Pill tone="accent">{backgroundJobRows.length} running</Pill> : null}
        {...shellProps('backgroundJobs')}
      >
        <BackgroundJobsWidget jobs={backgroundJobRows} />
      </WidgetShell>
    ),
    failureWatch: () => (
      <WidgetShell
        title="Failure Watch"
        badge={<Pill tone={failure24hCount > 0 ? 'danger' : 'neutral'}>{failure24hCount} in 24h</Pill>}
        actionLabel="History"
        onAction={() => onNavigate('history')}
        {...shellProps('failureWatch')}
      >
        <FailureWatchWidget rows={failureWatchRows} />
      </WidgetShell>
    ),
    mqttStatus: () => (
      <WidgetShell
        title="MQTT Telemetry"
        badge={<Pill tone={mqttConnectedCount === printers.length && printers.length > 0 ? 'success' : 'neutral'}>{mqttConnectedCount}/{printers.length} connected</Pill>}
        {...shellProps('mqttStatus')}
      >
        <PrintStatusMqttWidget rows={mqttStatusRows} />
      </WidgetShell>
    ),
  };

  const toolbarButtonClass =
    'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors';
  const statsVisible = visibleWidgetIds.includes('healthSummary');

  return (
    <section className="@container space-y-3" aria-label="Operations overview">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs text-muted" aria-live="polite">
          {isEditMode
            ? 'Reorder with the arrows, hide what you don’t need. Changes save automatically.'
            : lastUpdatedLabel
              ? `Updated ${lastUpdatedLabel}`
              : ' '}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {isEditMode && !isDefaultLayout ? (
            <button type="button" onClick={resetLayout} className={`${toolbarButtonClass} text-muted hover:bg-white/5 hover:text-fg`}>
              <RotateCcw className="size-3.5" aria-hidden />
              Reset
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={isEditMode}
            onClick={() => {
              if (isEditMode) {
                flushPersist();
              }
              setIsEditMode((current) => !current);
            }}
            className={`${toolbarButtonClass} ${
              isEditMode
                ? 'bg-accent text-accent-contrast hover:bg-accent-strong'
                : 'bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg'
            }`}
          >
            {isEditMode ? <Check className="size-3.5" aria-hidden /> : <SlidersHorizontal className="size-3.5" aria-hidden />}
            {isEditMode ? 'Done' : 'Edit Dashboard'}
          </button>
        </div>
      </header>

      {queryErrorCount > 0 ? (
        <p role="status" className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          Some data sources are unavailable ({queryErrorCount}). Widgets are showing partial data.
        </p>
      ) : null}

      {isEditMode && hiddenWidgetIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-card px-4 py-2.5">
          <span className="text-xs text-muted">Hidden</span>
          {dashboardWidgetRegistry.filter((widget) => hiddenWidgetIds.includes(widget.id)).map((widget) => (
            <button
              key={widget.id}
              type="button"
              onClick={() => showWidget(widget.id)}
              aria-label={`Show ${widget.title}`}
              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-white/5 pl-2 pr-3 text-xs font-medium text-fg-soft transition-colors hover:bg-white/10 hover:text-fg"
            >
              <Plus className="size-3.5" aria-hidden />
              {widget.title}
            </button>
          ))}
        </div>
      ) : null}

      {statsVisible ? (
        <div className={isEditMode ? 'rounded-lg ring-1 ring-accent/30' : undefined}>
          {isEditMode ? (
            <div className="flex min-h-11 items-center justify-between gap-2 pl-4 pr-2">
              <p className="truncate text-[13px] font-semibold text-fg">
                Quick Stats <span className="font-normal text-muted">· pinned to the top</span>
              </p>
              <button
                type="button"
                onClick={() => hideWidget('healthSummary')}
                aria-label="Hide Quick Stats"
                title="Hide widget"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/5 hover:text-fg"
              >
                <EyeOff className="size-4" aria-hidden />
              </button>
            </div>
          ) : null}
          {renderWidget.healthSummary()}
        </div>
      ) : null}

      <div ref={flowRef} className="flex items-start gap-3">
        {columns.map((columnIds, columnIndex) => (
          <div key={columnIndex} className="flex min-w-0 flex-1 basis-0 flex-col gap-3">
            {columnIds.map((id) => (
              <div key={id}>{renderWidget[id]()}</div>
            ))}
          </div>
        ))}
      </div>

      {flowWidgetIds.length === 0 && !statsVisible ? (
        <p className="py-10 text-center text-sm text-muted">
          Every widget is hidden. Use Edit Dashboard to bring some back.
        </p>
      ) : null}
    </section>
  );
}

export default DashboardHome;
