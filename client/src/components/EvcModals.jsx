import { useState, useEffect, useRef } from 'react';
import { Sparkles, ShieldAlert, Crown } from 'lucide-react';
import { apiClient } from '../api/client';
import { Modal, toast } from './ui';

const iso = d => new Date(d).toISOString().slice(0, 10);

// Smart panel builder: ranks experts by conflict of interest, availability,
// workload and specialisation, and pre-selects the best three.
export function ScheduleEvcModal({ application, onClose, onDone }) {
  const [date, setDate] = useState(iso(Date.now() + 10 * 86400000));
  const [mode, setMode] = useState('Physical');
  const [data, setData] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [chair, setChair] = useState(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  useEffect(() => {
    setData(null);
    apiClient.get(`/evc/suggest?application_id=${application.id}&date=${date}`).then(d => {
      setData(d);
      setChosen(d.recommended);
      setChair(d.recommended[0] || null);
    }).catch(e => toast(e.message, 'error'));
  }, [date]);

  const toggle = e => {
    if (!e.eligible) return;
    setChosen(c => c.includes(e.id) ? c.filter(x => x !== e.id) : [...c, e.id]);
  };

  const submit = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      await apiClient.post('/evc', { application_id: application.id, visit_date: date, mode, member_ids: chosen, chair_id: chair });
      toast('EVC visit scheduled; panel and institution notified');
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    inflight.current = false;
    setBusy(false);
  };

  return (
    <Modal wide title={`Schedule Expert Visit · ${application.institution?.name || ''}`} onClose={onClose}
      footer={<><span className="sl-text-xs sl-text-muted" style={{ marginRight: 'auto' }}>{chosen.length} expert(s) selected</span><button className="sl-btn sl-btn--secondary" onClick={onClose}>Cancel</button><button className="sl-btn sl-btn--primary" disabled={busy || chosen.length < 2} onClick={submit}>Schedule visit</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} className="sl-mb-4">
        <div className="sl-form-group"><label className="sl-label">Visit date</label><input className="sl-input" type="date" min={iso(Date.now())} value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="sl-form-group"><label className="sl-label">Mode</label><select className="sl-select" value={mode} onChange={e => setMode(e.target.value)}><option>Physical</option><option>Hybrid</option><option>Virtual</option></select></div>
      </div>
      <div className="aq-panel sl-mb-4 sl-text-xs sl-flex sl-gap-2 sl-items-center"><Sparkles size={14} className="sl-text-accent" />
        Ranked automatically: experts from the institution's home state ({data?.institution_state || '…'}) are blocked for conflict of interest, experts already on a visit that day are blocked, lighter workload and matching specialisation rank higher.</div>
      {!data ? <div className="sl-skeleton sl-skeleton--card" style={{ height: 200 }} /> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 340, overflowY: 'auto' }}>
          {data.experts.map(e => (
            <div key={e.id} className={`aq-expert ${chosen.includes(e.id) ? 'aq-expert--on' : ''} ${!e.eligible ? 'aq-expert--blocked' : ''}`} onClick={() => toggle(e)}>
              <input type="checkbox" checked={chosen.includes(e.id)} disabled={!e.eligible} readOnly />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sl-text-sm sl-font-medium sl-flex sl-items-center sl-gap-1">{e.name}{chair === e.id && <Crown size={12} className="sl-text-accent" />}</div>
                <div className="sl-text-xs sl-text-muted sl-truncate">{e.specialization} · {e.state}</div>
                <div className="sl-text-xs sl-mt-1" style={{ color: e.eligible ? 'var(--sl-text-secondary)' : 'var(--sl-danger)' }}>{!e.eligible && <ShieldAlert size={11} style={{ verticalAlign: -1 }} />} {e.reasons.join(' · ')}</div>
              </div>
              {chosen.includes(e.id) && chair !== e.id && <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={ev => { ev.stopPropagation(); setChair(e.id); }}>Chair</button>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function EvcReportModal({ visit, onClose, onDone }) {
  const [form, setForm] = useState({ recommendation: 'Recommended', score: 80, report: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await apiClient.patch(`/evc/${visit.id}/report`, form); toast('EVC report filed'); onDone(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title={`EVC report · ${visit.application?.institution?.name || ''}`} onClose={onClose}
      footer={<><button className="sl-btn sl-btn--secondary" onClick={onClose}>Cancel</button><button className="sl-btn sl-btn--primary" disabled={busy || !form.report} onClick={submit}>File report</button></>}>
      <div className="sl-form-group sl-mb-4"><label className="sl-label">Recommendation</label>
        <select className="sl-select" value={form.recommendation} onChange={e => setForm({ ...form, recommendation: e.target.value })}>
          <option>Recommended</option><option>Recommended with Conditions</option><option>Not Recommended</option>
        </select></div>
      <div className="sl-form-group sl-mb-4"><label className="sl-label">Infrastructure & norms score: {form.score}/100</label>
        <input type="range" min="0" max="100" value={form.score} onChange={e => setForm({ ...form, score: Number(e.target.value) })} style={{ width: '100%' }} /></div>
      <div className="sl-form-group"><label className="sl-label">Observations *</label>
        <textarea className="sl-textarea" rows={5} placeholder="Land, built-up area, labs, library, faculty verification…" value={form.report} onChange={e => setForm({ ...form, report: e.target.value })} /></div>
    </Modal>
  );
}
