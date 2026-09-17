import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function Register() {
  const [username, setUsername] = useState('');
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
      const { data } = await api.post('/auth/register', { username, email, password });
      login(data.token, data.user);
      navigate('/');
    } catch (err) {
      const details = err.response?.data?.details;
      setError(details ? details.join(' ') : err.response?.data?.message || 'Could not create account.');
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
          <h1>Create your account</h1>
          <p className="auth-sub">Start designing and save your room layouts in Studio Grid.</p>
          <form onSubmit={handleSubmit}>
            <label>
              Name
              <input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} required />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
