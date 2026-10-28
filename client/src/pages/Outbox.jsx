import { useState, useEffect } from 'react';
import { Mail, Search, Info } from 'lucide-react';
import { apiClient } from '../api/client';
import { Loading, Empty, StatusBadge, toast, fmtDateTime } from '../components/ui';

export default function Outbox() {
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const load = (q = '') => { setRows(null); apiClient.get(`/outbox${q ? `?search=${encodeURIComponent(q)}` : ''}`).then(setRows).catch(e => { toast(e.message, 'error'); setRows([]); }); };
  useEffect(() => { load(); }, []);
  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">Outbox</h1><p className="sl-page__subtitle">Every email sent to institutions and experts, generated from alerts, reminders and workflow events</p></div>
      </div>
      <div className="aq-panel sl-mb-4 sl-text-xs sl-flex sl-gap-2 sl-items-center"><Info size={14} className="sl-text-accent" />No mail server is configured in this prototype, so messages are marked <b>Simulated</b> and recorded here exactly as they would be sent. Set SMTP_URL to deliver them for real.</div>
      <form className="sl-mb-4" onSubmit={e => { e.preventDefault(); load(search.trim()); }} style={{ position: 'relative', maxWidth: 360 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 11 }} className="sl-text-muted" />
        <input className="sl-input" style={{ paddingLeft: 30 }} placeholder="Recipient, email or subject" value={search} onChange={e => setSearch(e.target.value)} />
      </form>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon={Mail} title="No messages yet" /> : (
        <div className="sl-table-container">
          <table className="sl-table sl-table--compact">
            <thead><tr><th style={{ width: 150 }}>When</th><th style={{ width: 230 }}>To</th><th>Subject</th><th style={{ width: 110 }}>Status</th></tr></thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id} className="aq-row-link" tabIndex={0} onClick={() => setOpen(open === m.id ? null : m.id)} onKeyDown={e => e.key === 'Enter' && setOpen(open === m.id ? null : m.id)}>
                  <td className="sl-text-xs sl-whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                  <td className="sl-text-sm">{m.to_name}<div className="sl-text-xs sl-text-muted">{m.to_email}</div></td>
                  <td className="sl-text-sm">{m.subject}{open === m.id && <pre className="aq-panel sl-mt-2 sl-text-xs" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{m.body}</pre>}</td>
                  <td><StatusBadge status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
