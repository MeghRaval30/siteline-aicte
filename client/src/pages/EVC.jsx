import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, ClipboardEdit, AlertTriangle, Clock } from 'lucide-react';
import { apiClient } from '../api/client';
import { StatusBadge, Loading, Empty, Stat, toast, getUser, isOffice, fmtDate, daysUntil } from '../components/ui';
import { ScheduleEvcModal, EvcReportModal } from '../components/EvcModals';

export default function EVC() {
  const navigate = useNavigate();
  const user = getUser();
  const [params, setParams] = useSearchParams();
  const [visits, setVisits] = useState(null);
  const [awaiting, setAwaiting] = useState([]);
  const [filter, setFilter] = useState(params.get('filter') === 'week' ? 'week' : 'upcoming');
  const [modal, setModal] = useState(null);

  const load = () => {
    apiClient.get('/evc').then(v => {
      setVisits(v);
      const rid = params.get('report');
      if (rid) { const hit = v.find(x => x.id === Number(rid)); if (hit) setModal({ kind: 'report', visit: hit }); }
    }).catch(e => toast(e.message, 'error'));
    if (isOffice(user)) apiClient.get('/applications?stage=EVC&limit=200').then(apps => setAwaiting(apps)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  if (!visits) return <Loading />;
  const now = new Date();
  const upcoming = visits.filter(v => v.status === 'Scheduled' && new Date(v.visit_date) >= new Date(now.toDateString()));
  const overdue = visits.filter(v => v.status === 'Scheduled' && new Date(v.visit_date) < new Date(now.toDateString()));
  const completed = visits.filter(v => v.status === 'Completed').reverse();
  const unscheduled = awaiting.filter(a => !visits.some(v => v.application_id === a.id && ['Scheduled', 'Completed'].includes(v.status)));
  const week = upcoming.filter(v => new Date(v.visit_date) <= new Date(Date.now() + 7 * 86400000));
  const list = { upcoming, week, overdue, completed, all: [...visits].reverse() }[filter];
  const done = () => { setModal(null); setParams({}); load(); };

  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">{user.role === 'Expert' ? 'My EVC Visits' : 'Expert Visit Committee Schedule'}</h1>
          <p className="sl-page__subtitle">Conflict-free panel scheduling, visit tracking and report filing</p></div>
      </div>

      <div className="aq-grid-auto sl-mb-6">
        <Stat icon={CalendarCheck} label="Upcoming visits" value={upcoming.length} tone="info" onClick={() => setFilter('upcoming')} />
        <Stat icon={AlertTriangle} label="Reports overdue" value={overdue.length} tone="danger" onClick={() => setFilter('overdue')} />
        <Stat icon={ClipboardEdit} label="Reports filed" value={completed.length} tone="success" onClick={() => setFilter('completed')} />
        {isOffice(user) && <Stat icon={Clock} label="At EVC, not yet scheduled" value={unscheduled.length} tone="warning" />}
      </div>

      {isOffice(user) && unscheduled.length > 0 && (
        <div className="sl-card sl-mb-6" style={{ borderColor: 'var(--sl-warning)' }}>
          <div className="sl-card__header"><h3 className="sl-card__title">Awaiting an EVC panel</h3></div>
          <div className="sl-card__body">
            {unscheduled.map(a => (
              <div key={a.id} className="aq-list-item sl-flex sl-justify-between sl-items-center">
                <div><div className="sl-font-medium sl-text-sm">{a.institution.name}</div><div className="sl-text-xs sl-text-muted">{a.app_number} · {a.type} · {a.institution.state} · in EVC stage {a.sla.days} days</div></div>
                <button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => setModal({ kind: 'schedule', app: a })}><CalendarPlus size={14} /> Build panel</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sl-filters sl-mb-4">
        {[['week', 'Next 7 days'], ['upcoming', 'Upcoming'], ['overdue', 'Report overdue'], ['completed', 'Completed'], ['all', 'All']].map(([k, l]) => (
          <button key={k} className={`sl-filter-chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {list.length === 0 ? <Empty icon={CalendarCheck} title="No visits here" /> : (
        <div className="sl-table-container">
          <table className="sl-table">
            <thead><tr><th>Date</th><th>Institution</th><th>Panel</th><th>Status</th><th>Outcome</th><th></th></tr></thead>
            <tbody>
              {list.map(v => {
                const d = daysUntil(v.visit_date);
                const mine = v.members.some(m => m.user.id === user.id);
                return (
                  <tr key={v.id}>
                    <td className="sl-whitespace-nowrap"><div className="sl-font-medium">{fmtDate(v.visit_date)}</div><div className={`sl-text-xs ${v.status === 'Scheduled' && d < 0 ? 'sl-text-danger' : 'sl-text-muted'}`}>{v.status === 'Scheduled' ? (d >= 0 ? `in ${d} day${d === 1 ? '' : 's'}` : `${-d} days ago`) : v.mode}</div></td>
                    <td className="sl-cursor-pointer" onClick={() => navigate(`/applications/${v.application_id}?tab=evc`)}><div className="sl-font-medium">{v.application.institution.name}</div><div className="sl-text-xs sl-text-muted">{v.application.app_number} · {v.application.institution.city}, {v.application.institution.state}</div></td>
                    <td className="sl-text-xs">{v.members.map(m => <div key={m.user.id}>{m.user.name}{m.is_chair ? ' ★' : ''} <span className="sl-text-muted">({m.user.state})</span></div>)}</td>
                    <td><StatusBadge status={v.status === 'Scheduled' && d < 0 ? 'Overdue' : v.status} /></td>
                    <td>{v.recommendation ? <span className={`sl-badge sl-badge--${v.recommendation === 'Recommended' ? 'success' : v.recommendation === 'Not Recommended' ? 'danger' : 'warning'}`}>{v.recommendation}</span> : '—'}{v.score != null && <div className="sl-text-xs sl-text-muted">score {v.score}</div>}</td>
                    <td className="sl-text-right">{v.status === 'Scheduled' && (mine || isOffice(user)) && <button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => setModal({ kind: 'report', visit: v })}><ClipboardEdit size={14} /> Report</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === 'schedule' && <ScheduleEvcModal application={modal.app} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'report' && <EvcReportModal visit={modal.visit} onClose={() => { setModal(null); setParams({}); }} onDone={done} />}
    </div>
  );
}
