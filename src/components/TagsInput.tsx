import React, { useState, useEffect, useRef } from 'react';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';
import './TagsInput.css';

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
    <div className="tags-input-container">
      <div className={`tags-input-wrapper ${disabled ? 'disabled' : ''}`}>
        {currentTags.map((tag, index) => (
          <span key={index} className="tag-chip">
            {tag}
            {!disabled && (
              <button 
                type="button"
                className="tag-remove" 
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
          className="tags-input-field"
        />
      </div>
      
      {showSuggestions && (
        <div className="tags-suggestions" ref={suggestionsRef}>
          {suggestions.map((tag, index) => (
            <button
              key={tag.id}
              type="button"
              className={`suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => addTag(tag.name)}
            >
              <span className="suggestion-name">{tag.name}</span>
              <span className="suggestion-count">{tag.model_count} models</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TagsInput;
