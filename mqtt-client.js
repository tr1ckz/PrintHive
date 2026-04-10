const mqtt = require('mqtt');
const logger = require('./logger');
const EventEmitter = require('events');

class BambuMqttClient extends EventEmitter {
  constructor(printerIp, serialNumber, accessCode, printerName = null) {
    super();
    this.printerIp = printerIp;
    this.serialNumber = serialNumber;
    this.accessCode = accessCode;
    this.printerName = printerName || serialNumber;
    this.client = null;
    this.connected = false;
    this.currentJobData = null;
    this.lastGcodeState = null; // Track state changes
    this.lastPrintError = 0;
    this.pendingRawMessage = null;
    this.messageProcessingScheduled = false;
    this.pendingJobUpdate = null;
    this.pendingJobTimer = null;
    this.lastEmittedJobData = null;
    this.lastJobEmitAt = 0;
    this.lastStatusRequestAt = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const options = {
        clientId: `bambu-web-${Date.now()}`,
        username: 'bblp',
        password: this.accessCode,
        protocol: 'mqtts',
        rejectUnauthorized: false, // Bambu uses self-signed certs
        reconnectPeriod: 5000,
        connectTimeout: 10000
      };

      logger.info(`Connecting to Bambu printer MQTT at ${this.printerIp}:8883`);
      this.client = mqtt.connect(`mqtts://${this.printerIp}:8883`, options);

      this.client.on('connect', () => {
        logger.info('Connected to Bambu printer MQTT');
        this.connected = true;
        
        // Subscribe to printer status updates
        const topic = `device/${this.serialNumber}/report`;
        this.client.subscribe(topic, (err) => {
          if (err) {
            logger.error('MQTT subscribe error:', err);
            reject(err);
          } else {
            logger.debug(`Subscribed to ${topic}`);
            
            // Request current status
            this.requestStatus();
            resolve();
          }
        });
      });

      this.client.on('message', (_topic, message) => {
        this.pendingRawMessage = message.toString();

        if (this.messageProcessingScheduled) {
          return;
        }

        this.messageProcessingScheduled = true;
        setImmediate(() => this.processLatestMessage());
      });

      this.client.on('error', (error) => {
        logger.error('MQTT error:', error);
        this.connected = false;
        this.emit('error', error);
      });

      this.client.on('close', () => {
        logger.info('MQTT connection closed');
        this.connected = false;
        this.emit('disconnected');
      });

      // Timeout if connection takes too long
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('MQTT connection timeout'));
        }
      }, 15000);
    });
  }

  handleMessage(data) {
    // Bambu sends print data in the 'print' object
    if (data.print) {
      const printData = data.print;
      
      // Debug: Log ipcam data if present
      if (printData.ipcam) {
        logger.debug('P1S Camera RTSP URL detected');
      }
      
      // Initialize currentJobData if null
      if (!this.currentJobData) {
        this.currentJobData = {
          name: 'Unknown',
          gcode_file: '',
          subtask_name: '',
          progress: 0,
          remaining_time: 0,
          end_time: null,
          layer_num: 0,
          total_layers: 0,
          gcode_state: 'IDLE',
          print_error: 0,
          ams: null // Persist AMS data
        };
      }
      
      // Calculate end time from remaining_time (in minutes)
      let endTime = this.currentJobData.end_time || null;
      const remainingMinutes = printData.mc_remaining_time !== undefined ? printData.mc_remaining_time : (this.currentJobData.remaining_time || 0);
      if (remainingMinutes > 0) {
        endTime = new Date(Date.now() + remainingMinutes * 60 * 1000).toISOString();
      }
      
      // Merge new data with existing data, keeping good values
      // Only update fields that are actually present in the message
      const newJobData = {
        name: printData.subtask_name || printData.gcode_file || this.currentJobData.name || 'Unknown',
        gcode_file: printData.gcode_file || this.currentJobData.gcode_file || '',
        subtask_name: printData.subtask_name || this.currentJobData.subtask_name || '',
        progress: printData.mc_percent !== undefined ? printData.mc_percent : (this.currentJobData.progress || 0),
        remaining_time: remainingMinutes,
        end_time: endTime,
        layer_num: printData.layer_num !== undefined ? printData.layer_num : (this.currentJobData.layer_num || 0),
        total_layers: printData.total_layer_num || this.currentJobData.total_layers || 0,
        gcode_state: printData.gcode_state || this.currentJobData.gcode_state || 'IDLE',
        print_error: printData.print_error !== undefined ? printData.print_error : (this.currentJobData.print_error || 0),
        // Extra telemetry when available
        nozzle_temp: (printData.nozzle_temper ?? printData.nozzle_temp ?? this.currentJobData.nozzle_temp ?? undefined),
        bed_temp: (printData.bed_temper ?? printData.bed_temp ?? this.currentJobData.bed_temp ?? undefined),
        chamber_temp: (printData.chamber_temper ?? printData.chamber_temp ?? this.currentJobData.chamber_temp ?? undefined),
        nozzle_target: (printData.nozzle_target_temper ?? printData.target_nozzle_temper ?? this.currentJobData.nozzle_target ?? undefined),
        bed_target: (printData.bed_target_temper ?? printData.target_bed_temper ?? this.currentJobData.bed_target ?? undefined),
        speed_profile: (printData.spd_lvl ?? printData.spd_lv ?? this.currentJobData.speed_profile ?? undefined),
        speed_factor: (printData.spd_mag ?? printData.mc_print_speed ?? this.currentJobData.speed_factor ?? undefined),
        feedrate: (printData.feedrate ?? printData.feed_rate ?? this.currentJobData.feedrate ?? undefined),
        z_height: (printData.z_height ?? printData.z ?? this.currentJobData.z_height ?? undefined),
        // Fan speeds (0-15 scale from printer, convert to percentage)
        cooling_fan: (printData.cooling_fan_speed ?? printData.fan_speed ?? this.currentJobData.cooling_fan ?? undefined),
        aux_fan: (printData.big_fan1_speed ?? printData.aux_fan_speed ?? this.currentJobData.aux_fan ?? undefined),
        chamber_fan: (printData.big_fan2_speed ?? printData.chamber_fan_speed ?? this.currentJobData.chamber_fan ?? undefined),
        heatbreak_fan: (printData.heatbreak_fan_speed ?? this.currentJobData.heatbreak_fan ?? undefined),
        // Lights
        chamber_light: (printData.lights_report?.[0]?.node === 'chamber_light' ? printData.lights_report[0].mode : (this.currentJobData.chamber_light ?? undefined)),
        // Stage/status
        stg_cur: (printData.stg_cur ?? this.currentJobData.stg_cur ?? undefined),
        // WiFi signal
        wifi_signal: (printData.wifi_signal ?? this.currentJobData.wifi_signal ?? undefined),
        // Print weight/length from cloud data
        print_weight: (printData.print_weight ?? this.currentJobData.print_weight ?? undefined),
        print_length: (printData.print_length ?? this.currentJobData.print_length ?? undefined),
        // Total usage
        total_usage: (printData.total_hours ?? printData.usage_hours ?? this.currentJobData.total_usage ?? undefined),
        // HMS errors
        hms: (printData.hms ?? this.currentJobData.hms ?? undefined)
      };
      
      // Extract integrated camera RTSP URL from P1S
      if (printData.ipcam && printData.ipcam.rtsp_url) {
        newJobData.rtsp_url = printData.ipcam.rtsp_url;
        if (printData.ipcam.status) newJobData.ipcam_status = printData.ipcam.status;
        if (printData.ipcam.bitrate || printData.ipcam.bit_rate) newJobData.ipcam_bitrate = printData.ipcam.bitrate || printData.ipcam.bit_rate;
      } else if (this.currentJobData.rtsp_url) {
        newJobData.rtsp_url = this.currentJobData.rtsp_url;
      }

      // AMS information, when provided
      const amsRaw = data.ams || printData.ams;
      if (amsRaw) {
        // Some payloads nest AMS under ams[0].tray
        let traysSource = [];
        let amsUnit = null;
        
        if (Array.isArray(amsRaw.tray)) {
          traysSource = amsRaw.tray;
          amsUnit = amsRaw;
        } else if (Array.isArray(amsRaw.trays)) {
          traysSource = amsRaw.trays;
          amsUnit = amsRaw;
        } else if (Array.isArray(amsRaw.ams) && amsRaw.ams.length > 0) {
          traysSource = amsRaw.ams[0].tray || amsRaw.ams[0].trays || [];
          amsUnit = amsRaw.ams[0];
        }

        const trays = Array.isArray(traysSource) ? traysSource : [];
        const activeTray = (amsRaw.active_tray ?? amsRaw.cur_tray ?? amsRaw.cur_tray_index ?? (amsRaw.tray_now ? parseInt(amsRaw.tray_now, 10) : null));

        newJobData.ams = {
          active_tray: activeTray,
          trays: trays.map((t, idx) => {
            const humidityRaw = t.humidity ?? t.humi ?? (amsUnit ? amsUnit.humidity : null);
            const tempRaw = t.temp ?? t.temperature ?? (amsUnit ? amsUnit.temp : null);
            return {
              slot: (t.id ?? t.slot ?? idx),
              color: (t.color ?? t.tray_color ?? t.cols?.[0] ?? null),
              type: (t.type ?? t.tray_type ?? null),
              sub_brands: (t.tray_sub_brands ?? null),
              remain: (t.remain != null && t.remain >= 0 ? t.remain : null),
              humidity: humidityRaw != null ? parseFloat(humidityRaw) : null,
              temp: tempRaw != null ? parseFloat(tempRaw) : null
            };
          })
        };

        logger.debug(`AMS data updated for ${this.printerName}: ${trays.length} trays, active=${activeTray ?? 'none'}`);
      } else if (this.currentJobData && this.currentJobData.ams) {
        // Preserve existing AMS data if we have it
        newJobData.ams = this.currentJobData.ams;
      }

      // Error message if available
      if (printData.error_msg || printData.last_error) {
        newJobData.error_message = printData.error_msg || printData.last_error;
      }
      
      // Detect state changes for notifications
      const newGcodeState = newJobData.gcode_state;
      const newPrintError = newJobData.print_error;
      
      // Check for state transitions
      if (this.lastGcodeState && this.lastGcodeState !== newGcodeState) {
        // Print just finished successfully
        if (this.lastGcodeState === 'RUNNING' && newGcodeState === 'FINISH') {
          this.emit('print_completed', {
            printerName: this.printerName,
            jobName: newJobData.name || newJobData.subtask_name || 'Unknown',
            modelName: undefined,
            progress: 100
          });
        }
        // Print failed or was cancelled
        else if (this.lastGcodeState === 'RUNNING' && (newGcodeState === 'FAILED' || newGcodeState === 'IDLE')) {
          if (newPrintError > 0 || newGcodeState === 'FAILED') {
            this.emit('print_failed', {
              printerName: this.printerName,
              jobName: newJobData.name || newJobData.subtask_name || 'Unknown',
              modelName: undefined,
              errorCode: newPrintError,
              progress: newJobData.progress || 0
            });
          }
        }
        // Print paused
        else if (this.lastGcodeState === 'RUNNING' && newGcodeState === 'PAUSE') {
          this.emit('print_paused', {
            printerName: this.printerName,
            jobName: newJobData.name || newJobData.subtask_name || 'Unknown',
            modelName: undefined,
            progress: newJobData.progress || 0
          });
        }
      }
      
      // Check for new print errors
      if (newPrintError > 0 && this.lastPrintError !== newPrintError) {
        this.emit('print_error', {
          printerName: this.printerName,
          jobName: newJobData.name || newJobData.subtask_name || 'Unknown',
          modelName: undefined,
          errorCode: newPrintError,
          progress: newJobData.progress || 0
        });
      }
      
      this.lastGcodeState = newGcodeState;
      this.lastPrintError = newPrintError;
      this.currentJobData = newJobData;
      this.queueJobUpdate(this.currentJobData);
    }
  }

  processLatestMessage() {
    const rawMessage = this.pendingRawMessage;
    this.pendingRawMessage = null;
    this.messageProcessingScheduled = false;

    if (!rawMessage) {
      return;
    }

    try {
      const data = JSON.parse(rawMessage);
      this.handleMessage(data);
    } catch (error) {
      logger.error('Error parsing MQTT message:', error);
    }

    if (this.pendingRawMessage && !this.messageProcessingScheduled) {
      this.messageProcessingScheduled = true;
      setImmediate(() => this.processLatestMessage());
    }
  }

  hasMeaningfulUpdate(previousJobData, nextJobData) {
    if (!previousJobData) {
      return true;
    }

    return (
      (previousJobData.gcode_state || 'IDLE') !== (nextJobData.gcode_state || 'IDLE') ||
      (previousJobData.name || '') !== (nextJobData.name || '') ||
      Math.floor(previousJobData.progress || 0) !== Math.floor(nextJobData.progress || 0) ||
      (previousJobData.print_error || 0) !== (nextJobData.print_error || 0)
    );
  }

  queueJobUpdate(jobData) {
    this.pendingJobUpdate = { ...jobData };
    const now = Date.now();
    const isMeaningfulUpdate = this.hasMeaningfulUpdate(this.lastEmittedJobData, jobData);

    if (!isMeaningfulUpdate) {
      return;
    }

    const stateChanged = (this.lastEmittedJobData?.gcode_state || 'IDLE') !== (jobData.gcode_state || 'IDLE');
    const timeSinceLastEmit = now - this.lastJobEmitAt;

    if (stateChanged || timeSinceLastEmit >= 1500) {
      this.flushJobUpdate();
      return;
    }

    if (this.pendingJobTimer) {
      clearTimeout(this.pendingJobTimer);
    }

    this.pendingJobTimer = setTimeout(
      () => this.flushJobUpdate(),
      Math.max(150, 1500 - timeSinceLastEmit)
    );
  }

  flushJobUpdate() {
    if (!this.pendingJobUpdate) {
      return;
    }

    if (this.pendingJobTimer) {
      clearTimeout(this.pendingJobTimer);
      this.pendingJobTimer = null;
    }

    if (this.lastEmittedJobData && !this.hasMeaningfulUpdate(this.lastEmittedJobData, this.pendingJobUpdate)) {
      this.pendingJobUpdate = null;
      return;
    }

    this.lastEmittedJobData = { ...this.pendingJobUpdate };
    this.pendingJobUpdate = null;
    this.lastJobEmitAt = Date.now();
    this.emit('job_update', this.lastEmittedJobData);
    logger.debug(`Emitted MQTT update for ${this.printerName} (${this.lastEmittedJobData.gcode_state || 'IDLE'} @ ${Math.floor(this.lastEmittedJobData.progress || 0)}%)`);
  }

  requestStatus() {
    if (!this.client || !this.connected) {
      return;
    }

    const now = Date.now();
    if (now - this.lastStatusRequestAt < 5000) {
      return;
    }
    this.lastStatusRequestAt = now;

    // Request push_all to get current status
    const topic = `device/${this.serialNumber}/request`;
    const message = {
      pushing: {
        sequence_id: Date.now().toString(),
        command: 'pushall'
      }
    };

    this.client.publish(topic, JSON.stringify(message), (err) => {
      if (err) {
        logger.error('Error requesting status:', err);
      } else {
        logger.debug('Requested printer status');
      }
    });
  }

  getCurrentJob() {
    return this.currentJobData;
  }

  disconnect() {
    if (this.pendingJobTimer) {
      clearTimeout(this.pendingJobTimer);
      this.pendingJobTimer = null;
    }

    this.pendingRawMessage = null;
    this.pendingJobUpdate = null;
    this.messageProcessingScheduled = false;
    this.lastEmittedJobData = null;

    if (this.client) {
      this.client.end();
      this.connected = false;
      this.currentJobData = null;
    }
  }
}

module.exports = BambuMqttClient;
