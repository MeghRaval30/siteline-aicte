import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { apiClient } from '../api/client';
import { Modal, Loading, toast, getUser, fmtDate } from '../components/ui';

const LEVEL_TONE = { 1: 'warning', 2: 'danger', 3: 'danger' };
const TRACKS = [['', 'All tracks'], ['PENDENCY', 'Stage pendency'], ['EVC_REPORT', 'EVC report'], ['UNDERTAKING', 'Undertaking'], ['DOCUMENT', 'Expired document']];
const linkFor = e => ({ Application: `/applications/${e.entity_id}`, Undertaking: '/compliance?tab=undertakings', Document: '/compliance', EVCVisit: '/evc' }[e.entity_type] || '/dashboard');

function AckModal({ esc, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await apiClient.patch(`/escalations/${esc.id}/ack`, { note, promised_date: date }); toast('Escalation acknowledged'); onDone(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Acknowledge L${esc.level} escalation`} onClose={onClose} footer={<><button className="sl-btn sl-btn--secondary" onClick={onClose}>Cancel</button><button className="sl-btn sl-btn--primary" disabled={busy || note.trim().length < 5} onClick={submit}>Acknowledge</button></>}>
      <p className="sl-text-sm sl-mb-3"><b>{esc.title}</b><br /><span className="sl-text-muted">{esc.detail}</span></p>
      <label className="sl-label" htmlFor="ack-note">Action being taken</label>
      <textarea id="ack-note" className="sl-input" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Called the institution; renewed deed promised by Friday" />
      <label className="sl-label sl-mt-3" htmlFor="ack-date">Promised resolution date</label>
      <input id="ack-date" className="sl-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
      <p className="sl-text-xs sl-text-muted sl-mt-2">If an escalation is not acknowledged within its window, it moves to the next authority automatically.</p>
    </Modal>
  );
}

export default function Escalations() {
  const navigate = useNavigate();
  const user = getUser();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [track, setTrack] = useState('');
  const [ack, setAck] = useState(null);

  const load = () => {
    setRows(null);
    fetch(`/api/v1/escalations${track ? `?track=${track}` : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(r => r.json()).then(j => { setRows(j.data || []); setMeta(j.meta || null); }).catch(e => { toast(e.message, 'error'); setRows([]); });
  };
  useEffect(load, [track]);
  useEffect(() => { apiClient.get('/escalations/policies').then(setPolicies).catch(() => {}); }, []);

  const ladder = policies.reduce((m, p) => { (m[p.track] = m[p.track] || []).push(p); return m; }, {});

  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">Escalations</h1><p className="sl-page__subtitle">Overdue items climb to the next authority by themselves; silence escalates too</p></div>
        <div className="sl-page__actions">
          <select className="sl-select" style={{ width: 180 }} value={track} onChange={e => setTrack(e.target.value)} aria-label="Track">{TRACKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className="sl-btn sl-btn--secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
        </div>
      </div>

      {meta && (
        <div className="aq-grid-auto sl-mb-4">
          <div className="sl-card"><div className="sl-card__body"><div className="sl-text-xs sl-text-muted">Open escalations</div><div className="sl-stat__value" style={{ fontSize: '1.8rem' }}>{meta.open}</div></div></div>
          <div className="sl-card"><div className="sl-card__body"><div className="sl-text-xs sl-text-muted">Not yet acknowledged</div><div className="sl-stat__value" style={{ fontSize: '1.8rem' }}>{meta.unacknowledged}</div></div></div>
          <div className="sl-card"><div className="sl-card__body"><div className="sl-text-xs sl-text-muted">At Bureau level (L2)</div><div className="sl-stat__value" style={{ fontSize: '1.8rem' }}>{meta.by_level?.[2] || 0}</div></div></div>
          <div className="sl-card"><div className="sl-card__body"><div className="sl-text-xs sl-text-muted">At Member Secretary (L3)</div><div className="sl-stat__value" style={{ fontSize: '1.8rem' }}>{meta.by_level?.[3] || 0}</div></div></div>
        </div>
      )}

      <div className="sl-card sl-mb-4">
        <div className="sl-card__header"><h3 className="sl-card__title">Escalation ladder</h3><span className="sl-text-xs sl-text-muted">days overdue before each level · acknowledgement window</span></div>
        <div className="sl-card__body sl-text-sm">
          {Object.entries(ladder).map(([t, ps]) => (
            <div key={t} className="sl-mb-2"><b>{TRACKS.find(x => x[0] === t)?.[1] || t}:</b> {ps.map(p => `L${p.level} ${p.target_label} (day ${p.after_days}, ${p.ack_hours}h)`).join(' → ')}</div>
          ))}
        </div>
      </div>

      {!rows ? <Loading /> : rows.length === 0 ? (
        <div className="sl-empty"><div className="sl-empty__icon"><CheckCircle2 size={24} /></div><div className="sl-empty__title">Nothing is escalated</div></div>
      ) : (
        <div className="sl-card"><table className="sl-table">
          <thead><tr><th>Level</th><th>Item</th><th>Track</th><th>Overdue</th><th>With</th><th>Acknowledgement</th><th></th></tr></thead>
          <tbody>
            {rows.map(e => (
              <tr key={e.id}>
                <td><span className={`sl-badge sl-badge--${LEVEL_TONE[e.level] || 'neutral'}`}><ArrowUpCircle size={11} style={{ verticalAlign: -1 }} /> L{e.level}</span></td>
                <td><button type="button" className="sl-btn sl-btn--ghost sl-btn--sm" style={{ textAlign: 'left' }} onClick={() => navigate(linkFor(e))}><div className="sl-font-medium sl-text-sm">{e.title}</div></button><div className="sl-text-xs sl-text-muted">{e.detail}</div></td>
                <td className="sl-text-xs">{e.track_label}</td>
                <td className="sl-text-sm sl-text-danger">{e.days_overdue} d</td>
                <td className="sl-text-xs">{e.target_label}<div className="sl-text-muted">since {fmtDate(e.raised_at)}</div></td>
                <td className="sl-text-xs">{e.ack_at ? <><b>{e.ack_by}</b>: {e.ack_note}<div className="sl-text-muted">promised {fmtDate(e.promised_date)}</div></> : <span className="sl-text-muted">Awaiting</span>}</td>
                <td className="sl-text-right">{!e.ack_at && e.target_role === user.role && <button className="sl-btn sl-btn--primary sl-btn--sm" onClick={() => setAck(e)}>Acknowledge</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {ack && <AckModal esc={ack} onClose={() => setAck(null)} onDone={() => { setAck(null); load(); }} />}
    </div>
  );
}
