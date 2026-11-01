import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          margin: '16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '12px',
          color: '#991b1b',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          textAlign: 'center'
        }}>
          <AlertTriangle size={32} color="#ef4444" />
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
            {this.props.fallbackTitle || 'Component Encountered an Issue'}
          </h3>
          <p style={{ fontSize: '13px', margin: 0, maxWidth: '420px', color: '#b91c1c' }}>
            {this.state.error?.message || 'An unexpected rendering error occurred. The application recovered safely.'}
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} /> Try Reloading Section
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
