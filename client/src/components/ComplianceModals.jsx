import { useState, useEffect } from 'react';
import { Upload } from 'lucide-react';
import { apiClient } from '../api/client';
import { Modal, toast, fileToBase64, getUser, isOffice, fmtDate } from './ui';

export function UploadDocModal({ renewOf, institutionId, onClose, onDone }) {
  const user = getUser();
  const [types, setTypes] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    doc_type: renewOf?.doc_type || 'Land Lease Deed', doc_number: '', issued_by: renewOf?.issued_by || '',
    valid_from: new Date().toISOString().slice(0, 10), valid_to: '', institution_id: renewOf?.institution_id || institutionId || '',
  });
  useEffect(() => {
    apiClient.get('/compliance/doc-types').then(setTypes).catch(() => {});
    if (isOffice(user) && !renewOf && !institutionId) apiClient.get('/institutions').then(setInstitutions).catch(() => {});
  }, []);
  const f = (k, v) => setForm({ ...form, [k]: v });
  const submit = async () => {
    setBusy(true);
    try {
      const body = { ...form, renewal_of_id: renewOf?.id };
      if (file) { body.file_name = file.name; body.file_data = await fileToBase64(file); }
      await apiClient.post('/compliance/documents', body);
      toast(renewOf ? 'Renewal uploaded; sent to the Regional Office for verification' : 'Document uploaded for verification');
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title={renewOf ? `Renew ${renewOf.doc_type}` : 'Upload compliance document'} onClose={onClose}
      footer={<><button className="sl-btn sl-btn--secondary" onClick={onClose}>Cancel</button><button className="sl-btn sl-btn--primary" disabled={busy || !form.doc_type} onClick={submit}><Upload size={14} /> Upload</button></>}>
      {renewOf && <div className="aq-panel sl-mb-4 sl-text-xs">Current document {renewOf.doc_number || ''} is valid till <b>{fmtDate(renewOf.valid_to)}</b>. Once the renewal is verified, the old record is superseded and its alerts close automatically.</div>}
      {institutions.length > 0 && (
        <div className="sl-form-group sl-mb-4"><label className="sl-label">Institution</label>
          <select className="sl-select" value={form.institution_id} onChange={e => f('institution_id', e.target.value)}><option value="">Select…</option>{institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} className="sl-mb-4">
        <div className="sl-form-group"><label className="sl-label">Document type</label>
          <select className="sl-select" value={form.doc_type} disabled={!!renewOf} onChange={e => f('doc_type', e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select></div>
        <div className="sl-form-group"><label className="sl-label">Document / registration no.</label><input className="sl-input" value={form.doc_number} onChange={e => f('doc_number', e.target.value)} /></div>
        <div className="sl-form-group"><label className="sl-label">Issued by</label><input className="sl-input" value={form.issued_by} onChange={e => f('issued_by', e.target.value)} /></div>
        <div className="sl-form-group"><label className="sl-label">Valid from</label><input className="sl-input" type="date" value={form.valid_from} onChange={e => f('valid_from', e.target.value)} /></div>
        <div className="sl-form-group"><label className="sl-label">Valid to (blank = permanent)</label><input className="sl-input" type="date" value={form.valid_to} onChange={e => f('valid_to', e.target.value)} /></div>
        <div className="sl-form-group"><label className="sl-label">File (PDF/image)</label><input className="sl-input" type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files[0])} /></div>
      </div>
    </Modal>
  );
}

export function SubmitUndertakingModal({ undertaking, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await apiClient.patch(`/compliance/undertakings/${undertaking.id}/submit`, { submission_note: note }); toast('Compliance submitted for verification'); onDone(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title="Submit compliance evidence" onClose={onClose} footer={<><button className="sl-btn sl-btn--secondary" onClick={onClose}>Cancel</button><button className="sl-btn sl-btn--primary" disabled={busy || !note} onClick={submit}>Submit</button></>}>
      <div className="aq-panel sl-mb-4"><div className="sl-font-medium sl-text-sm">{undertaking.title}</div><div className="sl-text-xs sl-text-muted">Due {fmtDate(undertaking.due_date)}</div></div>
      <div className="sl-form-group"><label className="sl-label">What was done, with document references *</label>
        <textarea className="sl-textarea" rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Six faculty appointed (order nos. …); appointment letters uploaded." /></div>
    </Modal>
  );
}

export function ReviewUndertakingModal({ undertaking, onClose, onDone }) {
  const [decision, setDecision] = useState('Verified');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await apiClient.patch(`/compliance/undertakings/${undertaking.id}/review`, { decision, note }); toast(`Undertaking marked ${decision}`); onDone(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title="Review undertaking" onClose={onClose} footer={<><button className="sl-btn sl-btn--secondary" onClick={onClose}>Cancel</button><button className={`sl-btn ${decision === 'Breached' ? 'sl-btn--danger' : 'sl-btn--primary'}`} disabled={busy} onClick={submit}>Confirm</button></>}>
      <div className="aq-panel sl-mb-4"><div className="sl-font-medium sl-text-sm">{undertaking.title}</div><div className="sl-text-xs sl-text-muted">{undertaking.institution?.name} · due {fmtDate(undertaking.due_date)}</div>
        {undertaking.submission_note && <div className="sl-text-sm sl-mt-2">Institution says: “{undertaking.submission_note}”</div>}</div>
      <div className="sl-form-group sl-mb-4"><label className="sl-label">Decision</label>
        <select className="sl-select" value={decision} onChange={e => setDecision(e.target.value)}>
          <option value="Verified">Verified — condition met</option><option value="Pending">Send back — not sufficient</option><option value="Waived">Waived</option><option value="Breached">Breached — initiate show-cause</option>
        </select></div>
      <div className="sl-form-group"><label className="sl-label">Note</label><textarea className="sl-textarea" rows={3} value={note} onChange={e => setNote(e.target.value)} /></div>
    </Modal>
  );
}
