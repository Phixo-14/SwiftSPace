import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { firebaseAuth, firebaseConfigured } from '../firebase.js';
import PasswordInput from './PasswordInput.jsx';

export default function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(username.trim()) || username.trim().length < 3) {
      setError('Name must be at least 3 characters and contain letters and spaces only.');
      return;
    }
    if (!email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8 || !/[^A-Za-z0-9]/.test(password)) {
      setError('Password must be at least 8 characters and include a special character.');
      return;
    }
    setLoading(true);
    try {
      if (firebaseConfigured) {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        await updateProfile(credential.user, { displayName: username });
        await sendEmailVerification(credential.user);
        sessionStorage.setItem('firebase_pending_username', username);
        navigate(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      const { data } = await api.post('/auth/register', { username, email, password });
      navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
        state: { developmentCode: data.developmentCode, message: data.message },
      });
    } catch (err) {
      const details = err.response?.data?.details;
      const firebaseMessages = {
        'auth/email-already-in-use': 'This email already has a Firebase account. Sign in or use another email.',
        'auth/invalid-api-key': 'Firebase API key is invalid. Check the Firebase web app configuration.',
        'auth/operation-not-allowed': 'Enable Email/Password sign-in in Firebase Authentication settings.',
        'auth/weak-password': 'Firebase rejected this password. Use at least 8 characters.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/unauthorized-continue-uri': 'Add this site domain to Firebase Authentication authorized domains.',
      };
      setError(details
        ? details.join(' ')
        : err.response?.data?.message
          || firebaseMessages[err.code]
          || err.message
          || 'Could not create account.');
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
          <form onSubmit={handleSubmit} noValidate>
            <label>
              Name
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. Juan Dela Cruz"
                pattern="[A-Za-z]+(?: [A-Za-z]+)*"
                title="Name can contain letters and spaces only."
                minLength={3}
                maxLength={30}
                required
              />
            </label>
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
