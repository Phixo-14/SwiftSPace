import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function Dashboard() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingRoomId, setDeletingRoomId] = useState(null);
  const [roomPendingDeletion, setRoomPendingDeletion] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareRevoking, setShareRevoking] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api
      .get('/rooms')
      .then(({ data }) => {
        if (!cancelled) setRooms(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your rooms.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function requestDelete(room) {
    setRoomPendingDeletion(room);
  }

  async function confirmDelete() {
    if (!roomPendingDeletion) return;

    setDeletingRoomId(roomPendingDeletion._id);
    setError('');
    try {
      await api.delete(`/rooms/${roomPendingDeletion._id}`);
      setRooms((currentRooms) => currentRooms.filter(({ _id }) => _id !== roomPendingDeletion._id));
      setRoomPendingDeletion(null);
    } catch {
      setError('Could not delete that room.');
    } finally {
      setDeletingRoomId(null);
    }
  }

  async function openShare(room) {
    setShareTarget(room);
    setShareUrl('');
    setShareError('');
    setShareMessage('');
    setShareCopied(false);
    setShareLoading(true);
    try {
      const { data } = await api.post(`/rooms/${room._id}/share`);
      setShareUrl(`${window.location.origin}/share/${data.token}`);
    } catch (requestError) {
      setShareError(requestError.response?.data?.message || 'Could not create a share link.');
    } finally {
      setShareLoading(false);
    }
  }

  async function revokeShare() {
    if (!shareTarget) return;
    setShareRevoking(true);
    setShareError('');
    setShareMessage('');
    try {
      await api.delete(`/rooms/${shareTarget._id}/share`);
      setShareUrl('');
      setShareMessage('This share link has been revoked.');
    } catch (requestError) {
      setShareError(requestError.response?.data?.message || 'Could not revoke the share link.');
    } finally {
      setShareRevoking(false);
    }
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setShareMessage('Link copied to clipboard.');
    } catch {
      setShareError('Could not copy the link. Select and copy it manually.');
    }
  }

  return (
    <div className="page dashboard-page">
      <aside className="admin-hover-sidebar" aria-label="Workspace navigation">
        <div className="admin-sidebar-brand">
          <span className="admin-brand-mark">+</span>
          <span className="admin-sidebar-label">Studio Grid</span>
        </div>
        <nav className="admin-sidebar-nav">
          <a href="#dashboard-overview"><span className="admin-nav-icon">⌂</span><span className="admin-sidebar-label">My layouts</span></a>
          <Link to="/room/new"><span className="admin-nav-icon">+</span><span className="admin-sidebar-label">New room</span></Link>
          {!isAdmin && <Link to="/account"><span className="admin-nav-icon">◎</span><span className="admin-sidebar-label">Manage account</span></Link>}
        </nav>
      </aside>
      <header className="topbar">
        <div>
          <p className="eyebrow">Studio Grid</p>
        </div>
        <div className="topbar-actions">
          <span className="who">{user?.username}</span>
          {!isAdmin && <span className="who">{user?.role === 'interior-designer' ? 'Interior Designer' : 'Homeowner / Client'}</span>}
          {isAdmin && <span className="who">Admin</span>}
          {isAdmin && <Link to="/admin" className="btn-ghost">Admin dashboard</Link>}
          <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-heading" id="dashboard-overview">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>Your layouts</h1>
          </div>
          <p className="dashboard-subtitle">Saved rooms and new ideas, all in one place.</p>
        </div>
        <Link to="/room/new" className="new-room-card">
          <span className="new-room-icon">+</span>
          <span className="new-room-title">New room</span>
          <span className="new-room-copy">Start with a fresh floor plan</span>
        </Link>

        {loading && <p className="muted">Loading rooms…</p>}
        {error && <p className="form-error">{error}</p>}

        {!loading && !error && rooms.length === 0 && (
          <p className="muted">No rooms yet — start one and it will show up here.</p>
        )}

        {rooms.map((room) => (
          <article className="room-card" key={room._id}>
            <Link to={`/room/${room._id}`} className="room-preview" aria-label={`Open ${room.roomName}`}>
              <span className="room-preview-grid">
                {Array.from({ length: 12 }, (_, index) => (
                  <span className={`room-preview-cell ${index === 5 ? 'occupied' : ''}`} key={index} />
                ))}
              </span>
            </Link>
            <div className="room-card-top">
              <Link to={`/room/${room._id}`}>
                <h3>{room.roomName}</h3>
              </Link>
              <button
                className="delete-room-btn"
                type="button"
                aria-label={`Delete ${room.roomName}`}
                onClick={() => requestDelete(room)}
                disabled={deletingRoomId === room._id}
              >
                ✕
              </button>
            </div>
            <Link to={`/room/${room._id}`}>
              <p className="room-meta mono">
                {room.dimensions.width} × {room.dimensions.length} grid
              </p>
              <p className="room-meta">Updated {new Date(room.updatedAt).toLocaleDateString()}</p>
            </Link>
            <button className="btn-ghost room-share-button" type="button" onClick={() => openShare(room)}>
              Share layout
            </button>
          </article>
        ))}

      </main>

      {roomPendingDeletion && (
        <div className="delete-dialog-backdrop" role="presentation">
          <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
            <div className="delete-dialog-icon" aria-hidden="true">×</div>
            <p className="eyebrow">Remove layout</p>
            <h2 id="delete-dialog-title">Delete {roomPendingDeletion.roomName}?</h2>
            <p className="muted">This room and its furniture arrangement will be permanently removed.</p>
            <div className="delete-dialog-actions">
              <button className="btn-ghost" type="button" onClick={() => setRoomPendingDeletion(null)} disabled={deletingRoomId !== null}>
                Keep room
              </button>
              <button className="btn-danger" type="button" onClick={confirmDelete} disabled={deletingRoomId !== null}>
                {deletingRoomId ? 'Deleting…' : 'Delete room'}
              </button>
            </div>
          </section>
        </div>
      )}

      {shareTarget && (
        <div className="delete-dialog-backdrop" role="presentation">
          <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
            <p className="eyebrow">Read-only link</p>
            <h2 id="share-dialog-title">Share {shareTarget.roomName}</h2>
            <p className="muted">Anyone with this link can view the current room layout. You can revoke it at any time.</p>
            {shareLoading && <p className="muted">Preparing share link…</p>}
            {shareError && <p className="form-error" role="alert">{shareError}</p>}
            {shareMessage && <p className="form-success" role="status">{shareMessage}</p>}
            {shareUrl && (
              <div className="share-link-control">
                <input aria-label="Read-only share link" readOnly value={shareUrl} onFocus={(event) => event.target.select()} />
                <button className="btn-primary" type="button" onClick={copyShareLink}>{shareCopied ? 'Copied' : 'Copy link'}</button>
              </div>
            )}
            <div className="delete-dialog-actions">
              {shareUrl && <button className="btn-ghost danger" type="button" onClick={revokeShare} disabled={shareRevoking}>{shareRevoking ? 'Revoking…' : 'Revoke link'}</button>}
              <button className="btn-ghost" type="button" onClick={() => setShareTarget(null)} disabled={shareLoading || shareRevoking}>Close</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
