import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Upload, FileCheck2, FileX, FileWarning, ClipboardCheck, Check, X, Download, Search } from 'lucide-react';
import { apiClient, downloadFile } from '../api/client';
import { StatusBadge, Loading, Empty, Stat, toast, getUser, isOffice, fmtDate, daysUntil, downloadCsv } from '../components/ui';
import { UploadDocModal, SubmitUndertakingModal, ReviewUndertakingModal } from '../components/ComplianceModals';

export default function Compliance() {
  const user = getUser();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'documents';
  const setTab = t => setParams(t === 'documents' ? {} : { tab: t });
  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">{user.role === 'Institution' ? 'My Compliance' : 'Documents & Undertakings'}</h1>
          <p className="sl-page__subtitle">Validity of prescribed documents and time-bound undertakings from conditional approvals</p></div>
      </div>
      <div className="sl-tabs">
        <button className={`sl-tab ${tab === 'documents' ? 'active' : ''}`} onClick={() => setTab('documents')}>Document validity</button>
        <button className={`sl-tab ${tab === 'undertakings' ? 'active' : ''}`} onClick={() => setTab('undertakings')}>Undertakings</button>
      </div>
      {tab === 'documents' ? <Documents user={user} params={params} setParams={setParams} /> : <Undertakings user={user} initial={params.get('filter')} />}
    </div>
  );
}

function Documents({ user, params, setParams }) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState(null);
  const [all, setAll] = useState([]);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const status = params.get('status') || '';
  const docType = params.get('doc_type') || '';

  const load = () => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (docType) q.set('doc_type', docType);
    if (search) q.set('search', search);
    apiClient.get(`/compliance/documents?${q}`).then(d => {
      setDocs(d);
      const rid = params.get('renew');
      if (rid) { const hit = d.find(x => x.id === Number(rid)); if (hit) setModal({ kind: 'renew', d: hit }); }
    }).catch(e => toast(e.message, 'error'));
    apiClient.get('/compliance/documents').then(setAll).catch(() => {});
  };
  useEffect(() => { load(); }, [status, docType]);

  const verify = async (d, decision) => {
    try {
      let remarks;
      if (decision === 'Rejected' || !d.file_url) {
        remarks = window.prompt(decision === 'Rejected' ? `Why is this ${d.doc_type} rejected?` : `No file is attached. Which original ${d.doc_type} did you check?`);
        if (!remarks) return;
      }
      const r = await apiClient.patch(`/compliance/documents/${d.id}/verify`, { decision, remarks });
      toast(`${d.doc_type} ${decision === 'Valid' ? 'verified' : 'rejected'}${r.alerts_auto_resolved ? ` — ${r.alerts_auto_resolved} alert(s) auto-resolved` : ''}`);
      load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const setP = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); p.delete('renew'); setParams(p); };
  const count = s => all.filter(d => d.status === s).length;
  const types = [...new Set(all.map(d => d.doc_type))].sort();

  return (
    <>
      <div className="aq-grid-auto sl-mb-6">
        <Stat icon={FileCheck2} label="Valid" value={count('Valid')} tone="success" onClick={() => setP('status', 'Valid')} />
        <Stat icon={FileWarning} label="Expiring in 60 days" value={count('Expiring Soon')} tone="warning" onClick={() => setP('status', 'Expiring Soon')} />
        <Stat icon={FileX} label="Expired" value={count('Expired')} tone="danger" onClick={() => setP('status', 'Expired')} />
        <Stat icon={ShieldCheck} label="Awaiting verification" value={count('Pending Verification')} tone="info" onClick={() => setP('status', 'Pending Verification')} />
      </div>
      <div className="sl-flex sl-gap-3 sl-mb-4 sl-flex-wrap sl-items-center">
        {isOffice(user) && <form onSubmit={e => { e.preventDefault(); load(); }} style={{ position: 'relative', minWidth: 240 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11 }} className="sl-text-muted" />
          <input className="sl-input" style={{ paddingLeft: 30 }} placeholder="Institution or doc no." value={search} onChange={e => setSearch(e.target.value)} /></form>}
        <select className="sl-select" style={{ width: 200 }} value={status} onChange={e => setP('status', e.target.value)}>
          <option value="">All statuses</option>{['Valid', 'Expiring Soon', 'Expired', 'Pending Verification', 'Rejected', 'Superseded'].map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="sl-select" style={{ width: 240 }} value={docType} onChange={e => setP('doc_type', e.target.value)}>
          <option value="">All document types</option>{types.map(t => <option key={t}>{t}</option>)}
        </select>
        <div className="sl-ml-auto sl-flex sl-gap-2">
          {docs?.length > 0 && <button className="sl-btn sl-btn--secondary" onClick={() => downloadCsv('documents.csv', docs.map(d => ({ institution: d.institution.name, aicte_id: d.institution.aicte_id, region: d.institution.region?.code, document: d.doc_type, number: d.doc_number, valid_to: d.valid_to ? fmtDate(d.valid_to) : 'Permanent', days_left: d.days_left ?? '', status: d.status })))}><Download size={16} /> CSV</button>}
          <button className="sl-btn sl-btn--primary" onClick={() => setModal({ kind: 'upload' })}><Upload size={16} /> Upload document</button>
        </div>
      </div>
      {!docs ? <Loading /> : docs.length === 0 ? <Empty icon={ShieldCheck} title="No documents match" /> : (
        <div className="sl-table-container">
          <table className="sl-table">
            <thead><tr>{isOffice(user) && <th>Institution</th>}<th>Document</th><th>Number / issuer</th><th>Valid till</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  {isOffice(user) && <td className="sl-cursor-pointer" onClick={() => navigate(`/institutions/${d.institution_id}`)}><div className="sl-font-medium">{d.institution.name}</div><div className="sl-text-xs sl-text-muted">{d.institution.city} · {d.institution.region?.code}</div></td>}
                  <td><div className="sl-font-medium sl-text-sm">{d.doc_type}</div>{d.renewal_of_id && <span className="sl-badge sl-badge--accent">Renewal</span>}</td>
                  <td className="sl-text-xs"><div className="sl-font-mono">{d.doc_number}</div><div className="sl-text-muted">{d.issued_by}</div></td>
                  <td className="sl-whitespace-nowrap">{d.valid_to ? fmtDate(d.valid_to) : 'Permanent'}{d.days_left != null && <div className={`sl-text-xs ${d.days_left < 0 ? 'sl-text-danger' : d.days_left <= 60 ? 'aq-tone-warning' : 'sl-text-muted'}`}>{d.days_left < 0 ? `expired ${-d.days_left}d ago` : `${d.days_left} days left`}</div>}</td>
                  <td><StatusBadge status={d.status} />{d.unverified_import && <div><span className="sl-badge sl-badge--warning">Imported, not verified</span></div>}{d.file_url && <div><button type="button" className="sl-btn sl-btn--ghost sl-btn--sm sl-text-xs sl-text-accent" onClick={() => downloadFile(d.file_url, d.file_name).catch(e => toast(e.message, 'error'))}>view file</button></div>}</td>
                  <td className="sl-text-right sl-whitespace-nowrap">
                    {isOffice(user) && d.status === 'Pending Verification' && <><button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => verify(d, 'Valid')}><Check size={14} /> Verify</button> <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => verify(d, 'Rejected')}><X size={14} /></button></>}
                    {['Expiring Soon', 'Expired'].includes(d.status) && (d.renewal_pending ? <span className="sl-badge sl-badge--info">Renewal under verification</span> : <button className="sl-btn sl-btn--secondary sl-btn--sm" onClick={() => setModal({ kind: 'renew', d })}>Renew</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal?.kind === 'upload' && <UploadDocModal onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal?.kind === 'renew' && <UploadDocModal renewOf={modal.d} onClose={() => { setModal(null); setP('renew', ''); }} onDone={() => { setModal(null); load(); }} />}
    </>
  );
}

function Undertakings({ user, initial }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState(['open', 'overdue', 'submitted', 'closed'].includes(initial) ? initial : 'open');
  const [modal, setModal] = useState(null);
  const load = () => apiClient.get('/compliance/undertakings').then(setRows).catch(e => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);
  if (!rows) return <Loading />;
  const groups = {
    open: rows.filter(r => ['Pending', 'Overdue', 'Submitted'].includes(r.status)),
    overdue: rows.filter(r => r.status === 'Overdue'),
    submitted: rows.filter(r => r.status === 'Submitted'),
    closed: rows.filter(r => ['Verified', 'Waived', 'Breached'].includes(r.status)),
  };
  const list = groups[filter];
  return (
    <>
      <div className="aq-grid-auto sl-mb-6">
        <Stat icon={ClipboardCheck} label="Open undertakings" value={groups.open.length} tone="accent" onClick={() => setFilter('open')} />
        <Stat icon={FileX} label="Overdue" value={groups.overdue.length} tone="danger" onClick={() => setFilter('overdue')} />
        <Stat icon={Upload} label="Submitted, awaiting review" value={groups.submitted.length} tone="info" onClick={() => setFilter('submitted')} />
        <Stat icon={FileCheck2} label="Closed" value={groups.closed.length} tone="success" onClick={() => setFilter('closed')} />
      </div>
      <div className="sl-filters sl-mb-4">
        {[['open', 'Open'], ['overdue', 'Overdue'], ['submitted', 'Awaiting review'], ['closed', 'Closed']].map(([k, l]) => <button key={k} className={`sl-filter-chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l} ({groups[k].length})</button>)}
      </div>
      {list.length === 0 ? <Empty icon={ClipboardCheck} title="Nothing here" /> : (
        <div className="sl-table-container">
          <table className="sl-table">
            <thead><tr>{isOffice(user) && <th>Institution</th>}<th>Undertaking</th><th>Application</th><th>Due</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map(u => (
                <tr key={u.id}>
                  {isOffice(user) && <td className="sl-cursor-pointer" onClick={() => navigate(`/institutions/${u.institution_id}`)}><div className="sl-font-medium">{u.institution.name}</div><div className="sl-text-xs sl-text-muted">{u.institution.region?.code}</div></td>}
                  <td><div className="sl-font-medium sl-text-sm">{u.title}</div><div className="sl-text-xs sl-text-muted">{u.category}</div>{u.submission_note && <div className="sl-text-xs sl-mt-1">“{u.submission_note}”</div>}</td>
                  <td className="sl-text-xs sl-font-mono sl-cursor-pointer" onClick={() => u.application && navigate(`/applications/${u.application.id}?tab=undertakings`)}>{u.application?.app_number || '—'}</td>
                  <td className="sl-whitespace-nowrap">{fmtDate(u.due_date)}<div className={`sl-text-xs ${u.days_left < 0 ? 'sl-text-danger' : u.days_left <= 30 ? 'aq-tone-warning' : 'sl-text-muted'}`}>{u.days_left < 0 ? `${-u.days_left} days late` : `${u.days_left} days left`}</div></td>
                  <td><StatusBadge status={u.status} /></td>
                  <td className="sl-text-right">
                    {user.role === 'Institution' && ['Pending', 'Overdue'].includes(u.status) && <button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => setModal({ kind: 'submit', u })}>Submit proof</button>}
                    {isOffice(user) && ['Submitted', 'Overdue', 'Pending'].includes(u.status) && <button className="sl-btn sl-btn--secondary sl-btn--sm" onClick={() => setModal({ kind: 'review', u })}>Review</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal?.kind === 'submit' && <SubmitUndertakingModal undertaking={modal.u} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal?.kind === 'review' && <ReviewUndertakingModal undertaking={modal.u} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </>
  );
}
