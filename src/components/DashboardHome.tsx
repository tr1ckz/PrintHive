import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './DashboardHome.css';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';

interface PrinterStatus {
  id: string;
  name: string;
  model: string;
  status: string;
  progress?: number;
  currentPrint?: string;
  lastPrint?: string;
  online: boolean;
}

interface RecentPrint {
  id: number;
  title: string;
  cover?: string;
  coverUrl?: string;
  status?: number | string;
  startTime?: string;
  deviceName?: string;
}

interface DashboardStats {
  totalPrints: number;
  successRate: number;
  totalTime: number;
  filamentUsed: number;
  recentPrints: RecentPrint[];
}

type StatId = 'printersOnline' | 'totalPrints' | 'successRate' | 'libraryCount';
type WidgetId = 'activePrints' | 'printers' | 'recentPrints' | 'quickStats' | 'quickActions';

interface DashboardWidgetPrefs {
  version: number;
  density: 'compact' | 'comfortable';
  refreshSeconds: number;
  showHeaderMeta: boolean;
  statsOrder: StatId[];
  statsHidden: StatId[];
  widgetOrder: WidgetId[];
  widgetHidden: WidgetId[];
  widgetSpan: Record<WidgetId, 1 | 2>;
}

interface DashboardHomeProps {
  onNavigate: (tab: string) => void;
}

const DEFAULT_PREFS: DashboardWidgetPrefs = {
  version: 1,
  density: 'compact',
  refreshSeconds: 30,
  showHeaderMeta: true,
  statsOrder: ['printersOnline', 'totalPrints', 'successRate', 'libraryCount'],
  statsHidden: [],
  widgetOrder: ['activePrints', 'printers', 'recentPrints', 'quickStats', 'quickActions'],
  widgetHidden: [],
  widgetSpan: {
    activePrints: 2,
    printers: 1,
    recentPrints: 1,
    quickStats: 1,
    quickActions: 1,
  },
};

const clampRefresh = (value: number) => Math.max(10, Math.min(300, value));

const sanitizePrefs = (raw: Partial<DashboardWidgetPrefs> | null | undefined): DashboardWidgetPrefs => {
  const source = raw || {};

  const validStatIds: StatId[] = ['printersOnline', 'totalPrints', 'successRate', 'libraryCount'];
  const validWidgetIds: WidgetId[] = ['activePrints', 'printers', 'recentPrints', 'quickStats', 'quickActions'];

  const normalizeOrder = <T extends string>(incoming: unknown, valid: T[], fallback: T[]) => {
    const result: T[] = [];
    if (Array.isArray(incoming)) {
      for (const item of incoming) {
        if (typeof item !== 'string') continue;
        if (!valid.includes(item as T)) continue;
        if (result.includes(item as T)) continue;
        result.push(item as T);
      }
    }

    for (const key of fallback) {
      if (!result.includes(key)) {
        result.push(key);
      }
    }

    return result;
  };

  const normalizeHidden = <T extends string>(incoming: unknown, valid: T[]) => {
    const result: T[] = [];
    if (!Array.isArray(incoming)) return result;
    for (const item of incoming) {
      if (typeof item !== 'string') continue;
      if (!valid.includes(item as T)) continue;
      if (!result.includes(item as T)) result.push(item as T);
    }
    return result;
  };

  const widgetSpan: Record<WidgetId, 1 | 2> = {
    activePrints: 2,
    printers: 1,
    recentPrints: 1,
    quickStats: 1,
    quickActions: 1,
  };

  const incomingSpan = source.widgetSpan && typeof source.widgetSpan === 'object' ? source.widgetSpan : {};
  (Object.keys(widgetSpan) as WidgetId[]).forEach((key) => {
    const value = Number.parseInt(String((incomingSpan as Record<string, unknown>)[key] ?? widgetSpan[key]), 10);
    widgetSpan[key] = value === 2 ? 2 : 1;
  });

  return {
    version: 1,
    density: source.density === 'comfortable' ? 'comfortable' : 'compact',
    refreshSeconds: clampRefresh(Number.parseInt(String(source.refreshSeconds ?? DEFAULT_PREFS.refreshSeconds), 10) || DEFAULT_PREFS.refreshSeconds),
    showHeaderMeta: Boolean(source.showHeaderMeta ?? true),
    statsOrder: normalizeOrder(source.statsOrder, validStatIds, DEFAULT_PREFS.statsOrder),
    statsHidden: normalizeHidden(source.statsHidden, validStatIds),
    widgetOrder: normalizeOrder(source.widgetOrder, validWidgetIds, DEFAULT_PREFS.widgetOrder),
    widgetHidden: normalizeHidden(source.widgetHidden, validWidgetIds),
    widgetSpan,
  };
};

const moveItem = <T,>(list: T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
};

const DashboardHome: React.FC<DashboardHomeProps> = ({ onNavigate }) => {
  const [printers, setPrinters] = useState<PrinterStatus[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentPrints, setRecentPrints] = useState<RecentPrint[]>([]);
  const [libraryCount, setLibraryCount] = useState(0);

  const [widgetPrefs, setWidgetPrefs] = useState<DashboardWidgetPrefs>(DEFAULT_PREFS);
  const [draftPrefs, setDraftPrefs] = useState<DashboardWidgetPrefs>(DEFAULT_PREFS);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [isCustomizeMode, setIsCustomizeMode] = useState(false);

  const onlinePrinters = useMemo(() => printers.filter((p) => p.online).length, [printers]);
  const activePrints = useMemo(() => printers.filter((p) => p.online && p.currentPrint), [printers]);
  const effectivePrefs = isCustomizeMode ? draftPrefs : widgetPrefs;

  const loadDashboardData = useCallback(async () => {
    try {
      const printersRes = await fetchWithRetry(API_ENDPOINTS.PRINTERS.STATUS, { credentials: 'include' });
      if (printersRes.ok) {
        const data = await printersRes.json();
        setPrinters(data.printers || []);
      }

      const statsRes = await fetchWithRetry(API_ENDPOINTS.STATISTICS.HISTORY, { credentials: 'include' });
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats({
          ...data,
          filamentUsed: data.totalWeight || 0,
          totalTime: data.totalTime || 0,
        });
      }

      const historyParams = new URLSearchParams({ limit: '5', source: 'db' });
      const historyRes = await fetchWithRetry(`${API_ENDPOINTS.MODELS.LIST}?${historyParams.toString()}`, { credentials: 'include' });
      if (historyRes.ok) {
        const data = await historyRes.json();
        const raw = data?.hits || data?.models || data || [];
        const normalized = Array.isArray(raw) ? raw : [];
        const recentPrintsData = normalized.slice(0, 5).map((print) => {
          let coverUrl = '';
          if (print.coverUrl) {
            coverUrl = print.coverUrl;
          } else if (print.cover) {
            coverUrl = print.cover.startsWith('http') ? print.cover : `/api${print.cover}`;
          }

          return {
            ...print,
            cover: coverUrl,
            status: typeof print.status === 'string' ? parseInt(print.status, 10) || 0 : (print.status || 0),
          };
        });

        setRecentPrints(recentPrintsData);
      }

      const libraryRes = await fetchWithRetry(API_ENDPOINTS.LIBRARY.LIST, { credentials: 'include' });
      if (libraryRes.ok) {
        const data = await libraryRes.json();
        setLibraryCount(Array.isArray(data) ? data.length : 0);
      }
    } catch {
      // Dashboard gracefully degrades with available data.
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWidgetPrefs = useCallback(async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DASHBOARD_WIDGETS, { credentials: 'include' });
      if (!response.ok) {
        setWidgetPrefs(DEFAULT_PREFS);
        setDraftPrefs(DEFAULT_PREFS);
        return;
      }

      const data = await response.json();
      const nextPrefs = sanitizePrefs(data?.preferences);
      setWidgetPrefs(nextPrefs);
      setDraftPrefs(nextPrefs);
    } catch {
      setWidgetPrefs(DEFAULT_PREFS);
      setDraftPrefs(DEFAULT_PREFS);
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWidgetPrefs();
  }, [loadWidgetPrefs]);

  useEffect(() => {
    void loadDashboardData();
    const interval = window.setInterval(() => {
      void loadDashboardData();
    }, clampRefresh(effectivePrefs.refreshSeconds) * 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [effectivePrefs.refreshSeconds, loadDashboardData]);

  const updateDraft = (updater: (current: DashboardWidgetPrefs) => DashboardWidgetPrefs) => {
    setDraftPrefs((current) => {
      const next = sanitizePrefs(updater(current));
      setPrefsDirty(true);
      return next;
    });
  };

  const savePreferences = async () => {
    setPrefsSaving(true);
    try {
      const payload = sanitizePrefs(draftPrefs);
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DASHBOARD_WIDGETS, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to save preferences');
      }

      const data = await response.json();
      const saved = sanitizePrefs(data?.preferences || payload);
      setWidgetPrefs(saved);
      setDraftPrefs(saved);
      setPrefsDirty(false);
      setIsCustomizeMode(false);
    } catch {
      // Keep draft state and allow retry.
    } finally {
      setPrefsSaving(false);
    }
  };

  const cancelCustomize = () => {
    setDraftPrefs(widgetPrefs);
    setPrefsDirty(false);
    setIsCustomizeMode(false);
  };

  const resetToDefaults = () => {
    updateDraft(() => DEFAULT_PREFS);
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getStatusColor = (status: number) => {
    switch (status) {
      case 2: return '#4ade80';
      case 3: return '#f87171';
      case 1:
      case 4:
        return '#fbbf24';
      default: return '#9ca3af';
    }
  };

  const getStatusText = (status: number) => {
    switch (status) {
      case 1:
      case 4:
        return 'Printing';
      case 2: return 'Success';
      case 3: return 'Failed';
      default: return 'Unknown';
    }
  };

  const statConfigs: Record<StatId, { label: string; value: string; icon: string; onClick?: () => void }> = {
    printersOnline: {
      label: 'Printers Online',
      value: `${onlinePrinters}/${printers.length}`,
      icon: 'PR',
      onClick: () => onNavigate('printers'),
    },
    totalPrints: {
      label: 'Total Prints',
      value: String(stats?.totalPrints || 0),
      icon: 'TP',
      onClick: () => onNavigate('history'),
    },
    successRate: {
      label: 'Success Rate',
      value: `${stats?.successRate?.toFixed(0) || 0}%`,
      icon: 'SR',
      onClick: () => onNavigate('statistics'),
    },
    libraryCount: {
      label: 'Library Models',
      value: String(libraryCount),
      icon: 'LB',
      onClick: () => onNavigate('library'),
    },
  };

  const visibleStats = effectivePrefs.statsOrder.filter((id) => !effectivePrefs.statsHidden.includes(id));
  const visibleWidgets = effectivePrefs.widgetOrder.filter((id) => !effectivePrefs.widgetHidden.includes(id));

  if (loading || prefsLoading) {
    return (
      <div className="dashboard-home loading">
        <div className="loading-spinner"></div>
        <p>Loading operations overview...</p>
      </div>
    );
  }

  return (
    <div className={`dashboard-home density-${effectivePrefs.density}`}>
      <header className="dashboard-header dashboard-header--compact">
        <span className="dashboard-kicker">Operations overview</span>
        {effectivePrefs.showHeaderMeta ? (
          <div className="dashboard-header-meta">
            <span>{onlinePrinters} online now</span>
            <span>{recentPrints.length} recent jobs</span>
            <span>{libraryCount} library assets</span>
          </div>
        ) : null}
      </header>

      <div className="dashboard-toolbar">
        <div className="dashboard-toolbar-left">
          <button
            type="button"
            className="widget-toolbar-btn"
            onClick={() => {
              if (isCustomizeMode) {
                cancelCustomize();
              } else {
                setDraftPrefs(widgetPrefs);
                setPrefsDirty(false);
                setIsCustomizeMode(true);
              }
            }}
          >
            {isCustomizeMode ? 'Exit Customize' : 'Customize Widgets'}
          </button>
          <button type="button" className="widget-toolbar-btn subtle" onClick={() => void loadDashboardData()}>
            Refresh Now
          </button>
        </div>
        <div className="dashboard-toolbar-right">
          <span className="toolbar-note">Auto refresh: {effectivePrefs.refreshSeconds}s</span>
        </div>
      </div>

      {isCustomizeMode ? (
        <section className="dashboard-customize-panel">
          <div className="customize-grid">
            <div className="customize-group">
              <h4>General</h4>
              <div className="customize-row">
                <label>Density</label>
                <select
                  value={draftPrefs.density}
                  onChange={(e) => updateDraft((current) => ({ ...current, density: e.target.value as 'compact' | 'comfortable' }))}
                >
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                </select>
              </div>
              <div className="customize-row">
                <label>Refresh</label>
                <select
                  value={draftPrefs.refreshSeconds}
                  onChange={(e) => updateDraft((current) => ({ ...current, refreshSeconds: clampRefresh(Number(e.target.value)) }))}
                >
                  <option value={15}>15s</option>
                  <option value={30}>30s</option>
                  <option value={60}>60s</option>
                  <option value={120}>120s</option>
                </select>
              </div>
              <div className="customize-row toggle">
                <label>Header Meta</label>
                <input
                  type="checkbox"
                  checked={draftPrefs.showHeaderMeta}
                  onChange={(e) => updateDraft((current) => ({ ...current, showHeaderMeta: e.target.checked }))}
                />
              </div>
            </div>

            <div className="customize-group">
              <h4>Stat Cards</h4>
              {draftPrefs.statsOrder.map((id, index) => (
                <div key={id} className="customize-item-row">
                  <span>{statConfigs[id].label}</span>
                  <div className="item-actions">
                    <button type="button" onClick={() => updateDraft((current) => ({ ...current, statsOrder: moveItem(current.statsOrder, index, -1) }))}>?</button>
                    <button type="button" onClick={() => updateDraft((current) => ({ ...current, statsOrder: moveItem(current.statsOrder, index, 1) }))}>?</button>
                    <button
                      type="button"
                      onClick={() => updateDraft((current) => ({
                        ...current,
                        statsHidden: current.statsHidden.includes(id)
                          ? current.statsHidden.filter((entry) => entry !== id)
                          : [...current.statsHidden, id],
                      }))}
                    >
                      {draftPrefs.statsHidden.includes(id) ? 'Show' : 'Hide'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="customize-group">
              <h4>Widgets</h4>
              {draftPrefs.widgetOrder.map((id, index) => (
                <div key={id} className="customize-item-row">
                  <span>{id}</span>
                  <div className="item-actions">
                    <button type="button" onClick={() => updateDraft((current) => ({ ...current, widgetOrder: moveItem(current.widgetOrder, index, -1) }))}>?</button>
                    <button type="button" onClick={() => updateDraft((current) => ({ ...current, widgetOrder: moveItem(current.widgetOrder, index, 1) }))}>?</button>
                    <button
                      type="button"
                      onClick={() => updateDraft((current) => ({
                        ...current,
                        widgetSpan: {
                          ...current.widgetSpan,
                          [id]: current.widgetSpan[id] === 2 ? 1 : 2,
                        },
                      }))}
                    >
                      {draftPrefs.widgetSpan[id] === 2 ? 'Span 1' : 'Span 2'}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDraft((current) => ({
                        ...current,
                        widgetHidden: current.widgetHidden.includes(id)
                          ? current.widgetHidden.filter((entry) => entry !== id)
                          : [...current.widgetHidden, id],
                      }))}
                    >
                      {draftPrefs.widgetHidden.includes(id) ? 'Show' : 'Hide'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="customize-footer">
            <button type="button" className="widget-toolbar-btn subtle" onClick={resetToDefaults}>Reset Defaults</button>
            <button type="button" className="widget-toolbar-btn subtle" onClick={cancelCustomize}>Cancel</button>
            <button type="button" className="widget-toolbar-btn primary" disabled={!prefsDirty || prefsSaving} onClick={savePreferences}>
              {prefsSaving ? 'Saving...' : 'Save Layout'}
            </button>
          </div>
        </section>
      ) : null}

      <div className="stats-row grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visibleStats.map((id) => {
          const stat = statConfigs[id];
          return (
            <div key={id} className="stat-card" onClick={stat.onClick}>
              <div className="stat-icon">{stat.icon}</div>
              <div className="stat-content">
                <span className="stat-value">{stat.value}</span>
                <span className="stat-label">{stat.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="widgets-grid grid grid-cols-1 gap-3 xl:grid-cols-2">
        {visibleWidgets.map((widgetId) => {
          if (widgetId === 'activePrints' && activePrints.length === 0) {
            return null;
          }

          if (widgetId === 'activePrints') {
            return (
              <div key={widgetId} className={`widget active-prints-widget ${effectivePrefs.widgetSpan.activePrints === 2 ? 'widget-span-2' : ''}`}>
                <div className="widget-header"><h3>Currently Printing</h3></div>
                <div className="widget-content">
                  <div className="active-prints-grid">
                    {activePrints.map((printer) => (
                      <div key={printer.id} className="active-print-card" onClick={() => onNavigate('printers')}>
                        <div className="printer-badge">{printer.name}</div>
                        <div className="print-title">{printer.currentPrint}</div>
                        {printer.progress !== undefined ? (
                          <div className="print-progress-bar">
                            <div className="progress-fill" style={{ width: `${printer.progress}%` }}></div>
                            <span className="progress-text">{printer.progress}%</span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          if (widgetId === 'printers') {
            return (
              <div key={widgetId} className={`widget printers-widget ${effectivePrefs.widgetSpan.printers === 2 ? 'widget-span-2' : ''}`}>
                <div className="widget-header"><h3>Printers</h3></div>
                <div className="widget-content">
                  {printers.length === 0 ? (
                    <div className="widget-empty">
                      <p>No printers configured</p>
                      <button onClick={() => onNavigate('settings')}>Configure Printer</button>
                    </div>
                  ) : (
                    <div className="printers-list">
                      {printers.map((printer) => (
                        <div key={printer.id} className={`printer-item ${printer.online ? 'online' : 'offline'}`} onClick={() => onNavigate('printers')}>
                          <div className="printer-status-dot"></div>
                          <div className="printer-info">
                            <span className="printer-name">{printer.name}</span>
                            <span className="printer-model">{printer.model}</span>
                          </div>
                          {printer.progress !== undefined && printer.progress > 0 ? (
                            <div className="printer-progress">
                              <div className="progress-bar"><div className="progress-fill" style={{ width: `${printer.progress}%` }}></div></div>
                              <span>{printer.progress}%</span>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          if (widgetId === 'recentPrints') {
            return (
              <div key={widgetId} className={`widget recent-prints-widget ${effectivePrefs.widgetSpan.recentPrints === 2 ? 'widget-span-2' : ''}`}>
                <div className="widget-header">
                  <h3>Recent Prints</h3>
                  <button className="widget-action" onClick={() => onNavigate('history')}>View All</button>
                </div>
                <div className="widget-content">
                  {recentPrints.length === 0 ? (
                    <div className="widget-empty">
                      <p>No print history yet</p>
                      <button onClick={() => onNavigate('history')}>Sync Print History</button>
                    </div>
                  ) : (
                    <div className="recent-prints-grid">
                      {recentPrints.slice(0, 5).map((print) => (
                        <div key={print.id} className="recent-print-card" onClick={() => onNavigate('history')}>
                          <div className="recent-print-cover">
                            {print.cover ? <img src={print.cover} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <span className="cover-placeholder">N/A</span>}
                            <span className="print-status-badge" style={{ backgroundColor: getStatusColor(Number(print.status || 0)) }}>
                              {getStatusText(Number(print.status || 0))}
                            </span>
                          </div>
                          <div className="recent-print-info">
                            <span className="recent-print-title">{print.title || 'Untitled'}</span>
                            <span className="recent-print-date">{print.startTime ? new Date(print.startTime).toLocaleDateString() : 'Unknown date'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          if (widgetId === 'quickStats') {
            return (
              <div key={widgetId} className={`widget quick-stats-widget ${effectivePrefs.widgetSpan.quickStats === 2 ? 'widget-span-2' : ''}`}>
                <div className="widget-header">
                  <h3>Statistics</h3>
                  <button className="widget-action" onClick={() => onNavigate('statistics')}>View Details</button>
                </div>
                <div className="widget-content">
                  <div className="quick-stats-grid">
                    <div className="quick-stat">
                      <span className="quick-stat-icon">TM</span>
                      <span className="quick-stat-value">{stats?.totalTime ? formatDuration(stats.totalTime) : '0h'}</span>
                      <span className="quick-stat-label">Print Time</span>
                    </div>
                    <div className="quick-stat">
                      <span className="quick-stat-icon">FL</span>
                      <span className="quick-stat-value">{stats?.filamentUsed ? `${(stats.filamentUsed / 1000).toFixed(1)}kg` : '0g'}</span>
                      <span className="quick-stat-label">Filament</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={widgetId} className={`widget quick-actions-widget ${effectivePrefs.widgetSpan.quickActions === 2 ? 'widget-span-2' : ''}`}>
              <div className="widget-header"><h3>Quick Actions</h3></div>
              <div className="widget-content">
                <div className="quick-actions-grid">
                  <button className="quick-action" onClick={() => onNavigate('library')}><span className="action-icon">UP</span><span>Upload Model</span></button>
                  <button className="quick-action" onClick={() => onNavigate('history')}><span className="action-icon">SY</span><span>Sync Prints</span></button>
                  <button className="quick-action" onClick={() => onNavigate('duplicates')}><span className="action-icon">DP</span><span>Find Duplicates</span></button>
                  <button className="quick-action" onClick={() => onNavigate('maintenance')}><span className="action-icon">MT</span><span>Maintenance</span></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DashboardHome;
