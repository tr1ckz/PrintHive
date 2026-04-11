import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CameraStreamType } from '../types';
import './FrigateCamera.css';

type HlsModule = typeof import('hls.js');
type HlsConstructor = HlsModule['default'];

type StreamState = 'loading' | 'playing' | 'offline';
type StreamMode = 'webrtc' | 'hls' | 'none';

interface FrigateCameraProps {
  streamType?: CameraStreamType;
  streamUrl?: string;
  printerName?: string;
  className?: string;
}

interface StreamTarget {
  mode: StreamMode;
  wsUrl: string | null;
  hlsUrl: string | null;
  statusHint: string;
  label: string;
}

const RETRY_DELAYS_MS = [2000, 5000, 10000, 15000, 30000];
const WEBRTC_ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

const isWebSocketUrl = (value: string) => /^wss?:\/\//i.test(value.trim());
const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());
const normalizeUrl = (value?: string) => (value || '').trim();

const toWebSocketUrl = (value: string) => {
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`;
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`;
  return value;
};

const buildStreamTarget = (streamType: CameraStreamType = 'frigate-hls', streamUrl?: string): StreamTarget => {
  const source = normalizeUrl(streamUrl);
  if (!source) {
    return {
      mode: 'none',
      wsUrl: null,
      hlsUrl: null,
      statusHint: 'No camera stream configured yet.',
      label: '',
    };
  }

  if (streamType === 'frigate-webrtc') {
    if (!isHttpUrl(source) && !isWebSocketUrl(source)) {
      return {
        mode: 'none',
        wsUrl: null,
        hlsUrl: null,
        statusHint: 'Frigate WebRTC needs an absolute http(s) or ws(s) URL.',
        label: 'Frigate WebRTC',
      };
    }

    return {
      mode: 'webrtc',
      wsUrl: toWebSocketUrl(source),
      hlsUrl: null,
      statusHint: 'Opening Frigate WebRTC stream…',
      label: 'Frigate WebRTC',
    };
  }

  if (!isHttpUrl(source)) {
    return {
      mode: 'none',
      wsUrl: null,
      hlsUrl: null,
      statusHint: 'Frigate HLS needs an absolute http(s) .m3u8 URL.',
      label: 'Frigate HLS',
    };
  }

  return {
    mode: 'hls',
    wsUrl: null,
    hlsUrl: source,
    statusHint: 'Opening Frigate HLS stream…',
    label: 'Frigate HLS',
  };
};

function FrigateCamera({
  streamType = 'frigate-hls',
  streamUrl,
  printerName = 'Printer',
  className = ''
}: FrigateCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<InstanceType<HlsConstructor> | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [streamState, setStreamState] = useState<StreamState>('loading');
  const [statusMessage, setStatusMessage] = useState('Connecting…');
  const [reloadToken, setReloadToken] = useState(0);

  const streamTarget = useMemo(
    () => buildStreamTarget(streamType, streamUrl),
    [streamType, streamUrl]
  );
  const canRetry = streamTarget.mode !== 'none';

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const destroyStream = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.getSenders().forEach((sender) => {
        sender.track?.stop();
      });
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
    }
  }, []);

  const scheduleRetry = useCallback((message: string) => {
    setStreamState('offline');
    setStatusMessage(message);

    if (!canRetry || retryTimerRef.current) {
      return;
    }

    const attempt = retryAttemptRef.current;
    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    retryAttemptRef.current = attempt + 1;

    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setStatusMessage('Retrying stream…');
      setReloadToken((value) => value + 1);
    }, delay);
  }, [canRetry]);

  const resetRetryLoop = useCallback(() => {
    clearRetryTimer();
    retryAttemptRef.current = 0;
  }, [clearRetryTimer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    clearRetryTimer();
    destroyStream();

    if (streamTarget.mode === 'none') {
      setStreamState('offline');
      setStatusMessage(streamTarget.statusHint);
      return;
    }

    setStreamState('loading');
    setStatusMessage(streamTarget.statusHint);

    const handlePlaying = () => {
      resetRetryLoop();
      setStreamState('playing');
      setStatusMessage(streamTarget.mode === 'webrtc' ? 'Live · WebRTC' : 'Live');
    };

    const handleWaiting = () => {
      setStreamState((current) => (current === 'playing' ? 'loading' : current));
      setStatusMessage(streamTarget.mode === 'webrtc' ? 'Rebuffering WebRTC stream…' : 'Buffering…');
    };

    const handleVideoError = () => {
      scheduleRetry('Stream Offline · reconnecting automatically');
    };

    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.controls = false;
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('canplay', handlePlaying);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('error', handleVideoError);

    let cancelled = false;

    const cleanupListeners = () => {
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplay', handlePlaying);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('error', handleVideoError);
    };

    const startHls = async (hlsUrl: string) => {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        void video.play().catch(() => {
          scheduleRetry('Stream Offline · reconnecting automatically');
        });
        return;
      }

      const hlsModule = await import('hls.js');
      const Hls = hlsModule.default;

      if (cancelled) {
        return;
      }

      if (!Hls.isSupported()) {
        setStreamState('offline');
        setStatusMessage('This browser does not support HLS playback.');
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        liveSyncDurationCount: 3,
      });

      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(hlsUrl));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => {
          scheduleRetry('Stream Offline · reconnecting automatically');
        });
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) {
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
            setStatusMessage('Recovering media stream…');
            return;
          } catch {
            // Fall through to retry scheduling below.
          }
        }

        scheduleRetry('Stream Offline · reconnecting automatically');
      });
    };

    const startWebRtc = async (wsUrl: string) => {
      if (!('RTCPeerConnection' in window)) {
        setStreamState('offline');
        setStatusMessage('This browser does not support WebRTC playback.');
        return;
      }

      const pc = new RTCPeerConnection({
        iceServers: WEBRTC_ICE_SERVERS,
        sdpSemantics: 'unified-plan',
      });
      peerConnectionRef.current = pc;

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.addEventListener('track', (event) => {
        if (cancelled) {
          return;
        }

        const stream = event.streams?.[0] || new MediaStream([event.track]);
        video.srcObject = stream;
        void video.play().catch(() => {
          scheduleRetry('Stream Offline · autoplay was blocked');
        });
      });

      pc.addEventListener('icecandidate', (event) => {
        if (!event.candidate || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        socketRef.current.send(JSON.stringify({
          type: 'webrtc/candidate',
          value: event.candidate.candidate,
        }));
      });

      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') {
          resetRetryLoop();
          setStreamState('playing');
          setStatusMessage('Live · WebRTC');
          return;
        }

        if (!cancelled && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          scheduleRetry('Stream Offline · reconnecting automatically');
        }
      });

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        setStreamState('offline');
        setStatusMessage('Invalid Frigate WebRTC URL. Paste the absolute Frigate/go2rtc WebRTC endpoint from Camera Stream Integration.');
        return;
      }

      socketRef.current = socket;

      socket.addEventListener('open', async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.send(JSON.stringify({ type: 'webrtc/offer', value: offer.sdp }));
        } catch {
          scheduleRetry('Stream Offline · failed to negotiate WebRTC');
        }
      });

      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data));

          if (message.type === 'webrtc/answer' && message.value) {
            void pc.setRemoteDescription({ type: 'answer', sdp: message.value }).catch(() => {
              scheduleRetry('Stream Offline · invalid WebRTC answer');
            });
            return;
          }

          if (message.type === 'webrtc/candidate' && message.value) {
            void pc.addIceCandidate({ candidate: message.value, sdpMid: '0' }).catch(() => undefined);
            return;
          }

          if (message.type === 'error') {
            scheduleRetry(`Stream Offline · ${message.value || 'Frigate WebRTC returned an error'}`);
          }
        } catch {
          scheduleRetry('Stream Offline · unexpected relay response');
        }
      });

      socket.addEventListener('error', () => {
        if (!cancelled) {
          scheduleRetry('Stream Offline · unable to reach the Frigate WebRTC endpoint');
        }
      });

      socket.addEventListener('close', () => {
        if (!cancelled && peerConnectionRef.current?.connectionState !== 'connected') {
          scheduleRetry('Stream Offline · reconnecting automatically');
        }
      });
    };

    if (streamTarget.mode === 'webrtc' && streamTarget.wsUrl) {
      void startWebRtc(streamTarget.wsUrl);
    } else if (streamTarget.mode === 'hls' && streamTarget.hlsUrl) {
      void startHls(streamTarget.hlsUrl);
    }

    return () => {
      cancelled = true;
      cleanupListeners();
      destroyStream();
    };
  }, [clearRetryTimer, destroyStream, reloadToken, resetRetryLoop, scheduleRetry, streamTarget]);

  useEffect(() => () => {
    clearRetryTimer();
    destroyStream();
  }, [clearRetryTimer, destroyStream]);

  return (
    <div className={`frigate-camera ${className}`.trim()}>
      <video
        ref={videoRef}
        className={`frigate-camera-video ${streamState === 'playing' ? 'is-live' : ''}`}
        autoPlay
        muted
        playsInline
      />

      {streamState !== 'playing' ? (
        <div className={`frigate-camera-overlay ${streamState}`}>
          <div className="frigate-camera-state">
            <strong>{streamState === 'loading' ? 'Connecting…' : 'Stream Offline'}</strong>
            <span>{statusMessage}</span>
            <small>{streamTarget.label ? `${printerName} · ${streamTarget.label}` : printerName}</small>
            {canRetry ? (
              <button
                type="button"
                className="frigate-retry-btn"
                onClick={() => {
                  clearRetryTimer();
                  setStatusMessage('Retrying stream…');
                  setReloadToken((value) => value + 1);
                }}
              >
                Retry now
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default FrigateCamera;
