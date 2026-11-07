import React, { useState } from 'react';
import { loginUser, type User } from '../services/api';
import { errorMessage } from '../utils/errors';
import { Waitlist } from './Waitlist';

interface LoginProps {
  onLoginSuccess: (token: string, user: User) => void;
}

type Mode = 'signin' | 'waitlist';

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  // /login#waitlist opens the waiting list directly, so other pages can link to it.
  const [mode, setModeState] = useState<Mode>(() => (window.location.hash === '#waitlist' ? 'waitlist' : 'signin'));
  const setMode = (next: Mode) => {
    setModeState(next);
    window.history.replaceState(null, '', next === 'waitlist' ? '#waitlist' : window.location.pathname);
  };
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username/email and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await loginUser(username, password);
      onLoginSuccess(data.token, data.user);
    } catch (err) {
      setError(errorMessage(err, 'An unexpected error occurred during login.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className={`login-card${mode === 'waitlist' ? ' is-waitlist' : ''}`}>
        {/* Header Branding */}
        <div className="login-header">
          <div className="brand-badge">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h1>{mode === 'signin' ? 'Welcome Back' : 'Join the waiting list'}</h1>
          <p>{mode === 'signin'
            ? 'Sign in to manage your connected Instagram accounts'
            : 'Tell us what you will manage and we will contact you when your studio is ready'}</p>
        </div>

        <div className="login-tabs" role="tablist" aria-label="Sign in or join the waiting list">
          <button type="button" role="tab" id="tab-signin" aria-selected={mode === 'signin'} aria-controls="panel-signin" onClick={() => setMode('signin')}>Sign in</button>
          <button type="button" role="tab" id="tab-waitlist" aria-selected={mode === 'waitlist'} aria-controls="panel-waitlist" onClick={() => setMode('waitlist')}>Join the waiting list</button>
        </div>

        {mode === 'waitlist' ? (
          <div role="tabpanel" id="panel-waitlist" aria-labelledby="tab-waitlist">
            <Waitlist onBackToSignIn={() => setMode('signin')} />
          </div>
        ) : (
        <div role="tabpanel" id="panel-signin" aria-labelledby="tab-signin">
        {/* Error Alert */}
        {error && (
          <div className="error-alert" role="alert">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Username or Email</label>
            <div className="input-wrapper">
              <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username or email"
                required
                autoComplete="username"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="input-wrapper">
              <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="form-options">
            <label className="checkbox-container">
              <input type="checkbox" defaultChecked />
              <span className="checkmark"></span>
              Remember me
            </label>
            <a href="#forgot" onClick={(e) => { e.preventDefault(); alert('Password reset is available by contacting your administrator.'); }} className="forgot-link">
              Forgot password?
            </a>
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? (
              <span className="spinner-wrapper">
                <span className="spinner"></span> Authenticating...
              </span>
            ) : (
              <span>Sign In to Dashboard →</span>
            )}
          </button>
          <p className="wl-cta">No account yet? <button type="button" onClick={() => setMode('waitlist')}>Join the waiting list</button></p>
        </form>
        </div>
        )}

        <div className="login-footer">
          <p>Protected by Enterprise Node.js & PostgreSQL Security</p>
          <p><a href="https://changtechs.com/" target="_blank" rel="noopener">← Back to changtechs.com</a></p>
        </div>
      </div>
    </div>
  );
};
