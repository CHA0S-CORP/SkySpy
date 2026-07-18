#!/usr/bin/env node
// @ts-check

/**
 * Inject generated documentation screenshots into README.md and docs/*.md.
 *
 * Reads the manifest produced by generate-index.js
 * (docs/screenshots/index.json, grouped `byView`) and rewrites the content
 * between marker comments so the markdown always reflects the latest captures:
 *
 *   <!-- SCREENSHOTS:map:START -->
 *   ...auto-generated image block...
 *   <!-- SCREENSHOTS:map:END -->
 *
 * Only the region between a START/END pair is rewritten — everything else in
 * the file is left untouched, so the step is idempotent and safe to re-run.
 *
 * Usage: node e2e/docs/utils/embed-screenshots.js   (run from web/)
 */

import fs from 'fs';
import path from 'path';

// web/ is the cwd; repo root is one level up.
const WEB_DIR = process.cwd();
const REPO_ROOT = path.resolve(WEB_DIR, '..');
const INDEX_PATH = path.join(REPO_ROOT, 'docs/screenshots/index.json');

// Only desktop captures are embedded inline; all viewports are committed and
// linked from the responsive note.
const PRIMARY_VIEWPORT = 'desktop';

/**
 * Files to process and the path prefix each uses to reach docs/screenshots.
 * README lives at repo root; guides live under docs/.
 * @type {{file: string, prefix: string}[]}
 */
const TARGETS = [
  { file: 'README.md', prefix: 'docs/screenshots' },
  { file: 'docs/08-frontend.md', prefix: 'screenshots' },
  { file: 'docs/10-map-aviation.md', prefix: 'screenshots' },
  { file: 'docs/13-safety-alerts.md', prefix: 'screenshots' },
  { file: 'docs/14-acars.md', prefix: 'screenshots' },
  { file: 'docs/17-cannonball-mode.md', prefix: 'screenshots' },
  { file: 'docs/18-statistics.md', prefix: 'screenshots' },
  { file: 'docs/19-admin-configuration.md', prefix: 'screenshots' },
];

/** Turn "map-aircraft-popup" into "Map — Aircraft Popup". */
function altText(name) {
  const base = name.replace(/\.(png|gif)$/i, '');
  const words = base.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(' ');
}

/**
 * Build the markdown block for one view from its assets.
 * @param {string} view
 * @param {import('./generate-index.js').Asset[]} assets
 * @param {string} prefix
 */
function renderBlock(view, assets, prefix) {
  const desktop = assets
    .filter((a) => a.type === 'screenshot' && a.viewport === PRIMARY_VIEWPORT)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (desktop.length === 0) {
    return `_No screenshots captured for **${view}** yet — run \`npm run docs:generate\` from \`web/\`._`;
  }

  const lines = desktop.map((a) => `![${altText(a.name)}](${prefix}/${a.path})`);

  // Note any responsive variants that were committed alongside the desktop shots.
  const otherViewports = [...new Set(assets.map((a) => a.viewport))].filter(
    (v) => v !== PRIMARY_VIEWPORT && v !== 'root'
  );
  if (otherViewports.length > 0) {
    lines.push('');
    lines.push(`<sub>Also captured for: ${otherViewports.sort().join(', ')} (see \`docs/screenshots/\`).</sub>`);
  }

  return lines.join('\n');
}

/**
 * Replace every SCREENSHOTS marker block in `content`.
 * @param {string} content
 * @param {Record<string, import('./generate-index.js').Asset[]>} byView
 * @param {string} prefix
 * @returns {{ content: string, filled: string[], missing: string[] }}
 */
function injectMarkers(content, byView, prefix) {
  const filled = [];
  const missing = [];

  const pattern =
    /(<!--\s*SCREENSHOTS:([\w-]+):START\s*-->)([\s\S]*?)(<!--\s*SCREENSHOTS:\2:END\s*-->)/g;

  const next = content.replace(pattern, (_match, start, view, _body, end) => {
    const assets = byView[view] || [];
    if (assets.length === 0) missing.push(view);
    else filled.push(view);
    const block = renderBlock(view, assets, prefix);
    return `${start}\n${block}\n${end}`;
  });

  return { content: next, filled, missing };
}

function main() {
  console.log('=== SkySpy Screenshot Embedder ===\n');

  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`Index not found: ${INDEX_PATH}`);
    console.error('Run `npm run docs:index` (or `npm run docs:generate`) first.');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const byView = index.byView || {};

  let anyChanged = false;

  for (const { file, prefix } of TARGETS) {
    const abs = path.join(REPO_ROOT, file);
    if (!fs.existsSync(abs)) {
      console.log(`skip  ${file} (not found)`);
      continue;
    }

    const before = fs.readFileSync(abs, 'utf8');
    if (!/<!--\s*SCREENSHOTS:/.test(before)) {
      console.log(`skip  ${file} (no markers)`);
      continue;
    }

    const { content: after, filled, missing } = injectMarkers(before, byView, prefix);

    if (after !== before) {
      fs.writeFileSync(abs, after);
      anyChanged = true;
      console.log(`write ${file}  (${filled.length} views filled${missing.length ? `, ${missing.length} missing: ${missing.join(', ')}` : ''})`);
    } else {
      console.log(`ok    ${file}  (no change; ${filled.length} views)`);
    }
  }

  console.log(`\n${anyChanged ? 'Screenshots embedded.' : 'No changes — markdown already up to date.'}`);
}

main();
