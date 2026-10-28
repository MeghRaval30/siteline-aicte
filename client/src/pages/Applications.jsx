import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, LayoutGrid, List, FileStack, Download } from 'lucide-react';
import { apiClient } from '../api/client';
import { StageBadge, SlaPill, Modal, Empty, Loading, toast, getUser, isOffice, fmtDate, downloadCsv, STAGE_COLORS, STAGE_SHORT } from '../components/ui';

const BOARD = ['SUBMITTED', 'SCRUTINY', 'DEFICIENCY', 'RESCRUTINY', 'EVC', 'EC_REVIEW', 'SAC', 'SHC'];

export default function Applications() {
  const navigate = useNavigate();
  const user = getUser();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [regions, setRegions] = useState([]);
  const [search, setSearch] = useState(params.get('search') || '');
  const [showNew, setShowNew] = useState(params.get('new') === '1');
  const view = params.get('view') || 'list';

  const query = useMemo(() => {
    const q = new URLSearchParams({ limit: 500 });
    for (const k of ['stage', 'region', 'overdue', 'active', 'type', 'status']) if (params.get(k)) q.set(k, params.get(k));
    if (view === 'board') q.set('active', '1');
    if (params.get('search')) q.set('search', params.get('search'));
    return q.toString();
  }, [params, view]);

  const load = () => apiClient.get(`/applications?${query}`).then(setRows).catch(e => { toast(e.message, 'error'); setRows([]); });
  useEffect(() => { setRows(null); load(); }, [query]);
  useEffect(() => {
    apiClient.get('/applications/meta').then(setMeta).catch(() => {});
    if (isOffice(user)) apiClient.get('/institutions/regions').then(setRegions).catch(() => {});
  }, []);

  const setParam = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  const doSearch = e => { e.preventDefault(); setParam('search', search); };

  const exportCsv = () => downloadCsv('applications.csv', rows.map(r => ({
    application: r.app_number, institution: r.institution.name, aicte_id: r.institution.aicte_id, region: r.institution.region.code, type: r.type,
    stage: r.stage_label, status: r.status, days_in_stage: r.sla.days, sla_days: r.sla.sla_days ?? '', sla_breached: r.sla.breached ? 'YES' : '', submitted: fmtDate(r.submitted_at), officer: r.assigned_officer?.name || '',
  })));

  return (
    <div>
      <div className="sl-page__header">
        <div>
          <h1 className="sl-page__title">{user.role === 'Institution' ? 'My Applications' : 'Applications'}</h1>
          <p className="sl-page__subtitle">Every application, where it is in the APH pipeline, and how long it has been there</p>
        </div>
        <div className="sl-page__actions">
          <div className="sl-tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            <button className={`sl-tab ${view === 'list' ? 'active' : ''}`} onClick={() => setParam('view', '')}><List size={14} /> List</button>
            <button className={`sl-tab ${view === 'board' ? 'active' : ''}`} onClick={() => setParam('view', 'board')}><LayoutGrid size={14} /> Pipeline board</button>
          </div>
          {rows?.length > 0 && <button className="sl-btn sl-btn--secondary" onClick={exportCsv}><Download size={16} /> CSV</button>}
          {(user.role === 'Institution' || isOffice(user)) && <button className="sl-btn sl-btn--primary" onClick={() => setShowNew(true)}><Plus size={16} /> New Application</button>}
        </div>
      </div>

      <div className="sl-flex sl-gap-3 sl-mb-4 sl-flex-wrap sl-items-center">
        <form onSubmit={doSearch} className="sl-filters__search" style={{ position: 'relative', minWidth: 260 }}>
          <Search size={14} className="sl-filters__search-icon" style={{ position: 'absolute', left: 10, top: 11 }} />
          <input className="sl-input" style={{ paddingLeft: 30 }} placeholder="App no., institution or AICTE ID" value={search} onChange={e => setSearch(e.target.value)} />
        </form>
        {view === 'list' && (
          <select className="sl-select" style={{ width: 180 }} value={params.get('stage') || ''} onChange={e => setParam('stage', e.target.value)}>
            <option value="">All stages</option>
            {Object.keys(STAGE_SHORT).map(s => <option key={s} value={s}>{STAGE_SHORT[s]}</option>)}
          </select>
        )}
        {regions.length > 0 && (
          <select className="sl-select" style={{ width: 150 }} value={params.get('region') || ''} onChange={e => setParam('region', e.target.value)}>
            <option value="">All regions</option>
            {regions.map(r => <option key={r.code} value={r.code}>{r.code} · {r.city}</option>)}
          </select>
        )}
        <select className="sl-select" style={{ width: 190 }} value={params.get('type') || ''} onChange={e => setParam('type', e.target.value)}>
          <option value="">All application types</option>
          {meta?.types.map(t => <option key={t}>{t}</option>)}
        </select>
        <button className={`sl-filter-chip ${params.get('overdue') === '1' ? 'active' : ''}`} onClick={() => setParam('overdue', params.get('overdue') === '1' ? '' : '1')}>Past SLA only</button>
        {view === 'list' && <button className={`sl-filter-chip ${params.get('active') === '1' ? 'active' : ''}`} onClick={() => setParam('active', params.get('active') === '1' ? '' : '1')}>In process only</button>}
        {[...params.keys()].filter(k => !['view', 'new'].includes(k)).length > 0 && <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => { setSearch(''); setParams(view === 'board' ? { view: 'board' } : {}); }}>Clear filters</button>}
      </div>

      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon={FileStack} title="No applications match" /> : view === 'board' ? (
        <div className="aq-kanban">
          {BOARD.map(stage => {
            const col = rows.filter(r => r.stage === stage);
            return (
              <div key={stage} className="aq-kanban__col">
                <div className="aq-kanban__head" style={{ borderTop: `3px solid ${STAGE_COLORS[stage]}`, borderRadius: '12px 12px 0 0' }}>
                  <span>{STAGE_SHORT[stage]}</span>
                  <span className="sl-flex sl-gap-1">
                    <span className="sl-badge sl-badge--neutral">{col.length}</span>
                    {col.some(r => r.sla.breached) && <span className="sl-badge sl-badge--danger">{col.filter(r => r.sla.breached).length} late</span>}
                  </span>
                </div>
                <div className="aq-kanban__body">
                  {col.map(r => (
                    <div key={r.id} className={`aq-kcard ${r.sla.breached ? 'aq-kcard--breach' : ''}`} onClick={() => navigate(`/applications/${r.id}`)}>
                      <div className="sl-text-sm sl-font-medium">{r.institution.name}</div>
                      <div className="sl-text-xs sl-text-muted sl-mb-2">{r.app_number} · {r.type}</div>
                      <SlaPill sla={r.sla} />
                      {r.priority !== 'Normal' && <span className={`sl-badge sl-badge--${r.priority === 'Court-Directed' ? 'danger' : 'warning'} sl-mt-2`}>{r.priority}</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sl-table-container">
          <table className="sl-table">
            <thead><tr><th>Application</th><th>Institution</th><th>Type</th><th>Stage</th><th>Time in stage</th><th>Officer</th><th>Submitted</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="aq-row-link" onClick={() => navigate(`/applications/${r.id}`)}>
                  <td><div className="sl-font-mono sl-text-xs">{r.app_number}</div>{r.priority !== 'Normal' && <span className={`sl-badge sl-badge--${r.priority === 'Court-Directed' ? 'danger' : 'warning'}`}>{r.priority}</span>}</td>
                  <td><div className="sl-font-medium">{r.institution.name}</div><div className="sl-text-xs sl-text-muted">{r.institution.city}, {r.institution.state} · {r.institution.region.code}</div></td>
                  <td className="sl-text-sm">{r.type}</td>
                  <td><StageBadge stage={r.stage} />{r.deficiencies?.length > 0 && <div className="sl-text-xs sl-text-danger sl-mt-1">{r.deficiencies.length} open deficienc{r.deficiencies.length > 1 ? 'ies' : 'y'}</div>}</td>
                  <td><SlaPill sla={r.sla} /></td>
                  <td className="sl-text-sm">{r.assigned_officer?.name || <span className="sl-text-muted">—</span>}</td>
                  <td className="sl-text-sm sl-whitespace-nowrap">{fmtDate(r.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <NewApplication meta={meta} user={user} onClose={() => { setShowNew(false); setParam('new', ''); }} onCreated={app => { toast(`Application ${app.app_number} submitted`); navigate(`/applications/${app.id}`); }} />}
    </div>
  );
}

function NewApplication({ meta, user, onClose, onCreated }) {
  const [form, setForm] = useState({ type: 'Extension of Approval', academic_year: '2027-28', institution_id: '', intake_requested: '', courses: '', priority: 'Normal' });
  const [institutions, setInstitutions] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isOffice(user)) apiClient.get('/institutions').then(setInstitutions).catch(() => {}); }, []);
  const submit = async () => {
    setBusy(true);
    try { onCreated(await apiClient.post('/applications', form)); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const f = (k, v) => setForm({ ...form, [k]: v });
  return (
    <Modal title="New application" onClose={onClose} footer={<><button className="sl-btn sl-btn--secondary" onClick={onClose}>Cancel</button><button className="sl-btn sl-btn--primary" disabled={busy || (isOffice(user) && !form.institution_id)} onClick={submit}>Submit to AICTE</button></>}>
      {isOffice(user) && (
        <div className="sl-form-group sl-mb-4"><label className="sl-label">Institution *</label>
          <select className="sl-select" value={form.institution_id} onChange={e => f('institution_id', e.target.value)}>
            <option value="">Select…</option>{institutions.map(i => <option key={i.id} value={i.id}>{i.name} ({i.aicte_id})</option>)}
          </select></div>
      )}
      <div className="sl-form-row sl-mb-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="sl-form-group"><label className="sl-label">Application type</label>
          <select className="sl-select" value={form.type} onChange={e => f('type', e.target.value)}>{meta?.types.map(t => <option key={t}>{t}</option>)}</select></div>
        <div className="sl-form-group"><label className="sl-label">Academic year</label>
          <select className="sl-select" value={form.academic_year} onChange={e => f('academic_year', e.target.value)}><option>2027-28</option><option>2028-29</option></select></div>
      </div>
      {['Increase in Intake', 'New Institution'].includes(form.type) && <div className="sl-form-group sl-mb-4"><label className="sl-label">Intake requested</label><input className="sl-input" type="number" value={form.intake_requested} onChange={e => f('intake_requested', e.target.value)} /></div>}
      {['New Course', 'New Institution'].includes(form.type) && <div className="sl-form-group sl-mb-4"><label className="sl-label">Courses</label><input className="sl-input" placeholder="e.g. B.Tech CSE (AI & ML)" value={form.courses} onChange={e => f('courses', e.target.value)} /></div>}
      {isOffice(user) && <div className="sl-form-group"><label className="sl-label">Priority</label><select className="sl-select" value={form.priority} onChange={e => f('priority', e.target.value)}><option>Normal</option><option>High</option><option>Court-Directed</option></select></div>}
      <p className="sl-text-xs sl-text-muted sl-mt-4">The application enters the Submitted stage and is routed to the Regional Office scrutiny desk. Each stage carries an SLA; delays are tracked and alerted automatically.</p>
    </Modal>
  );
}
