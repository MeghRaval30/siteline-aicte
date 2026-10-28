import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ShieldCheck, ShieldX, Search } from 'lucide-react';
import { fmtDate, StatusBadge } from '../components/ui';

// Public page: anyone (a student, a parent, a bank) can check an approval letter is genuine.
export default function Verify() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(code || '');
  const [r, setR] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    fetch(`/api/v1/applications/verify/${encodeURIComponent(code)}`).then(x => x.json()).then(x => setR(x.data)).catch(() => setR({ valid: false })).finally(() => setLoading(false));
  }, [code]);

  return (
    <div className="sl-login">
      <div className="sl-login__card" style={{ maxWidth: 520 }}>
        <div className="sl-login__logo"><div className="sl-sidebar__logo-icon">SL</div><span className="sl-sidebar__logo-text">SiteLine</span><span className="sl-sidebar__logo-badge">AICTE</span></div>
        <h1 className="sl-login__title">Verify an approval letter</h1>
        <p className="sl-login__subtitle">Enter the verification code printed on the LoA / LoR, or scan its QR code</p>
        <form className="sl-flex sl-gap-2 sl-mb-4" onSubmit={e => { e.preventDefault(); if (input) navigate(`/verify/${input.trim().toUpperCase()}`); }}>
          <input className="sl-input" value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. 3FA9C10B2E" />
          <button className="sl-btn sl-btn--primary"><Search size={14} /> Verify</button>
        </form>
        {loading && <div className="sl-skeleton sl-skeleton--card" style={{ height: 120 }} />}
        {r && !loading && (r.valid ? (
          <div className="aq-panel" style={{ borderColor: r.revoked ? 'var(--sl-danger)' : 'var(--sl-success)' }}>
            {r.revoked
              ? <div className="sl-mb-2 sl-text-danger sl-font-semibold"><ShieldX size={18} style={{ verticalAlign: -3 }} /> This letter was REVOKED on {fmtDate(r.revoked_at)}<div className="sl-text-sm sl-font-medium sl-mt-1">Reason: {r.revoke_reason}</div></div>
              : <div className="sl-flex sl-items-center sl-gap-2 sl-mb-2 sl-text-success sl-font-semibold"><ShieldCheck size={18} /> Genuine record found</div>}
            {!r.revoked && r.institution_status && r.institution_status !== 'Active' && <div className="sl-text-sm aq-tone-warning sl-mb-2">Note: the institution is currently <b>{r.institution_status}</b>.</div>}
            <dl className="aq-kv">
              <dt>Institution</dt><dd>{r.institution.name}</dd>
              <dt>AICTE ID</dt><dd>{r.institution.aicte_id}</dd>
              <dt>Location</dt><dd>{r.institution.city}, {r.institution.state}</dd>
              <dt>Application</dt><dd>{r.app_number} · {r.type}</dd>
              <dt>Academic year</dt><dd>{r.academic_year}</dd>
              <dt>Decision</dt><dd><StatusBadge status={r.status} /> on {fmtDate(r.decided_at)}</dd>
              {r.undertakings.length > 0 && <><dt>Conditions</dt><dd>{r.undertakings.map((u, i) => <div key={i} className="sl-text-xs">{u.title} (due {fmtDate(u.due_date)}) — <b>{u.status}</b></div>)}</dd></>}
            </dl>
          </div>
        ) : (
          <div className="aq-panel sl-flex sl-items-center sl-gap-2" style={{ borderColor: 'var(--sl-danger)' }}><ShieldX size={18} className="sl-text-danger" /> No letter with this code exists. The document may be forged.</div>
        ))}
        <p className="sl-text-xs sl-text-muted sl-mt-4 sl-text-center"><a className="sl-text-accent" href="/login">Staff / institution sign-in</a></p>
      </div>
    </div>
  );
}
