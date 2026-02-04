#!/usr/bin/env node
// @ts-check

/**
 * CLI script to convert all animation recordings to GIFs
 *
 * Usage: node e2e/docs/utils/convert-all-videos.js
 *
 * This script:
 * 1. Finds all .webm video recordings in e2e/docs/output
 * 2. Converts each to an optimized GIF using ffmpeg
 * 3. Outputs GIFs to docs/screenshots/animations/
 */

import { convertAnimationRecordings, checkFfmpeg } from './gif-converter.js';

async function main() {
  console.log('=== SkySpy Documentation Video to GIF Converter ===\n');

  // Check ffmpeg availability
  if (!checkFfmpeg()) {
    console.error('Error: ffmpeg is not installed or not in PATH');
    console.error('');
    console.error('Install ffmpeg:');
    console.error('  macOS:  brew install ffmpeg');
    console.error('  Ubuntu: apt-get install ffmpeg');
    console.error('  Windows: choco install ffmpeg');
    process.exit(1);
  }

  console.log('✓ ffmpeg found\n');

  try {
    const results = await convertAnimationRecordings();

    if (results.length === 0) {
      console.log('\nNo videos were processed.');
      console.log('Run `npm run docs:animations` first to record animations.');
      return;
    }

    const successful = results.filter((r) => r.status === 'success');

    if (successful.length > 0) {
      console.log('\n✓ Conversion complete!');
      console.log(`  GIFs saved to: docs/screenshots/animations/`);
    }

    if (results.some((r) => r.status === 'error')) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Conversion failed:', error.message);
    process.exit(1);
  }
}

main();
