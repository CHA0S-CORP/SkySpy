# Map Components

The map/ directory contains the main radar/map view and its sub-components.

## WARNING: MapView.jsx has NO test coverage

`MapView.jsx` is ~2,855 lines (down from 12,240) with zero tests. Changes to this file cannot be validated automatically. Test manually in the browser after any modification.

## MapView.jsx Decomposition (Phases 1-6)

MapView was decomposed from 12,240 lines to ~2,855 lines (77% reduction) across 6 phases:

1. **Phase 1** — Wired existing popup components (METAR, PIREP, Navaid, Airport, Airspace, Sigmet)
2. **Phase 2** — Extracted data hooks (alarms, safety events, ACARS)
3. **Phase 3** — Extracted inline JSX panels (overlays, filters, legend, aircraft list, selected aircraft, ACARS)
4. **Phase 4** — Decomposed canvas draw() into pure functions in `utils/draw/`
5. **Phase 5** — Extracted Leaflet map + canvas click handlers
6. **Phase 6** — Extracted remaining hooks and components (track history, profile canvases, terrain, URL hash, container mouse, canvas draw orchestrator, mobile header, map controls, simple radar view, pro pan, photo fetch)

### Current MapView Structure (~2,855 lines)

| Section | Lines | Description |
|---------|------:|-------------|
| Imports | ~73 | Module imports |
| Props + state | ~660 | ~45 useState declarations, hook calls |
| Effects + callbacks | ~990 | Remaining effects, URL sync, filtering |
| JSX return | ~1,132 | Component composition (most rendering delegated) |

## Extracted Hooks (`hooks/`)

| File | Lines | Purpose |
|------|------:|---------|
| `useCanvasDraw.js` | 585 | CRT/Pro canvas animation loop + event handlers (resize, wheel, pinch) |
| `useLeafletMap.js` | 384 | Leaflet map setup, markers, polylines |
| `useAviationDataFetch.js` | ~400 | Aviation data + overlay GeoJSON fetching |
| `useProfileCanvases.js` | 387 | Altitude, speed, VS, distance profile canvas drawing |
| `useTrackHistory.js` | 323 | Track position history accumulation + short tracks |
| `useProKeyboardShortcuts.js` | 212 | Pro/CRT mode keyboard shortcuts |
| `useContainerMouseHandlers.js` | ~200 | Cursor tracking, hover, range control |
| `usePopupDrag.js` | 202 | Popup, legend, list drag handlers |
| `useProPan.js` | 194 | Pro mode pan state, middle-button pan, aircraft following |
| `usePhotoFetch.js` | 108 | Aircraft photo fetching (WS + HTTP fallback) |
| `useTerrainOverlays.js` | ~150 | Terrain GeoJSON data fetching |
| `useUrlHashSync.js` | ~160 | URL hash params sync on mount |
| `usePlaybackMode.js` | — | Track playback mode state |
| `useDataBlockPositions.js` | — | Data block positioning and dragging |
| `useMapAlarms.js` | — | Conflict/emergency audio alarms |
| `useSafetyEvents.js` | — | Safety events fetching and monitoring |
| `useMapAcarsData.js` | — | ACARS data management |
| `useAviationOverlays.js` | — | Aviation overlay data fetching |
| `useMapPanels.js` | — | Panel visibility state |
| `useMapSettings.js` | — | Map configuration persistence |
| `useMapAircraftSelection.js` | — | Aircraft selection logic |
| `useMapAircraftNotes.js` | — | Per-aircraft note management |
| `useMapScopeLayout.js` | — | Multi-scope layout management |

## Extracted Draw Functions (`utils/draw/`)

Pure rendering functions: `drawGrid.js`, `drawAircraft.js`, `drawOverlays.js`, `drawTracks.js`, `drawConflicts.js`, `drawMeasurements.js`, `drawEffects.js`. Signature pattern: `(ctx, geo, data) => void`.

## Extracted Components (`components/`)

| File | Lines | Purpose |
|------|------:|---------|
| `SafetyBanner.jsx` | 293 | Safety event banner with severity classes |
| `MobileMapHeader.jsx` | 175 | Mobile search + controls dropdown |
| `MapControlsBar.jsx` | 133 | Map controls bar (filters, layers, trails, mute, fullscreen) |
| `SimpleRadarView.jsx` | 71 | Simple radar mode with aircraft blips |
| `OverlayMenuPanel.jsx` | — | Pro overlay settings panel |
| `FilterMenuPanel.jsx` | — | Traffic filter panel |
| `InlineLegendPanel.jsx` | — | Symbol legend panel |
| `AircraftListInline.jsx` | — | Aircraft list panel |
| `SelectedAircraftPanel.jsx` | — | Selected aircraft popup |
| `AcarsInlinePanel.jsx` | — | ACARS messages panel |
| `popups/` | — | METAR, PIREP, Navaid, Airport, Airspace, Sigmet, TAF popups |

## Canvas Click Handlers (`utils/canvasClickHandlers.js`)

Pure functions for canvas click/double-click hit testing: `handleCanvasClick`, `handleCanvasDoubleClick`.

## Safety-Critical Components (need tests)

- **ConflictBanner.jsx** — Displays TCAS conflict alerts. Three severity levels with audio alarms. Bugs here = missed safety alerts in the UI.
- **SafetyEventsPanel.jsx** — Shows emergency squawk events (7500/7600/7700). Must always render when safety events exist.
