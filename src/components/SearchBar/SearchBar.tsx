import React, { forwardRef } from 'react';
import { Search, Command, X } from 'lucide-react';
import './SearchBar.css';

interface SearchBarProps {
  value?: string;
  onChange?: (val: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  (
    {
      value = '',
      onChange,
      onKeyDown,
      placeholder = 'Search apps, projects, files, commands...',
      autoFocus = true,
    },
    ref
  ) => {
    return (
      <div className="mahi-searchbar-container">
        <div className="mahi-searchbar-wrapper">
          <Search className="mahi-search-icon" size={17} strokeWidth={2.2} />
          <input
            ref={ref}
            type="text"
            className="mahi-search-input"
            placeholder={placeholder}
            value={value}
            autoFocus={autoFocus}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {value ? (
            <button
              type="button"
              className="mahi-search-clear-btn"
              onClick={() => onChange?.('')}
              title="Clear search"
            >
              <X size={14} />
            </button>
          ) : (
            <div className="mahi-search-shortcut-badge">
              <Command size={11} strokeWidth={2.4} />
              <span>Alt + Space</span>
            </div>
          )}
        </div>
      </div>
    );
  }
);

SearchBar.displayName = 'SearchBar';
