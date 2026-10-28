import { Settings as SettingsIcon, User, Info } from 'lucide-react';

export default function Settings() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <div>
      <div className="sl-page__header"><div><h1 className="sl-page__title">Settings</h1><p className="sl-page__subtitle">Account and application preferences</p></div></div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Profile</h3></div>
          <div className="sl-card__body">
            <div className="sl-flex sl-items-center sl-gap-4 sl-mb-6">
              <div className="sl-avatar sl-avatar--xl">{(user.name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
              <div><div className="sl-font-semibold sl-text-lg">{user.name || 'User'}</div><div className="sl-text-sm sl-text-secondary">{user.email}</div></div>
            </div>
            {[
              { label: 'Role', value: user.role || '—' },
              { label: 'Designation', value: user.designation || '—' },
              { label: 'Status', value: user.status || 'Active' },
              { label: 'User ID', value: user.id || 'N/A' },
            ].map(r => (
              <div key={r.label} className="sl-flex sl-items-center sl-justify-between sl-mb-3 sl-p-4" style={{background: 'var(--sl-bg-tertiary)', borderRadius: 'var(--sl-radius-md)'}}>
                <span className="sl-text-sm sl-text-secondary">{r.label}</span>
                <span className="sl-text-sm sl-font-medium">{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">About SiteLine</h3></div>
          <div className="sl-card__body">
            <div className="sl-flex sl-items-center sl-gap-3 sl-mb-4">
              <div className="sl-sidebar__logo-icon">SL</div>
              <div><div className="sl-font-semibold">SiteLine · AICTE</div><div className="sl-text-xs sl-text-muted">Approval Workflow, Compliance Monitoring & Alerts (SIH26262)</div></div>
            </div>
            <div className="sl-text-sm sl-text-secondary sl-mb-4">Tracks every application through the APH stages with per-stage SLAs, schedules conflict-free EVC panels, monitors time-bound undertakings and document validity, and raises alerts from plain-English rules. A local AI model answers questions over live data, and a keyword fallback keeps it working offline.</div>
            {[
              { label: 'Version', value: '3.0.0-aicte' },
              { label: 'Frontend', value: 'React 18 + Vite' },
              { label: 'Backend', value: 'Express + Prisma' },
              { label: 'AI Engine', value: 'Ollama local model + keyword fallback' },
              { label: 'Alert engine', value: 'Rule playbooks, every 10 min' },
              { label: 'Database', value: 'SQLite' },
            ].map(r => (
              <div key={r.label} className="sl-flex sl-items-center sl-justify-between sl-mb-2">
                <span className="sl-text-xs sl-text-muted">{r.label}</span>
                <span className="sl-text-xs sl-font-mono">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
