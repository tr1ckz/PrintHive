export interface Printer {
  dev_id: string;
  name: string;
  online: boolean;
  print_status: string;
  dev_model_name: string;
  dev_product_name: string;
  dev_access_code: string;
  nozzle_diameter: number;
  dev_structure: string;
  camera_rtsp_url?: string;
  current_task?: {
    name?: string;
    progress?: number;
    remaining_time?: number;
    end_time?: string;
    layer_num?: number;
    total_layers?: number;
    model_id?: string;
    has_3mf?: boolean;
    // Extra telemetry
    nozzle_temp?: number;
    bed_temp?: number;
    chamber_temp?: number;
    nozzle_target?: number;
    bed_target?: number;
    speed_profile?: string;
    speed_factor?: number;
    feedrate?: number;
    z_height?: number;
    gcode_state?: string;
    error_code?: number;
    error_message?: string;
    rtsp_url?: string;
    ipcam_status?: string;
    ipcam_bitrate?: number;
    env_temp?: number;
    env_humidity?: number;
    ams?: {
      active_tray: number | null;
      trays: Array<{
        slot: number;
        color: string | null;
        type: string | null;
        humidity: number | null;
        temp: number | null;
      }>;
    };
  };
}

export interface FilamentMapping {
  ams: number;
  sourceColor: string;
  targetColor: string;
  filamentId: string;
  filamentType: string;
  targetFilamentType: string;
  weight: number;
  nozzleId: number;
  amsId: number;
  slotId: number;
}

export interface Print {
  id: number;
  designId: number;
  designTitle: string;
  instanceId: number;
  modelId: string;
  title: string;
  cover: string;
  status: number;
  feedbackStatus: number;
  startTime: string;
  endTime: string;
  weight: number;
  length: number;
  costTime: number;
  profileId: number;
  plateIndex: number;
  plateName: string;
  deviceId: string;
  deviceModel: string;
  deviceName: string;
  bedType: string;
  jobType: number;
  mode: string;
  isPublicProfile: boolean;
  isPrintable: boolean;
  isDelete: boolean;
  amsDetailMapping: FilamentMapping[];
  material: {
    id: string;
    name: string;
  };
  platform: string;
  stepSummary: any[];
  nozzleInfos: any[];
  snapShot: string;
}

export interface Statistics {
  totalPrints: number;
  successfulPrints: number;
  failedPrints: number;
  successRate: number;
  totalWeight: number;
  totalTime: number;
  materials: Record<string, { weight: number; type: string; count: number }>;
}
