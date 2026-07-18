import { useState, useEffect, useMemo, useRef, useCallback } from 'react';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * Hook for managing safety events: fetching, merging WS data, computing active conflicts,
 * alarm monitoring, and emergency squawk notifications.
 */
export function useSafetyEvents({
  wsSafetyEvents,
  wsRequest,
  wsConnected,
  config,
  aircraft,
  alarmHook, // { playConflictAlarm, getHighestSeverity, startAlarmLoop, stopAlarmLoop, sendNotification, acknowledgeEvent, acknowledgedEvents }
}) {
  const [safetyEvents, setSafetyEvents] = useState([]);
  const notifiedConflictsRef = useRef(new Set());
  const notifiedEmergenciesRef = useRef(new Set());
  const autoAckScheduledRef = useRef(new Set());
  const playedLowAlarmRef = useRef(new Set());

  const {
    playConflictAlarm,
    getHighestSeverity,
    startAlarmLoop,
    stopAlarmLoop,
    sendNotification,
    acknowledgeEvent,
    acknowledgedEvents,
  } = alarmHook;

  // Merge WebSocket safety events with local state
  useEffect(() => {
    if (wsSafetyEvents && wsSafetyEvents.length > 0) {
      setSafetyEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const newEvents = wsSafetyEvents.filter((e) => !existingIds.has(e.id));
        if (newEvents.length === 0) return prev;
        return [...newEvents, ...prev].slice(0, 50);
      });
    }
  }, [wsSafetyEvents]);

  // Fetch safety events via WebSocket with HTTP fallback
  useEffect(() => {
    const baseUrl = config.apiBaseUrl || '';

    const fetchSafetyEvents = async () => {
      try {
        let data;
        if (wsRequest && wsConnected) {
          data = await wsRequest('safety-events', { limit: 20 });
        } else {
          const res = await fetch(`${baseUrl}/api/v1/safety/events?limit=20`);
          data = await safeJson(res);
        }
        const events = Array.isArray(data) ? data : data?.data || data?.events || [];
        if (events.length > 0) {
          setSafetyEvents((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const newEvents = events.filter((e) => !existingIds.has(e.id));
            if (newEvents.length === 0) return prev;
            return [...newEvents, ...prev].slice(0, 50);
          });
        }
      } catch (err) {
        console.warn('Safety events fetch failed:', err.message);
      }
    };

    fetchSafetyEvents();
    const pollInterval = wsConnected ? 60000 : 30000;
    const interval = setInterval(fetchSafetyEvents, pollInterval);
    return () => clearInterval(interval);
  }, [wsRequest, wsConnected, config.apiBaseUrl]);

  // Convert safety events to conflict format for display with LIVE separation data.
  // Display window is intentionally wide (10 min) so snapshot-loaded events (which
  // are almost always older than 60s) actually render in the banner/panel. The
  // tight 60s window is reserved for the audible alarm / banner-flash behavior in
  // the alarm-monitoring effect below.
  const DISPLAY_WINDOW_MS = 10 * 60 * 1000;
  const activeConflicts = useMemo(() => {
    const cutoff = Date.now() - DISPLAY_WINDOW_MS;
    return safetyEvents
      .filter((event) => {
        if (acknowledgedEvents.has(event.id)) return false;
        const eventTime = new Date(event.timestamp).getTime();
        // Keep events without a parseable timestamp (fail-open) and anything
        // within the display window.
        return Number.isNaN(eventTime) || eventTime > cutoff;
      })
      .map((event) => {
        let horizontalNm = event.details?.horizontal_nm?.toFixed(1) || '--';
        let verticalFt = event.details?.vertical_ft || event.details?.altitude || '--';

        if (event.icao && event.icao_2) {
          const ac1 = aircraft.find((a) => a.hex?.toLowerCase() === event.icao?.toLowerCase());
          const ac2 = aircraft.find((a) => a.hex?.toLowerCase() === event.icao_2?.toLowerCase());

          if (ac1?.lat && ac1?.lon && ac2?.lat && ac2?.lon) {
            const dLat = (ac2.lat - ac1.lat) * 60;
            const dLon = (ac2.lon - ac1.lon) * 60 * Math.cos((ac1.lat * Math.PI) / 180);
            horizontalNm = Math.sqrt(dLat * dLat + dLon * dLon).toFixed(1);
          }

          if (ac1?.alt && ac2?.alt) {
            verticalFt = Math.round(Math.abs(ac2.alt - ac1.alt));
          }
        } else if (event.icao) {
          const ac = aircraft.find((a) => a.hex?.toLowerCase() === event.icao?.toLowerCase());
          if (ac?.alt) {
            verticalFt = Math.round(ac.alt);
          }
          if (
            event.event_type?.includes('vs') ||
            event.event_type?.includes('descent') ||
            event.event_type?.includes('climb')
          ) {
            const vs = ac?.baro_rate || ac?.geom_rate;
            if (vs !== undefined) {
              verticalFt = `${vs > 0 ? '+' : ''}${Math.round(vs)} fpm`;
            }
          }
        }

        return {
          ...event,
          ac1: event.callsign || event.icao,
          ac2: event.callsign_2 || event.icao_2 || null,
          hex1: event.icao,
          hex2: event.icao_2,
          horizontalNm,
          verticalFt,
        };
      });
  }, [safetyEvents, acknowledgedEvents, aircraft]);

  // Monitor for new safety events and trigger alarms/notifications.
  // Alarms/flash are gated on a tight recency window (60s) so old snapshot events
  // rendered in the banner/panel don't blare an alarm on page load.
  useEffect(() => {
    const alarmCutoff = Date.now() - 60000;
    const unacknowledged = activeConflicts.filter((event) => {
      if (acknowledgedEvents.has(event.id)) return false;
      const eventTime = new Date(event.timestamp).getTime();
      return Number.isNaN(eventTime) || eventTime > alarmCutoff;
    });

    if (unacknowledged.length > 0) {
      const severity = getHighestSeverity(unacknowledged);

      if (severity === 'low') {
        stopAlarmLoop();
        // Only play the double-ding once per event — the effect re-runs on every
        // aircraft position update (activeConflicts is a new array each time)
        const newLowEvents = unacknowledged.filter((e) => !playedLowAlarmRef.current.has(e.id));
        if (newLowEvents.length > 0) {
          newLowEvents.forEach((e) => playedLowAlarmRef.current.add(e.id));
          playConflictAlarm('low');
          setTimeout(() => {
            playConflictAlarm('low');
          }, 1500);
        }

        unacknowledged.forEach((e) => {
          if (e.severity === 'low' && !autoAckScheduledRef.current.has(e.id)) {
            autoAckScheduledRef.current.add(e.id);
            setTimeout(() => {
              acknowledgeEvent(e.id);
            }, 5000);
          }
        });
      } else {
        startAlarmLoop(severity);
      }
    } else {
      stopAlarmLoop();
    }

    activeConflicts.forEach((event) => {
      const eventKey = `safety-${event.id}`;

      if (!notifiedConflictsRef.current.has(eventKey)) {
        notifiedConflictsRef.current.add(eventKey);

        const severityEmoji =
          event.severity === 'critical' ? '🚨' : event.severity === 'warning' ? '⚠️' : '🔔';
        const title = `${severityEmoji} ${event.event_type.replace(/_/g, ' ').toUpperCase()}`;

        sendNotification(
          title,
          event.message || `${event.callsign} - ${event.event_type}`,
          eventKey,
          event.severity === 'critical'
        );
      }
    });

    return () => {
      stopAlarmLoop();
    };
  }, [
    activeConflicts,
    acknowledgedEvents,
    acknowledgeEvent,
    getHighestSeverity,
    playConflictAlarm,
    sendNotification,
    startAlarmLoop,
    stopAlarmLoop,
  ]);

  // Monitor for emergency squawks and send notifications
  useEffect(() => {
    const emergencySquawks = { 7500: 'HIJACK', 7600: 'RADIO FAILURE', 7700: 'EMERGENCY' };

    aircraft.forEach((ac) => {
      const isEmergency = ac.emergency || emergencySquawks[ac.squawk];
      if (!isEmergency) return;

      const emergencyKey = `${ac.hex}-${ac.squawk}`;
      if (!notifiedEmergenciesRef.current.has(emergencyKey)) {
        notifiedEmergenciesRef.current.add(emergencyKey);

        const callsign = ac.flight?.trim() || ac.hex;
        const meaning = emergencySquawks[ac.squawk] || 'EMERGENCY';

        sendNotification(
          `🚨 ${meaning}`,
          `${callsign} squawking ${ac.squawk || 'emergency'}\nAlt: ${ac.alt?.toLocaleString() || '?'}ft`,
          `emergency-${emergencyKey}`,
          true
        );
      }
    });

    const currentEmergencyHexes = new Set(
      aircraft.filter((ac) => ac.emergency || emergencySquawks[ac.squawk]).map((ac) => ac.hex)
    );
    notifiedEmergenciesRef.current.forEach((key) => {
      const hex = key.split('-')[0];
      if (!currentEmergencyHexes.has(hex)) {
        setTimeout(() => notifiedEmergenciesRef.current.delete(key), 600000);
      }
    });
  }, [aircraft, sendNotification]);

  return {
    safetyEvents,
    activeConflicts,
  };
}
