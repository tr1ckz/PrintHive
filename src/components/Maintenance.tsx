import { useState, useEffect } from 'react';
import ConfirmModal from './ConfirmModal';
import Toast from './Toast';
import './Maintenance.css';

interface MaintenanceTask {
  id: number;
  printer_id: string | null;
  task_name: string;
  task_type: string;
  description: string;
  interval_hours: number;
  last_performed: string | null;
  next_due: string | null;
  hours_until_due: number | null;
  created_at: string;
  updated_at: string;
  isOverdue?: boolean;
  isDueSoon?: boolean;
}

interface Printer {
  id: string;
  name: string;
}

const TASK_TYPES = [
  { value: 'lubrication', label: 'Lubrication', icon: '🛢️' },
  { value: 'cleaning', label: 'Cleaning', icon: '🧹' },
  { value: 'calibration', label: 'Calibration', icon: '📐' },
  { value: 'replacement', label: 'Part Replacement', icon: '🔧' },
  { value: 'inspection', label: 'Inspection', icon: '🔍' },
  { value: 'firmware', label: 'Firmware Update', icon: '💾' },
  { value: 'other', label: 'Other', icon: '📋' }
];

const PRESET_TASKS = [
  { task_name: 'Clean Build Plate', task_type: 'cleaning', description: 'Wash with warm water & dish soap', interval_hours: 50 },
  { task_name: 'Clean X-Axis Carbon Rods', task_type: 'cleaning', description: 'Wipe with IPA & microfiber. DO NOT GREASE.', interval_hours: 150 },
  { task_name: 'Lube Z-Axis Lead Screws', task_type: 'lubrication', description: 'Clean old grease, apply white lithium grease', interval_hours: 500 },
  { task_name: 'Clean Y-Axis Steel Rods', task_type: 'cleaning', description: 'Wipe with clean cloth/IPA', interval_hours: 150 },
  { task_name: 'Clean Fans (Hotend/Aux/Board)', task_type: 'cleaning', description: 'Compressed air (hold blades still)', interval_hours: 300 },
  { task_name: 'Check AMS Desiccant', task_type: 'inspection', description: 'Replace if color changes or soft', interval_hours: 336 },
  { task_name: 'Clean AMS Feed Rollers', task_type: 'cleaning', description: 'Wipe with IPA (esp. for cardboard spools)', interval_hours: 500 },
  { task_name: 'Inspect PTFE Tubes', task_type: 'inspection', description: 'Check for wear/rubbing inside AMS & path', interval_hours: 500 },
  { task_name: 'Replace Carbon Filter', task_type: 'replacement', description: 'Swap filter (600hrs ABS, 1500hrs PLA)', interval_hours: 600 },
  { task_name: 'Check Nozzle Wiper', task_type: 'inspection', description: 'Ensure PTFE tab is intact', interval_hours: 50 },
  { task_name: 'Inspect Filament Cutter', task_type: 'inspection', description: 'Replace if dull/stuck', interval_hours: 1000 },
  { task_name: 'Calibrate Bed Level', task_type: 'calibration', description: 'Run automatic bed leveling calibration', interval_hours: 100 },
  { task_name: 'Check Belt Tension', task_type: 'inspection', description: 'Check and adjust belt tension on all axes', interval_hours: 500 },
  { task_name: 'Clean Extruder Gears', task_type: 'cleaning', description: 'Remove filament debris from extruder gears', interval_hours: 200 },
  { task_name: 'Replace Nozzle', task_type: 'replacement', description: 'Replace worn nozzle', interval_hours: 500 },
  { task_name: 'Update Firmware', task_type: 'firmware', description: 'Check for and install firmware updates', interval_hours: 720 }
];

function Maintenance() {
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTask, setEditingTask] = useState<MaintenanceTask | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [completeConfirm, setCompleteConfirm] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'overdue' | 'due-soon' | 'up-to-date'>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    printer_id: '',
    task_name: '',
    task_type: 'cleaning',
    description: '',
    interval_hours: 100
  });

  useEffect(() => {
    loadTasks();
    loadPrinters();
  }, []);

  const loadTasks = async () => {
    try {
      const response = await fetch('/api/maintenance');
      const data = await response.json();
      if (response.ok) {
        setTasks(data);
      }
    } catch (error) {
      console.error('Failed to load maintenance tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPrinters = async () => {
    try {
      const response = await fetch('/api/printers');
      const data = await response.json();
      if (response.ok && data.devices) {
        // Map device data to expected printer format
        setPrinters(data.devices.map((d: any) => ({ id: d.dev_id, name: d.name })));
      }
    } catch (error) {
      console.error('Failed to load printers:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.task_name.trim()) {
      setToast({ message: 'Task name is required', type: 'error' });
      return;
    }
    
    try {
      const url = editingTask ? `/api/maintenance/${editingTask.id}` : '/api/maintenance';
      const method = editingTask ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: editingTask ? 'Task updated!' : 'Task created!', type: 'success' });
        setShowAddModal(false);
        setEditingTask(null);
        resetForm();
        loadTasks();
      } else {
        setToast({ message: data.error || 'Failed to save task', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save task', type: 'error' });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const response = await fetch(`/api/maintenance/${id}`, { method: 'DELETE' });
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: 'Task deleted', type: 'success' });
        loadTasks();
      } else {
        setToast({ message: 'Failed to delete task', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to delete task', type: 'error' });
    }
    setDeleteConfirm(null);
  };

  const handleComplete = async (id: number) => {
    try {
      const response = await fetch(`/api/maintenance/${id}/complete`, { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: 'Task marked as completed!', type: 'success' });
        loadTasks();
      } else {
        setToast({ message: 'Failed to complete task', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to complete task', type: 'error' });
    }
    setCompleteConfirm(null);
  };

  const handleEdit = (task: MaintenanceTask) => {
    setFormData({
      printer_id: task.printer_id || '',
      task_name: task.task_name,
      task_type: task.task_type,
      description: task.description || '',
      interval_hours: task.interval_hours
    });
    setEditingTask(task);
    setShowAddModal(true);
  };

  const handleAddPreset = (preset: typeof PRESET_TASKS[0]) => {
    setFormData({
      printer_id: '',
      task_name: preset.task_name,
      task_type: preset.task_type,
      description: preset.description,
      interval_hours: preset.interval_hours
    });
  };

  const resetForm = () => {
    setFormData({
      printer_id: '',
      task_name: '',
      task_type: 'cleaning',
      description: '',
      interval_hours: 100
    });
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatHours = (hours: number) => {
    return `${hours} print hours`;
  };

  const getTaskTypeInfo = (type: string) => {
    return TASK_TYPES.find(t => t.value === type) || { value: type, label: type, icon: '📋' };
  };

  const filteredTasks = tasks.filter(task => {
    const now = new Date();
    const nextDue = task.next_due ? new Date(task.next_due) : null;
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    switch (filter) {
      case 'overdue':
        return nextDue && nextDue < now;
      case 'due-soon':
        return nextDue && nextDue >= now && nextDue <= weekFromNow;
      case 'up-to-date':
        return !nextDue || nextDue > weekFromNow;
      default:
        return true;
    }
  });

  const overdueTasks = tasks.filter(t => {
    if (!t.next_due) return false;
    return new Date(t.next_due) < new Date();
  });

  const dueSoonTasks = tasks.filter(t => {
    if (!t.next_due) return false;
    const nextDue = new Date(t.next_due);
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return nextDue >= now && nextDue <= weekFromNow;
  });

  if (loading) {
    return <div className="maintenance-loading">Loading maintenance tasks...</div>;
  }

  return (
    <div className="maintenance">
      <div className="maintenance-header">
        <div>
          <h1>Maintenance Scheduler</h1>
          <p className="maintenance-subtitle">Track and schedule printer maintenance tasks</p>
        </div>
        <button className="btn btn-primary" onClick={() => { resetForm(); setEditingTask(null); setShowAddModal(true); }}>
          + Add Task
        </button>
      </div>

      {/* Summary Cards */}
      <div className="maintenance-summary">
        <div className={`summary-card ${overdueTasks.length > 0 ? 'overdue' : ''}`} onClick={() => setFilter('overdue')}>
          <span className="summary-icon">⚠️</span>
          <span className="summary-value">{overdueTasks.length}</span>
          <span className="summary-label">Overdue</span>
        </div>
        <div className={`summary-card ${dueSoonTasks.length > 0 ? 'due-soon' : ''}`} onClick={() => setFilter('due-soon')}>
          <span className="summary-icon">⏰</span>
          <span className="summary-value">{dueSoonTasks.length}</span>
          <span className="summary-label">Due Soon</span>
        </div>
        <div className="summary-card" onClick={() => setFilter('up-to-date')}>
          <span className="summary-icon">✅</span>
          <span className="summary-value">{tasks.length - overdueTasks.length - dueSoonTasks.length}</span>
          <span className="summary-label">Up to Date</span>
        </div>
        <div className="summary-card" onClick={() => setFilter('all')}>
          <span className="summary-icon">📋</span>
          <span className="summary-value">{tasks.length}</span>
          <span className="summary-label">Total Tasks</span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="maintenance-filters">
        <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All Tasks
        </button>
        <button className={`filter-btn ${filter === 'overdue' ? 'active' : ''}`} onClick={() => setFilter('overdue')}>
          Overdue ({overdueTasks.length})
        </button>
        <button className={`filter-btn ${filter === 'due-soon' ? 'active' : ''}`} onClick={() => setFilter('due-soon')}>
          Due Soon ({dueSoonTasks.length})
        </button>
        <button className={`filter-btn ${filter === 'up-to-date' ? 'active' : ''}`} onClick={() => setFilter('up-to-date')}>
          Up to Date
        </button>
      </div>

      {/* Tasks List */}
      {filteredTasks.length === 0 ? (
        <div className="no-tasks">
          <span className="no-tasks-icon">🔧</span>
          <p>No maintenance tasks found</p>
          <button className="btn btn-secondary" onClick={() => { resetForm(); setEditingTask(null); setShowAddModal(true); }}>
            Add your first task
          </button>
        </div>
      ) : (
        <div className="tasks-list">
          {filteredTasks.map(task => {
            const typeInfo = getTaskTypeInfo(task.task_type);
            const printer = printers.find(p => p.id === task.printer_id);
            const isOverdue = task.next_due && new Date(task.next_due) < new Date();
            const isDueSoon = task.next_due && !isOverdue && new Date(task.next_due) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            
            return (
              <div key={task.id} className={`task-card ${isOverdue ? 'overdue' : isDueSoon ? 'due-soon' : ''}`}>
                <div className="task-icon">{typeInfo.icon}</div>
                <div className="task-content">
                  <div className="task-header">
                    <h3>{task.task_name}</h3>
                    <span className="task-type-badge">{typeInfo.label}</span>
                    {isOverdue && <span className="status-badge overdue">Overdue</span>}
                    {isDueSoon && !isOverdue && <span className="status-badge due-soon">Due Soon</span>}
                  </div>
                  {task.description && <p className="task-description">{task.description}</p>}
                  <div className="task-meta">
                    {printer && <span className="meta-item">🖨️ {printer.name}</span>}
                    <span className="meta-item">🔄 Every {formatHours(task.interval_hours)}</span>
                    <span className="meta-item hours-display" style={{ 
                      fontWeight: 'bold', 
                      color: (task.hours_until_due ?? 0) < 0 ? '#ff6b6b' : (task.hours_until_due ?? 0) === 0 ? '#ffa726' : (task.hours_until_due ?? 0) < 50 ? '#ffa726' : '#4caf50' 
                    }}>
                      ⏰ {(task.hours_until_due ?? 0) < 0
                        ? `${Math.abs(Math.round(task.hours_until_due ?? 0))} hrs overdue`
                        : (task.hours_until_due ?? 0) === 0
                        ? 'Due now!'
                        : `${Math.round(task.hours_until_due ?? 0)} hrs until maintenance`}
                    </span>
                    <span className="meta-item">📅 Last: {formatDate(task.last_performed)}</span>
                  </div>
                </div>
                <div className="task-actions">
                  <button className="btn btn-success btn-sm" onClick={() => setCompleteConfirm(task.id)} title="Mark as completed">
                    ✓ Done
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(task)} title="Edit task">
                    ✎
                  </button>
                  <button className="btn btn-delete btn-sm" onClick={() => setDeleteConfirm(task.id)} title="Delete task">
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => { setShowAddModal(false); setEditingTask(null); }}>
          <div className="modal maintenance-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTask ? 'Edit Task' : 'Add Maintenance Task'}</h2>
              <button className="modal-close" onClick={() => { setShowAddModal(false); setEditingTask(null); }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Task Name *</label>
                <input
                  type="text"
                  value={formData.task_name}
                  onChange={e => setFormData({ ...formData, task_name: e.target.value })}
                  placeholder="e.g., Clean print bed"
                  required
                />
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Task Type</label>
                  <select
                    value={formData.task_type}
                    onChange={e => setFormData({ ...formData, task_type: e.target.value })}
                  >
                    {TASK_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.icon} {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Printer (optional)</label>
                  <select
                    value={formData.printer_id}
                    onChange={e => setFormData({ ...formData, printer_id: e.target.value })}
                  >
                    <option value="">All Printers</option>
                    {printers.map(printer => (
                      <option key={printer.id} value={printer.id}>{printer.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="form-group">
                <label>Interval (hours of printing)</label>
                <input
                  type="number"
                  value={formData.interval_hours}
                  onChange={e => setFormData({ ...formData, interval_hours: parseInt(e.target.value) || 100 })}
                  min="1"
                  placeholder="100"
                />
                <small className="form-hint">How many hours between each maintenance</small>
              </div>
              
              <div className="form-group">
                <label>Description (optional)</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Add any notes or instructions..."
                  rows={3}
                />
              </div>
              
              {!editingTask && (
                <div className="preset-tasks">
                  <label>Quick Add Presets:</label>
                  <div className="preset-buttons">
                    {PRESET_TASKS.map((preset, i) => (
                      <button
                        key={i}
                        type="button"
                        className="preset-btn"
                        onClick={() => handleAddPreset(preset)}
                      >
                        {getTaskTypeInfo(preset.task_type).icon} {preset.task_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowAddModal(false); setEditingTask(null); }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingTask ? 'Save Changes' : 'Add Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={deleteConfirm !== null}
        title="Delete Task"
        message="Are you sure you want to delete this maintenance task?"
        confirmText="Delete"
        confirmButtonClass="btn-delete"
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* Complete Confirmation */}
      <ConfirmModal
        isOpen={completeConfirm !== null}
        title="Complete Task"
        message="Mark this maintenance task as completed? The next due date will be calculated based on the interval."
        confirmText="Mark Complete"
        confirmButtonClass="btn-success"
        onConfirm={() => completeConfirm && handleComplete(completeConfirm)}
        onCancel={() => setCompleteConfirm(null)}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default Maintenance;
