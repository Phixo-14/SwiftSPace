import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../api.js';
import ItemGlyph from './ItemGlyph.jsx';

const DEFAULT_DIMENSIONS = { width: 6, length: 6 };
const FLOOR_OPTIONS = [
  { name: 'Light Oak', floor: '#BCA17A', grid: '#8C7455', workspace: '#4B5048' },
  { name: 'Honey Brown', floor: '#9E6D49', grid: '#704A32', workspace: '#454A46' },
  { name: 'Soft Beige', floor: '#C9BEAA', grid: '#958A78', workspace: '#565B59' },
];
const FURNITURE_CATEGORIES = [
  { value: 'sleeping', label: 'Beds', icon: '🛏' },
  { value: 'seating', label: 'Chairs & Sofas', icon: '🪑' },
  { value: 'storage', label: 'Racks & Storage', icon: '🗄' },
  { value: 'greenery', label: 'Plants & Decor', icon: '🌱' },
  { value: 'lighting', label: 'Lighting', icon: '💡' },
  { value: 'surface', label: 'Tables & Surfaces', icon: '▱' },
];
export default function RoomEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState([]);
  const [roomName, setRoomName] = useState('Untitled Studio');
  const [dimensions, setDimensions] = useState(DEFAULT_DIMENSIONS);
  const [floorColor, setFloorColor] = useState(FLOOR_OPTIONS[0].floor);
  const [gridColor, setGridColor] = useState(FLOOR_OPTIONS[0].grid);
  const [workspaceColor, setWorkspaceColor] = useState(FLOOR_OPTIONS[0].workspace);
  const [placedItems, setPlacedItems] = useState([]);
  const [armedItemId, setArmedItemId] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState(null); // "x,y" of a placed item
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load catalog once, and the existing room if we're editing one.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const catalogRes = await api.get('/catalog/items');
        if (cancelled) return;
        setCatalog(catalogRes.data);

        if (!isNew) {
          const roomRes = await api.get(`/rooms/${id}`);
          if (cancelled) return;
          setRoomName(roomRes.data.roomName);
          setDimensions(roomRes.data.dimensions);
          setFloorColor(roomRes.data.floorColor || FLOOR_OPTIONS[0].floor);
          setGridColor(roomRes.data.gridColor || FLOOR_OPTIONS[0].grid);
          const savedFloor = FLOOR_OPTIONS.find((option) => option.floor === roomRes.data.floorColor);
          setWorkspaceColor(savedFloor?.workspace || FLOOR_OPTIONS[0].workspace);
          setPlacedItems(roomRes.data.placedItems);
        }
      } catch (err) {
        if (!cancelled) setStatus('Could not load room data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const catalogById = useMemo(() => {
    const map = new Map();
    catalog.forEach((c) => map.set(c._id, c));
    return map;
  }, [catalog]);

  const visibleCatalog = useMemo(
    () => catalog.filter((item) => item.category === selectedCategory
      && item.name.toLowerCase().includes(catalogSearch.toLowerCase().trim())),
    [catalog, selectedCategory, catalogSearch]
  );

  const selectedCategoryLabel = FURNITURE_CATEGORIES.find(
    (category) => category.value === selectedCategory
  );

  function getOccupiedCells(item, rotation = item.rotation) {
    const catalogItem = catalogById.get(item.catalogItemId);
    if (!catalogItem) return [{ x: 0, y: 0 }];

    // The item's origin is its pivot cell. A catalog width extends down from
    // that pivot and catalog length extends right before rotation.
    const cells = [];
    for (let y = 0; y < catalogItem.footprint.width; y += 1) {
      for (let x = 0; x < catalogItem.footprint.length; x += 1) {
        let rotatedX = x;
        let rotatedY = y;
        for (let quarterTurn = 0; quarterTurn < rotation / 90; quarterTurn += 1) {
          [rotatedX, rotatedY] = [rotatedY, -rotatedX];
        }
        cells.push({ x: rotatedX, y: rotatedY });
      }
    }
    return cells;
  }

  function getOccupiedBounds(cells) {
    const xs = cells.map(({ x }) => x);
    const ys = cells.map(({ y }) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
      minX,
      minY,
      width: maxX - minX + 1,
      length: maxY - minY + 1,
    };
  }

  const itemsByCell = useMemo(() => {
    const map = new Map();
    placedItems.forEach((item) => {
      getOccupiedCells(item).forEach(({ x, y }) => {
        map.set(`${item.gridX + x},${item.gridY + y}`, item);
      });
    });
    return map;
  }, [placedItems, catalogById]);

  const selectedItem = selectedKey ? itemsByCell.get(selectedKey) : null;

  const handleCellClick = useCallback(
    (x, y) => {
      const key = `${x},${y}`;
      const existing = itemsByCell.get(key);

      if (existing) {
        setSelectedKey(key);
        setArmedItemId(null);
        return;
      }

      if (armedItemId) {
        const candidate = { catalogItemId: armedItemId, gridX: x, gridY: y, rotation: 0 };
        const occupiedCells = getOccupiedCells(candidate);
        const isClear = occupiedCells.every(({ x: offsetX, y: offsetY }) => {
          const cellX = x + offsetX;
          const cellY = y + offsetY;
          return cellX >= 0 && cellY >= 0
            && cellX < dimensions.width && cellY < dimensions.length
            && !itemsByCell.has(`${cellX},${cellY}`);
        });

        if (!isClear) {
          setStatus('That furniture footprint does not fit in the selected space.');
          return;
        }

        setPlacedItems((prev) => [
          ...prev,
          { catalogItemId: armedItemId, gridX: x, gridY: y, rotation: 0, customColor: null },
        ]);
        setSelectedKey(key);
        setStatus('');
      } else {
        setSelectedKey(null);
      }
    },
    [armedItemId, catalogById, dimensions, itemsByCell]
  );

  function setItemRotation(nextRotation) {
    if (!selectedItem) return;
    if (selectedItem.rotation === nextRotation) return;

    const isClear = getOccupiedCells(selectedItem, nextRotation).every(({ x, y }) => {
      const cellX = selectedItem.gridX + x;
      const cellY = selectedItem.gridY + y;
      const occupant = itemsByCell.get(`${cellX},${cellY}`);
      return cellX >= 0 && cellY >= 0
        && cellX < dimensions.width && cellY < dimensions.length
        && (!occupant || occupant === selectedItem);
    });

    if (!isClear) {
      setStatus('That rotation would overlap another item or leave the room.');
      return;
    }

    setPlacedItems((prev) =>
      prev.map((item) =>
        item.gridX === selectedItem.gridX && item.gridY === selectedItem.gridY
          ? { ...item, rotation: nextRotation }
          : item
      )
    );
    setStatus('');
  }

  function rotateSelected() {
    if (!selectedItem) return;
    setItemRotation((selectedItem.rotation + 90) % 360);
  }

  function moveItem(itemToMove, gridX, gridY) {
    const candidate = { ...itemToMove, gridX, gridY };
    const isClear = getOccupiedCells(candidate).every(({ x, y }) => {
      const cellX = gridX + x;
      const cellY = gridY + y;
      const occupant = itemsByCell.get(`${cellX},${cellY}`);
      return cellX >= 0 && cellY >= 0
        && cellX < dimensions.width && cellY < dimensions.length
        && (!occupant || occupant === itemToMove);
    });

    if (!isClear) {
      setStatus('That furniture footprint does not fit in the selected space.');
      return;
    }

    setPlacedItems((prev) =>
      prev.map((item) => (item === itemToMove ? { ...item, gridX, gridY } : item))
    );
    setSelectedKey(`${gridX},${gridY}`);
    setStatus('');
  }

  function handleFurnitureDragStart(event, item) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify({
      gridX: item.gridX,
      gridY: item.gridY,
      catalogItemId: item.catalogItemId,
    }));
  }

  function handleCellDrop(event, gridX, gridY) {
    event.preventDefault();
    const data = event.dataTransfer.getData('application/json');
    if (!data) return;
    const dragged = JSON.parse(data);
    const item = placedItems.find((candidate) =>
      candidate.gridX === dragged.gridX
      && candidate.gridY === dragged.gridY
      && candidate.catalogItemId === dragged.catalogItemId
    );
    if (item) moveItem(item, gridX, gridY);
  }

  function removeSelected() {
    if (!selectedItem) return;
    removeItem(selectedItem);
  }

  function removeItem(itemToRemove) {
    setPlacedItems((prev) =>
      prev.filter((item) => !(item.gridX === itemToRemove.gridX && item.gridY === itemToRemove.gridY))
    );
    if (selectedKey === `${itemToRemove.gridX},${itemToRemove.gridY}`) {
      setSelectedKey(null);
    }
  }

  function recolorSelected(color) {
    if (!selectedItem) return;
    setPlacedItems((prev) =>
      prev.map((item) =>
        item.gridX === selectedItem.gridX && item.gridY === selectedItem.gridY
          ? { ...item, customColor: color }
          : item
      )
    );
  }

  async function handleSave() {
    setSaving(true);
    setStatus('');
    const payload = { roomName, dimensions, floorColor, gridColor, placedItems };
    try {
      if (isNew) {
        const { data } = await api.post('/rooms', payload);
        setStatus('Saved.');
        navigate(`/room/${data._id}`, { replace: true });
      } else {
        await api.put(`/rooms/${id}`, payload);
        setStatus('Saved.');
      }
    } catch (err) {
      const details = err.response?.data?.details;
      setStatus(details ? details.join(' ') : err.response?.data?.message || 'Could not save room.');
    } finally {
      setSaving(false);
    }
  }

  function updateDimension(axis, value) {
    const n = Math.max(1, Math.min(50, Number(value) || 1));
    setDimensions((prev) => ({ ...prev, [axis]: n }));
  }

  function updateZoom(nextZoom) {
    setZoom(Math.max(0.6, Math.min(1.8, Number(nextZoom.toFixed(2)))));
  }

  const cells = [];
  for (let y = 0; y < dimensions.length; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      cells.push({ x, y });
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted" style={{ padding: '2rem' }}>Loading canvas…</p>
      </div>
    );
  }

  return (
    <div className="page editor-page">
      <header className="topbar">
        <div className="editor-title-block">
          <Link to="/" className="back-link">← Dashboard</Link>
          <input
            className="room-name-input"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            aria-label="Room name"
          />
        </div>
        <div className="topbar-actions">
          {status && <span className="status-text">{status}</span>}
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save canvas'}
          </button>
        </div>
      </header>

      <div
        className="editor-body"
        style={{ '--floor-color': floorColor, '--workspace-color': workspaceColor }}
      >
        <aside className="catalog-panel">
          <section className="catalog-section furniture-section">
            <h2 className="catalog-section-title">Furniture</h2>
            {selectedCategory ? (
              <>
                <button
                  className="catalog-back-button"
                  type="button"
                  onClick={() => {
                    setSelectedCategory(null);
                    setCatalogSearch('');
                  }}
                >
                  <span aria-hidden="true">←</span>
                  <span>All furniture categories</span>
                </button>
                <div className="selected-category-heading">
                  <span aria-hidden="true">{selectedCategoryLabel?.icon}</span>
                  <span>{selectedCategoryLabel?.label}</span>
                </div>
                <label className="catalog-search">
                  <span aria-hidden="true">⌕</span>
                  <span className="sr-only">Search furniture</span>
                  <input
                    type="search"
                    placeholder="Search furniture"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                  />
                </label>
                <div className="catalog-list">
                  {visibleCatalog.map((item) => (
                    <button
                      key={item._id}
                      className={`catalog-item ${armedItemId === item._id ? 'armed' : ''}`}
                      aria-label={`${item.name}, ${item.footprint.width} by ${item.footprint.length} footprint`}
                      onClick={() => {
                        setArmedItemId((prev) => (prev === item._id ? null : item._id));
                        setSelectedKey(null);
                      }}
                    >
                      <ItemGlyph iconKey={item.iconKey} color={item.defaultColor} />
                      <span className="catalog-item-name">{item.name}</span>
                      <span className="catalog-item-footprint mono">
                        {item.footprint.width}×{item.footprint.length}
                      </span>
                    </button>
                  ))}
                </div>
                {!visibleCatalog.length && <p className="muted small">No furniture matches your search.</p>}
              </>
            ) : (
              <div className="furniture-category-list">
                {FURNITURE_CATEGORIES.map((category) => (
                  <button
                    className="furniture-category"
                    type="button"
                    key={category.value}
                    onClick={() => setSelectedCategory(category.value)}
                  >
                    <span aria-hidden="true">{category.icon}</span>
                    <span>{category.label}</span>
                    <span className="build-tool-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          {armedItemId && <p className="hint">Click an empty cell to place it.</p>}
        </aside>

        <main className="canvas-wrap">
          <div className="workspace-controls" aria-label="Workspace zoom controls">
            <button type="button" onClick={() => updateZoom(zoom - 0.1)} disabled={zoom <= 0.6}>
              −
            </button>
            <button type="button" onClick={() => updateZoom(1)}>Reset</button>
            <button type="button" onClick={() => updateZoom(zoom + 0.1)} disabled={zoom >= 1.8}>
              +
            </button>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <div className="workspace-zoom" style={{ transform: `scale(${zoom})` }}>
            <div
              className="iso-grid"
              style={{
                '--cols': dimensions.width,
                '--rows': dimensions.length,
                '--grid-color': gridColor,
              }}
            >
              {cells.map(({ x, y }) => {
                const key = `${x},${y}`;
                const placed = itemsByCell.get(key);
                const isSelected = selectedKey === key;
                return (
                  <button
                    key={key}
                    className={`grid-cell ${placed ? 'occupied' : ''} ${isSelected ? 'selected' : ''}`}
                    style={{ gridColumn: x + 1, gridRow: y + 1 }}
                    onClick={() => handleCellClick(x, y)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleCellDrop(event, x, y)}
                    aria-label={`Cell ${x}, ${y}`}
                  />
                );
              })}
              {placedItems.map((item) => {
                const catalogItem = catalogById.get(item.catalogItemId);
                if (!catalogItem) return null;
                const occupiedCells = getOccupiedCells(item);
                const bounds = getOccupiedBounds(occupiedCells);
                const isSelected = selectedKey === `${item.gridX},${item.gridY}`
                  || itemsByCell.get(selectedKey) === item;
                return (
                  <button
                    className={`placed-item ${isSelected ? 'selected' : ''}`}
                    key={`${item.gridX},${item.gridY}-${item.catalogItemId}`}
                    type="button"
                    draggable
                    onDragStart={(event) => handleFurnitureDragStart(event, item)}
                    style={{
                      '--item-color': item.customColor || catalogItem.defaultColor,
                      '--item-rotation': `${item.rotation}deg`,
                      left: `${(item.gridX + bounds.minX) * 43 + 1}px`,
                      top: `${(item.gridY + bounds.minY) * 43 + 1}px`,
                      width: `${bounds.width * 42 + (bounds.width - 1)}px`,
                      height: `${bounds.length * 42 + (bounds.length - 1)}px`,
                    }}
                    onClick={() => {
                      setSelectedKey(`${item.gridX},${item.gridY}`);
                      setArmedItemId(null);
                    }}
                    aria-label={`${catalogItem.name}, ${bounds.width} by ${bounds.length} footprint`}
                  >
                    <span className="placed-item-glyph">
                      <ItemGlyph
                        iconKey={catalogItem.iconKey}
                        color={item.customColor || catalogItem.defaultColor}
                        rotation={item.rotation}
                        isometric
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </main>

        <aside className="inspector-panel">
          <p className="panel-heading">Room</p>
          <label className="inspector-field">
            Width
            <input
              type="number"
              className="mono"
              min={1}
              max={50}
              value={dimensions.width}
              onChange={(e) => updateDimension('width', e.target.value)}
            />
          </label>
          <label className="inspector-field">
            Length
            <input
              type="number"
              className="mono"
              min={1}
              max={50}
              value={dimensions.length}
              onChange={(e) => updateDimension('length', e.target.value)}
            />
          </label>
          <p className="mono muted small">{placedItems.length} item(s) placed</p>

          <div className="floor-options">
            <p className="panel-heading">Floor &amp; grid</p>
            <div className="floor-swatches">
              {FLOOR_OPTIONS.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  className={`floor-swatch ${floorColor === option.floor ? 'selected' : ''}`}
                  style={{ '--swatch-floor': option.floor, '--swatch-grid': option.grid }}
                  aria-label={`${option.name} floor and grid`}
                  title={`${option.name} floor and grid`}
                  onClick={() => {
                    setFloorColor(option.floor);
                    setGridColor(option.grid);
                    setWorkspaceColor(option.workspace);
                  }}
                />
              ))}
            </div>
          </div>

          {placedItems.length > 0 && (
            <div className="placed-items-list">
              <p className="panel-heading">Placed furniture</p>
              {placedItems.map((item) => {
                const catalogItem = catalogById.get(item.catalogItemId);
                if (!catalogItem) return null;
                const itemKey = `${item.gridX},${item.gridY}`;
                return (
                  <div className="placed-item-row" key={itemKey}>
                    <button
                      className={`placed-item-name ${selectedKey === itemKey ? 'selected' : ''}`}
                      type="button"
                      onClick={() => setSelectedKey(itemKey)}
                    >
                      {catalogItem.name}
                      <span className="mono muted small">({item.gridX}, {item.gridY})</span>
                    </button>
                    <button
                      className="btn-ghost danger placed-item-remove"
                      type="button"
                      onClick={() => removeItem(item)}
                      aria-label={`Remove ${catalogItem.name}`}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="divider" />

          <p className="panel-heading">Selected item</p>
          {selectedItem && catalogById.get(selectedItem.catalogItemId) ? (
            <div className="inspector-selected">
              <p className="selected-name">{catalogById.get(selectedItem.catalogItemId).name}</p>
              <p className="mono muted small">
                grid ({selectedItem.gridX}, {selectedItem.gridY}) · {selectedItem.rotation}°
              </p>
              <div className="inspector-actions">
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={rotateSelected}
                  aria-label={`Rotate furniture to ${(selectedItem.rotation + 90) % 360} degrees`}
                >
                  ↻ Rotate 90°
                </button>
                <button className="btn-ghost danger" onClick={removeSelected}>Remove</button>
              </div>
              <label className="inspector-field">
                Color
                <input
                  type="color"
                  value={
                    selectedItem.customColor ||
                    catalogById.get(selectedItem.catalogItemId).defaultColor
                  }
                  onChange={(e) => recolorSelected(e.target.value)}
                />
              </label>
            </div>
          ) : (
            <p className="muted small">Click a placed item on the grid to edit it.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
