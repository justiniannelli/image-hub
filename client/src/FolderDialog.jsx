import React, { useState } from 'react';
import { api, fileUrl, readAsDataUrl } from './api.js';
import { CloseIcon, FolderIcon, PaletteIcon, PlusIcon } from './icons.jsx';

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={onClose} title="Close">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ImagePicker({ images, onAdd, onRemove, max = 12 }) {
  return (
    <div className="picker">
      {images.map((src, i) => (
        <span key={src + i} className="thumb big">
          <img src={src} alt="" />
          <button title="Remove" onClick={() => onRemove(i)}>
            <CloseIcon size={10} />
          </button>
        </span>
      ))}
      {images.length < max && (
        <label className="thumb big addthumb" title="Add images">
          <PlusIcon />
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => onAdd(await Promise.all([...e.target.files].map(readAsDataUrl)))}
          />
        </label>
      )}
    </div>
  );
}

// New folder: choose style or project.
function NewFolder({ onClose, onChanged }) {
  const [kind, setKind] = useState('style');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (kind === 'project') {
        const p = await api.post('/api/projects', { name });
        onChanged(p.id);
      } else {
        await api.post('/api/styles', { name: name.replace(/^@/, ''), description, images });
        onChanged();
      }
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New folder" onClose={onClose}>
      <div className="kindpick">
        <button className={kind === 'style' ? 'on' : ''} onClick={() => setKind('style')}>
          <PaletteIcon size={20} />
          <strong>Style folder</strong>
          <span>A look you can reuse by typing @name in a prompt (e.g. axon, diagrams).</span>
        </button>
        <button className={kind === 'project' ? 'on' : ''} onClick={() => setKind('project')}>
          <FolderIcon size={20} />
          <strong>Project folder</strong>
          <span>Keeps every image and prompt for one project together.</span>
        </button>
      </div>
      <label className="field">
        Name
        <input
          value={name}
          autoFocus
          placeholder={kind === 'style' ? 'axon' : 'Studio project'}
          onChange={(e) => setName(e.target.value)}
        />
        {kind === 'style' && <span className="muted small">One word: letters, numbers, - or _.</span>}
      </label>
      {kind === 'style' && (
        <>
          <label className="field">
            Describe the look
            <textarea
              rows={3}
              value={description}
              placeholder="Colorful axonometric, flat pastel fills, thin black linework, white background…"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="field">
            Example images
            <ImagePicker
              images={images}
              onAdd={(urls) => setImages((cur) => [...cur, ...urls].slice(0, 12))}
              onRemove={(i) => setImages((cur) => cur.filter((_, j) => j !== i))}
            />
          </div>
        </>
      )}
      {error && <p className="error small">{error}</p>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={save}>
          Create
        </button>
      </div>
    </Modal>
  );
}

// Open a style folder: see and edit its images and description.
function StyleFolder({ style, onClose, onChanged }) {
  const [description, setDescription] = useState(style.description);
  const [images, setImages] = useState(style.images); // file names
  const [error, setError] = useState('');

  const patch = async (body) => {
    setError('');
    try {
      const s = await api.patch(`/api/styles/${style.id}`, body);
      setImages(s.images);
      setDescription(s.description);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal title={'@' + style.name} onClose={onClose}>
      <p className="muted small">
        Type <strong>@{style.name}</strong> in any prompt. The description below is added to the prompt and up to 3 of
        these images are sent as style examples.
      </p>
      <label className="field">
        Describe the look
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== style.description && patch({ description })}
        />
      </label>
      <div className="field">
        Example images
        <ImagePicker
          images={images.map(fileUrl)}
          onAdd={(urls) => patch({ addImages: urls })}
          onRemove={(i) => patch({ removeImages: [images[i]] })}
        />
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="modal-foot">
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm(`Delete the @${style.name} style folder? Images you made with it are kept.`)) return;
            await api.del(`/api/styles/${style.id}`);
            onChanged();
            onClose();
          }}
        >
          Delete style
        </button>
        <span className="spacer" />
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function ProjectFolder({ project, onClose, onChanged }) {
  const [name, setName] = useState(project.name);
  const [error, setError] = useState('');
  return (
    <Modal title="Project folder" onClose={onClose}>
      <label className="field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error && <p className="error small">{error}</p>}
      <div className="modal-foot">
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm(`Delete the "${project.name}" folder? Its images are kept and move to All.`)) return;
            await api.del(`/api/projects/${project.id}`);
            onChanged();
            onClose();
          }}
        >
          Delete folder
        </button>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              await api.patch(`/api/projects/${project.id}`, { name });
              onChanged();
              onClose();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

export default function FolderDialog({ dialog, onClose, onChanged }) {
  if (dialog.kind === 'style') return <StyleFolder style={dialog.style} onClose={onClose} onChanged={onChanged} />;
  if (dialog.kind === 'project') return <ProjectFolder project={dialog.project} onClose={onClose} onChanged={onChanged} />;
  return <NewFolder onClose={onClose} onChanged={onChanged} />;
}
