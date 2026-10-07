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
const ARCHITECTURAL_TOOLS = [
  { value: 'select', label: 'Select' },
  { value: 'wall', label: 'Wall' },
  { value: 'door', label: 'Door' },
  { value: 'window', label: 'Window' },
  { value: 'label', label: 'Room label' },
  { value: 'erase', label: 'Erase' },
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

function distanceToSegment(point, segment) {
  const deltaX = segment.endX - segment.startX;
  const deltaY = segment.endY - segment.startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const progress = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - segment.startX) * deltaX + (point.y - segment.startY) * deltaY) / lengthSquared))
    : 0;
  return Math.hypot(point.x - segment.startX - progress * deltaX, point.y - segment.startY - progress * deltaY);
}

function snapArchitecturalEndpoint(start, point) {
  const deltaX = point.x - start.x;
  const deltaY = point.y - start.y;
  return Math.abs(deltaX) >= Math.abs(deltaY)
    ? { x: point.x, y: start.y }
    : { x: start.x, y: point.y };
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
  const [wallThicknessMm, setWallThicknessMm] = useState(storedDraft?.wallThicknessMm || 150);
  const [architecturalSegments, setArchitecturalSegments] = useState(storedDraft?.architecturalSegments || []);
  const [roomLabels, setRoomLabels] = useState(storedDraft?.roomLabels || []);
  const [architecturalTool, setArchitecturalTool] = useState('select');
  const [pendingArchitectPoint, setPendingArchitectPoint] = useState(null);
  const [architecturalDragEnd, setArchitecturalDragEnd] = useState(null);
  const [roomLabelText, setRoomLabelText] = useState('ROOM');
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
  const [selectedArchitecturalElement, setSelectedArchitecturalElement] = useState(null);
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
  const gridResizeRef = useRef(null);
  const architecturalDragRef = useRef(null);
  const suppressGridClickRef = useRef(false);
  const catalogDragRef = useRef(false);

  function getEditorSnapshot(snapshotPlacedItems = placedItems) {
    return JSON.stringify({
      roomName,
      clientName,
      measurements,
      designNotes,
      dimensions,
      floorColor,
      gridColor,
      wallThicknessMm,
      architecturalSegments,
      roomLabels,
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
    setWallThicknessMm(snapshot.wallThicknessMm || 150);
    setArchitecturalSegments(snapshot.architecturalSegments || []);
    setRoomLabels(snapshot.roomLabels || []);
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
        if (isDesigner) {
          setWallThicknessMm(draft.wallThicknessMm || 150);
          setArchitecturalSegments(draft.architecturalSegments || []);
          setRoomLabels(draft.roomLabels || []);
        }
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
          setWallThicknessMm(roomRes.data.wallThicknessMm || 150);
          setArchitecturalSegments(roomRes.data.architecturalSegments || []);
          setRoomLabels(roomRes.data.roomLabels || []);
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
    if (isNew) return undefined;
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
  }, [id, isNew]);

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
      ...(isDesigner ? { wallThicknessMm, architecturalSegments, roomLabels } : {}),
      placedItems,
      overlapRecords,
    }));
  }, [architecturalSegments, clientName, designNotes, dimensions, draftReady, draftStorageKey, floorColor, gridColor, isDesigner, loading, measurements, overlapRecords, placedItems, roomLabels, roomName, timerSeconds, wallThicknessMm]);

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
  }, [architecturalSegments, clientName, designNotes, dimensions, draftReady, floorColor, gridColor, id, loading, measurements, overlapRecords, placedItems, roomLabels, roomName, wallThicknessMm]);

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
  const selectedArchitectureSegment = selectedArchitecturalElement?.kind === 'segment'
    ? architecturalSegments.find((segment) => segment.id === selectedArchitecturalElement.id)
    : null;
  const selectedArchitectureLabel = selectedArchitecturalElement?.kind === 'label'
    ? roomLabels.find((label) => label.id === selectedArchitecturalElement.id)
    : null;

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

  function handleArchitecturalCellClick(x, y) {
    const point = { x: x + 0.5, y: y + 0.5 };
    setSelectedKey(null);
    setArmedItemId(null);

    if (architecturalTool === 'label') {
      if (roomLabels.length >= 100) {
        setStatus('A project can contain up to 100 room labels.');
        return;
      }
      const text = roomLabelText.trim().toUpperCase();
      if (!text) {
        setStatus('Enter a room label before placing it.');
        return;
      }
      const label = { id: createPlacementId(), text, ...point };
      setRoomLabels((current) => [...current, label]);
      setSelectedArchitecturalElement({ kind: 'label', id: label.id });
      setArchitecturalTool('select');
      setStatus(`${text} label added.`);
      return;
    }

    if (architecturalTool === 'erase') {
      const segmentDistances = architecturalSegments.map((segment) => distanceToSegment(point, segment));
      const labelDistances = roomLabels.map((label) => Math.hypot(point.x - label.x, point.y - label.y));
      const nearestSegment = Math.min(...segmentDistances, Infinity);
      const nearestLabel = Math.min(...labelDistances, Infinity);
      if (Math.min(nearestSegment, nearestLabel) > 0.9) {
        setStatus('Select a wall, opening, or label to remove.');
      } else if (nearestSegment <= nearestLabel) {
        const removeIndex = segmentDistances.indexOf(nearestSegment);
        setArchitecturalSegments((current) => current.filter((_, index) => index !== removeIndex));
        setStatus('Plan element removed.');
      } else {
        const removeIndex = labelDistances.indexOf(nearestLabel);
        setRoomLabels((current) => current.filter((_, index) => index !== removeIndex));
        setStatus('Room label removed.');
      }
      setPendingArchitectPoint(null);
      setSelectedArchitecturalElement(null);
      setArchitecturalTool('select');
      return;
    }

  }

  function placeCatalogItemAt(catalogItemId, x, y, rotation = 0) {
    const candidate = { catalogItemId, gridX: x, gridY: y, rotation };
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
      return false;
    }

    setPlacedItems((current) => [
      ...current,
      { placementId: createPlacementId(), ...candidate, customColor: null },
    ]);
    setSelectedKey(`${x},${y}`);
    setSelectedArchitecturalElement(null);
    setArmedItemId(null);
    setStatus('');
    return true;
  }

  const handleCellClick = useCallback(
    (x, y) => {
      if (isDesigner && ['wall', 'door', 'window'].includes(architecturalTool)) return;
      if (isDesigner && architecturalTool !== 'select') {
        handleArchitecturalCellClick(x, y);
        return;
      }
      const key = `${x},${y}`;
      const existing = itemsByCell.get(key);
      setSelectedArchitecturalElement(null);

      if (existing) {
        setSelectedKey(key);
        setArmedItemId(null);
        return;
      }

      if (armedItemId) {
        const currentRotation = selectedItem ? selectedItem.rotation : 0;
        placeCatalogItemAt(armedItemId, x, y, currentRotation);
      } else {
        setSelectedKey(null);
      }
    },
    [architecturalSegments, architecturalTool, isDesigner, pendingArchitectPoint, roomLabels, roomLabelText, armedItemId, dimensions, itemsByCell, selectedItem, placeCatalogItemAt]
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
      kind: 'move',
      gridX: item.gridX,
      gridY: item.gridY,
      catalogItemId: item.catalogItemId,
    }));
  }

  function handleCatalogDragStart(event, item) {
    const rotation = selectedItem?.rotation || 0;
    catalogDragRef.current = true;
    setArmedItemId(null);
    setDraggedItem({ catalogItemId: item._id, rotation });
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/json', JSON.stringify({
      kind: 'catalog',
      catalogItemId: item._id,
      rotation,
    }));
  }

  function handleCatalogDragEnd() {
    setDraggedItem(null);
    window.setTimeout(() => { catalogDragRef.current = false; }, 0);
  }

  function handleDragEnd() {
    setDraggedItem(null);
  }

  function handleCellDrop(event, gridX, gridY) {
    event.preventDefault();
    const data = event.dataTransfer.getData('application/json');
    if (!data) return;
    const dragged = JSON.parse(data);
    if (dragged.kind === 'catalog') {
      placeCatalogItemAt(dragged.catalogItemId, gridX, gridY, dragged.rotation || 0);
      setDraggedItem(null);
      return;
    }
    const item = placedItems.find((candidate) =>
      candidate.gridX === dragged.gridX
      && candidate.gridY === dragged.gridY
      && candidate.catalogItemId === dragged.catalogItemId
    );
    if (item) moveItem(item, gridX, gridY);
    setDraggedItem(null);
  }

  function getGridCellAtPointer(clientX, clientY) {
    return document.elementFromPoint(clientX, clientY)?.closest('.grid-cell');
  }

  function beginArchitecturalDrag(event) {
    if (!isDesigner || !['wall', 'door', 'window'].includes(architecturalTool)) return;
    const cell = event.target.closest?.('.grid-cell');
    if (!cell) return;
    if (architecturalSegments.length >= 300) {
      setStatus('A project can contain up to 300 walls, doors, and windows.');
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = {
      x: Number(cell.dataset.gridX) + 0.5,
      y: Number(cell.dataset.gridY) + 0.5,
    };
    architecturalDragRef.current = { pointerId: event.pointerId, start, end: start, type: architecturalTool };
    suppressGridClickRef.current = true;
    setPendingArchitectPoint(start);
    setArchitecturalDragEnd(start);
    setSelectedArchitecturalElement(null);
    setSelectedKey(null);
    setArmedItemId(null);
    setStatus(`Drag to draw ${architecturalTool}.`);
  }

  function updateArchitecturalDrag(event) {
    const drag = architecturalDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cell = getGridCellAtPointer(event.clientX, event.clientY);
    if (!cell) return;
    const point = {
      x: Number(cell.dataset.gridX) + 0.5,
      y: Number(cell.dataset.gridY) + 0.5,
    };
    drag.end = snapArchitecturalEndpoint(drag.start, point);
    setArchitecturalDragEnd(drag.end);
  }

  function finishArchitecturalDrag(event) {
    const drag = architecturalDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cell = getGridCellAtPointer(event.clientX, event.clientY);
    if (cell) {
      drag.end = snapArchitecturalEndpoint(drag.start, {
        x: Number(cell.dataset.gridX) + 0.5,
        y: Number(cell.dataset.gridY) + 0.5,
      });
    }

    if (drag.start.x !== drag.end.x || drag.start.y !== drag.end.y) {
      const segment = {
        id: createPlacementId(),
        type: drag.type,
        startX: drag.start.x,
        startY: drag.start.y,
        endX: drag.end.x,
        endY: drag.end.y,
      };
      setArchitecturalSegments((current) => [...current, segment]);
      setSelectedArchitecturalElement({ kind: 'segment', id: segment.id });
      setStatus(`${drag.type[0].toUpperCase()}${drag.type.slice(1)} added.`);
    } else {
      setStatus('Drag across at least one grid cell to draw.');
    }

    architecturalDragRef.current = null;
    setPendingArchitectPoint(null);
    setArchitecturalDragEnd(null);
    setArchitecturalTool('select');
    window.setTimeout(() => { suppressGridClickRef.current = false; }, 0);
  }

  function cancelArchitecturalDrag(event) {
    if (architecturalDragRef.current?.pointerId !== event.pointerId) return;
    architecturalDragRef.current = null;
    setPendingArchitectPoint(null);
    setArchitecturalDragEnd(null);
    setArchitecturalTool('select');
    suppressGridClickRef.current = false;
  }

  function removeSelected() {
    if (!selectedItem) return;
    removeItem(selectedItem);
  }

  function removeSelectedArchitecturalElement() {
    if (!selectedArchitecturalElement) return;
    if (selectedArchitecturalElement.kind === 'segment') {
      setArchitecturalSegments((current) => current.filter((segment) => segment.id !== selectedArchitecturalElement.id));
    } else {
      setRoomLabels((current) => current.filter((label) => label.id !== selectedArchitecturalElement.id));
    }
    setSelectedArchitecturalElement(null);
    setStatus('Plan element removed.');
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
      ...(isDesigner ? { wallThicknessMm, architecturalSegments, roomLabels } : {}),
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

  function beginGridResize(event, edgeX, edgeY) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const occupiedCoordinates = [...itemsByCell.keys()].map((key) => key.split(',').map(Number));
    gridResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      edgeX,
      edgeY,
      dimensions: { ...dimensions },
      placedItems,
      selectedKey,
      scale: Math.max(0.1, zoom * fitZoom),
      rotation: platformRotation * Math.PI / 180,
      minX: occupiedCoordinates.length ? Math.min(...occupiedCoordinates.map(([x]) => x)) : null,
      maxX: occupiedCoordinates.length ? Math.max(...occupiedCoordinates.map(([x]) => x)) : null,
      minY: occupiedCoordinates.length ? Math.min(...occupiedCoordinates.map(([, y]) => y)) : null,
      maxY: occupiedCoordinates.length ? Math.max(...occupiedCoordinates.map(([, y]) => y)) : null,
    };
  }

  function resizeGridFromPointer(event) {
    const resize = gridResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    const screenX = event.clientX - resize.startX;
    const screenY = event.clientY - resize.startY;
    const cosine = Math.cos(resize.rotation);
    const sine = Math.sin(resize.rotation);
    const cellsX = (screenX * cosine + screenY * sine) / (resize.scale * 43);
    const cellsY = (-screenX * sine + screenY * cosine) / (resize.scale * 43);

    function getDelta(edge, movement, size, minOccupied, maxOccupied) {
      if (!edge) return 0;
      const minimum = edge < 0
        ? Math.max(1 - size, minOccupied === null ? 1 - size : -minOccupied)
        : Math.max(1 - size, maxOccupied === null ? 1 - size : maxOccupied + 1 - size);
      const maximum = 50 - size;
      return Math.max(minimum, Math.min(maximum, Math.round(edge * movement)));
    }

    const widthDelta = getDelta(resize.edgeX, cellsX, resize.dimensions.width, resize.minX, resize.maxX);
    const lengthDelta = getDelta(resize.edgeY, cellsY, resize.dimensions.length, resize.minY, resize.maxY);
    const shiftX = resize.edgeX < 0 ? widthDelta : 0;
    const shiftY = resize.edgeY < 0 ? lengthDelta : 0;

    setDimensions({
      width: resize.dimensions.width + widthDelta,
      length: resize.dimensions.length + lengthDelta,
    });
    if (shiftX || shiftY) {
      setPlacedItems(resize.placedItems.map((item) => ({
        ...item,
        gridX: item.gridX + shiftX,
        gridY: item.gridY + shiftY,
      })));
      if (resize.selectedKey) {
        const [selectedX, selectedY] = resize.selectedKey.split(',').map(Number);
        setSelectedKey(`${selectedX + shiftX},${selectedY + shiftY}`);
      }
    }
    setHoverCell(null);
  }

  function endGridResize(event) {
    if (gridResizeRef.current?.pointerId === event.pointerId) {
      gridResizeRef.current = null;
    }
  }

  function resizeGridFromKeyboard(event, edgeX, edgeY) {
    const movementX = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const movementY = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if ((!edgeX || !movementX) && (!edgeY || !movementY)) return;
    event.preventDefault();

    const occupiedCoordinates = [...itemsByCell.keys()].map((key) => key.split(',').map(Number));
    const minX = occupiedCoordinates.length ? Math.min(...occupiedCoordinates.map(([x]) => x)) : null;
    const maxX = occupiedCoordinates.length ? Math.max(...occupiedCoordinates.map(([x]) => x)) : null;
    const minY = occupiedCoordinates.length ? Math.min(...occupiedCoordinates.map(([, y]) => y)) : null;
    const maxY = occupiedCoordinates.length ? Math.max(...occupiedCoordinates.map(([, y]) => y)) : null;

    function getDelta(edge, movement, size, minOccupied, maxOccupied) {
      if (!edge || !movement) return 0;
      const minimum = edge < 0
        ? Math.max(1 - size, minOccupied === null ? 1 - size : -minOccupied)
        : Math.max(1 - size, maxOccupied === null ? 1 - size : maxOccupied + 1 - size);
      return Math.max(minimum, Math.min(50 - size, Math.round(edge * movement)));
    }

    const widthDelta = getDelta(edgeX, movementX, dimensions.width, minX, maxX);
    const lengthDelta = getDelta(edgeY, movementY, dimensions.length, minY, maxY);
    const shiftX = edgeX < 0 ? widthDelta : 0;
    const shiftY = edgeY < 0 ? lengthDelta : 0;
    if (!widthDelta && !lengthDelta) return;

    setDimensions({ width: dimensions.width + widthDelta, length: dimensions.length + lengthDelta });
    if (shiftX || shiftY) {
      setPlacedItems((current) => current.map((item) => ({
        ...item,
        gridX: item.gridX + shiftX,
        gridY: item.gridY + shiftY,
      })));
      if (selectedKey) {
        const [selectedX, selectedY] = selectedKey.split(',').map(Number);
        setSelectedKey(`${selectedX + shiftX},${selectedY + shiftY}`);
      }
    }
    setHoverCell(null);
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
  const millimetresPerUnit = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[measurements.unit] || 304.8;
  const measuredCellSizes = [
    Number(measurements.width) > 0 ? (Number(measurements.width) * millimetresPerUnit) / dimensions.width : null,
    Number(measurements.length) > 0 ? (Number(measurements.length) * millimetresPerUnit) / dimensions.length : null,
  ].filter(Boolean);
  const averageCellMm = measuredCellSizes.length
    ? measuredCellSizes.reduce((total, size) => total + size, 0) / measuredCellSizes.length
    : null;
  const wallStrokeWidth = Math.max(2.5, Math.min(14, averageCellMm
    ? (wallThicknessMm * 43) / averageCellMm
    : wallThicknessMm / 35));

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
        className={`editor-body${isDesigner ? ' designer-editor-body' : ''}`}
        style={{ '--floor-color': floorColor, '--workspace-color': workspaceColor }}
      >
        <aside className="catalog-panel">
          {isDesigner && (
            <section className="architect-tools">
              <h2 className="catalog-section-title">Architecture</h2>
              <div className="architect-tool-grid" role="group" aria-label="Architectural drawing tools">
                {ARCHITECTURAL_TOOLS.map((tool) => (
                  <button
                    className={`architect-tool ${architecturalTool === tool.value ? 'active' : ''}`}
                    type="button"
                    key={tool.value}
                    aria-pressed={architecturalTool === tool.value}
                    onClick={() => {
                      setArchitecturalTool(tool.value);
                      setPendingArchitectPoint(null);
                      setSelectedArchitecturalElement(null);
                      setArmedItemId(null);
                    }}
                  >
                    {tool.label}
                  </button>
                ))}
              </div>
              <label className="inspector-field architect-thickness">
                Wall thickness
                <select value={wallThicknessMm} onChange={(event) => setWallThicknessMm(Number(event.target.value))}>
                  {[100, 125, 150, 200, 250, 300].map((thickness) => (
                    <option value={thickness} key={thickness}>{thickness} mm</option>
                  ))}
                </select>
              </label>
              {architecturalTool === 'label' && (
                <label className="inspector-field architect-label-input">
                  Room label
                  <input value={roomLabelText} maxLength={40} onChange={(event) => setRoomLabelText(event.target.value.toUpperCase())} />
                </label>
              )}
              {['wall', 'door', 'window'].includes(architecturalTool) && !pendingArchitectPoint && (
                <p className="architect-tool-hint">Drag across the plan to draw one element.</p>
              )}
              {pendingArchitectPoint && <p className="architect-tool-hint">Drag across the grid to set direction and length.</p>}
            </section>
          )}
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
                      type="button"
                      draggable
                      aria-label={`${item.name}, ${item.footprint.width} by ${item.footprint.length} footprint`}
                      onClick={() => {
                        if (catalogDragRef.current) return;
                        setArmedItemId(item._id);
                        setSelectedKey(null);
                        setSelectedArchitecturalElement(null);
                      }}
                      onDragStart={(event) => handleCatalogDragStart(event, item)}
                      onDragEnd={handleCatalogDragEnd}
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
          {armedItemId && <p className="hint">Click a cell or drag this item onto the floor. Places once.</p>}
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
              className={`iso-grid${isDesigner ? ' architectural-grid' : ''}`}
              onPointerDown={beginArchitecturalDrag}
              onPointerMove={updateArchitecturalDrag}
              onPointerUp={finishArchitecturalDrag}
              onPointerCancel={cancelArchitecturalDrag}
              onClickCapture={(event) => {
                if (!suppressGridClickRef.current) return;
                suppressGridClickRef.current = false;
                event.preventDefault();
                event.stopPropagation();
              }}
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
                    data-grid-x={x}
                    data-grid-y={y}
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
              {isDesigner && (
                <svg
                  className="architectural-overlay"
                  viewBox={`0 0 ${dimensions.width * 43 + 2} ${dimensions.length * 43 + 2}`}
                  aria-label="Architectural walls, doors, windows, and room labels"
                >
                  {architecturalSegments.map((segment) => {
                    const isSelected = selectedArchitecturalElement?.kind === 'segment'
                      && selectedArchitecturalElement.id === segment.id;
                    const startX = segment.startX * 43 + 1;
                    const startY = segment.startY * 43 + 1;
                    const endX = segment.endX * 43 + 1;
                    const endY = segment.endY * 43 + 1;
                    const segmentLength = Math.hypot(endX - startX, endY - startY);
                    const isHorizontal = startY === endY;
                    const swingX = isHorizontal ? startX : startX + segmentLength;
                    const swingY = isHorizontal ? startY + segmentLength : startY;
                    const swingPath = `M ${endX} ${endY} A ${segmentLength} ${segmentLength} 0 0 1 ${swingX} ${swingY}`;
                    const doorLeaf = `M ${startX} ${startY} L ${swingX} ${swingY}`;
                    const windowOffset = wallStrokeWidth * 0.62;
                    return (
                      <g
                        key={segment.id}
                        pointerEvents={architecturalTool === 'select' ? 'visiblePainted' : 'none'}
                        style={{ cursor: architecturalTool === 'select' ? 'pointer' : 'default' }}
                        onClick={(event) => {
                          if (architecturalTool !== 'select') return;
                          event.stopPropagation();
                          setSelectedArchitecturalElement({ kind: 'segment', id: segment.id });
                          setSelectedKey(null);
                          setArmedItemId(null);
                        }}
                      >
                        {segment.type === 'wall' && (
                          <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={isSelected ? 'var(--accent)' : '#202722'} strokeWidth={wallStrokeWidth} strokeLinecap="square" />
                        )}
                        {segment.type === 'door' && (
                          <>
                            <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={floorColor} strokeWidth={wallStrokeWidth + 2} />
                            <path d={`${swingPath} ${doorLeaf}`} fill="none" stroke={isSelected ? 'var(--accent)' : '#202722'} strokeWidth="1.7" />
                          </>
                        )}
                        {segment.type === 'window' && (
                          <>
                            <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={floorColor} strokeWidth={wallStrokeWidth + 2} />
                            <line
                              x1={startX + (isHorizontal ? 0 : -windowOffset)}
                              y1={startY + (isHorizontal ? -windowOffset : 0)}
                              x2={endX + (isHorizontal ? 0 : -windowOffset)}
                              y2={endY + (isHorizontal ? -windowOffset : 0)}
                              stroke={isSelected ? 'var(--accent)' : '#247e92'}
                              strokeWidth="1.8"
                            />
                            <line
                              x1={startX + (isHorizontal ? 0 : windowOffset)}
                              y1={startY + (isHorizontal ? windowOffset : 0)}
                              x2={endX + (isHorizontal ? 0 : windowOffset)}
                              y2={endY + (isHorizontal ? windowOffset : 0)}
                              stroke={isSelected ? 'var(--accent)' : '#247e92'}
                              strokeWidth="1.8"
                            />
                          </>
                        )}
                      </g>
                    );
                  })}
                  {roomLabels.map((label) => {
                    const x = label.x * 43 + 1;
                    const y = label.y * 43 + 1;
                    const labelWidth = Math.max(38, label.text.length * 6.5 + 12);
                    const isSelected = selectedArchitecturalElement?.kind === 'label'
                      && selectedArchitecturalElement.id === label.id;
                    return (
                      <g
                        key={label.id}
                        transform={`translate(${x} ${y})`}
                        pointerEvents={architecturalTool === 'select' ? 'visiblePainted' : 'none'}
                        style={{ cursor: architecturalTool === 'select' ? 'pointer' : 'default' }}
                        onClick={(event) => {
                          if (architecturalTool !== 'select') return;
                          event.stopPropagation();
                          setSelectedArchitecturalElement({ kind: 'label', id: label.id });
                          setSelectedKey(null);
                          setArmedItemId(null);
                        }}
                      >
                        <rect x={-labelWidth / 2} y="-11" width={labelWidth} height="22" rx="2" fill="#fbfaf6" fillOpacity="0.92" stroke={isSelected ? 'var(--accent)' : 'none'} strokeWidth="1.5" />
                        <text className="architectural-room-label" textAnchor="middle" dominantBaseline="middle">{label.text}</text>
                      </g>
                    );
                  })}
                  {pendingArchitectPoint && (
                    <circle cx={pendingArchitectPoint.x * 43 + 1} cy={pendingArchitectPoint.y * 43 + 1} r="5" fill="#c2693c" stroke="#fff" strokeWidth="1.5" />
                  )}
                  {pendingArchitectPoint && architecturalDragEnd && (
                    <line
                      className="architectural-drag-preview"
                      x1={pendingArchitectPoint.x * 43 + 1}
                      y1={pendingArchitectPoint.y * 43 + 1}
                      x2={architecturalDragEnd.x * 43 + 1}
                      y2={architecturalDragEnd.y * 43 + 1}
                      strokeWidth={wallStrokeWidth}
                      strokeDasharray="5 3"
                    />
                  )}
                </svg>
              )}
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
                      setSelectedArchitecturalElement(null);
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
              {[
                { edgeX: -1, edgeY: -1, position: 'north-west', label: 'Resize room from top left' },
                { edgeX: 0, edgeY: -1, position: 'north', label: 'Resize room from top edge' },
                { edgeX: 1, edgeY: -1, position: 'north-east', label: 'Resize room from top right' },
                { edgeX: 1, edgeY: 0, position: 'east', label: 'Resize room from right edge' },
                { edgeX: 1, edgeY: 1, position: 'south-east', label: 'Resize room from bottom right' },
                { edgeX: 0, edgeY: 1, position: 'south', label: 'Resize room from bottom edge' },
                { edgeX: -1, edgeY: 1, position: 'south-west', label: 'Resize room from bottom left' },
                { edgeX: -1, edgeY: 0, position: 'west', label: 'Resize room from left edge' },
              ].map(({ edgeX, edgeY, position, label }) => (
                <button
                  key={position}
                  type="button"
                  className={`grid-resize-handle ${position}`}
                  aria-label={label}
                  title={label}
                  onPointerDown={(event) => beginGridResize(event, edgeX, edgeY)}
                  onPointerMove={resizeGridFromPointer}
                  onPointerUp={endGridResize}
                  onPointerCancel={endGridResize}
                  onLostPointerCapture={endGridResize}
                  onKeyDown={(event) => resizeGridFromKeyboard(event, edgeX, edgeY)}
                />
              ))}
            </div>
          </div>
        </main>

        <aside className="inspector-panel">
          {isDesigner && (
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
          )}
          <details className="designer-inspector-accordion designer-versions-accordion">
            <summary>Saved versions <span>{versions.length}</span></summary>
            <div className="designer-version-panel">
              {isNew ? (
                <p className="muted small">Save this room first to create and view versions.</p>
              ) : (
                <form onSubmit={handleSaveVersion}>
                  <label className="inspector-field">
                    Version name
                    <input value={versionName} maxLength={60} onChange={(event) => setVersionName(event.target.value)} placeholder="e.g. Initial concept" />
                  </label>
                  <button className="btn-ghost" type="submit" disabled={versionSaving}>{versionSaving ? 'Saving…' : 'Save version'}</button>
                </form>
              )}
              {!isNew && (
                <>
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
                </>
              )}
            </div>
          </details>
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
                      onClick={() => {
                        setSelectedKey(itemKey);
                        setSelectedArchitecturalElement(null);
                      }}
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

          <p className="panel-heading">{selectedArchitectureSegment || selectedArchitectureLabel ? 'Selected plan element' : 'Selected item'}</p>
          {isDesigner && (selectedArchitectureSegment || selectedArchitectureLabel) ? (
            <div className="inspector-selected">
              <p className="selected-name">
                {selectedArchitectureSegment
                  ? `${selectedArchitectureSegment.type[0].toUpperCase()}${selectedArchitectureSegment.type.slice(1)}`
                  : selectedArchitectureLabel.text}
              </p>
              <p className="mono muted small">
                {selectedArchitectureSegment
                  ? `(${selectedArchitectureSegment.startX}, ${selectedArchitectureSegment.startY}) to (${selectedArchitectureSegment.endX}, ${selectedArchitectureSegment.endY})`
                  : `Room label at (${selectedArchitectureLabel.x}, ${selectedArchitectureLabel.y})`}
              </p>
              {selectedArchitectureSegment?.type === 'wall' && (
                <p className="mono muted small">Wall thickness · {wallThicknessMm} mm</p>
              )}
              <div className="inspector-actions">
                <button className="btn-ghost danger" type="button" onClick={removeSelectedArchitecturalElement}>Remove</button>
              </div>
            </div>
          ) : selectedItem && catalogById.get(selectedItem.catalogItemId) ? (
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
              {versionPreview.snapshot.wallThicknessMm && <span>Walls {versionPreview.snapshot.wallThicknessMm} mm</span>}
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
                <svg
                  className="version-architecture-overlay"
                  viewBox={`0 0 ${versionPreview.snapshot.dimensions.width * 25 + 2} ${versionPreview.snapshot.dimensions.length * 25 + 2}`}
                  aria-hidden="true"
                >
                  {(versionPreview.snapshot.architecturalSegments || []).map((segment) => {
                    const startX = segment.startX * 25 + 1;
                    const startY = segment.startY * 25 + 1;
                    const endX = segment.endX * 25 + 1;
                    const endY = segment.endY * 25 + 1;
                    const thickness = Math.max(2, Math.min(7, (versionPreview.snapshot.wallThicknessMm || 150) / 45));
                    const isHorizontal = startY === endY;
                    const segmentLength = Math.hypot(endX - startX, endY - startY);
                    const swingX = isHorizontal ? startX : startX + segmentLength;
                    const swingY = isHorizontal ? startY + segmentLength : startY;
                    const windowOffset = thickness * 0.6;
                    if (segment.type === 'wall') {
                      return <line key={segment.id} x1={startX} y1={startY} x2={endX} y2={endY} stroke="#202722" strokeWidth={thickness} strokeLinecap="square" />;
                    }
                    return (
                      <g key={segment.id}>
                        <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="#fbfaf6" strokeWidth={thickness + 2} />
                        {segment.type === 'window' ? (
                          <>
                            <line x1={startX + (isHorizontal ? 0 : -windowOffset)} y1={startY + (isHorizontal ? -windowOffset : 0)} x2={endX + (isHorizontal ? 0 : -windowOffset)} y2={endY + (isHorizontal ? -windowOffset : 0)} stroke="#247e92" strokeWidth="1.5" />
                            <line x1={startX + (isHorizontal ? 0 : windowOffset)} y1={startY + (isHorizontal ? windowOffset : 0)} x2={endX + (isHorizontal ? 0 : windowOffset)} y2={endY + (isHorizontal ? windowOffset : 0)} stroke="#247e92" strokeWidth="1.5" />
                          </>
                        ) : (
                          <path d={`M ${endX} ${endY} A ${segmentLength} ${segmentLength} 0 0 1 ${swingX} ${swingY} M ${startX} ${startY} L ${swingX} ${swingY}`} fill="none" stroke="#202722" strokeWidth="1.5" />
                        )}
                      </g>
                    );
                  })}
                  {(versionPreview.snapshot.roomLabels || []).map((label) => (
                    <text key={label.id} x={label.x * 25 + 1} y={label.y * 25 + 1} textAnchor="middle" dominantBaseline="middle" fill="#28312c" fontSize="5" fontWeight="700">{label.text}</text>
                  ))}
                </svg>
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
