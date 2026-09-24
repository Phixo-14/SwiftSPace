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

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Studio Grid</p>
        </div>
        <div className="topbar-actions">
          <span className="who">{user?.username}</span>
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
    </div>
  );
}
