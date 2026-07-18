#!/usr/bin/env node
// @ts-check

/**
 * Remove byte-identical duplicate screenshots within each viewport directory.
 *
 * Some doc captures can still collapse to an identical frame (an interaction
 * that no-ops because a control is absent, an empty data state, etc.). Those
 * duplicates make the README gallery look padded, so this backstop keeps a
 * single canonical file per pixel-identical group and deletes the rest.
 *
 * Runs on the Playwright `output/` dirs BEFORE `docs:index` copies them into
 * `docs/screenshots`, so the deleted duplicates are never copied and never make
 * it into the manifest or the markdown.
 *
 * Canonical file per group = the shortest name, ties broken alphabetically.
 * A shorter name is almost always the "default state" capture
 * (e.g. `audio-list` beats `audio-emergency`), which is the one worth keeping.
 *
 * Usage: node e2e/docs/utils/dedupe-screenshots.js   (run from web/)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const OUTPUT_DIR = path.join(process.cwd(), 'e2e/docs/output');
const VIEWPORTS = ['desktop', 'tablet', 'mobile'];

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function pickCanonical(names) {
  return [...names].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

function main() {
  console.log('=== SkySpy Screenshot Deduper ===\n');
  let removed = 0;

  for (const viewport of VIEWPORTS) {
    const dir = path.join(OUTPUT_DIR, viewport);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
    const byHash = new Map();
    for (const f of files) {
      const h = md5(path.join(dir, f));
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(f);
    }

    for (const group of byHash.values()) {
      if (group.length < 2) continue;
      const keep = pickCanonical(group);
      for (const f of group) {
        if (f === keep) continue;
        fs.unlinkSync(path.join(dir, f));
        removed++;
        console.log(`  ${viewport}/${f}  ->  duplicate of ${keep} (removed)`);
      }
    }
  }

  console.log(`\nDone. Removed ${removed} duplicate screenshot(s).`);
}

main();
