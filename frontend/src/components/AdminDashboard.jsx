import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import PasswordInput from './PasswordInput.jsx';
import BrandLogo from './BrandLogo.jsx';

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateInputValue(date);
}

export default function AdminDashboard() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [banningUserId, setBanningUserId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showSystemLogs, setShowSystemLogs] = useState(false);
  const [systemLogs, setSystemLogs] = useState([]);
  const [systemLogsLoading, setSystemLogsLoading] = useState(false);
  const [systemLogsError, setSystemLogsError] = useState('');
  const [systemLogLevel, setSystemLogLevel] = useState('all');
  const [systemLogRefreshKey, setSystemLogRefreshKey] = useState(0);
  const [periodEnd, setPeriodEnd] = useState(() => dateInputValue(new Date()));
  const [periodStart, setPeriodStart] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    return dateInputValue(date);
  });

  function formatTimer(seconds = 0) {
    const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${remainingSeconds}`;
  }

  useEffect(() => {
    api.get('/auth/admin/overview')
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

  useEffect(() => {
    if (!showSystemLogs) return undefined;
    let active = true;
    setSystemLogsLoading(true);
    api.get('/auth/admin/logs', { params: { limit: 200 } })
      .then(({ data }) => {
        if (active) {
          setSystemLogs(data.logs);
          setSystemLogsError('');
        }
      })
      .catch((requestError) => {
        if (active) setSystemLogsError(requestError.response?.data?.message || 'Could not load system logs.');
      })
      .finally(() => {
        if (active) setSystemLogsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showSystemLogs, systemLogRefreshKey]);

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

  async function handleToggleUserBan(account) {
    const banned = !account.bannedAt;
    if (banned && !window.confirm(`Ban ${account.username} from signing in? Their account and saved rooms will be kept.`)) return;
    setBanningUserId(account._id);
    setError('');
    try {
      const { data } = await api.patch(`/auth/users/${account._id}/ban`, { banned });
      setOverview((current) => current && ({
        ...current,
        users: current.users.map((userAccount) => userAccount._id === account._id
          ? { ...userAccount, bannedAt: data.user.bannedAt }
          : userAccount),
      }));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update user access.');
    } finally {
      setBanningUserId(null);
    }
  }

  const sortedUsers = [...(overview?.users || [])].sort((first, second) => {
    if (first.role === second.role) return 0;
    return first.role === 'admin' ? -1 : 1;
  });
  const filteredSystemLogs = systemLogLevel === 'all'
    ? systemLogs
    : systemLogs.filter((log) => log.level === systemLogLevel);
  const overlapLearning = overview?.overlapLearning;
  const overlapModelAtChance = overlapLearning?.status === 'trained' && overlapLearning.balancedAccuracy <= 50;
  const invalidPeriod = Boolean(periodStart && periodEnd && periodStart > periodEnd);
  const roomsSavedInPeriod = invalidPeriod ? [] : (overview?.recentRooms || []).filter((room) => {
    const createdDate = localDateKey(room.createdAt);
    return createdDate && (!periodStart || createdDate >= periodStart) && (!periodEnd || createdDate <= periodEnd);
  });
  return (
    <div className="page admin-page">
      <aside className="admin-hover-sidebar" aria-label="Admin navigation">
        <div className="admin-sidebar-brand">
          <BrandLogo variant="full" className="admin-sidebar-full-logo" />
        </div>
        <nav className="admin-sidebar-nav">
          <a href="#admin-overview"><span className="admin-nav-icon">⌂</span><span className="admin-sidebar-label">Overview</span></a>
          <a href="#admin-analytics"><span className="admin-nav-icon">◒</span><span className="admin-sidebar-label">Analytics</span></a>
          <a href="#admin-users"><span className="admin-nav-icon">◎</span><span className="admin-sidebar-label">Users</span></a>
          <a href="#admin-overlaps"><span className="admin-nav-icon">!</span><span className="admin-sidebar-label">Overlap activity</span></a>
          <a
            href="#admin-logs"
            aria-controls="admin-logs"
            aria-expanded={showSystemLogs}
            onClick={(event) => {
              event.preventDefault();
              const nextVisibility = !showSystemLogs;
              setShowSystemLogs(nextVisibility);
              if (nextVisibility) {
                window.requestAnimationFrame(() => {
                  document.getElementById('admin-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }
            }}
          >
            <span className="admin-nav-icon">≡</span><span className="admin-sidebar-label">System logs</span>
          </a>
          <a href="#admin-access"><span className="admin-nav-icon">+</span><span className="admin-sidebar-label">Add administrator</span></a>
        </nav>
      </aside>
      <header className="topbar">
        <div className="admin-brand">
          <BrandLogo className="admin-brand-mark" />
          <div>
            <p className="eyebrow">SwiftSpace / Control room</p>
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
              <article className="stat-card"><span className="stat-label">Registered users</span><strong>{overview.stats.registeredUsers ?? overview.stats.users}</strong></article>
              <article className="stat-card"><span className="stat-label">Saved rooms</span><strong>{overview.stats.rooms}</strong></article>
              <article className="stat-card"><span className="stat-label">Average furniture per room</span><strong>{overview.stats.averageFurniturePerRoom ?? '0.0'}</strong></article>
              <article className="stat-card"><span className="stat-label">Rooms with overlap records</span><strong>{overview.stats.roomsWithRecordedOverlaps || 0}</strong></article>
              <article className="stat-card"><span className="stat-label">Rooms saved in selected period</span><strong>{invalidPeriod ? '—' : roomsSavedInPeriod.length}</strong></article>
            </section>

            <section className="analytics-panel" id="admin-analytics" aria-labelledby="analytics-heading">
              <div className="section-heading">
                <div><p className="eyebrow">Analytics</p><h3 id="analytics-heading">What people do in SwiftSpace</h3></div>
                <div className="analytics-period-controls" aria-label="Room date range filter">
                  <label>From<input type="date" value={periodStart} max={periodEnd || undefined} onChange={(event) => setPeriodStart(event.target.value)} /></label>
                  <label>To<input type="date" value={periodEnd} min={periodStart || undefined} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
                </div>
              </div>
              <div className="analytics-function-grid">
                <article className="analytics-function-card">
                  <h4>Rooms saved over time</h4>
                  <strong className="analytics-primary-value">{overview.stats.rooms}</strong>
                  <div className="analytics-chart" aria-label="Saved rooms created per month for the last six months">
                    {overview.monthlyRooms.map((month) => (
                      <div className="chart-column" key={`${month.month}-${month.count}`}>
                        <span className="chart-value">{month.count}</span>
                        <span className="chart-bar" style={{ height: `${Math.max(month.count ? (month.count / Math.max(...overview.monthlyRooms.map(({ count }) => count), 1)) * 100 : 4, 4)}%` }} />
                        <span className="chart-label">{month.month}</span>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="analytics-function-card">
                  <h4>Items in saved layouts</h4>
                  <strong className="analytics-primary-value">{overview.stats.placements}</strong>
                  <div className="selection-summary">
                    <div>
                      <h5>Most selected items</h5>
                      {overview.furnitureSelections?.slice(0, 5).length ? overview.furnitureSelections.slice(0, 5).map((item) => (
                        <div className="selection-row" key={item.itemId}><span>{item.name}</span><strong>{item.count}</strong></div>
                      )) : <p className="muted small">No saved furniture placements yet.</p>}
                    </div>
                  </div>
                </article>

                <article className="analytics-function-card">
                  <h4>Overlap attempts and rearrangements</h4>
                  <strong className="analytics-primary-value">{overview.stats.roomsWithRecordedOverlaps || 0} <small>of {overview.stats.rooms} rooms</small></strong>
                  <div className="analytics-overlap-total"><span>Recorded overlap attempts</span><strong>{overview.stats.overlaps}</strong></div>
                  <div className="analytics-overlap-total"><span>Rearrangement records</span><strong>{overview.stats.rearrangementRecords || 0}</strong></div>
                  <div className="overlap-model-insight" aria-label="Machine learning analysis of overlap records">
                    <div className="overlap-model-heading">
                      <span>Pattern analysis</span>
                      <strong className={overlapModelAtChance ? 'weak' : ''}>
                        {overlapLearning?.status === 'trained'
                          ? overlapModelAtChance ? `${overlapLearning.balancedAccuracy}% · near chance` : `${overlapLearning.balancedAccuracy}% balanced accuracy`
                          : 'Learning from saved rooms'}
                      </strong>
                    </div>
                    {overlapLearning?.status === 'trained' ? (
                      <p>{overlapLearning.signals.map((signal) => `${signal.name}: ${signal.direction}`).join(' · ')}</p>
                    ) : (
                      <p>{overlapLearning?.message || 'More saved room records are needed before patterns can be evaluated.'}</p>
                    )}
                  </div>
                </article>
              </div>
            </section>

            <section className="admin-section overlap-activity-section" id="admin-overlaps">
              <div className="section-heading">
                <div><p className="eyebrow">Quality signals</p><h3>Overlap attempts · all users</h3></div>
                <span className="section-count">{overview.stats.overlaps}</span>
              </div>
              {overview.recentOverlaps.length === 0 ? (
                <p className="muted">No overlap attempts have been recorded.</p>
              ) : (
                <div className="admin-overlap-list" role="list" aria-label="All overlap attempts" tabIndex={0}>
                  {overview.recentOverlaps.map((record) => (
                    <article className="admin-overlap-event admin-overlap-event-compact" key={record._id} role="listitem">
                      <strong>{record.username || 'Unknown user'}</strong>
                      <span>{record.catalogItemId?.name || 'Furniture'}</span>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {showSystemLogs && (
              <section className="admin-section system-logs-section" id="admin-logs">
                <div className="section-heading system-logs-heading">
                  <div><p className="eyebrow">Operations</p><h3>System logs</h3></div>
                  <div className="system-logs-actions">
                    <span className="section-count">{systemLogs.length} recent</span>
                    <button className="btn-ghost" type="button" onClick={() => setSystemLogRefreshKey((key) => key + 1)} disabled={systemLogsLoading}>
                      {systemLogsLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>
                </div>
                <p className="system-logs-note">API requests and failures. Entries expire after 30 days.</p>
                <div className="system-log-filters" role="group" aria-label="Filter system logs by severity">
                  {[
                    { value: 'all', label: 'All' },
                    { value: 'error', label: 'Errors' },
                    { value: 'warn', label: 'Warnings' },
                    { value: 'info', label: 'Info' },
                  ].map((filter) => (
                    <button key={filter.value} type="button" aria-pressed={systemLogLevel === filter.value} onClick={() => setSystemLogLevel(filter.value)}>
                      {filter.label}
                    </button>
                  ))}
                </div>
                {systemLogsError && <p className="form-error" role="alert">{systemLogsError}</p>}
                {systemLogsLoading && systemLogs.length === 0 ? (
                  <p className="muted">Loading system logs…</p>
                ) : filteredSystemLogs.length === 0 ? (
                  <p className="muted">{systemLogs.length ? 'No logs match this filter.' : 'No system logs recorded yet.'}</p>
                ) : (
                  <div className="system-log-table" role="table" aria-label="Recent system logs">
                    <div className="system-log-row system-log-header" role="row">
                      <span role="columnheader">Time</span>
                      <span role="columnheader">Level</span>
                      <span role="columnheader">Request</span>
                      <span role="columnheader">Status</span>
                      <span role="columnheader">Duration</span>
                    </div>
                    {filteredSystemLogs.map((log) => (
                      <div className={`system-log-row ${log.level}`} role="row" key={log._id}>
                        <time role="cell" dateTime={log.createdAt} title={new Date(log.createdAt).toLocaleString()}>{new Date(log.createdAt).toLocaleString()}</time>
                        <span className={`system-log-level ${log.level}`} role="cell">{log.level}</span>
                        <code role="cell" title={log.message}>{log.source === 'request' ? `${log.method} ${log.route}` : log.message}</code>
                        <span className="system-log-status" role="cell">{log.statusCode ?? '—'}</span>
                        <span className="system-log-duration" role="cell">{log.durationMs === null ? '—' : `${log.durationMs} ms`}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <div className="admin-grid">
              <section className="admin-section" id="admin-users">
                <div className="section-heading"><div><p className="eyebrow">People</p><h3>User accounts</h3></div><span className="section-count">{overview.users.length}</span></div>
                <div className="user-list">
                  {sortedUsers.map((account) => (
                    <div className="user-row" key={account._id}>
                      <span className="user-avatar">{account.username.slice(0, 1).toUpperCase()}</span>
                      <span className="user-details"><strong>{account.username}</strong><small>{account.email}</small></span>
                      <span className={`role-badge ${account.role}`}>
                        {account.role === 'interior-designer'
                          ? 'Interior designer'
                          : account.role === 'homeowner' ? 'Homeowner / Client' : 'Admin'}
                      </span>
                      {account.bannedAt && <span className="role-badge banned">Banned</span>}
                      {account._id !== user?.id && (
                        <button
                          className={`user-ban-button${account.bannedAt ? ' unban' : ''}`}
                          type="button"
                          onClick={() => handleToggleUserBan(account)}
                          disabled={banningUserId === account._id}
                          aria-label={`${account.bannedAt ? 'Restore access for' : 'Ban'} ${account.username}`}
                        >
                          {banningUserId === account._id ? 'Saving…' : account.bannedAt ? 'Unban' : 'Ban'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="admin-section">
                <div className="section-heading"><div><p className="eyebrow">Activity</p><h3>All saved layouts</h3></div><span className="section-count">{overview.stats.rooms}</span></div>
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

            <section className="admin-section admin-rearrangement-section">
              <div className="section-heading"><div><p className="eyebrow">Activity</p><h3>Rearrangement records</h3></div><span className="section-count">{overview.stats.rearrangementRecords || 0}</span></div>
              <div className="room-list">
                {(overview.recentRearrangements || []).length === 0 && <p className="muted">No automatic rearrangement records yet. A record is created after each 3 minutes of active room editing.</p>}
                {(overview.recentRearrangements || []).map((record) => (
                  <div className="admin-room-row" key={record._id}>
                    <span><strong>{record.roomName}</strong><small>{record.username} · {record.name}</small></span>
                    <span className="room-size mono" title={new Date(record.createdAt).toLocaleString()}>{formatTimer(record.timerSeconds)}<br />{new Date(record.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="admin-section create-admin-section" id="admin-access">
              <div className="section-heading"><div><p className="eyebrow">Access</p><h3>Add an administrator</h3></div><span className="muted small">Admin-only action</span></div>
              <form className="admin-form" onSubmit={handleCreateAdmin} noValidate>
                <label>Name<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} minLength={3} required /></label>
                <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
                <label>Password<PasswordInput value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={8} required /></label>
                <button className="btn-primary" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create admin'}</button>
              </form>
              {message && <p className="form-success">{message}</p>}
            </section>

          </>
        )}
      </main>
    </div>
  );
}
