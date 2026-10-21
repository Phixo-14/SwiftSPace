import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api.js';
import { firebaseAuth, firebaseConfigured } from '../firebase.js';
import { applyActionCode, onAuthStateChanged, reload, sendEmailVerification } from 'firebase/auth';

export default function VerifyEmail() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState(location.state?.message || '');
  const [setupMessage, setSetupMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [firebaseLinkHandled, setFirebaseLinkHandled] = useState(false);
  const [verifiedProfile, setVerifiedProfile] = useState(null);
  const verificationCheckInProgress = useRef(false);
  const firebaseMode = firebaseConfigured;
  const verificationReturned = searchParams.get('verification') === 'success';
  const navigate = useNavigate();

  function getPendingValue(key) {
    return localStorage.getItem(`firebase_pending_${key}`)
      || sessionStorage.getItem(`firebase_pending_${key}`);
  }

  async function confirmExistingFirebaseVerification(user) {
    const requestedEmail = email.trim().toLowerCase();
    if (!user || verificationCheckInProgress.current
      || (requestedEmail && user.email?.toLowerCase() !== requestedEmail)) return false;

    verificationCheckInProgress.current = true;
    setLoading(true);
    setError('');
    let emailVerified = false;
    try {
      await reload(user);
      if (!user.emailVerified) return false;
      emailVerified = true;

      const profile = {
        email: user.email,
        username: getPendingValue('username') || user.displayName || user.email.split('@')[0],
        role: getPendingValue('role') || 'homeowner',
      };
      setVerifiedProfile(profile);
      setMessage('Your email has been successfully verified.');

      const firebaseToken = await user.getIdToken(true);
      await api.post('/auth/firebase-sync', {
        idToken: firebaseToken,
        username: profile.username,
        role: profile.role,
        termsAccepted: getPendingValue('terms_accepted') === 'true',
      });

      clearPendingFirebaseProfile();
      return true;
    } catch (requestError) {
      if (emailVerified) {
        setSetupMessage('SwiftSpace could not finish account setup yet. Please try signing in.');
      } else {
        setError(requestError.response?.data?.message || requestError.message || 'Could not confirm email verification.');
      }
      return emailVerified;
    } finally {
      setLoading(false);
      verificationCheckInProgress.current = false;
    }
  }

  function clearPendingFirebaseProfile() {
    sessionStorage.removeItem('firebase_pending_username');
    sessionStorage.removeItem('firebase_pending_email');
    sessionStorage.removeItem('firebase_pending_role');
    sessionStorage.removeItem('firebase_pending_terms_accepted');
    localStorage.removeItem('firebase_pending_username');
    localStorage.removeItem('firebase_pending_email');
    localStorage.removeItem('firebase_pending_role');
    localStorage.removeItem('firebase_pending_terms_accepted');
  }

  async function finishFirebaseVerification() {
    const actionCode = new URLSearchParams(window.location.search).get('oobCode');
    if (!firebaseConfigured || !actionCode) return false;
    setLoading(true);
    setError('');
    let emailVerified = false;
    try {
      await applyActionCode(firebaseAuth, actionCode);
      emailVerified = true;
      setFirebaseLinkHandled(true);

      const profile = {
        email: email
          || localStorage.getItem('firebase_pending_email')
          || sessionStorage.getItem('firebase_pending_email')
          || firebaseAuth.currentUser?.email
          || '',
        username: localStorage.getItem('firebase_pending_username')
          || sessionStorage.getItem('firebase_pending_username')
          || email.split('@')[0],
        role: localStorage.getItem('firebase_pending_role')
          || sessionStorage.getItem('firebase_pending_role')
          || 'homeowner',
      };

      setVerifiedProfile(profile);
      setMessage('Your email has been successfully verified.');
      if (firebaseAuth.currentUser) {
        await reload(firebaseAuth.currentUser);
        const firebaseToken = await firebaseAuth.currentUser.getIdToken(true);
        await api.post('/auth/firebase-sync', {
          idToken: firebaseToken,
          username: profile.username,
          role: profile.role,
          termsAccepted: getPendingValue('terms_accepted') === 'true',
        });
      }
      clearPendingFirebaseProfile();
    } catch (requestError) {
      if (requestError.code === 'auth/invalid-action-code'
        && await confirmExistingFirebaseVerification(firebaseAuth.currentUser)) {
        return true;
      }
      if (emailVerified) {
        setFirebaseLinkHandled(true);
        setVerifiedProfile((profile) => profile || {
          email: email
            || getPendingValue('email')
            || firebaseAuth.currentUser?.email
            || '',
          username: getPendingValue('username') || email.split('@')[0],
          role: getPendingValue('role') || 'homeowner',
        });
        setMessage('Your email has been successfully verified.');
        setSetupMessage('SwiftSpace could not finish account setup yet. Please try signing in.');
        return true;
      }
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
    let unsubscribe;
    let refreshTimer;
    const refreshVerificationStatus = () => {
      if (document.visibilityState === 'visible') {
        void confirmExistingFirebaseVerification(firebaseAuth.currentUser);
      }
    };

    finishFirebaseVerification().then((handled) => {
      if (!handled && verificationReturned) {
        const returnedProfile = {
          email: email || getPendingValue('email') || '',
          username: getPendingValue('username') || email.split('@')[0],
          role: getPendingValue('role') || 'homeowner',
        };
        setVerifiedProfile(returnedProfile);
        setMessage('Your email has been successfully verified. You can now sign in.');
        if (firebaseAuth?.currentUser) {
          void confirmExistingFirebaseVerification(firebaseAuth.currentUser);
        }
        return;
      }
      if (!handled && firebaseConfigured) {
        unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
          if (user) void confirmExistingFirebaseVerification(user);
        });
        refreshTimer = window.setInterval(refreshVerificationStatus, 4000);
        window.addEventListener('focus', refreshVerificationStatus);
        document.addEventListener('visibilitychange', refreshVerificationStatus);
      }
    });
    return () => {
      unsubscribe?.();
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshVerificationStatus);
      document.removeEventListener('visibilitychange', refreshVerificationStatus);
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    if (!email.includes('@')) {
      setError('Please enter a valid email address.');
      setLoading(false);
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError('Verification code must be 6 digits.');
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.post('/auth/verify-email', { email, code });
      setVerifiedProfile({
        email: data.user.email,
        username: data.user.username,
        role: data.user.role,
      });
      setMessage('Your email has been successfully verified. You can now sign in.');
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

  async function resendFirebaseVerification() {
    setError('');
    setMessage('');
    const user = firebaseAuth?.currentUser;
    if (!user || user.email?.toLowerCase() !== email.trim().toLowerCase()) {
      setError('This account is not signed in here. Return to sign in with this email, then request a new verification email.');
      return;
    }
    if (user.emailVerified) {
      await confirmExistingFirebaseVerification(user);
      return;
    }

    setLoading(true);
    try {
      const continueUrl = new URL('/verify-email', window.location.origin);
      continueUrl.searchParams.set('email', user.email);
      try {
        await sendEmailVerification(user, { url: continueUrl.toString() });
      } catch (verificationError) {
        if (verificationError.code !== 'auth/unauthorized-continue-uri') throw verificationError;
        await sendEmailVerification(user);
        setMessage(`Verification email sent. Add ${window.location.hostname} to Firebase Authentication's authorized domains so the link can return to SwiftSpace.`);
        return;
      }
      setMessage('A new verification email was sent. Check your inbox and spam folder.');
    } catch (requestError) {
      if (requestError.code === 'auth/too-many-requests') {
        try {
          const { data } = await api.post('/auth/firebase/resend-verification-link', {
            idToken: await user.getIdToken(true),
          });
          setMessage(data.message);
          return;
        } catch (fallbackError) {
          setError(fallbackError.response?.data?.message
            || 'Firebase is temporarily limiting verification emails. Wait before requesting another one.');
        }
      } else {
        setError(requestError.message || 'Could not resend the verification email.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card verification-card">
        <p className="eyebrow">SwiftSpace</p>
        <h1>{verifiedProfile ? 'Email verified' : 'Verify your email'}</h1>
        <p className="auth-sub">
          {verifiedProfile
            ? 'Your email verification is approved.'
            : firebaseLinkHandled
            ? 'Email verification approved. Returning to sign up…'
            : firebaseMode
              ? 'Check your inbox and click the Firebase verification link to continue.'
              : 'Enter the six-digit code sent to your email address.'}
        </p>
        {verifiedProfile && <p className="form-success" role="status">{message}</p>}
        {verifiedProfile && setupMessage && <p className="form-info" role="status">{setupMessage}</p>}
        {verifiedProfile && (
          <button
            type="button"
            className="btn-primary verification-signin"
            onClick={() => navigate(`/login?email=${encodeURIComponent(verifiedProfile.email)}`, { replace: true })}
          >
            Sign in
          </button>
        )}
        {!firebaseMode && !firebaseLinkHandled && !verifiedProfile && <form onSubmit={handleSubmit} noValidate>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Verification code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required /></label>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Verifying…' : 'Verify email'}</button>
        </form>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && !verifiedProfile && <p className="form-success" role="status">{message}</p>}
        {!firebaseLinkHandled && !verifiedProfile && (firebaseMode
          ? <>
              <button type="button" className="btn-link verification-signin" onClick={resendFirebaseVerification} disabled={loading}>Resend verification email</button>
              <button type="button" className="btn-link verification-signin" onClick={() => navigate(`/login?email=${encodeURIComponent(email)}`, { replace: true })}>Back to sign in</button>
            </>
          : <button type="button" className="btn-link" onClick={resendCode}>Resend code</button>)}
      </div>
    </div>
  );
}
