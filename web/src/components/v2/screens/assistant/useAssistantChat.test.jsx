import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAssistantChat } from './useAssistantChat';

// Build a fake SSE fetch Response that streams the given frames.
function sseResponse(frames) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (i < frames.length)
              return Promise.resolve({ value: enc.encode(frames[i++]), done: false });
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
  };
}

const REPLY = (text) => [
  `data: {"type":"token","text":${JSON.stringify(text)}}\n\n`,
  `data: {"type":"final","answer":${JSON.stringify(text)},"sources":[]}\n\n`,
];

describe('useAssistantChat conversation memory', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve(sseResponse(REPLY('a 737'))));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const bodyOf = (call) => JSON.parse(call[1].body);

  it('sends no history on the first turn, then prior turns on later ones', async () => {
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.send('tell me about UAL123');
    });
    expect(bodyOf(fetch.mock.calls[0]).history).toBeUndefined();

    await act(async () => {
      await result.current.send('and where is it now?');
    });
    const body2 = bodyOf(fetch.mock.calls[1]);
    expect(body2.query).toBe('and where is it now?');
    expect(body2.history).toEqual([
      { role: 'user', content: 'tell me about UAL123' },
      { role: 'assistant', content: 'a 737' },
    ]);
  });

  it('forgets history after clear()', async () => {
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.send('first question');
    });
    act(() => result.current.clear());
    expect(result.current.messages).toHaveLength(0);

    await act(async () => {
      await result.current.send('fresh start');
    });
    expect(bodyOf(fetch.mock.calls[1]).history).toBeUndefined();
  });

  it('attaches page context from getContext when provided', async () => {
    const { result } = renderHook(() => useAssistantChat({ getContext: () => 'Page: History' }));
    await act(async () => {
      await result.current.send('what am I seeing?');
    });
    expect(bodyOf(fetch.mock.calls[0]).context).toBe('Page: History');
  });
});
