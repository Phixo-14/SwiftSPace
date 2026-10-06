import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import ItemGlyph from './ItemGlyph.jsx';

const DEFAULT_DIMENSIONS = { width: 6, length: 6 };
const DEFAULT_MEASUREMENTS = { width: '', length: '', unit: 'ft' };
const HISTORY_LIMIT = 50;
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

function createPlacementId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function RoomEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDesigner = user?.role === 'interior-designer' || user?.role === 'admin';
  const draftStorageKey = `studio-grid-draft:${id || 'new'}`;
  const storedDraft = readDraft(draftStorageKey);

  const [catalog, setCatalog] = useState([]);
  const [roomName, setRoomName] = useState(storedDraft?.roomName || (isDesigner ? 'Untitled Project' : 'Untitled Studio'));
  const [clientName, setClientName] = useState(storedDraft?.clientName || '');
  const [measurements, setMeasurements] = useState(storedDraft?.measurements || DEFAULT_MEASUREMENTS);
  const [designNotes, setDesignNotes] = useState(storedDraft?.designNotes || '');
  const [timerSeconds, setTimerSeconds] = useState(storedDraft?.timerSeconds || 0);
  const [timerRunning, setTimerRunning] = useState(true);
  const timerRunningRef = useRef(true);
  const lastActivityRef = useRef(Date.now());
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
  const [rotationDraft, setRotationDraft] = useState(null);
  const [hoverCell, setHoverCell] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [platformRotation, setPlatformRotation] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionPreview, setVersionPreview] = useState(null);
  const [versionPreviewLoadingId, setVersionPreviewLoadingId] = useState(null);
  const [versionName, setVersionName] = useState('');
  const [versionSaving, setVersionSaving] = useState(false);
  const [versionError, setVersionError] = useState('');
  const [versionMessage, setVersionMessage] = useState('');
  const baselineRef = useRef(null);
  const historyRef = useRef({ scope: null, past: [], future: [], current: null });
  const historyReadyScopeRef = useRef(null);
  const canvasWrapRef = useRef(null);

  function getEditorSnapshot(snapshotPlacedItems = placedItems) {
    return JSON.stringify({
      roomName,
      clientName,
      measurements,
      designNotes,
      dimensions,
      floorColor,
      gridColor,
      placedItems: snapshotPlacedItems,
      overlapRecords,
    });
  }

  function applyEditorSnapshot(serializedSnapshot) {
    const snapshot = JSON.parse(serializedSnapshot);
    setRoomName(snapshot.roomName);
    setClientName(snapshot.clientName);
    setMeasurements(snapshot.measurements);
    setDesignNotes(snapshot.designNotes);
    setDimensions(snapshot.dimensions);
    setFloorColor(snapshot.floorColor);
    setGridColor(snapshot.gridColor);
    const floorOption = FLOOR_OPTIONS.find((option) => option.floor === snapshot.floorColor);
    setWorkspaceColor(floorOption?.workspace || FLOOR_OPTIONS[0].workspace);
    setPlacedItems(snapshot.placedItems);
    setOverlapRecords(snapshot.overlapRecords);
    setSelectedKey(null);
    setRotationDraft(null);
  }

  function undoEdit() {
    const history = historyRef.current;
    if (!history.past.length) return;
    const previousSnapshot = history.past.pop();
    if (history.current !== null) history.future.push(history.current);
    history.current = previousSnapshot;
    setCanUndo(history.past.length > 0);
    setCanRedo(history.future.length > 0);
    applyEditorSnapshot(previousSnapshot);
  }

  function redoEdit() {
    const history = historyRef.current;
    if (!history.future.length) return;
    const nextSnapshot = history.future.pop();
    if (history.current !== null) history.past.push(history.current);
    history.current = nextSnapshot;
    setCanUndo(history.past.length > 0);
    setCanRedo(history.future.length > 0);
    applyEditorSnapshot(nextSnapshot);
  }

  // Load catalog once, and the existing room if we're editing one.
  useEffect(() => {
    let cancelled = false;
    const historyScope = id || 'new';
    historyReadyScopeRef.current = null;

    function restoreDraft() {
      const savedDraft = window.localStorage.getItem(draftStorageKey);
      if (!savedDraft) return;

      try {
        const draft = JSON.parse(savedDraft);
        setRoomName(draft.roomName || (isDesigner ? 'Untitled Project' : 'Untitled Studio'));
        setClientName(draft.clientName || '');
        setMeasurements(draft.measurements || DEFAULT_MEASUREMENTS);
        setDesignNotes(draft.designNotes || '');
        setTimerSeconds(draft.timerSeconds || 0);
        setDimensions(draft.dimensions || DEFAULT_DIMENSIONS);
        setFloorColor(draft.floorColor || FLOOR_OPTIONS[0].floor);
        setGridColor(draft.gridColor || FLOOR_OPTIONS[0].grid);
        const draftFloor = FLOOR_OPTIONS.find((option) => option.floor === draft.floorColor);
        setWorkspaceColor(draftFloor?.workspace || FLOOR_OPTIONS[0].workspace);
        setPlacedItems((draft.placedItems || []).map((item) => ({
          ...item,
          placementId: item.placementId || createPlacementId(),
        })));
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
          const validPlacedItems = (roomRes.data.placedItems || [])
            .filter((item) => validCatalogIds.has(item.catalogItemId?.toString()))
            .map((item) => ({ ...item, placementId: item.placementId || createPlacementId() }));
          setRoomName(roomRes.data.roomName);
          setClientName(roomRes.data.clientName || '');
          const savedMeasurements = roomRes.data.measurements || {};
          setMeasurements({
            width: savedMeasurements.width ?? '',
            length: savedMeasurements.length ?? '',
            unit: savedMeasurements.unit || 'ft',
          });
          setDesignNotes(roomRes.data.designNotes || '');
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
          historyReadyScopeRef.current = historyScope;
          setLoading(false);
          setDraftReady(true);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [draftStorageKey, id, isDesigner, isNew]);

  useEffect(() => {
    if (!isDesigner || isNew) return undefined;
    let cancelled = false;
    setVersionsLoading(true);
    api.get(`/rooms/${id}/versions`)
      .then(({ data }) => {
        if (!cancelled) setVersions(data);
      })
      .catch((requestError) => {
        if (!cancelled) setVersionError(requestError.response?.data?.message || 'Could not load versions.');
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isDesigner, isNew]);

  useEffect(() => {
    if (loading || !draftReady) return;
    window.localStorage.setItem(draftStorageKey, JSON.stringify({
      roomName,
      clientName,
      measurements,
      designNotes,
      timerSeconds,
      dimensions,
      floorColor,
      gridColor,
      placedItems,
      overlapRecords,
    }));
  }, [clientName, designNotes, dimensions, draftReady, draftStorageKey, floorColor, gridColor, loading, measurements, overlapRecords, placedItems, roomName, timerSeconds]);

  useEffect(() => {
    if (loading || !draftReady) return;
    const snapshot = getEditorSnapshot();
    if (baselineRef.current === null) {
      baselineRef.current = snapshot;
      return;
    }
    setIsDirty(snapshot !== baselineRef.current);
  });

  useEffect(() => {
    const historyScope = id || 'new';
    if (loading || !draftReady || historyReadyScopeRef.current !== historyScope) return;

    const snapshot = getEditorSnapshot();
    const history = historyRef.current;
    if (history.scope !== historyScope || history.current === null) {
      historyRef.current = { scope: historyScope, past: [], future: [], current: snapshot };
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    if (history.current === snapshot) return;

    history.past.push(history.current);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.current = snapshot;
    history.future = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [clientName, designNotes, dimensions, draftReady, floorColor, gridColor, id, loading, measurements, overlapRecords, placedItems, roomName]);

  useEffect(() => {
    if (loading || !draftReady) return undefined;
    lastActivityRef.current = Date.now();
    timerRunningRef.current = true;
    setTimerRunning(true);
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'dragstart'];
    const markActivity = () => {
      lastActivityRef.current = Date.now();
      timerRunningRef.current = true;
      setTimerRunning(true);
    };
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity));

    const timer = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor >= 60 * 1000) {
        timerRunningRef.current = false;
        setTimerRunning(false);
        return;
      }
      if (timerRunningRef.current) setTimerSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => {
      window.clearInterval(timer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity));
    };
  }, [draftReady, loading]);

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

  useEffect(() => {
    setRotationDraft(null);
  }, [selectedKey]);

  function getOccupiedCells(item, rotation = item.rotation) {
    const catalogItem = catalogById.get(item.catalogItemId);
    if (!catalogItem) return [{ x: 0, y: 0 }];

    const radians = (rotation * Math.PI) / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    const boundsWidth = Math.max(1, Math.ceil(
      catalogItem.footprint.length * cosine + catalogItem.footprint.width * sine - 1e-9
    ));
    const boundsLength = Math.max(1, Math.ceil(
      catalogItem.footprint.length * sine + catalogItem.footprint.width * cosine - 1e-9
    ));

    return Array.from({ length: boundsWidth * boundsLength }, (_, index) => ({
      x: index % boundsWidth,
      y: Math.floor(index / boundsWidth),
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
          { placementId: createPlacementId(), catalogItemId: armedItemId, gridX: x, gridY: y, rotation: currentRotation, customColor: null },
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
    nextRotation = ((Number(nextRotation) % 360) + 360) % 360;
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

  function rotateSelectedClockwise() {
    if (!selectedItem) return;
    setRotationDraft(null);
    setItemRotation((selectedItem.rotation + 90) % 360);
  }

  function rotateSelectedCounterclockwise() {
    if (!selectedItem) return;
    setRotationDraft(null);
    setItemRotation((selectedItem.rotation + 270) % 360);
  }

  function commitRotationDraft(nextRotation = rotationDraft) {
    if (nextRotation === null || !Number.isFinite(Number(nextRotation))) return;
    setRotationDraft(null);
    setItemRotation(Number(nextRotation));
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

  async function handleSave(afterSave) {
    setSaving(true);
    setStatus('');
    const validPlacedItems = placedItems
      .filter((item) => catalogById.has(item.catalogItemId?.toString()))
      .map((item) => ({ ...item, placementId: item.placementId || createPlacementId() }));
    const payload = {
      roomName,
      clientName,
      measurements: {
        width: measurements.width === '' ? null : Number(measurements.width),
        length: measurements.length === '' ? null : Number(measurements.length),
        unit: measurements.unit,
      },
      designNotes,
      timerSeconds,
      dimensions,
      floorColor,
      gridColor,
      placedItems: validPlacedItems,
      overlapRecords,
    };
    try {
      if (isNew) {
        const { data } = await api.post('/rooms', payload);
        const savedPlacedItems = data.placedItems || validPlacedItems;
        setPlacedItems(savedPlacedItems);
        window.localStorage.removeItem(draftStorageKey);
        setStatus('Saved.');
        baselineRef.current = getEditorSnapshot(savedPlacedItems);
        setIsDirty(false);
        if (afterSave) afterSave(data);
        else navigate(`/room/${data._id}`, { replace: true });
      } else {
        const { data } = await api.put(`/rooms/${id}`, payload);
        const savedPlacedItems = data.placedItems || validPlacedItems;
        setPlacedItems(savedPlacedItems);
        window.localStorage.removeItem(draftStorageKey);
        setStatus('Saved.');
        baselineRef.current = getEditorSnapshot(savedPlacedItems);
        setIsDirty(false);
        if (afterSave) afterSave();
      }
      return true;
    } catch (err) {
      const details = err.response?.data?.details;
      setStatus(details
        ? details.join(' ')
        : err.response?.data?.message || err.message || 'Could not save room.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveVersion(event) {
    event.preventDefault();
    const name = versionName.trim();
    if (!name) {
      setVersionError('Enter a name for this version.');
      return;
    }
    if (isDirty && !(await handleSave())) return;

    setVersionSaving(true);
    setVersionError('');
    setVersionMessage('');
    try {
      const { data } = await api.post(`/rooms/${id}/versions`, { name });
      setVersions((current) => [data, ...current].slice(0, 20));
      setVersionName('');
      setVersionMessage('Version saved.');
    } catch (requestError) {
      setVersionError(requestError.response?.data?.message || 'Could not save this version.');
    } finally {
      setVersionSaving(false);
    }
  }

  async function previewVersion(version) {
    setVersionPreviewLoadingId(version._id);
    setVersionError('');
    try {
      const { data } = await api.get(`/rooms/${id}/versions/${version._id}`);
      setVersionPreview(data);
    } catch (requestError) {
      setVersionError(requestError.response?.data?.message || 'Could not load this version preview.');
    } finally {
      setVersionPreviewLoadingId(null);
    }
  }

  async function restoreVersion(version) {
    if (isDirty && !window.confirm('Discard unsaved changes and restore this version?')) return;
    if (!isDirty && !window.confirm(`Restore ${version.name}?`)) return;
    setVersionSaving(true);
    setVersionError('');
    try {
      await api.post(`/rooms/${id}/versions/${version._id}/restore`);
      window.localStorage.removeItem(draftStorageKey);
      window.location.reload();
    } catch (requestError) {
      setVersionError(requestError.response?.data?.message || 'Could not restore this version.');
      setVersionSaving(false);
    }
  }

  function handleBackClick(event) {
    if (!isDirty) return;
    event.preventDefault();
    setShowExitPrompt(true);
  }

  async function handleSaveAndExit() {
    await handleSave(() => navigate('/'));
  }

  function handleExport() {
    window.print();
  }

  function handleDiscardAndExit() {
    window.localStorage.removeItem(draftStorageKey);
    navigate('/');
  }

  function updateDimension(axis, value) {
    const n = Math.max(1, Math.min(50, Number(value) || 1));
    setDimensions((prev) => ({ ...prev, [axis]: n }));
  }

  function updateZoom(nextZoom) {
    setZoom(Math.max(0.6, Math.min(1.8, Number(nextZoom.toFixed(2)))));
  }

  useEffect(() => {
    const canvas = canvasWrapRef.current;
    if (!canvas) return undefined;

    function fitPlatform() {
      const { width, height } = canvas.getBoundingClientRect();
      const platformWidth = dimensions.width * 43;
      const platformHeight = dimensions.length * 43;
      const angle = platformRotation * Math.PI / 180;
      const cosine = Math.abs(Math.cos(angle));
      const sine = Math.abs(Math.sin(angle));
      const rotatedWidth = platformWidth * cosine + platformHeight * sine;
      const rotatedHeight = platformWidth * sine + platformHeight * cosine;
      const availableWidth = Math.max(1, width - 80);
      const availableHeight = Math.max(1, height - 112);
      const nextFitZoom = Math.min(1, availableWidth / rotatedWidth, availableHeight / rotatedHeight);
      setFitZoom(Math.max(0.1, Number(nextFitZoom.toFixed(2))));
    }

    fitPlatform();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fitPlatform);
      return () => window.removeEventListener('resize', fitPlatform);
    }

    const observer = new ResizeObserver(fitPlatform);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [dimensions.width, dimensions.length, loading, platformRotation]);

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
          <Link to="/" className="back-link" onClick={handleBackClick}>← {isDesigner ? 'Projects' : 'Dashboard'}</Link>
          <input
            className="room-name-input"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            aria-label={isDesigner ? 'Project name' : 'Room name'}
          />
        </div>
        <div className="topbar-actions">
          {(hoverError || status) && <span className={`status-text ${hoverError ? 'error' : ''}`}>{hoverError || status}</span>}
          <span className="mono" aria-label="Workspace timer">{formatTimer(timerSeconds)}</span>
          <span className="muted small">{timerRunning ? 'Active' : 'Paused after 1 minute idle'}</span>
          <button className="btn-primary" onClick={() => handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save canvas'}
          </button>
          <button className="btn-ghost export-room-button" type="button" onClick={handleExport}>
            Export design
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

        <main className="canvas-wrap" ref={canvasWrapRef}>
          <div className="print-room-title" aria-hidden="true">
            <p className="eyebrow">Studio Grid / Room design</p>
            <h1>{roomName}</h1>
          </div>
          <div className="workspace-controls" aria-label="Workspace zoom controls">
            <button type="button" onClick={() => updateZoom(zoom - 0.1)} disabled={zoom <= 0.6}>
              −
            </button>
            <button type="button" onClick={() => updateZoom(1)}>Fit</button>
            <button type="button" onClick={() => updateZoom(zoom + 0.1)} disabled={zoom >= 1.8}>
              +
            </button>
            <span>{Math.round(zoom * fitZoom * 100)}%</span>
            <button className="workspace-history-button" type="button" onClick={undoEdit} disabled={!canUndo} title="Undo the last room change">Undo</button>
            <button className="workspace-history-button" type="button" onClick={redoEdit} disabled={!canRedo} title="Redo the last undone room change">Redo</button>
            <span className="workspace-control-separator" aria-hidden="true" />
            <button type="button" onClick={() => setPlatformRotation((current) => (current + 45) % 360)} title="Rotate platform 45 degrees clockwise" aria-label="Rotate platform 45 degrees clockwise">
              ↻
            </button>
            <span aria-live="polite">{platformRotation}°</span>
          </div>
          {hoverError && <div className="placement-warning">{hoverError}</div>}
          <div className="workspace-zoom" style={{ transform: `scale(${zoom * fitZoom}) rotate(${platformRotation}deg)` }}>
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
                      isometric={platformRotation % 90 !== 0}
                    />
                  </span>
                </div>
              )}
              {placedItems.map((item) => {
                const catalogItem = catalogById.get(item.catalogItemId);
                if (!catalogItem) return null;
                const isSelected = selectedKey === `${item.gridX},${item.gridY}`
                  || itemsByCell.get(selectedKey) === item;
                const displayRotation = isSelected && rotationDraft !== null ? rotationDraft : item.rotation;
                const occupiedCells = getOccupiedCells(item, displayRotation);
                const bounds = getOccupiedBounds(occupiedCells);
                return (
                  <button
                    className={`placed-item ${isSelected ? 'selected' : ''}`}
                    key={`${item.gridX},${item.gridY}-${item.catalogItemId}`}
                    type="button"
                    draggable
                    onDragStart={(event) => handleFurnitureDragStart(event, item)}
                    style={{
                      '--item-color': item.customColor || catalogItem.defaultColor,
                      '--item-rotation': `${displayRotation}deg`,
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
                        rotation={displayRotation}
                        isometric={platformRotation % 90 !== 0}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </main>

        <aside className="inspector-panel">
          {isDesigner && (
            <>
              <details className="designer-inspector-accordion" open>
                <summary>Project details</summary>
                <div className="designer-project-fields">
                  <label className="inspector-field">
                    Client name
                    <input value={clientName} maxLength={120} onChange={(event) => setClientName(event.target.value)} />
                  </label>
                  <div className="designer-measurements">
                    <label className="inspector-field">
                      Measured width
                      <input type="number" min="0.01" step="0.01" value={measurements.width} onChange={(event) => setMeasurements((current) => ({ ...current, width: event.target.value }))} />
                    </label>
                    <label className="inspector-field">
                      Measured length
                      <input type="number" min="0.01" step="0.01" value={measurements.length} onChange={(event) => setMeasurements((current) => ({ ...current, length: event.target.value }))} />
                    </label>
                    <label className="inspector-field">
                      Unit
                      <select value={measurements.unit} onChange={(event) => setMeasurements((current) => ({ ...current, unit: event.target.value }))}>
                        <option value="ft">Feet</option><option value="in">Inches</option><option value="m">Meters</option><option value="cm">Centimeters</option><option value="mm">Millimeters</option>
                      </select>
                    </label>
                  </div>
                  <label className="inspector-field">
                    Design notes
                    <textarea rows={4} maxLength={5000} value={designNotes} onChange={(event) => setDesignNotes(event.target.value)} />
                  </label>
                </div>
              </details>
              {!isNew && (
                <details className="designer-inspector-accordion designer-versions-accordion">
                  <summary>Saved versions <span>{versions.length}</span></summary>
                  <div className="designer-version-panel">
                    <form onSubmit={handleSaveVersion}>
                      <label className="inspector-field">
                        Version name
                        <input value={versionName} maxLength={60} onChange={(event) => setVersionName(event.target.value)} placeholder="e.g. Initial concept" />
                      </label>
                      <button className="btn-ghost" type="submit" disabled={versionSaving}>{versionSaving ? 'Saving…' : 'Save version'}</button>
                    </form>
                    {versionsLoading && <p className="muted small">Loading versions…</p>}
                    {versionError && <p className="form-error" role="alert">{versionError}</p>}
                    {versionMessage && <p className="form-success" role="status">{versionMessage}</p>}
                    {versions.map((version) => (
                      <div className="designer-version-row" key={version._id}>
                        <span><strong>{version.name}</strong><small>{new Date(version.createdAt).toLocaleString()}</small></span>
                        <div className="designer-version-actions">
                          <button className="btn-ghost" type="button" onClick={() => previewVersion(version)} disabled={versionSaving || versionPreviewLoadingId === version._id}>
                            {versionPreviewLoadingId === version._id ? 'Loading…' : 'Preview'}
                          </button>
                          <button className="btn-ghost" type="button" onClick={() => restoreVersion(version)} disabled={versionSaving}>Restore</button>
                        </div>
                      </div>
                    ))}
                    {!versionsLoading && versions.length === 0 && <p className="muted small">No versions saved yet.</p>}
                  </div>
                </details>
              )}
            </>
          )}
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
                  onClick={rotateSelectedCounterclockwise}
                  aria-label={`Rotate furniture left to ${(selectedItem.rotation + 270) % 360} degrees`}
                >
                  ↶ Rotate left
                </button>
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={rotateSelectedClockwise}
                  aria-label={`Rotate furniture right to ${(selectedItem.rotation + 90) % 360} degrees`}
                >
                  ↷ Rotate right
                </button>
                <button className="btn-ghost danger" onClick={removeSelected}>Remove</button>
              </div>
              <label className="inspector-field rotation-control">
                <span>Furniture angle <strong>{rotationDraft ?? selectedItem.rotation}°</strong></span>
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={rotationDraft ?? selectedItem.rotation}
                  aria-label="Furniture angle from 0 to 359 degrees"
                  onChange={(event) => setRotationDraft(Number(event.target.value))}
                  onPointerUp={(event) => commitRotationDraft(event.currentTarget.value)}
                  onKeyUp={(event) => commitRotationDraft(event.currentTarget.value)}
                  onBlur={(event) => commitRotationDraft(event.currentTarget.value)}
                />
              </label>
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
      {versionPreview && (
        <div className="version-preview-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setVersionPreview(null);
        }}>
          <section className="version-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="version-preview-title">
            <header className="version-preview-header">
              <div>
                <p className="eyebrow">Saved room version</p>
                <h2 id="version-preview-title">{versionPreview.name}</h2>
                <p className="muted small">Saved {new Date(versionPreview.createdAt).toLocaleString()}</p>
              </div>
              <button className="delete-room-btn" type="button" aria-label="Close version preview" onClick={() => setVersionPreview(null)}>×</button>
            </header>
            <div className="version-preview-meta">
              <span>{versionPreview.snapshot.dimensions.width} × {versionPreview.snapshot.dimensions.length} grid</span>
              <span>{versionPreview.snapshot.placedItems.length} furniture item(s)</span>
              {versionPreview.snapshot.clientName && <span>Client: {versionPreview.snapshot.clientName}</span>}
            </div>
            <div className="version-preview-stage">
              <div
                className="version-preview-grid"
                style={{
                  gridTemplateColumns: `repeat(${versionPreview.snapshot.dimensions.width}, 24px)`,
                  gridTemplateRows: `repeat(${versionPreview.snapshot.dimensions.length}, 24px)`,
                  '--version-floor': versionPreview.snapshot.floorColor,
                  '--version-grid': versionPreview.snapshot.gridColor,
                }}
                aria-label={`Saved ${versionPreview.name} room layout`}
              >
                {Array.from({ length: versionPreview.snapshot.dimensions.width * versionPreview.snapshot.dimensions.length }, (_, index) => (
                  <span
                    className="version-preview-cell"
                    key={`cell-${index}`}
                    style={{ gridColumn: (index % versionPreview.snapshot.dimensions.width) + 1, gridRow: Math.floor(index / versionPreview.snapshot.dimensions.width) + 1 }}
                  />
                ))}
                {versionPreview.snapshot.placedItems.map((item, index) => {
                  const catalogItem = catalogById.get(item.catalogItemId?.toString());
                  if (!catalogItem) return null;
                  const radians = (item.rotation * Math.PI) / 180;
                  const cosine = Math.abs(Math.cos(radians));
                  const sine = Math.abs(Math.sin(radians));
                  const width = Math.max(1, Math.ceil(catalogItem.footprint.length * cosine + catalogItem.footprint.width * sine - 1e-9));
                  const length = Math.max(1, Math.ceil(catalogItem.footprint.length * sine + catalogItem.footprint.width * cosine - 1e-9));
                  return (
                    <div
                      className="version-preview-item"
                      key={item.placementId || index}
                      title={`${catalogItem.name} · ${item.rotation}°`}
                      style={{
                        gridColumn: `${item.gridX + 1} / span ${width}`,
                        gridRow: `${item.gridY + 1} / span ${length}`,
                        '--item-color': item.customColor || catalogItem.defaultColor,
                      }}
                    >
                      <ItemGlyph iconKey={catalogItem.iconKey} color={item.customColor || catalogItem.defaultColor} rotation={item.rotation} isometric={platformRotation % 90 !== 0} />
                    </div>
                  );
                })}
              </div>
            </div>
            {versionPreview.snapshot.designNotes && (
              <p className="version-preview-notes">{versionPreview.snapshot.designNotes}</p>
            )}
            <footer className="version-preview-footer">
              <button className="btn-ghost" type="button" onClick={() => setVersionPreview(null)}>Close preview</button>
              <button className="btn-primary" type="button" onClick={() => restoreVersion(versionPreview)} disabled={versionSaving}>Restore this version</button>
            </footer>
          </section>
        </div>
      )}
      {showExitPrompt && (
        <div className="exit-prompt-backdrop" role="presentation">
          <section className="exit-prompt" role="dialog" aria-modal="true" aria-labelledby="exit-prompt-title">
            <p className="eyebrow">Unsaved changes</p>
            <h2 id="exit-prompt-title">Save this room before leaving?</h2>
            <p className="muted">Your furniture, timer, and room settings have not been saved yet.</p>
            <div className="exit-prompt-actions">
              <button className="btn-primary" type="button" onClick={handleSaveAndExit} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button className="btn-ghost danger" type="button" onClick={handleDiscardAndExit} disabled={saving}>
                Don’t save
              </button>
              <button className="btn-ghost" type="button" onClick={() => setShowExitPrompt(false)} disabled={saving}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
