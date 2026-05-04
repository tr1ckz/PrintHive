import { useState } from 'react';

export interface BackupTelemetrySummary {
  scheduleEnabled: boolean;
  intervalDays: number;
  retentionDays: number;
  remoteEnabled: boolean;
  lastBackupLabel: string;
}

interface BackupTelemetryWidgetProps {
  summary: BackupTelemetrySummary;
}

function BackupTelemetryWidget({ summary }: BackupTelemetryWidgetProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-white/15 bg-white/[0.03] p-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Schedule</p>
          <p className="mt-1 text-xs font-semibold text-white/90">{summary.scheduleEnabled ? 'Enabled' : 'Disabled'}</p>
        </div>
        <div className="rounded border border-white/15 bg-white/[0.03] p-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Remote</p>
          <p className="mt-1 text-xs font-semibold text-white/90">{summary.remoteEnabled ? 'Enabled' : 'Disabled'}</p>
        </div>
        <div className="rounded border border-white/15 bg-white/[0.03] p-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Interval</p>
          <p className="mt-1 text-xs font-semibold text-white/90">{summary.intervalDays}d</p>
        </div>
        <div className="rounded border border-white/15 bg-white/[0.03] p-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Retention</p>
          <p className="mt-1 text-xs font-semibold text-white/90">{summary.retentionDays}d</p>
        </div>
      </div>

      <div className="rounded border border-white/15 bg-black/20 p-2">
        <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Last backup</p>
        <p className="mt-1 text-xs font-semibold text-white/90">{summary.lastBackupLabel}</p>
      </div>

      <button
        type="button"
        onClick={() => setShowDetails((current) => !current)}
        className="mt-auto rounded border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/80 hover:border-white/35"
      >
        {showDetails ? 'Hide Details' : 'Show Details'}
      </button>

      {showDetails ? (
        <div className="rounded border border-white/15 bg-black/25 p-2 text-[10px] uppercase tracking-[0.08em] text-white/60">
          Remote upload {summary.remoteEnabled ? 'enabled' : 'disabled'}, schedule runs every {summary.intervalDays} days with {summary.retentionDays}-day retention.
        </div>
      ) : null}
    </div>
  );
}

export default BackupTelemetryWidget;
