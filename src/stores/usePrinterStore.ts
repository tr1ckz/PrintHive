import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { API_ENDPOINTS } from '../config/api';
import type { Printer } from '../types';
import fetchWithRetry from '../utils/fetchWithRetry';

type SocketStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

type RealtimeEnvelope = {
  type: 'realtime.welcome' | 'printer.telemetry' | 'printer.snapshot';
  printerId?: string;
  payload?: Partial<Printer>;
  sentAt?: string;
};

interface PrinterStoreState {
  printersById: Record<string, Printer>;
  printerOrder: string[];
  loading: boolean;
  error: string;
  socketStatus: SocketStatus;
  reconnectAttempt: number;
  lastMessageAt: string | null;
  loadInitialPrinters: () => Promise<void>;
  upsertPrinters: (printers: Printer[]) => void;
  mergePrinterUpdate: (printerId: string, patch: Partial<Printer>) => void;
  connect: () => void;
  disconnect: () => void;
}

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let intentionalDisconnect = false;

const buildRealtimeSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/printers`;
};

const mergePrinter = (existing: Printer | undefined, patch: Partial<Printer>, printerId: string): Printer => {
  const existingTask = existing?.current_task;
  const patchTask = patch.current_task;
  const mergedTask = patchTask
    ? {
        ...(existingTask || {}),
        ...patchTask,
      }
    : existingTask;

  const nextPrinter: Printer = {
    dev_id: patch.dev_id || existing?.dev_id || printerId,
    name: patch.name || existing?.name || printerId,
    online: patch.online ?? existing?.online ?? false,
    print_status: patch.print_status || existing?.print_status || 'UNKNOWN',
    dev_model_name: patch.dev_model_name || existing?.dev_model_name || '',
    dev_product_name: patch.dev_product_name || existing?.dev_product_name || '',
    dev_access_code: patch.dev_access_code || existing?.dev_access_code || '',
    nozzle_diameter: patch.nozzle_diameter ?? existing?.nozzle_diameter ?? 0,
    dev_structure: patch.dev_structure || existing?.dev_structure || '',
    camera_rtsp_url: patch.camera_rtsp_url ?? existing?.camera_rtsp_url,
    ams: patch.ams ?? mergedTask?.ams ?? existing?.ams,
    current_task: mergedTask,
  };

  return {
    ...existing,
    ...patch,
    ...nextPrinter,
    ams: patch.ams ?? mergedTask?.ams ?? existing?.ams,
    current_task: mergedTask,
  };
};

export const usePrinterStore = create<PrinterStoreState>()(
  subscribeWithSelector((set, get) => ({
    printersById: {},
    printerOrder: [],
    loading: false,
    error: '',
    socketStatus: 'disconnected',
    reconnectAttempt: 0,
    lastMessageAt: null,

    upsertPrinters: (printers) => {
      set((state) => {
        const printersById = { ...state.printersById };
        const incomingOrder = printers.map((printer) => printer.dev_id).filter(Boolean);

        printers.forEach((printer) => {
          if (!printer?.dev_id) {
            return;
          }

          printersById[printer.dev_id] = mergePrinter(printersById[printer.dev_id], printer, printer.dev_id);
        });

        const printerOrder = incomingOrder.length > 0
          ? [...incomingOrder, ...state.printerOrder.filter((id) => !incomingOrder.includes(id))]
          : state.printerOrder;

        return {
          printersById,
          printerOrder,
          loading: false,
          error: '',
        };
      });
    },

    mergePrinterUpdate: (printerId, patch) => {
      if (!printerId) {
        return;
      }

      set((state) => {
        const current = state.printersById[printerId];
        const printersById = {
          ...state.printersById,
          [printerId]: mergePrinter(current, patch, printerId),
        };

        const printerOrder = state.printerOrder.includes(printerId)
          ? state.printerOrder
          : [...state.printerOrder, printerId];

        return {
          printersById,
          printerOrder,
          lastMessageAt: new Date().toISOString(),
        };
      });
    },

    loadInitialPrinters: async () => {
      set((state) => ({
        loading: state.printerOrder.length === 0,
        error: '',
      }));

      try {
        const response = await fetchWithRetry(API_ENDPOINTS.PRINTERS.LIST, { credentials: 'include' });
        const data = await response.json();
        get().upsertPrinters(data.devices || []);
      } catch (error) {
        set({
          loading: false,
          error: 'Failed to load printers',
        });
      }
    },

    connect: () => {
      if (typeof window === 'undefined') {
        return;
      }

      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
      }

      intentionalDisconnect = false;
      set((state) => ({
        socketStatus: state.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      }));

      const ws = new WebSocket(buildRealtimeSocketUrl());
      socket = ws;

      ws.addEventListener('open', () => {
        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        set({
          socketStatus: 'connected',
          reconnectAttempt: 0,
          error: '',
        });
      });

      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as RealtimeEnvelope;

          if ((message.type === 'printer.telemetry' || message.type === 'printer.snapshot') && message.printerId && message.payload) {
            get().mergePrinterUpdate(message.printerId, message.payload);
            set({ lastMessageAt: message.sentAt || new Date().toISOString() });
          }
        } catch (error) {
          console.error('Failed to parse realtime printer payload:', error);
        }
      });

      ws.addEventListener('error', () => {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
      });

      ws.addEventListener('close', () => {
        if (socket === ws) {
          socket = null;
        }

        if (intentionalDisconnect) {
          set({ socketStatus: 'disconnected', reconnectAttempt: 0 });
          return;
        }

        const nextAttempt = get().reconnectAttempt + 1;
        const retryDelay = Math.min(30000, 1000 * Math.pow(2, Math.min(nextAttempt - 1, 5)));

        set({
          socketStatus: 'reconnecting',
          reconnectAttempt: nextAttempt,
        });

        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
        }

        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          get().connect();
        }, retryDelay);
      });
    },

    disconnect: () => {
      intentionalDisconnect = true;

      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (socket) {
        socket.close(1000, 'client disconnect');
        socket = null;
      }

      set({
        socketStatus: 'disconnected',
        reconnectAttempt: 0,
      });
    },
  }))
);
