import React, { Component, ReactNode } from 'react';
import { reportClientTelemetry } from '../utils/clientTelemetry';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    reportClientTelemetry({
      level: 'error',
      source: 'react.error-boundary',
      message: error.message || 'ErrorBoundary caught an error',
      details: {
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      },
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-dvh items-center justify-center bg-base px-4 py-8">
          <div className="w-full max-w-md rounded-xl bg-card p-6 text-center shadow-xl sm:p-8">
            <h2 className="text-lg font-semibold text-fg">⚠️ Something went wrong</h2>
            <p className="mt-2 text-sm text-fg-soft">The application encountered an unexpected error.</p>
            {this.state.error?.message && (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-xs font-medium text-muted">Error Details</summary>
                <pre className="mt-2 overflow-x-auto rounded-md bg-black/30 p-3 text-xs text-danger">{this.state.error.message}</pre>
              </details>
            )}
            <button
              onClick={this.handleReload}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
