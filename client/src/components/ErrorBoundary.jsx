import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

// One broken widget must never blank the whole console. The boundary resets
// when the route changes (pass the pathname as resetKey).
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('UI error:', error, info?.componentStack); }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="sl-empty" role="alert">
        <div className="sl-empty__icon"><AlertTriangle size={24} /></div>
        <div className="sl-empty__title">This screen hit an error</div>
        <div className="sl-empty__description">{String(this.state.error.message || this.state.error)}</div>
        <button className="sl-btn sl-btn--secondary sl-mt-4" onClick={() => this.setState({ error: null })}><RotateCcw size={14} /> Try again</button>
      </div>
    );
  }
}
