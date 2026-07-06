const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../../logger');
const { db, dataDir, getPrintByModelIdFromDb } = require('../../database');
const { broadcastRealtimeMessage, attachRealtimeBridgeToMqttClient } = require('../realtime/wsServer');
const { isBambuTokenExpired } = require('../services/bambuAccounts');
const { hub: chamberCameraHub } = require('../services/bambuChamberCamera');

// Printer discovery, configuration, live status, chamber-camera proxying, and
// SD-card download routes. ctx injects the helpers and printerManager that
// still live in simple-server.js, plus a getter for the mutable transfer job.
module.exports = function createPrinterRouter(ctx) {
  const {
    printerManager,
    discoverPrinterIp,
    fetchAllCloudDevices,
    dedupeStrings,
    findMatchingCloudDevice,
    getAutoDiscoveryAttemptedDevIds,
    saveAutoDiscoveryAttemptedDevIds,
    getCloudDeviceAccessCodeCandidates,
    getConfiguredBambuAccounts,
    mergeConfiguredPrinters,
    resolveChamberCameraTarget,
    normalizePrinterIp,
    syncGo2RtcConfigSafe,
    go2rtcConfigPath,
    getPrinterTransferJob,
  } = ctx;

  const router = express.Router();

  // Discover and save local printer IP
  router.post('/api/printers/discover-ip', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const devId = String(req.body?.dev_id || '').trim();
    const explicitCidrs = Array.isArray(req.body?.scanCidrs)
      ? req.body.scanCidrs.map((value) => String(value || '').trim()).filter(Boolean)
      : [];

    if (!devId) {
      return res.status(400).json({ error: 'dev_id is required' });
    }

    const printer = (await db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(devId));
    if (!printer) {
      return res.status(404).json({ error: 'Printer not found in local configuration' });
    }

    try {
      const result = await discoverPrinterIp(printer, { explicitCidrs });
      res.json(result);
    } catch (error) {
      logger.error('[Discovery] Failed:', error);
      res.status(500).json({ error: 'Failed to discover printer IP', details: error.message });
    }
  });

  // Manual discover for unresolved printers (not a background job)
  router.post('/api/printers/discover-missing-ips', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const explicitCidrs = Array.isArray(req.body?.scanCidrs)
      ? req.body.scanCidrs.map((value) => String(value || '').trim()).filter(Boolean)
      : [];

    try {
      const [cloudDevices, configuredPrinters] = await Promise.all([
        (await fetchAllCloudDevices()),
        Promise.resolve((await db.prepare('SELECT * FROM printers ORDER BY name').all())),
      ]);

      const cloudConfiguredCount = cloudDevices.length;
      const printersWithIp = configuredPrinters.filter((printer) => String(printer.ip_address || '').trim().length > 0).length;
      const unresolved = configuredPrinters.filter((printer) => {
        const hasIp = String(printer.ip_address || '').trim().length > 0;
        const hasSerial = String(printer.serial_number || '').trim().length > 0 || String(printer.dev_id || '').trim().length > 0;
        return !hasIp && hasSerial;
      });

      const missingTarget = cloudConfiguredCount > 0
        ? Math.max(0, cloudConfiguredCount - printersWithIp)
        : unresolved.length;
      const maxToProcess = Math.min(unresolved.length, missingTarget || unresolved.length);

      const processed = [];
      let foundCount = 0;

      for (const printer of unresolved.slice(0, maxToProcess)) {
        const result = await discoverPrinterIp(printer, { explicitCidrs, cloudDevices });
        processed.push({ dev_id: printer.dev_id, name: printer.name || printer.dev_id, ...result });
        if (result.success) {
          foundCount += 1;
        }

        if (missingTarget > 0 && foundCount >= missingTarget) {
          break;
        }
      }

      res.json({
        success: true,
        cloudConfiguredCount,
        printersWithIpBefore: printersWithIp,
        missingTarget,
        processedCount: processed.length,
        foundCount,
        results: processed,
        note: 'Manual discover stops once the missing cloud-configured printer count is satisfied.',
      });
    } catch (error) {
      logger.error('[DiscoveryBulk] Failed:', error);
      res.status(500).json({ error: 'Failed to discover missing printer IPs', details: error.message });
    }
  });

  // Get all printer configurations
  router.get('/api/printers/config', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
      const printers = (await db.prepare('SELECT * FROM printers ORDER BY name').all());
      res.json({ success: true, printers });
    } catch (error) {
      console.error('Failed to load printer configs:', error);
      res.status(500).json({ error: 'Failed to load printer configurations' });
    }
  });

  // Save or update printer configuration
  router.post('/api/printers/config', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { dev_id, name, ip_address, access_code, serial_number, camera_rtsp_url } = req.body;
    
    if (!dev_id) {
      return res.status(400).json({ error: 'dev_id is required' });
    }
    
    try {
      const cloudDevices = await fetchAllCloudDevices();
      const cloudMatch = findMatchingCloudDevice(cloudDevices, { dev_id, name, serial_number });
      const effectiveDevId = String(cloudMatch?.dev_id || dev_id).trim();
      const effectiveSerialNumber = String(serial_number || cloudMatch?.serial_number || '').trim();
      const effectiveAccessCode = dedupeStrings([
        access_code,
        ...getCloudDeviceAccessCodeCandidates(cloudMatch),
      ])[0] || '';
      // Prefer the cloud device's display name so the DB and go2rtc labels stay in sync with the cloud
      const effectiveName = String(cloudMatch?.name || name || '').trim() || name || '';

      const existingPrinter = (await db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(effectiveDevId));
      const isNewPrinter = !existingPrinter;

      // When cloud binding changes the dev_id, carry over fields from the old record that weren't re-submitted.
      const devIdChanged = effectiveDevId !== dev_id;
      let oldRecord = null;
      if (devIdChanged) {
        oldRecord = (await db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(dev_id));
      }
      const effectiveCameraRtspUrl = camera_rtsp_url || (devIdChanged ? (oldRecord?.camera_rtsp_url || '') : '') || '';

      const upsert = db.prepare(`
        INSERT INTO printers (dev_id, name, ip_address, access_code, serial_number, camera_rtsp_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(dev_id) DO UPDATE SET 
          name = ?,
          ip_address = ?,
          access_code = ?,
          serial_number = ?,
          camera_rtsp_url = ?,
          updated_at = CURRENT_TIMESTAMP
      `);
      
      (await upsert.run(
        effectiveDevId, effectiveName, ip_address, effectiveAccessCode, effectiveSerialNumber, effectiveCameraRtspUrl,
        effectiveName, ip_address, effectiveAccessCode, effectiveSerialNumber, effectiveCameraRtspUrl
      ));

      // Broadcast realtime patch so connected clients pick up camera/name updates without reload.
      broadcastRealtimeMessage({
        type: 'printer.telemetry',
        printerId: effectiveDevId,
        payload: {
          dev_id: effectiveDevId,
          name: effectiveName,
          camera_rtsp_url: effectiveCameraRtspUrl || null,
        },
      });

      // Clean up the old manual/placeholder record now that it's been migrated to the cloud identity.
      if (devIdChanged && oldRecord) {
        (await db.prepare('DELETE FROM printers WHERE dev_id = ?').run(dev_id));
        logger.info(`[CloudBind] Migrated printer "${dev_id}" → "${effectiveDevId}", deleted old record.`);
      }

      const respondWithDiscovery = async () => {
        let autoDiscovery = null;
        const normalizedIp = String(ip_address || '').trim();
        const shouldAutoDiscover = isNewPrinter && !normalizedIp;

        if (shouldAutoDiscover) {
          const attemptedDevIds = (await getAutoDiscoveryAttemptedDevIds());
          const alreadyAttempted = attemptedDevIds.includes(effectiveDevId);

          if (!alreadyAttempted) {
            (await saveAutoDiscoveryAttemptedDevIds([...attemptedDevIds, effectiveDevId]));

            const savedPrinter = (await db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(effectiveDevId));
            if (savedPrinter) {
              autoDiscovery = await discoverPrinterIp(savedPrinter, { explicitCidrs: [], cloudDevices });
            }
          } else {
            autoDiscovery = {
              success: false,
              skipped: true,
              reason: 'already-attempted',
            };
          }
        }

        const go2rtcInfo = (await syncGo2RtcConfigSafe());
        res.json({
          success: true,
          dev_id: effectiveDevId,
          go2rtcConfigPath: go2rtcInfo?.path || go2rtcConfigPath,
          streamCount: go2rtcInfo?.streamCount || 0,
          autoDiscovery,
        });
      };

      try {
        await respondWithDiscovery();
      } catch (error) {
        // The printer was already saved; only the post-save auto-discovery failed.
        // Still report success, but don't try to respond twice.
        logger.warn('[AutoDiscovery] Failed after save:', error.message);
        if (!res.headersSent) {
          const go2rtcInfo = (await syncGo2RtcConfigSafe());
          res.json({
            success: true,
            go2rtcConfigPath: go2rtcInfo?.path || go2rtcConfigPath,
            streamCount: go2rtcInfo?.streamCount || 0,
            autoDiscovery: { success: false, error: error.message },
          });
        }
      }
    } catch (error) {
      console.error('Failed to save printer config:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to save printer configuration' });
      }
    }
  });

  // Delete printer configuration
  router.delete('/api/printers/config/:dev_id', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { dev_id } = req.params;
    
    try {
      const printer = (await db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(dev_id));

      (await db.prepare(`
        DELETE FROM printers
        WHERE dev_id = ?
           OR (? IS NOT NULL AND ? != '' AND serial_number = ?)
           OR (? IS NOT NULL AND ? != '' AND ip_address = ?)
      `).run(
        dev_id,
        printer?.serial_number || null,
        printer?.serial_number || null,
        printer?.serial_number || null,
        printer?.ip_address || null,
        printer?.ip_address || null,
        printer?.ip_address || null
      ));

      const legacyPrinterIp = (await db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip'))?.value || '';
      const legacySerialNumber = (await db.prepare('SELECT value FROM config WHERE key = ?').get('printer_serial_number'))?.value || '';
      const normalizedLegacyIp = normalizePrinterIp(legacyPrinterIp);
      const normalizedDeletedIp = normalizePrinterIp(printer?.ip_address);

      const matchesLegacyConfig = Boolean(
        printer && (
          (printer.serial_number && legacySerialNumber && printer.serial_number === legacySerialNumber) ||
          (normalizedDeletedIp && normalizedLegacyIp && normalizedDeletedIp === normalizedLegacyIp) ||
          dev_id === legacySerialNumber
        )
      );

      if (matchesLegacyConfig) {
        (await db.prepare('DELETE FROM config WHERE key IN (?, ?, ?, ?)').run(
          'printer_ip',
          'printer_access_code',
          'printer_serial_number',
          'camera_rtsp_url'
        ));
      }

      const go2rtcInfo = (await syncGo2RtcConfigSafe());
      res.json({ success: true, clearedLegacyConfig: matchesLegacyConfig, go2rtcConfigPath: go2rtcInfo?.path || go2rtcConfigPath, streamCount: go2rtcInfo?.streamCount || 0 });
    } catch (error) {
      console.error('Failed to delete printer config:', error);
      res.status(500).json({ error: 'Failed to delete printer configuration' });
    }
  });

  // Built-in chamber camera (P1/A1/X1) as an MJPEG stream. The browser renders it
  // directly in an <img>. Frames come from the printer's proprietary port-6000
  // stream via the chamber-camera bridge.
  router.get('/api/printers/:devId/chamber.mjpeg', async (req, res) => {
    if (!req.session?.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { host, accessCode } = await resolveChamberCameraTarget(req.params.devId);
    if (!host || !accessCode) {
      return res.status(404).json({ error: 'No LAN IP / access code available for this printer' });
    }

    const stream = chamberCameraHub.getStream(req.params.devId, host, accessCode);
    if (!stream) return res.status(500).json({ error: 'Failed to start chamber camera' });

    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=printhiveframe',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Connection: 'close',
    });

    const onFrame = (jpeg) => {
      if (res.writableEnded) return;
      res.write(`--printhiveframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      res.write(jpeg);
      res.write('\r\n');
    };

    stream.addSubscriber();
    stream.on('frame', onFrame);
    if (stream.lastFrame) onFrame(stream.lastFrame); // show something immediately

    const cleanup = () => {
      stream.off('frame', onFrame);
      stream.removeSubscriber();
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
  });

  // Single latest chamber frame as a JPEG — handy for thumbnails / connectivity
  // checks without holding an MJPEG connection open.
  router.get('/api/printers/:devId/chamber.jpg', async (req, res) => {
    if (!req.session?.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { host, accessCode } = await resolveChamberCameraTarget(req.params.devId);
    if (!host || !accessCode) {
      return res.status(404).json({ error: 'No LAN IP / access code available for this printer' });
    }

    const stream = chamberCameraHub.getStream(req.params.devId, host, accessCode);
    if (!stream) return res.status(500).json({ error: 'Failed to start chamber camera' });

    if (stream.lastFrame) {
      res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'no-store').send(stream.lastFrame);
      return;
    }

    // No frame cached yet — wait briefly for the first one.
    stream.addSubscriber();
    let done = false;
    const finish = (jpeg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.off('frame', onFrame);
      stream.removeSubscriber();
      if (jpeg) {
        res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'no-store').send(jpeg);
      } else if (!res.headersSent) {
        // Surface the concrete failure reason (refused / TLS / timeout / no auth).
        res.status(502).json({
          error: stream.lastError || 'Chamber camera did not produce a frame in time',
          host: stream.host,
        });
      }
    };
    const onFrame = (jpeg) => finish(jpeg);
    const timer = setTimeout(() => finish(null), 12000);
    // If the connection fails fast (refused / TLS / auth), report why instead of
    // waiting out the full timeout.
    stream.once('camera-error', () => setTimeout(() => finish(null), 400));
    stream.on('frame', onFrame);
    req.on('close', () => finish(stream.lastFrame));
  });

  // API routes
  router.get('/api/printers', async (req, res) => {
    logger.info('Printers request');
    logger.debug('Auth:', req.session.authenticated, 'Token present:', !!req.session.token);

    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get camera URL and printer settings from global config
    const cameraUrl = (await db.prepare('SELECT value FROM config WHERE key = ?').get('camera_rtsp_url'))?.value || null;
    const printerIp = (await db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip'))?.value;
    const accessCode = (await db.prepare('SELECT value FROM config WHERE key = ?').get('printer_access_code'))?.value;
    const serialNumber = (await db.prepare('SELECT value FROM config WHERE key = ?').get('printer_serial_number'))?.value;
    
    let printersData = { devices: [] };
    
    // Get all Bambu accounts (with fallback compatibility)
    const bambuAccounts = (await getConfiguredBambuAccounts(req)).filter((account) => account?.token);

    // Collect per-account failures so the UI can tell the user exactly why no
    // cloud printers showed up (most commonly: an expired token that needs
    // reconnecting) instead of silently rendering an empty list.
    const accountErrors = [];

    // Try to get printers from all connected Bambu Cloud accounts
    if (bambuAccounts.length > 0) {
      for (const account of bambuAccounts) {
        // Skip the doomed request if we can already see the token has expired.
        if (isBambuTokenExpired(account.token)) {
          logger.warn(`Bambu account ${account.email}: cloud token expired — reconnect the account in Settings.`);
          accountErrors.push({ email: account.email, reason: 'token_expired', needsReconnect: true });
          continue;
        }
        try {
          const apiUrl = account.region === 'china'
            ? 'https://api.bambulab.cn/v1/iot-service/api/user/bind'
            : 'https://api.bambulab.com/v1/iot-service/api/user/bind';

          const response = await axios.get(apiUrl, {
            headers: { 'Authorization': `Bearer ${account.token}` }
          });

          if (response.data?.devices) {
            logger.debug(`Found ${response.data.devices.length} printers from account ${account.email}`);
            printersData.devices = [...printersData.devices, ...response.data.devices];
          }
        } catch (error) {
          const status = error.response?.status;
          // 401/403 means the token is no longer accepted — surface it as a
          // reconnect prompt rather than a generic failure.
          const needsReconnect = status === 401 || status === 403;
          logger.warn(`Could not fetch printers from account ${account.email} (HTTP ${status || 'network error'}): ${error.message}`);
          accountErrors.push({
            email: account.email,
            reason: needsReconnect ? 'unauthorized' : 'fetch_failed',
            needsReconnect,
            status: status || null,
          });
        }
      }
    }

    // Surface account-level problems on the response (additive; the UI shows a
    // reconnect banner when present).
    if (accountErrors.length > 0) {
      printersData.accountErrors = accountErrors;
    }

    // Merge in locally configured printers so manually added printers always appear in the UI
    printersData.devices = (await mergeConfiguredPrinters(printersData.devices));

    // Legacy fallback for older single-printer MQTT config
    if (printersData.devices.length === 0 && printerIp && accessCode && serialNumber) {
      logger.info('No Bambu Cloud printers, but legacy local MQTT config exists - creating virtual device');
      printersData.devices = [{
        dev_id: serialNumber,
        name: 'Local Printer (MQTT)',
        dev_product_name: 'Unknown Model',
        online: false,
        print_status: 'CONFIGURED',
        ip_address: printerIp,
        access_code: accessCode,
        serial_number: serialNumber,
        camera_rtsp_url: cameraUrl || null,
        current_task: null
      }];
    }
    
    try {
      // Add camera URL and fetch current task for each printer
      if (printersData.devices) {
        const devicesWithExtras = await Promise.all(printersData.devices.map(async (device) => {
          const deviceData = { ...device };
          
          // Check for per-printer config from printers table (camera URL, IP, access code)
          const printerConfig = (await db.prepare('SELECT camera_rtsp_url, ip_address, access_code FROM printers WHERE dev_id = ?').get(device.dev_id));
          if (printerConfig) {
            if (printerConfig.camera_rtsp_url) deviceData.camera_rtsp_url = printerConfig.camera_rtsp_url;
            if (printerConfig.ip_address) deviceData.ip_address = printerConfig.ip_address;
            if (printerConfig.access_code) deviceData.access_code = printerConfig.access_code;
          }

          // The cloud/bind response carries the printer's current LAN access code
          // (dev_access_code). Bambu rotates it on firmware updates and LAN-mode
          // toggles, so a stored code silently goes stale and both MQTT and FTP
          // start returning auth failures. Treat the cloud code as authoritative:
          // use it for this connection and persist it so FTP/SD-card paths that
          // read the stored code self-heal too.
          const cloudAccessCode = getCloudDeviceAccessCodeCandidates(device)[0] || null;
          if (cloudAccessCode) {
            deviceData.access_code = cloudAccessCode;
            if (printerConfig && printerConfig.access_code !== cloudAccessCode) {
              try {
                (await db.prepare('UPDATE printers SET access_code = ?, updated_at = CURRENT_TIMESTAMP WHERE dev_id = ?').run(cloudAccessCode, device.dev_id));
                logger.info(`[Printer] Refreshed stored access code for ${device.dev_id} from cloud device info`);
              } catch (e) {
                logger.debug('[Printer] Failed to persist cloud access code:', e.message);
              }
            }
          }

          // Fallback to global camera URL
          if (!deviceData.camera_rtsp_url && cameraUrl) {
            deviceData.camera_rtsp_url = cameraUrl;
          }

          // Fallback to global printer IP/access code
          if (!deviceData.ip_address && printerIp) deviceData.ip_address = printerIp;
          if (!deviceData.access_code && accessCode) deviceData.access_code = accessCode;
          
          // Try to get current job from MQTT client using per-printer credentials when available
          const deviceIp = deviceData.ip_address || printerIp;
          const deviceAccessCode = String(deviceData.access_code || accessCode || '').trim();
          const deviceSerial = deviceData.serial_number || device.dev_id;

          if (deviceIp && deviceAccessCode && deviceSerial) {
            // Create/reuse the MQTT client for this printer (lazy connect +
            // cooldown semantics live in PrinterConnectionManager).
            const clientKey = await printerManager.ensureClient(deviceData, { deviceIp, deviceAccessCode, deviceSerial });
            
            // Get current job data from MQTT client
            const mqttClient = printerManager.getClient(clientKey);
            if (mqttClient) {
              attachRealtimeBridgeToMqttClient(mqttClient, clientKey, deviceData);
            }

            if (mqttClient && mqttClient.connected) {
              const jobData = mqttClient.getCurrentJob();
              const debugMqttLogging = logger.isLevelEnabled('DEBUG');
              
              if (debugMqttLogging) {
                logger.debug(`=== MQTT Job Data for ${device.dev_id} ===`);
                logger.debug(`Job data exists: ${!!jobData}`);
                if (jobData) {
                  logger.debug(`Job keys: ${Object.keys(jobData).join(', ')}`);
                  logger.debug(`Has AMS: ${!!jobData.ams}`);
                  if (jobData.ams) {
                    logger.debug(`AMS structure: ${JSON.stringify(jobData.ams, null, 2)}`);
                  }
                }
              }
              
              if (jobData) {
                // Always include AMS info at device level if available
                if (jobData.ams) {
                  deviceData.ams = jobData.ams;
                  logger.info(`✓ AMS data set for ${device.dev_id}: ${jobData.ams.trays?.length || 0} trays`);
                } else {
                  logger.debug(`✗ No AMS data in jobData for ${device.dev_id}`);
                }
                
                // Only include current_task if there's an actual job (not idle)
                const gcodeState = jobData.gcode_state ? jobData.gcode_state.toUpperCase() : 'IDLE';
                if (jobData.name && gcodeState !== 'IDLE') {
                  // Pass all MQTT job data to current_task (includes temps, speeds, AMS, etc.)
                  deviceData.current_task = { ...jobData };
                  logger.debug(`Current task set for ${device.dev_id}, includes AMS: ${!!deviceData.current_task.ams}`);
                  
                  // Derive print_status from gcode_state for more accurate status
                  if (gcodeState === 'RUNNING') {
                    deviceData.print_status = 'RUNNING';
                  } else if (gcodeState === 'FINISH') {
                    deviceData.print_status = 'SUCCESS';
                  } else if (gcodeState === 'FAILED') {
                    deviceData.print_status = 'FAILED';
                  } else if (gcodeState === 'PAUSE') {
                    deviceData.print_status = 'PAUSED';
                  }
                  logger.debug(`Updated print_status to ${deviceData.print_status} based on gcode_state ${gcodeState}`);
                  
                  // Check if there's a 3MF file for this print
                  if (jobData.name) {
                    const file3mf = (await db.prepare(`
                      SELECT f.filepath, f.modelId
                      FROM files f
                      JOIN prints p ON f.modelId = p.modelId
                      WHERE p.title = ? AND f.filetype = '3mf'
                      ORDER BY p.startTime DESC
                      LIMIT 1
                    `).get(jobData.name));
                    
                    if (file3mf) {
                      deviceData.current_task.model_id = file3mf.modelId;
                      deviceData.current_task.has_3mf = true;
                      logger.debug(`Found 3MF for current job: ${file3mf.modelId}`);
                    }
                  }
                  
                  // Use integrated P1S camera RTSP URL if available from MQTT
                  if (jobData.rtsp_url && !deviceData.camera_rtsp_url) {
                    deviceData.camera_rtsp_url = jobData.rtsp_url;
                  }
                  logger.debug(`Got job data via MQTT for ${device.dev_id}`);
                } else {
                  // Printer is idle - set status explicitly
                  deviceData.print_status = 'IDLE';
                  logger.debug(`Printer ${device.dev_id} is IDLE (gcode_state: ${gcodeState})`);
                }
              }
            }
          }
          
          return deviceData;
        }));
        
        printersData.devices = devicesWithExtras;
      }
      
      // Log AMS data in final response for debugging
      printersData.devices?.forEach(device => {
        if (device.ams) {
          logger.info(`✓ Device ${device.dev_id} has AMS in API response: ${device.ams.trays?.length || 0} trays`);
        } else if (device.current_task?.ams) {
          logger.info(`✓ Device ${device.dev_id} has AMS in current_task: ${device.current_task.ams.trays?.length || 0} trays`);
        } else {
          logger.debug(`✗ Device ${device.dev_id} has NO AMS data in API response`);
        }
      });
      
      res.json(printersData);
    } catch (error) {
      logger.error('Printers error:', error.response?.data || error.message);
      res.status(500).json({ error: 'Failed to fetch printers', details: error.response?.data });
    }
  });

  // Simple printer status for dashboard
  router.get('/api/printers/status', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
      let devices = [];

      const bambuAccounts = (await getConfiguredBambuAccounts(req)).filter((account) => account?.token);

      for (const account of bambuAccounts) {
        try {
          const apiUrl = account.region === 'china'
            ? 'https://api.bambulab.cn/v1/iot-service/api/user/bind'
            : 'https://api.bambulab.com/v1/iot-service/api/user/bind';

          const response = await axios.get(apiUrl, {
            headers: { 'Authorization': `Bearer ${account.token}` },
            timeout: 15000
          });

          if (response.data?.devices) {
            devices = [...devices, ...response.data.devices];
          }
        } catch (error) {
          logger.warn(`Could not fetch dashboard printer status from account ${account.email}: ${error.message}`);
        }
      }

      devices = (await mergeConfiguredPrinters(devices));

      const legacyPrinterIp = (await db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip'))?.value;
      const legacyAccessCode = (await db.prepare('SELECT value FROM config WHERE key = ?').get('printer_access_code'))?.value;
      const legacySerialNumber = (await db.prepare('SELECT value FROM config WHERE key = ?').get('printer_serial_number'))?.value;

      if (devices.length === 0 && legacyPrinterIp && legacyAccessCode && legacySerialNumber) {
        devices = [{
          dev_id: legacySerialNumber,
          name: 'Local Printer (MQTT)',
          dev_product_name: 'Unknown Model',
          online: false,
          print_status: 'CONFIGURED',
          ip_address: legacyPrinterIp,
          access_code: legacyAccessCode,
          serial_number: legacySerialNumber,
          current_task: null
        }];
      }

      const printers = devices.map(device => {
        const deviceIp = device.ip_address || legacyPrinterIp;
        const clientKey = `${deviceIp || ''}:${device.dev_id}`;
        const mqttClient = printerManager.getClient(clientKey);
        const mqttJob = mqttClient?.connected ? mqttClient.getCurrentJob() : null;

        return {
          id: device.dev_id,
          name: device.name || 'Printer',
          model: device.dev_product_name || (device.serial_number ? 'Local Printer' : 'Configured Printer'),
          status: device.print_status || mqttJob?.gcode_state || device.current_task?.gcode_state || 'CONFIGURED',
          progress: device.print_progress || mqttJob?.mc_percent || mqttJob?.progress || device.current_task?.progress || 0,
          online: Boolean(device.online),
          mqttConnected: Boolean(mqttClient?.connected),
          currentPrint: mqttJob?.name || device.current_task?.name || null,
          nozzleTemp: device.nozzle_temper || mqttJob?.nozzle_temper || mqttJob?.nozzle_temp || device.current_task?.nozzle_temp || 0,
          bedTemp: device.bed_temper || mqttJob?.bed_temper || mqttJob?.bed_temp || device.current_task?.bed_temp || 0
        };
      });
      
      const online = printers.filter(p => p.online).length;
      
      res.json({
        printers,
        online,
        total: printers.length
      });
    } catch (error) {
      console.error('Printer status error:', error.message);

      const fallbackPrinters = (await mergeConfiguredPrinters([])).map(device => ({
        id: device.dev_id,
        name: device.name || 'Printer',
        model: device.dev_product_name || 'Configured Printer',
        status: device.print_status || 'CONFIGURED',
        progress: 0,
        online: false,
        currentPrint: null,
        nozzleTemp: 0,
        bedTemp: 0
      }));

      res.json({
        printers: fallbackPrinters,
        online: 0,
        total: fallbackPrinters.length
      });
    }
  });

  // Get recent prints for dashboard
  router.get('/api/prints', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const limit = parseInt(req.query.limit) || 50;
    
    try {
      const prints = (await db.prepare(`
        SELECT id, title, cover, modelId, status, startTime, deviceName, weight, costTime
        FROM prints 
        ORDER BY startTime DESC 
        LIMIT ?
      `).all(limit));
      
      // Resolve local cover paths. List the cache dir once instead of doing two
      // synchronous fs.existsSync() probes per row (up to 100 blocking stats/req).
      const coverCacheDir = path.join(dataDir, 'cover-cache');
      let coverFiles = new Set();
      try {
        coverFiles = new Set(fs.readdirSync(coverCacheDir));
      } catch (_e) { /* dir may not exist yet */ }

      const printsWithCovers = prints.map(print => {
        let coverUrl = null;
        if (print.modelId) {
          if (coverFiles.has(`${print.modelId}.jpg`)) {
            coverUrl = `/images/covers/${print.modelId}.jpg`;
          } else if (coverFiles.has(`${print.modelId}.png`)) {
            coverUrl = `/images/covers/${print.modelId}.png`;
          }
        }
        return { ...print, cover: coverUrl };
      });
      
      res.json(printsWithCovers);
    } catch (error) {
      console.error('Prints error:', error.message);
      res.json([]);
    }
  });

  // Download from printer SD card
  router.get('/api/printer/download/:modelId', async (req, res) => {
    console.log('=== PRINTER DOWNLOAD REQUEST ===');
    console.log('Model ID:', req.params.modelId);
    
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
      const print = (await getPrintByModelIdFromDb(req.params.modelId));
      if (!print) {
        return res.status(404).json({ error: 'Print not found in database' });
      }
      
      console.log('Found print:', { id: print.id, title: print.title, profileId: print.profileId });
      
      // The 3MF file is stored on the printer at: ftp://<printer_ip>/cache/<profileId>.3mf
      // We need to use the Bambu API to access it via signed URL
      const fileUrl = `https://api.bambulab.com/v1/iot-service/api/user/project/${print.profileId}`;
      console.log('Fetching file info from:', fileUrl);
      
      const fileResponse = await axios.get(fileUrl, {
        headers: { 'Authorization': `Bearer ${req.session.token}` }
      });
      
      if (fileResponse.data && fileResponse.data.url) {
        console.log('Downloading from printer:', fileResponse.data.url);
        const downloadResponse = await axios.get(fileResponse.data.url, { 
          responseType: 'arraybuffer',
          timeout: 30000
        });
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${print.title || print.modelId}.3mf"`);
        res.send(downloadResponse.data);
      } else {
        res.status(404).json({ error: 'File URL not available from printer' });
      }
    } catch (error) {
      console.error('Printer download error:', error.message);
      res.status(500).json({ error: 'Failed to download from printer', details: error.message });
    }
  });

  router.get('/api/printer-transfer-status', (req, res) => {
    const printerTransferJob = getPrinterTransferJob();
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const elapsed = printerTransferJob.startTime ? ((Date.now() - printerTransferJob.startTime) / 1000).toFixed(1) : 0;
    const percent = printerTransferJob.total > 0
      ? Math.round((printerTransferJob.processed / Math.max(printerTransferJob.total, 1)) * 100)
      : 0;

    res.json({
      ...printerTransferJob,
      elapsedSeconds: elapsed,
      percentComplete: percent,
    });
  });

  return router;
};
