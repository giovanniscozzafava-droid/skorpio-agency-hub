import React from 'react';
import { logError } from '../lib/errorLogger';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — cattura errori React runtime invece di mostrare schermo bianco.
 * Uso:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught:', error, info);
    logError({
      tipo: 'react_error',
      messaggio: error.message,
      stack: error.stack,
      component: (info.componentStack || '').slice(0, 1000),
    }).catch(() => {});
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          background: '#F8FAFC',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{
            maxWidth: 500,
            background: 'white',
            borderRadius: 16,
            padding: 32,
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🛠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#1E293B' }}>
              Qualcosa è andato storto
            </h1>
            <p style={{ fontSize: 14, color: '#64748B', marginBottom: 24 }}>
              Un componente di SKORPIO ha avuto un errore. Non è colpa tua — è un bug da sistemare.
              Prova a ricaricare la pagina.
            </p>
            <details style={{ textAlign: 'left', marginBottom: 20, fontSize: 11, color: '#94A3B8' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Dettagli tecnici</summary>
              <pre style={{
                background: '#F1F5F9',
                padding: 12,
                borderRadius: 8,
                overflow: 'auto',
                maxHeight: 200,
                fontSize: 10,
              }}>
                {this.state.error?.message}
                {'\n\n'}
                {this.state.error?.stack?.slice(0, 1000)}
              </pre>
            </details>
            <button
              onClick={this.reset}
              style={{
                padding: '10px 24px',
                borderRadius: 10,
                background: '#8B5CF6',
                color: 'white',
                fontWeight: 600,
                fontSize: 14,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              🔄 Ricarica SKORPIO
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
