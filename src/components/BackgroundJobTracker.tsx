import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';

interface JobStatus {
  name: string;
  type: 'video-match' | 'library-scan' | 'auto-tag' | 'bulk-delete';
  running: boolean;
  total: number;
  processed: number;
  completedCount: number;
  failedCount: number;
  elapsedTime: number;
}

const BackgroundJobTracker: React.FC = () => {
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // Poll fast (2s) only while jobs are active; back off to 10s when idle so the
  // component isn't firing 4 requests/second around the clock.
  const ACTIVE_INTERVAL = 2000;
  const IDLE_INTERVAL = 10000;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const tick = async () => {
      const hasActiveJobs = await checkAllJobs();
      if (cancelled) return;
      timer = setTimeout(tick, hasActiveJobs ? ACTIVE_INTERVAL : IDLE_INTERVAL);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const checkAllJobs = async (): Promise<boolean> => {
    try {
      const statuses = await Promise.all([
        fetchJobStatus('video-match', API_ENDPOINTS.VIDEO.MATCH_STATUS),
        fetchJobStatus('library-scan', API_ENDPOINTS.LIBRARY.SCAN_STATUS),
        fetchJobStatus('auto-tag', API_ENDPOINTS.LIBRARY.AUTO_TAG_STATUS),
        fetchJobStatus('bulk-delete', API_ENDPOINTS.LIBRARY.BULK_DELETE_STATUS),
      ]);

      const active = statuses.filter(s => s !== null) as JobStatus[];
      setJobs(active);
      return active.length > 0;
    } catch (error) {
      console.error('Failed to check background jobs:', error);
      return false;
    }
  };

  const fetchJobStatus = async (
    type: string,
    endpoint: string
  ): Promise<JobStatus | null> => {
    try {
      const response = await fetchWithRetry(endpoint, { credentials: 'include' });
      if (!response.ok) return null;

      const data = await response.json();

      if (!data.running) return null;

      const jobNames: Record<string, string> = {
        'video-match': '🎬 Video Matching',
        'library-scan': '📚 Library Scan',
        'auto-tag': '🏷️ Auto-Tag',
        'bulk-delete': '🗑️ Bulk Delete'
      };

      return {
        name: jobNames[type] || type,
        type: type as JobStatus['type'],
        running: data.running || false,
        total: data.total || 0,
        processed: data.processed || 0,
        completedCount: data.completed || data.matched || data.added || data.deleted || 0,
        failedCount: data.failed || data.unmatched || data.skipped || 0,
        elapsedTime: data.elapsedTime || 0
      };
    } catch {
      return null;
    }
  };

  const cancelJob = async (type: string) => {
    const endpoints: Record<string, string> = {
      'video-match': API_ENDPOINTS.VIDEO.MATCH_CANCEL,
      'library-scan': API_ENDPOINTS.LIBRARY.SCAN_CANCEL,
      'auto-tag': API_ENDPOINTS.LIBRARY.AUTO_TAG_CANCEL,
      'bulk-delete': API_ENDPOINTS.LIBRARY.BULK_DELETE_CANCEL,
    };

    try {
      await fetchWithRetry(endpoints[type], { method: 'POST', credentials: 'include' });
      await checkAllJobs();
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  if (jobs.length === 0) {
    return null;
  }

  const activeJobCount = jobs.length;

  return (
    <div className="fixed bottom-20 right-4 z-[999] md:bottom-6 md:right-6">
      <button
        className="relative flex size-14 items-center justify-center rounded-full bg-accent text-2xl text-accent-contrast shadow-lg transition-transform hover:scale-105"
        onClick={() => setIsExpanded(!isExpanded)}
        title={`${activeJobCount} background job${activeJobCount !== 1 ? 's' : ''} running`}
        aria-label="Background jobs"
      >
        <span className="animate-[ph-spin_2s_linear_infinite]">⚙️</span>
        <span className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-danger text-xs font-bold text-white ring-2 ring-base">
          {activeJobCount}
        </span>
      </button>

      {isExpanded && (
        <div className="absolute bottom-[70px] right-0 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-elevated shadow-xl backdrop-blur animate-[ph-fade-up_0.2s_var(--ease-out)]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-fg">Background Jobs</h3>
            <button
              className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/5 hover:text-fg"
              onClick={() => setIsExpanded(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="max-h-[360px] divide-y divide-line overflow-y-auto">
            {jobs.map((job) => (
              <div key={job.type} className="flex flex-col gap-3 p-4">
                <div className="text-sm font-semibold text-fg">{job.name}</div>

                <div className="flex justify-between gap-2 text-xs tabular-nums text-muted">
                  <span className="whitespace-nowrap">
                    {job.processed} / {job.total}
                  </span>
                  <span className="whitespace-nowrap">
                    {job.completedCount} done, {job.failedCount} failed
                  </span>
                  <span className="ml-auto whitespace-nowrap">
                    {job.elapsedTime}s
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-300"
                      style={{
                        width: `${job.total > 0 ? (job.processed / job.total) * 100 : 0}%`
                      }}
                    ></div>
                  </div>
                  <span className="min-w-[35px] text-right text-xs font-semibold tabular-nums text-fg-soft">
                    {Math.round(job.total > 0 ? (job.processed / job.total) * 100 : 0)}%
                  </span>
                </div>

                <button
                  className="inline-flex min-h-9 items-center self-start rounded bg-danger/15 px-3 text-xs font-semibold text-danger transition-colors hover:bg-danger/25"
                  onClick={() => cancelJob(job.type)}
                  title="Cancel this job"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BackgroundJobTracker;
