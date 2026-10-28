import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, User, Info, Timer, Save, RotateCcw } from 'lucide-react';
import { apiClient } from '../api/client';
import { toast, fmtDate } from '../components/ui';

function SlaSettings({ admin }) {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const load = () => apiClient.get('/settings/sla').then(r => { setRows(r); setDraft(Object.fromEntries(r.map(x => [x.stage, x.days]))); }).catch(e => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);
  if (!rows) return null;
  const dirty = rows.some(r => Number(draft[r.stage]) !== r.days);
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiClient.put('/settings/sla', Object.fromEntries(rows.map(x => [x.stage, Number(draft[x.stage])])));
      toast(r.changed.length ? `SLAs updated (${r.changed.join(', ')}): ${r.alerts_raised} alert(s) raised, ${r.alerts_resolved} resolved` : 'No changes');
      load();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="sl-card sl-mt-6">
      <div className="sl-card__header"><h3 className="sl-card__title"><Timer size={14} style={{ verticalAlign: -2 }} /> Stage SLAs (days)</h3>
        {admin && <div className="sl-flex sl-gap-2">
          <button className="sl-btn sl-btn--ghost sl-btn--sm" disabled={busy} onClick={() => setDraft(Object.fromEntries(rows.map(x => [x.stage, x.default_days])))}><RotateCcw size={14} /> APH defaults</button>
          <button className="sl-btn sl-btn--primary sl-btn--sm" disabled={busy || !dirty} onClick={save}><Save size={14} /> Save & re-evaluate</button>
        </div>}
      </div>
      <div className="sl-card__body">
        <p className="sl-text-xs sl-text-muted sl-mb-4">Time allowed in each stage before an application counts as pending beyond SLA. Changes apply immediately to dashboards, pendency reports, the AI assistant and SLA-breach alerts.{admin ? '' : ' Only the Approval Bureau can change these.'}</p>
        <table className="sl-table sl-table--compact">
          <thead><tr><th>Stage</th><th>Owner</th><th style={{ width: 120 }}>SLA (days)</th><th>APH default</th><th>Last changed</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.stage}>
              <td className="sl-font-medium sl-text-sm">{r.label}</td>
              <td className="sl-text-xs">{r.owner}</td>
              <td>{admin ? <input className="sl-input" type="number" min="1" max="365" style={{ height: 30, width: 90 }} value={draft[r.stage] ?? ''} onChange={e => setDraft({ ...draft, [r.stage]: e.target.value })} aria-label={`${r.label} SLA days`} /> : <b>{r.days}</b>}</td>
              <td className="sl-text-xs sl-text-muted">{r.default_days}{r.days !== r.default_days && <span className="sl-badge sl-badge--accent" style={{ marginLeft: 6 }}>changed</span>}</td>
              <td className="sl-text-xs sl-text-muted">{r.updated_by ? `${r.updated_by}, ${fmtDate(r.updated_at)}` : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

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
            <div className="sl-text-sm sl-mb-2"><b>Team Zenkai</b> · Pandit Deendayal Energy University (PDEU)</div>
            <div className="sl-text-xs sl-text-muted sl-mb-4">Megh Raval · Parth Aparnathi · Rishit Salasiya · Yashasvi Shukla · Yashasvi Vanani · Hanisha Swanani</div>
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
      <SlaSettings admin={user.role === 'Admin'} />
    </div>
  );
}
