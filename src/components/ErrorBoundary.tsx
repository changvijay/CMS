import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the URL path) clears the error, so moving to another page tries again. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

const RELOAD_KEY = 'errorBoundaryReloadAt';

/** A lazy page file that failed to load: usually an old file name after the app was rebuilt. */
const isChunkError = (e: Error) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Expected a JavaScript/i.test(e.message);

/**
 * Without this, one component throwing while it draws makes React remove the whole app: a blank white page.
 * This shows what went wrong instead, and keeps the navbar usable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
    // A missing page file is fixed by loading the new index.html; reload once, never in a loop.
    if (isChunkError(error)) {
      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* storage blocked */ }
      if (Date.now() - last > 30_000) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
        window.location.reload();
      }
    }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="ws">
        <main className="ws-main">
          <div className="ws-empty ws-empty-cta" role="alert">
            <h3>This page hit an error</h3>
            <p>{isChunkError(error) ? 'The app was updated while this tab was open.' : error.message}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload page</button>
              <button className="btn btn-secondary" onClick={() => this.setState({ error: null })}>Try again</button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
