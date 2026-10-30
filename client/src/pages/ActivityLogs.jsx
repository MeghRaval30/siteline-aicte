import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, RefreshCw, Download, Search, ShieldCheck } from 'lucide-react';
import { apiClient } from '../api/client';
import { downloadCsv, toast, Loading } from '../components/ui';

const ENTITY_TYPES = ['Application', 'EVCVisit', 'Document', 'Undertaking', 'Deficiency', 'Alert', 'AlertRule', 'Institution', 'Import', 'User'];
const PAGE = 25;
const when = d => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ActivityLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ search: '', entity_type: '', date_from: '', date_to: '' });

  const query = (extra = {}) => {
    const q = new URLSearchParams({ page, limit: PAGE, ...extra });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    return q;
  };
  const fetchLogs = () => { setLogs(null); apiClient.get(`/activity-logs?${query()}`).then(d => setLogs(Array.isArray(d) ? d : [])).catch(e => { toast(e.message, 'error'); setLogs([]); }); };
  useEffect(() => { fetchLogs(); }, [page, filters]);

  const setF = (k, v) => { setPage(1); setFilters(f => ({ ...f, [k]: v })); };
  const [integrity, setIntegrity] = useState(null);
  const verifyChain = async () => {
    try {
      const r = await apiClient.get('/audit/verify');
      setIntegrity(r);
      toast(r.ok ? `Audit chain intact: ${r.count} events verified` : `Audit chain broken at event ${r.broken_at}: ${r.reason}`, r.ok ? 'success' : 'error');
    } catch (e) { toast(e.message, 'error'); }
  };
  const exportCsv = async () => {
    const q = query({ page: 1, limit: 2000 });
    const rows = await apiClient.get(`/activity-logs?${q}`).catch(e => { toast(e.message, 'error'); return []; });
    if (!rows.length) return toast('Nothing to export', 'warning');
    downloadCsv(`audit-trail-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(l => ({ when: when(l.created_at), actor: l.actor?.name || 'System', role: l.actor?.role || '', action: l.action, entity: l.entity_type || '', entity_id: l.entity_id || '' })));
  };

  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">Audit Trail</h1><p className="sl-page__subtitle">Every action, by whom and when{JSON.parse(localStorage.getItem('user') || '{}').role === 'Officer' ? ' (your Regional Office)' : ''}</p></div>
        <div className="sl-page__actions">
          <button className="sl-btn sl-btn--secondary" onClick={verifyChain} title="Recompute the hash chain of the audit trail and compare it with the daily anchors"><ShieldCheck size={16} /> Verify integrity</button>
          <button className="sl-btn sl-btn--secondary" onClick={exportCsv}><Download size={16} /> CSV</button>
          <button className="sl-btn sl-btn--secondary" onClick={fetchLogs} id="refresh-logs"><RefreshCw size={16} /> Refresh</button>
        </div>
      </div>

      {integrity && (
        <div className="aq-panel sl-mb-4 sl-text-sm" style={{ borderColor: integrity.ok ? 'var(--sl-success)' : 'var(--sl-danger)' }}>
          <ShieldCheck size={14} style={{ verticalAlign: -2 }} /> {integrity.ok
            ? <>Tamper-evident chain intact: <b>{integrity.count}</b> events, {integrity.anchors} daily anchor(s). Head <span className="sl-font-mono sl-text-xs">{integrity.head?.slice(0, 16)}…</span></>
            : <>Chain broken at event <b>{integrity.broken_at}</b>: {integrity.reason}</>}
        </div>
      )}

      <div className="sl-flex sl-gap-3 sl-mb-4 sl-flex-wrap sl-items-center">
        <form onSubmit={e => { e.preventDefault(); setF('search', search.trim()); }} style={{ position: 'relative', minWidth: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11 }} className="sl-text-muted" />
          <input className="sl-input" style={{ paddingLeft: 30 }} placeholder="Search actions, e.g. APH/2026 or Revoked" value={search} onChange={e => setSearch(e.target.value)} />
        </form>
        <select className="sl-select" style={{ width: 170 }} value={filters.entity_type} onChange={e => setF('entity_type', e.target.value)} aria-label="Record type">
          <option value="">All record types</option>{ENTITY_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <label className="sl-text-xs sl-text-muted sl-flex sl-items-center sl-gap-1">From <input className="sl-input" type="date" style={{ width: 150 }} value={filters.date_from} onChange={e => setF('date_from', e.target.value)} /></label>
        <label className="sl-text-xs sl-text-muted sl-flex sl-items-center sl-gap-1">To <input className="sl-input" type="date" style={{ width: 150 }} value={filters.date_to} onChange={e => setF('date_to', e.target.value)} /></label>
        {Object.values(filters).some(Boolean) && <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => { setSearch(''); setPage(1); setFilters({ search: '', entity_type: '', date_from: '', date_to: '' }); }}>Clear filters</button>}
      </div>

      {!logs ? <Loading /> : logs.length === 0 ? (
        <div className="sl-empty"><div className="sl-empty__icon"><Activity size={24} /></div><div className="sl-empty__title">No activity matches</div></div>
      ) : (
        <>
          <div className="sl-table-container">
            <table className="sl-table sl-table--compact">
              <thead><tr><th style={{ width: 170 }}>When</th><th style={{ width: 200 }}>Who</th><th>Action</th><th style={{ width: 140 }}>Record</th></tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td className="sl-text-xs sl-whitespace-nowrap">{when(l.created_at)}</td>
                    <td className="sl-text-sm">{l.actor?.name || 'System'}{l.actor?.role && <div className="sl-text-xs sl-text-muted">{l.actor.role}</div>}</td>
                    <td className="sl-text-sm">{l.action}</td>
                    <td className="sl-text-xs">{l.entity_type === 'Application' && l.entity_id
                      ? <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => navigate(`/applications/${l.entity_id}`)}>Application #{l.entity_id}</button>
                      : l.entity_type ? `${l.entity_type}${l.entity_id ? ` #${l.entity_id}` : ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sl-pagination sl-mt-4">
            <span className="sl-pagination__info">Page {page}</span>
            <div className="sl-pagination__controls">
              <button className="sl-pagination__btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">←</button>
              <button className="sl-pagination__btn active">{page}</button>
              <button className="sl-pagination__btn" disabled={logs.length < PAGE} onClick={() => setPage(p => p + 1)} aria-label="Next page">→</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
