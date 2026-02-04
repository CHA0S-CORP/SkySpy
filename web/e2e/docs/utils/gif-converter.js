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
 * Convert animation test recordings to GIFs
 * This is the main entry point for the docs:animations:convert script
 */
export async function convertAnimationRecordings() {
  const inputDir = path.join(process.cwd(), 'e2e/docs/output');
  const outputDir = path.join(process.cwd(), 'docs/screenshots/animations');

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

  const videos = findVideos(inputDir);
  console.log(`Found ${videos.length} video files`);

  if (videos.length === 0) {
    console.log('No videos to convert. Run docs:animations first.');
    return [];
  }

  const results = [];

  for (const videoPath of videos) {
    // Extract animation name from path
    // e.g., .../test-cannonball-threats-anim-Cannonball-Threat-Detection/.../video.webm
    const parts = videoPath.split(path.sep);
    const testDir = parts.find((p) => p.includes('.anim.'));

    let outputName = 'animation';
    if (testDir) {
      // Extract meaningful name from test directory
      outputName = testDir
        .replace(/\.anim\.js-/, '-')
        .replace(/-chromium$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-');
    }

    const outputPath = path.join(outputDir, `${outputName}.gif`);

    try {
      console.log(`Converting: ${path.basename(videoPath)} -> ${outputName}.gif`);
      const result = await convertToGif(videoPath, outputPath, {
        fps: 15,
        width: 800,
        optimize: true,
      });
      results.push({ status: 'success', ...result });
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
