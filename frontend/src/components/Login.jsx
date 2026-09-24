import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { firebaseAuth, firebaseConfigured } from '../firebase.js';
import { reload, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import PasswordInput from './PasswordInput.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (firebaseConfigured) {
        const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
        await reload(credential.user);
        if (!credential.user.emailVerified) {
          setError('Please verify your email before signing in.');
          return;
        }
        const firebaseToken = await credential.user.getIdToken(true);
          const username = (credential.user.displayName || email.split('@')[0])
            .trim()
            .replace(/[^A-Za-z ]/g, '')
            .replace(/\s+/g, ' ')
            .slice(0, 30) || 'user';
        const { data } = await api.post('/auth/firebase-sync', {
          idToken: firebaseToken,
            username: username.length >= 3 ? username : `${username} user`,
        });
        login(data.token, data.user);
        navigate('/');
        return;
      }
      const { data } = await api.post('/auth/login', { email, password });
      login(data.token, data.user);
      navigate('/');
    } catch (err) {
      const firebaseMessages = {
        'auth/invalid-credential': 'Incorrect Firebase email or password.',
        'auth/invalid-login-credentials': 'Incorrect Firebase email or password.',
        'auth/user-not-found': 'No Firebase account exists for this email.',
        'auth/wrong-password': 'Incorrect Firebase email or password.',
        'auth/user-disabled': 'This Firebase account has been disabled.',
        'auth/too-many-requests': 'Too many sign-in attempts. Try again later.',
        'auth/network-request-failed': 'Could not reach Firebase. Check your connection and try again.',
      };
      const retrySeconds = Number(err.response?.headers?.['retry-after']);
      if (err.response?.status === 429) {
        setRetryAfter(retrySeconds || 900);
      }
      const errorMessage = err.code === 'ECONNABORTED'
        ? 'The server took too long to respond. Please try again.'
        : err.response?.data?.message
          || firebaseMessages[err.code]
            || err.message
          || 'Could not sign in.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (retryAfter <= 0) return undefined;
    const timer = window.setInterval(() => {
      setRetryAfter((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  async function handlePasswordReset() {
    setError('');
    setResetMessage('');
    if (!email) {
      setError('Enter your email address first.');
      return;
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, email);
      setResetMessage('Password reset email sent. Check your inbox.');
    } catch (requestError) {
      setError(requestError.code === 'auth/user-not-found'
        ? 'No Firebase account exists for this email.'
        : requestError.message || 'Could not send password reset email.');
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-layout">
        <section className="auth-preview" aria-hidden="true">
          <div className="auth-preview-brand">
            <span className="auth-preview-mark">+</span>
            <div>
              <p className="eyebrow">Studio Grid</p>
              <p>2D room planning studio</p>
            </div>
          </div>
          <div className="mini-room-stage">
            <div className="mini-room">
              {Array.from({ length: 30 }, (_, index) => <span className="mini-room-cell" key={index} />)}
              <span className="mini-furniture mini-bed" />
              <span className="mini-furniture mini-desk" />
              <span className="mini-furniture mini-chair" />
              <span className="mini-furniture mini-plant" />
            </div>
          </div>
          <div className="auth-preview-note">
            <span className="preview-dot" />
            Place furniture. Shape the room.
          </div>
        </section>

        <div className="auth-card">
          <p className="eyebrow">Studio Grid</p>
          <h1>Sign in</h1>
          <p className="auth-sub">Pick up your saved layouts where you left off.</p>
          <form onSubmit={handleSubmit}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. juan@example.com"
                required
              />
            </label>
            <label>
              Password
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                pattern="(?=.*[^A-Za-z0-9]).{8,}"
                title="Password must be at least 8 characters and include a special character."
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            {resetMessage && <p className="form-success">{resetMessage}</p>}
            <button type="submit" className="btn-primary" disabled={loading || retryAfter > 0}>
              {loading ? 'Signing in…' : retryAfter > 0 ? `Try again in ${retryAfter}s` : 'Sign in'}
            </button>
            {firebaseConfigured && <button type="button" className="btn-link" onClick={handlePasswordReset}>Forgot password?</button>}
          </form>
          <p className="auth-switch">
            New here? <Link to="/register">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
