// API Configuration
// Central configuration for all API endpoints

const API_BASE_URL = process.env.VITE_API_BASE_URL || '';

export const API_ENDPOINTS = {
  // Bambu Cloud API
  BAMBU_API: {
    GLOBAL: 'https://api.bambulab.com',
    CHINA: 'https://api.bambulab.cn',
    US: 'https://api.bambulab.com',
    EU: 'https://api.bambulab.com',
  },
  
  // Local API endpoints
  AUTH: {
    LOGIN: `${API_BASE_URL}/auth/login`,
    LOGOUT: `${API_BASE_URL}/auth/logout`,
    CHECK: `${API_BASE_URL}/api/check-auth`,
    USER_ME: `${API_BASE_URL}/api/user/me`,
    OIDC: `${API_BASE_URL}/auth/oidc`,
    OIDC_CALLBACK: `${API_BASE_URL}/auth/oidc/callback`,
    HEALTH: `${API_BASE_URL}/api/health`,
  },
  
  PRINTERS: {
    LIST: `${API_BASE_URL}/api/printers`,
    CAMERA_SNAPSHOT: `${API_BASE_URL}/api/camera-snapshot`,
    DOWNLOAD: (modelId: string) => `${API_BASE_URL}/api/printer/download/${modelId}`,
    JOB_COVER: (deviceId: string) => `${API_BASE_URL}/api/job-cover/${deviceId}`,
    STATUS: `${API_BASE_URL}/api/printers/status`,
  },
  
  MODELS: {
    LIST: `${API_BASE_URL}/api/models`,
    DOWNLOAD: (modelId: string) => `${API_BASE_URL}/api/download/${modelId}`,
    LOCAL_DOWNLOAD: (modelId: string) => `${API_BASE_URL}/api/local/download/${modelId}`,
  },
  
  LIBRARY: {
    LIST: `${API_BASE_URL}/api/library`,
    UPLOAD: `${API_BASE_URL}/api/library/upload`,
    DOWNLOAD: (id: number) => `${API_BASE_URL}/api/library/download/${id}`,
    FILE: (id: number) => `${API_BASE_URL}/api/library/${id}`,
    THUMBNAIL: (id: number) => `${API_BASE_URL}/api/library/thumbnail/${id}`,
    GEOMETRY: (id: number|string) => `${API_BASE_URL}/api/library/geometry/${id}`,
    DUPLICATES: (groupBy: string) => `${API_BASE_URL}/api/library/duplicates?groupBy=${groupBy}`,
    SCAN: `${API_BASE_URL}/api/library/scan`,
    SCAN_STATUS: `${API_BASE_URL}/api/library/scan-status`,
    SCAN_CANCEL: `${API_BASE_URL}/api/library/scan-cancel`,
    AUTO_TAG: (id: number) => `${API_BASE_URL}/api/library/${id}/auto-tag`,
    AUTO_TAG_ALL: `${API_BASE_URL}/api/library/auto-tag-all`,
    AUTO_TAG_STATUS: `${API_BASE_URL}/api/library/auto-tag-status`,
    AUTO_TAG_CANCEL: `${API_BASE_URL}/api/library/auto-tag-cancel`,
    UPDATE_DESCRIPTION: (id: number) => `${API_BASE_URL}/api/library/${id}/description`,
    UPDATE_TAGS: (id: number) => `${API_BASE_URL}/api/library/${id}/tags`,
  },
  
  SYNC: {
    CLOUD: `${API_BASE_URL}/api/sync`,
    PRINTER_TIMELAPSES: `${API_BASE_URL}/api/sync-printer-timelapses`,
    DOWNLOAD_COVERS: `${API_BASE_URL}/api/download-missing-covers`,
  },
  
  VIDEO: {
    MATCH: `${API_BASE_URL}/api/match-videos`,
    MATCH_STATUS: `${API_BASE_URL}/api/match-videos-status`,
    MATCH_CANCEL: `${API_BASE_URL}/api/match-videos-cancel`,
    TIMELAPSE: (modelId: string) => `${API_BASE_URL}/api/timelapse/${modelId}`,
    DEBUG: `${API_BASE_URL}/api/debug/videos`,
  },
  
  SETTINGS: {
    BAMBU_STATUS: `${API_BASE_URL}/api/settings/bambu-status`,
    PRINTER_FTP: `${API_BASE_URL}/api/settings/printer-ftp`,
    REQUEST_CODE: `${API_BASE_URL}/api/settings/request-code`,
    CONNECT_BAMBU: `${API_BASE_URL}/api/settings/connect-bambu`,
    DISCONNECT_BAMBU: `${API_BASE_URL}/api/settings/disconnect-bambu`,
    CHANGE_PASSWORD: `${API_BASE_URL}/api/settings/change-password`,
    OAUTH: `${API_BASE_URL}/api/settings/oauth`,
    TEST_PRINTER_FTP: `${API_BASE_URL}/api/settings/test-printer-ftp`,
    SAVE_PRINTER_FTP: `${API_BASE_URL}/api/settings/save-printer-ftp`,
    SAVE_PRINTER: `${API_BASE_URL}/api/settings/save-printer`,
    SAVE_OAUTH: `${API_BASE_URL}/api/settings/save-oauth`,
    SAVE_UI: `${API_BASE_URL}/api/settings/save-ui`,
    UI: `${API_BASE_URL}/api/settings/ui`,
    OAUTH_PUBLIC: `${API_BASE_URL}/api/settings/oauth-public`,
    GET: `${API_BASE_URL}/api/settings`,
    COSTS: `${API_BASE_URL}/api/settings/costs`,
    LOG_LEVEL: `${API_BASE_URL}/api/log-level`,
    WATCHDOG: `${API_BASE_URL}/api/settings/watchdog`,
    NOTIFICATIONS: `${API_BASE_URL}/api/settings/notifications`,
    NOTIFICATIONS_TEST: `${API_BASE_URL}/api/settings/notifications/test`,
    DISCORD: `${API_BASE_URL}/api/settings/discord`,
    DISCORD_TEST: `${API_BASE_URL}/api/discord/test`,
    PROFILE: `${API_BASE_URL}/api/settings/profile`,
    DATABASE: `${API_BASE_URL}/api/settings/database`,
    DATABASE_BACKUPS: `${API_BASE_URL}/api/settings/database/backups`,
    DATABASE_BACKUP: `${API_BASE_URL}/api/settings/database/backup`,
    DATABASE_BACKUP_STATUS: (jobId: string) => `${API_BASE_URL}/api/settings/database/backup/status/${jobId}`,
    DATABASE_RESTORE: `${API_BASE_URL}/api/settings/database/restore`,
    DATABASE_RESTORE_STATUS: (jobId: string) => `${API_BASE_URL}/api/settings/database/restore/status/${jobId}`,
    DATABASE_VACUUM: `${API_BASE_URL}/api/settings/database/vacuum`,
    DATABASE_ANALYZE: `${API_BASE_URL}/api/settings/database/analyze`,
    DATABASE_REINDEX: `${API_BASE_URL}/api/settings/database/reindex`,
    DATABASE_TEST_REMOTE: `${API_BASE_URL}/api/settings/database/test-remote`,
    DATABASE_BACKUP_FILE: (filename: string) => `${API_BASE_URL}/api/settings/database/backups/${filename}`,
    DATABASE_RESTORE_UPLOAD: `${API_BASE_URL}/api/settings/database/restore`,
  },
  
  MAINTENANCE: {
    LIST: `${API_BASE_URL}/api/maintenance`,
    TASK: (id: number) => `${API_BASE_URL}/api/maintenance/${id}`,
    COMPLETE: (id: number) => `${API_BASE_URL}/api/maintenance/${id}/complete`,
    HISTORY: (taskId: number) => `${API_BASE_URL}/api/maintenance/${taskId}/history`,
  },
  
  STATISTICS: {
    DASHBOARD: `${API_BASE_URL}/api/statistics/dashboard`,
    HISTORY: `${API_BASE_URL}/api/statistics`,
    COSTS: `${API_BASE_URL}/api/statistics/costs`,
  },
  
  SYSTEM: {
    HEALTH: `${API_BASE_URL}/api/health`,
    LOG_LEVEL: `${API_BASE_URL}/api/log-level`,
    RESTART: `${API_BASE_URL}/api/system/restart`,
    VERSION: `${API_BASE_URL}/api/version`,
  },
  
  USERS: {
    LIST: `${API_BASE_URL}/api/users`,
    UPDATE_ROLE: (userId: number) => `${API_BASE_URL}/api/users/${userId}/role`,
    DELETE: (userId: number) => `${API_BASE_URL}/api/users/${userId}`,
    ADMIN_LIST: `${API_BASE_URL}/api/admin/users`,
    ADMIN_UPDATE_ROLE: (userId: number) => `${API_BASE_URL}/api/admin/users/${userId}/role`,
    ADMIN_DELETE: (userId: number) => `${API_BASE_URL}/api/admin/users/${userId}`,
  },
  
  DUPLICATES: {
    CHECK: `${API_BASE_URL}/api/library/check-duplicates`,
    LIST: `${API_BASE_URL}/api/library/duplicates`,
  },

  TAGS: {
    LIST: `${API_BASE_URL}/api/tags`,
  },
};

// Helper function to get Bambu API URL based on region
export function getBambuApiUrl(region: 'global' | 'china' | 'us' | 'eu' = 'global'): string {
  return API_ENDPOINTS.BAMBU_API[region.toUpperCase() as keyof typeof API_ENDPOINTS.BAMBU_API] || API_ENDPOINTS.BAMBU_API.GLOBAL;
}

// Helper function for building query strings
export function buildQueryString(params: Record<string, string | number | boolean>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    searchParams.append(key, String(value));
  });
  return searchParams.toString();
}
