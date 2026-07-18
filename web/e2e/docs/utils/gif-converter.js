// @ts-check
import { execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * GIF converter utility for converting video recordings to animated GIFs
 *
 * Uses ffmpeg for high-quality two-pass conversion with optimized palette
 */

/**
 * @typedef {Object} ConversionOptions
 * @property {number} [fps=15] - Frames per second
 * @property {number} [width=800] - Output width (height auto-calculated)
 * @property {number} [startTime] - Start time in seconds
 * @property {number} [duration] - Duration in seconds
 * @property {boolean} [optimize=true] - Use two-pass palette optimization
 */

/**
 * Check if ffmpeg is available
 * @returns {boolean}
 */
export function checkFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a video file to GIF
 * @param {string} inputPath - Path to input video (webm)
 * @param {string} outputPath - Path to output GIF
 * @param {ConversionOptions} options
 */
export async function convertToGif(inputPath, outputPath, options = {}) {
  const { fps = 15, width = 800, startTime, duration, optimize = true } = options;

  if (!checkFfmpeg()) {
    throw new Error(
      'ffmpeg is not installed. Install it with: brew install ffmpeg (macOS) or apt-get install ffmpeg (Ubuntu)'
    );
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Build ffmpeg filters
  const filters = [`fps=${fps}`, `scale=${width}:-1:flags=lanczos`];

  // Build input options
  const inputOptions = [];
  if (startTime !== undefined) {
    inputOptions.push(`-ss ${startTime}`);
  }
  if (duration !== undefined) {
    inputOptions.push(`-t ${duration}`);
  }

  const inputOptsStr = inputOptions.join(' ');
  const filterStr = filters.join(',');

  if (optimize) {
    // Two-pass conversion for better quality and smaller file size
    const palettePath = inputPath.replace(/\.\w+$/, '_palette.png');

    // Pass 1: Generate optimized palette
    const paletteCmd = `ffmpeg -y ${inputOptsStr} -i "${inputPath}" -vf "${filterStr},palettegen=stats_mode=diff" "${palettePath}"`;

    // Pass 2: Convert using palette
    const convertCmd = `ffmpeg -y ${inputOptsStr} -i "${inputPath}" -i "${palettePath}" -lavfi "${filterStr} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "${outputPath}"`;

    try {
      execSync(paletteCmd, { stdio: 'pipe' });
      execSync(convertCmd, { stdio: 'pipe' });

      // Clean up palette file
      if (fs.existsSync(palettePath)) {
        fs.unlinkSync(palettePath);
      }
    } catch (error) {
      // Clean up on error
      if (fs.existsSync(palettePath)) {
        fs.unlinkSync(palettePath);
      }
      throw error;
    }
  } else {
    // Single-pass conversion (faster but larger file)
    const cmd = `ffmpeg -y ${inputOptsStr} -i "${inputPath}" -vf "${filterStr},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${outputPath}"`;
    execSync(cmd, { stdio: 'pipe' });
  }

  return {
    input: inputPath,
    output: outputPath,
    size: fs.statSync(outputPath).size,
  };
}

/**
 * Check if gif2webp (libwebp) is available
 * @returns {boolean}
 */
export function checkGif2webp() {
  try {
    execSync('gif2webp -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @typedef {Object} WebpOptions
 * @property {number} [quality=75] - Quality 0-100 (lossy) / compression effort baseline
 * @property {boolean} [lossy=false] - Use lossy compression (smaller, softer edges)
 * @property {number} [method=6] - Compression method 0 (fast) - 6 (best/slowest)
 */

/**
 * Convert an animated GIF to an animated WebP (smaller, same frames/timing).
 * Reuses the palette-optimized GIF produced by convertToGif so the two outputs
 * stay frame-identical.
 * @param {string} inputPath - Path to input GIF
 * @param {string} outputPath - Path to output WebP
 * @param {WebpOptions} options
 */
export function convertGifToWebp(inputPath, outputPath, options = {}) {
  const { quality = 75, lossy = false, method = 6 } = options;

  if (!checkGif2webp()) {
    throw new Error(
      'gif2webp is not installed. Install it with: brew install webp (macOS) or apt-get install webp (Ubuntu)'
    );
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // -mixed lets gif2webp pick lossy/lossless per frame; -lossy forces lossy.
  const mode = lossy ? '-lossy' : '-mixed';
  const cmd = `gif2webp ${mode} -q ${quality} -m ${method} "${inputPath}" -o "${outputPath}"`;
  execSync(cmd, { stdio: 'pipe' });

  return {
    input: inputPath,
    output: outputPath,
    size: fs.statSync(outputPath).size,
  };
}

/**
 * Batch convert all video files in a directory
 * @param {string} inputDir - Directory containing video files
 * @param {string} outputDir - Directory for output GIFs
 * @param {ConversionOptions} options
 */
export async function batchConvertVideos(inputDir, outputDir, options = {}) {
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Find all video files
  const videoExtensions = ['.webm', '.mp4', '.mov', '.avi'];
  const files = fs.readdirSync(inputDir).filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return videoExtensions.includes(ext);
  });

  const results = [];

  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputFile = file.replace(/\.\w+$/, '.gif');
    const outputPath = path.join(outputDir, outputFile);

    try {
      console.log(`Converting: ${file} -> ${outputFile}`);
      const result = await convertToGif(inputPath, outputPath, options);
      results.push({ status: 'success', ...result });
    } catch (error) {
      console.error(`Failed to convert ${file}:`, error.message);
      results.push({
        status: 'error',
        input: inputPath,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Friendly output names for known animation tests. Playwright truncates the
 * artifact directory (inserting a hash), so the old `.anim.js-` marker no longer
 * survives — we match on the test title, which is preserved at the tail of the
 * dir name (e.g. `...-radar-sweep-desktop`).
 */
const ANIMATION_NAME_MAP = [
  { match: 'agent-conversation', name: 'assistant-conversation' },
  { match: 'radar-sweep', name: 'cannonball-radar-sweep' },
  { match: 'threat-detection', name: 'cannonball-threat-detection' },
  { match: 'threat-approach', name: 'cannonball-threat-approach' },
  { match: 'pattern-detection', name: 'cannonball-pattern-detection' },
];

/**
 * Derive a stable, readable, collision-free output name for an animation video.
 * @param {string} videoPath - Full path to the .webm recording
 * @param {Set<string>} usedNames - Names already taken this run (mutated)
 * @returns {string}
 */
export function deriveAnimationName(videoPath, usedNames = new Set()) {
  const parts = videoPath.split(path.sep);
  const dir = parts[parts.length - 2] || 'animation';

  let base = ANIMATION_NAME_MAP.find((e) => dir.includes(e.match))?.name;
  if (!base) {
    // Fallback: clean the Playwright artifact dir — drop the leading
    // `animations-`/`screenshots-` prefix, the trailing viewport, and the
    // inserted truncation hash — then sanitize.
    base = dir
      .replace(/^(animations|screenshots)-/, '')
      .replace(/-(desktop|tablet|mobile|chromium)$/, '')
      .replace(/-[0-9a-f]{5}-/, '-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'animation';
  }

  // Guarantee uniqueness so two videos never overwrite each other.
  let name = base;
  let n = 2;
  while (usedNames.has(name)) {
    name = `${base}-${n++}`;
  }
  usedNames.add(name);
  return name;
}

/**
 * Convert animation test recordings to GIFs
 * This is the main entry point for the docs:animations:convert script
 */
export async function convertAnimationRecordings() {
  const inputDir = path.join(process.cwd(), 'e2e/docs/output');
  // Committed docs live at the repo root (../docs/screenshots), same target
  // generate-index.js scans — NOT web/docs.
  const outputDir = path.join(process.cwd(), '..', 'docs/screenshots/animations');

  console.log('Converting animation recordings to GIFs...');
  console.log(`Input directory: ${inputDir}`);
  console.log(`Output directory: ${outputDir}`);

  // Find all video files in test-results subdirectories
  const findVideos = (dir, videos = []) => {
    if (!fs.existsSync(dir)) return videos;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findVideos(fullPath, videos);
      } else if (entry.name.endsWith('.webm')) {
        videos.push(fullPath);
      }
    }

    return videos;
  };

  // Only convert recordings from animation tests (.anim.js → artifact dir
  // prefixed `animations-`). Screenshot tests (.doc.js) also record video with
  // `video: 'on'`, but turning a static screenshot into a GIF is just noise.
  const videos = findVideos(inputDir).filter((v) => {
    const parent = v.split(path.sep).slice(-2, -1)[0] || '';
    return parent.startsWith('animations-');
  });
  console.log(`Found ${videos.length} animation video files`);

  if (videos.length === 0) {
    console.log('No animation videos to convert. Run docs:animations first.');
    return [];
  }

  const webpAvailable = checkGif2webp();
  if (!webpAvailable) {
    console.warn('gif2webp not found — skipping animated WebP output (GIF only).');
    console.warn('Install it with: brew install webp (macOS) or apt-get install webp (Ubuntu)');
  }

  const results = [];
  const webpResults = [];
  const usedNames = new Set();

  for (const videoPath of videos) {
    const outputName = deriveAnimationName(videoPath, usedNames);
    const outputPath = path.join(outputDir, `${outputName}.gif`);

    try {
      console.log(`Converting: ${path.basename(videoPath)} -> ${outputName}.gif`);
      const result = await convertToGif(videoPath, outputPath, {
        fps: 15,
        width: 800,
        optimize: true,
      });
      results.push({ status: 'success', ...result });

      // Also emit an animated WebP (smaller, frame-identical to the GIF).
      if (webpAvailable) {
        const webpPath = outputPath.replace(/\.gif$/, '.webp');
        try {
          console.log(`  → webp: ${path.basename(webpPath)}`);
          const webpResult = convertGifToWebp(outputPath, webpPath, { quality: 80 });
          webpResults.push({ status: 'success', ...webpResult });
        } catch (error) {
          console.error(`  Failed to convert to webp:`, error.message);
          webpResults.push({ status: 'error', input: outputPath, error: error.message });
        }
      }
    } catch (error) {
      console.error(`Failed to convert:`, error.message);
      results.push({
        status: 'error',
        input: videoPath,
        error: error.message,
      });
    }
  }

  // Print summary
  const successful = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'error');

  console.log('\n--- Conversion Summary ---');
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (successful.length > 0) {
    const totalSize = successful.reduce((sum, r) => sum + r.size, 0);
    console.log(`Total GIF size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  }

  const webpOk = webpResults.filter((r) => r.status === 'success');
  if (webpOk.length > 0) {
    const totalWebp = webpOk.reduce((sum, r) => sum + r.size, 0);
    console.log(`WebP written: ${webpOk.length}  (${(totalWebp / 1024 / 1024).toFixed(2)} MB)`);
  }

  return results;
}

// CLI entry point
if (process.argv[1].includes('gif-converter')) {
  convertAnimationRecordings()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
