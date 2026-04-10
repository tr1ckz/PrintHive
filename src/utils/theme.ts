export type ThemeScheme = 'cyan' | 'purple' | 'green' | 'orange' | 'pink' | 'blue';

interface ThemeTokens {
  accent: string;
  accentStrong: string;
  accentRgb: string;
  accentContrast: string;
}

export const THEME_SCHEMES: Record<ThemeScheme, ThemeTokens> = {
  cyan: {
    accent: '#22d3ee',
    accentStrong: '#06b6d4',
    accentRgb: '34, 211, 238',
    accentContrast: '#082f49',
  },
  purple: {
    accent: '#a855f7',
    accentStrong: '#7c3aed',
    accentRgb: '168, 85, 247',
    accentContrast: '#ffffff',
  },
  green: {
    accent: '#10b981',
    accentStrong: '#059669',
    accentRgb: '16, 185, 129',
    accentContrast: '#052e2b',
  },
  orange: {
    accent: '#f97316',
    accentStrong: '#fb923c',
    accentRgb: '249, 115, 22',
    accentContrast: '#ffffff',
  },
  pink: {
    accent: '#ec4899',
    accentStrong: '#db2777',
    accentRgb: '236, 72, 153',
    accentContrast: '#ffffff',
  },
  blue: {
    accent: '#3b82f6',
    accentStrong: '#2563eb',
    accentRgb: '59, 130, 246',
    accentContrast: '#eff6ff',
  },
};

export function getThemeTokens(scheme?: string): ThemeTokens {
  return THEME_SCHEMES[(scheme as ThemeScheme) || 'orange'] || THEME_SCHEMES.orange;
}

export function applyThemeScheme(scheme?: string) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const tokens = getThemeTokens(scheme);

  root.style.setProperty('--theme-accent', tokens.accent);
  root.style.setProperty('--theme-accent-strong', tokens.accentStrong);
  root.style.setProperty('--theme-accent-rgb', tokens.accentRgb);
  root.style.setProperty('--theme-accent-contrast', tokens.accentContrast);

  root.style.setProperty('--color-primary', tokens.accent);
  root.style.setProperty('--color-secondary', tokens.accentStrong);
  root.style.setProperty('--color-gradient-1', tokens.accent);
  root.style.setProperty('--color-gradient-2', tokens.accentStrong);

  root.dataset.themeAccent = scheme || 'orange';
}
