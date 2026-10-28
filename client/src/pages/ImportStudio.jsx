import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, FileSpreadsheet, Download, Wand2, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle, XCircle, Sparkles, Building2, Siren, RotateCcw, Scissors } from 'lucide-react';
import { apiClient } from '../api/client';
import { toast, fileToBase64, Stat } from '../components/ui';

const STEPS = ['Upload', 'Map columns', 'Review rows', 'Done'];
const ENUMS = {
  type: ['Engineering', 'Management', 'Pharmacy', 'Architecture', 'Polytechnic', 'MCA', 'HMCT'],
  ownership: ['Private Self-Financing', 'Government', 'Government-Aided', 'Deemed'],
  doc_type: ['Land Lease Deed', 'Fire Safety NOC', 'Building Completion Certificate', 'Structural Stability Certificate', 'Affiliation Letter', 'Corpus Fund FD', 'Society/Trust Registration', 'Land Use Conversion', 'Accreditation (NBA/NAAC)'],
};
const KIND_LABEL = { id: 'AICTE IDs', text: 'text', name: 'names', int: 'numbers', year: 'years', date: 'dates', state: 'Indian states', type: 'programme types', ownership: 'ownership terms', doc_type: 'document types', email: 'emails', phone: 'phone numbers' };
const ACTION_TONE = { create: 'success', update: 'info', skip: 'neutral', error: 'danger' };

async function fetchSample(name) {
  const res = await fetch(`/api/v1/import/samples/${name}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  if (!res.ok) throw new Error('Could not load sample');
  return res.blob();
}

export default function ImportStudio() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [targets, setTargets] = useState(null);
  const [samples, setSamples] = useState([]);
  const [target, setTarget] = useState('institutions');
  const [file, setFile] = useState(null);
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [mapping, setMapping] = useState({});
  const [defaults, setDefaults] = useState({});
  const [genIds, setGenIds] = useState(true);
  const [preview, setPreview] = useState(null);
  const [filter, setFilter] = useState('problems');
  const [result, setResult] = useState(null);

  useEffect(() => {
    apiClient.get('/import/targets').then(setTargets).catch(() => {});
    apiClient.get('/import/samples').then(setSamples).catch(() => {});
  }, []);

  const fields = targets?.[target]?.fields || [];
  const fieldLabel = k => fields.find(f => f.key === k)?.label || k;

  const analyze = async (f = file, t = target) => {
    if (!f) return;
    setBusy(true);
    try {
      const data = await apiClient.post('/import/analyze', { target: t, file_name: f.name, file_data: await fileToBase64(f), use_ai: useAi });
      setPlan(data);
      setMapping(Object.fromEntries(data.columns.filter(c => c.field).map(c => [c.index, c.field])));
      setDefaults({});
      setStep(1);
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const useSample = async s => {
    try {
      const blob = await fetchSample(s.name);
      const f = new File([blob], s.name, { type: blob.type });
      setTarget(s.target); setFile(f);
      await analyze(f, s.target);
    } catch (e) { toast(e.message, 'error'); }
  };
  const downloadSample = async s => {
    const blob = await fetchSample(s.name);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = s.name; a.click();
  };

  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const missing = fields.filter(f => f.required && !mapped.has(f.key));
  const body = () => ({ target, file_name: file?.name, headers: plan.headers, rows: plan.rows, mapping, defaults, options: { generate_ids: genIds } });

  const review = async () => {
    setBusy(true);
    try { setPreview(await apiClient.post('/import/preview', body())); setFilter('problems'); setStep(2); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const commit = async () => {
    setBusy(true);
    try { setResult(await apiClient.post('/import/commit', body())); setStep(3); toast('Import complete'); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const reset = () => { setStep(0); setPlan(null); setPreview(null); setResult(null); setFile(null); };

  return (
    <div>
      <div className="sl-page__header">
        <div><h1 className="sl-page__title">Import Studio</h1>
          <p className="sl-page__subtitle">Bring in registers and document lists exactly as institutions and desks keep them: messy headers, mixed dates, abbreviations and all.</p></div>
      </div>

      <div className="aq-steps sl-mb-6">
        {STEPS.map((s, i) => <div key={s} className={`aq-step ${i === step ? 'aq-step--on' : i < step ? 'aq-step--done' : ''}`}><span className="aq-step__n">{i < step ? '✓' : i + 1}</span>{s}</div>)}
      </div>

      {step === 0 && (
        <div className="aq-grid-3">
          <div className="sl-card"><div className="sl-card__body">
            <h3 className="sl-font-semibold sl-mb-2">What are you importing?</h3>
            <div className="aq-grid-2 sl-mb-4">
              {targets && Object.entries(targets).map(([k, t]) => (
                <label key={k} className={`aq-expert ${target === k ? 'aq-expert--on' : ''}`} style={{ alignItems: 'flex-start' }}>
                  <input type="radio" name="target" checked={target === k} onChange={() => setTarget(k)} style={{ marginTop: 3 }} />
                  <div><div className="sl-font-medium sl-text-sm">{t.label}</div><div className="sl-text-xs sl-text-muted">{t.description}</div></div>
                </label>
              ))}
            </div>
            <label className="aq-drop">
              <input type="file" accept=".xlsx,.csv" hidden onChange={e => { const f = e.target.files[0]; if (f) setFile(f); }} />
              <UploadCloud size={30} className="sl-text-accent" />
              <div className="sl-font-medium sl-mt-2">{file ? file.name : 'Choose an Excel (.xlsx) or CSV file'}</div>
              <div className="sl-text-xs sl-text-muted">Headers don't need to match. Title rows, notes and totals rows are found and skipped.</div>
            </label>
            <div className="sl-flex sl-items-center sl-justify-between sl-mt-4">
              <label className="sl-text-sm sl-flex sl-items-center sl-gap-2"><input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} /> Ask the local AI model as a third voter</label>
              <button className="sl-btn sl-btn--primary" disabled={!file || busy} onClick={() => analyze()}>{busy ? <><span className="sl-btn__spinner" /> Reading…</> : <>Analyse file <ArrowRight size={16} /></>}</button>
            </div>
          </div></div>
          <div className="sl-card"><div className="sl-card__header"><h3 className="sl-card__title"><Sparkles size={14} style={{ verticalAlign: -2 }} /> Try a real-world file</h3></div>
            <div className="sl-card__body">
              {samples.map(s => (
                <div key={s.name} className="aq-list-item">
                  <div className="sl-flex sl-items-center sl-gap-2"><FileSpreadsheet size={16} className="sl-text-success" /><span className="sl-font-medium sl-text-sm">{s.title}</span></div>
                  <div className="sl-text-xs sl-text-muted sl-mt-1">{s.what}</div>
                  <div className="sl-flex sl-gap-2 sl-mt-2">
                    <button className="sl-btn sl-btn--primary sl-btn--sm" disabled={busy} onClick={() => useSample(s)}>Import this</button>
                    <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => downloadSample(s)}><Download size={14} /> Open in Excel</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 1 && plan && (
        <>
          <div className="aq-panel sl-mb-4 sl-flex sl-flex-wrap sl-gap-4 sl-items-center sl-text-sm">
            <span><b>{file?.name}</b> · sheet “{plan.sheet}”</span>
            <span>Header found on line <b>{plan.header_line}</b></span>
            <span><b>{plan.rows.length}</b> data rows</span>
            {plan.dropped.length > 0 && <span title={plan.dropped.map(d => `line ${d.line}: ${d.reason}`).join('\n')}><Scissors size={13} style={{ verticalAlign: -2 }} /> {plan.dropped.length} line(s) set aside: {[...new Set(plan.dropped.map(d => d.reason))].join(', ')}</span>}
            <span className="aq-engine sl-ml-auto">voters: {plan.engine}</span>
          </div>
          <div className="sl-table-container sl-mb-4">
            <table className="sl-table">
              <thead><tr><th>Column in file</th><th>Sample values</th><th>How it was read</th><th style={{ width: 260 }}>Maps to</th></tr></thead>
              <tbody>
                {plan.columns.map(c => {
                  const cur = mapping[c.index] || '';
                  return (
                    <tr key={c.index} style={{ opacity: cur ? 1 : 0.6 }}>
                      <td><div className="sl-font-medium">{c.header}</div><div className="sl-text-xs sl-text-muted">{c.fill}% filled</div></td>
                      <td className="sl-text-xs" style={{ maxWidth: 260 }}>{c.samples.map((v, i) => <div key={i} className="sl-truncate">{String(v)}</div>)}</td>
                      <td className="sl-text-xs">
                        <div className="aq-chip-row">
                          <span className={`aq-vote ${c.votes.lexical && c.votes.lexical === cur ? 'aq-vote--win' : ''}`}>header: {c.votes.lexical ? fieldLabel(c.votes.lexical) : '—'}</span>
                          <span className={`aq-vote ${c.votes.shape && fields.find(f => f.key === cur)?.kind === c.votes.shape ? 'aq-vote--win' : ''}`}>values: {c.votes.shape ? KIND_LABEL[c.votes.shape] : '—'}</span>
                          {plan.engine.includes('+ ') && plan.engine.split(' + ').length > 2 && <span className={`aq-vote ${c.votes.model && c.votes.model === cur ? 'aq-vote--win' : ''}`}>AI: {c.votes.model ? fieldLabel(c.votes.model) : '—'}</span>}
                        </div>
                        {c.note && <div className="sl-text-muted sl-mt-1">{c.note}</div>}
                      </td>
                      <td>
                        <select className="sl-select" value={cur} onChange={e => setMapping(m => { const n = { ...m }; for (const k of Object.keys(n)) if (n[k] === e.target.value) delete n[k]; if (e.target.value) n[c.index] = e.target.value; else delete n[c.index]; return n; })}>
                          <option value="">— ignore —</option>
                          {fields.map(f => <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>)}
                        </select>
                        {cur && c.confidence > 0 && mapping[c.index] === c.field && <div className="aq-sla__bar sl-mt-1" title={`confidence ${Math.round(c.confidence * 100)}%`}><div className={`aq-sla__fill aq-sla__fill--${c.confidence >= 0.6 ? 'success' : 'warning'}`} style={{ width: `${Math.min(100, c.confidence * 100)}%` }} /></div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <div className="sl-card sl-mb-4" style={{ borderColor: 'var(--sl-warning)' }}>
              <div className="sl-card__header"><h3 className="sl-card__title"><AlertTriangle size={14} style={{ verticalAlign: -2 }} className="aq-tone-warning" /> The file has no column for {missing.length} required field{missing.length > 1 ? 's' : ''}: fill the gap for every row</h3></div>
              <div className="sl-card__body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                {missing.map(f => (
                  <div key={f.key} className="sl-form-group">
                    <label className="sl-label">{f.label}</label>
                    {f.key === 'aicte_id' && target === 'institutions' ? (
                      <label className="sl-text-sm sl-flex sl-items-center sl-gap-2"><input type="checkbox" checked={genIds} onChange={e => setGenIds(e.target.checked)} /> Generate provisional AICTE IDs (prefix 1-9…)</label>
                    ) : ENUMS[f.key] ? (
                      <select className="sl-select" value={defaults[f.key] || ''} onChange={e => setDefaults({ ...defaults, [f.key]: e.target.value })}><option value="">Choose a value for all rows…</option>{ENUMS[f.key].map(v => <option key={v}>{v}</option>)}</select>
                    ) : (
                      <input className="sl-input" placeholder="Value for all rows" value={defaults[f.key] || ''} onChange={e => setDefaults({ ...defaults, [f.key]: e.target.value })} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="sl-flex sl-justify-between">
            <button className="sl-btn sl-btn--ghost" onClick={reset}><ArrowLeft size={16} /> Different file</button>
            <button className="sl-btn sl-btn--primary" disabled={busy} onClick={review}>{busy ? <span className="sl-btn__spinner" /> : <>Clean & review rows <ArrowRight size={16} /></>}</button>
          </div>
        </>
      )}

      {step === 2 && preview && (
        <>
          <div className="aq-grid-auto sl-mb-4">
            <Stat icon={CheckCircle2} label="New records" value={preview.summary.create} tone="success" />
            <Stat icon={RotateCcw} label="Updates to existing" value={preview.summary.update} tone="info" />
            <Stat icon={Wand2} label="Values auto-fixed" value={preview.summary.fixed} tone="accent" />
            <Stat icon={AlertTriangle} label="Skipped duplicates" value={preview.summary.skip} tone="warning" />
            <Stat icon={XCircle} label="Rows with errors" value={preview.summary.error} tone="danger" />
          </div>
          <div className="sl-filters sl-mb-4">
            {[['problems', 'Needs attention'], ['fixed', 'Auto-fixed'], ['all', 'All rows']].map(([k, l]) => <button key={k} className={`sl-filter-chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
          <div className="sl-table-container sl-mb-4">
            <table className="sl-table sl-table--compact">
              <thead><tr><th>Line</th><th>Action</th><th>Record</th><th>What happened</th></tr></thead>
              <tbody>
                {preview.rows.filter(r => filter === 'all' || (filter === 'fixed' ? r.issues.some(i => i.level === 'fixed') : r.issues.some(i => i.level !== 'fixed') || r.action !== 'create')).map(r => (
                  <tr key={r.line}>
                    <td className="sl-text-xs sl-text-muted">{r.line}</td>
                    <td><span className={`sl-badge sl-badge--${ACTION_TONE[r.action]}`}>{r.action}</span></td>
                    <td className="sl-text-sm">
                      <div className="sl-font-medium">{r.values.name || r.values.doc_type || '—'}{r.values._institution && <span className="sl-text-muted"> · {r.values._institution}</span>}</div>
                      <div className="sl-text-xs sl-text-muted">{[r.values.aicte_id, r.values.type, r.values.city, r.values.state, r.values.valid_to && `valid to ${r.values.valid_to}`, r.values.lease_valid_to && `lease to ${r.values.lease_valid_to}`].filter(Boolean).join(' · ')}{r.values._existing && ` · updates “${r.values._existing}”`}</div>
                    </td>
                    <td className="sl-text-xs">{r.issues.length === 0 ? <span className="sl-text-success">clean</span> : r.issues.map((i, k) => (
                      <div key={k} className={i.level === 'error' ? 'sl-text-danger' : i.level === 'warning' ? 'aq-tone-warning' : 'sl-text-success'}>{i.level === 'fixed' ? '✓ ' : i.level === 'error' ? '✗ ' : '! '}{fieldLabel(i.field)}: {i.msg}</div>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sl-flex sl-justify-between sl-items-center">
            <button className="sl-btn sl-btn--ghost" onClick={() => setStep(1)}><ArrowLeft size={16} /> Back to mapping</button>
            <div className="sl-flex sl-items-center sl-gap-3">
              {preview.summary.error > 0 && <span className="sl-text-xs sl-text-muted">{preview.summary.error} row(s) with errors will be left out</span>}
              <button className="sl-btn sl-btn--primary" disabled={busy || preview.summary.create + preview.summary.update === 0} onClick={commit}>{busy ? <span className="sl-btn__spinner" /> : <>Import {preview.summary.create + preview.summary.update} rows</>}</button>
            </div>
          </div>
        </>
      )}

      {step === 3 && result && (
        <div className="sl-card"><div className="sl-card__body sl-text-center" style={{ padding: '40px 20px' }}>
          <CheckCircle2 size={44} className="sl-text-success" />
          <h2 className="sl-page__title sl-mt-2" style={{ fontSize: '1.5rem' }}>Import complete</h2>
          <p className="sl-text-secondary sl-mt-2">{result.created} created · {result.updated} updated · {result.documents} document records · {result.skipped} skipped · {result.failed} not imported</p>
          {result.alerts_raised > 0 && <p className="sl-mt-2"><span className="sl-badge sl-badge--warning">{result.alerts_raised} new alert(s) raised</span> from the imported validity dates{result.alerts_resolved ? `, ${result.alerts_resolved} resolved` : ''}</p>}
          <div className="sl-flex sl-gap-2 sl-justify-center sl-mt-6">
            <button className="sl-btn sl-btn--secondary" onClick={() => navigate('/institutions')}><Building2 size={16} /> Institutions</button>
            <button className="sl-btn sl-btn--secondary" onClick={() => navigate('/alerts')}><Siren size={16} /> Alert Center</button>
            <button className="sl-btn sl-btn--primary" onClick={reset}><UploadCloud size={16} /> Import another file</button>
          </div>
        </div></div>
      )}
    </div>
  );
}
