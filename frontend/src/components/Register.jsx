import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { firebaseAuth, firebaseConfigured } from '../firebase.js';
import PasswordInput from './PasswordInput.jsx';

const legalLinks = {
  terms: '/terms',
  privacy: '/privacy',
};

function getRegistrationErrors({ username, email, password, confirmPassword, termsAccepted }) {
  const fullName = username.trim().replace(/\s+/g, ' ');
  return {
    username: !/^\p{L}+(?: \p{L}+)+$/u.test(fullName) || Array.from(fullName).length > 50
      ? 'Enter full name'
      : '',
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ? 'Please enter a valid email address.'
      : '',
    password: !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,16}$/.test(password)
      ? 'Password must be 8–16 characters and include uppercase, lowercase, a number, and a symbol.'
      : '',
    confirmPassword: password !== confirmPassword ? 'Passwords do not match.' : '',
    termsAccepted: !termsAccepted
      ? 'You must accept the Terms of Service and Privacy Policy to create an account.'
      : '',
  };
}

export default function Register() {
  const location = useLocation();
  const verificationApproved = location.state?.verificationApproved === true;
  const adminSetupToken = new URLSearchParams(location.hash.replace(/^#/, '')).get('setup') || '';
  const [username, setUsername] = useState(location.state?.username || '');
  const [email, setEmail] = useState(location.state?.email || '');
  const [password, setPassword] = useState('');
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState(location.state?.role || 'homeowner');
  const [termsAccepted, setTermsAccepted] = useState(verificationApproved);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [touchedFields, setTouchedFields] = useState({});
  const [loading, setLoading] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [checkingRegistration, setCheckingRegistration] = useState(true);
  const [setupAvailable, setSetupAvailable] = useState(Boolean(adminSetupToken));
  const [registrationStatusError, setRegistrationStatusError] = useState(false);
  const [registrationStatusAttempt, setRegistrationStatusAttempt] = useState(0);
  const navigate = useNavigate();
  const passwordRequirements = [
    { label: '8–16 characters', met: password.length >= 8 && password.length <= 16 },
    { label: 'At least one uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'At least one lowercase letter', met: /[a-z]/.test(password) },
    { label: 'At least one number', met: /\d/.test(password) },
    { label: 'At least one symbol', met: /[^A-Za-z0-9]/.test(password) },
  ];

  useEffect(() => {
    let active = true;
    setCheckingRegistration(true);
    setRegistrationStatusError(false);
    api.get('/auth/registration-status')
      .then(({ data }) => {
        if (!active) return;
        setRegistrationOpen(data.registrationOpen);
        setSetupAvailable(data.adminSetupAvailable);
      })
      .catch(() => {
        if (!active) return;
        setRegistrationOpen(false);
        setSetupAvailable(false);
        setRegistrationStatusError(true);
      })
      .finally(() => {
        if (active) setCheckingRegistration(false);
      });
    return () => { active = false; };
  }, [registrationStatusAttempt]);

  function updateField(field, value) {
    const values = { username, email, password, confirmPassword, termsAccepted, [field]: value };
    if (field === 'username') setUsername(value);
    if (field === 'email') setEmail(value);
    if (field === 'password') setPassword(value);
    if (field === 'confirmPassword') setConfirmPassword(value);
    if (field === 'termsAccepted') setTermsAccepted(value);
    setFieldErrors(getRegistrationErrors(values));
  }

  function markFieldTouched(field) {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const validationErrors = getRegistrationErrors({ username, email, password, confirmPassword, termsAccepted });
    setFieldErrors(validationErrors);
    const firstInvalidField = ['username', 'email', 'password', 'confirmPassword', 'termsAccepted']
      .find((field) => validationErrors[field]);
    if (firstInvalidField) markFieldTouched(firstInvalidField);
    if (firstInvalidField) return;

    const fullName = username.trim().replace(/\s+/g, ' ');
    setLoading(true);
    try {
      if (firebaseConfigured) {
        if (adminSetupToken) {
          await api.post('/auth/initial-admin-setup/validate', { setupToken: adminSetupToken });
        }

        let credential;
        let recoveringUnverifiedAccount = false;
        try {
          credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        } catch (firebaseError) {
          if (firebaseError.code !== 'auth/email-already-in-use') throw firebaseError;
          if (adminSetupToken) {
            credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
          } else {
            try {
              credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
            } catch {
              throw firebaseError;
            }
            if (credential.user.emailVerified) throw firebaseError;
            recoveringUnverifiedAccount = true;
          }
        }
        await updateProfile(credential.user, { displayName: fullName });
        localStorage.setItem('firebase_pending_username', fullName);
        localStorage.setItem('firebase_pending_email', email);
        localStorage.setItem('firebase_pending_role', adminSetupToken ? 'admin' : role);
        localStorage.setItem('firebase_pending_terms_accepted', 'true');
        sessionStorage.setItem('firebase_pending_terms_accepted', 'true');
        if (adminSetupToken) {
          await api.post('/auth/initial-admin-setup', {
            setupToken: adminSetupToken,
            idToken: await credential.user.getIdToken(),
            username: fullName,
            email,
            termsAccepted,
          });
        } else {
          await api.post('/auth/firebase-registration-intent', {
            idToken: await credential.user.getIdToken(),
            username: fullName,
            role,
            termsAccepted,
          });
        }
        let verificationMessage = '';
        if (!credential.user.emailVerified) {
          const verificationContinueUrl = new URL('/verify-email', window.location.origin);
          verificationContinueUrl.searchParams.set('email', email.trim());
          // Firebase consumes the action code on its hosted handler, then returns
          // to this URL without the oobCode. Mark that successful return so the
          // verification page can show confirmation even in a fresh browser tab.
          verificationContinueUrl.searchParams.set('verification', 'success');
          try {
            await sendEmailVerification(credential.user, { url: verificationContinueUrl.toString() });
          } catch (verificationError) {
            if (verificationError.code === 'auth/unauthorized-continue-uri') {
              // Still send the Firebase verification email so an unauthorized
              // continue URL does not strand a successfully created account.
              try {
                await sendEmailVerification(credential.user);
              } catch (fallbackError) {
                if (fallbackError.code === 'auth/too-many-requests') {
                  let recoveryMessage = 'Your account was created, but Firebase is temporarily limiting verification emails.';
                  try {
                    const { data } = await api.post('/auth/firebase/resend-verification-link', {
                      idToken: await credential.user.getIdToken(true),
                    });
                    recoveryMessage = data.message;
                  } catch (serverFallbackError) {
                    recoveryMessage = serverFallbackError.response?.data?.message
                      || `${recoveryMessage} Wait a while, then use Resend verification email below.`;
                  }
                  navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
                    state: { message: recoveryMessage },
                  });
                  return;
                }
                throw fallbackError;
              }
              verificationMessage = `Verification email sent. Add ${window.location.hostname} to Firebase Authentication's authorized domains so verification links can return to SwiftSpace.`;
            } else if (verificationError.code === 'auth/too-many-requests') {
              let recoveryMessage = 'Your account was created, but Firebase is temporarily limiting verification emails.';
              try {
                const { data } = await api.post('/auth/firebase/resend-verification-link', {
                  idToken: await credential.user.getIdToken(true),
                });
                recoveryMessage = data.message;
              } catch (fallbackError) {
                recoveryMessage = fallbackError.response?.data?.message
                  || `${recoveryMessage} Wait a while, then use Resend verification email below.`;
              }
              navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
                state: { message: recoveryMessage },
              });
              return;
            } else {
              throw verificationError;
            }
          }
        }
        navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
          state: verificationMessage
            ? { message: verificationMessage }
            : recoveringUnverifiedAccount
              ? { message: 'Your account was created earlier, but email verification is still pending. A new verification email has been sent.' }
              : undefined,
        });
        return;
      }
      if (adminSetupToken) {
        const { data } = await api.post('/auth/initial-admin-setup', {
          setupToken: adminSetupToken,
          username: fullName,
          email,
          password,
          termsAccepted,
        });
        navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
          state: { developmentCode: data.developmentCode, message: data.message },
        });
        return;
      }
      const { data } = await api.post('/auth/register', {
        username: fullName,
        email,
        password,
        role,
        termsAccepted,
      });
      navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
        state: { developmentCode: data.developmentCode, message: data.message },
      });
    } catch (err) {
      const details = err.response?.data?.details;
      const firebaseMessages = {
        'auth/email-already-in-use': 'This email already has an account. Sign in or use another email.',
        'auth/invalid-api-key': 'Firebase API key is invalid. Check the Firebase web app configuration.',
        'auth/operation-not-allowed': 'Enable Email/Password sign-in in Firebase Authentication settings.',
        'auth/weak-password': 'Firebase rejected this password. Use at least 8 characters.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/unauthorized-continue-uri': 'Add this site domain to Firebase Authentication authorized domains.',
        'auth/too-many-requests': 'Firebase temporarily blocked this sign-up request. This can happen even on the first try for this email if it detects too many requests from this device or network, or a project limit is reached. Wait before retrying. If an earlier attempt may have created the account, try signing in. If this continues, ask the Firebase project owner to check Authentication usage and limits.',
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
              <p className="eyebrow">SwiftSpace</p>
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
          <p className="eyebrow">SwiftSpace</p>
          <h1>{verificationApproved ? 'Email approved' : adminSetupToken ? 'Administrator setup' : 'Create your account'}</h1>
          <p className="auth-sub">
            {verificationApproved
              ? 'Your email verification is approved. Your account has already been created; sign in to continue.'
              : adminSetupToken
                ? 'Create the client administrator account. This one-time setup link closes after it is used.'
                : 'Start designing and save your room layouts in SwiftSpace.'}
          </p>
          {!verificationApproved && !adminSetupToken && checkingRegistration && (
            <p className="form-info" role="status">Checking whether account registration is available…</p>
          )}
          {!verificationApproved && !adminSetupToken && !checkingRegistration && !registrationOpen && (
            <div className="form-error" role="status">
              {registrationStatusError
                ? 'We could not check whether registration is available. Please refresh the page or try again later.'
                : setupAvailable
                  ? 'The client administrator must complete the one-time setup before user registration opens.'
                  : 'Registration is currently unavailable. Please contact the site administrator.'}
              {registrationStatusError && <button type="button" className="btn-link" onClick={() => setRegistrationStatusAttempt((attempt) => attempt + 1)}>Check again</button>}
            </div>
          )}
          {!verificationApproved && adminSetupToken && !checkingRegistration && !setupAvailable && (
            <p className="form-error" role="alert">This one-time administrator setup link has already been used.</p>
          )}
          {verificationApproved && (
            <div className="verification-approved-details" role="status">
              <p><strong>Name:</strong> {username}</p>
              <p><strong>Email:</strong> {email}</p>
              <p><strong>Account type:</strong> {role === 'admin' ? 'Administrator' : role === 'interior-designer' ? 'Interior Designer' : 'Homeowner / Client'}</p>
              <p>Your password is not retained for security. Use the password you chose when signing in.</p>
              <Link className="btn-primary" to={`/login?email=${encodeURIComponent(email)}`}>Continue to sign in</Link>
            </div>
          )}
          {!verificationApproved && (adminSetupToken ? !checkingRegistration && setupAvailable : true) && (
          <form
            onSubmit={handleSubmit}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setPasswordFocused(false);
              }
            }}
            noValidate
          >
            <label>
              Full Name
              <input
                value={username}
                onBlur={() => markFieldTouched('username')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') markFieldTouched('username');
                }}
                onChange={(event) => {
                  const characters = Array.from(event.target.value);
                  const firstCharacter = characters.shift();
                  const capitalizedName = firstCharacter
                    ? [...Array.from(firstCharacter.toLocaleUpperCase()), ...characters].slice(0, 50).join('')
                    : '';
                  updateField('username', capitalizedName);
                }}
                placeholder="e.g. Juan Cruz"
                title="Enter full name"
                maxLength={50}
                aria-invalid={Boolean(fieldErrors.username)}
                aria-describedby={fieldErrors.username ? 'register-name-error' : undefined}
                required
              />
            </label>
            {touchedFields.username && fieldErrors.username && <p id="register-name-error" className="field-error" role="alert">{fieldErrors.username}</p>}
            {!adminSetupToken && <label>
              I am a
              <select value={role} onChange={(event) => setRole(event.target.value)} required>
                <option value="homeowner">Homeowner / Client</option>
                <option value="interior-designer">Interior Designer</option>
              </select>
            </label>}
            <label>
              Email
              <input
                type="email"
                value={email}
                onBlur={() => markFieldTouched('email')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') markFieldTouched('email');
                }}
                onChange={(event) => updateField('email', event.target.value)}
                placeholder="e.g. juan@example.com"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
                required
              />
            </label>
            {touchedFields.email && fieldErrors.email && <p id="register-email-error" className="field-error" role="alert">{fieldErrors.email}</p>}
            <div
              className="password-field-group"
              onFocus={() => {
                setPasswordFocused(true);
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setPasswordFocused(false);
                  markFieldTouched('password');
                }
              }}
            >
              <label>
                Password
                <PasswordInput
                  value={password}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') markFieldTouched('password');
                  }}
                  onChange={(event) => updateField('password', event.target.value)}
                  minLength={8}
                  maxLength={16}
                  pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,16}"
                  title="Password must be 8–16 characters and include uppercase, lowercase, a number, and a symbol."
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'register-password-error' : undefined}
                  required
                />
              </label>
              {passwordFocused && (
                <ul className="password-requirements" aria-label="Password requirements" aria-live="polite">
                  {passwordRequirements.map((requirement) => (
                    <li className={requirement.met ? 'met' : ''} key={requirement.label}>
                      <span aria-hidden="true">{requirement.met ? '✓' : '○'}</span>
                      {requirement.label}
                    </li>
                  ))}
                </ul>
              )}
              {touchedFields.password && fieldErrors.password && <p id="register-password-error" className="field-error" role="alert">{fieldErrors.password}</p>}
            </div>
            <label>
              Confirm password
              <PasswordInput
                value={confirmPassword}
                onBlur={() => markFieldTouched('confirmPassword')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') markFieldTouched('confirmPassword');
                }}
                onChange={(event) => updateField('confirmPassword', event.target.value)}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
                aria-describedby={fieldErrors.confirmPassword ? 'register-confirm-password-error' : undefined}
                required
              />
            </label>
            {touchedFields.confirmPassword && fieldErrors.confirmPassword && <p id="register-confirm-password-error" className="field-error" role="alert">{fieldErrors.confirmPassword}</p>}
            <label className="registration-consent">
              <input
                type="checkbox"
                checked={termsAccepted}
                onBlur={() => markFieldTouched('termsAccepted')}
                onChange={(event) => updateField('termsAccepted', event.target.checked)}
                aria-invalid={Boolean(fieldErrors.termsAccepted)}
                aria-describedby={fieldErrors.termsAccepted ? 'register-terms-error' : undefined}
                required
              />
              <span>
                I agree to the
                {' '}
                <a href={legalLinks.terms} target="_blank" rel="noopener noreferrer">Terms of Service</a>
                {' '}
                and
                {' '}
                <a href={legalLinks.privacy} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
              </span>
            </label>
            {touchedFields.termsAccepted && fieldErrors.termsAccepted && <p id="register-terms-error" className="field-error" role="alert">{fieldErrors.termsAccepted}</p>}
            {error && <p className="form-error">{error}</p>}
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || (adminSetupToken && checkingRegistration) || (!adminSetupToken && !checkingRegistration && !registrationOpen)}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          )}
          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
