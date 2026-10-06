import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function Dashboard() {
  const [rooms, setRooms] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState('all');
  const [folderMode, setFolderMode] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderSubmitting, setFolderSubmitting] = useState(false);
  const [folderPendingDeletion, setFolderPendingDeletion] = useState(null);
  const [movingRoomId, setMovingRoomId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingRoomId, setDeletingRoomId] = useState(null);
  const [roomPendingDeletion, setRoomPendingDeletion] = useState(null);
  const [duplicatingRoomId, setDuplicatingRoomId] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareRevoking, setShareRevoking] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const { user, isAdmin, logout } = useAuth();
  const isDesigner = user?.role === 'interior-designer' || user?.role === 'admin';
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const requests = [api.get('/rooms'), isDesigner ? api.get('/rooms/folders') : Promise.resolve({ data: [] })];
    Promise.all(requests)
      .then(([roomsResponse, foldersResponse]) => {
        if (cancelled) return;
        setRooms(roomsResponse.data);
        setFolders(foldersResponse.data);
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
  }, [isDesigner]);

  const visibleRooms = rooms.filter((room) => {
    if (!isDesigner || activeFolderId === 'all') return true;
    if (activeFolderId === 'unfiled') return !room.folderId;
    return String(room.folderId) === activeFolderId;
  });
  const selectedFolder = folders.find(({ _id }) => _id === activeFolderId);

  function startFolderCreate() {
    setFolderName('');
    setFolderMode('create');
  }

  function startFolderRename() {
    if (!selectedFolder) return;
    setFolderName(selectedFolder.name);
    setFolderMode('rename');
  }

  async function saveFolder(event) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    setFolderSubmitting(true);
    setError('');
    try {
      if (folderMode === 'rename' && selectedFolder) {
        const { data } = await api.patch(`/rooms/folders/${selectedFolder._id}`, { name });
        setFolders((current) => current.map((folder) => folder._id === data._id ? data : folder));
      } else {
        const { data } = await api.post('/rooms/folders', { name });
        setFolders((current) => [...current, data].sort((left, right) => left.name.localeCompare(right.name)));
        setActiveFolderId(data._id);
      }
      setFolderMode('');
      setFolderName('');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save the folder.');
    } finally {
      setFolderSubmitting(false);
    }
  }

  async function moveRoom(room, folderId) {
    setMovingRoomId(room._id);
    setError('');
    try {
      const { data } = await api.patch(`/rooms/${room._id}/folder`, { folderId: folderId || null });
      setRooms((current) => current.map((item) => item._id === room._id ? { ...item, folderId: data.folderId } : item));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not move this project.');
    } finally {
      setMovingRoomId(null);
    }
  }

  async function confirmDeleteFolder() {
    if (!folderPendingDeletion) return;
    setFolderSubmitting(true);
    setError('');
    try {
      await api.delete(`/rooms/folders/${folderPendingDeletion._id}`);
      setFolders((current) => current.filter(({ _id }) => _id !== folderPendingDeletion._id));
      setRooms((current) => current.map((room) => String(room.folderId) === folderPendingDeletion._id ? { ...room, folderId: null } : room));
      setActiveFolderId('unfiled');
      setFolderPendingDeletion(null);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete this folder.');
    } finally {
      setFolderSubmitting(false);
    }
  }

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

  async function duplicateProject(room) {
    setDuplicatingRoomId(room._id);
    setError('');
    try {
      const { data } = await api.post(`/rooms/${room._id}/duplicate`);
      setRooms((current) => [data, ...current]);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not duplicate this project.');
    } finally {
      setDuplicatingRoomId(null);
    }
  }

  async function openShare(room) {
    setShareTarget(room);
    setShareUrl('');
    setShareError('');
    setShareMessage('');
    setShareCopied(false);
    setShareLoading(true);
    try {
      const { data } = await api.post(`/rooms/${room._id}/share`);
      setShareUrl(`${window.location.origin}/share/${data.token}`);
    } catch (requestError) {
      setShareError(requestError.response?.data?.message || 'Could not create a share link.');
    } finally {
      setShareLoading(false);
    }
  }

  async function revokeShare() {
    if (!shareTarget) return;
    setShareRevoking(true);
    setShareError('');
    setShareMessage('');
    try {
      await api.delete(`/rooms/${shareTarget._id}/share`);
      setShareUrl('');
      setShareMessage('This share link has been revoked.');
    } catch (requestError) {
      setShareError(requestError.response?.data?.message || 'Could not revoke the share link.');
    } finally {
      setShareRevoking(false);
    }
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setShareMessage('Link copied to clipboard.');
    } catch {
      setShareError('Could not copy the link. Select and copy it manually.');
    }
  }

  return (
    <div className="page dashboard-page">
      <aside className="admin-hover-sidebar" aria-label="Workspace navigation">
        <div className="admin-sidebar-brand">
          <span className="admin-brand-mark">+</span>
          <span className="admin-sidebar-label">Studio Grid</span>
        </div>
        <nav className="admin-sidebar-nav">
          <a href="#dashboard-overview"><span className="admin-nav-icon">⌂</span><span className="admin-sidebar-label">{isDesigner ? 'Projects' : 'My layouts'}</span></a>
          <Link to="/room/new"><span className="admin-nav-icon">+</span><span className="admin-sidebar-label">{isDesigner ? 'New project' : 'New room'}</span></Link>
          {!isAdmin && <Link to="/account"><span className="admin-nav-icon">◎</span><span className="admin-sidebar-label">Manage account</span></Link>}
        </nav>
      </aside>
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
        <div className="dashboard-heading" id="dashboard-overview">
          <div>
            <p className="eyebrow">{isDesigner ? 'Client work' : 'Workspace'}</p>
            <h1>{isDesigner ? 'My projects' : 'Your layouts'}</h1>
          </div>
          <p className="dashboard-subtitle">{isDesigner ? 'Projects, client details, and room layouts in one place.' : 'Saved rooms and new ideas, all in one place.'}</p>
        </div>
        <Link to="/room/new" className="new-room-card">
          <span className="new-room-icon">+</span>
          <span className="new-room-title">{isDesigner ? 'New project' : 'New room'}</span>
          <span className="new-room-copy">{isDesigner ? 'Start a client design project' : 'Start with a fresh floor plan'}</span>
        </Link>

        {isDesigner && (
          <section className="project-folders" aria-label="Project folders">
            <div className="project-folder-heading">
              <div>
                <p className="eyebrow">Project library</p>
                <h2>Folders</h2>
              </div>
              <button className="btn-ghost" type="button" onClick={startFolderCreate}>+ New folder</button>
            </div>
            {folderMode && (
              <form className="project-folder-form" onSubmit={saveFolder}>
                <label htmlFor="project-folder-name">{folderMode === 'rename' ? 'Rename folder' : 'Folder name'}</label>
                <input
                  id="project-folder-name"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  maxLength={40}
                  autoFocus
                  required
                />
                <button className="btn-primary" type="submit" disabled={folderSubmitting}>{folderSubmitting ? 'Saving…' : 'Save folder'}</button>
                <button className="btn-ghost" type="button" onClick={() => setFolderMode('')} disabled={folderSubmitting}>Cancel</button>
              </form>
            )}
            <div className="project-folder-tabs" role="tablist" aria-label="Filter projects by folder">
              <button type="button" role="tab" aria-selected={activeFolderId === 'all'} onClick={() => setActiveFolderId('all')}>
                All projects <span>{rooms.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={activeFolderId === 'unfiled'} onClick={() => setActiveFolderId('unfiled')}>
                Unfiled <span>{rooms.filter((room) => !room.folderId).length}</span>
              </button>
              {folders.map((folder) => (
                <button key={folder._id} type="button" role="tab" aria-selected={activeFolderId === folder._id} onClick={() => setActiveFolderId(folder._id)}>
                  {folder.name} <span>{rooms.filter((room) => String(room.folderId) === folder._id).length}</span>
                </button>
              ))}
            </div>
            {selectedFolder && (
              <div className="project-folder-manage">
                <span>Viewing <strong>{selectedFolder.name}</strong></span>
                <button className="btn-ghost" type="button" onClick={startFolderRename}>Rename</button>
                <button className="btn-ghost danger" type="button" onClick={() => setFolderPendingDeletion(selectedFolder)}>Delete folder</button>
              </div>
            )}
          </section>
        )}

        {loading && <p className="muted">Loading rooms…</p>}
        {error && <p className="form-error">{error}</p>}

        {!loading && !error && visibleRooms.length === 0 && (
          <p className="muted">{isDesigner ? 'No projects yet. Start one to organize a client design.' : 'No rooms yet — start one and it will show up here.'}</p>
        )}

        {!loading && !error && isDesigner && rooms.length > 0 && visibleRooms.length === 0 && (
          <p className="muted">No projects in this folder yet.</p>
        )}

        {visibleRooms.map((room) => (
          <article className="room-card" key={room._id}>
            <Link to={`/room/${room._id}`} className="room-preview" aria-label={`Open ${isDesigner ? 'project' : 'room'} ${room.roomName}`}>
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
              {isDesigner && room.clientName && <p className="room-meta">Client: {room.clientName}</p>}
              {isDesigner && (room.measurements?.width || room.measurements?.length) && (
                <p className="room-meta mono">Measured {room.measurements.width || '—'} × {room.measurements.length || '—'} {room.measurements.unit}</p>
              )}
              <p className="room-meta">Updated {new Date(room.updatedAt).toLocaleDateString()}</p>
            </Link>
            <div className="room-card-actions">
              {isDesigner && (
                <button className="btn-ghost" type="button" onClick={() => duplicateProject(room)} disabled={duplicatingRoomId === room._id}>
                  {duplicatingRoomId === room._id ? 'Duplicating…' : 'Duplicate layout'}
                </button>
              )}
              <button className="btn-ghost" type="button" onClick={() => openShare(room)}>
                {isDesigner ? 'Share with client' : 'Share layout'}
              </button>
              {isDesigner && (
                <label className="project-folder-move">
                  <span>{movingRoomId === room._id ? 'Moving…' : 'Folder'}</span>
                  <select
                    aria-label={`Move ${room.roomName} to a folder`}
                    value={room.folderId || ''}
                    onChange={(event) => moveRoom(room, event.target.value)}
                    disabled={movingRoomId === room._id}
                  >
                    <option value="">Unfiled</option>
                    {folders.map((folder) => <option key={folder._id} value={folder._id}>{folder.name}</option>)}
                  </select>
                </label>
              )}
            </div>
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

      {folderPendingDeletion && (
        <div className="delete-dialog-backdrop" role="presentation">
          <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-folder-title">
            <div className="delete-dialog-icon" aria-hidden="true">×</div>
            <p className="eyebrow">Remove folder</p>
            <h2 id="delete-folder-title">Delete {folderPendingDeletion.name}?</h2>
            <p className="muted">Projects in this folder will move to Unfiled. They will not be deleted.</p>
            <div className="delete-dialog-actions">
              <button className="btn-ghost" type="button" onClick={() => setFolderPendingDeletion(null)} disabled={folderSubmitting}>Keep folder</button>
              <button className="btn-danger" type="button" onClick={confirmDeleteFolder} disabled={folderSubmitting}>{folderSubmitting ? 'Deleting…' : 'Delete folder'}</button>
            </div>
          </section>
        </div>
      )}

      {shareTarget && (
        <div className="delete-dialog-backdrop" role="presentation">
          <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
            <p className="eyebrow">Read-only link</p>
            <h2 id="share-dialog-title">Share {shareTarget.roomName}</h2>
            <p className="muted">Anyone with this link can view the current room layout. You can revoke it at any time.</p>
            {shareLoading && <p className="muted">Preparing share link…</p>}
            {shareError && <p className="form-error" role="alert">{shareError}</p>}
            {shareMessage && <p className="form-success" role="status">{shareMessage}</p>}
            {shareUrl && (
              <div className="share-link-control">
                <input aria-label="Read-only share link" readOnly value={shareUrl} onFocus={(event) => event.target.select()} />
                <button className="btn-primary" type="button" onClick={copyShareLink}>{shareCopied ? 'Copied' : 'Copy link'}</button>
              </div>
            )}
            <div className="delete-dialog-actions">
              {shareUrl && <button className="btn-ghost danger" type="button" onClick={revokeShare} disabled={shareRevoking}>{shareRevoking ? 'Revoking…' : 'Revoke link'}</button>}
              <button className="btn-ghost" type="button" onClick={() => setShareTarget(null)} disabled={shareLoading || shareRevoking}>Close</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
