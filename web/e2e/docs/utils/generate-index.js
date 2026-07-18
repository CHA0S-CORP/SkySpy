#!/usr/bin/env node
// @ts-check

/**
 * Generate index.json manifest for all documentation screenshots and animations
 *
 * Usage: node e2e/docs/utils/generate-index.js
 *
 * Outputs:
 * - docs/screenshots/index.json - Complete manifest of all assets
 */

import fs from 'fs';
import path from 'path';

// Scripts run from web/; the committed screenshots + README references live at
// the repo root (../docs/screenshots), so target that, not web/docs/screenshots.
const DOCS_OUTPUT_DIR = path.join(process.cwd(), '..', 'docs/screenshots');
const E2E_OUTPUT_DIR = path.join(process.cwd(), 'e2e/docs/output');

/**
 * @typedef {Object} Asset
 * @property {string} name - File name
 * @property {string} path - Relative path from docs/screenshots
 * @property {string} type - 'screenshot' or 'animation'
 * @property {string} viewport - Viewport name (desktop, tablet, mobile, animations)
 * @property {string} view - View/feature name
 * @property {number} size - File size in bytes
 * @property {string} modified - ISO timestamp
 */

/**
 * Scan a directory for image files
 * @param {string} dir - Directory to scan
 * @param {string} basePath - Base path for relative paths
 * @returns {Asset[]}
 */
function scanDirectory(dir, basePath = '') {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const assets = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      assets.push(...scanDirectory(fullPath, relativePath));
    } else if (entry.name.endsWith('.png') || entry.name.endsWith('.gif') || entry.name.endsWith('.webp')) {
      const stats = fs.statSync(fullPath);
      const isAnimation = entry.name.endsWith('.gif') || entry.name.endsWith('.webp');

      // Parse view name from filename
      // e.g., "map-aircraft-popup.png" -> "map"
      const nameParts = entry.name.replace(/\.(png|gif|webp)$/, '').split('-');
      const view = nameParts[0];

      assets.push({
        name: entry.name,
        path: relativePath,
        type: isAnimation ? 'animation' : 'screenshot',
        viewport: basePath || 'root',
        view,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      });
    }
  }

  return assets;
}

/**
 * Copy files from e2e output to docs directory
 */
function copyOutputToDocsDir() {
  const viewports = ['desktop', 'tablet', 'mobile'];

  for (const viewport of viewports) {
    const srcDir = path.join(E2E_OUTPUT_DIR, viewport);
    const destDir = path.join(DOCS_OUTPUT_DIR, viewport);

    if (!fs.existsSync(srcDir)) {
      continue;
    }

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.png'));

    for (const file of files) {
      const srcPath = path.join(srcDir, file);
      const destPath = path.join(destDir, file);
      fs.copyFileSync(srcPath, destPath);
    }

    console.log(`Copied ${files.length} files to docs/screenshots/${viewport}/`);
  }
}

/**
 * Generate the index manifest
 */
function generateIndex() {
  console.log('=== SkySpy Documentation Index Generator ===\n');

  // Ensure docs directory exists
  if (!fs.existsSync(DOCS_OUTPUT_DIR)) {
    fs.mkdirSync(DOCS_OUTPUT_DIR, { recursive: true });
  }

  // Copy files from e2e output
  console.log('Copying screenshots from e2e output...');
  copyOutputToDocsDir();

  // Scan for all assets
  console.log('\nScanning for assets...');
  const assets = scanDirectory(DOCS_OUTPUT_DIR);

  // Group by type and viewport
  const byType = {
    screenshots: assets.filter((a) => a.type === 'screenshot'),
    animations: assets.filter((a) => a.type === 'animation'),
  };

  const byViewport = {};
  for (const asset of assets) {
    if (!byViewport[asset.viewport]) {
      byViewport[asset.viewport] = [];
    }
    byViewport[asset.viewport].push(asset);
  }

  const byView = {};
  for (const asset of assets) {
    if (!byView[asset.view]) {
      byView[asset.view] = [];
    }
    byView[asset.view].push(asset);
  }

  // Build index
  const index = {
    generated: new Date().toISOString(),
    version: '1.0.0',
    summary: {
      totalAssets: assets.length,
      screenshots: byType.screenshots.length,
      animations: byType.animations.length,
      viewports: Object.keys(byViewport),
      views: Object.keys(byView),
    },
    assets,
    byViewport,
    byView,
  };

  // Write index file
  const indexPath = path.join(DOCS_OUTPUT_DIR, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  console.log('\n--- Summary ---');
  console.log(`Total assets: ${assets.length}`);
  console.log(`Screenshots: ${byType.screenshots.length}`);
  console.log(`Animations: ${byType.animations.length}`);
  console.log(`Viewports: ${Object.keys(byViewport).join(', ')}`);
  console.log(`Views: ${Object.keys(byView).join(', ')}`);
  console.log(`\nIndex saved to: ${indexPath}`);

  return index;
}

// Run if executed directly
generateIndex();
