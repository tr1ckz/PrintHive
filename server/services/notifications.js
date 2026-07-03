const { db } = require('../../database');

async function sendDiscordNotification(type, data) {
  try {
    const getConfig = db.prepare('SELECT value FROM config WHERE key = ?');
    
    let webhookUrl, enabled;
    if (type === 'printer') {
      const webhookRow = (await getConfig.get('discord_printer_webhook'));
      const enabledRow = (await getConfig.get('discord_printer_enabled'));
      webhookUrl = webhookRow?.value;
      enabled = enabledRow?.value === 'true';
    } else if (type === 'maintenance' || type === 'backup') {
      // Use maintenance webhook for maintenance and backup notifications
      const webhookRow = (await getConfig.get('discord_maintenance_webhook'));
      const maintenanceEnabledRow = (await getConfig.get('discord_maintenance_enabled'));
      webhookUrl = webhookRow?.value;
      if (type === 'backup') {
        const backupEnabledRow = (await getConfig.get('discord_backup_enabled'));
        enabled = backupEnabledRow?.value === 'true';
      } else {
        enabled = maintenanceEnabledRow?.value === 'true';
      }
    }
    
    if (!enabled || !webhookUrl) {
      return false;
    }
    
    let embed;
    if (type === 'printer') {
      const statusColors = {
        'failed': 0xFF0000,    // Red
        'error': 0xFF0000,     // Red
        'completed': 0x00FF00, // Green
        'paused': 0xFFFF00,    // Yellow
        'offline': 0x808080    // Gray
      };
      
      const statusEmojis = {
        'failed': '❌',
        'error': '⚠️',
        'completed': '✅',
        'paused': '⏸️',
        'offline': '📴'
      };
      
      embed = {
        title: `${statusEmojis[data.status] || '🖨️'} Print ${data.status?.charAt(0).toUpperCase() + data.status?.slice(1) || 'Alert'}`,
        description: data.message || 'Printer status update',
        color: statusColors[data.status] || 0x00D4FF,
        fields: [],
        footer: { text: 'PrintHive • Printer Alerts' },
        timestamp: new Date().toISOString()
      };
      
      if (data.printerName) embed.fields.push({ name: 'Printer', value: data.printerName, inline: true });
      if (data.modelName) embed.fields.push({ name: 'Model', value: data.modelName, inline: true });
      if (data.progress !== undefined) embed.fields.push({ name: 'Progress', value: `${data.progress}%`, inline: true });
      if (data.timeElapsed) embed.fields.push({ name: 'Time', value: data.timeElapsed, inline: true });
      if (data.errorCode) embed.fields.push({ name: 'Error Code', value: data.errorCode, inline: true });
      
    } else if (type === 'maintenance') {
      const statusColors = {
        'due': 0xFFA500,      // Orange
        'overdue': 0xFF0000,  // Red
        'completed': 0x00FF00 // Green
      };
      
      const statusEmojis = {
        'due': '⚠️',
        'overdue': '🚨',
        'completed': '✅'
      };
      
      embed = {
        title: `${statusEmojis[data.status] || '🔧'} Maintenance ${data.status?.charAt(0).toUpperCase() + data.status?.slice(1) || 'Alert'}`,
        description: data.message || 'Maintenance task needs attention',
        color: statusColors[data.status] || 0xFFA500,
        fields: [],
        footer: { text: 'PrintHive • Maintenance Alerts' },
        timestamp: new Date().toISOString()
      };
      
      if (data.taskName) embed.fields.push({ name: 'Task', value: data.taskName, inline: true });
      if (data.printerName) embed.fields.push({ name: 'Printer', value: data.printerName, inline: true });
      if (data.currentHours !== undefined) embed.fields.push({ name: 'Current Hours', value: `${data.currentHours.toFixed(1)}h`, inline: true });
      if (data.dueAtHours !== undefined) embed.fields.push({ name: 'Due At', value: `${data.dueAtHours.toFixed(1)}h`, inline: true });
    } else if (type === 'backup') {
      embed = {
        title: '💾 Database Backup Completed',
        description: data.message || 'Database backup completed successfully',
        color: 0x00FF00, // Green
        fields: [],
        footer: { text: 'PrintHive • System Backup' },
        timestamp: new Date().toISOString()
      };
      
      if (data.size) embed.fields.push({ name: 'Archive Size', value: data.size, inline: true });
      if (data.videos !== undefined) embed.fields.push({ name: 'Videos', value: data.videos > 0 ? `${data.videos} files` : 'Excluded', inline: true });
      if (data.library !== undefined) {
        const libText = data.includeLibrary ? `Included (${data.library} files)` : 'Excluded';
        embed.fields.push({ name: 'Library Files', value: libText, inline: true });
      }
      if (data.covers !== undefined) embed.fields.push({ name: 'Cover Images', value: data.covers > 0 ? `${data.covers} files` : 'Excluded', inline: true });
      if (data.remoteUploaded) embed.fields.push({ name: 'Remote Upload', value: '✅ Uploaded', inline: true });
    }
    
    // Get ping user ID if configured
    const pingUserIdRow = (await getConfig.get('discord_ping_user_id'));
    const pingUserId = pingUserIdRow?.value || '';
    const pingContent = pingUserId ? `<@${pingUserId}>` : '';
    
    // Use GitHub raw link for logo
    const logoUrl = 'https://raw.githubusercontent.com/tr1ckz/PrintHive/refs/heads/main/public/images/logo.png';
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: pingContent || undefined,
        username: 'PrintHive',
        avatar_url: logoUrl,
        embeds: [embed]
      })
    });
    
    return response.ok;
  } catch (error) {
    console.error('Error sending Discord notification:', error);
    return false;
  }
}

// Slack & Telegram send helpers and unified dispatcher
async function sendTelegramNotification(type, data) {
  try {
    const get = db.prepare('SELECT value FROM config WHERE key = ?');
    const botToken = (await get.get('telegram_bot_token'))?.value;
    const chatId = (await get.get('telegram_chat_id'))?.value;
    if (!botToken || !chatId) return false;
    const enabled = (await get.get(`telegram_${type}_enabled`))?.value === 'true';
    if (!enabled) return false;

    const titleMap = { printer: '🖨️ Printer', maintenance: '🔧 Maintenance', backup: '💾 Backup' };
    const title = titleMap[type] || 'Notification';
    let lines = [ `*${title}*`, data.message || '' ];
    if (type === 'printer') {
      if (data.printerName) lines.push(`• Printer: ${data.printerName}`);
      if (data.modelName) lines.push(`• Model: ${data.modelName}`);
      if (data.progress !== undefined) lines.push(`• Progress: ${data.progress}%`);
      if (data.timeElapsed) lines.push(`• Time: ${data.timeElapsed}`);
    } else if (type === 'maintenance') {
      if (data.taskName) lines.push(`• Task: ${data.taskName}`);
      if (data.printerName) lines.push(`• Printer: ${data.printerName}`);
      if (data.currentHours !== undefined) lines.push(`• Current: ${data.currentHours.toFixed(1)}h`);
      if (data.dueAtHours !== undefined) lines.push(`• Due At: ${data.dueAtHours.toFixed(1)}h`);
    } else if (type === 'backup') {
      if (data.size) lines.push(`• Size: ${data.size}`);
      if (data.videos !== undefined) lines.push(`• Videos: ${data.videos}`);
      if (data.library !== undefined) lines.push(`• Library: ${data.includeLibrary ? data.library : 'Excluded'}`);
      if (data.covers !== undefined) lines.push(`• Covers: ${data.covers}`);
      if (data.remoteUploaded) lines.push(`• Remote Upload: ✅`);
    }
    const text = lines.join('\n');
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    return true;
  } catch (e) {
    console.error('Telegram notification error:', e.message);
    return false;
  }
}

async function sendSlackNotification(type, data) {
  try {
    const get = db.prepare('SELECT value FROM config WHERE key = ?');
    const webhook = (await get.get('slack_webhook_url'))?.value;
    if (!webhook) return false;
    const enabled = (await get.get(`slack_${type}_enabled`))?.value === 'true';
    if (!enabled) return false;
    const titleMap = { printer: 'Printer', maintenance: 'Maintenance', backup: 'Backup' };
    const emojiMap = { printer: '🖨️', maintenance: '🔧', backup: '💾' };
    const title = `${emojiMap[type] || ''} ${titleMap[type] || 'Notification'}`;
    const payload = {
      text: data.message || title,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: title } },
        { type: 'section', fields: [] }
      ]
    };
    const addField = (name, value) => payload.blocks[1].fields.push({ type: 'mrkdwn', text: `*${name}:* ${value}` });
    if (type === 'printer') {
      if (data.printerName) addField('Printer', data.printerName);
      if (data.modelName) addField('Model', data.modelName);
      if (data.progress !== undefined) addField('Progress', `${data.progress}%`);
      if (data.timeElapsed) addField('Time', data.timeElapsed);
    } else if (type === 'maintenance') {
      if (data.taskName) addField('Task', data.taskName);
      if (data.printerName) addField('Printer', data.printerName);
      if (data.currentHours !== undefined) addField('Current', `${data.currentHours.toFixed(1)}h`);
      if (data.dueAtHours !== undefined) addField('Due At', `${data.dueAtHours.toFixed(1)}h`);
    } else if (type === 'backup') {
      if (data.size) addField('Archive Size', data.size);
      if (data.videos !== undefined) addField('Videos', data.videos);
      if (data.library !== undefined) addField('Library Files', data.includeLibrary ? `${data.library}` : 'Excluded');
      if (data.covers !== undefined) addField('Cover Images', data.covers);
      if (data.remoteUploaded) addField('Remote Upload', '✅ Uploaded');
    }
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return true;
  } catch (e) {
    console.error('Slack notification error:', e.message);
    return false;
  }
}

async function sendNotification(type, data) {
  // Always try provider-specific notifications if enabled
  try { await sendDiscordNotification(type, data); } catch {}
  try { await sendTelegramNotification(type, data); } catch {}
  try { await sendSlackNotification(type, data); } catch {}
}

module.exports = { sendNotification, sendDiscordNotification, sendTelegramNotification, sendSlackNotification };
