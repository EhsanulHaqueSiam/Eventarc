import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorFallbackProps {
  error: Error | null;
  onRetry: () => void;
}

export function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  const message = error?.message ?? "An unexpected error occurred";
  const truncated =
    message.length > 200 ? message.slice(0, 200) + "..." : message;

  return (
    <div className="flex min-h-[300px] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-6 shadow-lg dark:border-red-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400">
            !
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Something went wrong
          </h2>
        </div>
        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          {truncated}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onRetry}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}
