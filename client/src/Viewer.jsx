import React, { useEffect, useRef, useState } from 'react';
import { api, fileUrl } from './api.js';
import PromptBox from './PromptBox.jsx';
import { CloseIcon, CopyIcon, DownloadIcon, PencilIcon, RemixIcon, StarIcon, TrashIcon } from './icons.jsx';

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copybtn"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <CopyIcon size={14} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function PromptPanel({ g, projects, mediums, onClose, onPatch }) {
  return (
    <div className="promptpanel">
      <button className="iconbtn panelclose" onClick={onClose} title="Close">
        <CloseIcon />
      </button>
      <div className="pp-head">
        <span>Your prompt</span>
        <CopyButton text={g.prompt} />
      </div>
      <p className="pp-text">{g.prompt}</p>

      {g.full_prompt !== g.prompt && (
        <>
          <div className="pp-head">
            <span>Prompt used{g.improved ? ' (auto-improved)' : ''}</span>
            <CopyButton text={g.full_prompt} />
          </div>
          <p className="pp-text">{g.full_prompt}</p>
        </>
      )}

      {g.refs.length > 0 && (
        <>
          <div className="pp-head">
            <span>Reference images</span>
          </div>
          <div className="refs">
            {g.refs.map((r) => (
              <a key={r} className="thumb" href={fileUrl(r)} target="_blank" rel="noreferrer">
                <img src={fileUrl(r)} alt="" />
              </a>
            ))}
          </div>
        </>
      )}

      <div className="pp-grid">
        <label>
          Medium
          <select value={g.medium} onChange={(e) => onPatch({ medium: e.target.value })}>
            {mediums.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Folder
          <select value={g.project_id || ''} onChange={(e) => onPatch({ projectId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No folder</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          Shape<span>{g.aspect}</span>
        </div>
        <div>
          Styles<span>{g.styles.length ? g.styles.map((s) => '@' + s).join(', ') : 'None'}</span>
        </div>
      </div>
    </div>
  );
}

export default function Viewer({ id, projects, styles, config, seed, onOpen, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(false);
  const [mode, setMode] = useState(null); // null | 'edit' | 'remix'

  useEffect(() => {
    let live = true;
    setError('');
    api
      .get(`/api/generations/${id}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id]);

  // The assistant's "Use as prompt" opens the edit box here with that text.
  // (If the edit box is already open, it picks the text up itself.)
  const seenSeed = useRef(seed?.nonce ?? 0);
  const [pendingText, setPendingText] = useState(null);
  useEffect(() => {
    if (seed?.target === 'viewer' && seed.nonce !== seenSeed.current) {
      seenSeed.current = seed.nonce;
      if (!mode) {
        setPendingText(seed.text);
        setMode('edit');
      }
    }
  }, [seed, mode]);
  useEffect(() => {
    if (!mode) setPendingText(null);
  }, [mode]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (mode) setMode(null);
      else if (panel) setPanel(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, panel, onClose]);

  const g = data?.generation;
  const versions = data?.versions || [];

  const patch = async (body) => {
    const updated = await api.patch(`/api/generations/${g.id}`, body);
    setData((d) => ({ ...d, generation: updated }));
    onChanged();
  };

  const remove = async () => {
    if (!confirm('Delete this image and its prompt? This cannot be undone.')) return;
    await api.del(`/api/generations/${g.id}`);
    onChanged();
    // Stay in the viewer on another version if there is one.
    const other = versions.find((v) => v.id !== g.id);
    if (other) onOpen(other.id);
    else onClose();
  };

  const generate = async (payload) => {
    const created = await api.post('/api/generate', { ...payload, parentId: g.id, remix: mode === 'remix' });
    setMode(null);
    onChanged();
    onOpen(created.id);
  };

  return (
    <div className="viewer">
      <div className="v-top">
        <div />
        <div className="v-title">
          {g && (
            <>
              <strong>{g.model}</strong>
              <span>
                {new Date(g.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, {
                  month: 'short',
                  day: '2-digit',
                  year: 'numeric',
                })}
                {g.project_name ? ` · ${g.project_name}` : ''}
              </span>
            </>
          )}
        </div>
        <div className="v-actions">
          {g && (
            <>
              <button className={'iconbtn' + (g.favorite ? ' fav' : '')} title="Favorite" onClick={() => patch({ favorite: !g.favorite })}>
                <StarIcon filled={g.favorite} />
              </button>
              <a className="iconbtn" title="Download" href={fileUrl(g.output)} download={`image-${g.id}.png`}>
                <DownloadIcon />
              </a>
              <button className="iconbtn" title="Delete" onClick={remove}>
                <TrashIcon />
              </button>
            </>
          )}
          <button className="iconbtn" title="Close (Esc)" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>

      {error && <p className="error center">{error}</p>}

      {g && (
        <div className="v-body">
          {versions.length > 1 && (
            <div className="versions">
              {versions.map((v, i) => (
                <button key={v.id} className={v.id === g.id ? 'on' : ''} onClick={() => onOpen(v.id)} title={v.prompt}>
                  <img src={fileUrl(v.output)} alt="" />
                  <span>v{i + 1}</span>
                </button>
              ))}
            </div>
          )}
          <div className="v-stage">
            <img src={fileUrl(g.output)} alt={g.prompt} />
            {panel && (
              <PromptPanel g={g} projects={projects} mediums={config.mediums} onClose={() => setPanel(false)} onPatch={patch} />
            )}
          </div>
        </div>
      )}

      {g && (
        <div className="v-bottom">
          {mode ? (
            <div className="v-editor">
              <p className="small v-mode">
                {mode === 'edit'
                  ? 'Edit the prompt to make a new version. It starts again from the same reference images, so quality does not drift.'
                  : 'Remix: describe the change. This image is sent along as the starting point.'}
              </p>
              <PromptBox
                key={mode + g.id}
                dark
                autoFocus
                config={config}
                styles={styles}
                seed={seed}
                seedTarget="viewer"
                initialText={mode === 'edit' ? pendingText ?? g.prompt : ''}
                placeholder={mode === 'edit' ? 'Change the prompt…' : 'e.g. change the bench upholstery to #2F5D8A, change nothing else'}
                run={generate}
                onCancel={() => setMode(null)}
              />
            </div>
          ) : (
            <>
              <button className="v-prompt" onClick={() => setPanel((p) => !p)} title="Show the full prompt">
                {g.prompt}
              </button>
              <div className="v-buttons">
                <button onClick={() => setMode('edit')}>
                  <PencilIcon />
                  Edit Prompt
                </button>
                <button onClick={() => setMode('remix')}>
                  <RemixIcon />
                  Remix
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
