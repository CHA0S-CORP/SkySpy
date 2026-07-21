/**
 * Shared test helpers for useAssistantChat tests (happy-path + error-path).
 * Test-only module — not shipped in the app bundle.
 */

// Build a fake SSE fetch Response that streams the given frames.
export function sseResponse(frames) {
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

// A fake Response whose reader rejects mid-stream after `frames` are served.
export function sseResponseThenReject(frames, error = new Error('network dropped')) {
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
            return Promise.reject(error);
          },
        };
      },
    },
  };
}

// A non-OK HTTP response (no readable body consumed).
export function httpErrorResponse(status) {
  return { ok: false, status, body: null };
}

export const REPLY = (text) => [
  `data: {"type":"token","text":${JSON.stringify(text)}}\n\n`,
  `data: {"type":"final","answer":${JSON.stringify(text)},"sources":[]}\n\n`,
];
