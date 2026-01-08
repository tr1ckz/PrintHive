import React, { useState, useEffect } from 'react';
import './DashboardHome.css';

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
  status: number;
  startTime: string;
  deviceName: string;
}

interface DashboardStats {
  totalPrints: number;
  successRate: number;
  totalTime: number;
  filamentUsed: number;
  recentPrints: RecentPrint[];
}

interface DashboardHomeProps {
  onNavigate: (tab: string) => void;
}

const DashboardHome: React.FC<DashboardHomeProps> = ({ onNavigate }) => {
  const [printers, setPrinters] = useState<PrinterStatus[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentPrints, setRecentPrints] = useState<RecentPrint[]>([]);
  const [libraryCount, setLibraryCount] = useState(0);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadDashboardData = async () => {
    try {
      // Load printers
      const printersRes = await fetch('/api/printers/status');
      if (printersRes.ok) {
        const data = await printersRes.json();
        setPrinters(data.printers || []);
      }

      // Load stats
      const statsRes = await fetch('/api/statistics');
      if (statsRes.ok) {
        const data = await statsRes.json();
        // Map API response to expected interface
        setStats({
          ...data,
          filamentUsed: data.totalWeight || 0,
          totalTime: data.totalTime || 0
        });
      }

      // Load recent prints
      const historyRes = await fetch('/api/prints?limit=5');
      if (historyRes.ok) {
        const data = await historyRes.json();
        setRecentPrints(data.slice(0, 5));
      }

      // Load library count
      const libraryRes = await fetch('/api/library');
      if (libraryRes.ok) {
        const data = await libraryRes.json();
        setLibraryCount(data.length);
      }
    } catch (error) {
      // Silently fail - dashboard will show 0s
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getStatusColor = (status: number) => {
    switch (status) {
      case 2: return '#4ade80'; // Success - green
      case 3: return '#f87171'; // Failed - red
      case 1: return '#fbbf24'; // In progress - yellow
      default: return '#888';
    }
  };

  const getStatusText = (status: number) => {
    switch (status) {
      case 1: return 'In Progress';
      case 2: return 'Success';
      case 3: return 'Failed';
      case 4: return 'Cancelled';
      default: return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div className="dashboard-home loading">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-home">
      {/* Quick Stats Row */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon">🖨️</div>
          <div className="stat-content">
            <span className="stat-value">{printers.filter(p => p.online).length}/{printers.length}</span>
            <span className="stat-label">Printers Online</span>
          </div>
        </div>
        
        <div className="stat-card" onClick={() => onNavigate('history')}>
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <span className="stat-value">{stats?.totalPrints || 0}</span>
            <span className="stat-label">Total Prints</span>
          </div>
        </div>
        
        <div className="stat-card" onClick={() => onNavigate('statistics')} style={{ cursor: 'pointer' }}>
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <span className="stat-value">{stats?.successRate?.toFixed(0) || 0}%</span>
            <span className="stat-label">Success Rate</span>
          </div>
        </div>
        
        <div className="stat-card" onClick={() => onNavigate('library')}>
          <div className="stat-icon">📚</div>
          <div className="stat-content">
            <span className="stat-value">{libraryCount}</span>
            <span className="stat-label">Library Models</span>
          </div>
        </div>
      </div>

      {/* Main Widgets Grid */}
      <div className="widgets-grid">
        {/* Printers Widget */}
        <div className="widget printers-widget">
          <div className="widget-header">
            <h3>🖨️ Printers</h3>
          </div>
          <div className="widget-content">
            {printers.length === 0 ? (
              <div className="widget-empty">
                <p>No printers configured</p>
                <button onClick={() => onNavigate('settings')}>Configure Printer</button>
              </div>
            ) : (
              <div className="printers-list">
                {printers.map(printer => (
                  <div 
                    key={printer.id} 
                    className={`printer-item ${printer.online ? 'online' : 'offline'}`}
                    onClick={() => onNavigate('printers')}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="printer-status-dot"></div>
                    <div className="printer-info">
                      <span className="printer-name">{printer.name}</span>
                      <span className="printer-model">{printer.model}</span>
                    </div>
                    {printer.progress !== undefined && printer.progress > 0 && (
                      <div className="printer-progress">
                        <div className="progress-bar">
                          <div className="progress-fill" style={{ width: `${printer.progress}%` }}></div>
                        </div>
                        <span>{printer.progress}%</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Prints Widget */}
        <div className="widget recent-prints-widget">
          <div className="widget-header">
            <h3>📜 Recent Prints</h3>
            <button className="widget-action" onClick={() => onNavigate('history')}>View All →</button>
          </div>
          <div className="widget-content">
            {recentPrints.length === 0 ? (
              <div className="widget-empty">
                <p>No print history yet</p>
                <button onClick={() => onNavigate('history')}>Sync Print History</button>
              </div>
            ) : (
              <div className="recent-prints-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: '900px', margin: '0 auto' }}>
                {recentPrints.slice(0, 3).map(print => (
                  <div key={print.id} className="recent-print-card" onClick={() => onNavigate('history')}>
                    <div className="recent-print-cover">
                      {print.cover ? (
                        <img src={print.cover} alt="" />
                      ) : (
                        <span className="cover-placeholder">📦</span>
                      )}
                      <span 
                        className="print-status-badge" 
                        style={{ backgroundColor: getStatusColor(print.status) }}
                      >
                        {getStatusText(print.status)}
                      </span>
                    </div>
                    <div className="recent-print-info">
                      <span className="recent-print-title">{print.title || 'Untitled'}</span>
                      <span className="recent-print-date">{new Date(print.startTime).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Stats Widget */}
        <div className="widget quick-stats-widget">
          <div className="widget-header">
            <h3>📈 Statistics</h3>
            <button className="widget-action" onClick={() => onNavigate('statistics')}>View Details →</button>
          </div>
          <div className="widget-content">
            <div className="quick-stats-grid">
              <div className="quick-stat">
                <span className="quick-stat-icon">⏱️</span>
                <span className="quick-stat-value">
                  {stats?.totalTime ? formatDuration(stats.totalTime) : '0h'}
                </span>
                <span className="quick-stat-label">Print Time</span>
              </div>
              <div className="quick-stat">
                <span className="quick-stat-icon">🧵</span>
                <span className="quick-stat-value">
                  {stats?.filamentUsed ? `${(stats.filamentUsed / 1000).toFixed(1)}kg` : '0g'}
                </span>
                <span className="quick-stat-label">Filament Used</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions Widget */}
        <div className="widget quick-actions-widget">
          <div className="widget-header">
            <h3>⚡ Quick Actions</h3>
          </div>
          <div className="widget-content">
            <div className="quick-actions-grid">
              <button className="quick-action" onClick={() => onNavigate('library')}>
                <span className="action-icon">📤</span>
                <span>Upload Model</span>
              </button>
              <button className="quick-action" onClick={() => onNavigate('history')}>
                <span className="action-icon">🔄</span>
                <span>Sync Prints</span>
              </button>
              <button className="quick-action" onClick={() => onNavigate('duplicates')}>
                <span className="action-icon">🔍</span>
                <span>Find Duplicates</span>
              </button>
              <button className="quick-action" onClick={() => onNavigate('maintenance')}>
                <span className="action-icon">🔧</span>
                <span>Maintenance</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardHome;
