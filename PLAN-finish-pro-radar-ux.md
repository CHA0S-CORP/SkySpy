# Plan: Finish Pro Radar Mode UX Implementation

## Overview

The original PLAN-pro-radar-ux.md is 78% fully implemented (38/49 features), with 9 partial and 2 not implemented. This plan covers the remaining work, organized into parallel work streams that can be executed by agents.

---

## Work Stream A: Quick Fixes (4 items, ~10 min each)

These are small, isolated changes — typically a single condition or prop wiring.

### A1. Fix altitude trail toggle (Phase 2.4)
**File:** `web/src/components/map/MapView.jsx` ~line 6478
**Problem:** Altitude gradient trails are always drawn in pro mode regardless of `showAltitudeTrails` state.
**Fix:** Change the condition from:
```js
if (isPro) {
```
to:
```js
if (isPro && showAltitudeTrails) {
```
When `showAltitudeTrails` is false, trails should fall through to the standard white trail rendering in the `else` branch (~line 6507).

### A2. Wire high contrast shape markers (Phase 7.1)
**File:** `web/src/components/map/MapView.jsx` ~line 6911
**Problem:** Shape rendering code exists (civilian triangle, military diamond, emergency circle+X) at lines 6911-6954, but it only triggers on `highContrastMode`. The `useAccessibility` hook's `shapeMarkers` state is never connected to MapView.
**Fix:** The shape rendering already works when `highContrastMode` is true (H key). The shapes render correctly in high contrast mode. This is actually working as-is — shapes ARE part of high contrast mode. Mark as complete unless we want a separate toggle for shapes independent of high contrast.

### A3. Wire watch list to context menu (Phase 9.1)
**File:** `web/src/components/map/MapView.jsx` ~line 12155-12172
**Problem:** `AircraftContextMenu` accepts `isFavorite` and `onToggleFavorite` props, but MapView never passes them.
**Fix:** Add props to the `AircraftContextMenu` render:
```jsx
isFavorite={isWatched(contextMenuState.aircraft?.hex)}
onToggleFavorite={() => toggleWatchList(contextMenuState.aircraft)}
```

### A4. Use proper wind barbs for METAR airports (Phase 10.3)
**File:** `web/src/components/map/MapView.jsx` ~lines 6033-6042
**Problem:** Airport METAR wind display draws a simple directional line instead of a proper meteorological wind barb. The `drawWindBarb` utility from `web/src/components/map/utils/windBarbs.js` already exists and is used by the winds aloft layer.
**Fix:** Replace the simple line drawing (lines 6033-6042) with a call to the existing `drawWindBarb()` function, passing `metar.wspd` and `metar.wdir`.

---

## Work Stream B: Canvas Rendering Additions (5 items, ~20-30 min each)

These add new visual elements to the canvas using data that already exists in hooks.

### B1. Click-to-center smooth animation (Phase 1.3)
**Files:** `web/src/components/map/MapView.jsx` ~line 9080-9086, `web/src/components/map/hooks/useProPan.js`
**Problem:** Double-click centers instantly with no animation.
**Fix:**
- Add an `animatePanTo(targetX, targetY)` function in `useProPan.js` that uses `requestAnimationFrame` + easeOutCubic to interpolate from current offset to target over ~250ms
- Replace `setProPanOffset({ x: newPanX, y: newPanY })` at MapView line 9085 with `animatePanTo(newPanX, newPanY)`
- Also apply to `resetView` in useProPan.js (animate back to `{0, 0}`)

### B2. CPA X marker and time-to-CPA on canvas (Phase 3.1)
**Files:** `web/src/components/map/MapView.jsx` ~lines 6088-6172, `web/src/utils/cpaCalculation.js`
**Problem:** CPA data (midpoint position, time-to-CPA, distance at CPA) is calculated but not rendered on canvas. Only the connecting line and relative altitude label are drawn.
**Fix:**
- After the midpoint label drawing (~line 6168), add:
  - Project CPA midpoint lat/lon to screen coordinates
  - Draw an "X" marker at CPA point (two crossing lines)
  - Draw time-to-CPA text label (e.g., "CPA 45s") near the X marker
- Wire `_predictedConflicts` from `useConflictProbe` (remove underscore prefix) into the draw function for local conflict data, or enhance the existing backend conflict data rendering

### B3. MSAW visual rendering (Phase 8.2)
**Files:** `web/src/components/map/MapView.jsx` (aircraft drawing area ~line 6895-6954), `web/src/hooks/useMSAW.js`
**Problem:** The `useMSAW` hook computes warnings (alert/warning status per aircraft hex) but the data is **never consumed for any visual rendering**.
**Fix:**
- In the aircraft symbol drawing loop, after drawing the aircraft symbol, check `msaw.getWarning(ac.hex)`:
  - If `status === 'alert'`: draw a pulsing red ring outline around the aircraft (use `Math.sin(Date.now() / 200)` for pulse alpha)
  - If `status === 'warning'`: draw a pulsing yellow ring outline
- Add an MSAW status badge in the UI (e.g., near the cursor readout) showing `msaw.counts.alerts` / `msaw.counts.warnings` when MSAW is enabled
- Skip terrain shading for now (requires DEM elevation data not present in codebase)

### B4. Wake turbulence separation display (Phase 8.4)
**Files:** `web/src/components/map/MapView.jsx`, `web/src/utils/wakeCategories.js`
**Problem:** Wake categories and colors are displayed in data blocks, but no visual separation rings or required separation distances are shown on the scope.
**Fix:**
- Add a FAA wake separation matrix constant (e.g., Super→Heavy: 6nm, Heavy→Large: 5nm, Heavy→Small: 6nm, etc.)
- In the aircraft draw loop, for Heavy (H) and Super (J) category aircraft, draw a dashed circle at the required separation radius (converted via `pixelsPerNm`)
- Color the ring matching the wake category color (red for J, orange for H)
- Only draw when a wake display toggle is enabled (add to existing overlay settings)

### B5. LOD range-based trail simplification (Phase 5.4)
**File:** `web/src/components/map/MapView.jsx` ~lines 6349-6506
**Problem:** Trail simplification is only based on aircraft count (>150), not on radar range.
**Fix:**
- After the existing `lodFactor` calculation (~line 6897), add a trail density factor:
  ```js
  const lodTrailStride = radarRange <= 50 ? 1 : radarRange <= 100 ? 2 : 3;
  ```
- In the trail rendering loop, skip points based on stride: `if (lodTrailStride > 1 && i % lodTrailStride !== 0) continue;`
- Also apply `lodFactor` to `effectiveTrackLength`: at far ranges (>75nm) reduce max trail points

---

## Work Stream C: Feature Additions (3 items, ~30-45 min each)

### C1. Watch list import/export (Phase 9.1)
**Files:** `web/src/hooks/useWatchList.js`, `web/src/components/map/components/WatchListPanel.jsx`
**Fix:**
- In `useWatchList.js`, add:
  - `exportWatchList()` — serialize watch list to JSON, trigger browser download via `Blob` + `URL.createObjectURL`
  - `importWatchList(jsonString)` — parse JSON, validate entries, merge into existing list
- In `WatchListPanel.jsx`, add export/import buttons in the panel header:
  - Export button (Download icon) that calls `exportWatchList()`
  - Import button (Upload icon) with a hidden file input that reads the file and calls `importWatchList()`

### C2. Search regex support (Phase 12.2)
**File:** `web/src/components/map/components/SearchAutocomplete.jsx` ~line 82-89
**Fix:**
- In `searchAircraft()`, detect regex queries (e.g., starts with `/` or contains unescaped regex chars)
- When regex detected, compile a `RegExp` (in try/catch for invalid patterns) and match against fields instead of using `fuzzyScore()`
- Add a small "Regex" indicator/badge in the search input when regex mode is active
- Alternatively, add a regex toggle button next to the search input

### C3. Data tag auto-deconfliction (Phase 14.3)
**Files:** `web/src/components/map/hooks/useDataBlockPositions.js`, `web/src/components/map/MapView.jsx`
**Fix:**
- Add an `autoDeconflict(visibleBlocks)` function that:
  1. Collects bounding rectangles of all visible data blocks
  2. For overlapping pairs, tries 8 positions around the aircraft (N, NE, E, SE, S, SW, W, NW)
  3. Picks the position with least overlap for each conflicting block
  4. Sets the offset via `setOffset()`
- Run on each draw frame (throttled to every ~500ms for performance)
- Only auto-deconflict blocks that haven't been manually repositioned by the user
- Add a toggle for auto-deconfliction in the overlay menu

---

## Work Stream D: Deferred / Out of Scope (4 items)

These require significant external data sources or browser APIs that may not be practical.

### D1. Holding pattern visualization (Phase 11.3) — DEFER
**Reason:** Requires CIFP/ARINC 424 holding fix data (inbound course, turn direction, leg length) which is not available in the codebase. Would need an external data source or manual definition of common holding patterns.
**Future approach:** If desired, start with a small set of manually defined holding patterns for major airports near the feeder, rendered as racetrack shapes.

### D2. Approach path visualization (Phase 11.4) — DEFER
**Reason:** Requires ILS/approach procedure data (final approach course, glideslope angle, waypoint sequences) not present in the codebase. The FAA CIFP dataset is large and complex.
**Future approach:** Start with extended runway centerlines using airport runway data (if available), then add ILS courses for nearby airports.

### D3. Multi-scope detachable windows (Phase 14.1) — DEFER
**Reason:** Requires `window.open()` + `BroadcastChannel` for cross-window state synchronization. Complex to implement reliably across browsers. The existing split-scope layouts (2/4 panes) cover the primary use case.

### D4. True PiP/mini-map overlay (Phase 14.2) — DEFER
**Reason:** The existing multi-scope split layouts can achieve a similar effect (one scope zoomed in, another zoomed out). A true corner overlay PiP would require canvas-in-canvas rendering or the Picture-in-Picture API. Low priority given the split-scope alternative.

---

## Execution Plan

### Parallel Agent Assignments

**Agent 1 — Quick Fixes (Work Stream A):**
- A1: Fix altitude trail toggle
- A3: Wire watch list to context menu
- A4: METAR wind barbs

**Agent 2 — Canvas Rendering (B1-B2):**
- B1: Click-to-center smooth animation
- B2: CPA X marker and time-to-CPA

**Agent 3 — Canvas Rendering (B3-B4):**
- B3: MSAW visual rendering
- B4: Wake turbulence separation display

**Agent 4 — Canvas Rendering + LOD (B5) + Features (C1):**
- B5: LOD range-based trail simplification
- C1: Watch list import/export

**Agent 5 — Features (C2-C3):**
- C2: Search regex support
- C3: Data tag auto-deconfliction

### Not assigned (deferred):
- A2 (shape markers already work via high contrast mode)
- D1-D4 (deferred, need external data or complex APIs)

---

## Summary

| Stream | Items | Effort | Status |
|--------|-------|--------|--------|
| A: Quick Fixes | 3 actionable + 1 already working | ~30 min total | Ready |
| B: Canvas Rendering | 5 items | ~2 hr total | Ready |
| C: Features | 3 items | ~2 hr total | Ready |
| D: Deferred | 4 items | N/A | Deferred |

**Total remaining actionable work: 11 items across 5 parallel agents**
