import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    const msg = error?.message || '';
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('MIME type') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('text/html')
    ) {
      const isReloaded = sessionStorage.getItem('chunk_reload_attempt');
      if (!isReloaded) {
        sessionStorage.setItem('chunk_reload_attempt', 'true');
        window.location.reload();
      }
    }
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex min-h-[100dvh] items-center justify-center bg-background">
          <div className="text-center max-w-md px-6">
            <h1 className="text-3xl font-serif text-foreground mb-4">Something went wrong</h1>
            <p className="text-foreground/60 mb-6">An unexpected error occurred. Please try refreshing the page.</p>
            <button
              onClick={() => window.location.reload()}
              className="h-12 px-8 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
