import { useCallback, useEffect, useRef, useState } from 'react';

// How many prior turns to send so the agent remembers the conversation. The
// backend caps again; this just bounds the request size.
const MAX_HISTORY = 16;

/**
 * Shared chat engine for the assistant — used by both the full-page
 * AssistantScreen and the app-wide SupportChatDock so their behaviour can't
 * drift. Streams tokens from POST /api/v1/assistant/stream/ (SSE) and exposes
 * send / clear / stop.
 *
 * @param {object} [opts]
 * @param {() => (string|undefined)} [opts.getContext] - called at send-time to
 *   attach page context (what the user is currently looking at) to the query.
 */
export async function streamAsk(query, { onEvent, signal, context, history }) {
  const body = { query };
  if (context) body.context = context;
  if (history?.length) body.history = history;
  const res = await fetch('/api/v1/assistant/stream/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export function useAssistantChat({ getContext } = {}) {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);

  // Mirror messages in a ref so send() can read the latest thread (for history)
  // without being re-created on every message change.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setBusy(false);
  }, []);

  const send = useCallback(
    async (text) => {
      const query = (text || '').trim();
      if (!query || busy) return;
      setBusy(true);

      let context;
      try {
        context = getContext?.() || undefined;
      } catch {
        context = undefined;
      }

      // Prior turns (before this one) so the agent remembers the conversation.
      const history = messagesRef.current
        .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.text && !m.error))
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.text }));

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
          context,
          history,
          onEvent: (ev) => {
            if (ev.type === 'token') {
              patchLast((last) => ({ ...last, text: (last.text || '') + ev.text, pending: false }));
            } else if (ev.type === 'tool') {
              patchLast((last) => ({
                ...last,
                steps: [...(last.steps || []), { tool: ev.tool, args: ev.args }],
              }));
            } else if (ev.type === 'photo') {
              // Airframe photo rendered from the tool call — src is templated
              // server-side, so the model can't hallucinate the URL.
              patchLast((last) => ({
                ...last,
                photos: [
                  ...(last.photos || []),
                  {
                    src: ev.src,
                    alt: ev.alt,
                    photographer: ev.photographer,
                    source: ev.source,
                  },
                ],
              }));
            } else if (ev.type === 'map') {
              // Map rendered from the tool call — exact tool coordinates, not
              // model-authored (which landed the map in the wrong place).
              patchLast((last) => ({
                ...last,
                maps: [...(last.maps || []), { title: ev.title, points: ev.points }],
              }));
            } else if (ev.type === 'final') {
              patchLast((last) => ({
                ...last,
                text: last.text || ev.answer || '',
                sources: ev.sources || [],
                photos: last.photos?.length ? last.photos : ev.photos || [],
                maps: last.maps?.length ? last.maps : ev.maps || [],
                pending: false,
              }));
            } else if (ev.type === 'unavailable') {
              patchLast({
                error: 'not configured (set ASSISTANT_ENABLED + an LLM endpoint)',
                pending: false,
              });
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
    [busy, getContext]
  );

  return { messages, busy, send, clear, stop };
}

export default useAssistantChat;
