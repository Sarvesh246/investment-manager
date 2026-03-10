import type { ReactNode } from 'react';
import { Component } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="route-error">
          <div className="route-error__eyebrow">Something went wrong</div>
          <h1>Application Error</h1>
          <p>
            An unexpected error occurred. Try refreshing the page. If the problem persists, return to
            Home and try again.
          </p>
          <a href="#/" className="action-button">
            Return Home
          </a>
        </div>
      );
    }

    return this.props.children;
  }
}
