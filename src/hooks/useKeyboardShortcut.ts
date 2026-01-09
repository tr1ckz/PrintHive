import { useEffect, useCallback } from 'react';

/**
 * Hook to handle keyboard shortcuts
 * @param key - The key to listen for (e.g., 'Escape', 'k')
 * @param callback - Function to call when the key combination is pressed
 * @param modifiers - Optional modifier keys (ctrl, shift, alt, meta)
 */
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  }
) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const matchesKey = event.key.toLowerCase() === key.toLowerCase();
      const matchesCtrl = modifiers?.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
      const matchesShift = modifiers?.shift ? event.shiftKey : !event.shiftKey;
      const matchesAlt = modifiers?.alt ? event.altKey : !event.altKey;
      const matchesMeta = modifiers?.meta ? event.metaKey : !event.metaKey;

      if (matchesKey && matchesCtrl && matchesShift && matchesAlt && matchesMeta) {
        event.preventDefault();
        callback();
      }
    },
    [key, callback, modifiers]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * Hook to close modals/overlays with Escape key
 * @param isOpen - Whether the modal is currently open
 * @param onClose - Function to call when Escape is pressed
 */
export function useEscapeKey(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);
}

/**
 * Hook to handle global search shortcut (Ctrl+K / Cmd+K)
 * @param onSearch - Function to call when search shortcut is pressed
 */
export function useSearchShortcut(onSearch: () => void) {
  useKeyboardShortcut('k', onSearch, { ctrl: true });
}
