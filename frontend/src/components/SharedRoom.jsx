import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api.js';
import ItemGlyph from './ItemGlyph.jsx';

export default function SharedRoom() {
  const { token } = useParams();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/shared-rooms/${token}`)
      .then(({ data }) => setRoom(data))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Could not load shared room.'));
  }, [token]);

  if (error) {
    return <main className="shared-room-page"><section className="shared-room-message"><p className="eyebrow">Studio Grid</p><h1>Shared room unavailable</h1><p className="muted">{error}</p><Link className="btn-primary" to="/login">Sign in</Link></section></main>;
  }

  if (!room) {
    return <main className="shared-room-page"><p className="muted">Loading shared room…</p></main>;
  }

  return (
    <main className="shared-room-page">
      <header className="shared-room-header">
        <div><p className="eyebrow">Studio Grid / Shared layout</p><h1>{room.roomName}</h1></div>
        <Link className="btn-ghost" to="/login">Sign in to create your own</Link>
      </header>
      <section className="shared-room-stage" style={{ '--shared-width': room.dimensions.width, '--shared-length': room.dimensions.length, '--shared-floor': room.floorColor, '--shared-grid': room.gridColor }}>
        <div className="shared-room-grid" aria-label={`Read-only view of ${room.roomName}`}>
          {Array.from({ length: room.dimensions.width * room.dimensions.length }, (_, index) => <span className="shared-room-cell" key={index} />)}
          {(room.placedItems || []).map((placedItem) => {
            const item = placedItem.catalogItemId;
            if (!item) return null;
            return (
              <div
                className="shared-room-item"
                key={`${placedItem.gridX}-${placedItem.gridY}-${item._id}`}
                style={{ left: `${(placedItem.gridX / room.dimensions.width) * 100}%`, top: `${(placedItem.gridY / room.dimensions.length) * 100}%`, width: `${(item.footprint.length / room.dimensions.width) * 100}%`, height: `${(item.footprint.width / room.dimensions.length) * 100}%` }}
                title={item.name}
              >
                <ItemGlyph iconKey={item.iconKey} color={placedItem.customColor || item.defaultColor} rotation={placedItem.rotation} />
              </div>
            );
          })}
        </div>
      </section>
      <p className="shared-room-note">Read-only layout · {room.dimensions.width} × {room.dimensions.length} grid</p>
    </main>
  );
}
