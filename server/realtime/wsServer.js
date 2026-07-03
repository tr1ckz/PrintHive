const { WebSocketServer, WebSocket } = require('ws');
const logger = require('../../logger');
const { db } = require('../../database');

// WebSocket bridge for live printer telemetry (/ws/printers). Owns the wss
// instance; the PrinterConnectionManager gets `attachRealtimeBridgeToMqttClient`
// injected so MQTT job updates broadcast here without the manager knowing
// about WebSockets. All functions moved verbatim from simple-server.js.

let realtimeWss = null;
const REALTIME_SOCKET_PATH = '/ws/printers';

function sendRealtimeMessage(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    socket.send(JSON.stringify({
      sentAt: new Date().toISOString(),
      ...payload,
    }));
  } catch (error) {
    logger.debug('[Realtime] Failed to send websocket message:', error.message);
  }
}

function broadcastRealtimeMessage(payload) {
  if (!realtimeWss) {
    return;
  }

  realtimeWss.clients.forEach((client) => {
    sendRealtimeMessage(client, payload);
  });
}

async function buildRealtimePrinterPayload(device, jobData = null, overrides = {}) {
  const printerId = device?.dev_id || overrides.dev_id || null;
  if (!printerId) {
    return null;
  }

  let latestConfig = {};
  try {
    latestConfig = (await db.prepare(`
      SELECT dev_id, name, ip_address, access_code, serial_number, camera_rtsp_url
      FROM printers
      WHERE dev_id = ?
    `).get(printerId)) || {};

    // Fallback: if no camera URL found by dev_id, look for a record matching by serial number
    // (handles ghost manual_* records that haven't been migrated yet).
    if (!latestConfig.camera_rtsp_url && device?.serial_number) {
      const bySerial = (await db.prepare(`
        SELECT camera_rtsp_url FROM printers WHERE serial_number = ? AND camera_rtsp_url IS NOT NULL AND TRIM(camera_rtsp_url) != ''
      `).get(device.serial_number));
      if (bySerial?.camera_rtsp_url) {
        latestConfig.camera_rtsp_url = bySerial.camera_rtsp_url;
      }
    }
  } catch (error) {
    logger.debug('[Realtime] Failed to load printer config snapshot:', error.message);
  }

  const mergedTask = jobData
    ? { ...(device?.current_task || {}), ...jobData, ...(overrides.current_task || {}) }
    : overrides.current_task || device?.current_task;

  return {
    type: 'printer.telemetry',
    printerId,
    payload: {
      ...device,
      ...latestConfig,
      ...overrides,
      dev_id: printerId,
      name: overrides.name || latestConfig.name || device?.name || printerId,
      online: overrides.online ?? device?.online ?? false,
      print_status: overrides.print_status || device?.print_status || mergedTask?.gcode_state || 'OFFLINE',
      camera_rtsp_url: overrides.camera_rtsp_url ?? latestConfig.camera_rtsp_url ?? device?.camera_rtsp_url ?? null,
      ams: overrides.ams ?? mergedTask?.ams ?? device?.ams,
      current_task: mergedTask || undefined,
    },
  };
}

function attachRealtimeBridgeToMqttClient(mqttClient, clientKey, device) {
  mqttClient.realtimeDevice = {
    ...(mqttClient.realtimeDevice || {}),
    ...device,
  };

  if (mqttClient.__realtimeBridgeAttached) {
    return;
  }

  mqttClient.__realtimeBridgeAttached = true;

  mqttClient.on('job_update', async (jobData) => {
    const payload = (await buildRealtimePrinterPayload(mqttClient.realtimeDevice || device, jobData, {
      online: true,
      print_status: jobData?.gcode_state || mqttClient.realtimeDevice?.print_status || 'ONLINE',
    }));

    if (payload) {
      broadcastRealtimeMessage(payload);
    }
  });

  mqttClient.on('disconnected', async () => {
    const payload = (await buildRealtimePrinterPayload(mqttClient.realtimeDevice || device, mqttClient.getCurrentJob(), {
      online: false,
      print_status: 'OFFLINE',
    }));

    if (payload) {
      broadcastRealtimeMessage(payload);
    }
  });

  mqttClient.on('error', async () => {
    const payload = (await buildRealtimePrinterPayload(mqttClient.realtimeDevice || device, mqttClient.getCurrentJob(), {
      online: false,
      print_status: 'OFFLINE',
    }));

    if (payload) {
      broadcastRealtimeMessage(payload);
    }
  });
}

function setupRealtimeServer(server, printerManager) {
  if (!server || realtimeWss) {
    return;
  }

  realtimeWss = new WebSocketServer({
    server,
    path: REALTIME_SOCKET_PATH,
  });

  realtimeWss.on('connection', async (socket) => {
    sendRealtimeMessage(socket, {
      type: 'realtime.welcome',
      payload: { status: 'connected' },
    });

    for (const mqttClient of printerManager.values()) {
      const payload = (await buildRealtimePrinterPayload(
        mqttClient.realtimeDevice || {},
        mqttClient.getCurrentJob(),
        { online: mqttClient.connected }
      ));

      if (payload) {
        sendRealtimeMessage(socket, payload);
      }
    }
  });

  logger.info(`[Realtime] WebSocket bridge ready at ${REALTIME_SOCKET_PATH}`);
}

function closeRealtimeServer(log = console.log) {
  if (realtimeWss) {
    try {
      realtimeWss.clients.forEach((client) => client.close());
      realtimeWss.close();
      log('Realtime websocket server closed');
    } catch (e) { /* already closed */ }
    realtimeWss = null;
  }
}

module.exports = {
  REALTIME_SOCKET_PATH,
  sendRealtimeMessage,
  broadcastRealtimeMessage,
  buildRealtimePrinterPayload,
  attachRealtimeBridgeToMqttClient,
  setupRealtimeServer,
  closeRealtimeServer,
};
