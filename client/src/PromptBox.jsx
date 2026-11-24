import React, { useEffect, useRef, useState } from 'react';
import { fileUrl, readAsDataUrl } from './api.js';
import { PlusIcon, SendIcon, SparkIcon, CloseIcon } from './icons.jsx';

const ASPECTS = ['auto', '1:1', '16:9', '4:3', '3:4', '9:16'];
const PROVIDER_NAMES = { gemini: 'Gemini', openai: 'OpenAI' };

function loadPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

/**
 * The prompt box used on the home screen (floating at the bottom) and in the viewer (edit / remix).
 * run({ prompt, provider, aspect, autoImprove, refImages }) does the generating and returns a promise.
 */
export default function PromptBox({
  config,
  styles,
  run,
  placeholder,
  initialText = '',
  seed,
  seedTarget,
  extra,
  dark = false,
  autoFocus = false,
  onCancel,
}) {
  const providers = ['gemini', 'openai'].filter((p) => config[p]?.enabled);
  const [prompt, setPrompt] = useState(initialText);
  const [provider, setProvider] = useState(() => {
    const saved = loadPref('hub-provider', '');
    return providers.includes(saved) ? saved : providers[0] || '';
  });
  const [aspect, setAspect] = useState('auto');
  const [autoImprove, setAutoImprove] = useState(() => loadPref('hub-auto-improve', '0') === '1');
  const [refs, setRefs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(autoFocus);
  const lastSeed = useRef(seed?.nonce ?? 0);
  const fileInput = useRef(null);
  const textarea = useRef(null);

  // Text sent from the prompt assistant.
  useEffect(() => {
    if (seed && seed.nonce !== lastSeed.current && seed.target === seedTarget) {
      lastSeed.current = seed.nonce;
      setPrompt(seed.text);
      setFocused(true);
      textarea.current?.focus();
    }
  }, [seed, seedTarget]);

  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);

  const addFiles = async (files) => {
    const urls = await Promise.all([...files].filter((f) => f.type.startsWith('image/')).map(readAsDataUrl));
    setRefs((r) => [...r, ...urls].slice(0, 6));
    setFocused(true);
  };

  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await run({ prompt, provider, aspect, autoImprove, refImages: refs });
      setPrompt('');
      setRefs([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!providers.length) {
    return (
      <div className={'promptbox' + (dark ? ' dark' : '')}>
        <p className="muted small">
          No AI is connected yet. Add your GEMINI_API_KEY to the .env file and restart the app.
        </p>
      </div>
    );
  }

  const expanded = focused || prompt || refs.length;

  return (
    <div
      className={'promptbox' + (dark ? ' dark' : '') + (expanded ? ' expanded' : '')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      {extra}
      {refs.length > 0 && (
        <div className="refs">
          {refs.map((r, i) => (
            <span key={i} className="thumb">
              <img src={r} alt="" />
              <button title="Remove" onClick={() => setRefs(refs.filter((_, j) => j !== i))}>
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={textarea}
        rows={expanded ? 3 : 1}
        value={prompt}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {expanded && styles.length > 0 && (
        <div className="stylechips">
          <span className="muted small">Styles:</span>
          {styles.map((s) => (
            <button
              key={s.id}
              className="stylechip"
              title={s.description || 'Add this style to the prompt'}
              onClick={() => setPrompt((p) => (p.trim() ? p.trimEnd() + ' ' : '') + '@' + s.name + ' ')}
            >
              {s.images[0] && <img src={fileUrl(s.images[0])} alt="" />}@{s.name}
            </button>
          ))}
        </div>
      )}
      <div className="pb-row">
        <button className="iconbtn" title="Attach reference images" onClick={() => fileInput.current?.click()}>
          <PlusIcon />
        </button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <button
          className={'pill' + (autoImprove ? ' on' : '')}
          title="Have the AI add detail to your prompt before generating"
          onClick={() => {
            setAutoImprove(!autoImprove);
            savePref('hub-auto-improve', !autoImprove ? '1' : '0');
          }}
        >
          <SparkIcon size={13} /> Auto-improve
        </button>
        <select
          className="pill"
          value={provider}
          title="Which AI makes the image"
          onChange={(e) => {
            setProvider(e.target.value);
            savePref('hub-provider', e.target.value);
          }}
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_NAMES[p]} · {config[p].model}
            </option>
          ))}
        </select>
        <select className="pill" value={aspect} title="Image shape" onChange={(e) => setAspect(e.target.value)}>
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a === 'auto' ? 'Shape: auto' : a}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {onCancel && (
          <button className="pill" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button className="sendbtn" title="Generate (Enter)" disabled={busy || !prompt.trim()} onClick={submit}>
          {busy ? <span className="spinner" /> : <SendIcon />}
        </button>
      </div>
      {busy && <p className="muted small">Generating… this can take up to a minute.</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
