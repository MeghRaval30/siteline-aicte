import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Search, Send, Download } from 'lucide-react';
import { apiClient } from '../api/client';
import { GradeBadge, StatusBadge, Loading, Empty, toast, downloadCsv } from '../components/ui';

export default function Institutions() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [regions, setRegions] = useState([]);
  const [search, setSearch] = useState(params.get('search') || '');
  const [selected, setSelected] = useState([]);

  const load = () => {
    const q = new URLSearchParams();
    for (const k of ['grade', 'region', 'type', 'search']) if (params.get(k)) q.set(k, params.get(k));
    apiClient.get(`/institutions?${q}`).then(setRows).catch(e => toast(e.message, 'error'));
  };
  useEffect(() => { setRows(null); setSelected([]); load(); }, [params]);
  useEffect(() => { apiClient.get('/institutions/regions').then(setRegions).catch(() => {}); }, []);
  const setP = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };

  const remind = async () => {
    try {
      const r = await apiClient.post('/institutions/remind', { ids: selected });
      toast(`Digest sent to ${r.institutions} institution(s), ${r.notifications} user(s) notified${r.skipped_clean ? ` · ${r.skipped_clean} fully compliant, skipped` : ''}${r.no_portal_users ? ` · ${r.no_portal_users} have no portal users yet` : ''}`, r.institutions ? 'success' : 'warning');
      setSelected([]);
    } catch (e) { toast(e.message, 'error'); }
  };
  const toggle = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">Institutions</h1><p className="sl-page__subtitle">Ranked by Compliance Health Score: worst first, every point explained</p></div>
        <div className="sl-page__actions">
          {rows?.length > 0 && <button className="sl-btn sl-btn--secondary" onClick={() => downloadCsv('institutions-compliance.csv', rows.map(r => ({ institution: r.name, aicte_id: r.aicte_id, type: r.type, city: r.city, state: r.state, region: r.region.code, score: r.score, grade: r.grade, risk: r.risk, issues: r.top_reasons.map(x => x.reason).join('; '), open_alerts: r.open_alerts })))}><Download size={16} /> CSV</button>}
          <button className="sl-btn sl-btn--primary" disabled={!selected.length} onClick={remind}><Send size={16} /> Send reminders ({selected.length})</button>
        </div>
      </div>
      <div className="sl-flex sl-gap-3 sl-mb-4 sl-flex-wrap sl-items-center">
        <form onSubmit={e => { e.preventDefault(); setP('search', search); }} style={{ position: 'relative', minWidth: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11 }} className="sl-text-muted" />
          <input className="sl-input" style={{ paddingLeft: 30 }} placeholder="Name, AICTE ID or city" value={search} onChange={e => setSearch(e.target.value)} />
        </form>
        <select className="sl-select" style={{ width: 160 }} value={params.get('region') || ''} onChange={e => setP('region', e.target.value)}>
          <option value="">All regions</option>{regions.map(r => <option key={r.code} value={r.code}>{r.code} · {r.city}</option>)}
        </select>
        <select className="sl-select" style={{ width: 160 }} value={params.get('type') || ''} onChange={e => setP('type', e.target.value)}>
          <option value="">All types</option>{['Engineering', 'Management', 'Pharmacy', 'Architecture', 'Polytechnic', 'MCA'].map(t => <option key={t}>{t}</option>)}
        </select>
        {['A', 'B', 'C', 'D'].map(g => <button key={g} className={`sl-filter-chip ${params.get('grade') === g ? 'active' : ''}`} onClick={() => setP('grade', params.get('grade') === g ? '' : g)}>Grade {g}</button>)}
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon={Building2} title="No institutions match" /> : (
        <div className="sl-table-container">
          <table className="sl-table">
            <thead><tr><th style={{ width: 32 }}><input type="checkbox" checked={selected.length === rows.length} onChange={e => setSelected(e.target.checked ? rows.map(r => r.id) : [])} aria-label="Select all" /></th><th>Institution</th><th>Region</th><th>Score</th><th>Why</th><th>Active apps</th><th>Alerts</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="aq-row-link">
                  <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
                  <td onClick={() => navigate(`/institutions/${r.id}`)}><div className="sl-font-medium">{r.name}</div><div className="sl-text-xs sl-text-muted">{r.aicte_id} · {r.type} · {r.city}, {r.state}</div>{r.status !== 'Active' && <StatusBadge status={r.status} />}</td>
                  <td onClick={() => navigate(`/institutions/${r.id}`)} className="sl-text-sm">{r.region.code}</td>
                  <td onClick={() => navigate(`/institutions/${r.id}`)}><GradeBadge grade={r.grade} score={r.score} /></td>
                  <td onClick={() => navigate(`/institutions/${r.id}`)} className="sl-text-xs" style={{ maxWidth: 340 }}>{r.top_reasons.length ? r.top_reasons.map(x => x.reason).join(' · ') : <span className="sl-text-success">No open gaps</span>}</td>
                  <td onClick={() => navigate(`/institutions/${r.id}`)} className="sl-text-center">{r.active_applications}</td>
                  <td onClick={() => navigate(`/institutions/${r.id}`)} className="sl-text-center">{r.open_alerts ? <span className="sl-badge sl-badge--warning">{r.open_alerts}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
