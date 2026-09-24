import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import PasswordInput from './PasswordInput.jsx';

export default function AdminDashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [userForm, setUserForm] = useState({ username: '', email: '', password: '' });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [message, setMessage] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [error, setError] = useState('');
  const [expandedOverlapUser, setExpandedOverlapUser] = useState(null);

  function formatTimer(seconds = 0) {
    const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${remainingSeconds}`;
  }

  useEffect(() => {
    api.post('/auth/admin/sync-firebase-users')
      .catch(() => null)
      .then(() => api.get('/auth/admin/overview'))
      .then(({ data }) => setOverview(data))
      .catch((requestError) => {
        if (requestError.response?.status === 401) {
          logout();
          navigate('/login', { replace: true });
          return;
        }
        setError(requestError.response?.data?.message || 'Could not load admin data.');
      })
      .finally(() => setLoading(false));
  }, [logout, navigate]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  async function handleCreateAdmin(event) {
    event.preventDefault();
    setCreating(true);
    setMessage('');
    setError('');
    try {
      await api.post('/auth/admins', form);
      setForm({ username: '', email: '', password: '' });
      setMessage('Admin account created.');
      const { data } = await api.get('/auth/admin/overview');
      setOverview(data);
    } catch (requestError) {
      const details = requestError.response?.data?.details;
      setError(details ? details.join(' ') : requestError.response?.data?.message || 'Could not create admin account.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    setCreatingUser(true);
    setUserMessage('');
    setError('');
    try {
      await api.post('/auth/users', userForm);
      setUserForm({ username: '', email: '', password: '' });
      setUserMessage('User account created.');
      const { data } = await api.get('/auth/admin/overview');
      setOverview(data);
    } catch (requestError) {
      const details = requestError.response?.data?.details;
      setError(details ? details.join(' ') : requestError.response?.data?.message || 'Could not create user account.');
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleDeleteUser(account) {
    if (!window.confirm(`Delete ${account.username}? Their saved rooms will also be deleted.`)) return;
    setDeletingUserId(account._id);
    setError('');
    try {
      await api.delete(`/auth/users/${account._id}`);
      setOverview((current) => current && {
        ...current,
        users: current.users.filter((userAccount) => userAccount._id !== account._id),
        stats: { ...current.stats, users: Math.max(0, current.stats.users - 1) },
      });
      api.get('/auth/admin/overview')
        .then(({ data }) => setOverview(data))
        .catch(() => setError('User deleted, but dashboard statistics could not refresh.'));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete user account.');
    } finally {
      setDeletingUserId(null);
    }
  }

  const overlapGroups = (overview?.recentOverlaps || []).reduce((groups, record) => {
    const username = record.username || 'Unknown user';
    if (!groups[username]) groups[username] = [];
    groups[username].push(record);
    return groups;
  }, {}) || {};
  const sortedUsers = [...(overview?.users || [])].sort((first, second) => {
    if (first.role === second.role) return 0;
    return first.role === 'admin' ? -1 : 1;
  });

  return (
    <div className="page admin-page">
      <aside className="admin-hover-sidebar" aria-label="Admin navigation">
        <div className="admin-sidebar-brand">
          <span className="admin-brand-mark">+</span>
          <span className="admin-sidebar-label">Studio Grid</span>
        </div>
        <nav className="admin-sidebar-nav">
          <a href="#admin-overview"><span className="admin-nav-icon">⌂</span><span className="admin-sidebar-label">Overview</span></a>
          <a href="#admin-analytics"><span className="admin-nav-icon">◒</span><span className="admin-sidebar-label">Analytics</span></a>
          <a href="#admin-users"><span className="admin-nav-icon">◎</span><span className="admin-sidebar-label">Users</span></a>
          <a href="#admin-overlaps"><span className="admin-nav-icon">!</span><span className="admin-sidebar-label">Overlap activity</span></a>
          <a href="#admin-access"><span className="admin-nav-icon">+</span><span className="admin-sidebar-label">Add administrator</span></a>
        </nav>
      </aside>
      <header className="topbar">
        <div className="admin-brand">
          <span className="admin-brand-mark">+</span>
          <div>
            <p className="eyebrow">Studio Grid / Control room</p>
            <h1>Admin dashboard</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="admin-status">ADMIN</span>
          <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main className="admin-main">
        <section className="admin-intro" id="admin-overview">
          <div>
            <p className="eyebrow">Overview</p>
            <h2>Keep the studio moving.</h2>
          </div>
          <p className="admin-subtitle">Manage accounts, monitor saved layouts, and keep the furniture catalog ready for the next room.</p>
        </section>

        {error && <p className="form-error">{error}</p>}
        {loading && <p className="muted">Loading admin data…</p>}

        {overview && (
          <>
            <section className="admin-stats" aria-label="Studio statistics">
              <article className="stat-card"><span className="stat-label">Total users</span><strong>{overview.stats.users}</strong><span className="stat-note">Registered accounts</span></article>
              <article className="stat-card"><span className="stat-label">Administrators</span><strong>{overview.stats.admins}</strong><span className="stat-note">Privileged accounts</span></article>
              <article className="stat-card"><span className="stat-label">Saved rooms</span><strong>{overview.stats.rooms}</strong><span className="stat-note">Across all workspaces</span></article>
              <article className="stat-card"><span className="stat-label">Catalog items</span><strong>{overview.stats.catalogItems}</strong><span className="stat-note">Available furniture</span></article>
            </section>

            <section className="analytics-panel" id="admin-analytics">
              <div className="section-heading">
                <div><p className="eyebrow">Analytics</p><h3>Studio usage</h3></div>
                <span className="muted small">Last six months</span>
              </div>
              <div className="analytics-grid">
                <div className="analytics-chart" aria-label="Rooms created over the last six months">
                  {overview.monthlyRooms.map((month) => (
                    <div className="chart-column" key={`${month.month}-${month.count}`}>
                      <span className="chart-value">{month.count}</span>
                      <span className="chart-bar" style={{ height: `${Math.max(month.count ? (month.count / Math.max(...overview.monthlyRooms.map(({ count }) => count), 1)) * 100 : 4, 4)}%` }} />
                      <span className="chart-label">{month.month}</span>
                    </div>
                  ))}
                </div>
                <div className="analytics-highlights">
                  <div><span>Furniture placed</span><strong>{overview.stats.placements}</strong></div>
                  <div><span>Overlap attempts</span><strong>{overview.stats.overlaps}</strong></div>
                  <div><span>Average room area</span><strong>{overview.stats.averageArea} <small>cells</small></strong></div>
                  <div><span>Rooms per user</span><strong>{overview.stats.users ? (overview.stats.rooms / overview.stats.users).toFixed(1) : '0.0'}</strong></div>
                </div>
              </div>
            </section>

            <section className="admin-section overlap-activity-section" id="admin-overlaps">
              <div className="section-heading">
                <div><p className="eyebrow">Quality signals</p><h3>Recent overlap attempts</h3></div>
                <span className="section-count">{overview.stats.overlaps}</span>
              </div>
              {overview.recentOverlaps.length === 0 ? (
                <p className="muted">No overlap attempts have been recorded.</p>
              ) : (
                <div className="admin-overlap-list">
                  {Object.entries(overlapGroups).map(([username, records]) => {
                    const isExpanded = expandedOverlapUser === username;
                    return (
                      <div className="admin-overlap-group" key={username}>
                        <button
                          className="admin-overlap-row"
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedOverlapUser(isExpanded ? null : username)}
                        >
                          <span className="overlap-signal">!</span>
                          <span className="admin-overlap-details">
                            <strong>{username}</strong>
                            <small>{records.length} overlap error{records.length === 1 ? '' : 's'}</small>
                          </span>
                          <span className="overlap-expand" aria-hidden="true">{isExpanded ? '−' : '+'}</span>
                        </button>
                        {isExpanded && (
                          <div className="admin-overlap-errors">
                            {records.map((record) => (
                              <div className="admin-overlap-error" key={record._id}>
                                <span>- overlap ({record.catalogItemId?.name || 'Furniture'})</span>
                                <span className="admin-overlap-meta mono">{record.roomName} · ({record.gridX}, {record.gridY}) · {record.rotation}°<br />{new Date(record.occurredAt).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="admin-grid">
              <section className="admin-section" id="admin-users">
                <div className="section-heading"><div><p className="eyebrow">People</p><h3>User accounts</h3></div><span className="section-count">{overview.users.length}</span></div>
                <div className="user-list">
                  {sortedUsers.map((account) => (
                    <div className="user-row" key={account._id}>
                      <span className="user-avatar">{account.username.slice(0, 1).toUpperCase()}</span>
                      <span className="user-details"><strong>{account.username}</strong><small>{account.email}</small></span>
                      <span className={`role-badge ${account.role}`}>{account.role}</span>
                      {account.role === 'user' && (
                        <button
                          className="user-delete-button"
                          type="button"
                          onClick={() => handleDeleteUser(account)}
                          disabled={deletingUserId === account._id}
                          aria-label={`Delete ${account.username}`}
                          title={`Delete ${account.username}`}
                        >
                          {deletingUserId === account._id ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="admin-section">
                <div className="section-heading"><div><p className="eyebrow">Activity</p><h3>Recent layouts</h3></div><span className="section-count">{overview.stats.rooms}</span></div>
                <div className="room-list">
                  {overview.recentRooms.length === 0 && <p className="muted">No layouts have been saved yet.</p>}
                  {overview.recentRooms.map((room) => (
                    <Link className="admin-room-row" to={`/room/${room._id}`} key={room._id}>
                      <span><strong>{room.roomName}</strong><small>{room.userId?.username || 'Unknown user'}</small></span>
                      <span className="room-size mono">{room.dimensions.width} × {room.dimensions.length}<br />Time {formatTimer(room.timerSeconds)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            </div>

            <section className="admin-section create-admin-section" id="admin-access">
              <div className="section-heading"><div><p className="eyebrow">Access</p><h3>Add an administrator</h3></div><span className="muted small">Admin-only action</span></div>
              <form className="admin-form" onSubmit={handleCreateAdmin}>
                <label>Name<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} minLength={3} required /></label>
                <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
                <label>Password<PasswordInput value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={8} required /></label>
                <button className="btn-primary" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create admin'}</button>
              </form>
              {message && <p className="form-success">{message}</p>}
            </section>

            <section className="admin-section create-user-section">
              <div className="section-heading"><div><p className="eyebrow">People</p><h3>Add a user</h3></div><span className="muted small">Admin-only action</span></div>
              <form className="admin-form" onSubmit={handleCreateUser}>
                <label>Name<input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} minLength={3} required /></label>
                <label>Email<input type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} required /></label>
                <label>Password<PasswordInput value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} minLength={8} required /></label>
                <button className="btn-primary" type="submit" disabled={creatingUser}>{creatingUser ? 'Creating…' : 'Create user'}</button>
              </form>
              {userMessage && <p className="form-success">{userMessage}</p>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}