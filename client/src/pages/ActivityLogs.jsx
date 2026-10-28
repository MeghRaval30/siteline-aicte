import { useState, useEffect } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';

export default function ActivityLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchLogs = () => {
    setLoading(true);
    apiClient.get(`/activity-logs?page=${page}&limit=20`).then(d => {
      setLogs(Array.isArray(d) ? d : d?.logs || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchLogs(); }, [page]);

  if (loading) return <div className="sl-skeleton sl-skeleton--card" style={{height: 400}} />;

  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">Activity Logs</h1><p className="sl-page__subtitle">System-wide audit trail</p></div>
        <div className="sl-page__actions"><button className="sl-btn sl-btn--secondary" onClick={fetchLogs} id="refresh-logs"><RefreshCw size={16} /> Refresh</button></div>
      </div>
      {logs.length === 0 ? (
        <div className="sl-empty"><div className="sl-empty__icon"><Activity size={24} /></div><div className="sl-empty__title">No activity recorded</div></div>
      ) : (
        <>
          <div className="sl-timeline">
            {logs.map((log, i) => (
              <div className="sl-timeline__item" key={log.id || i}>
                <div className="sl-timeline__dot sl-timeline__dot--accent" />
                <div className="sl-timeline__content">
                  <div className="sl-timeline__title">{log.action}</div>
                  <div className="sl-text-xs sl-text-muted">
                    {log.actor?.name || 'System'} {log.entity_type ? `· ${log.entity_type}${log.entity_id ? ` #${log.entity_id}` : ''}` : ''} · {new Date(log.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="sl-pagination sl-mt-4">
            <span className="sl-pagination__info">Page {page}</span>
            <div className="sl-pagination__controls">
              <button className="sl-pagination__btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</button>
              <button className="sl-pagination__btn active">{page}</button>
              <button className="sl-pagination__btn" disabled={logs.length < 20} onClick={() => setPage(p => p + 1)}>→</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
