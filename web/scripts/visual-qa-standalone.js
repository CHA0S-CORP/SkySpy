#!/usr/bin/env node
/* eslint-disable no-console -- CLI harness: console is its user-facing output */
/**
 * Self-driven visual QA harness.
 *
 * Loops the v2 routes against an already-running dev server (default
 * http://localhost:3000), and for each route:
 *   - navigates, waits for the app root + settle
 *   - captures a full-page screenshot to e2e/screenshots/qa/<name>.png
 *   - collects console.error / pageerror / >=500 (+ non-benign 4xx) problems
 *   - runs DOM diagnostics: page scrollable?, elements overflowing the
 *     viewport, overlapping interactive/label elements
 * then writes e2e/screenshots/qa/qa-report.json.
 *
 * Usage:
 *   make dev            # start the stack (:3000 dashboard, :8000 API)
 *   node scripts/visual-qa-standalone.js [--url http://localhost:3000] [--settle 6000]
 *
 * The agent reads the PNGs + qa-report.json and iterates until clean.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO, 'e2e/screenshots/qa');
const REPORT = path.join(OUT_DIR, 'qa-report.json');

const argv = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const BASE = getArg('--url', 'http://localhost:3000').replace(/\/$/, '');
const SETTLE_MS = Number(getArg('--settle', '6000'));
const VIEWPORT = { width: 1600, height: 1000 };

// Reuse the benign allowlists from e2e/tests/visual-qa.spec.js.
const BENIGN_CONSOLE = [
  /AudioContext was not allowed to start/,
  /Notification permission/,
  /ResizeObserver loop/,
  /Download the React DevTools/,
  /Fix any of the following/,
  /Fix all of the following/,
  /axe-core/,
  /Failed to load resource.*(airframes|lookup\/aircraft)/,
  /the server responded with a status of 404/,
  /the server responded with a status of 401/,
  /WebSocket is already in CLOSING or CLOSED state/,
];
const BENIGN_4XX = [/\/api\/v1\/airframes\//, /\/api\/v1\/lookup\/aircraft\//, /\/api\/v1\/audio\/frequencies/];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const isLocal = (url) => {
  try {
    return LOCAL_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

// route hash → screenshot name. Root is the v2 shell for all except cannonball.
const ROUTES = [
  { hash: 'map', name: 'map' },
  { hash: 'aircraft', name: 'aircraft-list' },
  { hash: 'stats', name: 'statistics' },
  { hash: 'history', name: 'history' },
  { hash: 'audio', name: 'radio' },
  { hash: 'alerts', name: 'alerts' },
  { hash: 'system', name: 'system' },
  { hash: 'cannonball', name: 'cannonball' },
];

function collectErrors(page) {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (BENIGN_CONSOLE.some((re) => re.test(text))) return;
    problems.push(`console: ${text.split('\n')[0].slice(0, 200)}`);
  });
  page.on('pageerror', (err) => {
    problems.push(`pageerror: ${String(err).split('\n')[0].slice(0, 200)}`);
  });
  page.on('response', (resp) => {
    const url = resp.url();
    if (!isLocal(url)) return;
    const status = resp.status();
    if (status >= 500) problems.push(`http ${status}: ${url.slice(0, 140)}`);
    else if (status >= 400 && status !== 401 && !BENIGN_4XX.some((re) => re.test(url))) {
      problems.push(`http ${status}: ${url.slice(0, 140)}`);
    }
  });
  return problems;
}

/** DOM diagnostics: scrollability, viewport overflow, interactive/label overlap. */
async function diagnostics(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const root = document.querySelector('.v2-app, .v2-cb, #root > *') || document.body;

    // Which scroll container should scroll? The routed content pane.
    const pane = document.querySelector('.v2-content') || root;
    const paneClips = pane.scrollHeight - pane.clientHeight > 4;
    const paneScrollable = getComputedStyle(pane).overflowY !== 'hidden';

    // HORIZONTAL overflow only: an element extending past the right viewport
    // edge means a broken layout (horizontal scrollbar). Vertical overflow below
    // the fold is normal scrollable content and is covered by the pane clip check.
    const hasHScroll = document.documentElement.scrollWidth > vw + 2;
    const overflow = [];
    if (hasHScroll) {
      for (const el of document.querySelectorAll('.v2-app *, .v2-cb *')) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        if (el.closest('.leaflet-container, .lm__surface, canvas')) continue;
        // element starts on-screen but extends past the right edge
        if (r.left < vw - 4 && r.right > vw + 2) {
          overflow.push({ cls: (el.className || el.tagName).toString().slice(0, 60), right: Math.round(r.right) });
        }
      }
    }

    // Overlapping labels/badges (map/detail chips) — declutter check.
    const labelSel = '.lm-label, .v2-alerts__rule-pri, [data-lm-label]';
    const labels = [...document.querySelectorAll(labelSel)].map((el) => el.getBoundingClientRect());
    let labelOverlaps = 0;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];
        if (a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom) labelOverlaps++;
      }
    }

    const errorBoundary = !!document.body.textContent.match(/Something went wrong|ErrorBoundary/);
    return {
      viewport: { vw, vh },
      pane: { clips: paneClips, scrollable: paneScrollable, scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight },
      unscrollableClip: paneClips && !paneScrollable,
      hScroll: hasHScroll,
      overflowCount: overflow.length,
      overflowSample: overflow.slice(0, 8),
      labelOverlaps,
      errorBoundary,
    };
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = { base: BASE, ts: new Date().toISOString(), routes: {} };
  let anyProblem = false;

  for (const route of ROUTES) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const problems = collectErrors(page);
    const entry = { name: route.name };
    try {
      await page.goto(`${BASE}/#${route.hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.v2-app, .v2-cb', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(SETTLE_MS);
      const diag = await diagnostics(page);
      const shot = path.join(OUT_DIR, `${route.name}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      entry.screenshot = path.relative(REPO, shot);
      entry.diagnostics = diag;
      entry.problems = problems.slice();
      const failed =
        problems.length > 0 || diag.errorBoundary || diag.unscrollableClip || diag.overflowCount > 0 || diag.labelOverlaps > 0;
      entry.ok = !failed;
      if (failed) anyProblem = true;
      const flags = [
        problems.length && `${problems.length} err`,
        diag.errorBoundary && 'ERR-BOUNDARY',
        diag.unscrollableClip && 'CLIP-NOSCROLL',
        diag.overflowCount && `${diag.overflowCount} overflow`,
        diag.labelOverlaps && `${diag.labelOverlaps} label-overlap`,
      ].filter(Boolean);
      console.log(`${entry.ok ? '✓' : '✗'} ${route.name}${flags.length ? '  [' + flags.join(', ') + ']' : ''}`);
      if (problems.length) problems.slice(0, 6).forEach((p) => console.log(`    ${p}`));
    } catch (err) {
      entry.ok = false;
      entry.error = String(err).split('\n')[0];
      anyProblem = true;
      console.log(`✗ ${route.name}  [LOAD FAILED: ${entry.error}]`);
    } finally {
      report.routes[route.hash] = entry;
      await page.close();
    }
  }

  await browser.close();
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${path.relative(REPO, REPORT)}  |  screenshots: ${path.relative(REPO, OUT_DIR)}/`);
  process.exit(anyProblem ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
