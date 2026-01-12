import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';

export function NotificationSettings() {
  const { setToast } = useSettingsContext();
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [discordTesting, setDiscordTesting] = useState<string | null>(null);
  
  // Discord
  const [discordWebhook, setDiscordWebhook] = useState('');
  const [discordPrinterEnabled, setDiscordPrinterEnabled] = useState(false);
  const [discordMaintenanceEnabled, setDiscordMaintenanceEnabled] = useState(false);
  const [discordBackupEnabled, setDiscordBackupEnabled] = useState(false);
  const [discordPingUserId, setDiscordPingUserId] = useState('');
  
  // Telegram
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramPrinterEnabled, setTelegramPrinterEnabled] = useState(false);
  const [telegramMaintenanceEnabled, setTelegramMaintenanceEnabled] = useState(false);
  const [telegramBackupEnabled, setTelegramBackupEnabled] = useState(false);
  
  // Slack
  const [slackWebhook, setSlackWebhook] = useState('');
  const [slackPrinterEnabled, setSlackPrinterEnabled] = useState(false);
  const [slackMaintenanceEnabled, setSlackMaintenanceEnabled] = useState(false);
  const [slackBackupEnabled, setSlackBackupEnabled] = useState(false);

  useEffect(() => {
    loadNotificationsSettings();
  }, []);

  const loadNotificationsSettings = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.NOTIFICATIONS, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok || !data.success) return;
      const s = data.settings || {};
      if (s.discord) {
        setDiscordWebhook(s.discord.webhook || '');
        setDiscordBackupEnabled(!!s.discord.backupEnabled);
        setDiscordPrinterEnabled(!!s.discord.printerEnabled);
        setDiscordMaintenanceEnabled(!!s.discord.maintenanceEnabled);
        setDiscordPingUserId(s.discord.pingUserId || '');
      }
      if (s.telegram) {
        setTelegramBotToken(s.telegram.botToken || '');
        setTelegramChatId(s.telegram.chatId || '');
        setTelegramPrinterEnabled(!!s.telegram.printerEnabled);
        setTelegramMaintenanceEnabled(!!s.telegram.maintenanceEnabled);
        setTelegramBackupEnabled(!!s.telegram.backupEnabled);
      }
      if (s.slack) {
        setSlackWebhook(s.slack.webhook || '');
        setSlackPrinterEnabled(!!s.slack.printerEnabled);
        setSlackMaintenanceEnabled(!!s.slack.maintenanceEnabled);
        setSlackBackupEnabled(!!s.slack.backupEnabled);
      }
    } catch (e) {
      console.error('Failed to load notifications settings:', e);
    }
  };

  const handleSaveNotificationsSettings = async () => {
    setNotificationsLoading(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.NOTIFICATIONS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord: {
            webhook: discordWebhook,
            printerEnabled: discordPrinterEnabled,
            maintenanceEnabled: discordMaintenanceEnabled,
            backupEnabled: discordBackupEnabled,
            pingUserId: discordPingUserId
          },
          telegram: {
            botToken: telegramBotToken,
            chatId: telegramChatId,
            printerEnabled: telegramPrinterEnabled,
            maintenanceEnabled: telegramMaintenanceEnabled,
            backupEnabled: telegramBackupEnabled
          },
          slack: {
            webhook: slackWebhook,
            printerEnabled: slackPrinterEnabled,
            maintenanceEnabled: slackMaintenanceEnabled,
            backupEnabled: slackBackupEnabled
          }
        }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Notification settings saved!', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to save notification settings', type: 'error' });
      }
    } catch (e) {
      setToast({ message: 'Failed to save notification settings', type: 'error' });
    } finally {
      setNotificationsLoading(false);
    }
  };

  const handleTestDiscord = async (type: 'printer' | 'maintenance' | 'backup') => {
    if (!discordWebhook) {
      setToast({ message: 'Please enter a Discord webhook URL', type: 'error' });
      return;
    }
    setDiscordTesting(type);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DISCORD_TEST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, webhook: discordWebhook }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: `Test ${type} notification sent!`, type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to send test notification', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to send test notification', type: 'error' });
    } finally {
      setDiscordTesting(null);
    }
  };

  const handleTestTelegram = async (type: 'printer' | 'maintenance' | 'backup') => {
    if (!telegramBotToken || !telegramChatId) {
      setToast({ message: 'Please set Telegram bot token and chat ID', type: 'error' });
      return;
    }
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.NOTIFICATIONS_TEST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'telegram', type }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: `Telegram ${type} test sent!`, type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to send Telegram test', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to send Telegram test', type: 'error' });
    }
  };

  const handleTestSlack = async (type: 'printer' | 'maintenance' | 'backup') => {
    if (!slackWebhook) {
      setToast({ message: 'Please set Slack webhook URL', type: 'error' });
      return;
    }
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.NOTIFICATIONS_TEST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'slack', type }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: `Slack ${type} test sent!`, type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to send Slack test', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to send Slack test', type: 'error' });
    }
  };

  return (
    <CollapsibleSection title="Notifications" icon="🔔">
      <p className="form-description">
        Configure notification providers and alert types for Printer, Maintenance, and Backup.
      </p>

      {/* Discord */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '0.75rem' }}>💬 Discord</h3>
        <div className="form-group">
          <label>Webhook URL</label>
          <input
            type="url"
            value={discordWebhook}
            onChange={(e) => setDiscordWebhook(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            disabled={notificationsLoading}
          />
          <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
            One webhook used for all Discord notifications
          </small>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '0.75rem' }}>
          <label className="toggle-label"><input type="checkbox" checked={discordPrinterEnabled} onChange={(e) => setDiscordPrinterEnabled(e.target.checked)} disabled={notificationsLoading} /><span className="toggle-text">Printer</span></label>
          <label className="toggle-label"><input type="checkbox" checked={discordMaintenanceEnabled} onChange={(e) => setDiscordMaintenanceEnabled(e.target.checked)} disabled={notificationsLoading} /><span className="toggle-text">Maintenance</span></label>
          <label className="toggle-label"><input type="checkbox" checked={discordBackupEnabled} onChange={(e) => setDiscordBackupEnabled(e.target.checked)} disabled={notificationsLoading} /><span className="toggle-text">Backup</span></label>
        </div>

        <div className="form-group" style={{ marginTop: '0.75rem' }}>
          <label>Ping User ID (optional)</label>
          <input
            type="text"
            value={discordPingUserId}
            onChange={(e) => setDiscordPingUserId(e.target.value)}
            placeholder="874822659161092166"
            disabled={notificationsLoading}
            style={{ maxWidth: '300px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
          <button type="button" className="btn btn-secondary" onClick={() => handleTestDiscord('printer')} disabled={!discordWebhook || discordTesting === 'printer'}>
            {discordTesting === 'printer' ? 'Sending...' : 'Test Printer'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => handleTestDiscord('maintenance')} disabled={!discordWebhook || discordTesting === 'maintenance'}>
            {discordTesting === 'maintenance' ? 'Sending...' : 'Test Maintenance'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => handleTestDiscord('backup')} disabled={!discordWebhook || discordTesting === 'backup'}>
            {discordTesting === 'backup' ? 'Sending...' : 'Test Backup'}
          </button>
        </div>
      </div>

      {/* Telegram */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '0.75rem' }}>📨 Telegram</h3>
        <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Bot Token</label>
            <input type="text" value={telegramBotToken} onChange={(e) => setTelegramBotToken(e.target.value)} placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" disabled={notificationsLoading} />
          </div>
          <div className="form-group">
            <label>Chat ID</label>
            <input type="text" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="@your_channel_or_chat_id" disabled={notificationsLoading} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '0.75rem' }}>
          <label className="toggle-label"><input type="checkbox" checked={telegramPrinterEnabled} onChange={(e) => setTelegramPrinterEnabled(e.target.checked)} disabled={notificationsLoading} /><span className="toggle-text">Printer</span></label>
          <label className="toggle-label"><input type="checkbox" checked={telegramMaintenanceEnabled} onChange={(e) => setTelegramMaintenanceEnabled(e.target.checked)} disabled={notificationsLoading} /><span className="toggle-text">Maintenance</span></label>
          <label className="toggle-label"><input type="checkbox" checked={telegramBackupEnabled} onChange={(e) => setTelegramBackupEnabled(e.target.checked)} disabled={notificationsLoading} /><span className="toggle-text">Backup</span></label>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={() => handleTestTelegram('printer')} disabled={!telegramBotToken || !telegramChatId}>Test Printer</button>
          <button type="button" className="btn btn-secondary" onClick={() => handleTestTelegram('maintenance')} disabled={!telegramBotToken || !telegramChatId}>Test Maintenance</button>
          <button type="button" className="btn btn-secondary" onClick={() => handleTestTelegram('backup')} disabled={!telegramBotToken || !telegramChatId}>Test Backup</button>
        </div>
      </div>

      {/* Slack */}
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '0.75rem' }}>🧩 Slack</h3>
        <div className="form-group">
          <label>Webhook URL</label>
          <input type="url" value={slackWebhook} onChange={(e) => setSlackWebhook(e.target.value)} placeholder="https://hooks.slack.com/services/..." disabled={notificationsLoading} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '0.75rem' }}>
          <label className="toggle-label"><input type="checkbox" checked={slackPrinterEnabled} onChange={(e) => setSlackPrinterEnabled(e.target.checked)} disabled={notificationsLoading} /><span className="toggle-text">Printer</span></label>
          <label className="toggle-label"><input type="checkbox" checked={slackMaintenanceEnabled} onChange={(e) => setSlackMaintenanceEnabled(e.target.checked)} disabled={notificationsLoading} /><span className="toggle-text">Maintenance</span></label>
          <label className="toggle-label"><input type="checkbox" checked={slackBackupEnabled} onChange={(e) => setSlackBackupEnabled(e.target.checked)} disabled={notificationsLoading} /><span className="toggle-text">Backup</span></label>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={() => handleTestSlack('printer')} disabled={!slackWebhook}>Test Printer</button>
          <button type="button" className="btn btn-secondary" onClick={() => handleTestSlack('maintenance')} disabled={!slackWebhook}>Test Maintenance</button>
          <button type="button" className="btn btn-secondary" onClick={() => handleTestSlack('backup')} disabled={!slackWebhook}>Test Backup</button>
        </div>
      </div>

      <button type="button" className="btn btn-primary" onClick={handleSaveNotificationsSettings} disabled={notificationsLoading}>
        {notificationsLoading ? 'Saving...' : 'Save Notification Settings'}
      </button>
    </CollapsibleSection>
  );
}
