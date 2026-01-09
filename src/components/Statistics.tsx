import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';
import './Statistics.css';
import LoadingScreen from './LoadingScreen';

interface StatisticsData {
  totalPrints: number;
  successRate: number;
  failedPrints: number;
  totalWeight: number;
  totalLength: number;
  totalTime: number;
  materialsByColor: { [color: string]: { weight: number; length: number; count: number; type: string } };
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

const Statistics: React.FC = () => {
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [costs, setCosts] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStatistics = async () => {
    try {
      setLoading(true);
      setError('');
      
      const [statsRes, costsRes] = await Promise.all([
        fetchWithRetry(API_ENDPOINTS.STATISTICS.HISTORY, { credentials: 'include' }),
        fetchWithRetry(API_ENDPOINTS.STATISTICS.COSTS, { credentials: 'include' })
      ]);
      
      if (!statsRes.ok) throw new Error('Failed to fetch statistics');
      
      const statsData = await statsRes.json();
      setStats(statsData);
      
      if (costsRes.ok) {
        const costsData = await costsRes.json();
        setCosts(costsData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    return `${hours}h ${mins}m`;
  };

  const formatColor = (colorHex: string) => {
    if (!colorHex || colorHex === 'Unknown' || colorHex === 'undefined' || colorHex === 'null') {
      return { css: '#94a3b8', name: 'Unknown' };
    }
    
    // Convert hex like "000000FF" or "FFFFFFFF" to CSS format "#000000"
    // Remove alpha channel (last 2 chars) and add # prefix
    const rgb = colorHex.substring(0, 6);
    const cssColor = `#${rgb}`;
    
    // Create a friendly name based on the color
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

  useEffect(() => {
    fetchStatistics();
  }, []);

  if (loading) {
    return <LoadingScreen message="Loading statistics..." />;
  }

  if (error || !stats) {
    return <div className="error-container">{error || 'No data available'}</div>;
  }

  return (
    <div className="statistics-container">
      <div className="page-header">
        <div>
          <h1>Statistics</h1>
          <p>Overview of your 3D printing activity</p>
        </div>
        <button onClick={fetchStatistics} className="btn-refresh">
          <span>🔄</span> Refresh
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card gradient-purple">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalPrints}</div>
            <div className="stat-label">Total Prints</div>
          </div>
        </div>

        <div className="stat-card gradient-green">
          <div className="stat-icon">✓</div>
          <div className="stat-content">
            <div className="stat-value">{stats.successRate.toFixed(1)}%</div>
            <div className="stat-label">Success Rate</div>
          </div>
        </div>

        <div className="stat-card gradient-red">
          <div className="stat-icon">✕</div>
          <div className="stat-content">
            <div className="stat-value">{stats.failedPrints}</div>
            <div className="stat-label">Failed Prints</div>
          </div>
        </div>

        <div className="stat-card gradient-blue">
          <div className="stat-icon">⏱</div>
          <div className="stat-content">
            <div className="stat-value">{formatDuration(stats.totalTime)}</div>
            <div className="stat-label">Total Print Time</div>
          </div>
        </div>

        <div className="stat-card gradient-orange">
          <div className="stat-icon">⚖</div>
          <div className="stat-content">
            <div className="stat-value">{(stats.totalWeight / 1000).toFixed(2)}kg</div>
            <div className="stat-label">Total Material</div>
          </div>
        </div>

        <div className="stat-card gradient-teal">
          <div className="stat-icon">⌚</div>
          <div className="stat-content">
            <div className="stat-value">{formatDuration(stats.averagePrintTime)}</div>
            <div className="stat-label">Avg Print Time</div>
          </div>
        </div>
      </div>

      {/* Cost Calculator Section */}
      {costs && (
        <div className="cost-section">
          <h2>💰 Cost Calculator</h2>
          <div className="cost-grid">
            <div className="cost-card total">
              <div className="cost-icon">💵</div>
              <div className="cost-content">
                <div className="cost-value">
                  {costs.currency === 'USD' ? '$' : costs.currency === 'EUR' ? '€' : costs.currency === 'GBP' ? '£' : ''}
                  {costs.totalCost.toFixed(2)}
                </div>
                <div className="cost-label">Total Cost</div>
              </div>
            </div>
            
            <div className="cost-card">
              <div className="cost-icon">🧵</div>
              <div className="cost-content">
                <div className="cost-value">
                  {costs.currency === 'USD' ? '$' : costs.currency === 'EUR' ? '€' : costs.currency === 'GBP' ? '£' : ''}
                  {costs.filamentCost.toFixed(2)}
                </div>
                <div className="cost-label">Filament Cost</div>
                <div className="cost-detail">{costs.filamentUsedKg.toFixed(2)}kg used</div>
              </div>
            </div>
            
            <div className="cost-card">
              <div className="cost-icon">⚡</div>
              <div className="cost-content">
                <div className="cost-value">
                  {costs.currency === 'USD' ? '$' : costs.currency === 'EUR' ? '€' : costs.currency === 'GBP' ? '£' : ''}
                  {costs.electricityCost.toFixed(2)}
                </div>
                <div className="cost-label">Electricity Cost</div>
                <div className="cost-detail">{costs.printTimeHours.toFixed(0)}h total</div>
              </div>
            </div>
            
            <div className="cost-card settings">
              <div className="cost-content">
                <div className="cost-label">Current Settings</div>
                <div className="cost-settings">
                  <span>Filament: {costs.settings.filamentCostPerKg}/{costs.currency}/kg</span>
                  <span>Electricity: {costs.settings.electricityCostPerKwh}/{costs.currency}/kWh</span>
                  <span>Printer: {costs.settings.printerWattage}W</span>
                </div>
                <div className="cost-hint">Configure in Settings → Cost Calculator</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="details-grid">
        <div className="detail-card">
          <h3>Material by Color</h3>
          <div className="material-list">
            {Object.entries(stats.materialsByColor)
              .filter(([color, data]) => color && data && data.weight)
              .sort(([, a], [, b]) => b.weight - a.weight)
              .slice(0, 10)
              .map(([color, data]) => {
                const { css, name } = formatColor(color);
                return (
                  <div key={color} className="material-item">
                    <div className="material-info">
                      <div 
                        className="color-swatch" 
                        style={{ background: css }}
                      ></div>
                      <div className="material-details">
                        <div className="material-name">{name} ({data.type || 'Unknown'})</div>
                        <div className="material-stats">
                          {data.count} prints • {data.weight.toFixed(1)}g • {data.length.toFixed(1)}mm
                        </div>
                      </div>
                    </div>
                    <div className="material-bar">
                      <div 
                        className="material-bar-fill" 
                        style={{ 
                          width: `${(data.weight / stats.totalWeight) * 100}%`,
                          background: css
                        }}
                      ></div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="detail-card">
          <h3>Prints by Status</h3>
          <div className="status-chart">
            {Object.entries(stats.printsByStatus)
              .filter(([status]) => status && status !== 'undefined' && status !== 'null')
              .map(([status, count]) => (
              <div key={status} className="status-bar">
                <div className="status-info">
                  <span className={`status-label status-${status?.toLowerCase() || 'unknown'}`}>
                    {status?.toUpperCase() || 'UNKNOWN'}
                  </span>
                  <span className="status-count">{count}</span>
                </div>
                <div className="progress-bar">
                  <div 
                    className={`progress-fill status-${status?.toLowerCase() || 'unknown'}`}
                    style={{ width: `${(count / stats.totalPrints) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="detail-card">
          <h3>Prints by Printer</h3>
          <div className="printer-chart">
            {Object.entries(stats.printsByPrinter)
              .sort(([, a], [, b]) => b - a)
              .map(([printer, count]) => (
                <div key={printer} className="printer-bar">
                  <div className="printer-info">
                    <span className="printer-name">{printer}</span>
                    <span className="printer-count">{count}</span>
                  </div>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill gradient-purple-fill"
                      style={{ width: `${(count / stats.totalPrints) * 100}%` }}
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
