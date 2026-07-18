# Documentation Screenshot Automation

This directory contains Playwright tests that generate screenshots and animated GIFs for SkySpy documentation.

## Quick Start

```bash
# From web/ directory

# Generate desktop screenshots only
npm run docs:screenshots

# Generate screenshots for all viewports (desktop, tablet, mobile)
npm run docs:screenshots:all

# Record animations (outputs webm videos)
npm run docs:animations

# Convert recorded videos to GIFs
npm run docs:animations:convert

# Embed the generated images into README.md + docs/*.md (marker comments)
npm run docs:embed

# Full pipeline: screenshots + animations + conversion + index + embed
npm run docs:generate
```

## Prerequisites

- **ffmpeg** is required for video-to-GIF conversion
  - macOS: `brew install ffmpeg`
  - Ubuntu: `apt-get install ffmpeg`
  - Windows: `choco install ffmpeg`

## Directory Structure

```
e2e/docs/
├── playwright.docs.config.js   # Playwright config for docs
├── fixtures/
│   ├── doc-test-setup.js       # Extended fixtures with curated mock data
│   ├── screenshot-state.js     # Deterministic state (fixed timestamps)
│   └── animation-helpers.js    # Animation simulation utilities
├── screenshots/                # Static screenshot specs
│   ├── map-view.doc.js
│   ├── aircraft-list.doc.js
│   ├── stats-view.doc.js
│   ├── analytics-view.doc.js
│   ├── history-view.doc.js
│   ├── alerts-view.doc.js
│   ├── audio-view.doc.js
│   ├── system-view.doc.js
│   ├── assistant-view.doc.js
│   ├── admin-view.doc.js
│   ├── login-view.doc.js
│   ├── cannonball-mode.doc.js
│   ├── airframe-detail.doc.js
│   └── safety-event.doc.js
├── animations/                 # Animation capture specs
│   ├── map-interactions.anim.js
│   ├── cannonball-threats.anim.js
│   ├── history-replay.anim.js
│   ├── audio-playback.anim.js
│   └── conflict-analysis.anim.js
├── utils/
│   ├── screenshot-manager.js   # Screenshot capture utilities
│   ├── gif-converter.js        # ffmpeg wrapper for webm → GIF
│   ├── generate-index.js       # Creates index.json manifest
│   └── embed-screenshots.js    # Injects images into README.md + docs/*.md
└── output/                     # Generated assets (gitignored)
```

## Output

Screenshots and GIFs are saved to:
- `e2e/docs/output/` - Raw Playwright output (gitignored)
- `docs/screenshots/` - Final organized output (committed — referenced by the docs)

Final structure:
```
docs/screenshots/
├── desktop/           # 1920x1080 @2x screenshots
├── tablet/            # iPad viewport screenshots
├── mobile/            # iPhone 12 viewport screenshots
├── animations/        # Animated GIFs
└── index.json         # Asset manifest
```

## Screenshot Coverage

| View | Screenshots | Animations |
|------|-------------|------------|
| Map | overview, popup, overlays, filters, controls | pan-zoom, aircraft-movement |
| Aircraft List | table, filters, sorted, expanded | - |
| Stats | dashboard, cards, charts | - |
| Analytics | overview, geographic | - |
| History | sessions, sightings, safety, replay | replay-controls, timeline-scrub |
| Alerts | rules, builder, conditions, history | - |
| Audio | list, filters, playback, transcript | waveform, transmission-stream |
| System | overview, services | - |
| Assistant | overview | - |
| Admin | overview | - |
| Login | form | - |
| Cannonball | HUD, radar, threats, settings | threat-detection, radar-sweep |
| Airframe Detail | overview, tabs, telemetry | - |
| Safety Event | map, timeline, analysis | conflict-escalation |

## Naming Convention

- Static: `{view}-{feature}.png` (e.g., `map-aircraft-popup.png`)
- Animated: `{view}-{action}.gif` (e.g., `cannonball-threat-detection.gif`)

The leading `{view}` token (everything before the first `-`) is how assets are
grouped in `index.json` (`byView`) and matched to markdown markers — so keep it
stable (`map`, `aircraft`, `stats`, `analytics`, `history`, `audio`, `alerts`,
`system`, `assistant`, `admin`, `login`, `cannonball`, `airframe`, `safety`).

## Embedding into Markdown

`npm run docs:embed` (part of `docs:generate`) rewrites the region between
marker comments in `README.md` and the `docs/*.md` guides:

```markdown
<!-- SCREENSHOTS:map:START -->
...auto-generated ![](…) blocks — do not edit…
<!-- SCREENSHOTS:map:END -->
```

- It reads `docs/screenshots/index.json`, so run `docs:index` (or the full
  `docs:generate`) first.
- Only the `desktop` captures are embedded inline; tablet/mobile are committed
  and noted beneath each block.
- The step is **idempotent** — only the marker regions change. To add a page to
  a doc, drop a `START/END` marker pair for its view anywhere in that file.
- The committed PNGs under `docs/screenshots/{desktop,tablet,mobile}/` are what
  render on GitHub — regenerate and commit them whenever the UI changes.

## Customization

### Adding New Screenshots

1. Create a new `.doc.js` file in `screenshots/`
2. Use the `test` fixture from `doc-test-setup.js`
3. Call `screenshot.capture()` with a unique name

```javascript
import { test } from '../fixtures/doc-test-setup.js';

test.describe('My View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();
    await page.goto('/#myview');
  });

  test('my-feature', async ({ screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();
    await screenshotHelper.capture('myview-feature', {
      description: 'Description for index.json',
    });
  });
});
```

### Adding New Animations

1. Create a new `.anim.js` file in `animations/`
2. Use `animationHelpers` for simulating dynamic behavior
3. Videos are automatically recorded and converted to GIFs

```javascript
import { test } from '../fixtures/doc-test-setup.js';

test('my-animation', async ({ page, animationHelpers }) => {
  await animationHelpers.startRecording();

  // Perform animated actions
  await animationHelpers.animateMapPan({ ... });

  await animationHelpers.stopRecording();
});
```

## Mock Data

The `docMockData` object in `doc-test-setup.js` provides curated data for visually interesting screenshots:

- 15 aircraft with diverse types (commercial, military, emergency)
- ACARS messages with realistic content
- Safety events including TCAS alerts
- Cannonball threats with various threat levels
- Audio transmissions with transcripts

## Troubleshooting

### Screenshots look different on CI

- The config uses `deviceScaleFactor: 2` for crisp output
- Fixed timestamps prevent date/time drift
- Dynamic elements are masked automatically

### GIF conversion fails

- Ensure ffmpeg is installed and in PATH
- Check disk space for temporary palette files
- Videos are in `.webm` format in `output/` subdirectories

### Tests time out

- Increase `timeout` in `playwright.docs.config.js`
- Map screenshots need tile loading time
- Animation tests need recording buffer time
