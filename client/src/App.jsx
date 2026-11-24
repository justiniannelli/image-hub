import React, { useCallback, useEffect, useState } from 'react';
import { api, setUnauthHandler } from './api.js';
import Home from './Home.jsx';
import Viewer from './Viewer.jsx';
import Assistant from './Assistant.jsx';
import { SparkIcon, CloseIcon } from './icons.jsx';

function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/login', { password });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="login" onSubmit={submit}>
      <h1>Image Hub</h1>
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      <button className="btn primary">Sign in</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [projects, setProjects] = useState([]);
  const [styles, setStyles] = useState([]);
  const [config, setConfig] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  // Text sent from the assistant's "Use as prompt"; the prompt box in front picks it up.
  const [seed, setSeed] = useState({ text: '', nonce: 0 });
  // Bumped whenever images change so the grid reloads.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setUnauthHandler(() => setAuthed(false));
    api.get('/api/me').then((m) => setAuthed(m.authed)).catch(() => setAuthed(false));
  }, []);

  const refreshFolders = useCallback(async () => {
    const [p, s] = await Promise.all([api.get('/api/projects'), api.get('/api/styles')]);
    setProjects(p);
    setStyles(s);
  }, []);

  useEffect(() => {
    if (!authed) return;
    api.get('/api/config').then(setConfig);
    refreshFolders();
  }, [authed, refreshFolders]);

  const changed = () => {
    setVersion((v) => v + 1);
    refreshFolders();
  };

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  if (!config) return null;

  const shared = { projects, styles, config, seed };

  return (
    <>
      <Home {...shared} version={version} onOpen={setOpenId} onChanged={changed} onSignOut={() => setAuthed(false)} />
      {openId && (
        <Viewer {...shared} id={openId} onOpen={setOpenId} onClose={() => setOpenId(null)} onChanged={changed} />
      )}
      {assistantOpen && (
        <Assistant
          onClose={() => setAssistantOpen(false)}
          onUse={(text) => setSeed((s) => ({ text, nonce: s.nonce + 1, target: openId ? 'viewer' : 'home' }))}
        />
      )}
      <button
        className="fab"
        title={assistantOpen ? 'Close prompt assistant' : 'Open prompt assistant'}
        onClick={() => setAssistantOpen((o) => !o)}
      >
        {assistantOpen ? <CloseIcon /> : <SparkIcon />}
      </button>
    </>
  );
}
