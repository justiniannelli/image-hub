import React, { useEffect, useRef, useState } from 'react';
import { api, fileUrl } from './api.js';
import PromptBox from './PromptBox.jsx';
import FolderDialog from './FolderDialog.jsx';
import { BackIcon, FilterIcon, FolderIcon, PaletteIcon, PlusIcon, SearchIcon, StarIcon, ImageIcon } from './icons.jsx';

export default function Home({ projects, styles, config, seed, version, onOpen, onChanged, onSignOut }) {
  const [tab, setTab] = useState('all'); // all | fav
  const [q, setQ] = useState('');
  const [medium, setMedium] = useState('');
  const [sort, setSort] = useState('new');
  const [folderId, setFolderId] = useState(null); // open project folder
  const [items, setItems] = useState([]);
  const [mediumCounts, setMediumCounts] = useState({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { kind: 'new' } | { kind: 'style', style } | { kind: 'project', project }
  const [folderForNew, setFolderForNew] = useState('');
  const filterRef = useRef(null);

  const folder = projects.find((p) => p.id === folderId) || null;

  useEffect(() => {
    if (folderId && !folder) setFolderId(null); // folder was deleted
  }, [folderId, folder]);

  // New images go into the open folder by default.
  useEffect(() => setFolderForNew(folderId ? String(folderId) : ''), [folderId]);

  useEffect(() => {
    const params = new URLSearchParams({ sort });
    if (q) params.set('q', q);
    if (tab === 'fav') params.set('fav', '1');
    if (medium) params.set('medium', medium);
    if (folderId) params.set('project', folderId);
    const t = setTimeout(() => {
      api.get('/api/generations?' + params).then((r) => {
        setItems(r.items);
        setMediumCounts(r.mediumCounts);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [q, tab, medium, sort, folderId, version]);

  useEffect(() => {
    const close = (e) => filterRef.current && !filterRef.current.contains(e.target) && setFilterOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const toggleFav = async (e, g) => {
    e.stopPropagation();
    await api.patch(`/api/generations/${g.id}`, { favorite: !g.favorite });
    setItems((list) => list.map((x) => (x.id === g.id ? { ...x, favorite: !g.favorite } : x)));
  };

  const generate = async (payload) => {
    const g = await api.post('/api/generate', { ...payload, projectId: folderForNew ? Number(folderForNew) : null });
    onChanged();
    onOpen(g.id);
  };

  const showFolders = !folder && !q && !medium && tab === 'all';

  return (
    <div className="home">
      <header className="topbar">
        <div className="titlewrap">
          {folder ? (
            <button className="iconbtn" title="Back to all images" onClick={() => setFolderId(null)}>
              <BackIcon size={20} />
            </button>
          ) : null}
          <h1>{folder ? folder.name : 'Image Hub'}</h1>
          {folder && (
            <button className="linkbtn small" onClick={() => setDialog({ kind: 'project', project: folder })}>
              Rename / delete
            </button>
          )}
        </div>
        <div className="search">
          <SearchIcon />
          <input placeholder="Search prompts, styles and folders" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="filterwrap" ref={filterRef}>
          <button
            className={'iconbtn' + (medium ? ' active' : '')}
            title="Filter by type of image"
            onClick={() => setFilterOpen((o) => !o)}
          >
            <FilterIcon />
          </button>
          {filterOpen && (
            <div className="menu">
              <div className="menu-title">Medium</div>
              <button className={!medium ? 'checked' : ''} onClick={() => setMedium('')}>
                All <span>{Object.values(mediumCounts).reduce((a, b) => a + b, 0)}</span>
              </button>
              {config.mediums.map((m) => (
                <button key={m} className={medium === m ? 'checked' : ''} onClick={() => setMedium(m)}>
                  {m} <span>{mediumCounts[m] || 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="tabs">
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            <ImageIcon size={14} /> All
          </button>
          <button className={tab === 'fav' ? 'on' : ''} onClick={() => setTab('fav')}>
            <StarIcon size={14} /> Fav
          </button>
        </div>
        <button className="linkbtn small signout" onClick={async () => (await api.post('/api/logout'), onSignOut())}>
          Sign out
        </button>
      </header>

      <div className="content">
        {(medium || q) && (
          <div className="activefilters">
            {medium && (
              <button className="pill on" onClick={() => setMedium('')}>
                {medium} ✕
              </button>
            )}
            {q && (
              <button className="pill on" onClick={() => setQ('')}>
                “{q}” ✕
              </button>
            )}
          </div>
        )}

        {showFolders && (
          <section>
            <div className="sectionhead">
              <h2>Folders</h2>
              <button className="btn primary small" onClick={() => setDialog({ kind: 'new' })}>
                <PlusIcon size={14} /> New folder
              </button>
            </div>
            <div className="folders">
              {styles.map((s) => (
                <button key={'s' + s.id} className="folder" onClick={() => setDialog({ kind: 'style', style: s })}>
                  <div className="folder-cover">
                    {s.images[0] ? <img src={fileUrl(s.images[0])} alt="" /> : <div className="empty-cover" />}
                    <span className="folder-badge" title="Style folder">
                      <PaletteIcon size={14} />
                    </span>
                  </div>
                  <div className="folder-name">@{s.name}</div>
                  <div className="folder-count">
                    Style · {s.images.length} image{s.images.length === 1 ? '' : 's'}
                  </div>
                </button>
              ))}
              {projects.map((p) => (
                <button key={'p' + p.id} className="folder" onClick={() => setFolderId(p.id)}>
                  <div className="folder-cover">
                    {p.cover ? <img src={fileUrl(p.cover)} alt="" /> : <div className="empty-cover" />}
                    <span className="folder-badge" title="Project folder">
                      <FolderIcon size={14} />
                    </span>
                  </div>
                  <div className="folder-name">{p.name}</div>
                  <div className="folder-count">
                    {p.count} image{p.count === 1 ? '' : 's'}
                  </div>
                </button>
              ))}
              {styles.length + projects.length === 0 && (
                <p className="muted">
                  No folders yet. Make a <strong>style folder</strong> (like axon or diagrams) to reuse a look, or a{' '}
                  <strong>project folder</strong> to keep a project's images together.
                </p>
              )}
            </div>
          </section>
        )}

        <section>
          <div className="sectionhead">
            <h2>{tab === 'fav' ? 'Favorites' : 'Images'}</h2>
            <select className="pill" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
            </select>
          </div>
          <div className="grid">
            {items.map((g) => (
              <div key={g.id} className="card" onClick={() => onOpen(g.id)} title={g.prompt}>
                <img src={fileUrl(g.output)} alt="" loading="lazy" />
                <div className="card-foot">
                  <span>{g.project_name || g.medium}</span>
                  <button className={'star' + (g.favorite ? ' on' : '')} onClick={(e) => toggleFav(e, g)} title="Favorite">
                    <StarIcon size={14} filled={g.favorite} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {items.length === 0 && (
            <p className="muted emptynote">
              {q || medium || tab === 'fav' ? 'Nothing matches.' : 'No images yet. Describe one in the box below.'}
            </p>
          )}
        </section>
      </div>

      <div className="dock">
        <PromptBox
          config={config}
          styles={styles}
          seed={seed}
          seedTarget="home"
          placeholder="Let's shape some space."
          run={generate}
          extra={
            projects.length > 0 && (
              <div className="savein">
                <span className="muted small">Save in</span>
                <select className="pill" value={folderForNew} onChange={(e) => setFolderForNew(e.target.value)}>
                  <option value="">No folder</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )
          }
        />
      </div>

      {dialog && (
        <FolderDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onChanged={(openProjectId) => {
            onChanged();
            if (openProjectId) setFolderId(openProjectId);
          }}
        />
      )}
    </div>
  );
}
