import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function Login({ onLogin, initialError }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/login', { username, password });
      onLogin();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page">
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand">Sales Analytics CRM</div>
      <h1>Sign in</h1>
      <p className="muted">Use your CRM account to continue.</p>
      {error && <div className="alert error" role="alert">{error}</div>}
      <label className="login-field">Username
        <input autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className="login-field">Password
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button className="btn primary login-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </main>;
}

export default function AuthGate({ children }) {
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/api/auth/session')
      .then((session) => active && setStatus(session.authenticated ? 'authenticated' : 'signed-out'))
      .catch((e) => {
        if (active) {
          setError(e.message);
          setStatus('signed-out');
        }
      });
    const onExpired = () => setStatus('signed-out');
    window.addEventListener('auth-required', onExpired);
    return () => {
      active = false;
      window.removeEventListener('auth-required', onExpired);
    };
  }, []);

  if (status === 'checking') return <div className="loading">Checking sign-in…</div>;
  if (status !== 'authenticated') return <Login initialError={error} onLogin={() => { setError(''); setStatus('authenticated'); }} />;

  const logout = async () => {
    await api.post('/api/auth/logout');
    setStatus('signed-out');
  };
  return <AuthContext.Provider value={{ logout }}>{children}</AuthContext.Provider>;
}
