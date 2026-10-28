import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { Download, FileBarChart } from 'lucide-react';
import { apiClient } from '../api/client';
import { Loading, downloadCsv, fmtDate, toast } from '../components/ui';

const tip = { contentStyle: { background: '#ffffff', border: '1px solid rgba(31,30,29,0.12)', boxShadow: '0 6px 20px rgba(31,30,29,0.1)', color: '#1f1e1d', borderRadius: 8, fontSize: 12 } };
const axis = { stroke: '#84827c', fontSize: 11, tickLine: false, axisLine: false };

export default function Reports() {
  const [d, setD] = useState(null);
  useEffect(() => { apiClient.get('/dashboard/overview').then(setD).catch(e => toast(e.message, 'error')); }, []);
  if (!d) return <Loading />;

  const exportPendency = async () => {
    const apps = await apiClient.get('/applications?active=1&limit=500');
    downloadCsv(`stagewise-pendency-${new Date().toISOString().slice(0, 10)}.csv`, apps.map(a => ({
      application: a.app_number, institution: a.institution.name, region: a.institution.region.code, state: a.institution.state, type: a.type, stage: a.stage_label,
      days_in_stage: a.sla.days, sla_days: a.sla.sla_days, days_over_sla: a.sla.breached ? a.sla.days - a.sla.sla_days : 0, officer: a.assigned_officer?.name || '', submitted: fmtDate(a.submitted_at),
    })));
  };
  const exportCompliance = async () => {
    const rows = await apiClient.get('/institutions');
    downloadCsv(`compliance-health-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(r => ({ institution: r.name, aicte_id: r.aicte_id, region: r.region.code, state: r.state, type: r.type, score: r.score, grade: r.grade, risk: r.risk, issues: r.top_reasons.map(x => x.reason).join('; ') })));
  };
  const exportUndertakings = async () => {
    const rows = await apiClient.get('/compliance/undertakings');
    downloadCsv('undertakings.csv', rows.map(u => ({ institution: u.institution.name, region: u.institution.region?.code, undertaking: u.title, category: u.category, application: u.application?.app_number || '', due: fmtDate(u.due_date), days_left: u.days_left, status: u.status })));
  };
  const exportDocs = async () => {
    const rows = await apiClient.get('/compliance/documents?status=Expiring Soon,Expired');
    downloadCsv('document-validity-exceptions.csv', rows.map(x => ({ institution: x.institution.name, region: x.institution.region?.code, document: x.doc_type, number: x.doc_number, valid_to: fmtDate(x.valid_to), days_left: x.days_left, status: x.status })));
  };

  const REPORTS = [
    ['Stage-wise pendency register', 'Every in-process application with days in stage, SLA and overrun', exportPendency],
    ['Compliance health register', 'All institutions with score, grade and reasons', exportCompliance],
    ['Undertakings register', 'All time-bound undertakings and their status', exportUndertakings],
    ['Document validity exceptions', 'Expiring and expired prescribed documents', exportDocs],
  ];

  return (
    <div>
      <div className="sl-page__header"><div><h1 className="sl-page__title">Reports</h1><p className="sl-page__subtitle">Exportable registers for review meetings and MIS</p></div></div>
      <div className="aq-grid-2 sl-mb-6">
        {REPORTS.map(([t, s, fn]) => (
          <div key={t} className="sl-card"><div className="sl-card__body sl-flex sl-items-center sl-justify-between sl-gap-4">
            <div className="sl-flex sl-gap-3 sl-items-center"><FileBarChart size={22} className="sl-text-accent" /><div><div className="sl-font-semibold">{t}</div><div className="sl-text-xs sl-text-muted">{s}</div></div></div>
            <button className="sl-btn sl-btn--secondary" onClick={fn}><Download size={14} /> CSV</button>
          </div></div>
        ))}
      </div>
      <div className="aq-grid-2">
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Stage SLA adherence (last 6 months)</h3></div>
          <div className="sl-card__body" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.adherence} margin={{ left: -18, right: 8, top: 8 }}>
                <CartesianGrid stroke="rgba(31,30,29,0.07)" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis domain={[0, 100]} unit="%" {...axis} />
                <Tooltip {...tip} formatter={(v, n, p) => [`${v}% on time · avg ${p.payload.avg_days}d over ${p.payload.hops} hops`, 'Adherence']} />
                <Bar dataKey="on_time" radius={[4, 4, 0, 0]}>{d.adherence.map((a, i) => <Cell key={i} fill={a.on_time >= 80 ? '#057642' : a.on_time >= 60 ? '#d99a2b' : '#c4141b'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Decisions this cycle</h3></div>
          <div className="sl-card__body" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={d.outcomes} dataKey="count" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>{d.outcomes.map(o => <Cell key={o.stage} fill={o.color} />)}</Pie>
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
