import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';
import LoadingScreen from './LoadingScreen';
import { formatNumber, formatCurrency, formatWeight, formatDuration, formatPercentage } from '../utils/formatters';
import { exportToCSV } from '../utils/csvExport';
import { useRealtimeTick } from '../hooks/useRealtimeTick';

interface StatisticsData {
  totalPrints: number;
  successRate: number;
  failedPrints: number;
  totalWeight: number;
  totalLength: number;
  totalTime: number;
  materialsByColor: { [color: string]: { weight: number; length: number; count: number; type: string; name?: string | null } };
  materialsByType: { [type: string]: { weight: number; length: number; count: number } };
  printsByStatus: { [status: string]: number };
  printsByPrinter: { [printer: string]: number };
  averagePrintTime: number;
}

interface CostData {
  totalCost: number;
  filamentCost: number;
  electricityCost: number;
  filamentUsedKg: number;
  printTimeHours: number;
  currency: string;
  settings: {
    filamentCostPerKg: number;
    electricityCostPerKwh: number;
    printerWattage: number;
  };
}

interface MaterialRowData {
  key: string;
  css: string;
  name: string;
  type: string;
  count: number;
  weight: number;
  length: number;
  percent: number;
}

interface StatusRowData {
  key: string;
  label: string;
  count: number;
  percent: number;
  statusClass: string;
}

interface PrinterRowData {
  printer: string;
  prints: number;
  percentOfTotal: number;
}

const formatColorHex = (colorHex: string) => {
  if (!colorHex || colorHex === 'Unknown' || colorHex === 'undefined' || colorHex === 'null') {
    return { css: '#94a3b8', name: 'Unknown' };
  }

  const rgb = colorHex.substring(0, 6);
  const cssColor = `#${rgb}`;

  const colorNames: { [key: string]: string } = {
    '000000': 'Black',
    'FFFFFF': 'White',
    'F98C36': 'Orange',
    'F99963': 'Light Orange',
    'CBC6B8': 'Beige',
    '898989': 'Gray',
    '575757': 'Dark Gray',
    'DE4343': 'Red',
    'BC0900': 'Dark Red',
    '61C680': 'Green',
    '00AE42': 'Green',
    '1F79E5': 'Blue',
    '0078BF': 'Blue',
    '002E96': 'Dark Blue',
    '042F56': 'Navy',
    'E8AFCF': 'Pink',
    'AE96D4': 'Purple',
    'A3D8E1': 'Light Blue',
    'F4EE2A': 'Yellow',
    '7D6556': 'Brown'
  };

  const name = colorNames[rgb.toUpperCase()] || cssColor;
  return { css: cssColor, name };
};

const STATS_CACHE_KEY = 'bambu_stats_cache';
const COSTS_CACHE_KEY = 'bambu_costs_cache';

const Statistics: React.FC = () => {
  const [stats, setStats] = useState<StatisticsData | null>(() => {
    try {
      const cached = sessionStorage.getItem(STATS_CACHE_KEY);
      return cached ? (JSON.parse(cached) as StatisticsData) : null;
    } catch {
      return null;
    }
  });
  const [costs, setCosts] = useState<CostData | null>(() => {
    try {
      const cached = sessionStorage.getItem(COSTS_CACHE_KEY);
      return cached ? (JSON.parse(cached) as CostData) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      return !sessionStorage.getItem(STATS_CACHE_KEY);
    } catch {
      return true;
    }
  });
  const [error, setError] = useState('');

  const fetchStatistics = useCallback(async () => {
    try {
      if (!stats) setLoading(true);
      setError('');
      
      const [statsRes, costsRes] = await Promise.all([
        fetchWithRetry(API_ENDPOINTS.STATISTICS.HISTORY, { credentials: 'include' }),
        fetchWithRetry(API_ENDPOINTS.STATISTICS.COSTS, { credentials: 'include' })
      ]);
      
      if (!statsRes.ok) throw new Error('Failed to fetch statistics');
      
      const statsData = await statsRes.json();
      setStats(statsData);
      try { sessionStorage.setItem(STATS_CACHE_KEY, JSON.stringify(statsData)); } catch { /* noop */ }
      
      if (costsRes.ok) {
        const costsData = await costsRes.json();
        setCosts(costsData);
        try { sessionStorage.setItem(COSTS_CACHE_KEY, JSON.stringify(costsData)); } catch { /* noop */ }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatistics();
  }, [fetchStatistics]);

  useRealtimeTick(() => {
    void fetchStatistics();
  }, { minIntervalMs: 12000 });

  const materialRows = useMemo<MaterialRowData[]>(() => {
    if (!stats) return [];

    return Object.entries(stats.materialsByColor)
      .filter(([color, data]) => color && data && data.weight)
      .map(([color, data]) => {
        const { css, name } = formatColorHex(color);
        return {
          key: color,
          css,
          // Prefer the Bambu catalog name resolved server-side; fall back to the
          // local generic map only when the hex isn't a known Bambu colour.
          name: data.name || name,
          type: data.type || 'Unknown',
          count: data.count,
          weight: data.weight,
          length: data.length,
          percent: stats.totalWeight ? (data.weight / stats.totalWeight) * 100 : 0
        };
      })
      .sort((a, b) => b.weight - a.weight);
  }, [stats]);

  const topMaterialRows = useMemo(() => materialRows.slice(0, 10), [materialRows]);

  const statusRows = useMemo<StatusRowData[]>(() => {
    if (!stats) return [];

    return Object.entries(stats.printsByStatus)
      .filter(([status]) => status && status !== 'undefined' && status !== 'null')
      .map(([status, count]) => ({
        key: status,
        label: status.toUpperCase(),
        count,
        percent: stats.totalPrints ? (count / stats.totalPrints) * 100 : 0,
        statusClass: status.toLowerCase().replace(/\s+/g, '-')
      }));
  }, [stats]);

  const printerRows = useMemo<PrinterRowData[]>(() => {
    if (!stats) return [];

    return Object.entries(stats.printsByPrinter)
      .map(([printer, count]) => ({
        printer,
        prints: count,
        percentOfTotal: stats.totalPrints ? Number(((count / stats.totalPrints) * 100).toFixed(2)) : 0
      }))
      .sort((a, b) => b.prints - a.prints);
  }, [stats]);

  const handleExportMaterialsCSV = useCallback(() => {
    if (!materialRows.length) return;

    exportToCSV(
      materialRows.map((row) => ({
        colorName: row.name,
        colorHex: row.css,
        materialType: row.type,
        prints: row.count,
        weightGrams: Number(row.weight.toFixed(2)),
        lengthMm: Number(row.length.toFixed(2))
      })),
      [
        { header: 'Color', accessor: 'colorName' },
        { header: 'Hex', accessor: 'colorHex' },
        { header: 'Material', accessor: 'materialType' },
        { header: 'Prints', accessor: 'prints' },
        { header: 'Weight (g)', accessor: 'weightGrams' },
        { header: 'Length (mm)', accessor: 'lengthMm' },
      ],
      'materials_by_color'
    );
  }, [materialRows]);

  const handleExportPrintersCSV = useCallback(() => {
    if (!printerRows.length) return;

    exportToCSV(
      printerRows,
      [
        { header: 'Printer', accessor: 'printer' },
        { header: 'Prints', accessor: 'prints' },
        { header: 'Percent of Total', accessor: 'percentOfTotal' },
      ],
      'prints_by_printer'
    );
  }, [printerRows]);

  if (loading) {
    return <LoadingScreen message="Loading statistics..." />;
  }

  if (error || !stats) {
    return <div className="rounded-md bg-danger/10 p-4 text-sm text-danger">{error || 'No data available'}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <button onClick={fetchStatistics} className="inline-flex min-h-11 md:min-h-9 items-center gap-2 rounded-md bg-white/5 px-3 text-sm font-semibold text-fg-soft transition-colors hover:bg-white/10 hover:text-fg">
          <span>🔄</span> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div className="col-span-2 md:col-span-3 xl:col-span-6 rounded-lg bg-card p-5 shadow-sm ring-1 ring-accent/20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="text-2xl font-semibold tabular-nums tracking-tight text-fg">{formatNumber(stats.totalPrints)}</div>
              <div className="mt-0.5 text-xs text-muted">Total prints recorded</div>
            </div>
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">{formatPercentage(stats.successRate, 1)} success</span>
              <div className="flex gap-3 text-xs tabular-nums text-muted">
                <span>{formatNumber(stats.failedPrints)} failed</span>
                <span>{formatDuration(stats.averagePrintTime)} avg</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="text-lg text-accent">✓</div>
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-fg">{formatPercentage(stats.successRate, 1)}</div>
            <div className="mt-0.5 text-xs text-muted">Success Rate</div>
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="text-lg text-accent">✕</div>
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-fg">{formatNumber(stats.failedPrints)}</div>
            <div className="mt-0.5 text-xs text-muted">Failed Prints</div>
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="text-lg text-accent">⏱</div>
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-fg">{formatDuration(stats.totalTime)}</div>
            <div className="mt-0.5 text-xs text-muted">Total Print Time</div>
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="text-lg text-accent">⚖</div>
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-fg">{formatWeight(stats.totalWeight, 2)}</div>
            <div className="mt-0.5 text-xs text-muted">Total Material</div>
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="text-lg text-accent">⌚</div>
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-fg">{formatDuration(stats.averagePrintTime)}</div>
            <div className="mt-0.5 text-xs text-muted">Avg Print Time</div>
          </div>
        </div>
      </div>

      {/* Cost Calculator Section */}
      {costs && (
        <div className="space-y-3 [&>h2]:text-sm [&>h2]:font-semibold [&>h2]:text-fg">
          <h2>💰 Cost Calculator</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-start gap-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-accent/20">
              <div className="text-lg">💵</div>
              <div className="min-w-0">
                <div className="text-xl font-semibold tabular-nums text-fg">
                  {formatCurrency(costs.totalCost)}
                </div>
                <div className="text-xs text-muted">Total Cost</div>
              </div>
            </div>
            
            <div className="flex items-start gap-3 rounded-lg bg-card p-4 shadow-sm">
              <div className="text-lg">🧵</div>
              <div className="min-w-0">
                <div className="text-xl font-semibold tabular-nums text-fg">
                  {formatCurrency(costs.filamentCost)}
                </div>
                <div className="text-xs text-muted">Filament Cost</div>
                <div className="mt-0.5 text-xs tabular-nums text-fg-faint">{formatWeight(costs.filamentUsedKg * 1000, 2)} used</div>
              </div>
            </div>
            
            <div className="flex items-start gap-3 rounded-lg bg-card p-4 shadow-sm">
              <div className="text-lg">⚡</div>
              <div className="min-w-0">
                <div className="text-xl font-semibold tabular-nums text-fg">
                  {formatCurrency(costs.electricityCost)}
                </div>
                <div className="text-xs text-muted">Electricity Cost</div>
                <div className="mt-0.5 text-xs tabular-nums text-fg-faint">{formatNumber(costs.printTimeHours, 0)}h total</div>
              </div>
            </div>
            
            <div className="rounded-lg bg-card p-4 shadow-sm">
              <div className="min-w-0">
                <div className="text-xs text-muted">Current Settings</div>
                <div className="mt-1.5 flex flex-col gap-0.5 text-xs tabular-nums text-fg-soft">
                  <span>Filament: {formatCurrency(costs.settings.filamentCostPerKg, false)}/kg</span>
                  <span>Electricity: {formatCurrency(costs.settings.electricityCostPerKwh)}/kWh</span>
                  <span>Printer: {costs.settings.printerWattage}W</span>
                </div>
                <div className="mt-2 text-[11px] text-muted">Configure in Settings → Cost Calculator</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-lg bg-card p-4 sm:p-5 shadow-sm [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg">
          <div className="mb-3 flex items-center justify-between gap-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg">
            <h3>Material by Color</h3>
            <button onClick={handleExportMaterialsCSV} className="inline-flex size-11 md:size-8 items-center justify-center rounded-md bg-white/5 text-sm transition-colors hover:bg-white/10" title="Export to CSV">
              📊
            </button>
          </div>
          <div className="space-y-3">
            {topMaterialRows.map((row) => (
              <div key={row.key} className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div
                    className="size-4 shrink-0 rounded-full shadow-sm"
                    style={{ background: row.css }}
                  ></div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fg">{row.name} ({row.type})</div>
                    <div className="text-xs tabular-nums text-muted">
                      {row.count} prints • {formatWeight(row.weight, 1)} • {formatNumber(row.length, 1)}mm
                    </div>
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${row.percent}%`,
                      background: row.css
                    }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 sm:p-5 shadow-sm [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg">
          <h3>Prints by Status</h3>
          <div className="mt-3 space-y-3">
            {statusRows.map((row) => (
              <div key={row.key} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${row.statusClass === 'success' ? 'text-success' : row.statusClass === 'failed' ? 'text-danger' : 'text-fg-soft'}`}>
                    {row.label || 'UNKNOWN'}
                  </span>
                  <span className="text-xs tabular-nums text-muted">{row.count}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${row.statusClass === 'success' ? 'bg-success' : row.statusClass === 'failed' ? 'bg-danger' : 'bg-white/25'}`}
                    style={{ width: `${row.percent}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 sm:p-5 shadow-sm [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg">
          <div className="mb-3 flex items-center justify-between gap-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg">
            <h3>Prints by Printer</h3>
            <button onClick={handleExportPrintersCSV} className="inline-flex size-11 md:size-8 items-center justify-center rounded-md bg-white/5 text-sm transition-colors hover:bg-white/10" title="Export to CSV">
              📊
            </button>
          </div>
          <div className="space-y-3">
            {printerRows.map((row) => (
              <div key={row.printer} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">{row.printer}</span>
                  <span className="text-xs tabular-nums text-muted">{row.prints}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-500"
                    style={{ width: `${row.percentOfTotal}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Statistics;
