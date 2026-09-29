import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { firebaseAuth } from '../firebase.js';

export default function AccountSettings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [deletePending, setDeletePending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function deleteAccount() {
    setDeleting(true);
    setError('');
    try {
      await api.delete('/auth/account');
      if (firebaseAuth) await signOut(firebaseAuth).catch(() => {});
      logout();
      navigate('/login', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete your account.');
    } finally {
      setDeleting(false);
    }
  }

  function handleLogout() {
    if (firebaseAuth) signOut(firebaseAuth).catch(() => {});
    logout();
    navigate('/login');
  }

  return (
    <div className="page dashboard-page account-page">
      <aside className="admin-hover-sidebar" aria-label="Workspace navigation">
        <div className="admin-sidebar-brand">
          <span className="admin-brand-mark">+</span>
          <span className="admin-sidebar-label">Studio Grid</span>
        </div>
        <nav className="admin-sidebar-nav">
          <Link to="/"><span className="admin-nav-icon">⌂</span><span className="admin-sidebar-label">My layouts</span></Link>
          <Link to="/room/new"><span className="admin-nav-icon">+</span><span className="admin-sidebar-label">New room</span></Link>
          <Link to="/account" aria-current="page"><span className="admin-nav-icon">◎</span><span className="admin-sidebar-label">Manage account</span></Link>
        </nav>
      </aside>

      <header className="topbar">
        <div>
          <p className="eyebrow">Studio Grid</p>
          <h1>Manage account</h1>
        </div>
        <div className="topbar-actions">
          <span className="who">{user?.username}</span>
          <button className="btn-ghost" type="button" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main className="account-page-main">
        <section className="account-page-settings" aria-labelledby="account-settings-heading">
          <div>
            <p className="eyebrow">Account</p>
            <h2 id="account-settings-heading">Account settings</h2>
          </div>
          <div className="account-page-details">
            <strong>{user?.username}</strong>
            <p className="muted">{user?.email}</p>
            <p className="muted small">Permanently remove your account and all saved layouts.</p>
            <button className="btn-danger" type="button" onClick={() => setDeletePending(true)}>
              Delete account
            </button>
          </div>
        </section>
      </main>

      {deletePending && (
        <div className="delete-dialog-backdrop" role="presentation">
          <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="account-delete-title">
            <div className="delete-dialog-icon" aria-hidden="true">×</div>
            <p className="eyebrow">Account settings</p>
            <h2 id="account-delete-title">Delete your account?</h2>
            <p className="muted">Your account and all saved rooms will be permanently deleted. This cannot be undone.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="delete-dialog-actions">
              <button className="btn-ghost" type="button" onClick={() => setDeletePending(false)} disabled={deleting}>
                Keep account
              </button>
              <button className="btn-danger" type="button" onClick={deleteAccount} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}