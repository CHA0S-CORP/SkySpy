import React, { useCallback, useRef, useState } from 'react';
import { Icon } from '../../primitives';

/**
 * SkySpy Assistant — a chat panel over the LangChain tool-calling agent.
 * Streams the answer token-by-token from POST /api/v1/assistant/stream/ (SSE),
 * and shows a collapsible "tools used" trace with cited airframes.
 */

const SUGGESTIONS = [
  'How many military aircraft in the last 24h?',
  'Any safety events today?',
  'Which tracked airframes are registered to a trust?',
  'Busiest hours and top operators this week',
];

async function streamAsk(query, { onEvent, signal }) {
  const res = await fetch('/api/v1/assistant/stream/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: 'error', message: `HTTP ${res.status}` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

function ToolTrace({ steps, sources }) {
  const [open, setOpen] = useState(false);
  if (!steps?.length && !sources?.length) return null;
  return (
    <div className="v2-asst__trace">
      <button type="button" className="v2-asst__trace-toggle" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        {steps.length} tool{steps.length === 1 ? '' : 's'} used
        {sources?.length ? ` · ${sources.length} source${sources.length === 1 ? '' : 's'}` : ''}
      </button>
      {open && (
        <div className="v2-asst__trace-body">
          {steps.map((s, i) => (
            <div key={i} className="v2-asst__trace-step">
              <code>{s.tool}</code>
              {s.args ? <span className="v2-asst__trace-args"> {JSON.stringify(s.args)}</span> : null}
            </div>
          ))}
          {sources?.length ? (
            <div className="v2-asst__trace-sources">
              {sources.map((src, i) => (
                <a key={i} href={`#airframe/${src.icao_hex || ''}`} className="v2-asst__src">
                  {src.registration || src.icao_hex}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`v2-asst__msg v2-asst__msg--${isUser ? 'user' : 'assistant'}`}>
      {!isUser && <Icon name="message" size={15} className="v2-asst__avatar" />}
      <div className="v2-asst__bubble">
        {msg.error ? (
          <span className="v2-asst__err">Assistant unavailable: {msg.error}</span>
        ) : (
          <span className="v2-asst__text">{msg.text || (msg.pending ? '…' : '')}</span>
        )}
        {!isUser && <ToolTrace steps={msg.steps || []} sources={msg.sources || []} />}
      </div>
    </div>
  );
}

export function AssistantScreen() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);

  const send = useCallback(
    async (text) => {
      const query = (text ?? input).trim();
      if (!query || busy) return;
      setInput('');
      setBusy(true);
      setMessages((m) => [
        ...m,
        { role: 'user', text: query },
        { role: 'assistant', text: '', steps: [], sources: [], pending: true },
      ]);

      const patchLast = (patch) =>
        setMessages((m) => {
          const next = [...m];
          const last = { ...next[next.length - 1] };
          next[next.length - 1] = typeof patch === 'function' ? patch(last) : { ...last, ...patch };
          return next;
        });

      abortRef.current = new AbortController();
      try {
        await streamAsk(query, {
          signal: abortRef.current.signal,
          onEvent: (ev) => {
            if (ev.type === 'token') {
              patchLast((last) => ({ ...last, text: (last.text || '') + ev.text, pending: false }));
            } else if (ev.type === 'tool') {
              patchLast((last) => ({ ...last, steps: [...(last.steps || []), { tool: ev.tool, args: ev.args }] }));
            } else if (ev.type === 'final') {
              patchLast((last) => ({
                ...last,
                text: last.text || ev.answer || '',
                sources: ev.sources || [],
                pending: false,
              }));
            } else if (ev.type === 'unavailable') {
              patchLast({ error: 'not configured (set ASSISTANT_ENABLED + an LLM endpoint)', pending: false });
            } else if (ev.type === 'error') {
              patchLast({ error: ev.message || 'error', pending: false });
            }
          },
        });
      } catch (e) {
        if (e.name !== 'AbortError') patchLast({ error: String(e.message || e), pending: false });
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [input, busy]
  );

  return (
    <div className="v2-asst" data-testid="assistant-screen">
      <div className="v2-asst__header">
        <Icon name="message" size={17} style={{ color: 'var(--accent)' }} />
        <span>Assistant</span>
        <span className="v2-asst__sub">Ask about traffic, safety, airframes & analytics</span>
      </div>

      <div className="v2-asst__thread">
        {messages.length === 0 ? (
          <div className="v2-asst__empty">
            <p>Ask a question about what SkySpy is tracking.</p>
            <div className="v2-asst__suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="v2-asst__chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => <Message key={i} msg={msg} />)
        )}
      </div>

      <form
        className="v2-asst__composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="v2-asst__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the assistant…"
          disabled={busy}
          aria-label="Assistant query"
        />
        <button type="submit" className="v2-asst__send" disabled={busy || !input.trim()}>
          <Icon name={busy ? 'refresh' : 'send'} size={16} />
        </button>
      </form>
    </div>
  );
}

export default AssistantScreen;
