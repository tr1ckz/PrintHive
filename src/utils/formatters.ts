/**
 * Number and currency formatting utilities
 * Provides consistent formatting across the application
 */

/**
 * Format a number with commas as thousands separators
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted number string
 * @example formatNumber(1234567.89) => "1,234,568"
 * @example formatNumber(1234.5678, 2) => "1,234.57"
 */
export function formatNumber(value: number | null | undefined, decimals: number = 0): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a number as currency (USD)
 * @param value - The number to format as currency
 * @param showCents - Whether to show cents (default: true)
 * @returns Formatted currency string
 * @example formatCurrency(1234.56) => "$1,234.56"
 * @example formatCurrency(1234.56, false) => "$1,235"
 */
export function formatCurrency(value: number | null | undefined, showCents: boolean = true): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '$0.00';
  }
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
}

/**
 * Format bytes to human-readable file size
 * @param bytes - File size in bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted file size string
 * @example formatFileSize(1024) => "1.00 KB"
 * @example formatFileSize(1536000) => "1.46 MB"
 */
export function formatFileSize(bytes: number | null | undefined, decimals: number = 2): string {
  if (bytes === null || bytes === undefined || bytes === 0) {
    return '0 Bytes';
  }

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Format weight in grams to appropriate unit
 * @param grams - Weight in grams
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted weight string
 * @example formatWeight(500) => "500g"
 * @example formatWeight(1500) => "1.5kg"
 */
export function formatWeight(grams: number | null | undefined, decimals: number = 1): string {
  if (grams === null || grams === undefined || grams === 0) {
    return '0g';
  }

  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(decimals)}kg`;
  }

  return `${grams.toFixed(decimals)}g`;
}

/**
 * Format duration in seconds to human-readable time
 * @param seconds - Duration in seconds
 * @param includeSeconds - Whether to include seconds in output (default: false)
 * @returns Formatted duration string
 * @example formatDuration(3665) => "1h 1m"
 * @example formatDuration(3665, true) => "1h 1m 5s"
 */
export function formatDuration(seconds: number | null | undefined, includeSeconds: boolean = false): string {
  if (seconds === null || seconds === undefined || seconds === 0) {
    return '0m';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  
  if (includeSeconds && (secs > 0 || parts.length === 0)) {
    parts.push(`${secs}s`);
  }

  return parts.join(' ');
}

/**
 * Format a percentage value
 * @param value - The percentage value (0-100 or 0-1 depending on normalize)
 * @param decimals - Number of decimal places (default: 1)
 * @param normalize - If true, assumes value is 0-1 and multiplies by 100 (default: false)
 * @returns Formatted percentage string
 * @example formatPercentage(85.6) => "85.6%"
 * @example formatPercentage(0.856, 1, true) => "85.6%"
 */
export function formatPercentage(
  value: number | null | undefined,
  decimals: number = 1,
  normalize: boolean = false
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0%';
  }

  const displayValue = normalize ? value * 100 : value;
  return `${displayValue.toFixed(decimals)}%`;
}

/**
 * Format a distance/length value in millimeters
 * @param mm - Distance in millimeters
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted distance string
 * @example formatDistance(1234.5) => "1,234.5mm"
 * @example formatDistance(1234567) => "1,234.6m"
 */
export function formatDistance(mm: number | null | undefined, decimals: number = 1): string {
  if (mm === null || mm === undefined || mm === 0) {
    return '0mm';
  }

  if (mm >= 1000) {
    return `${formatNumber(mm / 1000, decimals)}m`;
  }

  return `${formatNumber(mm, decimals)}mm`;
}

/**
 * Abbreviate large numbers with K, M, B suffixes
 * @param value - The number to abbreviate
 * @param decimals - Number of decimal places (default: 1)
 * @returns Abbreviated number string
 * @example formatAbbreviated(1234) => "1.2K"
 * @example formatAbbreviated(1234567) => "1.2M"
 */
export function formatAbbreviated(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0';
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absValue >= 1e9) {
    return `${sign}${(absValue / 1e9).toFixed(decimals)}B`;
  }
  if (absValue >= 1e6) {
    return `${sign}${(absValue / 1e6).toFixed(decimals)}M`;
  }
  if (absValue >= 1e3) {
    return `${sign}${(absValue / 1e3).toFixed(decimals)}K`;
  }

  return `${sign}${absValue.toFixed(decimals)}`;
}

/**
 * Format a date to a relative time string (e.g., "2 hours ago")
 * @param date - The date to format
 * @returns Relative time string
 * @example formatRelativeTime(new Date(Date.now() - 3600000)) => "1 hour ago"
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) {
    return 'Never';
  }

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'Just now';
  }
  if (diffMin < 60) {
    return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  }
  if (diffHour < 24) {
    return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  }
  if (diffDay < 7) {
    return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  }

  return dateObj.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
