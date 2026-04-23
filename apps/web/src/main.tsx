import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import './styles/global.css'

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-level error boundary. Without this, any uncaught render error
 * unmounts the entire tree and leaves the user with a blank page
 * and no indication of what went wrong. Here we at least show the
 * message and a reload button so the session is recoverable.
 */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[vissor] uncaught render error', error, info)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            color: 'var(--fg)',
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          <div style={{ fontWeight: 600 }}>Something broke in the UI.</div>
          <pre
            style={{
              fontSize: 12,
              color: 'var(--fg-dim)',
              maxWidth: 640,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: '8px 16px' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
)
