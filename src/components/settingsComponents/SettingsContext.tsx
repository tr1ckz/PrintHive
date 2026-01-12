import { createContext, useContext } from 'react';
import { SettingsContextValue } from './types';

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettingsContext must be used within SettingsProvider');
  }
  return context;
}
