import { useState, useEffect } from 'react';
import './Dashboard.css';

// System diagnostics panel - internal use only
interface InstallData {
  install_id: string;
  version: string;
  platform: string;
  arch: string;
  node_version: string;
  stats: {
    printers: number;
    prints: number;
    library: number;
    users: number;
  };
  features: {
    discord: boolean;
    telegram: boolean;
    watchdog: boolean;
    oauth: boolean;
  };
  timestamp: string;
  last_seen: string;
  first_seen: string;
}

interface AggregateStats {
  total_installs: number;
  active_7d: number;
  active_30d: number;
  total_printers: number;
  total_prints: number;
  total_library: number;
  versions: Record<string, number>;
  platforms: Record<string, number>;
}

function DiagnosticsPanel() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [installs, setInstalls] = useState<InstallData[]>([]);
  const [aggregate, setAggregate] = useState<AggregateStats | null>(null);
  const [view, setView] = useState<'overview' | 'installs'>('overview');

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    try {
      const res = await fetch('/api/internal/diag/auth', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.authorized) {
          setAuthorized(true);
          loadData();
        }
      }
    } catch (e) {
      // Silent
    }
    setLoading(false);
  };

  const loadData = async () => {
    try {
      const [installsRes, aggregateRes] = await Promise.all([
        fetch('/api/internal/diag/data', { credentials: 'include' }),
        fetch('/api/internal/diag/summary', { credentials: 'include' })
      ]);
      
      if (installsRes.ok) {
        const data = await installsRes.json();
        setInstalls(data.installs || []);
      }
      
      if (aggregateRes.ok) {
        const data = await aggregateRes.json();
        setAggregate(data);
      }
    } catch (e) {
      console.error('Failed to load diagnostics');
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
  };

  const getTimeSince = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffHours = Math.floor((now - then) / (1000 * 60 * 60));
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  if (loading) {
    return <div className="dashboard-container"><p>Loading...</p></div>;
  }

  if (!authorized) {
    return (
      <div className="dashboard-container">
        <h1>404 - Page Not Found</h1>
        <p>The page you're looking for doesn't exist.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>📊 Telemetry Dashboard</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Anonymous install statistics</p>
      </div>

      <div className="dashboard-tabs" style={{ marginBottom: '20px' }}>
        <button 
          className={`tab-btn ${view === 'overview' ? 'active' : ''}`}
          onClick={() => setView('overview')}
          style={{ marginRight: '10px', padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: view === 'overview' ? 'var(--accent-color)' : 'var(--card-bg)', color: view === 'overview' ? '#fff' : 'var(--text-primary)' }}
        >
          Overview
        </button>
        <button 
          className={`tab-btn ${view === 'installs' ? 'active' : ''}`}
          onClick={() => setView('installs')}
          style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: view === 'installs' ? 'var(--accent-color)' : 'var(--card-bg)', color: view === 'installs' ? '#fff' : 'var(--text-primary)' }}
        >
          All Installs ({installs.length})
        </button>
      </div>

      {view === 'overview' && aggregate && (
        <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div className="stat-card" style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: 'var(--accent-color)' }}>{aggregate.total_installs}</div>
            <div style={{ color: 'var(--text-secondary)' }}>Total Installs</div>
          </div>
          <div className="stat-card" style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#10b981' }}>{aggregate.active_7d}</div>
            <div style={{ color: 'var(--text-secondary)' }}>Active (7 days)</div>
          </div>
          <div className="stat-card" style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#f59e0b' }}>{aggregate.active_30d}</div>
            <div style={{ color: 'var(--text-secondary)' }}>Active (30 days)</div>
          </div>
          <div className="stat-card" style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#8b5cf6' }}>{aggregate.total_printers}</div>
            <div style={{ color: 'var(--text-secondary)' }}>Total Printers</div>
          </div>
          <div className="stat-card" style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#ec4899' }}>{aggregate.total_prints}</div>
            <div style={{ color: 'var(--text-secondary)' }}>Total Prints</div>
          </div>
          <div className="stat-card" style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#06b6d4' }}>{aggregate.total_library}</div>
            <div style={{ color: 'var(--text-secondary)' }}>Library Items</div>
          </div>
        </div>
      )}

      {view === 'overview' && aggregate && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px' }}>
            <h3 style={{ marginBottom: '12px' }}>Versions</h3>
            {Object.entries(aggregate.versions || {}).sort((a, b) => b[1] - a[1]).map(([version, count]) => (
              <div key={version} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
                <span>v{version}</span>
                <span style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>{count}</span>
              </div>
            ))}
          </div>
          <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px' }}>
            <h3 style={{ marginBottom: '12px' }}>Platforms</h3>
            {Object.entries(aggregate.platforms || {}).sort((a, b) => b[1] - a[1]).map(([platform, count]) => (
              <div key={platform} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
                <span>{platform}</span>
                <span style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'installs' && (
        <div style={{ background: 'var(--card-bg)', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}>
                <th style={{ padding: '12px' }}>Install ID</th>
                <th style={{ padding: '12px' }}>Version</th>
                <th style={{ padding: '12px' }}>Platform</th>
                <th style={{ padding: '12px' }}>Printers</th>
                <th style={{ padding: '12px' }}>Prints</th>
                <th style={{ padding: '12px' }}>Library</th>
                <th style={{ padding: '12px' }}>Last Seen</th>
                <th style={{ padding: '12px' }}>First Seen</th>
              </tr>
            </thead>
            <tbody>
              {installs.map((install) => (
                <tr key={install.install_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '12px' }}>{install.install_id.substring(0, 8)}...</td>
                  <td style={{ padding: '12px' }}>{install.version}</td>
                  <td style={{ padding: '12px' }}>{install.platform}/{install.arch}</td>
                  <td style={{ padding: '12px' }}>{install.stats?.printers || 0}</td>
                  <td style={{ padding: '12px' }}>{install.stats?.prints || 0}</td>
                  <td style={{ padding: '12px' }}>{install.stats?.library || 0}</td>
                  <td style={{ padding: '12px' }}>{getTimeSince(install.last_seen)}</td>
                  <td style={{ padding: '12px' }}>{formatDate(install.first_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: '20px', padding: '12px', background: 'var(--card-bg)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
        <strong>Note:</strong> Data is fetched from your telemetry endpoint. Make sure the backend at 3d.tr1ck.dev is configured to store and serve this data.
      </div>
    </div>
  );
}

export default DiagnosticsPanel;
