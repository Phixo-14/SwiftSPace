import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
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

function normalizeQuarterGrid(value) {
  return Math.round(Number(value) * 4) / 4;
}

function createFloorCells(dimensions) {
  return Array.from({ length: dimensions.width * dimensions.length }, (_, index) => ({
    x: index % dimensions.width,
    y: Math.floor(index / dimensions.width),
  }));
}

function getFloorBoundaryEdges(floorCells) {
  const occupied = new Set(floorCells.map(({ x, y }) => `${x},${y}`));
  const edges = [];
  floorCells.forEach(({ x, y }) => {
    if (!occupied.has(`${x - 1},${y}`)) edges.push({ x1: x, y1: y, x2: x, y2: y + 1 });
    if (!occupied.has(`${x + 1},${y}`)) edges.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
    if (!occupied.has(`${x},${y - 1}`)) edges.push({ x1: x, y1: y, x2: x + 1, y2: y });
    if (!occupied.has(`${x},${y + 1}`)) edges.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 });
  });
  return edges;
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

function snapArchitecturalSegment(start, point, dimensions) {
  const deltaX = point.x - start.x;
  const deltaY = point.y - start.y;
  const snapAlongEdge = (value, maximum) => Math.max(0, Math.min(maximum, Math.round(value * 2) / 2));

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const edgeY = Math.max(0, Math.min(dimensions.length, Math.round(start.y)));
    return {
      start: { x: snapAlongEdge(start.x, dimensions.width), y: edgeY },
      end: { x: snapAlongEdge(point.x, dimensions.width), y: edgeY },
    };
  }

  const edgeX = Math.max(0, Math.min(dimensions.width, Math.round(start.x)));
  return {
    start: { x: edgeX, y: snapAlongEdge(start.y, dimensions.length) },
    end: { x: edgeX, y: snapAlongEdge(point.y, dimensions.length) },
  };
}

function snapArchitecturalPoint(point, dimensions) {
  const snap = (value, maximum) => Math.max(0, Math.min(maximum, Math.round(value * 2) / 2));
  return {
    x: snap(point.x, dimensions.width),
    y: snap(point.y, dimensions.length),
  };
}

export default function RoomEditor() {
  const { id } = useParams();
  const isNew = !id;
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDesigner = user?.role === 'interior-designer' || user?.role === 'admin';
  const draftStorageKey = `studio-grid-draft:${user?.id || 'signed-out'}:${id || `new:${location.key}`}`;
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
  const [floorCells, setFloorCells] = useState(
    storedDraft?.floorCells?.length ? storedDraft.floorCells : createFloorCells(storedDraft?.dimensions || DEFAULT_DIMENSIONS)
  );
  const [floorColor, setFloorColor] = useState(storedDraft?.floorColor || FLOOR_OPTIONS[0].floor);
  const [gridColor, setGridColor] = useState(storedDraft?.gridColor || FLOOR_OPTIONS[0].grid);
  const [wallThicknessMm, setWallThicknessMm] = useState(storedDraft?.wallThicknessMm || 150);
  const [architecturalSegments, setArchitecturalSegments] = useState(storedDraft?.architecturalSegments || []);
  const [roomLabels, setRoomLabels] = useState(storedDraft?.roomLabels || []);
  const [architecturalTool, setArchitecturalTool] = useState('select');
  const [pendingArchitectPoint, setPendingArchitectPoint] = useState(null);
  const [architecturalDragEnd, setArchitecturalDragEnd] = useState(null);
  const [architecturalDragDelta, setArchitecturalDragDelta] = useState({ x: 0, y: 0 });
  const [architecturalSegmentDraft, setArchitecturalSegmentDraft] = useState(null);
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
  const [resizeDraft, setResizeDraft] = useState(null);
  const [furnitureMoveDraft, setFurnitureMoveDraft] = useState(null);
  const [hoverCell, setHoverCell] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [platformRotation, setPlatformRotation] = useState(0);
  const [showFloorExtensions, setShowFloorExtensions] = useState(false);
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
  const lastArrangementRecordIntervalRef = useRef(0);
  const arrangementRecordInFlightRef = useRef(false);
  const canvasWrapRef = useRef(null);
  const gridResizeRef = useRef(null);
  const furnitureResizeRef = useRef(null);
  const architecturalDragRef = useRef(null);
  const extensionDragRef = useRef(false);
  const suppressGridClickRef = useRef(false);
  const catalogDragRef = useRef(false);

  useEffect(() => {
    const stopExtensionDrag = () => {
      extensionDragRef.current = false;
    };
    window.addEventListener('pointerup', stopExtensionDrag);
    window.addEventListener('pointercancel', stopExtensionDrag);
    return () => {
      window.removeEventListener('pointerup', stopExtensionDrag);
      window.removeEventListener('pointercancel', stopExtensionDrag);
    };
  }, []);

  function getEditorSnapshot(snapshotPlacedItems = placedItems) {
    return JSON.stringify({
      roomName,
      clientName,
      measurements,
      designNotes,
      dimensions,
      floorCells,
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
    setFloorCells(snapshot.floorCells || createFloorCells(snapshot.dimensions));
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
        setFloorCells(draft.floorCells?.length ? draft.floorCells : createFloorCells(draft.dimensions || DEFAULT_DIMENSIONS));
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
          setFloorCells(roomRes.data.floorCells?.length
            ? roomRes.data.floorCells
            : createFloorCells(roomRes.data.dimensions));
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
        if (isNew) restoreDraft();
        if (!cancelled) {
          setStatus(err.response?.status === 403 || err.response?.status === 404
            ? 'This room is not available in the current account.'
            : 'Could not load room data.');
        }
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
      floorCells,
      floorColor,
      gridColor,
      ...(isDesigner ? { wallThicknessMm, architecturalSegments, roomLabels } : {}),
      placedItems,
      overlapRecords,
    }));
  }, [architecturalSegments, clientName, designNotes, dimensions, draftReady, draftStorageKey, floorCells, floorColor, gridColor, isDesigner, loading, measurements, overlapRecords, placedItems, roomLabels, roomName, timerSeconds, wallThicknessMm]);

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
  }, [architecturalSegments, clientName, designNotes, dimensions, draftReady, floorCells, floorColor, gridColor, id, loading, measurements, overlapRecords, placedItems, roomLabels, roomName, wallThicknessMm]);

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

    const bounds = getFurnitureBounds(item, rotation, catalogItem);
    const minCellX = Math.floor(item.gridX);
    const minCellY = Math.floor(item.gridY);
    const maxCellX = Math.ceil(item.gridX + bounds.width - 1e-9);
    const maxCellY = Math.ceil(item.gridY + bounds.length - 1e-9);
    return Array.from(
      { length: (maxCellX - minCellX) * (maxCellY - minCellY) },
      (_, index) => ({
        x: minCellX + index % (maxCellX - minCellX) - item.gridX,
        y: minCellY + Math.floor(index / (maxCellX - minCellX)) - item.gridY,
      })
    );
  }

  function getFurnitureBounds(item, rotation = item.rotation, catalogItem = catalogById.get(item.catalogItemId)) {
    if (!catalogItem) return { minX: 0, minY: 0, width: 1, length: 1 };
    const footprintWidth = item.size?.width || catalogItem.footprint.width;
    const footprintLength = item.size?.length || catalogItem.footprint.length;
    const radians = (rotation * Math.PI) / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    return {
      minX: 0,
      minY: 0,
      width: Math.max(0.25, footprintWidth * cosine + footprintLength * sine),
      length: Math.max(0.25, footprintWidth * sine + footprintLength * cosine),
    };
  }

  function furnitureOverlaps(candidate, ignoredItems = []) {
    const candidateBounds = getFurnitureBounds(candidate);
    const epsilon = 1e-9;
    return placedItems.some((item) => {
      if (item === candidate || ignoredItems.some((ignored) => (
        ignored && (item === ignored || item.placementId === ignored.placementId)
      ))) return false;
      const bounds = getFurnitureBounds(item);
      return candidate.gridX < item.gridX + bounds.width - epsilon
        && candidate.gridX + candidateBounds.width > item.gridX + epsilon
        && candidate.gridY < item.gridY + bounds.length - epsilon
        && candidate.gridY + candidateBounds.length > item.gridY + epsilon;
    });
  }

  function getClampedFurniturePosition(item, gridX, gridY) {
    const bounds = getFurnitureBounds(item);
    const maxX = dimensions.width - bounds.width;
    const maxY = dimensions.length - bounds.length;
    if (maxX < 0 || maxY < 0) return null;
    return {
      gridX: Math.max(0, Math.min(maxX, gridX)),
      gridY: Math.max(0, Math.min(maxY, gridY)),
    };
  }

  function getFurnitureImagePosition(gridX, gridY, bounds) {
    const horizontal = gridX <= 0
      ? 'left'
      : gridX + bounds.width >= dimensions.width ? 'right' : 'center';
    const vertical = gridY <= 0
      ? 'top'
      : gridY + bounds.length >= dimensions.length ? 'bottom' : 'center';
    return `${horizontal} ${vertical}`;
  }

  function isPointOnRoomFloor(x, y) {
    const epsilon = 1e-7;
    for (let cellY = Math.floor(y) - 1; cellY <= Math.floor(y) + 1; cellY += 1) {
      for (let cellX = Math.floor(x) - 1; cellX <= Math.floor(x) + 1; cellX += 1) {
        if (floorCellSet.has(`${cellX},${cellY}`)
          && x >= cellX - epsilon && x <= cellX + 1 + epsilon
          && y >= cellY - epsilon && y <= cellY + 1 + epsilon) return true;
      }
    }
    return false;
  }

  function isSegmentOnRoomFloor(segment) {
    const length = Math.hypot(segment.endX - segment.startX, segment.endY - segment.startY);
    const steps = Math.max(1, Math.ceil(length * 4));
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const x = segment.startX + (segment.endX - segment.startX) * progress;
      const y = segment.startY + (segment.endY - segment.startY) * progress;
      if (!isPointOnRoomFloor(x, y)) return false;
    }
    return true;
  }

  function extendRoomAt(x, y) {
    const floor = new Set(floorCells.map(({ x: floorX, y: floorY }) => `${floorX},${floorY}`));
    const key = `${x},${y}`;
    if (floor.has(key) || ![[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .some(([neighborX, neighborY]) => floor.has(`${neighborX},${neighborY}`))) return;

    const shiftX = x < 0 ? 1 : 0;
    const shiftY = y < 0 ? 1 : 0;
    const nextWidth = dimensions.width + (x < 0 || x >= dimensions.width ? 1 : 0);
    const nextLength = dimensions.length + (y < 0 || y >= dimensions.length ? 1 : 0);
    if (nextWidth > 50 || nextLength > 50) {
      setStatus('Room dimensions cannot exceed 50 grid cells.');
      return;
    }

    const shifted = floorCells.map((cell) => ({ x: cell.x + shiftX, y: cell.y + shiftY }));
    shifted.push({ x: x + shiftX, y: y + shiftY });
    setFloorCells(shifted);
    setDimensions({ width: nextWidth, length: nextLength });
    const widthDelta = nextWidth - dimensions.width;
    const lengthDelta = nextLength - dimensions.length;
    const edgeX = x < 0 ? -1 : x >= dimensions.width ? 1 : 0;
    const edgeY = y < 0 ? -1 : y >= dimensions.length ? 1 : 0;
    updateArchitectureWithRoomResize(
      dimensions,
      widthDelta,
      lengthDelta,
      shiftX,
      shiftY,
      edgeX,
      edgeY
    );
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
    setStatus('');
  }

  function beginFloorExtensionDrag(event, x, y) {
    if (event.button !== 0) return;
    event.preventDefault();
    extensionDragRef.current = true;
    extendRoomAt(x, y);
  }

  function continueFloorExtensionDrag(x, y) {
    if (extensionDragRef.current) extendRoomAt(x, y);
  }

  function activateFloorExtensionByKeyboard(event, x, y) {
    if (event.detail === 0) extendRoomAt(x, y);
  }

  function furnitureTouchesDoor(item) {
    const epsilon = 1e-9;
    const bounds = getFurnitureBounds(item);
    const itemBounds = {
      left: item.gridX,
      top: item.gridY,
      right: item.gridX + bounds.width,
      bottom: item.gridY + bounds.length,
    };

    return architecturalSegments.some((segment) => {
      if (segment.type !== 'door') return false;
      const minX = Math.min(segment.startX, segment.endX);
      const maxX = Math.max(segment.startX, segment.endX);
      const minY = Math.min(segment.startY, segment.endY);
      const maxY = Math.max(segment.startY, segment.endY);
      const horizontal = Math.abs(segment.startY - segment.endY) < epsilon;

      return horizontal
        ? segment.startY >= itemBounds.top - epsilon && segment.startY <= itemBounds.bottom + epsilon
          && maxX >= itemBounds.left - epsilon && minX <= itemBounds.right + epsilon
        : segment.startX >= itemBounds.left - epsilon && segment.startX <= itemBounds.right + epsilon
          && maxY >= itemBounds.top - epsilon && minY <= itemBounds.bottom + epsilon;
    });
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
  const floorCellSet = useMemo(
    () => new Set(floorCells.map(({ x, y }) => `${x},${y}`)),
    [floorCells]
  );
  const exposedFloorCells = useMemo(() => {
    const exposed = new Map();
    floorCells.forEach(({ x, y }) => {
      [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([nextX, nextY]) => {
        const key = `${nextX},${nextY}`;
        if (!floorCellSet.has(key)) exposed.set(key, { x: nextX, y: nextY });
      });
    });
    return [...exposed.values()];
  }, [floorCellSet, floorCells]);

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

    const requestedCandidate = {
      catalogItemId: activeItem.catalogItemId,
      gridX: hoverCell.x,
      gridY: hoverCell.y,
      rotation: activeItem.rotation,
    };
    const position = getClampedFurniturePosition(requestedCandidate, hoverCell.x, hoverCell.y);
    const candidate = position
      ? { ...requestedCandidate, ...position }
      : requestedCandidate;
    const occupiedCells = getOccupiedCells(candidate);
    const doorOverlap = furnitureTouchesDoor(candidate);
    const overlapsOtherFurniture = furnitureOverlaps(candidate, [draggedItem]);
    const fitsOnFloor = occupiedCells.every(({ x, y }) => {
      const cellX = candidate.gridX + x;
      const cellY = candidate.gridY + y;
      return cellX >= 0 && cellY >= 0
        && cellX < dimensions.width && cellY < dimensions.length
        && floorCellSet.has(`${cellX},${cellY}`);
    });

    const canPlace = Boolean(position) && fitsOnFloor && !doorOverlap;

    const bounds = getFurnitureBounds(candidate, activeItem.rotation, catalogItem);
    return {
      ...candidate,
      catalogItem,
      bounds,
      occupiedCells,
      overlapsOtherFurniture,
      canPlace,
      reason: doorOverlap
        ? 'Furniture overlaps a door opening.'
        : overlapsOtherFurniture
          ? 'Furniture overlap: this placement conflicts with another item.'
        : !position
          ? 'This furniture footprint is larger than the room.'
          : !fitsOnFloor
            ? 'Furniture must fit fully on the room floor.'
            : null,
    };
  }, [architecturalSegments, armedItemId, catalogById, dimensions, draggedItem, floorCellSet, hoverCell, itemsByCell, selectedItem]);

  const previewCellSet = useMemo(() => {
    if (!previewItem || !hoverCell) return new Set();
    return new Set(
      previewItem.occupiedCells.map(({ x, y }) => `${previewItem.gridX + x},${previewItem.gridY + y}`)
    );
  }, [previewItem, hoverCell]);

  const hoverError = previewItem && !previewItem.canPlace
    ? previewItem.reason
    : previewItem?.overlapsOtherFurniture
      ? 'Furniture overlaps another item.'
      : '';

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
      const label = { id: createPlacementId(), text, ...point, rotation: 0 };
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
    const requestedCandidate = { catalogItemId, gridX: x, gridY: y, rotation };
    const position = getClampedFurniturePosition(requestedCandidate, x, y);
    if (!position) {
      setStatus('This furniture footprint is larger than the room.');
      return false;
    }
    const candidate = { ...requestedCandidate, ...position };
    const occupiedCells = getOccupiedCells(candidate);
    const fitsOnFloor = occupiedCells.every(({ x: offsetX, y: offsetY }) => {
      const cellX = candidate.gridX + offsetX;
      const cellY = candidate.gridY + offsetY;
      return cellX >= 0 && cellY >= 0
        && cellX < dimensions.width && cellY < dimensions.length
        && floorCellSet.has(`${cellX},${cellY}`);
    });
    const overlapsOtherFurniture = furnitureOverlaps(candidate);
    const doorOverlap = furnitureTouchesDoor(candidate);

    if (!fitsOnFloor || doorOverlap) {
      const reason = doorOverlap
        ? 'Furniture overlaps a door opening.'
        : 'Furniture must fit fully on the room floor.';
      if (doorOverlap) {
        recordOverlap(candidate, candidate.gridX, candidate.gridY, reason);
        setStatus('Overlap recorded. ' + reason);
      } else {
        setStatus(reason);
      }
      return false;
    }

    if (overlapsOtherFurniture) {
      recordOverlap(candidate, candidate.gridX, candidate.gridY, 'Furniture overlaps another item.');
    }

    setPlacedItems((current) => [
      ...current,
      { placementId: createPlacementId(), ...candidate, customColor: null },
    ]);
    setSelectedKey(`${Math.floor(candidate.gridX)},${Math.floor(candidate.gridY)}`);
    setSelectedArchitecturalElement(null);
    setArmedItemId(null);
    setStatus(overlapsOtherFurniture ? 'Furniture placed with overlap warning.' : '');
    return true;
  }

  function placeArmedItemAtNearestFloor(point) {
    if (!armedItemId) return false;
    const rotation = selectedItem?.rotation || 0;
    let nearest = null;

    for (let quarterY = 0; quarterY < dimensions.length * 4; quarterY += 1) {
      const y = quarterY / 4;
      for (let quarterX = 0; quarterX < dimensions.width * 4; quarterX += 1) {
        const x = quarterX / 4;
        const candidate = { catalogItemId: armedItemId, gridX: x, gridY: y, rotation };
        const occupiedCells = getOccupiedCells(candidate);
        const clear = occupiedCells.every(({ x: offsetX, y: offsetY }) => {
          const cellX = x + offsetX;
          const cellY = y + offsetY;
          return cellX < dimensions.width && cellY < dimensions.length
            && floorCellSet.has(`${cellX},${cellY}`);
        });
        if (!clear || furnitureTouchesDoor(candidate)) continue;
        const bounds = getFurnitureBounds(candidate);
        const centerX = x + bounds.width / 2;
        const centerY = y + bounds.length / 2;
        const candidatePosition = {
          x,
          y,
          distance: Math.hypot(point.x - centerX, point.y - centerY),
        };
        if (!nearest || candidatePosition.distance < nearest.distance) nearest = candidatePosition;
      }
    }

    if (!nearest) {
      setStatus('No clear floor area is available for this furniture.');
      return false;
    }
    return placeCatalogItemAt(armedItemId, nearest.x, nearest.y, rotation);
  }

  const handleCellClick = useCallback(
    (x, y, event) => {
      if (isDesigner && ['wall', 'door', 'window'].includes(architecturalTool)) return;
      if (isDesigner && architecturalTool !== 'select') {
        handleArchitecturalCellClick(x, y);
        return;
      }
      const key = `${x},${y}`;
      const existing = itemsByCell.get(key);
      setSelectedArchitecturalElement(null);

      if (!floorCellSet.has(key)) return;
      if (existing && !armedItemId) {
        setSelectedKey(key);
        setArmedItemId(null);
        return;
      }

      if (!armedItemId) {
        setSelectedKey(null);
        return;
      }

      if (armedItemId) {
        const svg = canvasWrapRef.current?.querySelector('.room-boundary-overlay');
        const point = event ? getArchitecturalPoint(svg, event.clientX, event.clientY) : null;
        if (point) {
          placeArmedItemAtNearestFloor(point);
        } else {
          const currentRotation = selectedItem ? selectedItem.rotation : 0;
          placeCatalogItemAt(armedItemId, x, y, currentRotation);
        }
      } else {
        setSelectedKey(null);
      }
    },
    [architecturalSegments, architecturalTool, floorCellSet, isDesigner, pendingArchitectPoint, roomLabels, roomLabelText, armedItemId, dimensions, itemsByCell, selectedItem, placeCatalogItemAt, placeArmedItemAtNearestFloor]
  );

  function setItemRotation(nextRotation) {
    if (!selectedItem) return;
    nextRotation = ((Number(nextRotation) % 360) + 360) % 360;
    if (selectedItem.rotation === nextRotation) return;

    const rotatedCandidate = { ...selectedItem, rotation: nextRotation };
    const fitsOnFloor = getOccupiedCells(selectedItem, nextRotation).every(({ x, y }) => {
      const cellX = selectedItem.gridX + x;
      const cellY = selectedItem.gridY + y;
      return cellX >= 0 && cellY >= 0
        && cellX < dimensions.width && cellY < dimensions.length
        && floorCellSet.has(`${cellX},${cellY}`);
    });
    const doorOverlap = furnitureTouchesDoor(rotatedCandidate);
    const overlapsOtherFurniture = furnitureOverlaps(rotatedCandidate, [selectedItem]);

    if (!fitsOnFloor || doorOverlap) {
      const reason = doorOverlap
        ? 'Furniture overlaps a door opening.'
        : 'Furniture must fit fully on the room floor.';
      if (doorOverlap) {
        recordOverlap({ ...selectedItem, rotation: nextRotation }, selectedItem.gridX, selectedItem.gridY, reason);
        setStatus('Overlap recorded. ' + reason);
      } else {
        setStatus(reason);
      }
      return;
    }

    if (overlapsOtherFurniture) {
      recordOverlap({ ...selectedItem, rotation: nextRotation }, selectedItem.gridX, selectedItem.gridY, 'Furniture overlaps another item.');
    }

    setPlacedItems((prev) =>
      prev.map((item) =>
        item.placementId === selectedItem.placementId
          ? { ...item, rotation: nextRotation }
          : item
      )
    );
    setStatus(overlapsOtherFurniture ? 'Furniture rotated with overlap warning.' : '');
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

  function rotatePlacedItem(itemToRotate, stepDegrees = 90) {
    if (!itemToRotate) return;

    const nextRotation = ((itemToRotate.rotation + stepDegrees) % 360 + 360) % 360;
    const candidate = { ...itemToRotate, rotation: nextRotation };
    const fitsOnFloor = getOccupiedCells(candidate).every(({ x, y }) => {
      const cellX = itemToRotate.gridX + x;
      const cellY = itemToRotate.gridY + y;
      return cellX >= 0 && cellY >= 0
        && cellX < dimensions.width && cellY < dimensions.length
        && floorCellSet.has(`${cellX},${cellY}`);
    });
    const overlapsOtherFurniture = furnitureOverlaps(candidate, [itemToRotate]);
    const doorOverlap = furnitureTouchesDoor(candidate);

    if (!fitsOnFloor || doorOverlap) {
      const reason = doorOverlap
        ? 'Furniture overlaps a door opening.'
        : 'Furniture must fit fully on the room floor.';
      if (doorOverlap) {
        recordOverlap(candidate, itemToRotate.gridX, itemToRotate.gridY, reason);
        setStatus('Overlap recorded. ' + reason);
      } else {
        setStatus(reason);
      }
      return;
    }

    if (overlapsOtherFurniture) {
      recordOverlap(candidate, itemToRotate.gridX, itemToRotate.gridY, 'Furniture overlaps another item.');
    }

    setPlacedItems((current) => current.map((item) => item === itemToRotate ? { ...item, rotation: nextRotation } : item));
    setSelectedKey(`${Math.floor(itemToRotate.gridX)},${Math.floor(itemToRotate.gridY)}`);
    setStatus(overlapsOtherFurniture ? 'Furniture rotated with overlap warning.' : '');
  }

  function commitRotationDraft(nextRotation = rotationDraft) {
    if (nextRotation === null || !Number.isFinite(Number(nextRotation))) return;
    setRotationDraft(null);
    setItemRotation(Number(nextRotation));
  }

  function moveItem(itemToMove, gridX, gridY) {
    const requestedCandidate = { ...itemToMove, gridX, gridY };
    const position = getClampedFurniturePosition(requestedCandidate, gridX, gridY);
    if (!position) {
      setStatus('This furniture footprint is larger than the room.');
      return;
    }
    const candidate = { ...requestedCandidate, ...position };
    const fitsOnFloor = getOccupiedCells(candidate).every(({ x, y }) => {
      const cellX = candidate.gridX + x;
      const cellY = candidate.gridY + y;
      return cellX >= 0 && cellY >= 0
        && cellX < dimensions.width && cellY < dimensions.length
        && floorCellSet.has(`${cellX},${cellY}`);
    });
    const overlapsOtherFurniture = furnitureOverlaps(candidate, [itemToMove]);
    const doorOverlap = furnitureTouchesDoor(candidate);

    if (!fitsOnFloor || doorOverlap) {
      const reason = doorOverlap
        ? 'Furniture overlaps a door opening.'
        : 'Furniture must fit fully on the room floor.';
      if (doorOverlap) {
        recordOverlap(candidate, candidate.gridX, candidate.gridY, reason);
        setStatus('Overlap recorded. ' + reason);
      } else {
        setStatus(reason);
      }
      return;
    }

    if (overlapsOtherFurniture) {
      recordOverlap(candidate, candidate.gridX, candidate.gridY, 'Furniture overlaps another item.');
    }

    setPlacedItems((prev) =>
      prev.map((item) => (item === itemToMove ? { ...item, ...position } : item))
    );
    setSelectedKey(`${Math.floor(position.gridX)},${Math.floor(position.gridY)}`);
    setStatus(overlapsOtherFurniture ? 'Furniture moved with overlap warning.' : '');
  }

  function resizeFurniture(
    itemToResize,
    width,
    length,
    gridX = itemToResize.gridX,
    gridY = itemToResize.gridY
  ) {
    const candidate = { ...itemToResize, gridX, gridY, size: { width, length } };
    const occupiedCells = getOccupiedCells(candidate);
    const fitsInRoom = occupiedCells.every(({ x, y }) =>
      candidate.gridX + x >= 0 && candidate.gridY + y >= 0
      && candidate.gridX + x < dimensions.width && candidate.gridY + y < dimensions.length
      && floorCellSet.has(`${candidate.gridX + x},${candidate.gridY + y}`)
    );
    const overlapsFurniture = furnitureOverlaps(candidate, [itemToResize]);
    const doorOverlap = furnitureTouchesDoor(candidate);

    if (!fitsInRoom || doorOverlap) {
      setStatus(doorOverlap
        ? 'Furniture overlaps a door opening.'
        : 'Furniture must fit fully on the room floor.');
      if (!fitsInRoom) return false;
      if (doorOverlap) {
        recordOverlap(candidate, candidate.gridX, candidate.gridY, 'Furniture overlaps a door opening.');
      }
      return false;
    }

    if (overlapsFurniture) {
      recordOverlap(candidate, candidate.gridX, candidate.gridY, 'Furniture overlaps another item.');
    }

    setPlacedItems((current) => current.map((item) =>
      item.placementId === itemToResize.placementId
        ? { ...item, gridX: candidate.gridX, gridY: candidate.gridY, size: candidate.size }
        : item
    ));
    setSelectedKey(`${Math.floor(candidate.gridX)},${Math.floor(candidate.gridY)}`);
    setStatus(overlapsFurniture ? 'Furniture resized with overlap warning.' : '');
    return true;
  }

  function beginFurnitureResize(event, item, catalogItem, handle) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const width = item.size?.width || catalogItem.footprint.width;
    const length = item.size?.length || catalogItem.footprint.length;
    furnitureResizeRef.current = {
      pointerId: event.pointerId,
      placementId: item.placementId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      width,
      length,
      gridX: item.gridX,
      gridY: item.gridY,
      scale: Math.max(0.1, zoom * fitZoom),
      rotation: platformRotation * Math.PI / 180,
    };
    setSelectedKey(`${Math.floor(item.gridX)},${Math.floor(item.gridY)}`);
    setSelectedArchitecturalElement(null);
    setResizeDraft({
      placementId: item.placementId,
      width,
      length,
      gridX: item.gridX,
      gridY: item.gridY,
    });
  }

  function getFurnitureResizeSize(resize, event) {
    const screenX = event.clientX - resize.startX;
    const screenY = event.clientY - resize.startY;
    const cosine = Math.cos(resize.rotation);
    const sine = Math.sin(resize.rotation);
    const gridDeltaX = (screenX * cosine + screenY * sine) / (resize.scale * 43);
    const gridDeltaY = (screenY * cosine - screenX * sine) / (resize.scale * 43);
    const roundedDeltaX = Math.round(gridDeltaX * 4) / 4;
    const roundedDeltaY = Math.round(gridDeltaY * 4) / 4;
    const changesWestEdge = resize.handle.includes('west');
    const changesNorthEdge = resize.handle.includes('north');
    const widthDelta = changesWestEdge ? -roundedDeltaX
      : resize.handle.includes('east') ? roundedDeltaX : null;
    const lengthDelta = changesNorthEdge ? -roundedDeltaY
      : resize.handle.includes('south') ? roundedDeltaY : null;
    const widthScale = widthDelta === null ? null : 1 + widthDelta / resize.width;
    const lengthScale = lengthDelta === null ? null : 1 + lengthDelta / resize.length;
    const scale = widthScale === null ? lengthScale
      : lengthScale === null ? widthScale
        : Math.abs(widthScale - 1) >= Math.abs(lengthScale - 1) ? widthScale : lengthScale;
    const clampedScale = Math.max(
      0.25 / resize.width,
      0.25 / resize.length,
      Math.min(50 / resize.width, 50 / resize.length, scale ?? 1)
    );
    const width = Math.max(0.25, Math.round(resize.width * clampedScale * 4) / 4);
    const length = Math.max(0.25, Math.round(resize.length * clampedScale * 4) / 4);
    const changesHorizontalEdge = widthDelta !== null;
    const changesVerticalEdge = lengthDelta !== null;
    return {
      width,
      length,
      gridX: resize.gridX + (changesWestEdge
        ? resize.width - width
        : changesHorizontalEdge ? 0 : (resize.width - width) / 2),
      gridY: resize.gridY + (changesNorthEdge
        ? resize.length - length
        : changesVerticalEdge ? 0 : (resize.length - length) / 2),
    };
  }

  function updateFurnitureResize(event) {
    const resize = furnitureResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setResizeDraft({
      placementId: resize.placementId,
      ...getFurnitureResizeSize(resize, event),
    });
  }

  function finishFurnitureResize(event) {
    const resize = furnitureResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const item = placedItems.find((placedItem) => placedItem.placementId === resize.placementId);
    if (item) {
      const finalSize = getFurnitureResizeSize(resize, event);
      resizeFurniture(item, finalSize.width, finalSize.length, finalSize.gridX, finalSize.gridY);
    }
    furnitureResizeRef.current = null;
    setResizeDraft(null);
  }

  function cancelFurnitureResize(event) {
    if (furnitureResizeRef.current?.pointerId !== event.pointerId) return;
    furnitureResizeRef.current = null;
    setResizeDraft(null);
  }

  function handleFurnitureResizeKeyDown(event, item, catalogItem) {
    const width = item.size?.width || catalogItem.footprint.width;
    const length = item.size?.length || catalogItem.footprint.length;
    const changes = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const change = changes[event.key];
    if (!change) return;
    event.preventDefault();
    event.stopPropagation();
    resizeFurniture(
      item,
      Math.max(0.25, Math.min(50, width + change[0])),
      Math.max(0.25, Math.min(50, length + change[1]))
    );
  }

  function handleCatalogDragStart(event, item) {
    const rotation = selectedItem?.rotation || 0;
    catalogDragRef.current = true;
    setArmedItemId(null);
    setDraggedItem({ catalogItemId: item._id, rotation });
    event.dataTransfer.effectAllowed = 'copy';
    const glyph = event.currentTarget.querySelector('.glyph');
    if (glyph) {
      const glyphBounds = glyph.getBoundingClientRect();
      event.dataTransfer.setDragImage(glyph, glyphBounds.width / 2, glyphBounds.height / 2);
    }
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

  function handleCellDrop(event, gridX, gridY) {
    event.preventDefault();
    const svg = canvasWrapRef.current?.querySelector('.room-boundary-overlay');
    const point = getArchitecturalPoint(svg, event.clientX, event.clientY);
    const dropX = point ? Math.floor(point.x) : gridX;
    const dropY = point ? Math.floor(point.y) : gridY;
    const data = event.dataTransfer.getData('application/json');
    if (!data) return;
    const dragged = JSON.parse(data);
    if (dragged.kind === 'catalog') {
      placeCatalogItemAt(dragged.catalogItemId, dropX, dropY, dragged.rotation || 0);
      setDraggedItem(null);
      return;
    }
    const item = dragged.placementId
      ? placedItems.find((candidate) => candidate.placementId === dragged.placementId)
      : placedItems.find((candidate) =>
        candidate.gridX === dragged.gridX
        && candidate.gridY === dragged.gridY
        && candidate.catalogItemId === dragged.catalogItemId
      );
    if (item) moveItem(item, dropX, dropY);
    setDraggedItem(null);
  }

  function getArchitecturalPoint(svg, clientX, clientY) {
    const screenMatrix = svg?.getScreenCTM();
    if (!screenMatrix) return null;
    const screenPoint = svg.createSVGPoint();
    screenPoint.x = clientX;
    screenPoint.y = clientY;
    const planPoint = screenPoint.matrixTransform(screenMatrix.inverse());
    return { x: (planPoint.x - 1) / 43, y: (planPoint.y - 1) / 43 };
  }

  function getArchitecturalMoveDelta(drag, event) {
    const point = getArchitecturalPoint(drag.svg, event.clientX, event.clientY);
    if (!point) return drag.delta;
    let deltaX = Math.round(point.x - drag.pointerStart.x);
    let deltaY = Math.round(point.y - drag.pointerStart.y);
    const clampDelta = (delta, minimum, maximum) => (
      Math.max(Math.ceil(minimum), Math.min(Math.floor(maximum), delta))
    );

    if (drag.kind === 'segment') {
      const segment = drag.element;
      deltaX = clampDelta(
        deltaX,
        -Math.min(segment.startX, segment.endX),
        dimensions.width - Math.max(segment.startX, segment.endX),
      );
      deltaY = clampDelta(
        deltaY,
        -Math.min(segment.startY, segment.endY),
        dimensions.length - Math.max(segment.startY, segment.endY),
      );
    } else {
      deltaX = clampDelta(deltaX, 0.5 - drag.element.x, dimensions.width - 0.5 - drag.element.x);
      deltaY = clampDelta(deltaY, 0.5 - drag.element.y, dimensions.length - 0.5 - drag.element.y);
    }
    return { x: deltaX, y: deltaY };
  }

  function beginOutsideArchitectureDrag(event) {
    if (!isDesigner || !['wall', 'door', 'window'].includes(architecturalTool)) return;
    if (event.target.closest?.('.iso-grid, .workspace-controls, .workspace-item-controls')) return;
    setStatus(`Placement error: ${architecturalTool} must be drawn on the room floor.`);
  }

  function beginArchitecturalDrag(event) {
    if (event.target.closest?.('.floor-extension-cell')) return;
    if (!isDesigner) return;

    if (architecturalTool === 'select') {
      if (event.target.closest?.('.placed-item-resize-handle, [data-architecture-kind]')) return;
      const svg = event.currentTarget.querySelector('.architectural-overlay');
      const planPoint = getArchitecturalPoint(svg, event.clientX, event.clientY);
      if (!planPoint) return;

      const furnitureHit = [...placedItems].reverse().find((item) => {
        const bounds = getFurnitureBounds(item);
        const hitMargin = 0.2;
        return planPoint.x >= item.gridX - hitMargin
          && planPoint.x <= item.gridX + bounds.width + hitMargin
          && planPoint.y >= item.gridY - hitMargin
          && planPoint.y <= item.gridY + bounds.length + hitMargin;
      });
      if (furnitureHit) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        architecturalDragRef.current = {
          mode: 'move-furniture',
          pointerId: event.pointerId,
          item: furnitureHit,
          svg,
          pointerStart: planPoint,
          gridX: furnitureHit.gridX,
          gridY: furnitureHit.gridY,
          draft: { gridX: furnitureHit.gridX, gridY: furnitureHit.gridY },
        };
        suppressGridClickRef.current = true;
        setFurnitureMoveDraft({
          placementId: furnitureHit.placementId,
          gridX: furnitureHit.gridX,
          gridY: furnitureHit.gridY,
        });
        setSelectedKey(`${Math.floor(furnitureHit.gridX)},${Math.floor(furnitureHit.gridY)}`);
        setSelectedArchitecturalElement(null);
        setArmedItemId(null);
        return;
      }

      const segmentHits = architecturalSegments.map((segment) => ({
        kind: 'segment',
        element: segment,
        distance: distanceToSegment(planPoint, segment),
      }));
      const labelHits = roomLabels.map((label) => ({
        kind: 'label',
        element: label,
        distance: Math.hypot(planPoint.x - label.x, planPoint.y - label.y),
      }));
      const closest = [...segmentHits, ...labelHits].sort((first, second) => first.distance - second.distance)[0];
      if (!closest || closest.distance > 0.75) return;
      const { kind, element } = closest;
      const id = element.id;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      architecturalDragRef.current = {
        mode: 'move', pointerId: event.pointerId, kind, id, element, svg, pointerStart: planPoint, delta: { x: 0, y: 0 },
      };
      suppressGridClickRef.current = true;
      setArchitecturalDragDelta({ x: 0, y: 0 });
      setSelectedArchitecturalElement({ kind, id });
      setSelectedKey(null);
      setArmedItemId(null);
      return;
    }

    if (!['wall', 'door', 'window'].includes(architecturalTool)) return;
    if (event.target.closest?.('.grid-resize-handle, .floor-extension-cell, .placed-item')) return;
    const svg = event.currentTarget.querySelector('.architectural-overlay');
    let pointerPoint = getArchitecturalPoint(svg, event.clientX, event.clientY);
    if (!pointerPoint || pointerPoint.x < 0 || pointerPoint.y < 0
      || pointerPoint.x > dimensions.width || pointerPoint.y > dimensions.length) return;
    if (!isPointOnRoomFloor(pointerPoint.x, pointerPoint.y)) {
      setStatus(`Placement error: ${architecturalTool} must be drawn on the room floor.`);
      return;
    }
    if (architecturalSegments.length >= 300) {
      setStatus('A project can contain up to 300 walls, doors, and windows.');
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = snapArchitecturalPoint(pointerPoint, dimensions);
    architecturalDragRef.current = {
      mode: 'create',
      pointerId: event.pointerId,
      pointerStart: pointerPoint,
      start,
      end: start,
      type: architecturalTool,
      svg,
    };
    suppressGridClickRef.current = true;
    setPendingArchitectPoint(start);
    setArchitecturalDragEnd(start);
    setArchitecturalDragDelta({ x: 0, y: 0 });
    setSelectedArchitecturalElement(null);
    setSelectedKey(null);
    setArmedItemId(null);
    setStatus('');
  }

  function beginPlacedFurnitureDrag(event, item) {
    if (event.target.closest?.('.placed-item-resize-handle')) return;
    if (armedItemId || (isDesigner && architecturalTool !== 'select')) return;

    const svg = canvasWrapRef.current?.querySelector('.architectural-overlay, .room-boundary-overlay');
    const pointerStart = getArchitecturalPoint(svg, event.clientX, event.clientY);
    if (!svg || !pointerStart) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    architecturalDragRef.current = {
      mode: 'move-furniture',
      pointerId: event.pointerId,
      item,
      svg,
      pointerStart,
      gridX: item.gridX,
      gridY: item.gridY,
      draft: { gridX: item.gridX, gridY: item.gridY },
    };
    suppressGridClickRef.current = true;
    setFurnitureMoveDraft({ placementId: item.placementId, gridX: item.gridX, gridY: item.gridY });
    setSelectedKey(`${Math.floor(item.gridX)},${Math.floor(item.gridY)}`);
    setSelectedArchitecturalElement(null);
    setArmedItemId(null);
  }

  function beginArchitecturalElementDrag(event, kind, element) {
    if (architecturalTool !== 'select' || armedItemId) return;
    event.preventDefault();
    event.stopPropagation();

    const svg = event.currentTarget.ownerSVGElement;
    const pointerStart = getArchitecturalPoint(svg, event.clientX, event.clientY);
    if (!svg || !pointerStart) return;

    svg.setPointerCapture(event.pointerId);
    architecturalDragRef.current = {
      mode: 'move',
      pointerId: event.pointerId,
      kind,
      id: element.id,
      element,
      svg,
      pointerStart,
      delta: { x: 0, y: 0 },
    };
    suppressGridClickRef.current = true;
    setArchitecturalDragDelta({ x: 0, y: 0 });
    setSelectedArchitecturalElement({ kind, id: element.id });
    setSelectedKey(null);
    setArmedItemId(null);
  }

  function beginArchitecturalEndpointDrag(event, segment, endpoint) {
    if (architecturalTool !== 'select' || armedItemId) return;
    event.preventDefault();
    event.stopPropagation();

    const svg = event.currentTarget.ownerSVGElement;
    const pointerStart = getArchitecturalPoint(svg, event.clientX, event.clientY);
    if (!svg || !pointerStart) return;

    svg.setPointerCapture(event.pointerId);
    architecturalDragRef.current = {
      mode: 'resize-segment',
      pointerId: event.pointerId,
      endpoint,
      element: segment,
      svg,
      draft: segment,
    };
    suppressGridClickRef.current = true;
    setArchitecturalSegmentDraft({ id: segment.id, segment, valid: true });
    setSelectedArchitecturalElement({ kind: 'segment', id: segment.id });
    setSelectedKey(null);
    setArmedItemId(null);
  }

  function updateArchitecturalDrag(event) {
    const drag = architecturalDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === 'move-furniture') {
      const point = getArchitecturalPoint(drag.svg || event.currentTarget.querySelector('.architectural-overlay'), event.clientX, event.clientY);
      if (!point) return;
      const deltaX = Math.round((point.x - drag.pointerStart.x) * 4) / 4;
      const deltaY = Math.round((point.y - drag.pointerStart.y) * 4) / 4;
      const bounds = getFurnitureBounds(drag.item);
      const maxX = dimensions.width - bounds.width;
      const maxY = dimensions.length - bounds.length;
      const gridX = Math.max(0, Math.min(maxX, drag.gridX + deltaX));
      const gridY = Math.max(0, Math.min(maxY, drag.gridY + deltaY));
      drag.draft = { gridX, gridY };
      setFurnitureMoveDraft({ placementId: drag.item.placementId, gridX, gridY });
      return;
    }
    if (drag.mode === 'resize-segment') {
      const point = getArchitecturalPoint(drag.svg, event.clientX, event.clientY);
      if (!point) return;
      const original = drag.element;
      const horizontal = original.startY === original.endY;
      const axis = horizontal ? 'x' : 'y';
      const limit = horizontal ? dimensions.width : dimensions.length;
      const coordinate = Math.max(0, Math.min(limit, Math.round(point[axis] * 2) / 2));
      const segment = {
        ...original,
        ...(drag.endpoint === 'start'
          ? horizontal ? { startX: coordinate } : { startY: coordinate }
          : horizontal ? { endX: coordinate } : { endY: coordinate }),
      };
      drag.draft = segment;
      const valid = segment.startX !== segment.endX || segment.startY !== segment.endY;
      const onFloor = valid && isSegmentOnRoomFloor(segment);
      setArchitecturalSegmentDraft({ id: segment.id, segment, valid: onFloor });
      return;
    }
    if (drag.mode === 'move') {
      drag.delta = getArchitecturalMoveDelta(drag, event);
      setArchitecturalDragDelta(drag.delta);
      return;
    }
    const point = getArchitecturalPoint(drag.svg, event.clientX, event.clientY);
    if (!point) return;
    const segment = snapArchitecturalSegment(drag.pointerStart, point, dimensions);
    drag.start = segment.start;
    drag.end = segment.end;
    setPendingArchitectPoint(segment.start);
    setArchitecturalDragEnd(drag.end);
  }

  function finishArchitecturalDrag(event) {
    const drag = architecturalDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === 'move-furniture') {
      updateArchitecturalDrag(event);
      moveItem(drag.item, drag.draft.gridX, drag.draft.gridY);
      architecturalDragRef.current = null;
      setFurnitureMoveDraft(null);
      window.setTimeout(() => { suppressGridClickRef.current = false; }, 0);
      return;
    }
    if (drag.mode === 'resize-segment') {
      updateArchitecturalDrag(event);
      const segment = drag.draft;
      const segmentName = segment.type === 'window' ? 'Window' : segment.type === 'door' ? 'Door' : 'Wall';
      const valid = segment.startX !== segment.endX || segment.startY !== segment.endY;
      if (!valid) {
        setStatus(`A ${segmentName.toLowerCase()} must be at least one half grid cell long.`);
      } else if (!isSegmentOnRoomFloor(segment)) {
        setStatus(`Placement error: the ${segmentName.toLowerCase()} must stay on the room floor.`);
      } else {
        setArchitecturalSegments((current) => current.map((item) => (
          item.id === segment.id ? segment : item
        )));
        setStatus(`${segmentName} length updated.`);
      }
      architecturalDragRef.current = null;
      setArchitecturalSegmentDraft(null);
      window.setTimeout(() => { suppressGridClickRef.current = false; }, 0);
      return;
    }
    if (drag.mode === 'move') {
      updateArchitecturalDrag(event);
      const { x, y } = drag.delta;
      if (x || y) {
        if (drag.kind === 'segment') {
          const movedSegment = {
            ...drag.element,
            startX: drag.element.startX + x,
            startY: drag.element.startY + y,
            endX: drag.element.endX + x,
            endY: drag.element.endY + y,
          };
          if (!isSegmentOnRoomFloor(movedSegment)) {
            setStatus('Placement error: plan elements must stay on the room floor.');
          } else {
            setArchitecturalSegments((current) => current.map((currentSegment) => (
              currentSegment.id === drag.id ? movedSegment : currentSegment
            )));
            setStatus('Plan element moved.');
          }
        } else {
          const movedLabel = {
            ...drag.element,
            x: drag.element.x + x,
            y: drag.element.y + y,
          };
          if (!isPointOnRoomFloor(movedLabel.x, movedLabel.y)) {
            setStatus('Placement error: room labels must stay on the room floor.');
          } else {
            setRoomLabels((current) => current.map((currentLabel) => (
              currentLabel.id === drag.id ? movedLabel : currentLabel
            )));
            setStatus('Plan element moved.');
          }
        }
      } else {
        setStatus('Plan element selected.');
      }
      architecturalDragRef.current = null;
      setArchitecturalDragDelta({ x: 0, y: 0 });
      window.setTimeout(() => { suppressGridClickRef.current = false; }, 0);
      return;
    }

    updateArchitecturalDrag(event);

    let segment = null;
    if (drag.start.x !== drag.end.x || drag.start.y !== drag.end.y) {
      segment = {
        id: createPlacementId(),
        type: drag.type,
        thicknessMm: wallThicknessMm,
        startX: drag.start.x,
        startY: drag.start.y,
        endX: drag.end.x,
        endY: drag.end.y,
      };
    }

    if (segment) {
      if (!isSegmentOnRoomFloor(segment)) {
        setStatus(`Placement error: ${drag.type} must stay on the room floor.`);
      } else {
        setArchitecturalSegments((current) => [...current, segment]);
        setSelectedArchitecturalElement({ kind: 'segment', id: segment.id });
        setStatus(`${drag.type[0].toUpperCase()}${drag.type.slice(1)} added.`);
      }
    } else {
      setStatus('Drag across at least one grid cell to draw.');
    }

    architecturalDragRef.current = null;
    setPendingArchitectPoint(null);
    setArchitecturalDragEnd(null);
    setArchitecturalDragDelta({ x: 0, y: 0 });
    setArchitecturalTool('select');
    window.setTimeout(() => { suppressGridClickRef.current = false; }, 0);
  }

  function cancelArchitecturalDrag(event) {
    if (architecturalDragRef.current?.pointerId !== event.pointerId) return;
    architecturalDragRef.current = null;
    setFurnitureMoveDraft(null);
    setArchitecturalSegmentDraft(null);
    setPendingArchitectPoint(null);
    setArchitecturalDragEnd(null);
    setArchitecturalDragDelta({ x: 0, y: 0 });
    setArchitecturalTool('select');
    suppressGridClickRef.current = false;
  }

  function removeSelected() {
    if (!selectedItem) return;
    removeItem(selectedItem);
  }

  function removeArchitecturalElement(kind, id) {
    if (kind === 'segment') {
      setArchitecturalSegments((current) => current.filter((segment) => segment.id !== id));
    } else {
      setRoomLabels((current) => current.filter((label) => label.id !== id));
    }
    if (selectedArchitecturalElement?.kind === kind && selectedArchitecturalElement.id === id) {
      setSelectedArchitecturalElement(null);
    }
    setStatus('Plan element removed.');
  }

  function rotateArchitecturalElement(kind, id) {
    if (kind === 'label') {
      setRoomLabels((current) => current.map((label) => label.id === id
        ? { ...label, rotation: ((label.rotation || 0) + 90) % 360 }
        : label));
      setStatus('Room label rotated 90°.');
      return;
    }

    const segment = architecturalSegments.find((item) => item.id === id);
    if (!segment) return;
    const centerX = (segment.startX + segment.endX) / 2;
    const centerY = (segment.startY + segment.endY) / 2;
    const rotatePoint = (x, y) => ({
      x: centerX - (y - centerY),
      y: centerY + (x - centerX),
    });
    const start = rotatePoint(segment.startX, segment.startY);
    const end = rotatePoint(segment.endX, segment.endY);
    const rotatedSegment = {
      ...segment,
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
    };
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const shiftX = minX < 0 ? -minX : maxX > dimensions.width ? dimensions.width - maxX : 0;
    const shiftY = minY < 0 ? -minY : maxY > dimensions.length ? dimensions.length - maxY : 0;
    if (minX + shiftX < 0 || maxX + shiftX > dimensions.width
      || minY + shiftY < 0 || maxY + shiftY > dimensions.length) {
      setStatus('This element is too long to rotate within the room.');
      return;
    }

    rotatedSegment.startX += shiftX;
    rotatedSegment.startY += shiftY;
    rotatedSegment.endX += shiftX;
    rotatedSegment.endY += shiftY;
    if (!isSegmentOnRoomFloor(rotatedSegment)) {
      setStatus('Placement error: the rotated element must stay on the room floor.');
      return;
    }

    setArchitecturalSegments((current) => current.map((item) => (
      item.id === id ? rotatedSegment : item
    )));
    setStatus(`${segment.type[0].toUpperCase()}${segment.type.slice(1)} rotated 90°.`);
  }

  function removeItem(itemToRemove) {
    setPlacedItems((prev) =>
      prev.filter((item) => !(item.gridX === itemToRemove.gridX && item.gridY === itemToRemove.gridY))
    );
    if (selectedItem === itemToRemove) {
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
      .map((item) => ({
        ...item,
        placementId: item.placementId || createPlacementId(),
        gridX: normalizeQuarterGrid(item.gridX),
        gridY: normalizeQuarterGrid(item.gridY),
        ...(item.size ? {
          size: {
            width: normalizeQuarterGrid(item.size.width),
            length: normalizeQuarterGrid(item.size.length),
          },
        } : {}),
      }));
    const normalizedOverlapRecords = overlapRecords.map((record) => ({
      ...record,
      gridX: normalizeQuarterGrid(record.gridX),
      gridY: normalizeQuarterGrid(record.gridY),
    }));
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
      floorCells,
      floorColor,
      gridColor,
      ...(isDesigner ? { wallThicknessMm, architecturalSegments, roomLabels } : {}),
      placedItems: validPlacedItems,
      overlapRecords: normalizedOverlapRecords,
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
        if (afterSave) await afterSave(data);
        else navigate(`/room/${data._id}`, { replace: true });
      } else {
        const { data } = await api.put(`/rooms/${id}`, payload);
        const savedPlacedItems = data.placedItems || validPlacedItems;
        setPlacedItems(savedPlacedItems);
        window.localStorage.removeItem(draftStorageKey);
        setStatus('Saved.');
        baselineRef.current = getEditorSnapshot(savedPlacedItems);
        setIsDirty(false);
        if (afterSave) await afterSave(data);
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
    setVersionError('');
    setVersionMessage('');
    const name = versionName.trim() || `Version ${versions.length + 1}`;
    let targetRoomId = id;
    if (isNew) {
      const saved = await handleSave((room) => {
        targetRoomId = room._id;
        navigate(`/room/${targetRoomId}`, { replace: true });
      });
      if (!saved || !targetRoomId) return;
    } else if (isDirty && !(await handleSave())) {
      return;
    }

    setVersionSaving(true);
    setVersionError('');
    setVersionMessage('');
    try {
      const { data } = await api.post(`/rooms/${targetRoomId}/versions`, { name });
      setVersions((current) => [data, ...current].slice(0, 20));
      setVersionName('');
      setVersionMessage('Version saved.');
    } catch (requestError) {
      setVersionError(requestError.response?.data?.message || 'Could not save this version.');
    } finally {
      setVersionSaving(false);
    }
  }

  useEffect(() => {
    const interval = Math.floor(timerSeconds / (3 * 60));
    if (!draftReady || loading || !timerRunning || arrangementRecordInFlightRef.current || interval < 1
      || interval <= lastArrangementRecordIntervalRef.current || saving || versionSaving) return;

    lastArrangementRecordIntervalRef.current = interval;
    arrangementRecordInFlightRef.current = true;
    let targetRoomId = id;
    const recordSeconds = interval * 3 * 60;
    const name = `Rearrangement record · ${formatTimer(recordSeconds)}`;

    async function saveTimedArrangementRecord() {
      try {
        const saved = await handleSave(isNew ? (room) => {
          targetRoomId = room._id;
        } : undefined);
        if (!saved || !targetRoomId) return;
        const { data } = await api.post(`/rooms/${targetRoomId}/versions`, { name });
        setVersions((current) => [data, ...current].slice(0, 20));
        setStatus(`Rearrangement record saved at ${formatTimer(recordSeconds)}.`);
        if (isNew) navigate(`/room/${targetRoomId}`, { replace: true });
      } catch (requestError) {
        setStatus(requestError.response?.data?.message || 'Could not save the rearrangement record.');
      } finally {
        arrangementRecordInFlightRef.current = false;
      }
    }

    saveTimedArrangementRecord();
  }, [draftReady, handleSave, id, isNew, loading, navigate, saving, timerRunning, timerSeconds, versionSaving]);

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

  function updateArchitectureWithRoomResize(oldDimensions, widthDelta, lengthDelta, shiftX, shiftY, edgeX, edgeY) {
    if (!isDesigner || (!shiftX && !shiftY && !widthDelta && !lengthDelta)) return;

    setArchitecturalSegments((current) => current.map((segment) => {
      let updated = {
        ...segment,
        startX: segment.startX + shiftX,
        endX: segment.endX + shiftX,
        startY: segment.startY + shiftY,
        endY: segment.endY + shiftY,
      };
      const epsilon = 1e-9;
      const horizontal = Math.abs(updated.startY - updated.endY) < epsilon;
      const vertical = Math.abs(updated.startX - updated.endX) < epsilon;
      if (widthDelta && edgeX !== 0) {
        const right = edgeX > 0;
        const oldEdge = (right ? oldDimensions.width : 0) + shiftX;
        const newEdge = right ? oldDimensions.width + widthDelta : 0;
        if (updated.type === 'wall') {
          if (vertical && Math.abs(updated.startX - oldEdge) < epsilon) {
            updated.startX = newEdge;
            updated.endX = newEdge;
          } else if (horizontal) {
            if (Math.abs(updated.startX - oldEdge) < epsilon) updated.startX = newEdge;
            if (Math.abs(updated.endX - oldEdge) < epsilon) updated.endX = newEdge;
          }
        } else if (vertical && Math.abs(updated.startX - oldEdge) < epsilon) {
          updated.startX = newEdge;
          updated.endX = newEdge;
        }
      }
      if (lengthDelta && edgeY !== 0) {
        const bottom = edgeY > 0;
        const oldEdge = (bottom ? oldDimensions.length : 0) + shiftY;
        const newEdge = bottom ? oldDimensions.length + lengthDelta : 0;
        if (updated.type === 'wall') {
          if (horizontal && Math.abs(updated.startY - oldEdge) < epsilon) {
            updated.startY = newEdge;
            updated.endY = newEdge;
          } else if (vertical) {
            if (Math.abs(updated.startY - oldEdge) < epsilon) updated.startY = newEdge;
            if (Math.abs(updated.endY - oldEdge) < epsilon) updated.endY = newEdge;
          }
        } else if (horizontal && Math.abs(updated.startY - oldEdge) < epsilon) {
          updated.startY = newEdge;
          updated.endY = newEdge;
        }
      }
      return updated;
    }));
    if (shiftX || shiftY) {
      setRoomLabels((current) => current.map((label) => ({
        ...label,
        x: label.x + shiftX,
        y: label.y + shiftY,
      })));
    }
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
        if (edge === undefined || edge === null) return 0;
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
    updateArchitectureWithRoomResize(
      resize.dimensions,
      widthDelta,
      lengthDelta,
      shiftX,
      shiftY,
      resize.edgeX,
      resize.edgeY
    );
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
    if ((edgeX === 0 && edgeY === 0) || (movementX === 0 && movementY === 0)) return;
    event.preventDefault();

    const occupiedCoordinates = [...itemsByCell.keys()].map((key) => key.split(',').map(Number));
    const minX = occupiedCoordinates.length ? Math.min(...occupiedCoordinates.map(([x]) => x)) : null;
    const maxX = occupiedCoordinates.length ? Math.max(...occupiedCoordinates.map(([x]) => x)) : null;
    const minY = occupiedCoordinates.length ? Math.min(...occupiedCoordinates.map(([, y]) => y)) : null;
    const maxY = occupiedCoordinates.length ? Math.max(...occupiedCoordinates.map(([, y]) => y)) : null;

    function getDelta(edge, movement, size, minOccupied, maxOccupied) {
      if (edge === undefined || edge === null || movement === 0) return 0;
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
    updateArchitectureWithRoomResize(
      dimensions,
      widthDelta,
      lengthDelta,
      shiftX,
      shiftY,
      edgeX,
      edgeY
    );
    setHoverCell(null);
  }

  function updateZoom(nextZoom) {
    setZoom(Math.max(0.6, Math.min(1.8, Number(nextZoom.toFixed(2)))));
  }

  useEffect(() => {
    const canvas = canvasWrapRef.current;
    if (!canvas) return undefined;

    function handleWorkspacePinch(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      setZoom((currentZoom) => Math.max(
        0.6,
        Math.min(1.8, Number((currentZoom + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(2)))
      ));
    }

    canvas.addEventListener('wheel', handleWorkspacePinch, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWorkspacePinch);
  }, []);

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
      const key = `${x},${y}`;
      cells.push({
        x,
        y,
        isFloor: floorCellSet.has(key),
        canExtend: exposedFloorCells.some((cell) => cell.x === x && cell.y === y),
      });
    }
  }
  const outsideExtensions = exposedFloorCells.filter(({ x, y }) => (
    x < 0 || y < 0 || x >= dimensions.width || y >= dimensions.length
  ));
  const roomBoundaryEdges = getFloorBoundaryEdges(floorCells);
  const renderArchitecturalSegments = [...architecturalSegments].sort((first, second) => (
    (first.type === 'wall' ? 0 : 1) - (second.type === 'wall' ? 0 : 1)
  ));
  const versionFloorCells = versionPreview
    ? versionPreview.snapshot.floorCells?.length
      ? versionPreview.snapshot.floorCells
      : createFloorCells(versionPreview.snapshot.dimensions)
    : [];
  const versionFloorCellSet = new Set(versionFloorCells.map(({ x, y }) => `${x},${y}`));
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
          {(hoverError || status) && <span className={`status-text ${hoverError || status.startsWith('Placement error:') ? 'error' : ''}`}>{hoverError || status}</span>}
          <span className="mono" aria-label="Workspace timer" title="A rearrangement record is saved every 3 active minutes">{formatTimer(timerSeconds)}</span>
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
                      setArchitecturalTool(
                        tool.value !== 'select' && architecturalTool === tool.value
                          ? 'select'
                          : tool.value
                      );
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
                Default wall thickness
                <select value={wallThicknessMm} onChange={(event) => setWallThicknessMm(Number(event.target.value))}>
                  {[100, 125, 150, 200, 250, 300].map((thickness) => (
                    <option value={thickness} key={thickness}>{thickness} mm</option>
                  ))}
                </select>
              </label>
              {selectedArchitecturalElement?.kind === 'segment'
                && architecturalSegments.find((segment) => segment.id === selectedArchitecturalElement.id)?.type === 'wall' && (
                <label className="inspector-field architect-thickness">
                  Selected wall thickness
                  <select
                    value={architecturalSegments.find((segment) => segment.id === selectedArchitecturalElement.id)?.thicknessMm || wallThicknessMm}
                    onChange={(event) => {
                      const thicknessMm = Number(event.target.value);
                      setArchitecturalSegments((current) => current.map((segment) => (
                        segment.id === selectedArchitecturalElement.id ? { ...segment, thicknessMm } : segment
                      )));
                    }}
                  >
                    {[100, 125, 150, 200, 250, 300].map((thickness) => (
                      <option value={thickness} key={thickness}>{thickness} mm</option>
                    ))}
                  </select>
                </label>
              )}
              {['wall', 'door', 'window'].includes(architecturalTool) && !pendingArchitectPoint && (
                <p className="architect-tool-hint">Drag once to draw; the tool returns to Select when you release.</p>
              )}
              {architecturalTool === 'select' && (architecturalSegments.length > 0 || roomLabels.length > 0) && (
                <p className="architect-tool-hint">Drag a wall, opening, or label to reposition it.</p>
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
          {armedItemId && <p className="hint">Click a floor cell or drag this item onto the floor. Places once.</p>}
        </aside>

        <main
          className="canvas-wrap"
          ref={canvasWrapRef}
          onPointerDown={beginOutsideArchitectureDrag}
          onClick={(event) => {
            if (event.target.closest?.('.workspace-controls, .workspace-item-controls')) return;
            if (showFloorExtensions && !event.target.closest?.('.floor-extension-cell')) {
              const svg = event.currentTarget.querySelector('.room-boundary-overlay');
              const point = svg && getArchitecturalPoint(svg, event.clientX, event.clientY);
              const cellKey = point
                ? `${Math.floor(point.x)},${Math.floor(point.y)}`
                : null;
              if (!cellKey || !floorCellSet.has(cellKey)) {
                setShowFloorExtensions(false);
              }
            }
            if (!event.target.closest?.('.iso-grid')) {
              setSelectedArchitecturalElement(null);
              setSelectedKey(null);
            }
            if (!armedItemId || event.target.closest?.('.iso-grid')) return;
            const svg = event.currentTarget.querySelector('.room-boundary-overlay');
            const point = getArchitecturalPoint(svg, event.clientX, event.clientY);
            if (!point) {
              setStatus('Could not determine the nearest room floor position.');
              return;
            }
            placeArmedItemAtNearestFloor(point);
          }}
        >
          <div className="print-room-title" aria-hidden="true">
            <p className="eyebrow">SwiftSpace / Room design</p>
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
            <span className="workspace-control-separator" aria-hidden="true" />
            <button
              className={`workspace-extension-toggle${showFloorExtensions ? ' active' : ''}`}
              type="button"
              aria-pressed={showFloorExtensions}
              onClick={() => setShowFloorExtensions((visible) => !visible)}
              title={showFloorExtensions ? 'Hide floor extension points' : 'Show floor extension points'}
            >
              Add extension
            </button>
          </div>
          {selectedItem && (
            <div className="workspace-item-controls" aria-label="Selected furniture actions">
              <button
                className="workspace-item-action"
                type="button"
                onClick={() => rotatePlacedItem(selectedItem)}
                title="Rotate selected furniture 90 degrees clockwise"
                aria-label="Rotate selected furniture 90 degrees clockwise"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M13 5V1m0 4H9M13 5a6 6 0 1 0 1 5" />
                </svg>
                <span>Rotate</span>
              </button>
              <button
                className="workspace-item-action danger"
                type="button"
                onClick={() => removeItem(selectedItem)}
                title="Remove selected furniture"
                aria-label="Remove selected furniture"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M2.5 4h11M6 4V2.5h4V4m2.5 0-.6 10h-7.8L3.5 4m2.5 2.5v5m3-5v5" />
                </svg>
                <span>Remove</span>
              </button>
            </div>
          )}
          {selectedArchitecturalElement && (
            <div className="workspace-item-controls" aria-label="Selected architecture actions">
              <button
                className="workspace-item-action danger"
                type="button"
                onClick={() => removeArchitecturalElement(
                  selectedArchitecturalElement.kind,
                  selectedArchitecturalElement.id
                )}
                title="Remove selected plan element"
                aria-label="Remove selected plan element"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M2.5 4h11M6 4V2.5h4V4m2.5 0-.6 10h-7.8L3.5 4m2.5 2.5v5m3-5v5" />
                </svg>
                <span>Remove</span>
              </button>
            </div>
          )}
          {hoverError && <div className="placement-warning">{hoverError}</div>}
          <div className="workspace-zoom" style={{ transform: `scale(${zoom * fitZoom}) rotate(${platformRotation}deg)` }}>
            <div
              className={`iso-grid${isDesigner ? ' architectural-grid' : ''}${showFloorExtensions ? ' floor-extensions-visible' : ' floor-extensions-hidden'}`}
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
                '--workspace-color': workspaceColor,
                '--grid-background-color': showFloorExtensions ? gridColor : workspaceColor,
                '--platform-rotation': `${platformRotation}deg`,
                '--grid-cell-gap': showFloorExtensions ? '1px' : '0px',
                '--grid-track-size': showFloorExtensions ? '42px' : '43px',
              }}
            >
              {cells.map(({ x, y, isFloor, canExtend }) => {
                const key = `${x},${y}`;
                const placed = itemsByCell.get(key);
                const isSelected = selectedKey === key;
                const isPreviewCell = previewCellSet.has(key);
                const previewClass = isPreviewCell
                  ? previewItem?.canPlace ? 'preview-valid' : 'preview-invalid'
                  : '';
                if (!isFloor && (!canExtend || !showFloorExtensions)) {
                  return (
                    <div
                      key={key}
                      className="grid-cell void-cell"
                      data-grid-x={x}
                      data-grid-y={y}
                      onClick={() => {
                        if (armedItemId) placeArmedItemAtNearestFloor({ x: x + 0.5, y: y + 0.5 });
                      }}
                      aria-hidden="true"
                    />
                  );
                }
                if (!isFloor) {
                  return (
                    <button
                      key={key}
                      type="button"
                      className="grid-cell floor-extension-cell"
                      style={{ gridColumn: x + 1, gridRow: y + 1 }}
                      onPointerDown={(event) => beginFloorExtensionDrag(event, x, y)}
                      onPointerEnter={() => continueFloorExtensionDrag(x, y)}
                      onClick={(event) => activateFloorExtensionByKeyboard(event, x, y)}
                      aria-label={`Extend room at ${x}, ${y}`}
                      title="Add one floor cell"
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={key}
                    className={`grid-cell ${placed ? 'occupied' : ''} ${isSelected && !placed ? 'selected' : ''} ${previewClass}`.trim()}
                    style={{ gridColumn: x + 1, gridRow: y + 1 }}
                    data-grid-x={x}
                    data-grid-y={y}
                    onClick={(event) => handleCellClick(x, y, event)}
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
              {showFloorExtensions && outsideExtensions.map(({ x, y }) => (
                <button
                  key={`extend-${x},${y}`}
                  type="button"
                  className="floor-extension-cell outside-extension-cell"
                  style={{ left: `${x * 43 + 1}px`, top: `${y * 43 + 1}px` }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    beginFloorExtensionDrag(event, x, y);
                  }}
                  onPointerEnter={() => continueFloorExtensionDrag(x, y)}
                  onClick={(event) => activateFloorExtensionByKeyboard(event, x, y)}
                  aria-label={`Extend room at ${x}, ${y}`}
                  title="Add one floor cell"
                >
                  <span aria-hidden="true">+</span>
                </button>
              ))}
              <svg
                className="room-boundary-overlay"
                viewBox={`0 0 ${dimensions.width * 43 + 2} ${dimensions.length * 43 + 2}`}
                aria-hidden="true"
              />
              {isDesigner && (
                <svg
                  className={`architectural-overlay${armedItemId ? ' placing-furniture' : ''}`}
                  viewBox={`0 0 ${dimensions.width * 43 + 2} ${dimensions.length * 43 + 2}`}
                  aria-label="Architectural walls, doors, windows, and room labels"
                >
                  {renderArchitecturalSegments.map((segment) => {
                    const displayedSegment = architecturalSegmentDraft?.id === segment.id
                      ? architecturalSegmentDraft.segment
                      : segment;
                    const isSelected = selectedArchitecturalElement?.kind === 'segment'
                      && selectedArchitecturalElement.id === segment.id;
                    const isBeingDragged = architecturalDragRef.current?.mode === 'move'
                      && architecturalDragRef.current.kind === 'segment'
                      && architecturalDragRef.current.id === segment.id;
                    const startX = displayedSegment.startX * 43 + 1;
                    const startY = displayedSegment.startY * 43 + 1;
                    const endX = displayedSegment.endX * 43 + 1;
                    const endY = displayedSegment.endY * 43 + 1;
                    const segmentWallStrokeWidth = Math.max(2.5, Math.min(14, averageCellMm
                      ? ((displayedSegment.thicknessMm || wallThicknessMm) * 43) / averageCellMm
                      : (displayedSegment.thicknessMm || wallThicknessMm) / 35));
                    const segmentLength = Math.hypot(endX - startX, endY - startY);
                    const isHorizontal = startY === endY;
                    const swingX = isHorizontal ? startX : startX + segmentLength;
                    const swingY = isHorizontal ? startY + segmentLength : startY;
                    const swingPath = `M ${endX} ${endY} A ${segmentLength} ${segmentLength} 0 0 1 ${swingX} ${swingY}`;
                    const doorLeaf = `M ${startX} ${startY} L ${swingX} ${swingY}`;
                    const windowOffset = segmentWallStrokeWidth * 0.62;
                    return (
                      <g
                        key={segment.id}
                        data-architecture-kind="segment"
                        data-architecture-id={segment.id}
                        transform={isBeingDragged ? `translate(${architecturalDragDelta.x * 43} ${architecturalDragDelta.y * 43})` : undefined}
                        pointerEvents={architecturalTool === 'select' && !armedItemId ? 'all' : 'none'}
                        style={{ cursor: architecturalTool === 'select' ? 'pointer' : 'default' }}
                        onPointerDown={(event) => beginArchitecturalElementDrag(event, 'segment', segment)}
                        onClick={(event) => {
                          if (architecturalTool !== 'select' || armedItemId) return;
                          event.stopPropagation();
                          setSelectedArchitecturalElement({ kind: 'segment', id: segment.id });
                          setSelectedKey(null);
                          setArmedItemId(null);
                        }}
                      >
                        <line
                          x1={startX}
                          y1={startY}
                          x2={endX}
                          y2={endY}
                          stroke="rgba(0, 0, 0, 0.001)"
                          strokeWidth={Math.max(16, segmentWallStrokeWidth + 8)}
                          pointerEvents={armedItemId ? 'none' : 'stroke'}
                        />
                        {segment.type === 'wall' && (
                          <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={isSelected ? 'var(--accent)' : '#202722'} strokeWidth={segmentWallStrokeWidth} strokeLinecap="square" />
                        )}
                        {segment.type === 'door' && (
                          <>
                            <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={floorColor} strokeWidth={segmentWallStrokeWidth + 2} />
                            <path d={`${swingPath} ${doorLeaf}`} fill="none" stroke={isSelected ? 'var(--accent)' : '#202722'} strokeWidth="1.7" />
                          </>
                        )}
                        {segment.type === 'window' && (
                          <>
                            <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={floorColor} strokeWidth={segmentWallStrokeWidth + 2} />
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
                        {isSelected && (
                          <>
                            <circle
                              cx={startX}
                              cy={startY}
                              r="7"
                              fill={architecturalSegmentDraft?.id === segment.id
                                && !architecturalSegmentDraft.valid ? '#c94b43' : '#fff'}
                              stroke="var(--accent)"
                              strokeWidth="2"
                              style={{ cursor: 'grab', touchAction: 'none' }}
                              role="button"
                              tabIndex={0}
                              aria-label={`Drag to extend or shorten the start of the ${segment.type}`}
                              onPointerDown={(event) => beginArchitecturalEndpointDrag(event, segment, 'start')}
                              onClick={(event) => event.stopPropagation()}
                            ><title>{`Drag to extend or shorten ${segment.type}`}</title></circle>
                            <circle
                              cx={endX}
                              cy={endY}
                              r="7"
                              fill={architecturalSegmentDraft?.id === segment.id
                                && !architecturalSegmentDraft.valid ? '#c94b43' : '#fff'}
                              stroke="var(--accent)"
                              strokeWidth="2"
                              style={{ cursor: 'grab', touchAction: 'none' }}
                              role="button"
                              tabIndex={0}
                              aria-label={`Drag to extend or shorten the end of the ${segment.type}`}
                              onPointerDown={(event) => beginArchitecturalEndpointDrag(event, segment, 'end')}
                              onClick={(event) => event.stopPropagation()}
                            ><title>{`Drag to extend or shorten ${segment.type}`}</title></circle>
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
                    const isBeingDragged = architecturalDragRef.current?.mode === 'move'
                      && architecturalDragRef.current.kind === 'label'
                      && architecturalDragRef.current.id === label.id;
                    return (
                      <g
                        key={label.id}
                        data-architecture-kind="label"
                        data-architecture-id={label.id}
                        transform={`translate(${x + (isBeingDragged ? architecturalDragDelta.x * 43 : 0)} ${y + (isBeingDragged ? architecturalDragDelta.y * 43 : 0)}) rotate(${label.rotation || 0})`}
                        pointerEvents={architecturalTool === 'select' && !armedItemId ? 'all' : 'none'}
                        style={{ cursor: architecturalTool === 'select' ? 'pointer' : 'default' }}
                        onPointerDown={(event) => beginArchitecturalElementDrag(event, 'label', label)}
                        onClick={(event) => {
                          if (architecturalTool !== 'select' || armedItemId) return;
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
                    <circle cx={pendingArchitectPoint.x * 43 + 1} cy={pendingArchitectPoint.y * 43 + 1} r="5" fill="#c2693c" stroke="#fff" strokeWidth="1.5" pointerEvents="none" />
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
                      pointerEvents="none"
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
                    width: `${previewItem.bounds.width * 43 - 1}px`,
                    height: `${previewItem.bounds.length * 43 - 1}px`,
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
                      rotation={previewItem.rotation}
                      footprintWidth={previewItem.size?.width || previewItem.catalogItem.footprint.width}
                      footprintLength={previewItem.size?.length || previewItem.catalogItem.footprint.length}
                      objectPosition={getFurnitureImagePosition(
                        previewItem.gridX,
                        previewItem.gridY,
                        previewItem.bounds
                      )}
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
                const displayItem = {
                  ...item,
                  ...(furnitureMoveDraft?.placementId === item.placementId
                    ? { gridX: furnitureMoveDraft.gridX, gridY: furnitureMoveDraft.gridY }
                    : {}),
                  ...(resizeDraft?.placementId === item.placementId
                    ? {
                      gridX: resizeDraft.gridX,
                      gridY: resizeDraft.gridY,
                      size: { width: resizeDraft.width, length: resizeDraft.length },
                    }
                    : {}),
                };
                const occupiedCells = getOccupiedCells(displayItem, displayRotation);
                const bounds = getFurnitureBounds(displayItem, displayRotation, catalogItem);
                return (
                  <div
                    className={`placed-item ${isSelected ? 'selected' : ''}`}
                    key={item.placementId || `${item.gridX},${item.gridY}-${item.catalogItemId}`}
                    role="button"
                    tabIndex={0}
                    onPointerDown={(event) => beginPlacedFurnitureDrag(event, item)}
                    onPointerMove={updateArchitecturalDrag}
                    onPointerUp={finishArchitecturalDrag}
                    onPointerCancel={cancelArchitecturalDrag}
                    style={{
                      '--item-color': item.customColor || catalogItem.defaultColor,
                      '--item-rotation': `${displayRotation}deg`,
                      left: `${(displayItem.gridX + bounds.minX) * 43 + 1}px`,
                      top: `${(displayItem.gridY + bounds.minY) * 43 + 1}px`,
                      width: `${bounds.width * 43 - 1}px`,
                      height: `${bounds.length * 43 - 1}px`,
                    }}
                    onClick={(event) => {
                      if (armedItemId) {
                        const svg = canvasWrapRef.current?.querySelector('.room-boundary-overlay');
                        const point = getArchitecturalPoint(svg, event.clientX, event.clientY);
                        if (point) {
                          placeArmedItemAtNearestFloor(point);
                        } else {
                          placeCatalogItemAt(armedItemId, Math.floor(displayItem.gridX), Math.floor(displayItem.gridY));
                        }
                        return;
                      }
                      setSelectedKey(`${Math.floor(item.gridX)},${Math.floor(item.gridY)}`);
                      setSelectedArchitecturalElement(null);
                      setArmedItemId(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      const svg = canvasWrapRef.current?.querySelector('.room-boundary-overlay');
                      const point = getArchitecturalPoint(svg, event.clientX, event.clientY);
                      setHoverCell(point
                        ? { x: Math.floor(point.x), y: Math.floor(point.y) }
                        : { x: Math.floor(displayItem.gridX), y: Math.floor(displayItem.gridY) });
                    }}
                    onDrop={(event) => handleCellDrop(
                      event,
                      Math.floor(displayItem.gridX),
                      Math.floor(displayItem.gridY)
                    )}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (armedItemId) {
                          placeCatalogItemAt(
                            armedItemId,
                            Math.floor(displayItem.gridX),
                            Math.floor(displayItem.gridY)
                          );
                          return;
                        }
                        setSelectedKey(`${Math.floor(item.gridX)},${Math.floor(item.gridY)}`);
                        setSelectedArchitecturalElement(null);
                        setArmedItemId(null);
                      }
                    }}
                    aria-label={`${catalogItem.name}, ${displayItem.size?.width || catalogItem.footprint.width} by ${displayItem.size?.length || catalogItem.footprint.length} grid units`}
                  >
                    <span className="placed-item-glyph">
                      <ItemGlyph
                        iconKey={catalogItem.iconKey}
                        color={item.customColor || catalogItem.defaultColor}
                        rotation={displayRotation}
                        footprintWidth={displayItem.size?.width || catalogItem.footprint.width}
                        footprintLength={displayItem.size?.length || catalogItem.footprint.length}
                        objectPosition={getFurnitureImagePosition(
                          displayItem.gridX,
                          displayItem.gridY,
                          bounds
                        )}
                      />
                    </span>
                    {isSelected && (
                      ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
                        .map((handle) => (
                          <span
                            className={`placed-item-resize-handle ${handle}`}
                            key={handle}
                            role="button"
                            tabIndex={0}
                            aria-label={`Resize ${catalogItem.name} from the ${handle.replace('-', ' ')} side`}
                            title={`Drag to resize from the ${handle.replace('-', ' ')} side`}
                            onPointerDown={(event) => beginFurnitureResize(event, item, catalogItem, handle)}
                            onPointerMove={updateFurnitureResize}
                            onPointerUp={finishFurnitureResize}
                            onPointerCancel={cancelFurnitureResize}
                            onKeyDown={(event) => handleFurnitureResizeKeyDown(event, item, catalogItem)}
                          />
                        ))
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </main>

        <aside className="inspector-panel">
          {isDesigner && (
            <details className="designer-inspector-accordion">
              <summary>Project details</summary>
              <div className="designer-project-fields">
                <label className="inspector-field">
                  Client name
                  <input value={clientName} maxLength={120} onChange={(event) => setClientName(event.target.value)} />
                </label>
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
              <form onSubmit={handleSaveVersion}>
                <label className="inspector-field">
                  Version name (optional)
                  <input value={versionName} maxLength={60} onChange={(event) => setVersionName(event.target.value)} placeholder={`Version ${versions.length + 1}`} />
                </label>
                <button className="btn-ghost" type="submit" disabled={versionSaving || saving}>
                  {versionSaving || saving ? 'Saving…' : isNew ? 'Save room & version' : 'Save version'}
                </button>
              </form>
              {versionError && <p className="form-error" role="alert">{versionError}</p>}
              {versionMessage && <p className="form-success" role="status">{versionMessage}</p>}
              {!isNew && (
                <>
               {versionsLoading && <p className="muted small">Loading versions…</p>}
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
          {overlapRecords.length > 0 && (
            <details className="designer-inspector-accordion overlap-records">
              <summary>Placement warnings <span className="overlap-count">{overlapRecords.length}</span></summary>
              <div className="overlap-record-content">
                <div className="overlap-record-list">
                  {overlapRecords.slice().reverse().map((record, index) => {
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
            </details>
          )}

          <details className="designer-inspector-accordion">
            <summary>Floor &amp; grid</summary>
            <div className="floor-options">
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
          </details>

          <details className="designer-inspector-accordion placed-furniture-accordion">
            <summary>Placed furniture <span>{placedItems.length}</span></summary>
            <div className="placed-items-list">
              {!placedItems.length && <p className="muted small">No furniture placed yet.</p>}
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
                      className="btn-ghost placed-item-remove"
                      type="button"
                      onClick={() => rotatePlacedItem(item)}
                      aria-label={`Rotate ${catalogItem.name} 90 degrees`}
                      title="Rotate 90 degrees clockwise"
                    >
                      Rotate
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
          </details>

          {isDesigner && (
            <details className="designer-inspector-accordion placed-architecture-accordion">
              <summary>Architecture <span>{architecturalSegments.length + roomLabels.length}</span></summary>
              <div className="placed-items-list">
              {!architecturalSegments.length && !roomLabels.length && (
                <p className="muted small">No walls, openings, or room labels yet.</p>
              )}
              {architecturalSegments.map((segment) => {
                const isSelected = selectedArchitecturalElement?.kind === 'segment'
                  && selectedArchitecturalElement.id === segment.id;
                const type = `${segment.type[0].toUpperCase()}${segment.type.slice(1)}`;
                return (
                  <div className="placed-item-row" key={`segment-${segment.id}`}>
                    <button
                      className={`placed-item-name ${isSelected ? 'selected' : ''}`}
                      type="button"
                      onClick={() => {
                        setArchitecturalTool('select');
                        setPendingArchitectPoint(null);
                        setSelectedArchitecturalElement({ kind: 'segment', id: segment.id });
                        setSelectedKey(null);
                        setArmedItemId(null);
                      }}
                    >
                      {type}
                      <span className="mono muted small">({segment.startX}, {segment.startY}) to ({segment.endX}, {segment.endY})</span>
                    </button>
                    <button
                      className="btn-ghost danger placed-item-remove"
                      type="button"
                      onClick={() => removeArchitecturalElement('segment', segment.id)}
                      aria-label={`Remove ${type.toLowerCase()}`}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {roomLabels.map((label) => {
                const isSelected = selectedArchitecturalElement?.kind === 'label'
                  && selectedArchitecturalElement.id === label.id;
                return (
                  <div className="placed-item-row" key={`label-${label.id}`}>
                    <button
                      className={`placed-item-name ${isSelected ? 'selected' : ''}`}
                      type="button"
                      onClick={() => {
                        setArchitecturalTool('select');
                        setPendingArchitectPoint(null);
                        setSelectedArchitecturalElement({ kind: 'label', id: label.id });
                        setSelectedKey(null);
                        setArmedItemId(null);
                      }}
                    >
                      {label.text}
                      <span className="mono muted small">Room label · ({label.x}, {label.y}) · {label.rotation || 0}°</span>
                    </button>
                    <button
                      className="btn-ghost placed-item-remove"
                      type="button"
                      onClick={() => rotateArchitecturalElement('label', label.id)}
                      aria-label={`Rotate ${label.text} label 90 degrees`}
                      title="Rotate 90 degrees clockwise"
                    >
                      Rotate
                    </button>
                    <button
                      className="btn-ghost danger placed-item-remove"
                      type="button"
                      onClick={() => removeArchitecturalElement('label', label.id)}
                      aria-label={`Remove ${label.text} label`}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              </div>
            </details>
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
                {Array.from({ length: versionPreview.snapshot.dimensions.width * versionPreview.snapshot.dimensions.length }, (_, index) => {
                  const x = index % versionPreview.snapshot.dimensions.width;
                  const y = Math.floor(index / versionPreview.snapshot.dimensions.width);
                  return (
                    <span
                      className={`version-preview-cell${versionFloorCellSet.has(`${x},${y}`) ? '' : ' void-cell'}`}
                      key={`cell-${index}`}
                      style={{ gridColumn: x + 1, gridRow: y + 1 }}
                    />
                  );
                })}
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
                    const thickness = Math.max(2, Math.min(7, (segment.thicknessMm || versionPreview.snapshot.wallThicknessMm || 150) / 45));
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
                    <text
                      key={label.id}
                      x={label.x * 25 + 1}
                      y={label.y * 25 + 1}
                      transform={`rotate(${label.rotation || 0} ${label.x * 25 + 1} ${label.y * 25 + 1})`}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#28312c"
                      fontSize="5"
                      fontWeight="700"
                    >
                      {label.text}
                    </text>
                  ))}
                </svg>
                {versionPreview.snapshot.placedItems.map((item, index) => {
                  const catalogItem = catalogById.get(item.catalogItemId?.toString());
                  if (!catalogItem) return null;
                  const radians = (item.rotation * Math.PI) / 180;
                  const cosine = Math.abs(Math.cos(radians));
                  const sine = Math.abs(Math.sin(radians));
                  const footprintWidth = item.size?.width || catalogItem.footprint.width;
                  const footprintLength = item.size?.length || catalogItem.footprint.length;
                  const width = Math.max(0.25, footprintWidth * cosine + footprintLength * sine);
                  const length = Math.max(0.25, footprintWidth * sine + footprintLength * cosine);
                  return (
                    <div
                      className="version-preview-item"
                      key={item.placementId || index}
                      title={`${catalogItem.name} · ${item.rotation}°`}
                      style={{
                        gridColumn: `${item.gridX + 1} / span ${Math.ceil(width)}`,
                        gridRow: `${item.gridY + 1} / span ${Math.ceil(length)}`,
                        '--item-color': item.customColor || catalogItem.defaultColor,
                      }}
                    >
                      <ItemGlyph
                        iconKey={catalogItem.iconKey}
                        color={item.customColor || catalogItem.defaultColor}
                        rotation={item.rotation}
                        footprintWidth={footprintWidth}
                        footprintLength={footprintLength}
                      />
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
