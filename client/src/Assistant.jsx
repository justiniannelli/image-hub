import React, { useRef, useEffect, useState } from 'react';
import { api } from './api.js';
import { PlusIcon, SendIcon, SparkIcon } from './icons.jsx';

// Pull the first fenced block out of a reply so "Use as prompt" gets just the prompt.
function extractPrompt(text) {
  const m = /```(?:\w+)?\n?([\s\S]*?)```/.exec(text);
  return (m ? m[1] : text).trim();
}

// Show replies without the ``` fences.
const clean = (text) => text.replace(/```\w*\n?/g, '');

export default function Assistant({ onUse, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy]);

  const send = async () => {
    if (!input.trim() || busy) return;
    const next = [...messages, { role: 'user', content: input.trim() }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError('');
    try {
      const { reply } = await api.post('/api/assist', { messages: next });
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="assistant" role="dialog" aria-label="Prompt assistant">
      <div className="as-head">
        <SparkIcon size={16} />
        <strong>Prompt assistant</strong>
        <span className="spacer" />
        <button className="iconbtn" title="New chat" onClick={() => setMessages([])}>
          <PlusIcon size={16} />
        </button>
      </div>
      <div className="as-msgs">
        {messages.length === 0 && (
          <div className="as-empty">
            <h3>Image generation Assistant</h3>
            <p className="muted small">Describe what you're after and I'll help write the prompt.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'msg ' + m.role}>
            <div>{m.role === 'assistant' ? clean(m.content) : m.content}</div>
            {m.role === 'assistant' && (
              <button className="usebtn" onClick={() => onUse(extractPrompt(m.content))}>
                Use as prompt
              </button>
            )}
          </div>
        ))}
        {busy && <p className="muted small">Thinking…</p>}
        {error && <p className="error small">{error}</p>}
        <div ref={end} />
      </div>
      <form
        className="as-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything" />
        <button className="iconbtn" disabled={!input.trim() || busy} title="Send">
          <SendIcon size={16} />
        </button>
      </form>
      <p className="as-note">AI-generated output may be incomplete or inaccurate. Review it before using it.</p>
    </aside>
  );
}
