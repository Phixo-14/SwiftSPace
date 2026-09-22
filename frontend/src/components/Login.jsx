import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { firebaseAuth, firebaseConfigured } from '../firebase.js';
import { reload, signInWithEmailAndPassword } from 'firebase/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (firebaseConfigured) {
        try {
          const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
          await reload(credential.user);
          if (!credential.user.emailVerified) {
            setError('Please verify your email before signing in.');
            return;
          }
          const firebaseToken = await credential.user.getIdToken(true);
          const { data } = await api.post('/auth/firebase-sync', {
            idToken: firebaseToken,
            username: credential.user.displayName || email.split('@')[0],
          });
          login(data.token, data.user);
          navigate('/');
          return;
        } catch (firebaseError) {
          if (firebaseError.code !== 'auth/user-not-found') throw firebaseError;
        }
      }
      const { data } = await api.post('/auth/login', { email, password });
      login(data.token, data.user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not sign in.');
    } finally {
      setLoading(false);
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
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="auth-switch">
            New here? <Link to="/register">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
