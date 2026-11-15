import ProgressBar from '../../common/ProgressBar';
import { Pill, type Tone } from '../primitives';

export interface QueuePressureSummary {
  pressureScore: number;
  activePrints: number;
  activeJobs: number;
  overdueTasks: number;
  offlinePrinters: number;
  recommendation: string;
}

interface QueuePressureWidgetProps {
  summary: QueuePressureSummary;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function QueuePressureWidget({ summary }: QueuePressureWidgetProps) {
  const score = Math.max(0, Math.min(100, summary.pressureScore || 0));
  const level: { label: string; tone: Tone } = score >= 75
    ? { label: 'High', tone: 'danger' }
    : score >= 45
      ? { label: 'Moderate', tone: 'warning' }
      : { label: 'Healthy', tone: 'success' };

  // The score is derived; say what is driving it instead of re-listing counters.
  const drivers = [
    summary.offlinePrinters > 0 ? `${plural(summary.offlinePrinters, 'printer')} offline` : null,
    summary.overdueTasks > 0 ? `${plural(summary.overdueTasks, 'task')} overdue` : null,
    summary.activePrints > 0 ? `${plural(summary.activePrints, 'print')} running` : null,
    summary.activeJobs > 0 ? `${plural(summary.activeJobs, 'background job')}` : null,
  ].filter(Boolean);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xl font-semibold leading-8 tracking-tight tabular-nums text-fg">
          {score}
          <span className="text-sm font-medium text-muted">/100</span>
        </p>
        <Pill tone={level.tone}>{level.label}</Pill>
      </div>
      <ProgressBar
        value={score}
        tone={level.tone === 'danger' ? 'danger' : level.tone === 'warning' ? 'warning' : 'success'}
        size="xs"
        className="mt-2"
      />
      <p className="mt-3 text-xs leading-5 text-fg-soft">{summary.recommendation}</p>
      {drivers.length > 0 ? (
        <p className="text-xs leading-5 text-muted">Driven by {drivers.join(', ')}.</p>
      ) : null}
    </div>
  );
}

export default QueuePressureWidget;
