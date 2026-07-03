import React, { useState, useEffect, useRef } from 'react';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';

interface Tag {
  id: number;
  name: string;
  model_count?: number;
}

interface TagsInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const TagsInput: React.FC<TagsInputProps> = ({ value, onChange, disabled, placeholder }) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Parse current tags from value
  const currentTags = value.split(',').map(t => t.trim()).filter(t => t.length > 0);

  // Fetch all tags on mount
  useEffect(() => {
    fetchWithRetry(API_ENDPOINTS.TAGS.LIST, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setAllTags(data))
      .catch(err => console.error('Failed to fetch tags:', err));
  }, []);

  // Filter suggestions based on input
  useEffect(() => {
    if (inputValue.trim().length > 0) {
      const filtered = allTags
        .filter(tag => 
          tag.name.toLowerCase().includes(inputValue.toLowerCase()) &&
          !currentTags.includes(tag.name.toLowerCase())
        )
        .slice(0, 8);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setSelectedIndex(-1);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [inputValue, allTags, currentTags]);

  // Handle clicking outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addTag = (tagName: string) => {
    const trimmed = tagName.trim().toLowerCase();
    if (trimmed && !currentTags.includes(trimmed)) {
      const newTags = [...currentTags, trimmed];
      onChange(newTags.join(', '));
    }
    setInputValue('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeTag = (index: number) => {
    const newTags = currentTags.filter((_, i) => i !== index);
    onChange(newTags.join(', '));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        addTag(suggestions[selectedIndex].name);
      } else if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    } else if (e.key === 'Backspace' && inputValue === '' && currentTags.length > 0) {
      removeTag(currentTags.length - 1);
    } else if (e.key === ',' || e.key === 'Tab') {
      if (inputValue.trim()) {
        e.preventDefault();
        addTag(inputValue);
      }
    }
  };

  return (
    <div className="relative">
      <div className={`flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-line bg-card px-2 py-1.5 transition-colors focus-within:border-accent/60 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {currentTags.map((tag, index) => (
          <span key={index} className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
            {tag}
            {!disabled && (
              <button 
                type="button"
                className="inline-flex size-4 items-center justify-center rounded-full text-accent transition-colors hover:bg-accent/20" 
                onClick={() => removeTag(index)}
                title="Remove tag"
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => inputValue && setShowSuggestions(suggestions.length > 0)}
          placeholder={currentTags.length === 0 ? (placeholder || 'Add tags...') : ''}
          disabled={disabled}
          className="!min-h-0 flex-1 !border-0 !bg-transparent !p-1 text-sm !shadow-none focus:outline-none"
        />
      </div>
      
      {showSuggestions && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md bg-elevated py-1 shadow-xl" ref={suggestionsRef}>
          {suggestions.map((tag, index) => (
            <button
              key={tag.id}
              type="button"
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${index === selectedIndex ? 'bg-accent/10 text-accent' : 'text-fg-soft hover:bg-white/5'}`}
              onClick={() => addTag(tag.name)}
            >
              <span className="truncate">{tag.name}</span>
              <span className="shrink-0 text-xs text-muted">{tag.model_count} models</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TagsInput;
