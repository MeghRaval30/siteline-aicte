import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line, Cell } from 'recharts';
import { FileStack, AlarmClock, CalendarCheck, FileWarning, FileX, ClipboardX, Siren, Bot, Sparkles, ClipboardList, Award, ArrowRight, Zap } from 'lucide-react';
import { apiClient } from '../api/client';
import { Stat, StageBadge, SlaPill, SeverityBadge, StatusBadge, ScoreRing, GradeBadge, fmtDate, daysUntil, getUser, Loading, STAGE_SHORT } from '../components/ui';

const firstName = n => (n || '').replace(/^(Dr\.|Prof\.|Smt\.|Shri|Ar\.)\s*/, '').split(' ')[0];
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const tip = { contentStyle: { background: '#ffffff', border: '1px solid rgba(31,30,29,0.12)', boxShadow: '0 6px 20px rgba(31,30,29,0.1)', color: '#1f1e1d', borderRadius: 8, fontSize: 12 }, cursor: { fill: 'rgba(31,30,29,0.04)' } };
const axis = { stroke: '#84827c', fontSize: 11, tickLine: false, axisLine: false };

export default function Dashboard() {
  const navigate = useNavigate();
  const user = getUser();
  const [d, setD] = useState(null);
  const [insights, setInsights] = useState([]);

  useEffect(() => {
    apiClient.get('/dashboard/overview').then(setD).catch(() => setD({ error: true }));
    if (user.role !== 'Institution') apiClient.get('/ai/insights').then(x => setInsights(Array.isArray(x) ? x : [])).catch(() => {});
  }, []);

  if (!d) return <Loading />;
  if (d.error) return <div className="sl-empty"><div className="sl-empty__title">Could not load dashboard</div></div>;
  if (d.role === 'Institution') return <InstitutionHome d={d} navigate={navigate} />;
  if (d.role === 'Expert') return <ExpertHome d={d} navigate={navigate} user={user} />;

  const k = d.kpis;
  const maxHeat = Math.max(1, ...d.heatmap.flatMap(r => d.pipeline.map(p => r[p.stage])));

  return (
    <div>
      <div className="sl-page__header">
        <div>
          <h1 className="sl-page__title"><Sparkles size={26} className="aq-greeting-mark" />{greeting()}, {firstName(user.name)}</h1>
          <p className="sl-page__subtitle">{user.role === 'Admin' ? 'National approval command centre' : `${user.designation || 'Regional'} desk`}: live application movement, stage-wise pendency, EVC scheduling and compliance health</p>
        </div>
        <div className="sl-page__actions">
          <button className="sl-btn sl-btn--secondary" onClick={() => navigate('/ai-chat')}><Bot size={16} /> Ask AI</button>
          <button className="sl-btn sl-btn--primary" onClick={() => navigate('/applications?view=board')}><FileStack size={16} /> Pipeline Board</button>
        </div>
      </div>

      <div className="aq-grid-auto aq-kpis">
        <Stat icon={FileStack} label="Applications in process" value={k.active_applications} tone="accent" sub={`${k.decided_this_year} decided this year`} onClick={() => navigate('/applications?active=1')} />
        <Stat icon={AlarmClock} label="Past stage SLA" value={k.sla_breached} tone="danger" sub={`${k.active_applications ? Math.round(100 * k.sla_breached / k.active_applications) : 0}% of pipeline`} onClick={() => navigate('/applications?overdue=1')} />
        <Stat icon={CalendarCheck} label="EVC visits · next 7 days" value={k.evc_next_7_days} tone="info" sub={`${k.evc_reports_pending} reports pending`} onClick={() => navigate('/evc?filter=week')} />
        <Stat icon={FileWarning} label="Documents expiring (60d)" value={k.docs_expiring} tone="warning" onClick={() => navigate('/compliance?status=Expiring Soon')} />
        <Stat icon={FileX} label="Documents expired" value={k.docs_expired} tone="danger" onClick={() => navigate('/compliance?status=Expired')} />
        <Stat icon={ClipboardX} label="Undertakings overdue" value={k.undertakings_overdue} tone="danger" sub={`${k.undertakings_due_30} due in 30 days`} onClick={() => navigate('/compliance?tab=undertakings&filter=overdue')} />
        <Stat icon={Siren} label="Open alerts" value={k.open_alerts} tone="warning" sub={`${k.critical_alerts} critical`} onClick={() => navigate('/alerts')} />
      </div>

      {d.automation && (
        <div className="sl-card sl-mt-6 aq-automation">
          <div className="sl-card__header"><h3 className="sl-card__title"><Zap size={14} style={{ verticalAlign: -2 }} /> Automation at work</h3><span className="sl-text-xs sl-text-muted">done by the system, with no manual follow-up</span></div>
          <div className="sl-card__body aq-automation__row">
            {[
              [d.automation.alerts_raised, 'alerts raised automatically'],
              [d.automation.auto_resolved, 'alerts that closed themselves'],
              [d.automation.sla_breaches_flagged, 'SLA breaches flagged'],
              [d.automation.emails_sent, d.automation.email_mode === 'smtp' ? 'emails sent to institutions & experts' : 'emails queued for institutions & experts (simulated: no mail server)'],
              [d.automation.documents_watched, 'documents watched for expiry'],
              [d.automation.rules_active, 'monitoring rules running'],
            ].map(([n, l]) => <div key={l} className="aq-automation__item"><div className="aq-automation__n">{n}</div><div className="sl-text-xs sl-text-muted">{l}</div></div>)}
          </div>
        </div>
      )}

      <div className="aq-grid-3 sl-mt-6">
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Stage-wise pendency</h3><span className="sl-text-xs sl-text-muted">within SLA vs breached</span></div>
          <div className="sl-card__body" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.pipeline} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(31,30,29,0.07)" vertical={false} />
                <XAxis dataKey="label" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tip} formatter={(v, n) => [v, n === 'within' ? 'Within SLA' : 'SLA breached']} labelFormatter={(l, p) => p?.[0] ? `${p[0].payload.full_label} · SLA ${p[0].payload.sla_days}d · avg ${p[0].payload.avg_days}d` : l} />
                <Bar dataKey="within" stackId="a" fill="#005ea2" radius={[0, 0, 0, 0]} style={{ cursor: 'pointer' }} onClick={(_, i) => navigate(`/applications?stage=${d.pipeline[i].stage}`)} />
                <Bar dataKey="breached" stackId="a" fill="#b50909" radius={[4, 4, 0, 0]} style={{ cursor: 'pointer' }} onClick={(_, i) => navigate(`/applications?stage=${d.pipeline[i].stage}&overdue=1`)} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title"><Sparkles size={14} style={{ verticalAlign: -2 }} /> Insights</h3></div>
          <div className="sl-card__body">
            {insights.map((ins, i) => (
              <div key={i} className="aq-list-item sl-flex sl-gap-2 sl-items-center">
                <span className={`sl-badge sl-badge--${ins.type} sl-badge--dot`} style={{ whiteSpace: 'normal', textAlign: 'left' }}>{ins.message}</span>
              </div>
            ))}
            <h4 className="sl-text-sm sl-font-semibold sl-mt-4 sl-mb-2">Ageing of pending applications</h4>
            <div style={{ height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.buckets} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="label" width={74} {...axis} />
                  <Tooltip {...tip} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {d.buckets.map((b, i) => <Cell key={i} fill={['#057642', '#0a66c2', '#d99a2b', '#d9480f', '#c4141b'][i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="sl-card sl-mt-6">
        <div className="sl-card__header"><h3 className="sl-card__title">Regional pendency heatmap</h3><span className="sl-text-xs sl-text-muted">applications by Regional Office × stage</span></div>
        <div className="sl-table-container" style={{ border: 'none' }}>
          <table className="sl-table sl-table--compact aq-heat">
            <thead><tr><th>Regional Office</th>{d.pipeline.map(p => <th key={p.stage} className="sl-text-center">{p.label}</th>)}<th className="sl-text-center">Total</th><th className="sl-text-center">Past SLA</th></tr></thead>
            <tbody>
              {d.heatmap.map(r => (
                <tr key={r.region}>
                  <td><span className="sl-font-medium">{r.region}</span> <span className="sl-text-xs sl-text-muted">{r.region_name.replace(' Regional Office', '')}</span></td>
                  {d.pipeline.map(p => {
                    const v = r[p.stage];
                    return <td key={p.stage} className="aq-heat__cell" style={{ background: v ? `rgba(0,94,162,${0.1 + 0.55 * v / maxHeat})` : undefined, color: v ? undefined : 'var(--sl-text-muted)', cursor: v ? 'pointer' : undefined }}
                      onClick={() => v && navigate(`/applications?stage=${p.stage}&region=${r.region}`)}>{v || '·'}</td>;
                  })}
                  <td className="aq-heat__cell">{r.total}</td>
                  <td className="aq-heat__cell" style={{ color: r.breached ? 'var(--sl-danger)' : 'var(--sl-text-muted)' }}>{r.breached}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="aq-grid-2 sl-mt-6">
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Top alerts</h3><button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => navigate('/alerts')}>Alert Center <ArrowRight size={14} /></button></div>
          <div className="sl-card__body">
            {d.top_alerts.length === 0 ? <p className="sl-text-muted sl-text-sm">No open alerts</p> : d.top_alerts.map(a => (
              <div key={a.id} className="aq-list-item sl-cursor-pointer" onClick={() => navigate(a.entity_type === 'Application' ? `/applications/${a.entity_id}` : a.entity_type === 'Document' ? `/compliance?renew=${a.entity_id}` : a.entity_type === 'Undertaking' ? '/compliance?tab=undertakings' : a.entity_type === 'EVCVisit' ? '/evc' : '/alerts')}>
                <div className="sl-flex sl-items-center sl-gap-2"><SeverityBadge severity={a.severity} /><span className="sl-text-sm sl-font-medium">{a.title}</span></div>
                <div className="sl-text-xs sl-text-muted sl-mt-1">{a.detail}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Longest past SLA</h3><button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => navigate('/applications?overdue=1')}>All <ArrowRight size={14} /></button></div>
          <div className="sl-card__body">
            {d.longest_pending.map(a => (
              <div key={a.id} className="aq-list-item sl-flex sl-items-center sl-justify-between sl-gap-3 sl-cursor-pointer" onClick={() => navigate(`/applications/${a.id}`)}>
                <div style={{ minWidth: 0 }}>
                  <div className="sl-text-sm sl-font-medium sl-truncate">{a.institution}</div>
                  <div className="sl-text-xs sl-text-muted">{a.app_number} · {a.type}</div>
                </div>
                <div className="sl-flex sl-items-center sl-gap-3"><StageBadge stage={a.stage} /><SlaPill sla={a.sla} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="aq-grid-2 sl-mt-6">
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Throughput (last 6 months)</h3></div>
          <div className="sl-card__body" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.months} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(31,30,29,0.07)" vertical={false} />
                <XAxis dataKey="month" {...axis} /><YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="submitted" name="Submitted" stroke="#0a66c2" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="decided" name="Decided" stroke="#057642" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="breaches" name="SLA breaches" stroke="#c4141b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Compliance health</h3><span className="sl-text-xs sl-text-muted">avg score {d.compliance?.average}</span></div>
          <div className="sl-card__body">
            <div className="sl-flex sl-gap-3 sl-mb-4">
              {d.compliance?.grades.map(g => (
                <div key={g.grade} className="aq-panel sl-flex-1 sl-text-center sl-cursor-pointer" onClick={() => navigate(`/institutions?grade=${g.grade}`)}>
                  <GradeBadge grade={g.grade} /><div className="sl-text-lg sl-font-bold sl-mt-1">{g.count}</div>
                </div>
              ))}
            </div>
            {d.compliance?.worst.map(w => (
              <div key={w.id} className="aq-list-item sl-flex sl-items-center sl-justify-between sl-cursor-pointer" onClick={() => navigate(`/institutions/${w.id}`)}>
                <div><div className="sl-text-sm sl-font-medium">{w.name}</div><div className="sl-text-xs sl-text-muted">{w.reason}</div></div>
                <GradeBadge grade={w.grade} score={w.score} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExpertHome({ d, navigate, user }) {
  return (
    <div>
      <div className="sl-page__header"><div><h1 className="sl-page__title"><Sparkles size={26} className="aq-greeting-mark" />{greeting()}, {firstName(user.name)}</h1><p className="sl-page__subtitle">Your Expert Visit Committee assignments</p></div>
        <div className="sl-page__actions"><button className="sl-btn sl-btn--primary" onClick={() => navigate('/evc')}><CalendarCheck size={16} /> My Visits</button></div></div>
      <div className="aq-grid-auto">
        <Stat icon={CalendarCheck} label="Upcoming visits" value={d.upcoming_visits.filter(v => new Date(v.visit_date) >= new Date()).length} tone="info" />
        <Stat icon={ClipboardList} label="Reports to file" value={d.pending_reports?.length || 0} tone="danger" />
        <Stat icon={FileStack} label="Applications on my panels" value={d.kpis.active_applications} tone="accent" />
      </div>
      {d.pending_reports?.length > 0 && (
        <div className="sl-card sl-mt-6" style={{ borderColor: 'var(--sl-danger)' }}>
          <div className="sl-card__header"><h3 className="sl-card__title">Reports overdue</h3></div>
          <div className="sl-card__body">
            {d.pending_reports.map(v => (
              <div key={v.id} className="aq-list-item sl-flex sl-justify-between sl-items-center">
                <div><div className="sl-font-medium sl-text-sm">{v.application.institution.name}</div><div className="sl-text-xs sl-text-muted">Visited {fmtDate(v.visit_date)} · {v.application.app_number}</div></div>
                <button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => navigate(`/evc?report=${v.id}`)}>File report</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="sl-card sl-mt-6">
        <div className="sl-card__header"><h3 className="sl-card__title">Scheduled visits</h3></div>
        <div className="sl-card__body">
          {d.upcoming_visits.length === 0 ? <p className="sl-text-muted sl-text-sm">No visits scheduled</p> : d.upcoming_visits.map(v => (
            <div key={v.id} className="aq-list-item sl-flex sl-justify-between sl-items-center">
              <div><div className="sl-font-medium sl-text-sm">{v.application.institution.name}</div><div className="sl-text-xs sl-text-muted">{v.application.app_number} · {v.mode} · Panel: {v.members.map(m => m.user.name).join(', ')}</div></div>
              <span className="sl-badge sl-badge--info">{fmtDate(v.visit_date)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InstitutionHome({ d, navigate }) {
  const inst = d.institution;
  const c = inst?.compliance;
  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">{inst?.name}</h1><p className="sl-page__subtitle">AICTE ID {inst?.aicte_id} · {inst?.city}, {inst?.state} · {inst?.region?.name}</p></div>
        <div className="sl-page__actions">
          <button className="sl-btn sl-btn--secondary" onClick={() => navigate('/compliance')}>Upload / renew documents</button>
          <button className="sl-btn sl-btn--primary" onClick={() => navigate('/applications?new=1')}><FileStack size={16} /> New Application</button>
        </div>
      </div>

      <div className="aq-grid-3">
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">My applications</h3></div>
          <div className="sl-card__body">
            {d.my_applications.map(a => (
              <div key={a.id} className="aq-list-item sl-flex sl-justify-between sl-items-center sl-cursor-pointer" onClick={() => navigate(`/applications/${a.id}`)}>
                <div><div className="sl-font-medium sl-text-sm">{a.type}</div><div className="sl-text-xs sl-text-muted">{a.app_number} · submitted {fmtDate(a.submitted_at)}</div>
                  {a.docs_missing > 0 && <div className="sl-text-xs aq-tone-warning">{a.docs_missing} mandatory document(s) to upload</div>}
                  {a.docs_deficient > 0 && <div className="sl-text-xs sl-text-danger">{a.docs_deficient} document(s) marked deficient</div>}</div>
                <div className="sl-flex sl-items-center sl-gap-3"><StageBadge stage={a.stage} /><SlaPill sla={a.sla} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title"><Award size={14} style={{ verticalAlign: -2 }} /> Compliance health</h3></div>
          <div className="sl-card__body">
            <div className="aq-hero"><ScoreRing score={c.score} /><div><GradeBadge grade={c.grade} /><div className="sl-text-sm sl-mt-1">{c.risk} risk</div></div></div>
            <div className="sl-mt-4">
              {c.reasons.length === 0 ? <p className="sl-text-sm sl-text-success">No open compliance gaps.</p> : c.reasons.map((r, i) => (
                <div key={i} className="sl-flex sl-justify-between sl-text-sm aq-list-item"><span>{r.reason}</span><span className="sl-text-danger">{r.points}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {inst.open_deficiencies.length > 0 && (
        <div className="sl-card sl-mt-6" style={{ borderColor: 'var(--sl-warning)' }}>
          <div className="sl-card__header"><h3 className="sl-card__title">Deficiencies awaiting your response</h3></div>
          <div className="sl-card__body">
            {inst.open_deficiencies.map(df => (
              <div key={df.id} className="aq-list-item sl-flex sl-justify-between sl-items-center sl-gap-3">
                <div><div className="sl-text-sm"><b>{df.category}:</b> {df.description}</div><div className="sl-text-xs sl-text-muted">{df.application.app_number} · respond by {fmtDate(df.due_date)} ({daysUntil(df.due_date)} days)</div></div>
                <button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => navigate(`/applications/${df.application.id}?tab=deficiencies`)}>Respond</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="aq-grid-2 sl-mt-6">
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Documents needing renewal</h3></div>
          <div className="sl-card__body">
            {d.expiring_docs.length === 0 ? <p className="sl-text-muted sl-text-sm">All documents valid</p> : d.expiring_docs.map(doc => (
              <div key={doc.id} className="aq-list-item sl-flex sl-justify-between sl-items-center">
                <div><div className="sl-text-sm sl-font-medium">{doc.doc_type}</div><div className="sl-text-xs sl-text-muted">valid till {fmtDate(doc.valid_to)} ({daysUntil(doc.valid_to)} days)</div></div>
                <button className="sl-btn sl-btn--secondary sl-btn--sm" onClick={() => navigate(`/compliance?renew=${doc.id}`)}>Renew</button>
              </div>
            ))}
          </div>
        </div>
        <div className="sl-card">
          <div className="sl-card__header"><h3 className="sl-card__title">Undertakings due</h3></div>
          <div className="sl-card__body">
            {d.due_undertakings.length === 0 ? <p className="sl-text-muted sl-text-sm">Nothing due</p> : d.due_undertakings.map(u => (
              <div key={u.id} className="aq-list-item sl-flex sl-justify-between sl-items-center">
                <div><div className="sl-text-sm sl-font-medium">{u.title}</div><div className="sl-text-xs sl-text-muted">due {fmtDate(u.due_date)} ({daysUntil(u.due_date)} days)</div></div>
                <div className="sl-flex sl-gap-2 sl-items-center"><StatusBadge status={u.status} /><button className="sl-btn sl-btn--secondary sl-btn--sm" onClick={() => navigate('/compliance?tab=undertakings')}>Submit proof</button></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
