/**
 * Error boundary.
 *
 * Wrapped around each screen and around the session runner, so a fault in one
 * mode cannot take the whole app down - the spec's failure-isolation rule.
 * The boundary reports what broke and offers a way back rather than leaving a
 * blank screen.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown above the error, e.g. "Knight vision". */
  label?: string;
  /** Rendered instead of the default message. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No remote reporting: Bight sends nothing anywhere. The console is the
    // only sink, which is enough to diagnose from `adb logcat`.
    console.error(`[Bight] ${this.props.label ?? 'Screen'} failed`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback(error, this.reset);

    return (
      <div className="error-boundary" role="alert">
        <h2 className="card__title">
          {this.props.label === undefined ? 'Something went wrong' : `${this.props.label} stopped working`}
        </h2>
        <p className="card__subtitle">
          The rest of Bight is unaffected. You can go back and try another mode.
        </p>
        <p className="card__subtitle" style={{ fontFamily: 'var(--mono)', marginTop: 8 }}>
          {error.message}
        </p>
        <div className="button-row" style={{ marginTop: 12 }}>
          <button type="button" className="button button--primary" onClick={this.reset}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
