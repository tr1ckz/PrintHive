import React, { useState, useEffect } from 'react';
import './BackgroundJobTracker.css';
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

  useEffect(() => {
    const interval = setInterval(checkAllJobs, 1000);
    return () => clearInterval(interval);
  }, []);

  const checkAllJobs = async () => {
    try {
      const statuses = await Promise.all([
        fetchJobStatus('video-match', API_ENDPOINTS.VIDEO.MATCH_STATUS),
        fetchJobStatus('library-scan', API_ENDPOINTS.LIBRARY.SCAN_STATUS),
        fetchJobStatus('auto-tag', API_ENDPOINTS.LIBRARY.AUTO_TAG_STATUS),
        fetchJobStatus('bulk-delete', API_ENDPOINTS.LIBRARY.BULK_DELETE_STATUS),
      ]);

      setJobs(statuses.filter(s => s !== null) as JobStatus[]);
    } catch (error) {
      console.error('Failed to check background jobs:', error);
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
    <div className="background-job-tracker">
      <button
        className="tracker-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        title={`${activeJobCount} background job${activeJobCount !== 1 ? 's' : ''} running`}
      >
        <span className="job-indicator">⚙️</span>
        <span className="job-count">{activeJobCount}</span>
      </button>

      {isExpanded && (
        <div className="tracker-panel">
          <div className="tracker-header">
            <h3>Background Jobs</h3>
            <button
              className="tracker-close"
              onClick={() => setIsExpanded(false)}
            >
              ✕
            </button>
          </div>

          <div className="tracker-jobs">
            {jobs.map((job) => (
              <div key={job.type} className="job-item">
                <div className="job-title">{job.name}</div>

                <div className="job-details">
                  <span className="detail">
                    {job.processed} / {job.total}
                  </span>
                  <span className="detail">
                    {job.completedCount} done, {job.failedCount} failed
                  </span>
                  <span className="detail time">
                    {job.elapsedTime}s
                  </span>
                </div>

                <div className="job-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${job.total > 0 ? (job.processed / job.total) * 100 : 0}%`
                      }}
                    ></div>
                  </div>
                  <span className="progress-text">
                    {Math.round(job.total > 0 ? (job.processed / job.total) * 100 : 0)}%
                  </span>
                </div>

                <button
                  className="btn-job-cancel"
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
