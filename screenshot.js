const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const screenshotDir = '/Users/maxwatermolen/source/skyspy/docs/screenshots';

async function recordView(name, setupFn, actionFn, durationMs = 5000) {
  console.log(`Recording: ${name}...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    recordVideo: {
      dir: screenshotDir,
      size: { width: 1400, height: 900 }
    }
  });
  const page = await context.newPage();

  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    if (setupFn) await setupFn(page);
    if (actionFn) await actionFn(page);
    await page.waitForTimeout(durationMs);

  } catch (e) {
    console.log(`Error in ${name}:`, e.message);
  }

  await page.close();

  const video = page.video();
  if (video) {
    const videoPath = await video.path();
    const newPath = path.join(screenshotDir, `${name}.webm`);
    fs.renameSync(videoPath, newPath);
    console.log(`Saved: ${newPath}`);
  }

  await context.close();
  await browser.close();
}

async function enableAllLayers(page) {
  await page.click('button:has(.lucide-layers)');
  await page.waitForTimeout(500);

  const checkboxes = await page.locator('.overlay-menu input[type="checkbox"]').all();
  for (const cb of checkboxes) {
    if (!(await cb.isChecked())) {
      await cb.click();
      await page.waitForTimeout(100);
    }
  }
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

async function clickCanvasAt(page, xPercent, yPercent) {
  const canvas = await page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * xPercent, box.y + box.height * yPercent);
    await page.waitForTimeout(1500);
  }
}

async function main() {
  console.log('Recording screenshots...\n');

  // 1. Map view with all layers
  await recordView('map-view', enableAllLayers, null, 6000);

  // 2. Aircraft detail - click near center where planes cluster
  await recordView('aircraft-detail', enableAllLayers, async (page) => {
    // Try multiple positions to find an aircraft
    await clickCanvasAt(page, 0.5, 0.55);
    // If no panel appeared, try another spot
    const panel = await page.locator('.target-details, .aircraft-popup').first();
    if (!(await panel.isVisible({ timeout: 1000 }).catch(() => false))) {
      await clickCanvasAt(page, 0.45, 0.5);
    }
  }, 6000);

  // 3. Safety banner
  await recordView('safety-banner', enableAllLayers, null, 5000);

  // 4. PIREP popup - PIREPs appear as diamonds, click around map edges
  await recordView('pirep-popup', enableAllLayers, async (page) => {
    // PIREPs are weather reports, often in various locations
    // Try several clicks to find one
    await clickCanvasAt(page, 0.25, 0.3);
    let popup = await page.locator('.pirep-popup').first();
    if (!(await popup.isVisible({ timeout: 500 }).catch(() => false))) {
      await clickCanvasAt(page, 0.7, 0.35);
    }
    if (!(await popup.isVisible({ timeout: 500 }).catch(() => false))) {
      await clickCanvasAt(page, 0.4, 0.25);
    }
    if (!(await popup.isVisible({ timeout: 500 }).catch(() => false))) {
      await clickCanvasAt(page, 0.6, 0.65);
    }
  }, 5000);

  // 5. NavAid popup - NavAids are typically at fixed positions
  await recordView('navaid-popup', enableAllLayers, async (page) => {
    // Try clicking at various positions to find a navaid
    await clickCanvasAt(page, 0.15, 0.5);
    let popup = await page.locator('.navaid-popup').first();
    if (!(await popup.isVisible({ timeout: 500 }).catch(() => false))) {
      await clickCanvasAt(page, 0.8, 0.4);
    }
    if (!(await popup.isVisible({ timeout: 500 }).catch(() => false))) {
      await clickCanvasAt(page, 0.3, 0.7);
    }
    if (!(await popup.isVisible({ timeout: 500 }).catch(() => false))) {
      await clickCanvasAt(page, 0.65, 0.6);
    }
  }, 5000);

  // 6. Stats view
  await recordView('stats-view', null, async (page) => {
    await page.click('button:has-text("Statistics")');
  }, 5000);

  // 7. History view
  await recordView('history-view', null, async (page) => {
    await page.click('button:has-text("History")');
  }, 5000);

  // 8. Alerts view
  await recordView('alerts-view', null, async (page) => {
    await page.click('button:has-text("Alerts")');
  }, 5000);

  // 9. CRT Mode
  await recordView('crt-mode', async (page) => {
    await page.click('button:has(.lucide-settings)');
    await page.waitForTimeout(500);
    await page.selectOption('select', 'crt');
    await page.click('button.btn-primary');
    await page.waitForTimeout(1000);
  }, null, 6000);

  // 10. Settings
  await recordView('settings', null, async (page) => {
    await page.click('button:has(.lucide-settings)');
  }, 4000);

  console.log('\nConverting to GIF...');

  // Convert WebM to GIF
  const { execSync } = require('child_process');
  const files = ['map-view', 'aircraft-detail', 'safety-banner', 'crt-mode', 'alerts-view', 'settings'];
  const staticFiles = ['pirep-popup', 'navaid-popup', 'stats-view', 'history-view'];

  for (const f of files) {
    try {
      console.log(`Converting ${f} to GIF...`);
      execSync(`ffmpeg -y -i "${screenshotDir}/${f}.webm" -vf "fps=10,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "${screenshotDir}/${f}.gif"`, { stdio: 'pipe' });
    } catch (e) {
      console.log(`Error converting ${f}:`, e.message);
    }
  }

  // Static screenshots (PNG) for these
  for (const f of staticFiles) {
    try {
      console.log(`Converting ${f} to PNG...`);
      execSync(`ffmpeg -y -i "${screenshotDir}/${f}.webm" -frames:v 1 "${screenshotDir}/${f}.png"`, { stdio: 'pipe' });
    } catch (e) {
      console.log(`Error converting ${f}:`, e.message);
    }
  }

  console.log('\nAll done!');
}

main().catch(console.error);
