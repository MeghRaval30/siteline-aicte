import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Plus, Trash2, CalendarPlus, ClipboardEdit, Check, X, Building2, UserCog, AlertTriangle } from 'lucide-react';
import { apiClient, downloadFile } from '../api/client';
import { StageBadge, SlaPill, StatusBadge, Modal, Loading, toast, getUser, isOffice, fmtDate, fmtDateTime, daysUntil, fileToBase64, STAGE_SHORT } from '../components/ui';
import { ScheduleEvcModal, EvcReportModal } from '../components/EvcModals';
import { SubmitUndertakingModal, ReviewUndertakingModal, UploadDocModal } from '../components/ComplianceModals';

// The real journey so far (repeats included, e.g. two deficiency rounds), then the path still
// ahead on this application's own APH route (Table-2.3), so a scrutiny-only case never shows an EVC.
const FORWARD = { SUBMITTED: 1, SCRUTINY: 2, DEFICIENCY: 2, RESCRUTINY: 2, EVC: 3, SHC: 4, EC_REVIEW: 5 };
function aheadOf(app) {
  if (app.stage === 'SAC') return ['APPROVED'];
  if (!(app.stage in FORWARD)) return [];
  const ahead = (app.route?.stages || []).filter(s => FORWARD[s] > FORWARD[app.stage]);
  if (app.stage === 'DEFICIENCY') ahead.unshift('RESCRUTINY');
  return [...ahead, 'APPROVED'];
}
function Tracker({ app }) {
  const journey = app.transitions.map(t => t.to_stage).filter((s, i, a) => s !== a[i - 1]);
  const steps = [...journey, ...aheadOf(app)];
  const cur = journey.length - 1;
  return (
    <div className="aq-tracker">
      {steps.map((s, i) => {
        const side = ['DEFICIENCY', 'RESCRUTINY', 'SAC', 'SHC', 'REJECTED'].includes(s);
        const cls = i < cur ? 'aq-tracker__step--done' : i === cur ? (side ? 'aq-tracker__step--side' : 'aq-tracker__step--current') : '';
        return (
          <div key={i} className={`aq-tracker__step ${cls}`} style={i > cur ? { opacity: 0.55 } : undefined}>
            <div className="aq-tracker__dot">{i < cur ? '✓' : i + 1}</div>
            <div className="aq-tracker__label">{STAGE_SHORT[s]}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = getUser();
  const [app, setApp] = useState(null);
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState(params.get('tab') || null);
  const [move, setMove] = useState(null);
  const [modal, setModal] = useState(null);
  const [officers, setOfficers] = useState([]);

  const load = () => apiClient.get(`/applications/${id}`).then(setApp).catch(e => { toast(e.message, 'error'); navigate('/applications'); });
  useEffect(() => { load(); apiClient.get('/applications/meta').then(setMeta).catch(() => {}); if (isOffice(user)) apiClient.get('/users?role=Officer,Admin').then(setOfficers).catch(() => {}); }, [id]);

  if (!app) return <Loading />;
  const cs = app.checklist_summary;
  const docsBlocking = (app.stage === 'SUBMITTED' && cs.missing.length) || (['SCRUTINY', 'RESCRUTINY', 'DEFICIENCY'].includes(app.stage) && cs.unverified.length);
  const activeTab = tab || (docsBlocking ? 'checklist' : 'timeline');
  const openDefs = app.deficiencies.filter(d => d.status === 'Open');
  const done = () => { setModal(null); load(); };

  const assign = async officer_id => {
    try { await apiClient.patch(`/applications/${app.id}/assign`, { officer_id }); toast('Officer assigned'); load(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <button className="sl-btn sl-btn--ghost sl-btn--sm sl-mb-2" onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>
      <div className="sl-page__header">
        <div>
          <div className="sl-flex sl-items-center sl-gap-2 sl-mb-1"><span className="sl-font-mono sl-text-sm sl-text-muted">{app.app_number}</span><StatusBadge status={app.status} />{app.priority !== 'Normal' && <span className="sl-badge sl-badge--danger">{app.priority}</span>}</div>
          <h1 className="sl-page__title">{app.type}</h1>
          <p className="sl-page__subtitle">
            {isOffice(user) ? <Link to={`/institutions/${app.institution.id}`} className="sl-text-accent"><Building2 size={13} style={{ verticalAlign: -2 }} /> {app.institution.name}</Link> : app.institution.name}
            {' '}· {app.institution.aicte_id} · {app.institution.city}, {app.institution.state} · {app.institution.region.name} · AY {app.academic_year}
          </p>
          {app.route && <div className="sl-text-xs sl-text-muted sl-mt-1">Route: <span className="sl-badge sl-badge--accent">{app.route.name}</span> <span title="Clause of the Approval Process Handbook this route follows">{app.route.clause}</span>{app.route.version > 1 ? ` · v${app.route.version}` : ''}</div>}
        </div>
        <div className="sl-page__actions">
          {app.letter_code && <button className="sl-btn sl-btn--secondary" onClick={() => navigate(`/applications/${app.id}/letter`)}><FileText size={16} /> {app.stage === 'REJECTED' || app.status === 'Rejected' ? 'LoR' : 'LoA'} letter</button>}
        </div>
      </div>

      <div className="sl-card sl-mb-4">
        <div className="sl-card__body">
          <Tracker app={app} />
          <div className="sl-flex sl-items-center sl-justify-between sl-flex-wrap sl-gap-4 sl-mt-4">
            <div className="sl-flex sl-items-center sl-gap-4">
              <div><div className="sl-text-xs sl-text-muted">Current stage</div><StageBadge stage={app.stage} label={app.stage_label} /></div>
              <div><div className="sl-text-xs sl-text-muted">Time in stage</div><SlaPill sla={app.sla} /></div>
              <div><div className="sl-text-xs sl-text-muted">Submitted</div><div className="sl-text-sm">{fmtDate(app.submitted_at)}</div></div>
              {app.intake_requested != null && <div><div className="sl-text-xs sl-text-muted">Intake requested</div><div className="sl-text-sm">{app.intake_requested}</div></div>}
              {app.courses && <div><div className="sl-text-xs sl-text-muted">Course(s)</div><div className="sl-text-sm">{app.courses}</div></div>}
              {app.rescrutiny_count > 0 && <div><div className="sl-text-xs sl-text-muted">Re-scrutiny rounds</div><div className="sl-text-sm">{app.rescrutiny_count}</div></div>}
              <div>
                <div className="sl-text-xs sl-text-muted"><UserCog size={11} style={{ verticalAlign: -1 }} /> Assigned officer</div>
                {isOffice(user) ? (
                  <select className="sl-select" style={{ height: 30, fontSize: 12, padding: '0 8px' }} value={app.assigned_officer?.id || ''} onChange={e => assign(e.target.value)}>
                    <option value="">Unassigned</option>{officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                ) : <div className="sl-text-sm">{app.assigned_officer?.name || '—'}</div>}
              </div>
            </div>
            <div className="sl-flex sl-gap-2 sl-flex-wrap">
              {app.allowed_transitions.map(t => (
                <button key={t.to} className={`sl-btn ${['REJECTED', 'WITHDRAWN'].includes(t.to) ? 'sl-btn--danger' : ['DEFICIENCY'].includes(t.to) ? 'sl-btn--secondary' : 'sl-btn--primary'}`} title={t.clause ? `${t.label} (${t.clause})` : t.hint} onClick={() => setMove(t)}>{t.label}</button>
              ))}
              {app.allowed_transitions.length === 0 && <span className="sl-text-xs sl-text-muted">No actions available for your role at this stage</span>}
            </div>
          </div>
          {docsBlocking ? (
            <div className="aq-panel sl-mt-4 sl-flex sl-items-center sl-gap-2" style={{ borderColor: cs.deficient ? 'var(--sl-danger)' : 'var(--sl-warning)' }}>
              <FileText size={16} className="sl-text-accent" />
              <span className="sl-text-sm">
                {app.stage === 'SUBMITTED' ? `${cs.missing.length} required document(s) not uploaded — scrutiny cannot start until the checklist is complete.`
                  : cs.deficient ? `${cs.deficient} document(s) marked deficient — ${user.role === 'Institution' ? 're-upload them' : 'raise a deficiency or wait for re-upload'}.`
                  : `${cs.unverified.length} required document(s) still to be verified before scrutiny can be cleared.`}
              </span>
              <button className="sl-btn sl-btn--ghost sl-btn--sm sl-ml-auto" onClick={() => setTab('checklist')}>Open checklist</button>
            </div>
          ) : null}
          {app.stage === 'DEFICIENCY' && user.role === 'Institution' && openDefs.length > 0 && (
            <div className="aq-panel sl-mt-4 sl-flex sl-items-center sl-gap-2" style={{ borderColor: 'var(--sl-warning)' }}><AlertTriangle size={16} className="sl-text-accent" /><span className="sl-text-sm">Respond to all {openDefs.length} open deficiencies (Deficiencies tab), then submit for re-scrutiny. Response due {fmtDate(openDefs[0].due_date)}.</span></div>
          )}
        </div>
      </div>

      <div className="sl-tabs">
        {[['timeline', 'Timeline'], ['checklist', `Checklist (${cs.verified}/${cs.total})`], ['deficiencies', `Deficiencies (${app.deficiencies.length})`], ['evc', `EVC (${app.evc_visits.length})`], ['undertakings', `Undertakings (${app.undertakings.length})`], ['documents', `Documents (${app.institution_documents.length})`]].map(([k, l]) => (
          <button key={k} className={`sl-tab ${activeTab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {activeTab === 'checklist' && <Checklist app={app} user={user} reload={load} />}

      {activeTab === 'timeline' && (
        <div className="sl-card"><div className="sl-card__body">
          <div className="sl-timeline">
            {[...app.transitions].reverse().map(t => (
              <div key={t.id} className="sl-timeline__item">
                <div className={`sl-timeline__dot ${t.sla_breached ? '' : 'sl-timeline__dot--accent'}`} style={t.sla_breached ? { background: 'var(--sl-danger)' } : undefined} />
                <div className="sl-timeline__content">
                  <div className="sl-timeline__title sl-flex sl-items-center sl-gap-2 sl-flex-wrap">
                    {t.from_stage && <><StageBadge stage={t.from_stage} /> →</>} <StageBadge stage={t.to_stage} />
                    {t.from_stage && <span className="sl-text-xs sl-text-muted">after {t.days_in_stage} days</span>}
                    {t.sla_breached && <span className="sl-badge sl-badge--danger">SLA breached</span>}
                  </div>
                  <div className="sl-text-sm sl-mt-1">{t.remarks}</div>
                  <div className="sl-timeline__time">{t.actor ? `${t.actor.name} (${t.actor.role})` : 'Institution portal'} · {fmtDateTime(t.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div></div>
      )}

      {activeTab === 'deficiencies' && <Deficiencies app={app} user={user} meta={meta} reload={load} />}

      {activeTab === 'evc' && (
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Expert Visit Committee</h3>
            {isOffice(user) && ['EVC', 'SCRUTINY', 'RESCRUTINY', 'SAC'].includes(app.stage) && <button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => setModal({ kind: 'schedule' })}><CalendarPlus size={14} /> Schedule EVC</button>}</div>
          <div className="sl-card__body">
            {app.evc_visits.length === 0 ? <p className="sl-text-muted sl-text-sm">No visit scheduled yet.</p> : app.evc_visits.map(v => (
              <div key={v.id} className="aq-panel sl-mb-3">
                <div className="sl-flex sl-justify-between sl-items-center sl-flex-wrap sl-gap-2">
                  <div className="sl-flex sl-items-center sl-gap-2"><span className="sl-font-semibold">{fmtDate(v.visit_date)}</span><span className="sl-badge sl-badge--neutral">{v.mode}</span><StatusBadge status={v.status} />
                    {v.status === 'Scheduled' && new Date(v.visit_date) < new Date() && <span className="sl-badge sl-badge--danger">Report overdue</span>}</div>
                  {v.status === 'Scheduled' && (isOffice(user) || v.members.some(m => m.user.id === user.id)) && <button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => setModal({ kind: 'report', visit: { ...v, application: app } })}><ClipboardEdit size={14} /> File report</button>}
                </div>
                <div className="sl-text-xs sl-text-muted sl-mt-2">Panel: {v.members.map(m => `${m.user.name}${m.is_chair ? ' (Chair)' : ''} — ${m.user.specialization}, ${m.user.state}`).join(' · ')}</div>
                {v.recommendation && <div className="sl-mt-2"><span className={`sl-badge sl-badge--${v.recommendation === 'Recommended' ? 'success' : v.recommendation === 'Not Recommended' ? 'danger' : 'warning'}`}>{v.recommendation}</span> {v.score != null && <span className="sl-text-xs sl-text-muted">score {v.score}/100</span>}<div className="sl-text-sm sl-mt-1">{v.report}</div></div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'undertakings' && (
        <div className="sl-card"><div className="sl-card__body">
          {app.undertakings.length === 0 ? <p className="sl-text-muted sl-text-sm">No undertakings. They are created when approval is granted with conditions.</p> : (
            <table className="sl-table sl-table--compact"><thead><tr><th>Undertaking</th><th>Category</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
              {app.undertakings.map(u => (
                <tr key={u.id}><td><div className="sl-font-medium sl-text-sm">{u.title}</div>{u.submission_note && <div className="sl-text-xs sl-text-muted">“{u.submission_note}”</div>}</td><td className="sl-text-sm">{u.category}</td>
                  <td className="sl-text-sm sl-whitespace-nowrap">{fmtDate(u.due_date)}<div className={`sl-text-xs ${daysUntil(u.due_date) < 0 ? 'sl-text-danger' : 'sl-text-muted'}`}>{daysUntil(u.due_date) < 0 ? `${-daysUntil(u.due_date)} days late` : `${daysUntil(u.due_date)} days left`}</div></td>
                  <td><StatusBadge status={u.status} /></td>
                  <td className="sl-text-right">
                    {user.role === 'Institution' && ['Pending', 'Overdue'].includes(u.status) && <button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => setModal({ kind: 'submitU', u })}>Submit proof</button>}
                    {isOffice(user) && ['Submitted', 'Overdue', 'Pending'].includes(u.status) && <button className="sl-btn sl-btn--secondary sl-btn--sm" onClick={() => setModal({ kind: 'reviewU', u: { ...u, institution: app.institution } })}>Review</button>}
                  </td></tr>
              ))}
            </tbody></table>
          )}
        </div></div>
      )}

      {activeTab === 'documents' && (
        <div className="sl-card"><div className="sl-card__body">
          <table className="sl-table sl-table--compact"><thead><tr><th>Document</th><th>Number</th><th>Valid till</th><th>Status</th><th></th></tr></thead><tbody>
            {app.institution_documents.map(d => (
              <tr key={d.id}><td className="sl-font-medium sl-text-sm">{d.doc_type}</td><td className="sl-text-xs sl-font-mono">{d.doc_number}</td>
                <td className="sl-text-sm">{d.valid_to ? fmtDate(d.valid_to) : 'Permanent'}{d.valid_to && <div className={`sl-text-xs ${daysUntil(d.valid_to) < 0 ? 'sl-text-danger' : 'sl-text-muted'}`}>{daysUntil(d.valid_to) < 0 ? `expired ${-daysUntil(d.valid_to)}d ago` : `${daysUntil(d.valid_to)} days left`}</div>}</td>
                <td><StatusBadge status={d.status} /></td>
                <td className="sl-text-right">{user.role === 'Institution' && ['Expiring Soon', 'Expired'].includes(d.status) && <button className="sl-btn sl-btn--secondary sl-btn--sm" onClick={() => setModal({ kind: 'renew', d })}>Renew</button>}</td></tr>
            ))}
          </tbody></table>
        </div></div>
      )}

      {move && <TransitionModal app={app} move={move} meta={meta} onClose={() => setMove(null)} onDone={() => { setMove(null); load(); }} />}
      {modal?.kind === 'schedule' && <ScheduleEvcModal application={app} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'report' && <EvcReportModal visit={modal.visit} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'submitU' && <SubmitUndertakingModal undertaking={modal.u} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'reviewU' && <ReviewUndertakingModal undertaking={modal.u} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'renew' && <UploadDocModal renewOf={modal.d} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

function Checklist({ app, user, reload }) {
  const [busyId, setBusyId] = useState(null);
  const [reasons, setReasons] = useState({});
  const s = app.checklist_summary;
  const canUpload = (user.role === 'Institution' && ['SUBMITTED', 'DEFICIENCY'].includes(app.stage)) || (isOffice(user) && ['SUBMITTED', 'SCRUTINY', 'DEFICIENCY', 'RESCRUTINY'].includes(app.stage));
  const canReview = isOffice(user) && ['SUBMITTED', 'SCRUTINY', 'RESCRUTINY'].includes(app.stage);
  const upload = async (item, file) => {
    if (!file) return;
    setBusyId(item.id);
    try { await apiClient.post(`/applications/${app.id}/checklist/${item.id}/upload`, { file_name: file.name, file_data: await fileToBase64(file) }); toast(`${item.label} uploaded`); reload(); } catch (e) { toast(e.message, 'error'); }
    setBusyId(null);
  };
  const review = async (item, decision) => {
    setBusyId(item.id);
    try { await apiClient.patch(`/applications/${app.id}/checklist/${item.id}/review`, { decision, remarks: reasons[item.id] }); toast(decision === 'Verified' ? 'Document verified' : 'Marked deficient; institution notified'); setReasons({ ...reasons, [item.id]: '' }); reload(); } catch (e) { toast(e.message, 'error'); }
    setBusyId(null);
  };
  const pct = s.required ? Math.round(100 * app.checklist.filter(i => i.required && i.status === 'Verified').length / s.required) : 0;
  return (
    <div className="sl-card">
      <div className="sl-card__header">
        <h3 className="sl-card__title">Mandatory documents</h3>
        <span className="sl-text-xs sl-text-muted">{s.uploaded}/{s.total} uploaded · {s.verified} verified{s.deficient ? ` · ${s.deficient} deficient` : ''}</span>
      </div>
      <div className="sl-card__body">
        <div className="aq-sla__bar sl-mb-4" title={`${pct}% of required documents verified`}><div className={`aq-sla__fill aq-sla__fill--${pct === 100 ? 'success' : s.deficient ? 'danger' : 'warning'}`} style={{ width: `${Math.max(pct, 2)}%` }} /></div>
        <table className="sl-table sl-table--compact">
          <thead><tr><th>Document</th><th>Status</th><th>File</th><th style={{ width: 320 }}></th></tr></thead>
          <tbody>
            {app.checklist.map(item => (
              <tr key={item.id}>
                <td><div className="sl-text-sm sl-font-medium">{item.label}</div><div className="sl-text-xs sl-text-muted">{item.required ? 'Required' : 'Optional'}{item.verified_by ? ` · ${item.status === 'Verified' ? 'verified' : 'reviewed'} by ${item.verified_by}` : ''}</div>
                  {item.remarks && <div className={`sl-text-xs sl-mt-1 ${item.status === 'Deficient' ? 'sl-text-danger' : 'sl-text-muted'}`}>{item.remarks}</div>}</td>
                <td><StatusBadge status={{ Pending: 'Not uploaded', Uploaded: 'Awaiting verification' }[item.status] || item.status} /></td>
                <td className="sl-text-xs">{item.file_url ? <button type="button" className="sl-btn sl-btn--ghost sl-btn--sm sl-text-accent" onClick={() => downloadFile(item.file_url, item.file_name).catch(e => toast(e.message, 'error'))}>{item.file_name}</button> : item.file_name || '—'}</td>
                <td className="sl-text-right">
                  {canUpload && item.status !== 'Verified' && (
                    <label className={`sl-btn sl-btn--${item.status === 'Pending' || item.status === 'Deficient' ? 'primary' : 'secondary'} sl-btn--sm`} style={{ cursor: 'pointer' }}>
                      {busyId === item.id ? <span className="sl-btn__spinner" /> : item.status === 'Pending' ? 'Upload' : 'Replace'}
                      <input type="file" accept=".pdf,image/*" hidden onChange={e => upload(item, e.target.files[0])} />
                    </label>
                  )}
                  {canReview && ['Uploaded', 'Deficient'].includes(item.status) && item.status !== 'Deficient' && (
                    <div className="sl-flex sl-gap-1 sl-justify-end sl-items-center sl-mt-1">
                      <input className="sl-input" style={{ height: 30, fontSize: 12, maxWidth: 160 }} placeholder="Reason if deficient" value={reasons[item.id] || ''} onChange={e => setReasons({ ...reasons, [item.id]: e.target.value })} />
                      <button className="sl-btn sl-btn--ghost sl-btn--sm" disabled={busyId === item.id || !reasons[item.id]} onClick={() => review(item, 'Deficient')}><X size={14} /> Deficient</button>
                      <button className="sl-btn sl-btn--primary sl-btn--sm" disabled={busyId === item.id} onClick={() => review(item, 'Verified')}><Check size={14} /> Verify</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canReview && app.checklist.some(i => i.status === 'Uploaded') && (
          <button className="sl-btn sl-btn--secondary sl-btn--sm sl-mt-4" disabled={!!busyId} onClick={async () => { for (const i of app.checklist.filter(x => x.status === 'Uploaded')) { try { await apiClient.patch(`/applications/${app.id}/checklist/${i.id}/review`, { decision: 'Verified' }); } catch (e) { toast(e.message, 'error'); break; } } toast('All uploaded documents verified'); reload(); }}><Check size={14} /> Verify all uploaded</button>
        )}
      </div>
    </div>
  );
}

function Deficiencies({ app, user, meta, reload }) {
  const [responses, setResponses] = useState({});
  const [adding, setAdding] = useState(false);
  const [nd, setNd] = useState({ category: 'Documents', description: '', severity: 'Major' });
  const respond = async d => {
    try { await apiClient.patch(`/applications/deficiencies/${d.id}/respond`, { response: responses[d.id] }); toast('Response recorded'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const review = async (d, status) => {
    try { await apiClient.patch(`/applications/deficiencies/${d.id}/review`, { status }); toast(`Deficiency ${status.toLowerCase()}`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const add = async () => {
    try { await apiClient.post(`/applications/${app.id}/deficiencies`, nd); toast('Deficiency raised; institution notified'); setAdding(false); setNd({ category: 'Documents', description: '', severity: 'Major' }); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="sl-card">
      <div className="sl-card__header"><h3 className="sl-card__title">Deficiencies</h3>{isOffice(user) && <button className="sl-btn sl-btn--secondary sl-btn--sm" onClick={() => setAdding(!adding)}><Plus size={14} /> Raise deficiency</button>}</div>
      <div className="sl-card__body">
        {adding && (
          <div className="aq-panel sl-mb-4" style={{ display: 'grid', gridTemplateColumns: '160px 120px 1fr auto', gap: 8 }}>
            <select className="sl-select" value={nd.category} onChange={e => setNd({ ...nd, category: e.target.value })}>{meta?.deficiency_categories.map(c => <option key={c}>{c}</option>)}</select>
            <select className="sl-select" value={nd.severity} onChange={e => setNd({ ...nd, severity: e.target.value })}><option>Minor</option><option>Major</option><option>Critical</option></select>
            <input className="sl-input" placeholder="What is deficient against APH norms" value={nd.description} onChange={e => setNd({ ...nd, description: e.target.value })} />
            <button className="sl-btn sl-btn--primary" disabled={!nd.description} onClick={add}>Add</button>
          </div>
        )}
        {app.deficiencies.length === 0 ? <p className="sl-text-muted sl-text-sm">No deficiencies raised.</p> : app.deficiencies.map(d => (
          <div key={d.id} className="aq-list-item">
            <div className="sl-flex sl-justify-between sl-items-center sl-gap-2">
              <div className="sl-flex sl-items-center sl-gap-2"><span className="sl-badge sl-badge--neutral">{d.category}</span><span className={`sl-badge sl-badge--${d.severity === 'Critical' ? 'danger' : d.severity === 'Major' ? 'warning' : 'info'}`}>{d.severity}</span><StatusBadge status={d.status} /></div>
              <span className="sl-text-xs sl-text-muted">raised {fmtDate(d.created_at)}{d.raiser ? ` by ${d.raiser.name}` : ''} · due {fmtDate(d.due_date)}</span>
            </div>
            <div className="sl-text-sm sl-mt-2">{d.description}</div>
            {d.response && <div className="aq-panel sl-mt-2 sl-text-sm"><span className="sl-text-xs sl-text-muted">Institution response:</span><br />{d.response}</div>}
            {user.role === 'Institution' && d.status === 'Open' && (
              <div className="sl-flex sl-gap-2 sl-mt-2">
                <input className="sl-input" placeholder="Your response / rectification details" value={responses[d.id] || ''} onChange={e => setResponses({ ...responses, [d.id]: e.target.value })} />
                <button className="sl-btn sl-btn--primary" disabled={!responses[d.id]} onClick={() => respond(d)}>Respond</button>
              </div>
            )}
            {isOffice(user) && d.status === 'Responded' && (
              <div className="sl-flex sl-gap-2 sl-mt-2">
                <button className="sl-btn sl-btn--secondary sl-btn--sm" onClick={() => review(d, 'Accepted')}><Check size={14} /> Accept</button>
                <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => review(d, 'Open')}><X size={14} /> Reopen</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TransitionModal({ app, move, meta, onClose, onDone }) {
  const [remarks, setRemarks] = useState('');
  const fromChecklist = app.checklist.filter(i => i.status === 'Deficient').map(i => ({ category: 'Documents', description: `${i.label}: ${i.remarks || 'deficient'}`, severity: 'Major' }));
  const [defs, setDefs] = useState(move.to === 'DEFICIENCY' && !app.deficiencies.some(d => d.status === 'Open') ? (fromChecklist.length ? fromChecklist : [{ category: 'Documents', description: '', severity: 'Major' }]) : []);
  const in6m = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const [unds, setUnds] = useState(move.to === 'CONDITIONAL' ? [{ category: 'Lease Renewal', title: 'Renew land lease deed and submit registered copy', due_date: in6m }] : []);
  const [busy, setBusy] = useState(false);
  const needsRemarks = ['REJECTED', 'CONDITIONAL'].includes(move.to);
  const inflight = useRef(false);

  const submit = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      await apiClient.post(`/applications/${app.id}/transition`, { to: move.to, remarks, deficiencies: defs.filter(d => d.description), undertakings: unds.filter(u => u.title && u.due_date) });
      toast(`${app.app_number} moved to ${STAGE_SHORT[move.to]}`);
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    inflight.current = false;
    setBusy(false);
  };

  return (
    <Modal wide={defs.length > 0 || unds.length > 0} title={move.label} onClose={onClose}
      footer={<><button className="sl-btn sl-btn--secondary" onClick={onClose}>Cancel</button><button className={`sl-btn ${['REJECTED', 'WITHDRAWN'].includes(move.to) ? 'sl-btn--danger' : 'sl-btn--primary'}`} disabled={busy || (needsRemarks && !remarks)} onClick={submit}>Confirm</button></>}>
      <div className="sl-flex sl-items-center sl-gap-2 sl-mb-4"><StageBadge stage={app.stage} /> → <StageBadge stage={move.to} />
        {app.sla?.breached && <span className="sl-badge sl-badge--danger">leaving {app.sla.days - app.sla.sla_days} days past SLA</span>}</div>
      {move.to === 'EC_REVIEW' && app.stage === 'EVC' && !app.evc_visits.some(v => v.status === 'Completed') && <div className="aq-panel sl-mb-4 sl-text-sm sl-text-danger">The EVC report must be filed first.</div>}

      {defs.length > 0 && (
        <div className="sl-mb-4">
          <label className="sl-label">Deficiencies to communicate (institution gets 15 days)</label>
          {defs.map((d, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 110px 1fr 32px', gap: 6 }} className="sl-mb-2">
              <select className="sl-select" value={d.category} onChange={e => setDefs(defs.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}>{meta?.deficiency_categories.map(c => <option key={c}>{c}</option>)}</select>
              <select className="sl-select" value={d.severity} onChange={e => setDefs(defs.map((x, j) => j === i ? { ...x, severity: e.target.value } : x))}><option>Minor</option><option>Major</option><option>Critical</option></select>
              <input className="sl-input" placeholder="Description" value={d.description} onChange={e => setDefs(defs.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
              <button className="sl-btn sl-btn--ghost sl-btn--icon" onClick={() => setDefs(defs.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => setDefs([...defs, { category: 'Documents', description: '', severity: 'Major' }])}><Plus size={14} /> Add another</button>
        </div>
      )}

      {unds.length > 0 && (
        <div className="sl-mb-4">
          <label className="sl-label">Time-bound undertakings (tracked & alerted automatically)</label>
          {unds.map((u, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 150px 32px', gap: 6 }} className="sl-mb-2">
              <select className="sl-select" value={u.category} onChange={e => setUnds(unds.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}>{meta?.undertaking_categories.map(c => <option key={c}>{c}</option>)}</select>
              <input className="sl-input" value={u.title} onChange={e => setUnds(unds.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
              <input className="sl-input" type="date" value={u.due_date} onChange={e => setUnds(unds.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x))} />
              <button className="sl-btn sl-btn--ghost sl-btn--icon" onClick={() => setUnds(unds.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => setUnds([...unds, { category: 'Faculty Recruitment', title: '', due_date: in6m }])}><Plus size={14} /> Add undertaking</button>
        </div>
      )}

      <div className="sl-form-group"><label className="sl-label">Remarks{needsRemarks ? ' *' : ''}</label>
        <textarea className="sl-textarea" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder={move.to === 'REJECTED' ? 'Grounds for rejection (appears on the LoR)' : 'Note for the file'} /></div>
    </Modal>
  );
}
