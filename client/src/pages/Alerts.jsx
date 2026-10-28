import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Siren, Play, Wand2, Check, CheckCheck, Save, Power, Trash2 } from 'lucide-react';
import { apiClient } from '../api/client';
import { SeverityBadge, StatusBadge, Loading, Empty, toast, getUser, isOffice, fmtDateTime } from '../components/ui';

const ENTITY_LINK = { Application: id => `/applications/${id}` };

export default function Alerts() {
  const user = getUser();
  const [tab, setTab] = useState('alerts');
  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">{user.role === 'Institution' ? 'My Alerts' : 'Alert Center'}</h1>
          <p className="sl-page__subtitle">Standing rules watch deadlines and raise alerts; people decide. Each rule fires once per item and auto-resolves when the condition clears.</p></div>
      </div>
      {isOffice(user) && (
        <div className="sl-tabs">
          <button className={`sl-tab ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>Alerts</button>
          <button className={`sl-tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>Monitoring rules</button>
        </div>
      )}
      {tab === 'alerts' ? <AlertList user={user} /> : <Rules />}
    </div>
  );
}

function AlertList({ user }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('Open');
  const [severity, setSeverity] = useState('');
  const load = () => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (severity) q.set('severity', severity);
    apiClient.get(`/alerts?${q}`).then(setRows).catch(e => toast(e.message, 'error'));
  };
  useEffect(() => { load(); }, [status, severity]);
  const act = async (a, what) => {
    try { await apiClient.patch(`/alerts/${a.id}/${what}`); toast(what === 'acknowledge' ? 'Acknowledged' : 'Resolved'); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const open = a => {
    if (a.entity_type === 'Application') navigate(`/applications/${a.entity_id}`);
    else if (a.entity_type === 'Document') navigate(`/compliance?renew=${a.entity_id}`);
    else if (a.entity_type === 'Undertaking') navigate('/compliance?tab=undertakings');
    else if (a.entity_type === 'EVCVisit') navigate('/evc');
    else if (a.institution_id && isOffice(user)) navigate(`/institutions/${a.institution_id}`);
  };
  return (
    <>
      <div className="sl-flex sl-gap-2 sl-mb-4 sl-flex-wrap">
        {[['Open', 'Open'], ['Acknowledged', 'Acknowledged'], ['Resolved', 'Resolved'], ['', 'All']].map(([v, l]) => <button key={l} className={`sl-filter-chip ${status === v ? 'active' : ''}`} onClick={() => setStatus(v)}>{l}</button>)}
        <span style={{ width: 16 }} />
        {['Critical', 'High', 'Medium', 'Low'].map(s => <button key={s} className={`sl-filter-chip ${severity === s ? 'active' : ''}`} onClick={() => setSeverity(severity === s ? '' : s)}>{s}</button>)}
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon={Siren} title="No alerts" text="Nothing needs attention here." /> : (
        <div className="sl-table-container">
          <table className="sl-table">
            <thead><tr><th>Severity</th><th>Alert</th><th>Rule</th><th>Raised</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}>
                  <td><SeverityBadge severity={a.severity} /></td>
                  <td className="sl-cursor-pointer" onClick={() => open(a)}><div className="sl-font-medium sl-text-sm">{a.title}</div><div className="sl-text-xs sl-text-muted">{a.detail}</div></td>
                  <td className="sl-text-xs">{a.rule?.name}</td>
                  <td className="sl-text-xs sl-whitespace-nowrap">{fmtDateTime(a.fired_at)}</td>
                  <td><StatusBadge status={a.status} />{a.acknowledged_by && <div className="sl-text-xs sl-text-muted">{a.acknowledged_by}</div>}</td>
                  <td className="sl-text-right sl-whitespace-nowrap">
                    {a.status === 'Open' && <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => act(a, 'acknowledge')} title="Acknowledge"><Check size={14} /></button>}
                    {isOffice(user) && a.status !== 'Resolved' && <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => act(a, 'resolve')} title="Resolve"><CheckCheck size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const EXAMPLES = [
  'Warn me 90 days before any lease deed in the Western region expires',
  'Critical alert when undertakings are overdue for pharmacy colleges',
  'Flag applications stuck in scrutiny for more than 5 days beyond SLA',
  'Remind about EVC visits 3 days ahead',
];

function Rules() {
  const [rules, setRules] = useState(null);
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiClient.get('/alerts/rules').then(setRules).catch(e => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const compile = async () => {
    setBusy(true); setProposal(null);
    try {
      const r = await apiClient.post('/alerts/rules/compile', { text });
      if (!r.ok) toast(r.message, 'warning'); else setProposal(r);
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const save = async () => {
    try {
      const p = proposal.proposal;
      const r = await apiClient.post('/alerts/rules', { ...p, nl_prompt: text });
      const created = r.run?.results?.[0]?.created ?? 0;
      toast(`Rule saved and run: ${created} alert(s) raised`);
      setProposal(null); setText(''); load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const runAll = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post('/alerts/run', {});
      const c = r.results.reduce((s, x) => s + x.created, 0), res = r.results.reduce((s, x) => s + x.auto_resolved, 0);
      toast(`Ran ${r.results.length} rules: ${c} new alert(s), ${res} auto-resolved`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const toggle = async r => { try { await apiClient.patch(`/alerts/rules/${r.id}`, { active: !r.active }); load(); } catch (e) { toast(e.message, 'error'); } };
  const remove = async r => { if (!window.confirm(`Delete rule "${r.name}" and its alerts?`)) return; try { await apiClient.delete(`/alerts/rules/${r.id}`); load(); } catch (e) { toast(e.message, 'error'); } };

  return (
    <>
      <div className="sl-card sl-mb-6">
        <div className="sl-card__header"><h3 className="sl-card__title"><Wand2 size={14} style={{ verticalAlign: -2 }} /> Describe a rule in plain English</h3><span className="aq-engine">local AI · keyword fallback</span></div>
        <div className="sl-card__body">
          <div className="sl-flex sl-gap-2">
            <input className="sl-input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && text && compile()} placeholder="e.g. Warn me 60 days before any fire NOC of engineering colleges in Southern region expires" />
            <button className="sl-btn sl-btn--primary" disabled={!text || busy} onClick={compile}>{busy ? <span className="sl-btn__spinner" /> : 'Draft rule'}</button>
          </div>
          <div className="aq-chip-row sl-mt-2">{EXAMPLES.map(e => <button key={e} className="sl-chat__suggestion" style={{ fontSize: 11 }} onClick={() => setText(e)}>{e}</button>)}</div>
          {proposal && (
            <div className="aq-panel sl-mt-4">
              <div className="sl-flex sl-justify-between sl-items-center sl-mb-2"><span className="sl-font-semibold">{proposal.proposal.name}</span><span className="aq-engine">read by {proposal.engine === 'ai' ? 'local AI model' : 'keyword parser'}</span></div>
              <div className="sl-text-sm sl-mb-2">{proposal.reading}</div>
              <div className="sl-text-xs sl-font-mono sl-text-muted sl-mb-2">{proposal.proposal.trigger} · params {JSON.stringify(proposal.proposal.params)} · criteria {JSON.stringify(proposal.proposal.criteria)}</div>
              <div className="sl-text-sm"><b>{proposal.would_match}</b> item(s) match today{proposal.sample?.length ? ':' : '.'}</div>
              {proposal.sample?.map((s, i) => <div key={i} className="sl-text-xs sl-text-muted">• {s}</div>)}
              <div className="sl-flex sl-gap-2 sl-mt-3">
                <select className="sl-select" style={{ width: 140 }} value={proposal.proposal.severity} onChange={e => setProposal({ ...proposal, proposal: { ...proposal.proposal, severity: e.target.value } })}>{['Low', 'Medium', 'High', 'Critical'].map(s => <option key={s}>{s}</option>)}</select>
                <button className="sl-btn sl-btn--primary" onClick={save}><Save size={14} /> Save & activate</button>
                <button className="sl-btn sl-btn--ghost" onClick={() => setProposal(null)}>Discard</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="sl-flex sl-justify-between sl-items-center sl-mb-4">
        <h3 className="sl-font-semibold">Active monitoring rules</h3>
        <button className="sl-btn sl-btn--secondary" disabled={busy} onClick={runAll}><Play size={14} /> Run all now</button>
      </div>
      {!rules ? <Loading /> : (
        <div className="sl-table-container">
          <table className="sl-table">
            <thead><tr><th>Rule</th><th>Watches</th><th>Severity</th><th>Open alerts</th><th>Last run</th><th></th></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td><div className="sl-font-medium sl-text-sm">{r.name}</div>{r.nl_prompt && <div className="sl-text-xs sl-text-muted">“{r.nl_prompt}”</div>}</td>
                  <td className="sl-text-xs"><div>{r.trigger_label}</div><div className="sl-text-muted sl-font-mono">{Object.entries({ ...r.params, ...r.criteria }).map(([k, v]) => `${k}=${v}`).join(' ') || 'all institutions'}</div></td>
                  <td><SeverityBadge severity={r.severity} /></td>
                  <td className="sl-text-center">{r.open_alerts}</td>
                  <td className="sl-text-xs">{fmtDateTime(r.last_run)}</td>
                  <td className="sl-text-right sl-whitespace-nowrap">
                    <button className="sl-btn sl-btn--ghost sl-btn--sm" title={r.active ? 'Pause' : 'Activate'} onClick={() => toggle(r)}><Power size={14} /></button>
                    <button className="sl-btn sl-btn--ghost sl-btn--sm" title="Delete" onClick={() => remove(r)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
