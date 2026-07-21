import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAssistantChat } from './useAssistantChat';
import {
  sseResponse,
  sseResponseThenReject,
  httpErrorResponse,
  REPLY,
} from './useAssistantChat.testUtils';

// Persistence goes through the api module; mock it so it never touches fetch.
vi.mock('../../../../lib/api', () => ({
  default: {
    createChatSession: vi.fn(() => Promise.resolve({ id: 42 })),
    appendChatMessages: vi.fn(() => Promise.resolve({ id: 42, messages: [] })),
    getChatSession: vi.fn(() => Promise.resolve({ id: 7, messages: [] })),
    getAssistantSuggestions: vi.fn(() => Promise.resolve({ suggestions: [] })),
  },
}));

import api from '../../../../lib/api';

function wrapper({ children }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderChat = (props) => renderHook(() => useAssistantChat(props), { wrapper });

// Route the mount auth probe (suggest) to a happy response; the stream call
// gets the per-test response.
function mockFetch(streamResponse) {
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/assistant/suggest/'))
      return Promise.resolve({ ok: true, status: 200 });
    return Promise.resolve(streamResponse);
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAssistantChat error paths', () => {
  it('HTTP 500 → assistant message carries the error and streaming stops', async () => {
    mockFetch(httpErrorResponse(500));
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('hello');
    });
    const last = result.current.messages.at(-1);
    expect(last.role).toBe('assistant');
    expect(last.error).toBe('HTTP 500');
    expect(result.current.busy).toBe(false);
    // Errored turns are never persisted.
    expect(api.createChatSession).not.toHaveBeenCalled();
    expect(api.appendChatMessages).not.toHaveBeenCalled();
  });

  it('HTTP 401 → error surfaces AND the sign-in gate locks', async () => {
    mockFetch(httpErrorResponse(401));
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('hello');
    });
    expect(result.current.messages.at(-1).error).toBe('HTTP 401');
    expect(result.current.locked).toBe(true);
  });

  it('malformed SSE frame is ignored; the final frame still applies', async () => {
    mockFetch(
      sseResponse([
        'data: {broken json\n\n',
        'data: {"type":"token","text":"partial "}\n\n',
        'data: {"type":"final","answer":"partial answer","sources":[]}\n\n',
      ])
    );
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('hello');
    });
    const last = result.current.messages.at(-1);
    expect(last.error).toBeUndefined();
    expect(last.text).toBe('partial answer');
  });

  it('reader rejection mid-stream → error recorded, hook not hung', async () => {
    mockFetch(sseResponseThenReject(['data: {"type":"token","text":"par"}\n\n']));
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('hello');
    });
    const last = result.current.messages.at(-1);
    expect(last.error).toMatch(/network dropped/);
    expect(result.current.busy).toBe(false);
    expect(api.appendChatMessages).not.toHaveBeenCalled();
  });

  it('stream ends without a final frame → tokens kept, turn finalized', async () => {
    mockFetch(sseResponse(['data: {"type":"token","text":"tokens only"}\n\n']));
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('hello');
    });
    const last = result.current.messages.at(-1);
    expect(last.text).toBe('tokens only');
    expect(last.error).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it('errored turns are excluded from the history sent on the next turn', async () => {
    // Turn 1 fails with HTTP 500; turn 2 succeeds — its request history must
    // contain the user turns but NOT the errored assistant turn.
    let call = 0;
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/assistant/suggest/'))
        return Promise.resolve({ ok: true, status: 200 });
      call += 1;
      return Promise.resolve(call === 1 ? httpErrorResponse(500) : sseResponse(REPLY('second answer')));
    });
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('first question');
    });
    await act(async () => {
      await result.current.send('second question');
    });
    const streamCalls = fetch.mock.calls.filter((c) => String(c[0]).includes('/assistant/stream/'));
    const body2 = JSON.parse(streamCalls[1][1].body);
    const roles = (body2.history || []).map((h) => h.role);
    expect(roles).toContain('user');
    expect(roles).not.toContain('assistant'); // errored reply dropped
  });

  it('unavailable event → friendly configuration error, no persistence', async () => {
    mockFetch(sseResponse(['data: {"type":"unavailable"}\n\n']));
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('hello');
    });
    expect(result.current.messages.at(-1).error).toMatch(/not configured/);
    expect(api.createChatSession).not.toHaveBeenCalled();
  });

  it('abort mid-stream keeps partial tokens and persists nothing', async () => {
    // A reader that never resolves after the first token — send() only returns
    // once stop() aborts the fetch.
    const enc = new TextEncoder();
    let readCount = 0;
    // Deferred created up-front so the abort listener can reject it whether or
    // not the hanging read() has been reached yet (avoids a race → test hang).
    let rejectPending;
    const pending = new Promise((_, reject) => {
      rejectPending = reject;
    });
    pending.catch(() => {}); // silence unhandled-rejection noise
    const hangingResponse = {
      ok: true,
      status: 200,
      body: {
        getReader() {
          return {
            read() {
              readCount += 1;
              if (readCount === 1)
                return Promise.resolve({
                  value: enc.encode('data: {"type":"token","text":"partial "}\n\n'),
                  done: false,
                });
              return pending;
            },
          };
        },
      },
    };
    global.fetch = vi.fn((url, opts) => {
      if (String(url).includes('/assistant/suggest/'))
        return Promise.resolve({ ok: true, status: 200 });
      // Wire the abort signal to the pending read, like real fetch.
      opts?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        rejectPending(err);
      });
      return Promise.resolve(hangingResponse);
    });

    const { result } = renderChat();
    let sendPromise;
    await act(async () => {
      sendPromise = result.current.send('hello');
      // Let the first token land, then abort.
      await Promise.resolve();
      await Promise.resolve();
      result.current.stop();
      await sendPromise;
    });
    const last = result.current.messages.at(-1);
    expect(last.text).toBe('partial ');
    expect(last.error).toBeUndefined(); // abort is not an error
    expect(result.current.busy).toBe(false);
    expect(api.appendChatMessages).not.toHaveBeenCalled(); // aborted turn not persisted
  });
});
