import React, { useState, useEffect } from 'react';
import { useSearchShortcut } from '../hooks/useKeyboardShortcut';
import './CommandPalette.css';

interface Command {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  category: string;
  keywords?: string[];
}

interface CommandPaletteProps {
  onNavigate: (tab: string) => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ onNavigate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const commands: Command[] = [
    {
      id: 'nav-home',
      label: 'Go to Home',
      icon: '🏠',
      action: () => onNavigate('home'),
      category: 'Navigation',
      keywords: ['dashboard', 'main']
    },
    {
      id: 'nav-history',
      label: 'Go to Print History',
      icon: '📊',
      action: () => onNavigate('history'),
      category: 'Navigation',
      keywords: ['prints', 'jobs', 'history']
    },
    {
      id: 'nav-library',
      label: 'Go to Library',
      icon: '📚',
      action: () => onNavigate('library'),
      category: 'Navigation',
      keywords: ['files', 'models', '3mf', 'stl']
    },
    {
      id: 'nav-duplicates',
      label: 'Go to Duplicates',
      icon: '🔄',
      action: () => onNavigate('duplicates'),
      category: 'Navigation',
      keywords: ['find', 'duplicate', 'copies']
    },
    {
      id: 'nav-maintenance',
      label: 'Go to Maintenance',
      icon: '🔧',
      action: () => onNavigate('maintenance'),
      category: 'Navigation',
      keywords: ['tasks', 'schedule']
    },
    {
      id: 'nav-printers',
      label: 'Go to Printers',
      icon: '🖨️',
      action: () => onNavigate('printers'),
      category: 'Navigation',
      keywords: ['devices', 'status']
    },
    {
      id: 'nav-statistics',
      label: 'Go to Statistics',
      icon: '📈',
      action: () => onNavigate('statistics'),
      category: 'Navigation',
      keywords: ['stats', 'charts', 'analytics']
    },
    {
      id: 'nav-settings',
      label: 'Go to Settings',
      icon: '⚙️',
      action: () => onNavigate('settings'),
      category: 'Navigation',
      keywords: ['config', 'preferences']
    },
    {
      id: 'reload',
      label: 'Reload Page',
      icon: '🔄',
      action: () => window.location.reload(),
      category: 'Actions',
      keywords: ['refresh', 'restart']
    }
  ];

  // Filter commands based on search
  const filteredCommands = commands.filter(cmd => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(searchLower) ||
      cmd.category.toLowerCase().includes(searchLower) ||
      cmd.keywords?.some(k => k.toLowerCase().includes(searchLower))
    );
  });

  // Group commands by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) {
      acc[cmd.category] = [];
    }
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, Command[]>);

  // Open palette with Ctrl+K
  useSearchShortcut(() => {
    setIsOpen(true);
    setSearch('');
    setSelectedIndex(0);
  });

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
          setIsOpen(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, filteredCommands]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={() => setIsOpen(false)}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-search">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Type a command or search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <kbd className="shortcut-hint">ESC</kbd>
        </div>

        <div className="command-results">
          {Object.keys(groupedCommands).length === 0 ? (
            <div className="no-results">
              <span>No commands found</span>
            </div>
          ) : (
            Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category} className="command-category">
                <div className="category-label">{category}</div>
                {cmds.map((cmd, idx) => {
                  const globalIndex = filteredCommands.indexOf(cmd);
                  return (
                    <button
                      key={cmd.id}
                      className={`command-item ${selectedIndex === globalIndex ? 'selected' : ''}`}
                      onClick={() => {
                        cmd.action();
                        setIsOpen(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                    >
                      <span className="command-icon">{cmd.icon}</span>
                      <span className="command-label">{cmd.label}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="command-footer">
          <div className="footer-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> Navigate
            <kbd>↵</kbd> Select
            <kbd>ESC</kbd> Close
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
