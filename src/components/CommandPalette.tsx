import React, { useState, useEffect } from 'react';
import { useSearchShortcut } from '../hooks/useKeyboardShortcut';

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

  // Open via the mobile topbar search button (window event)
  useEffect(() => {
    const open = () => {
      setIsOpen(true);
      setSearch('');
      setSelectedIndex(0);
    };
    window.addEventListener('printhive:open-command-palette', open);
    return () => window.removeEventListener('printhive:open-command-palette', open);
  }, []);

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
    <div
      className="fixed inset-0 z-[60] bg-overlay backdrop-blur-sm sm:flex sm:items-start sm:justify-center sm:pt-[15vh]"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="flex h-full flex-col bg-elevated shadow-xl sm:h-auto sm:max-h-[60vh] sm:w-[min(640px,calc(100vw-2rem))] sm:rounded-xl sm:animate-[ph-scale-in_0.18s_var(--ease-out)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 min-h-14 border-b border-line">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-muted">
            <path d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Type a command or search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
            className="flex-1 !bg-transparent !border-0 !shadow-none text-sm text-fg placeholder:text-muted focus:outline-none min-h-11"
          />
          <kbd className="hidden sm:block text-[0.62rem] font-semibold uppercase text-muted bg-white/5 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {Object.keys(groupedCommands).length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted">No commands found</div>
          ) : (
            Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category} className="mb-2">
                <div className="px-3 py-1.5 text-[0.62rem] font-semibold uppercase tracking-widest text-muted">{category}</div>
                {cmds.map((cmd) => {
                  const globalIndex = filteredCommands.indexOf(cmd);
                  return (
                    <button
                      key={cmd.id}
                      className={`flex w-full items-center gap-3 min-h-11 rounded-md px-3 text-sm text-left transition-colors ${
                        selectedIndex === globalIndex ? 'bg-accent/10 text-accent' : 'text-fg-soft'
                      }`}
                      onClick={() => {
                        cmd.action();
                        setIsOpen(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                    >
                      <span className="shrink-0">{cmd.icon}</span>
                      <span className="truncate">{cmd.label}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="hidden sm:flex items-center gap-3 px-4 py-2.5 border-t border-line text-xs text-muted">
          <span><kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> Navigate</span>
          <span><kbd className="font-sans">↵</kbd> Select</span>
          <span><kbd className="font-sans">ESC</kbd> Close</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
