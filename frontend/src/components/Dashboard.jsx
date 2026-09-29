import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { firebaseAuth } from '../firebase.js';

export default function Dashboard() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingRoomId, setDeletingRoomId] = useState(null);
  const [roomPendingDeletion, setRoomPendingDeletion] = useState(null);
  const [accountDeletePending, setAccountDeletePending] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountDeleteError, setAccountDeleteError] = useState('');
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

  async function confirmDeleteAccount() {
    setDeletingAccount(true);
    setAccountDeleteError('');
    try {
      await api.delete('/auth/account');
      if (firebaseAuth) await signOut(firebaseAuth).catch(() => {});
      logout();
      navigate('/login', { replace: true });
    } catch (requestError) {
      setAccountDeleteError(requestError.response?.data?.message || 'Could not delete your account.');
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <div className="page">
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
        <div className="dashboard-heading">
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
          </article>
        ))}

        {!isAdmin && (
          <section className="account-settings" aria-labelledby="account-settings-heading">
            <div>
              <p className="eyebrow">Account</p>
              <h2 id="account-settings-heading">Account settings</h2>
              <p className="muted">Permanently remove your account and all saved layouts.</p>
            </div>
            <button
              className="btn-danger"
              type="button"
              onClick={() => {
                setAccountDeleteError('');
                setAccountDeletePending(true);
              }}
            >
              Delete account
            </button>
          </section>
        )}
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

      {accountDeletePending && (
        <div className="delete-dialog-backdrop" role="presentation">
          <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="account-delete-title">
            <div className="delete-dialog-icon" aria-hidden="true">×</div>
            <p className="eyebrow">Account settings</p>
            <h2 id="account-delete-title">Delete your account?</h2>
            <p className="muted">Your account and all saved rooms will be permanently deleted. This cannot be undone.</p>
            {accountDeleteError && <p className="form-error" role="alert">{accountDeleteError}</p>}
            <div className="delete-dialog-actions">
              <button className="btn-ghost" type="button" onClick={() => setAccountDeletePending(false)} disabled={deletingAccount}>
                Keep account
              </button>
              <button className="btn-danger" type="button" onClick={confirmDeleteAccount} disabled={deletingAccount}>
                {deletingAccount ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
