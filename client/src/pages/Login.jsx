import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { apiClient } from '../api/client';

const DEMO_CREDS = [
  { label: 'Approval Bureau (Admin)', email: 'admin@aicte.gov.in', password: 'demo1234' },
  { label: 'Regional Officer, WRO', email: 'officer@aicte.gov.in', password: 'demo1234' },
  { label: 'EVC Expert', email: 'expert@aicte.gov.in', password: 'demo1234' },
  { label: 'Institution', email: 'institute@sahyadri-it.edu.in', password: 'demo1234' },
];

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiClient.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      const { password_hash, ...userData } = data.user || data;
      localStorage.setItem('user', JSON.stringify(userData));
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const fillCreds = (cred) => {
    setEmail(cred.email);
    setPassword(cred.password);
  };

  return (
    <div className="sl-login">
      <div className="sl-login__card">
        <div className="sl-login__logo">
          <div className="sl-sidebar__logo-icon">SL</div>
          <span className="sl-sidebar__logo-text">SiteLine</span>
          <span className="sl-sidebar__logo-badge">AICTE</span>
        </div>
        <h1 className="sl-login__title">Welcome back</h1>
        <p className="sl-login__subtitle">Approval workflow, compliance monitoring & alerts for AICTE</p>

        {error && (
          <div className="sl-login__error">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <form className="sl-login__form" onSubmit={handleSubmit}>
          <div className="sl-form-group">
            <label className="sl-label" htmlFor="login-email">Email</label>
            <input id="login-email" className="sl-input" type="email" placeholder="you@aicte.gov.in" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="sl-form-group">
            <label className="sl-label" htmlFor="login-password">Password</label>
            <input id="login-password" className="sl-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button id="login-submit" className="sl-btn sl-btn--primary sl-btn--lg sl-w-full" type="submit" disabled={loading}>
            {loading ? <span className="sl-btn__spinner" /> : 'Sign in'}
          </button>
        </form>

        <div className="sl-login__demo">
          <div className="sl-login__demo-label">Demo Accounts</div>
          <div className="sl-login__demo-creds">
            {DEMO_CREDS.map(c => (
              <div key={c.email} className="sl-login__demo-cred" onClick={() => fillCreds(c)}>
                <span>{c.label}</span>
                <code>{c.email}</code>
              </div>
            ))}
          </div>
        </div>
        <p className="sl-text-xs sl-text-muted sl-text-center sl-mt-4">Built by Team Zenkai · Pandit Deendayal Energy University · SIH 2026</p>
      </div>
    </div>
  );
}
