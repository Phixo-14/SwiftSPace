import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { firebaseAuth, firebaseConfigured } from '../firebase.js';
import { applyActionCode, reload } from 'firebase/auth';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [firebaseLinkHandled, setFirebaseLinkHandled] = useState(false);
  const firebaseMode = firebaseConfigured;
  const { login } = useAuth();
  const navigate = useNavigate();

  async function finishFirebaseVerification() {
    const actionCode = new URLSearchParams(window.location.search).get('oobCode');
    if (!firebaseConfigured || !actionCode) return false;
    setLoading(true);
    setError('');
    try {
      await applyActionCode(firebaseAuth, actionCode);
      setFirebaseLinkHandled(true);

      if (firebaseAuth.currentUser) {
        await reload(firebaseAuth.currentUser);
        const firebaseToken = await firebaseAuth.currentUser.getIdToken(true);
        const { data } = await api.post('/auth/firebase-sync', {
          idToken: firebaseToken,
          username: sessionStorage.getItem('firebase_pending_username') || email.split('@')[0],
        });
        sessionStorage.removeItem('firebase_pending_username');
        login(data.token, data.user);
        navigate('/');
      } else {
        setMessage('Email verified. Sign in to finish setting up your account.');
      }
    } catch (requestError) {
      setError(requestError.code === 'auth/invalid-action-code'
        ? 'This verification link is invalid or has already been used.'
        : requestError.code === 'auth/unauthorized-continue-uri'
          ? 'Add this site domain to Firebase Authentication authorized domains.'
          : requestError.message || 'Could not verify email.');
    } finally {
      setLoading(false);
    }
    return true;
  }

  useEffect(() => {
    finishFirebaseVerification();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const { data } = await api.post('/auth/verify-email', { email, code });
      login(data.token, data.user);
      navigate('/');
    } catch (requestError) {
      const details = requestError.response?.data?.details;
      setError(details ? details.join(' ') : requestError.response?.data?.message || 'Could not verify email.');
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    setError('');
    setMessage('');
    try {
      const { data } = await api.post('/auth/resend-verification', { email });
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not resend code.');
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card verification-card">
        <p className="eyebrow">Studio Grid</p>
        <h1>Verify your email</h1>
        <p className="auth-sub">
          {firebaseLinkHandled
            ? 'Your email is verified. Sign in to continue.'
            : firebaseMode
              ? 'Check your inbox and click the Firebase verification link to continue.'
              : 'Enter the six-digit code sent to your email address.'}
        </p>
        {!firebaseMode && !firebaseLinkHandled && <form onSubmit={handleSubmit}>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Verification code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required /></label>
          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-success">{message}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Verifying…' : 'Verify email'}</button>
        </form>}
        {firebaseLinkHandled
          ? <Link className="btn-primary verification-signin" to="/login">Continue to sign in</Link>
          : firebaseMode
            ? <Link className="btn-link verification-signin" to="/login">Back to sign in</Link>
            : <button type="button" className="btn-link" onClick={resendCode}>Resend code</button>}
        <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
      </div>
    </div>
  );
}