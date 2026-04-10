import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './FrigateCamera.css';

type HlsModule = typeof import('hls.js');
type HlsConstructor = HlsModule['default'];

type StreamState = 'loading' | 'playing' | 'offline';

interface FrigateCameraProps {
  frigateUrl?: string;
  cameraName?: string;
  printerName?: string;
  className?: string;
}

const RETRY_DELAYS_MS = [2000, 5000, 10000, 15000, 30000];

const isDirectHlsUrl = (value: string) => /^https?:\/\/.*\.m3u8(?:\?.*)?$/i.test(value.trim());
const isRtspUrl = (value: string) => /^rtsps?:\/\//i.test(value.trim());

const normalizeFrigateBase = (value?: string) => (value || '').trim().replace(/\/+$/, '');

const buildHlsUrl = (frigateUrl?: string, cameraName?: string) => {
  const source = (cameraName || '').trim();
  if (!source) return null;

  if (isDirectHlsUrl(source)) {
    return source;
  }

  if (isRtspUrl(source)) {
    return null;
  }

  const baseUrl = normalizeFrigateBase(frigateUrl);
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}/api/${encodeURIComponent(source)}/hls.m3u8`;
};

function FrigateCamera({ frigateUrl, cameraName, printerName = 'Printer', className = '' }: FrigateCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<InstanceType<HlsConstructor> | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const [streamState, setStreamState] = useState<StreamState>('loading');
  const [statusMessage, setStatusMessage] = useState('Connecting to Frigate…');
  const [reloadToken, setReloadToken] = useState(0);

  const rawSource = (cameraName || '').trim();
  const hlsUrl = useMemo(() => buildHlsUrl(frigateUrl, cameraName), [frigateUrl, cameraName]);
  const isLegacyRtsp = rawSource.length > 0 && isRtspUrl(rawSource);
  const canRetry = Boolean(hlsUrl);

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

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }, []);

  const scheduleRetry = useCallback((message: string) => {
    setStreamState('offline');
    setStatusMessage(message);

    if (!canRetry) {
      return;
    }

    if (retryTimerRef.current) {
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

    if (!rawSource) {
      setStreamState('offline');
      setStatusMessage('No Frigate camera configured yet.');
      return;
    }

    if (isLegacyRtsp) {
      setStreamState('offline');
      setStatusMessage('Direct RTSP is not browser-playable. Enter a Frigate camera name or HLS URL.');
      return;
    }

    if (!hlsUrl) {
      setStreamState('offline');
      setStatusMessage('Add your Frigate base URL in UI Settings to enable direct streaming.');
      return;
    }

    setStreamState('loading');
    setStatusMessage('Connecting to Frigate…');

    const handlePlaying = () => {
      resetRetryLoop();
      setStreamState('playing');
      setStatusMessage('Live');
    };

    const handleWaiting = () => {
      setStreamState((current) => (current === 'playing' ? 'loading' : current));
      setStatusMessage('Buffering…');
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

    const startStream = async () => {
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

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(hlsUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => {
          scheduleRetry('Stream Offline · reconnecting automatically');
        });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) {
          return;
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          scheduleRetry('Stream Offline · reconnecting automatically');
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
            setStatusMessage('Recovering media stream…');
          } catch {
            scheduleRetry('Stream Offline · reconnecting automatically');
          }
          return;
        }

        scheduleRetry('Stream Offline · reconnecting automatically');
      });
    };

    void startStream();

    return () => {
      cancelled = true;
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplay', handlePlaying);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('error', handleVideoError);
      destroyStream();
    };
  }, [clearRetryTimer, destroyStream, hlsUrl, isLegacyRtsp, rawSource, reloadToken, resetRetryLoop, scheduleRetry]);

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
            <small>{printerName}</small>
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
