import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAssistantChat } from './useAssistantChat';

// Persistence goes through the api module; mock it so it never touches fetch —
// that keeps global.fetch to just the SSE stream sends plus the mount auth probe
// (filtered out via streamCalls() below).
vi.mock('../../../../lib/api', () => ({
  default: {
    createChatSession: vi.fn(() => Promise.resolve({ id: 42 })),
    appendChatMessages: vi.fn(() => Promise.resolve({ id: 42, messages: [] })),
    getChatSession: vi.fn(() => Promise.resolve({ id: 7, messages: [] })),
    getAssistantSuggestions: vi.fn(() => Promise.resolve({ suggestions: [] })),
  },
}));

import api from '../../../../lib/api';
import { sseResponse, REPLY } from './useAssistantChat.testUtils';

function wrapper({ children }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderChat = (props) => renderHook(() => useAssistantChat(props), { wrapper });

describe('useAssistantChat conversation memory', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve(sseResponse(REPLY('a 737'))));
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  const bodyOf = (call) => JSON.parse(call[1].body);
  // The hook fires a one-shot auth probe to /assistant/suggest/ on mount, so
  // filter to the SSE stream calls to index sends independently of the probe.
  const streamCalls = () => fetch.mock.calls.filter((c) => String(c[0]).includes('/assistant/stream/'));

  it('sends no history on the first turn, then prior turns on later ones', async () => {
    const { result } = renderChat();

    await act(async () => {
      await result.current.send('tell me about UAL123');
    });
    expect(bodyOf(streamCalls()[0]).history).toBeUndefined();

    await act(async () => {
      await result.current.send('and where is it now?');
    });
    const body2 = bodyOf(streamCalls()[1]);
    expect(body2.query).toBe('and where is it now?');
    expect(body2.history).toEqual([
      { role: 'user', content: 'tell me about UAL123' },
      { role: 'assistant', content: 'a 737' },
    ]);
  });

  it('forgets history after newChat() and resets the session', async () => {
    const { result } = renderChat();

    await act(async () => {
      await result.current.send('first question');
    });
    act(() => result.current.newChat());
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.sessionId).toBeNull();

    await act(async () => {
      await result.current.send('fresh start');
    });
    expect(bodyOf(streamCalls()[1]).history).toBeUndefined();
  });

  it('attaches page context from getContext when provided', async () => {
    const { result } = renderChat({ getContext: () => 'Page: History' });
    await act(async () => {
      await result.current.send('what am I seeing?');
    });
    expect(bodyOf(streamCalls()[0]).context).toBe('Page: History');
  });
});

describe('useAssistantChat session persistence', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve(sseResponse(REPLY('a 737'))));
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a session then appends the completed turn', async () => {
    const { result } = renderChat({ surface: 'dock' });

    await act(async () => {
      await result.current.send('hello there');
      // let the fire-and-forget persist settle
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.createChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'dock', title: 'hello there' })
    );
    expect(api.appendChatMessages).toHaveBeenCalledWith(
      42,
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', text: 'hello there' }),
        expect.objectContaining({ role: 'assistant', text: 'a 737' }),
      ])
    );
  });

  it('reuses the session id on the second turn (creates once)', async () => {
    const { result } = renderChat();

    await act(async () => {
      await result.current.send('one');
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.send('two');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.createChatSession).toHaveBeenCalledTimes(1);
    expect(api.appendChatMessages).toHaveBeenCalledTimes(2);
  });

  it('fetches follow-up suggestions from the completed conversation', async () => {
    api.getAssistantSuggestions.mockResolvedValueOnce({ suggestions: ['ask X', 'ask Y'] });
    const { result } = renderChat();

    await act(async () => {
      await result.current.send('what is UAL123?');
      await Promise.resolve();
      await Promise.resolve();
    });

    const [history] = api.getAssistantSuggestions.mock.calls[0];
    expect(history).toEqual([
      { role: 'user', content: 'what is UAL123?' },
      { role: 'assistant', content: 'a 737' },
    ]);
    expect(result.current.suggestions).toEqual(['ask X', 'ask Y']);
  });

  it('clears suggestions on newChat', async () => {
    api.getAssistantSuggestions.mockResolvedValueOnce({ suggestions: ['ask X'] });
    const { result } = renderChat();
    await act(async () => {
      await result.current.send('hi');
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => result.current.newChat());
    expect(result.current.suggestions).toEqual([]);
  });

  it('loadSession hydrates messages and sets sessionId', async () => {
    api.getChatSession.mockResolvedValueOnce({
      id: 7,
      messages: [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: 'ans', sources: [{ icao_hex: 'ABC' }] },
      ],
    });
    const { result } = renderChat();

    await act(async () => {
      await result.current.loadSession(7);
    });

    expect(api.getChatSession).toHaveBeenCalledWith(7);
    expect(result.current.sessionId).toBe(7);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', text: 'ans' });
  });
});
