import { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const daysUntil = d => d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null;
export const getUser = () => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } };
export const isOffice = u => ['Admin', 'Officer'].includes(u?.role);

export const STAGE_COLORS = {
  SUBMITTED: '#0a66c2', SCRUTINY: '#5b4fd6', DEFICIENCY: '#a85d00', RESCRUTINY: '#7c3aed', EVC: '#b8327f', EC_REVIEW: '#c96442',
  SAC: '#c2410c', SHC: '#c4141b', APPROVED: '#057642', CONDITIONAL: '#0f766e', REJECTED: '#c4141b', WITHDRAWN: '#6b6a65',
};
export const STAGE_SHORT = {
  SUBMITTED: 'Submitted', SCRUTINY: 'Scrutiny', DEFICIENCY: 'Deficiency', RESCRUTINY: 'Re-Scrutiny', EVC: 'EVC', EC_REVIEW: 'Exec. Committee',
  SAC: 'SAC Appeal', SHC: 'SHC Hearing', APPROVED: 'Approved', CONDITIONAL: 'Conditional', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn',
};

export function StageBadge({ stage, label }) {
  const c = STAGE_COLORS[stage] || '#a0a0ab';
  return <span className="sl-badge" style={{ background: `${c}14`, color: c, border: `1px solid ${c}33` }}>{label || STAGE_SHORT[stage] || stage}</span>;
}

export function SlaPill({ sla }) {
  if (!sla || !sla.sla_days) return <span className="sl-text-xs sl-text-muted">{sla ? `${sla.days}d` : '—'}</span>;
  const tone = sla.breached ? 'danger' : sla.pct >= 75 ? 'warning' : 'success';
  return (
    <div className="aq-sla" title={`${sla.days} of ${sla.sla_days} SLA days`}>
      <div className="aq-sla__bar"><div className={`aq-sla__fill aq-sla__fill--${tone}`} style={{ width: `${Math.min(100, sla.pct)}%` }} /></div>
      <span className={`sl-text-xs aq-tone-${tone}`}>{sla.days}/{sla.sla_days}d{sla.breached ? ` · +${sla.days - sla.sla_days}` : ''}</span>
    </div>
  );
}

const GRADE_TONE = { A: 'success', B: 'info', C: 'warning', D: 'danger' };
export function GradeBadge({ grade, score }) {
  return <span className={`sl-badge sl-badge--${GRADE_TONE[grade] || 'neutral'}`}>{grade}{score != null ? ` · ${score}` : ''}</span>;
}

const SEV_TONE = { Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral' };
export const SeverityBadge = ({ severity }) => <span className={`sl-badge sl-badge--${SEV_TONE[severity] || 'neutral'}`}>{severity}</span>;

const STATUS_TONE = {
  Valid: 'success', 'Expiring Soon': 'warning', Expired: 'danger', 'Pending Verification': 'info', Rejected: 'danger', Superseded: 'neutral',
  Pending: 'info', Submitted: 'accent', Verified: 'success', Overdue: 'danger', Breached: 'danger', Waived: 'neutral',
  Open: 'danger', Responded: 'accent', Accepted: 'success', Scheduled: 'info', Completed: 'success', Cancelled: 'neutral', Rescheduled: 'warning',
  Acknowledged: 'warning', Resolved: 'success', 'In Process': 'info', Approved: 'success', 'Conditionally Approved': 'accent', Withdrawn: 'neutral',
  Active: 'success', 'Under Show-Cause': 'danger', Suspended: 'danger',
  Deficient: 'danger', 'Not uploaded': 'warning', 'Awaiting verification': 'info',
};
export const StatusBadge = ({ status }) => <span className={`sl-badge sl-badge--${STATUS_TONE[status] || 'neutral'}`}>{status}</span>;

export function ScoreRing({ score, size = 96 }) {
  const r = size / 2 - 8, c = 2 * Math.PI * r;
  const color = score >= 85 ? 'var(--sl-success)' : score >= 70 ? 'var(--sl-info)' : score >= 50 ? 'var(--sl-warning)' : 'var(--sl-danger)';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Compliance score ${score}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sl-bg-hover)" strokeWidth="8" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="var(--sl-text-primary)" fontSize={size / 4} fontWeight="700">{score}</text>
    </svg>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="sl-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`sl-modal ${wide ? 'sl-modal--lg' : ''}`} role="dialog" aria-label={title}>
        <div className="sl-modal__header">
          <h2 className="sl-modal__title">{title}</h2>
          <button className="sl-btn sl-btn--ghost sl-btn--icon sl-btn--sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="sl-modal__body">{children}</div>
        {footer && <div className="sl-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

// Tiny global toast: toast('Saved'), toast('Failed', 'error')
export function toast(message, type = 'success') {
  window.dispatchEvent(new CustomEvent('aq-toast', { detail: { message, type, id: Math.random() } }));
}
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const h = e => {
      setItems(prev => [...prev, e.detail]);
      setTimeout(() => setItems(prev => prev.filter(i => i.id !== e.detail.id)), 4500);
    };
    window.addEventListener('aq-toast', h);
    return () => window.removeEventListener('aq-toast', h);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertTriangle, info: Info, warning: AlertTriangle };
  return (
    <div className="sl-toast-container">
      {items.map(t => {
        const I = Icon[t.type] || Info;
        return <div key={t.id} className={`sl-toast sl-toast--${t.type}`}><I size={16} /><span className="sl-toast__message">{t.message}</span></div>;
      })}
    </div>
  );
}

export function Empty({ icon: Icon, title, text }) {
  return (
    <div className="sl-empty">
      {Icon && <div className="sl-empty__icon"><Icon size={24} /></div>}
      <div className="sl-empty__title">{title}</div>
      {text && <div className="sl-empty__description">{text}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="sl-skeleton sl-skeleton--card" style={{ height: 320 }} />;
}

export function Stat({ icon: Icon, label, value, tone = 'accent', sub, onClick }) {
  return (
    <div className={`sl-stat ${onClick ? 'sl-card--interactive' : ''}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className={`sl-stat__icon sl-stat__icon--${tone}`}><Icon size={20} /></div>
      <div className="sl-stat__label">{label}</div>
      <div className="sl-stat__value">{value}</div>
      {sub && <div className="sl-text-xs sl-text-muted sl-mt-1">{sub}</div>}
    </div>
  );
}

export function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  // A leading = + - @ would run as a formula in Excel (CSV injection); prefix with a quote.
  const esc = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
}

export const fileToBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(file);
});
