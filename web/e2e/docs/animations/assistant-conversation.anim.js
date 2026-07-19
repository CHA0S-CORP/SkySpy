// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Assistant (Agent) Conversation Animation Capture
 *
 * Records a dynamic, multi-turn chat with the AI assistant: the user asks a
 * question, the typing indicator appears, a tool call is traced, then the
 * answer streams in token-by-token — twice, to show a follow-up turn.
 *
 * The real backend needs a live LLM, so we install a fake SSE endpoint that
 * replays a scripted conversation with realistic timing. streamAsk() (see
 * useAssistantChat.js) POSTs to /api/v1/assistant/stream/ and reads
 * `\n\n`-delimited `data: {json}` frames, so we stream those over timers to
 * drive the genuine UI (user bubble → typing dots → tool trace → streamed
 * tokens → final).
 */

/**
 * Init script (runs in-page before app load): override window.fetch for the
 * assistant stream endpoint and replay each turn's frames on a ReadableStream.
 * @param {Array<{tool?: {tool: string, args: object}, answer: string}>} script
 */
function installFakeAssistantStream(script) {
  const origFetch = window.fetch.bind(window);
  let turn = 0;

  const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

  // Build the timed frame list for one turn.
  const buildFrames = (spec) => {
    const frames = [];
    if (spec.tool) {
      frames.push({ delay: 700, chunk: frame({ type: 'tool', tool: spec.tool.tool, args: spec.tool.args }) });
    }
    const words = spec.answer.split(' ');
    for (let i = 0; i < words.length; i++) {
      const text = (i === 0 ? '' : ' ') + words[i];
      frames.push({ delay: 55, chunk: frame({ type: 'token', text }) });
    }
    frames.push({ delay: 200, chunk: frame({ type: 'final', answer: spec.answer, sources: spec.sources || [] }) });
    return frames;
  };

  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('/api/v1/assistant/stream/')) {
      return origFetch(input, init);
    }

    const spec = script[Math.min(turn, script.length - 1)];
    turn += 1;
    const frames = buildFrames(spec);
    const enc = new TextEncoder();
    let i = 0;

    const stream = new ReadableStream({
      pull(controller) {
        return new Promise((resolve) => {
          if (i >= frames.length) {
            controller.close();
            resolve();
            return;
          }
          const f = frames[i++];
          setTimeout(() => {
            controller.enqueue(enc.encode(f.chunk));
            resolve();
          }, f.delay);
        });
      },
    });

    return Promise.resolve(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
  };
}

const CONVERSATION = [
  {
    question: 'Any military aircraft near me right now?',
    tool: { tool: 'search_aircraft', args: { category: 'military', radius_nm: 60 } },
    answer:
      'Yes — one military contact is up. A USAF Boeing RC-135V Rivet Joint (reg 62-4139, hex AE01CE) is orbiting about 42 nm to the northeast at FL290, squawking 4713. It has been holding a racetrack pattern for the last 20 minutes, consistent with a SIGINT collection track.',
    sources: [{ icao_hex: 'AE01CE', registration: '62-4139' }],
  },
  {
    question: 'Where is it headed?',
    tool: { tool: 'get_aircraft_track', args: { hex: 'AE01CE' } },
    answer:
      'It is not tracking outbound yet — the RC-135 is still flying the orbit, alternating northwest and southeast legs centered near the coastline. No filed destination is in the ADS-B data; on this profile it will typically recover to its origin (Offutt AFB / KOFF) once the mission window closes.',
    sources: [{ icao_hex: 'AE01CE', registration: '62-4139' }],
  },
];

test.describe('Assistant Conversation Animation', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    // Install the fake stream BEFORE navigation so the app's fetch is patched.
    await page.addInitScript(installFakeAssistantStream, CONVERSATION);
    await screenshotState.setupForAnimation();

    await page.goto('/#assistant');
    await page.waitForLoadState('domcontentloaded');

    // Hide the React Query devtools floating panel — it overlaps the composer
    // (intercepts the send click) and has no place in a docs recording.
    await page.addStyleTag({
      content: '.tsqd-parent-container, #ReactQueryDevtools { display: none !important; }',
    });
  });

  test('agent-conversation', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(600);

    const input = page.locator('.v2-asst__input');

    // Composer input is disabled while a turn is streaming (busy), so
    // "input enabled again" is the reliable stream-complete signal.
    const idle = () => {
      const el = /** @type {HTMLInputElement} */ (document.querySelector('.v2-asst__input'));
      return !!el && !el.disabled;
    };

    for (let turn = 0; turn < CONVERSATION.length; turn++) {
      const { question } = CONVERSATION[turn];

      await page.waitForFunction(idle, undefined, { timeout: 20000 });

      // Type the question with a human-ish cadence.
      await input.click();
      await input.pressSequentially(question, { delay: 45 });
      await page.waitForTimeout(300);
      // Submit via Enter (composer is a form) — avoids the send-button hit test.
      await input.press('Enter');

      // Typing dots show, tool trace lands, tokens stream in — then busy clears.
      await page.waitForFunction(idle, undefined, { timeout: 20000 });
      // Let the finished bubble sit on screen before the next turn.
      await page.waitForTimeout(1600);
    }

    await page.waitForTimeout(1200);
    await animationHelpers.stopRecording();
  });
});
