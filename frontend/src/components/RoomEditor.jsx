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

function readDraft(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export default function RoomEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const draftStorageKey = `studio-grid-draft:${id || 'new'}`;
  const storedDraft = readDraft(draftStorageKey);

  const [catalog, setCatalog] = useState([]);
  const [roomName, setRoomName] = useState(storedDraft?.roomName || 'Untitled Studio');
  const [timerSeconds, setTimerSeconds] = useState(storedDraft?.timerSeconds || 0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [dimensions, setDimensions] = useState(storedDraft?.dimensions || DEFAULT_DIMENSIONS);
  const [floorColor, setFloorColor] = useState(storedDraft?.floorColor || FLOOR_OPTIONS[0].floor);
  const [gridColor, setGridColor] = useState(storedDraft?.gridColor || FLOOR_OPTIONS[0].grid);
  const [workspaceColor, setWorkspaceColor] = useState(() => {
    const draftFloor = FLOOR_OPTIONS.find((option) => option.floor === storedDraft?.floorColor);
    return draftFloor?.workspace || FLOOR_OPTIONS[0].workspace;
  });
  const [placedItems, setPlacedItems] = useState(storedDraft?.placedItems || []);
  const [overlapRecords, setOverlapRecords] = useState(storedDraft?.overlapRecords || []);
  const [armedItemId, setArmedItemId] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState(null); // "x,y" of a placed item
  const [hoverCell, setHoverCell] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);

  // Load catalog once, and the existing room if we're editing one.
  useEffect(() => {
    let cancelled = false;

    function restoreDraft() {
      const savedDraft = window.localStorage.getItem(draftStorageKey);
      if (!savedDraft) return;

      try {
        const draft = JSON.parse(savedDraft);
        setRoomName(draft.roomName || 'Untitled Studio');
        setTimerSeconds(draft.timerSeconds || 0);
        setDimensions(draft.dimensions || DEFAULT_DIMENSIONS);
        setFloorColor(draft.floorColor || FLOOR_OPTIONS[0].floor);
        setGridColor(draft.gridColor || FLOOR_OPTIONS[0].grid);
        const draftFloor = FLOOR_OPTIONS.find((option) => option.floor === draft.floorColor);
        setWorkspaceColor(draftFloor?.workspace || FLOOR_OPTIONS[0].workspace);
        setPlacedItems(draft.placedItems || []);
        setOverlapRecords(draft.overlapRecords || []);
        setStatus('Restored unsaved draft.');
      } catch {
        window.localStorage.removeItem(draftStorageKey);
      }
    }

    async function load() {
      try {
        const catalogRes = await api.get('/catalog/items');
        if (cancelled) return;
        setCatalog(catalogRes.data);

        if (!isNew) {
          const roomRes = await api.get(`/rooms/${id}`);
          if (cancelled) return;
          const validCatalogIds = new Set(catalogRes.data.map((item) => item._id.toString()));
          const validPlacedItems = (roomRes.data.placedItems || []).filter((item) =>
            validCatalogIds.has(item.catalogItemId?.toString())
          );
          setRoomName(roomRes.data.roomName);
          setTimerSeconds(roomRes.data.timerSeconds || 0);
          setDimensions(roomRes.data.dimensions);
          setFloorColor(roomRes.data.floorColor || FLOOR_OPTIONS[0].floor);
          setGridColor(roomRes.data.gridColor || FLOOR_OPTIONS[0].grid);
          const savedFloor = FLOOR_OPTIONS.find((option) => option.floor === roomRes.data.floorColor);
          setWorkspaceColor(savedFloor?.workspace || FLOOR_OPTIONS[0].workspace);
          setPlacedItems(validPlacedItems);
          setOverlapRecords(roomRes.data.overlapRecords || []);
        }

        restoreDraft();
      } catch (err) {
        restoreDraft();
        if (!cancelled) setStatus('Could not load room data.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setDraftReady(true);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [draftStorageKey, id, isNew]);

  useEffect(() => {
    if (loading || !draftReady) return;
    window.localStorage.setItem(draftStorageKey, JSON.stringify({
      roomName,
      timerSeconds,
      dimensions,
      floorColor,
      gridColor,
      placedItems,
      overlapRecords,
    }));
  }, [dimensions, draftReady, draftStorageKey, floorColor, gridColor, loading, overlapRecords, placedItems, roomName, timerSeconds]);

  useEffect(() => {
    if (!timerRunning) return undefined;
    const timer = window.setInterval(() => {
      setTimerSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timerRunning]);

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

    const rawCells = [];
    let minRotatedX = 0;
    let minRotatedY = 0;

    for (let y = 0; y < catalogItem.footprint.width; y += 1) {
      for (let x = 0; x < catalogItem.footprint.length; x += 1) {
        let rotatedX = x;
        let rotatedY = y;
        for (let quarterTurn = 0; quarterTurn < rotation / 90; quarterTurn += 1) {
          [rotatedX, rotatedY] = [rotatedY, -rotatedX];
        }

        if (rotatedX < minRotatedX) minRotatedX = rotatedX;
        if (rotatedY < minRotatedY) minRotatedY = rotatedY;

        rawCells.push({ x: rotatedX, y: rotatedY });
      }
    }

    return rawCells.map(cell => ({
      x: cell.x - minRotatedX,
      y: cell.y - minRotatedY
    }));
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
        const cellX = item.gridX + x;
        const cellY = item.gridY + y;
        map.set(`${cellX},${cellY}`, item);
      });
    });
    return map;
  }, [placedItems, catalogById]);

  const selectedItem = selectedKey ? itemsByCell.get(selectedKey) : null;

  const previewItem = useMemo(() => {
    if (!hoverCell) return null;

    const activeItem = draggedItem || (armedItemId ? {
      catalogItemId: armedItemId,
      gridX: hoverCell.x,
      gridY: hoverCell.y,
      rotation: selectedItem ? selectedItem.rotation : 0,
    } : null);

    if (!activeItem) return null;

    const catalogItem = catalogById.get(activeItem.catalogItemId);
    if (!catalogItem) return null;

    const candidate = {
      catalogItemId: activeItem.catalogItemId,
      gridX: hoverCell.x,
      gridY: hoverCell.y,
      rotation: activeItem.rotation,
    };
    const occupiedCells = getOccupiedCells(candidate);

    const canPlace = occupiedCells.every(({ x, y }) => {
      const cellX = hoverCell.x + x;
      const cellY = hoverCell.y + y;
      const occupant = itemsByCell.get(`${cellX},${cellY}`);
      return cellX >= 0 && cellY >= 0
        && cellX < dimensions.width && cellY < dimensions.length
        && (!occupant || occupant === draggedItem || occupant === selectedItem);
    });

    const bounds = getOccupiedBounds(occupiedCells);
    return {
      ...candidate,
      catalogItem,
      bounds,
      occupiedCells,
      canPlace,
      reason: canPlace ? null : 'Furniture overlap: this placement conflicts with another item or leaves the room.',
    };
  }, [armedItemId, catalogById, dimensions, draggedItem, hoverCell, itemsByCell, selectedItem]);

  const previewCellSet = useMemo(() => {
    if (!previewItem || !hoverCell) return new Set();
    return new Set(
      previewItem.occupiedCells.map(({ x, y }) => `${hoverCell.x + x},${hoverCell.y + y}`)
    );
  }, [previewItem, hoverCell]);

  const hoverError = previewItem && !previewItem.canPlace ? previewItem.reason : '';

  function recordOverlap(item, gridX, gridY, reason) {
    setOverlapRecords((records) => [
      ...records,
      {
        catalogItemId: item.catalogItemId,
        gridX,
        gridY,
        rotation: item.rotation || 0,
        reason,
        occurredAt: new Date().toISOString(),
      },
    ].slice(-100));
  }

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
        const currentRotation = selectedItem ? selectedItem.rotation : 0;
        const candidate = { catalogItemId: armedItemId, gridX: x, gridY: y, rotation: currentRotation };
        const occupiedCells = getOccupiedCells(candidate);
        const isClear = occupiedCells.every(({ x: offsetX, y: offsetY }) => {
          const cellX = x + offsetX;
          const cellY = y + offsetY;
          return cellX >= 0 && cellY >= 0
            && cellX < dimensions.width && cellY < dimensions.length
            && !itemsByCell.has(`${cellX},${cellY}`);
        });

        if (!isClear) {
          const reason = 'Furniture overlap: this placement conflicts with another item or leaves the room.';
          recordOverlap(candidate, x, y, reason);
          setStatus('Overlap recorded. ' + reason);
          return;
        }

        setPlacedItems((prev) => [
          ...prev,
          { catalogItemId: armedItemId, gridX: x, gridY: y, rotation: currentRotation, customColor: null },
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
      const reason = 'That rotation would overlap another item or leave the room.';
      recordOverlap({ ...selectedItem, rotation: nextRotation }, selectedItem.gridX, selectedItem.gridY, reason);
      setStatus('Overlap recorded. ' + reason);
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
      const reason = 'That furniture footprint does not fit in the selected space.';
      recordOverlap(candidate, gridX, gridY, reason);
      setStatus('Overlap recorded. ' + reason);
      return;
    }

    setPlacedItems((prev) =>
      prev.map((item) => (item === itemToMove ? { ...item, gridX, gridY } : item))
    );
    setSelectedKey(`${gridX},${gridY}`);
    setStatus('');
  }

  function handleFurnitureDragStart(event, item) {
    setDraggedItem(item);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify({
      gridX: item.gridX,
      gridY: item.gridY,
      catalogItemId: item.catalogItemId,
    }));
  }

  function handleDragEnd() {
    setDraggedItem(null);
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
    setDraggedItem(null);
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
    const validPlacedItems = placedItems.filter((item) =>
      catalogById.has(item.catalogItemId?.toString())
    );
    const payload = { roomName, timerSeconds, dimensions, floorColor, gridColor, placedItems: validPlacedItems, overlapRecords };
    try {
      if (isNew) {
        const { data } = await api.post('/rooms', payload);
        window.localStorage.removeItem(draftStorageKey);
        setStatus('Saved.');
        navigate(`/room/${data._id}`, { replace: true });
      } else {
        await api.put(`/rooms/${id}`, payload);
        window.localStorage.removeItem(draftStorageKey);
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

  function formatTimer(seconds) {
    const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${remainingSeconds}`;
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
          {(hoverError || status) && <span className={`status-text ${hoverError ? 'error' : ''}`}>{hoverError || status}</span>}
          <span className="mono" aria-label="Workspace timer">{formatTimer(timerSeconds)}</span>
          <button className="btn-ghost" type="button" onClick={() => setTimerRunning((running) => !running)}>
            {timerRunning ? 'Pause' : 'Start'}
          </button>
          <button className="btn-ghost" type="button" onClick={() => { setTimerRunning(false); setTimerSeconds(0); }}>
            Reset timer
          </button>
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
                    onClick={() => {
                      setSelectedCategory(category.value);
                      setCatalogSearch('');
                      setArmedItemId(null);
                      setSelectedKey(null);
                    }}
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
          {hoverError && <div className="placement-warning">{hoverError}</div>}
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
                const isPreviewCell = previewCellSet.has(key);
                const previewClass = isPreviewCell
                  ? previewItem?.canPlace ? 'preview-valid' : 'preview-invalid'
                  : '';
                return (
                  <button
                    key={key}
                    className={`grid-cell ${placed ? 'occupied' : ''} ${isSelected ? 'selected' : ''} ${previewClass}`.trim()}
                    style={{ gridColumn: x + 1, gridRow: y + 1 }}
                    onClick={() => handleCellClick(x, y)}
                    onMouseEnter={() => setHoverCell({ x, y })}
                    onMouseLeave={() => setHoverCell(null)}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setHoverCell({ x, y });
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setHoverCell({ x, y });
                    }}
                    onDrop={(event) => handleCellDrop(event, x, y)}
                    aria-label={`Cell ${x}, ${y}`}
                  />
                );
              })}
              {previewItem && (
                <div
                  key={`preview-${previewItem.gridX}-${previewItem.gridY}-${previewItem.catalogItem._id}`}
                  className={`placed-item preview ${previewItem.canPlace ? 'valid' : 'invalid'}`}
                  style={{
                    '--item-color': previewItem.catalogItem.defaultColor,
                    left: `${(previewItem.gridX + previewItem.bounds.minX) * 43 + 1}px`,
                    top: `${(previewItem.gridY + previewItem.bounds.minY) * 43 + 1}px`,
                    width: `${previewItem.bounds.width * 42 + (previewItem.bounds.width - 1)}px`,
                    height: `${previewItem.bounds.length * 42 + (previewItem.bounds.length - 1)}px`,
                    pointerEvents: 'none',
                    opacity: previewItem.canPlace ? 0.55 : 0.3,
                    border: 'none',
                    background: 'transparent',
                    boxShadow: 'none',
                    outline: 'none',
                  }}
                  aria-hidden="true"
                >
                  <span className="placed-item-glyph">
                    <ItemGlyph
                      iconKey={previewItem.catalogItem.iconKey}
                      color={previewItem.catalogItem.defaultColor}
                      rotation={0}
                      isometric
                    />
                  </span>
                </div>
              )}
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
                    onDragEnd={handleDragEnd}
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

          {overlapRecords.length > 0 && (
            <div className="overlap-records">
              <div className="overlap-records-heading">
                <p className="panel-heading">Overlap record</p>
                <span className="overlap-count">{overlapRecords.length}</span>
              </div>
              <div className="overlap-record-list">
                {overlapRecords.slice(-5).reverse().map((record, index) => {
                  const catalogItem = catalogById.get(record.catalogItemId?.toString());
                  return (
                    <div className="overlap-record" key={`${record.occurredAt}-${index}`}>
                      <strong>{catalogItem?.name || 'Furniture'}</strong>
                      <span className="mono">({record.gridX}, {record.gridY}) · {record.rotation}°</span>
                      <small>{new Date(record.occurredAt).toLocaleString()}</small>
                    </div>
                  );
                })}
              </div>
              <p className="muted small">Invalid placements are recorded but never saved as furniture.</p>
            </div>
          )}

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
