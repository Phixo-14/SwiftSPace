import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api.js';
import ItemGlyph from './ItemGlyph.jsx';

function createFullFloor(dimensions) {
  return Array.from({ length: dimensions.width * dimensions.length }, (_, index) => ({
    x: index % dimensions.width,
    y: Math.floor(index / dimensions.width),
  }));
}

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
    return <main className="shared-room-page"><section className="shared-room-message"><p className="eyebrow">SwiftSpace</p><h1>Shared room unavailable</h1><p className="muted">{error}</p><Link className="btn-primary" to="/login">Sign in</Link></section></main>;
  }

  if (!room) {
    return <main className="shared-room-page"><p className="muted">Loading shared room…</p></main>;
  }

  const floorCells = room.floorCells?.length ? room.floorCells : createFullFloor(room.dimensions);

  return (
    <main className="shared-room-page">
      <header className="shared-room-header">
        <div><p className="eyebrow">SwiftSpace / Shared layout</p><h1>{room.roomName}</h1></div>
        <Link className="btn-ghost" to="/login">Sign in to create your own</Link>
      </header>
      <section className="shared-room-stage" style={{ '--shared-width': room.dimensions.width, '--shared-length': room.dimensions.length, '--shared-floor': room.floorColor, '--shared-grid': room.gridColor }}>
        <div className="shared-room-grid" aria-label={`Read-only view of ${room.roomName}`}>
          {floorCells.map(({ x, y }) => <span className="shared-room-cell" key={`${x},${y}`} style={{ gridColumn: x + 1, gridRow: y + 1 }} />)}
          {(room.placedItems || []).map((placedItem) => {
            const item = placedItem.catalogItemId;
            if (!item) return null;
            const footprintWidth = placedItem.size?.width || item.footprint.width;
            const footprintLength = placedItem.size?.length || item.footprint.length;
            const radians = (placedItem.rotation * Math.PI) / 180;
            const cosine = Math.abs(Math.cos(radians));
            const sine = Math.abs(Math.sin(radians));
            const width = Math.max(0.25, footprintWidth * cosine + footprintLength * sine);
            const length = Math.max(0.25, footprintWidth * sine + footprintLength * cosine);
            return (
              <div
                className="shared-room-item"
                key={`${placedItem.gridX}-${placedItem.gridY}-${item._id}`}
                style={{ left: `${(placedItem.gridX / room.dimensions.width) * 100}%`, top: `${(placedItem.gridY / room.dimensions.length) * 100}%`, width: `${(width / room.dimensions.width) * 100}%`, height: `${(length / room.dimensions.length) * 100}%` }}
                title={item.name}
              >
                <ItemGlyph
                  iconKey={item.iconKey}
                  color={placedItem.customColor || item.defaultColor}
                  rotation={placedItem.rotation}
                  footprintWidth={footprintWidth}
                  footprintLength={footprintLength}
                />
              </div>
            );
          })}
        </div>
      </section>
      <p className="shared-room-note">Read-only layout · {room.dimensions.width} × {room.dimensions.length} grid</p>
    </main>
  );
}
