import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Upload } from 'lucide-react';
import { apiClient } from '../api/client';
import { StageBadge, SlaPill, StatusBadge, ScoreRing, GradeBadge, SeverityBadge, Loading, toast, fmtDate, daysUntil } from '../components/ui';
import { UploadDocModal } from '../components/ComplianceModals';

export default function InstitutionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [inst, setInst] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [modal, setModal] = useState(false);
  const load = () => {
    apiClient.get(`/institutions/${id}`).then(setInst).catch(e => { toast(e.message, 'error'); navigate('/institutions'); });
    apiClient.get(`/alerts?institution_id=${id}&status=Open,Acknowledged`).then(setAlerts).catch(() => {});
  };
  useEffect(() => { load(); }, [id]);
  if (!inst) return <Loading />;
  const c = inst.compliance;
  const remind = async () => {
    try { await apiClient.post('/institutions/remind', { ids: [inst.id] }); toast('Compliance digest sent to the institution'); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <button className="sl-btn sl-btn--ghost sl-btn--sm sl-mb-2" onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">{inst.name}</h1>
          <p className="sl-page__subtitle">{inst.aicte_id} · {inst.type} · {inst.ownership} · {inst.city}, {inst.state} · {inst.region.name} · est. {inst.established_year} · intake {inst.approved_intake}</p></div>
        <div className="sl-page__actions">
          <button className="sl-btn sl-btn--secondary" onClick={() => setModal(true)}><Upload size={16} /> Add document</button>
          <button className="sl-btn sl-btn--primary" onClick={remind}><Send size={16} /> Send compliance digest</button>
        </div>
      </div>

      <div className="aq-grid-3">
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Applications</h3></div>
          <div className="sl-card__body">
            {inst.applications.length === 0 ? <p className="sl-text-muted sl-text-sm">None</p> : inst.applications.map(a => (
              <div key={a.id} className="aq-list-item sl-flex sl-justify-between sl-items-center sl-cursor-pointer" onClick={() => navigate(`/applications/${a.id}`)}>
                <div><div className="sl-text-sm sl-font-medium">{a.type}</div><div className="sl-text-xs sl-text-muted">{a.app_number} · AY {a.academic_year}</div></div>
                <div className="sl-flex sl-gap-3 sl-items-center"><StageBadge stage={a.stage} /><SlaPill sla={a.sla} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Compliance Health Score</h3></div>
          <div className="sl-card__body">
            <div className="aq-hero"><ScoreRing score={c.score} /><div><GradeBadge grade={c.grade} /><div className="sl-text-sm sl-mt-1">{c.risk} risk</div><StatusBadge status={inst.status} /></div></div>
            <div className="sl-mt-4">{c.reasons.length === 0 ? <p className="sl-text-sm sl-text-success">No deductions: fully compliant.</p> : c.reasons.map((r, i) => (
              <div key={i} className="aq-list-item sl-flex sl-justify-between sl-text-sm"><span>{r.reason}</span><span className="sl-text-danger sl-font-semibold">{r.points}</span></div>
            ))}</div>
          </div>
        </div>
      </div>

      <div className="aq-grid-2 sl-mt-6">
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Documents</h3></div>
          <div className="sl-card__body">
            {inst.documents.map(d => (
              <div key={d.id} className="aq-list-item sl-flex sl-justify-between sl-items-center">
                <div><div className="sl-text-sm sl-font-medium">{d.doc_type}</div><div className="sl-text-xs sl-text-muted">{d.doc_number} · {d.valid_to ? `till ${fmtDate(d.valid_to)} (${daysUntil(d.valid_to)}d)` : 'Permanent'}</div></div>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </div>
        </div>
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Undertakings & alerts</h3></div>
          <div className="sl-card__body">
            {inst.undertakings.map(u => (
              <div key={u.id} className="aq-list-item sl-flex sl-justify-between sl-items-center">
                <div><div className="sl-text-sm sl-font-medium">{u.title}</div><div className="sl-text-xs sl-text-muted">due {fmtDate(u.due_date)}</div></div><StatusBadge status={u.status} />
              </div>
            ))}
            {alerts.map(a => (
              <div key={a.id} className="aq-list-item"><div className="sl-flex sl-gap-2 sl-items-center"><SeverityBadge severity={a.severity} /><span className="sl-text-sm">{a.title}</span></div></div>
            ))}
            {inst.undertakings.length === 0 && alerts.length === 0 && <p className="sl-text-muted sl-text-sm">Nothing open</p>}
          </div>
        </div>
      </div>
      {modal && <UploadDocModal institutionId={inst.id} onClose={() => setModal(false)} onDone={() => { setModal(false); load(); }} />}
    </div>
  );
}
