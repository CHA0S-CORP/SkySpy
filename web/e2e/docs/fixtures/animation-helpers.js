// @ts-check

/**
 * Animation helpers for capturing dynamic documentation content
 *
 * Provides utilities to:
 * - Simulate aircraft movement across the map
 * - Animate threat escalation in Cannonball mode
 * - Simulate real-time data updates
 * - Control replay playback for history view
 */

import { docMockData } from './doc-test-setup.js';

/**
 * Create animation helpers for a page
 * @param {import('@playwright/test').Page} page
 */
export function animationHelpers(page) {
  return {
    /**
     * Simulate aircraft moving across the map
     * @param {Object} options
     * @param {string} options.hex - Aircraft hex code
     * @param {number} options.startLat - Starting latitude
     * @param {number} options.startLon - Starting longitude
     * @param {number} options.endLat - Ending latitude
     * @param {number} options.endLon - Ending longitude
     * @param {number} options.duration - Animation duration in ms
     * @param {number} options.steps - Number of position updates
     */
    async animateAircraftMovement({
      hex,
      startLat,
      startLon,
      endLat,
      endLon,
      duration = 5000,
      steps = 20,
    }) {
      const latStep = (endLat - startLat) / steps;
      const lonStep = (endLon - startLon) / steps;
      const interval = duration / steps;

      for (let i = 0; i <= steps; i++) {
        const lat = startLat + latStep * i;
        const lon = startLon + lonStep * i;

        await page.evaluate(
          ({ hex, lat, lon }) => {
            window.dispatchEvent(
              new CustomEvent('test-aircraft-update', {
                detail: { hex, lat, lon },
              })
            );
          },
          { hex, lat, lon }
        );

        await page.waitForTimeout(interval);
      }
    },

    /**
     * Simulate gradual aircraft appearance on map
     * @param {number} count - Number of aircraft to add
     * @param {number} interval - Interval between additions in ms
     */
    async animateAircraftAppearance(count = 10, interval = 500) {
      const aircraft = docMockData.generateCuratedAircraft().slice(0, count);

      for (let i = 0; i < aircraft.length; i++) {
        await page.evaluate((ac) => {
          window.dispatchEvent(
            new CustomEvent('test-aircraft-add', { detail: ac })
          );
        }, aircraft[i]);

        await page.waitForTimeout(interval);
      }
    },

    /**
     * Simulate threat escalation in Cannonball mode
     * @param {number} duration - Total escalation duration in ms
     */
    async animateThreatEscalation(duration = 8000) {
      const threats = docMockData.generateCuratedCannonballThreats();
      const steps = 4;
      const interval = duration / steps;

      // Start with no threats
      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent('test-cannonball-threats', { detail: { threats: [] } })
        );
      });

      await page.waitForTimeout(interval);

      // Add first threat (info level)
      await page.evaluate((threat) => {
        window.dispatchEvent(
          new CustomEvent('test-cannonball-threats', { detail: { threats: [threat] } })
        );
      }, { ...threats[2], distance_nm: 12, threat_level: 'info' });

      await page.waitForTimeout(interval);

      // Add second threat (warning level)
      const warningThreat = { ...threats[1], distance_nm: 6, threat_level: 'warning' };
      await page.evaluate(({ threats }) => {
        window.dispatchEvent(
          new CustomEvent('test-cannonball-threats', { detail: { threats } })
        );
      }, { threats: [warningThreat, { ...threats[2], distance_nm: 10, threat_level: 'info' }] });

      await page.waitForTimeout(interval);

      // Add critical threat (close approach)
      const criticalThreat = { ...threats[0], distance_nm: 2.5, threat_level: 'critical' };
      await page.evaluate(({ threats }) => {
        window.dispatchEvent(
          new CustomEvent('test-cannonball-threats', { detail: { threats } })
        );
      }, {
        threats: [
          criticalThreat,
          { ...warningThreat, distance_nm: 5 },
          { ...threats[2], distance_nm: 9, threat_level: 'info' },
        ],
      });

      await page.waitForTimeout(interval);
    },

    /**
     * Simulate radar sweep animation
     * @param {number} sweeps - Number of complete sweeps
     * @param {number} sweepDuration - Duration of each sweep in ms
     */
    async animateRadarSweep(sweeps = 2, sweepDuration = 3000) {
      for (let sweep = 0; sweep < sweeps; sweep++) {
        for (let angle = 0; angle < 360; angle += 15) {
          await page.evaluate((angle) => {
            window.dispatchEvent(
              new CustomEvent('test-radar-sweep', { detail: { angle } })
            );
          }, angle);

          await page.waitForTimeout(sweepDuration / 24);
        }
      }
    },

    /**
     * Simulate map pan and zoom animation
     * @param {Object} options
     */
    async animateMapPan({
      startLat = 37.7749,
      startLon = -122.4194,
      endLat = 37.8749,
      endLon = -122.3194,
      startZoom = 10,
      endZoom = 12,
      duration = 3000,
    }) {
      const steps = 30;
      const interval = duration / steps;

      for (let i = 0; i <= steps; i++) {
        const progress = i / steps;
        // Use easing function for smooth animation
        const eased = this._easeInOutCubic(progress);

        const lat = startLat + (endLat - startLat) * eased;
        const lon = startLon + (endLon - startLon) * eased;
        const zoom = startZoom + (endZoom - startZoom) * eased;

        await page.evaluate(
          ({ lat, lon, zoom }) => {
            // @ts-ignore
            if (window.map && typeof window.map.setView === 'function') {
              // @ts-ignore
              window.map.setView([lat, lon], zoom, { animate: false });
            }
          },
          { lat, lon, zoom }
        );

        await page.waitForTimeout(interval);
      }
    },

    /**
     * Simulate conflict analysis animation
     * Shows two aircraft converging, TCAS alert, and resolution
     * @param {number} duration - Total animation duration in ms
     */
    async animateConflictAnalysis(duration = 10000) {
      const steps = 50;
      const interval = duration / steps;

      // Initial positions
      const aircraft1 = {
        hex: 'A12345',
        lat: 37.80,
        lon: -122.45,
        altitude: 25000,
        track: 135,
      };

      const aircraft2 = {
        hex: 'A23456',
        lat: 37.75,
        lon: -122.35,
        altitude: 25000,
        track: 315,
      };

      for (let i = 0; i <= steps; i++) {
        const progress = i / steps;

        // Move aircraft toward each other
        const lat1 = 37.80 - 0.03 * progress;
        const lon1 = -122.45 + 0.05 * progress;
        const lat2 = 37.75 + 0.03 * progress;
        const lon2 = -122.35 - 0.05 * progress;

        // Calculate separation
        const separation = Math.sqrt(
          Math.pow((lat1 - lat2) * 60, 2) + Math.pow((lon1 - lon2) * 60 * 0.8, 2)
        );

        // Trigger TCAS alert when close
        let event = null;
        if (separation < 3 && separation > 2) {
          event = { type: 'tcas_ta', severity: 'warning' };
        } else if (separation < 2) {
          event = { type: 'tcas_ra', severity: 'critical', resolution: 'climb' };
          // Resolution advisory - aircraft 1 climbs
          aircraft1.altitude = 25000 + (2000 * (progress - 0.6) / 0.4);
          aircraft2.altitude = 25000 - (1500 * (progress - 0.6) / 0.4);
        }

        await page.evaluate(
          ({ ac1, ac2, event }) => {
            window.dispatchEvent(
              new CustomEvent('test-conflict-update', {
                detail: { aircraft: [ac1, ac2], event },
              })
            );
          },
          {
            ac1: { ...aircraft1, lat: lat1, lon: lon1 },
            ac2: { ...aircraft2, lat: lat2, lon: lon2 },
            event,
          }
        );

        await page.waitForTimeout(interval);
      }
    },

    /**
     * Simulate audio transmission playback
     * @param {number} duration - Playback duration in ms
     */
    async animateAudioPlayback(duration = 5000) {
      const steps = 50;
      const interval = duration / steps;

      for (let i = 0; i <= steps; i++) {
        const progress = i / steps;

        await page.evaluate((progress) => {
          window.dispatchEvent(
            new CustomEvent('test-audio-progress', { detail: { progress } })
          );
        }, progress);

        await page.waitForTimeout(interval);
      }
    },

    /**
     * Simulate history replay controls
     * @param {number} duration - Replay duration in ms
     */
    async animateHistoryReplay(duration = 6000) {
      const steps = 30;
      const interval = duration / steps;

      // Simulate 1 hour of history
      const startTime = Date.now() - 3600000;
      const endTime = Date.now();

      for (let i = 0; i <= steps; i++) {
        const progress = i / steps;
        const currentTime = startTime + (endTime - startTime) * progress;

        await page.evaluate(({ time, progress }) => {
          window.dispatchEvent(
            new CustomEvent('test-replay-update', {
              detail: { currentTime: time, progress },
            })
          );
        }, { time: currentTime, progress });

        await page.waitForTimeout(interval);
      }
    },

    /**
     * Cubic easing function for smooth animations
     * @param {number} t - Progress (0-1)
     * @returns {number} Eased progress
     */
    _easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },

    /**
     * Wait for animation frame (useful for sync)
     */
    async waitForAnimationFrame() {
      await page.evaluate(() => new Promise(requestAnimationFrame));
    },

    /**
     * Start video recording for animation capture
     * Note: Video is automatically recorded based on config,
     * this is for explicit control within tests
     */
    async startRecording() {
      // Video recording is handled by Playwright config
      // This method can be used for additional setup
      await page.waitForTimeout(500); // Ensure recording has started
    },

    /**
     * Stop and finalize recording
     * The video file path is available in test results
     */
    async stopRecording() {
      await page.waitForTimeout(500); // Ensure all frames are captured
    },
  };
}
