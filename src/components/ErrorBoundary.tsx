import React, { Component, ReactNode } from 'react';
import { reportClientTelemetry } from '../utils/clientTelemetry';
import './ErrorBoundary.css';

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
        <div className="error-boundary">
          <div className="error-content">
            <h2>⚠️ Something went wrong</h2>
            <p>The application encountered an unexpected error.</p>
            {this.state.error?.message && (
              <details>
                <summary>Error Details</summary>
                <pre>{this.state.error.message}</pre>
              </details>
            )}
            <button onClick={this.handleReload}>Reload</button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
