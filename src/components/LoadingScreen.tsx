import { useEffect, useState } from 'react';

interface LoadingScreenProps {
  message?: string;
  title?: string;
  variant?: 'fullscreen' | 'panel';
}

function LoadingScreen({
  message = 'Loading...',
  title = 'PrintHive',
  variant = 'fullscreen'
}: LoadingScreenProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      timeoutId = setTimeout(() => {
        if (!active) return;
        setProgress((prev) => {
          if (prev >= 95) return prev;
          const increment = Math.random() * 12 + 3;
          return Math.min(prev + increment, 95);
        });
        if (active) tick();
      }, 220);
    };

    tick();

    return () => {
      active = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  const isPanel = variant === 'panel';

  return (
    <div
      className={
        isPanel
          ? 'relative flex min-h-80 items-center justify-center overflow-hidden rounded-xl bg-base shadow-lg'
          : 'fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-base animate-[ph-fade-in_0.3s_ease-out]'
      }
    >
      <div className="relative z-[2] w-[min(90%,420px)] text-center animate-[ph-fade-up_0.7s_var(--ease-out)_both]">
        <span className="mb-4 inline-block rounded-full bg-accent/10 px-3.5 py-1 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-accent ring-1 ring-accent/30">
          Unified workspace
        </span>

        <div className="relative mx-auto mb-6 size-28">
          <div className="absolute -inset-4 rounded-full border-2 border-transparent border-t-accent animate-spin"></div>
          <div className="absolute inset-0 rounded-full bg-accent/20 blur-2xl animate-[ph-pulse-glow_2.2s_ease-in-out_infinite]"></div>
          <img src="/images/logo.png" alt="Logo" className="relative z-[2] size-full object-contain" />
        </div>

        <h2 className="mb-1.5 text-3xl font-bold tracking-tight text-fg">{title}</h2>
        <p className="mb-7 text-base font-medium text-fg-faint">{message}</p>

        <div className="mb-5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-accent shadow-glow transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <span className="min-w-[3.2ch] text-right text-sm font-semibold tabular-nums text-fg-soft">{Math.round(progress)}%</span>
        </div>

        <div className="flex justify-center gap-2">
          <span className="size-1.5 rounded-full bg-accent animate-[ph-pulse-glow_1.4s_ease-in-out_infinite] [animation-delay:-0.32s]"></span>
          <span className="size-1.5 rounded-full bg-accent animate-[ph-pulse-glow_1.4s_ease-in-out_infinite] [animation-delay:-0.16s]"></span>
          <span className="size-1.5 rounded-full bg-accent animate-[ph-pulse-glow_1.4s_ease-in-out_infinite]"></span>
        </div>
      </div>
    </div>
  );
}

export default LoadingScreen;
