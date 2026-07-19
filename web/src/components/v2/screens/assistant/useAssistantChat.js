import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../../../lib/api';
import { getClientId } from '../../../../lib/clientId';
import { ACCESS_TOKEN_KEY } from '../../../../contexts/auth/tokenStorage';
import { chatSessionKeys } from '../../../../hooks/queries/useChatSessionQueries';

/** JSON headers + client id + the JWT bearer (when signed in). The assistant
 *  endpoints authorize via the Authorization header (preferred) OR the
 *  access_token cookie; in bearer-only mode (JWT_AUTH_COOKIE=False) the header
 *  is the ONLY way, so omitting it 401'd authorized users into the sign-in gate. */
function assistantHeaders() {
  const headers = { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() };
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// How many prior turns to send so the agent remembers the conversation. The
// backend caps again; this just bounds the request size.
const MAX_HISTORY = 16;

/**
 * Shared chat engine for the assistant — used by both the full-page
 * AssistantScreen and the app-wide SupportChatDock so their behaviour can't
 * drift. Streams tokens from POST /api/v1/assistant/stream/ (SSE) and exposes
 * send / newChat / stop plus session load/save.
 *
 * Completed turns are persisted server-side (see api.createChatSession /
 * appendChatMessages) so conversations survive reloads and can be reopened or
 * deleted from the sessions sidebar instead of being cleared away.
 *
 * @param {object} [opts]
 * @param {() => (string|undefined)} [opts.getContext] - called at send-time to
 *   attach page context (what the user is currently looking at) to the query.
 * @param {'screen'|'dock'} [opts.surface] - which UI owns the session.
 */
export async function streamAsk(query, { onEvent, signal, context, history }) {
  const body = { query };
  if (context) body.context = context;
  if (history?.length) body.history = history;
  const res = await fetch('/api/v1/assistant/stream/', {
    method: 'POST',
    headers: assistantHeaders(),
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

// Rebuild the frontend message shape from a persisted ChatMessage.
function hydrateMessage(m) {
  return {
    role: m.role,
    text: m.text || '',
    steps: m.steps || [],
    sources: m.sources || [],
    photos: m.photos || [],
    maps: m.maps || [],
    error: m.error,
    pending: false,
  };
}

export function useAssistantChat({
  getContext,
  surface = 'screen',
  onRadarCommand,
  onRadarTracks,
} = {}) {
  const queryClient = useQueryClient();
  // Latest onRadarCommand in a ref so send()'s stable closure always calls the
  // current one without being re-created.
  const onRadarCommandRef = useRef(onRadarCommand);
  useEffect(() => {
    onRadarCommandRef.current = onRadarCommand;
  }, [onRadarCommand]);
  const onRadarTracksRef = useRef(onRadarTracks);
  useEffect(() => {
    onRadarTracksRef.current = onRadarTracks;
  }, [onRadarTracks]);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  // The assistant is gated by CanUseAssistant on the backend — an authenticated
  // user with `assistant.view`, even in public mode (relaxed in dev). Drive the
  // sign-in gate off the real API response (the source of truth, matching
  // FlightHistoryCard) rather than mirroring the permission logic client-side.
  // Probe /assistant/suggest/ with an empty body: it authorizes via the same
  // CanUseAssistant, and short-circuits to [] before any LLM call, so it's free.
  const [locked, setLocked] = useState(false);
  // Dynamically generated follow-up prompts for the current conversation, from
  // a separate tool-free LLM context (POST /assistant/suggest/). Distinct from
  // the static starter suggestions shown on the empty state.
  const [suggestions, setSuggestions] = useState([]);
  const abortRef = useRef(null);
  const suggestSeqRef = useRef(0);

  // Mirror sessionId in a ref so the async send() reads the current session
  // without being re-created every time it changes.
  const sessionIdRef = useRef(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Mirror messages in a ref so send() can read the latest thread (for history)
  // without being re-created on every message change.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // One-shot auth probe on mount — flips `locked` for anonymous users so the UI
  // can show the sign-in gate before the first send.
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/assistant/suggest/', {
      method: 'POST',
      headers: assistantHeaders(),
      body: '{}',
    })
      .then((res) => {
        if (alive) setLocked(res.status === 401 || res.status === 403);
      })
      .catch(() => {
        /* network hiccup — leave unlocked, the send will surface any error */
      });
    return () => {
      alive = false;
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  // Fetch follow-up prompt suggestions for a given conversation. Fire-and-forget
  // and guarded by a sequence token so a stale response can't overwrite newer
  // suggestions (or ones cleared by newChat).
  const refreshSuggestions = useCallback((history, context) => {
    const seq = ++suggestSeqRef.current;
    api
      .getAssistantSuggestions(history, context)
      .then((res) => {
        if (seq === suggestSeqRef.current) setSuggestions(res?.suggestions || []);
      })
      .catch((e) => {
        console.error('Failed to fetch suggestions:', e);
      });
  }, []);

  // Start a fresh conversation. The previous one stays saved server-side and
  // remains listed in the sessions sidebar.
  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    suggestSeqRef.current++; // invalidate any in-flight suggestion fetch
    setMessages([]);
    setSessionId(null);
    sessionIdRef.current = null;
    setSuggestions([]);
    setBusy(false);
  }, []);
  // Back-compat alias for existing callers/tests.
  const clear = newChat;

  // Reopen a saved session and hydrate its thread.
  const loadSession = useCallback(
    async (id) => {
      if (!id) return;
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      setSuggestions([]);
      try {
        const data = await api.getChatSession(id);
        const loaded = (data.messages || []).map(hydrateMessage);
        setMessages(loaded);
        setSessionId(id);
        sessionIdRef.current = id;
        // Refresh follow-up prompts for the reopened conversation.
        const history = loaded
          .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.text && !m.error))
          .slice(-MAX_HISTORY)
          .map((m) => ({ role: m.role, content: m.text }));
        if (history.length) refreshSuggestions(history);
      } catch (e) {
        console.error('Failed to load chat session:', e);
      }
    },
    [refreshSuggestions]
  );

  // Save a completed turn: lazily create the session on the first turn, then
  // append the user + assistant messages.
  const persistTurn = useCallback(
    async (userMsg, assistantMsg) => {
      try {
        let id = sessionIdRef.current;
        if (!id) {
          const created = await api.createChatSession({
            title: userMsg.text.slice(0, 120),
            surface,
          });
          id = created.id;
          setSessionId(id);
          sessionIdRef.current = id;
        }
        await api.appendChatMessages(id, [
          { role: 'user', text: userMsg.text },
          {
            role: 'assistant',
            text: assistantMsg.text,
            steps: assistantMsg.steps,
            sources: assistantMsg.sources,
            photos: assistantMsg.photos,
            maps: assistantMsg.maps,
          },
        ]);
        queryClient.invalidateQueries({ queryKey: chatSessionKeys.list() });
        queryClient.invalidateQueries({ queryKey: chatSessionKeys.detail(id) });
      } catch (e) {
        console.error('Failed to persist chat turn:', e);
      }
    },
    [surface, queryClient]
  );

  const send = useCallback(
    async (text) => {
      const query = (text || '').trim();
      if (!query || busy) return;
      setBusy(true);
      // Drop stale follow-up chips while this turn runs.
      suggestSeqRef.current++;
      setSuggestions([]);

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

      const userMsg = { role: 'user', text: query };
      // Single source of truth for the streaming reply — mutated as events
      // arrive and mirrored into React state via sync(). Kept in the closure so
      // it's reliably complete when we persist in the finally block.
      const assistant = {
        role: 'assistant',
        text: '',
        steps: [],
        sources: [],
        photos: [],
        maps: [],
        pending: true,
      };

      setMessages((m) => [...m, userMsg, { ...assistant }]);

      const sync = () =>
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { ...assistant };
          return next;
        });

      let aborted = false;
      abortRef.current = new AbortController();
      try {
        await streamAsk(query, {
          signal: abortRef.current.signal,
          context,
          history,
          onEvent: (ev) => {
            if (ev.type === 'token') {
              assistant.text += ev.text;
              assistant.pending = false;
            } else if (ev.type === 'tool') {
              assistant.steps = [...assistant.steps, { tool: ev.tool, args: ev.args }];
            } else if (ev.type === 'photo') {
              // Airframe photo rendered from the tool call — src is templated
              // server-side, so the model can't hallucinate the URL.
              assistant.photos = [
                ...assistant.photos,
                { src: ev.src, alt: ev.alt, photographer: ev.photographer, source: ev.source },
              ];
            } else if (ev.type === 'map') {
              // Map rendered from the tool call — exact tool coordinates, not
              // model-authored (which landed the map in the wrong place). `filter`
              // is the aircraft id list for the "open in radar" deep-link.
              assistant.maps = [
                ...assistant.maps,
                { title: ev.title, points: ev.points, filter: ev.filter, radar: ev.radar },
              ];
            } else if (ev.type === 'map_command') {
              // Live radar control (filter/zoom/reposition) — apply immediately
              // to the actual radar screen via the host callback.
              try {
                onRadarCommandRef.current?.({
                  label: ev.label,
                  match: ev.match,
                  view: ev.view,
                  count: ev.count,
                });
              } catch {
                /* host not wired (e.g. full-screen assistant) — ignore */
              }
            } else if (ev.type === 'radar_tracks') {
              // Historical flown-path polylines — draw them on the actual radar
              // screen via the host callback.
              try {
                onRadarTracksRef.current?.({
                  label: ev.label,
                  tracks: ev.tracks,
                  view: ev.view,
                  count: ev.count,
                });
              } catch {
                /* host not wired (e.g. full-screen assistant) — ignore */
              }
            } else if (ev.type === 'final') {
              // Prefer the final answer: it's sanitized server-side (photo URLs
              // the model hallucinated into the text are stripped), whereas the
              // streamed tokens still carry them.
              assistant.text = ev.answer || assistant.text || '';
              assistant.sources = ev.sources || [];
              assistant.photos = assistant.photos.length ? assistant.photos : ev.photos || [];
              assistant.maps = assistant.maps.length ? assistant.maps : ev.maps || [];
              assistant.pending = false;
            } else if (ev.type === 'unavailable') {
              assistant.error = 'not configured (set ASSISTANT_ENABLED + an LLM endpoint)';
              assistant.pending = false;
            } else if (ev.type === 'error') {
              assistant.error = ev.message || 'error';
              assistant.pending = false;
              // Auth lapsed mid-session (e.g. token expiry) — surface the gate.
              if (ev.message === 'HTTP 401' || ev.message === 'HTTP 403') setLocked(true);
            }
            sync();
          },
        });
      } catch (e) {
        if (e.name === 'AbortError') {
          aborted = true;
        } else {
          assistant.error = String(e.message || e);
          assistant.pending = false;
          sync();
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
        // Persist the completed turn and generate follow-up prompts from it.
        if (!aborted && !assistant.error && assistant.text) {
          persistTurn(userMsg, assistant);
          const nextHistory = [
            ...history,
            { role: 'user', content: query },
            { role: 'assistant', content: assistant.text },
          ].slice(-MAX_HISTORY);
          refreshSuggestions(nextHistory, context);
        }
      }
    },
    [busy, getContext, persistTurn, refreshSuggestions]
  );

  return {
    messages,
    busy,
    locked,
    sessionId,
    suggestions,
    send,
    clear,
    newChat,
    stop,
    loadSession,
  };
}

export default useAssistantChat;
