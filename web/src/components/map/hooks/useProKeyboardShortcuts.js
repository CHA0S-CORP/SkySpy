import { useEffect } from 'react';
import { saveOverlays } from '../../../utils';

/**
 * Keyboard shortcut handler for Pro/CRT radar mode.
 *
 * Only active when `mapMode` is 'pro' or 'crt'. All shortcuts are single-key
 * (some with Shift modifier) and are suppressed when an input is focused.
 *
 * @param {object} options
 * @param {string} options.mapMode - Current map mode ('pro', 'crt', 'map')
 * @param {object} options.state - Read-only state values
 * @param {object} options.actions - State setters and callbacks
 */
export function useProKeyboardShortcuts({ mapMode, state, actions }) {
  useEffect(() => {
    if (mapMode !== 'pro' && mapMode !== 'crt') {
      return () => {};
    }

    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      )
        return;

      const key = e.key.toLowerCase();

      switch (key) {
        case 'r': // Reset view
          actions.animatePanTo(0, 0);
          actions.setFollowingAircraft(null);
          break;
        case 'v': // Toggle velocity/prediction vectors
          actions.setShowPredictionVectors((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-prediction-vectors', String(newVal));
            return newVal;
          });
          break;
        case 'y': // Toggle VS trend triangles (climb/descend)
          actions.setShowVsTrend((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-vs-trend', String(newVal));
            return newVal;
          });
          break;
        case 't': // Toggle trails OR cycle color theme (Shift+T)
          if (e.shiftKey) {
            actions.cycleProTheme();
          } else {
            actions.setShowShortTracks((prev) => {
              const newVal = !prev;
              localStorage.setItem('adsb-show-short-tracks', String(newVal));
              return newVal;
            });
          }
          break;
        case 'g': // Cycle grid opacity (0.3 -> 0.15 -> 0 -> 0.3)
          actions.setGridOpacity((prev) => {
            const newVal = prev > 0.2 ? 0.15 : prev > 0.1 ? 0 : 0.3;
            localStorage.setItem('adsb-pro-grid-opacity', String(newVal));
            return newVal;
          });
          break;
        case 'c': // Toggle conflict visualization
          actions.setShowConflictVisualization((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-conflict-viz', String(newVal));
            return newVal;
          });
          break;
        case 's': // Toggle speed coloring
          actions.setShowSpeedColors((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-speed-colors', String(newVal));
            return newVal;
          });
          break;
        case 'l': // Toggle labels/data blocks
          actions.setShowDataBlocks((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-show-datablocks', String(newVal));
            return newVal;
          });
          break;
        case 'p': // Toggle compass rose
          actions.setShowCompassRose((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-compass-rose', String(newVal));
            return newVal;
          });
          break;
        case '+':
        case '=': // Zoom in (decrease range)
          e.preventDefault();
          actions.setRadarRange((prev) => Math.max(10, prev - 10));
          break;
        case '-': // Zoom out (increase range)
          e.preventDefault();
          actions.setRadarRange((prev) => Math.min(250, prev + 10));
          break;
        case '1': // Quick range preset 10nm
          actions.setRadarRange(10);
          break;
        case '2': // Quick range preset 25nm
          actions.setRadarRange(25);
          break;
        case '3': // Quick range preset 50nm
          actions.setRadarRange(50);
          break;
        case '4': // Quick range preset 100nm
          actions.setRadarRange(100);
          break;
        case '5': // Quick range preset 250nm
          actions.setRadarRange(250);
          break;
        case 'escape': // Clear measurement/selection
          actions.setMeasurementPoints([]);
          if (!state.panelPinned) {
            actions.setSelectedAircraft(null);
          }
          actions.setHoverInfo(null);
          break;
        case 'f': // Toggle quick filter bar OR FPS counter (Shift+F)
          if (e.shiftKey) {
            actions.setShowFpsCounter((prev) => !prev);
          } else {
            actions.toggleQuickFilterBar();
          }
          break;
        case 'h': // Toggle high contrast OR heat map (Shift+H)
          if (e.shiftKey) {
            actions.updateOverlays({ ...state.overlays, heatMap: !state.overlays.heatMap });
          } else {
            actions.setHighContrastMode((prev) => {
              const newVal = !prev;
              localStorage.setItem('adsb-pro-high-contrast', String(newVal));
              return newVal;
            });
          }
          break;
        case 'a': // Toggle altitude-colored trails OR altitude filter panel (Shift+A)
          if (e.shiftKey) {
            actions.setShowAltitudeFilterPanel((prev) => !prev);
          } else {
            actions.setShowAltitudeTrails((prev) => {
              const newVal = !prev;
              localStorage.setItem('adsb-pro-altitude-trails', String(newVal));
              return newVal;
            });
          }
          break;
        case 'm': // Toggle reduced motion OR MSAW (Shift+M)
          if (e.shiftKey) {
            actions.msawToggle();
          } else {
            actions.setReducedMotion((prev) => {
              const newVal = !prev;
              localStorage.setItem('adsb-pro-reduced-motion', String(newVal));
              return newVal;
            });
          }
          break;
        case 'x': // Toggle weather radar overlay
          actions.setOverlays((prev) => {
            const next = { ...prev, radar: !prev.radar };
            saveOverlays(next);
            return next;
          });
          break;
        case 'w': // Toggle watch list panel OR winds aloft overlay (Shift+W)
          if (e.shiftKey) {
            actions.setOverlays((prev) => {
              const next = { ...prev, windsAloft: !prev.windsAloft };
              saveOverlays(next);
              return next;
            });
          } else {
            actions.toggleWatchListPanel();
          }
          break;
        case 'n': // Add selected aircraft to watch list
          if (state.selectedAircraft) {
            actions.toggleWatchList(state.selectedAircraft);
          }
          break;
        case 'j': // Toggle J-rings
          actions.setShowJRings((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-j-rings', String(newVal));
            return newVal;
          });
          break;
        case 'k': // Toggle wake turbulence separation rings
          actions.setShowWakeRings((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-wake-rings', String(newVal));
            return newVal;
          });
          break;
        case 'i': // Toggle session stats panel
          actions.setShowSessionStats((prev) => !prev);
          break;
        case '?': // Show keyboard shortcuts help
          e.preventDefault();
          actions.setShowKeyboardHelp((prev) => !prev);
          break;
        case 'd': // Reset all data block positions to default
          if (state.dataBlockCustomPositionCount > 0) {
            actions.resetAllDataBlockOffsets();
            state.toastContext?.success?.(`Reset ${state.dataBlockCustomPositionCount} data block position(s)`);
          }
          break;
        case ' ': // Space: Toggle play/pause in playback mode
          if (state.isPlayback) {
            e.preventDefault();
            actions.togglePlayPause();
          }
          break;
        case 'arrowleft': // Left arrow: Seek backward in playback mode
          if (state.isPlayback) {
            e.preventDefault();
            actions.skipPlaybackBackward(60);
          }
          break;
        case 'arrowright': // Right arrow: Seek forward in playback mode
          if (state.isPlayback) {
            e.preventDefault();
            actions.skipPlaybackForward(60);
          }
          break;
        case 'arrowup': // Up arrow: Increase playback speed
          if (state.isPlayback) {
            e.preventDefault();
            actions.cyclePlaybackSpeedUp();
          }
          break;
        case 'arrowdown': // Down arrow: Decrease playback speed
          if (state.isPlayback) {
            e.preventDefault();
            actions.cyclePlaybackSpeedDown();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mapMode, state, actions]);
}
