import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function Dashboard() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingRoomId, setDeletingRoomId] = useState(null);
  const { user, logout } = useAuth();
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

  async function handleDelete(room) {
    if (!window.confirm(`Delete "${room.roomName}"? This cannot be undone.`)) return;

    setDeletingRoomId(room._id);
    setError('');
    try {
      await api.delete(`/rooms/${room._id}`);
      setRooms((currentRooms) => currentRooms.filter(({ _id }) => _id !== room._id));
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
                onClick={() => handleDelete(room)}
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
    </div>
  );
}
