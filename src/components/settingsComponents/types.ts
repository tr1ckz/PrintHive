// Shared types for Settings components

export interface BambuStatus {
  connected: boolean;
  email: string | null;
  region: string;
  lastUpdated: string | null;
}

export interface UserProfile {
  username: string;
  email: string;
  displayName: string;
  oauthProvider: string;
}

export interface MaterialCosts {
  [material: string]: number;
}

export interface BackupInfo {
  name: string;
  date: string;
  size: string;
}

export interface BackupStats {
  count: number;
  totalSize: number;
  totalSizeFormatted: string;
}

export interface DbResultModal {
  title: string;
  icon: string;
  details: Record<string, string | number>;
}

export interface ToastState {
  message: string;
  type: 'success' | 'error';
}

export interface SettingsContextValue {
  toast: ToastState | null;
  setToast: (toast: ToastState | null) => void;
  isAdmin: boolean;
}
