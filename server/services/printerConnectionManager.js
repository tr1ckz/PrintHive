const BambuMqttClient = require('./mqtt-client');

/**
 * Owns the per-printer MQTT client registry and the connect/cooldown/teardown
 * lifecycle for LAN mode. The connection strategy is lazy connect-on-poll:
 * /api/printers ensures a client exists for each configured printer, a 60s
 * cooldown stops unreachable printers being re-dialed on every poll, and
 * mqtt.js auto-reconnect owns recovery for transient drops (everConnected
 * distinguishes the two — see commits 86284e7 / ac8b7a9).
 *
 * All side effects are injected: `attachRealtimeBridge` wires job updates to
 * the WebSocket broadcast, `sendNotification` + `findRecentPrintByJobName`
 * feed the print_* notifications. The manager knows nothing about Express.
 */
class PrinterConnectionManager {
  constructor({ logger, sendNotification, findRecentPrintByJobName, attachRealtimeBridge, cooldownMs = 60000, mqttOptions }) {
    this.hooks = { logger, sendNotification, findRecentPrintByJobName, attachRealtimeBridge };
    this.cooldownMs = cooldownMs;
    this.mqttOptions = mqttOptions; // test hook: { port, connectTimeoutMs }; undefined in production
    // Store MQTT clients per printer (clientKey = `${ip}:${dev_id}`)
    this.clients = new Map();
    // Track recent failed MQTT connection attempts so an unreachable printer
    // isn't re-dialed on every status poll (which spawns zombie
    // auto-reconnecting clients and floods the log with connack-timeout errors).
    this.connectFailures = new Map(); // clientKey -> timestamp of last failure
  }

  getClient(clientKey) {
    return this.clients.get(clientKey);
  }

  values() {
    return this.clients.values();
  }

  /**
   * Ensure an MQTT client exists (or is in cooldown) for the given device.
   * Returns the clientKey. The body below is moved verbatim from the
   * GET /api/printers handler in simple-server.js — do not "clean it up";
   * the teardown ordering and cooldown semantics are load-bearing.
   */
  async ensureClient(deviceData, { deviceIp, deviceAccessCode, deviceSerial }) {
    const { logger, sendNotification, findRecentPrintByJobName } = this.hooks;
    const attachRealtimeBridgeToMqttClient = this.hooks.attachRealtimeBridge;
    const mqttClients = this.clients;
    const mqttConnectFailures = this.connectFailures;
    const MQTT_RECONNECT_COOLDOWN_MS = this.cooldownMs;
    const device = deviceData;

    const clientKey = `${deviceIp}:${device.dev_id}`;

    // Create or get existing MQTT client for this printer.
    // Skip if a recent attempt failed — avoids re-dialing an unreachable
    // printer on every poll and leaking zombie auto-reconnecting clients.
    const lastFailure = mqttConnectFailures.get(clientKey);
    const inCooldown = lastFailure && (Date.now() - lastFailure) < MQTT_RECONNECT_COOLDOWN_MS;
    if (!mqttClients.has(clientKey) && !inCooldown) {
      // Declared outside the try so the catch can tear it down. (In the
      // original inline version the catch referenced a `const mqttClient`
      // declared later in the outer scope — a TDZ ReferenceError that turned
      // every connect timeout into a 500 on /api/printers.)
      let mqttClient;
      try {
        mqttClient = new BambuMqttClient(deviceIp, deviceSerial, deviceAccessCode, device.name || 'Local Printer', this.mqttOptions);

        // Tear down the underlying client so it stops auto-reconnecting,
        // then remove it from the registry and start the cooldown.
        const teardownMqttClient = () => {
          mqttConnectFailures.set(clientKey, Date.now());
          if (mqttClients.get(clientKey) === mqttClient) {
            mqttClients.delete(clientKey);
          }
          try { mqttClient.disconnect(); } catch (_e) { /* already closed */ }
        };

        // Handle connection errors gracefully
        mqttClient.on('error', (error) => {
          logger.warn(`MQTT error for ${device.dev_id}: ${error.message}`);
          teardownMqttClient();
        });

        mqttClient.on('disconnected', () => {
          logger.info(`MQTT disconnected for ${device.dev_id}`);
          teardownMqttClient();
        });

        attachRealtimeBridgeToMqttClient(mqttClient, clientKey, deviceData);

        // Handle print state changes for Discord notifications
        mqttClient.on('print_completed', async (data) => {
          // Look up actual design title from database using existing print columns
          const print = (await findRecentPrintByJobName(data.jobName));

          const designName = print?.designTitle || print?.title || print?.plateName || data.jobName;

          logger.info(`Print completed on ${data.printerName}: ${data.jobName} (${designName})`);
          await sendNotification('printer', {
            status: 'completed',
            printerName: data.printerName,
            jobName: data.jobName,
            modelName: designName,
            progress: data.progress,
            message: `Print job "${data.jobName}" has completed successfully!`
          });
        });

        mqttClient.on('print_failed', async (data) => {
          // Look up actual design title from database using existing print columns
          const print = (await findRecentPrintByJobName(data.jobName));

          const designName = print?.designTitle || print?.title || print?.plateName || data.jobName;

          logger.warn(`Print FAILED on ${data.printerName}: ${data.jobName} (${designName})`);
          await sendNotification('printer', {
            status: 'failed',
            printerName: data.printerName,
            jobName: data.jobName,
            modelName: designName,
            errorCode: data.errorCode ? `0x${data.errorCode.toString(16).toUpperCase()}` : undefined,
            progress: data.progress,
            message: `Print job "${data.jobName}" has FAILED at ${data.progress}%!`
          });
        });

        mqttClient.on('print_error', async (data) => {
          // Look up actual design title from database using existing print columns
          const print = (await findRecentPrintByJobName(data.jobName));

          const designName = print?.designTitle || print?.title || print?.plateName || data.jobName;

          logger.warn(`Print ERROR on ${data.printerName}: ${data.jobName} (${designName})`);
          await sendNotification('printer', {
            status: 'error',
            printerName: data.printerName,
            jobName: data.jobName,
            modelName: designName,
            errorCode: data.errorCode ? `0x${data.errorCode.toString(16).toUpperCase()}` : undefined,
            progress: data.progress,
            message: `Printer error detected during "${data.jobName}" at ${data.progress}%`
          });
        });

        mqttClient.on('print_paused', async (data) => {
          // Look up actual design title from database using existing print columns
          const print = (await findRecentPrintByJobName(data.jobName));

          const designName = print?.designTitle || print?.title || print?.plateName || data.jobName;

          logger.info(`Print paused on ${data.printerName}: ${data.jobName} (${designName})`);
          await sendNotification('printer', {
            status: 'paused',
            printerName: data.printerName,
            jobName: data.jobName,
            modelName: designName,
            progress: data.progress,
            message: `Print job "${data.jobName}" has been paused at ${data.progress}%`
          });
        });

        await mqttClient.connect();
        mqttClients.set(clientKey, mqttClient);
        mqttConnectFailures.delete(clientKey); // connected cleanly — clear cooldown
        logger.info(`Created MQTT client for ${device.dev_id}`);

        // Wait briefly for initial MQTT message with AMS data
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        logger.warn(`Could not connect MQTT for ${device.dev_id}: ${error.message}`);
        // Start the cooldown and ensure the client is fully torn down so it
        // doesn't keep auto-reconnecting in the background.
        mqttConnectFailures.set(clientKey, Date.now());
        if (mqttClients.get(clientKey) === mqttClient) {
          mqttClients.delete(clientKey);
        }
        try { if (mqttClient) mqttClient.disconnect(); } catch (_e) { /* already closed */ }
      }
    }

    return clientKey;
  }

  disconnectAll(log = console.log) {
    for (const [key, client] of this.clients.entries()) {
      log(`Disconnecting MQTT client for ${key}`);
      try {
        client.disconnect();
      } catch (e) { /* already closed */ }
    }
    this.clients.clear();
  }
}

module.exports = PrinterConnectionManager;
