const mqtt = require('mqtt');
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

      console.log(`Connecting to Bambu printer MQTT at ${this.printerIp}:8883`);
      this.client = mqtt.connect(`mqtts://${this.printerIp}:8883`, options);

      this.client.on('connect', () => {
        console.log('Connected to Bambu printer MQTT');
        this.connected = true;
        
        // Subscribe to printer status updates
        const topic = `device/${this.serialNumber}/report`;
        this.client.subscribe(topic, (err) => {
          if (err) {
            console.error('MQTT subscribe error:', err);
            reject(err);
          } else {
            console.log(`Subscribed to ${topic}`);
            
            // Request current status
            this.requestStatus();
            resolve();
          }
        });
      });

      this.client.on('message', (topic, message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleMessage(data);
        } catch (error) {
          console.error('Error parsing MQTT message:', error);
        }
      });

      this.client.on('error', (error) => {
        console.error('MQTT error:', error);
        this.connected = false;
        this.emit('error', error);
      });

      this.client.on('close', () => {
        console.log('MQTT connection closed');
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
        console.log('📹 P1S Camera RTSP URL detected:', printData.ipcam.rtsp_url || 'No URL');
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
          print_error: 0
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
        speed_profile: (printData.speed_profile ?? printData.spd_lv ?? this.currentJobData.speed_profile ?? undefined),
        speed_factor: (printData.mc_print_speed ?? printData.work_speed ?? this.currentJobData.speed_factor ?? undefined),
        feedrate: (printData.feedrate ?? printData.feed_rate ?? this.currentJobData.feedrate ?? undefined),
        z_height: (printData.z_height ?? printData.z ?? this.currentJobData.z_height ?? undefined),
        fan_speed: (printData.fan_speed ?? printData.cooling_fan_speed ?? this.currentJobData.fan_speed ?? undefined),
        env_temp: (printData.env_temp ?? this.currentJobData.env_temp ?? undefined),
        env_humidity: (printData.env_humidity ?? this.currentJobData.env_humidity ?? undefined)
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
      const ams = data.ams || printData.ams;
      if (ams) {
        const trays = Array.isArray(ams.tray) ? ams.tray : (Array.isArray(ams.trays) ? ams.trays : []);
        newJobData.ams = {
          active_tray: (ams.active_tray ?? ams.cur_tray ?? ams.cur_tray_index ?? null),
          trays: trays.map((t, idx) => ({
            slot: (t.id ?? t.slot ?? idx),
            color: (t.color ?? t.tray_color ?? null),
            type: (t.type ?? t.tray_type ?? null),
            humidity: (t.humidity ?? t.humi ?? null),
            temp: (t.temp ?? t.temperature ?? null)
          }))
        };
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
            modelName: newJobData.name || newJobData.subtask_name || 'Unknown',
            progress: 100
          });
        }
        // Print failed or was cancelled
        else if (this.lastGcodeState === 'RUNNING' && (newGcodeState === 'FAILED' || newGcodeState === 'IDLE')) {
          if (newPrintError > 0 || newGcodeState === 'FAILED') {
            this.emit('print_failed', {
              printerName: this.printerName,
              modelName: newJobData.name || newJobData.subtask_name || 'Unknown',
              errorCode: newPrintError,
              progress: newJobData.progress || 0
            });
          }
        }
        // Print paused
        else if (this.lastGcodeState === 'RUNNING' && newGcodeState === 'PAUSE') {
          this.emit('print_paused', {
            printerName: this.printerName,
            modelName: newJobData.name || newJobData.subtask_name || 'Unknown',
            progress: newJobData.progress || 0
          });
        }
      }
      
      // Check for new print errors
      if (newPrintError > 0 && this.lastPrintError !== newPrintError) {
        this.emit('print_error', {
          printerName: this.printerName,
          modelName: newJobData.name || newJobData.subtask_name || 'Unknown',
          errorCode: newPrintError,
          progress: newJobData.progress || 0
        });
      }
      
      this.lastGcodeState = newGcodeState;
      this.lastPrintError = newPrintError;
      
      this.currentJobData = newJobData;
      this.emit('job_update', this.currentJobData);
      console.log('Job update:', this.currentJobData);
    }
  }

  requestStatus() {
    if (!this.client || !this.connected) {
      return;
    }

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
        console.error('Error requesting status:', err);
      } else {
        console.log('Requested printer status');
      }
    });
  }

  getCurrentJob() {
    return this.currentJobData;
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.connected = false;
      this.currentJobData = null;
    }
  }
}

module.exports = BambuMqttClient;
