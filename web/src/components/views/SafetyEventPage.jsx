import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AlertTriangle, Radar, Shield, ArrowLeft } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// Extracted components
import { ReplayControls } from '../safety/ReplayControls';
import { CollapsibleSection } from '../common/CollapsibleSection';
import { EventHeader } from '../safety/EventHeader';
import { AircraftCards } from '../safety/AircraftCards';
import { EventMapVisualization } from '../safety/EventMapVisualization';
import { TelemetrySnapshotsContent } from '../safety/TelemetrySnapshot';
import { FlightDataGraphs } from '../safety/FlightDataGraphs';

// Extracted hook
import { useSafetyEventData } from '../../hooks/useSafetyEventData';

// Enhanced slider and animation styles
const sliderStyles = `
  .safety-page-slider::-webkit-slider-thumb {
    -webkit-appearance: none !important;
    appearance: none !important;
    width: 16px !important;
    height: 16px !important;
    background: linear-gradient(135deg, #00d4ff, #00ff88) !important;
    border-radius: 50% !important;
    cursor: pointer !important;
    border: 2px solid rgba(255,255,255,0.9) !important;
    box-shadow: 0 0 20px rgba(0, 212, 255, 0.6), 0 0 40px rgba(0, 212, 255, 0.3) !important;
    transition: transform 0.15s ease, box-shadow 0.15s ease !important;
  }
  .safety-page-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2) !important;
    box-shadow: 0 0 25px rgba(0, 212, 255, 0.8), 0 0 50px rgba(0, 212, 255, 0.4) !important;
  }
  .safety-page-slider::-moz-range-thumb {
    width: 16px !important;
    height: 16px !important;
    background: linear-gradient(135deg, #00d4ff, #00ff88) !important;
    border-radius: 50% !important;
    border: 2px solid rgba(255,255,255,0.9) !important;
    cursor: pointer !important;
    box-shadow: 0 0 20px rgba(0, 212, 255, 0.6) !important;
  }

  @keyframes radarSweep {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  @keyframes pulseGlow {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.05); }
  }

  @keyframes dataStream {
    0% { background-position: 0% 0%; }
    100% { background-position: 100% 100%; }
  }

  @keyframes scanLine {
    0% { transform: translateY(-100%); opacity: 0; }
    50% { opacity: 0.5; }
    100% { transform: translateY(100vh); opacity: 0; }
  }
`;

export function SafetyEventPage({ eventId, apiBase, onClose, onSelectAircraft, wsRequest, wsConnected }) {
  const [replayState, setReplayState] = useState({ position: 100, isPlaying: false, speed: 1 });
  const animationFrameRef = useRef(null);
  const replayControlsRef = useRef(null);
  const flightGraphsRef = useRef(null);

  // Use extracted data hook
  const {
    event,
    loading,
    error,
    trackData,
    acknowledged,
    acknowledging,
    acknowledgeEvent
  } = useSafetyEventData({ eventId, apiBase, wsRequest, wsConnected });

  // Get interpolated position along a track
  const getInterpolatedPosition = useCallback((track, percentage) => {
    if (!track || track.length === 0) return null;
    if (track.length === 1) return { ...track[0], index: 0 };
    const ordered = [...track].reverse();
    const index = Math.floor((percentage / 100) * (ordered.length - 1));
    const clampedIndex = Math.max(0, Math.min(index, ordered.length - 1));
    return { ...ordered[clampedIndex], index: clampedIndex };
  }, []);

  // Handle replay slider change
  const handleReplayChange = useCallback((newPosition) => {
    setReplayState(prev => ({ ...prev, position: newPosition }));
  }, []);

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    const newPlaying = !replayState.isPlaying;
    setReplayState(prev => ({ ...prev, isPlaying: newPlaying }));

    if (newPlaying) {
      let pos = replayState.position <= 0 ? 0 : replayState.position;
      let lastTime = performance.now();

      const animate = (currentTime) => {
        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        const increment = (deltaTime / 200) * replayState.speed;
        pos += increment;

        if (pos >= 100) {
          pos = 100;
          setReplayState(prev => ({ ...prev, position: 100, isPlaying: false }));
          return;
        }

        setReplayState(prev => ({ ...prev, position: pos }));
        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
  }, [replayState]);

  // Skip controls
  const skipToStart = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setReplayState(prev => ({ ...prev, position: 0, isPlaying: false }));
  }, []);

  const skipToEnd = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setReplayState(prev => ({ ...prev, position: 100, isPlaying: false }));
  }, []);

  const jumpToEvent = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setReplayState(prev => ({ ...prev, position: 50, isPlaying: false }));
  }, []);

  // Handle speed change
  const handleSpeedChange = useCallback((newSpeed) => {
    setReplayState(prev => ({ ...prev, speed: newSpeed }));
  }, []);

  // Handle mousewheel on replay controls to scrub through time
  useEffect(() => {
    const handleWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 10 : 2;
      const delta = e.deltaY > 0 ? step : -step;
      setReplayState(prev => {
        const newPosition = Math.max(0, Math.min(100, prev.position + delta));
        return { ...prev, position: newPosition, isPlaying: false };
      });
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };

    const controls = replayControlsRef.current;
    if (controls) controls.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      if (controls) controls.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Get replay timestamp
  const getReplayTimestamp = useMemo(() => {
    if (!event) return null;
    const icao = event.icao || event.icao_2;
    const track = trackData[icao];
    if (!track || track.length === 0) return null;
    const pos = getInterpolatedPosition(track, replayState.position);
    if (!pos?.timestamp) return null;
    return new Date(pos.timestamp).toLocaleTimeString();
  }, [event, trackData, replayState.position, getInterpolatedPosition]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Get severity color
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return '#ff4757';
      case 'warning': return '#ff9f43';
      case 'info': return '#00d4ff';
      default: return '#00d4ff';
    }
  };

  // Get current telemetry values for display
  const getCurrentTelemetry = useCallback((icao) => {
    const track = trackData[icao];
    if (!track || track.length === 0) return null;
    const pos = getInterpolatedPosition(track, replayState.position);
    return pos;
  }, [trackData, replayState.position, getInterpolatedPosition]);

  // Loading state
  if (loading) {
    return (
      <div className="safety-event-page-v2">
        <div className="sep-loading">
          <div className="sep-loading-radar">
            <Radar size={64} className="sep-radar-icon" />
            <div className="sep-radar-sweep" />
          </div>
          <span className="sep-loading-text">Analyzing safety event data...</span>
          <div className="sep-loading-dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !event) {
    return (
      <div className="safety-event-page-v2">
        <div className="sep-error">
          <div className="sep-error-icon">
            <Shield size={64} />
          </div>
          <h2>{error || 'Event not found'}</h2>
          <p>Unable to retrieve safety event data</p>
          <button className="sep-back-btn" onClick={() => { window.location.hash = '#history?data=safety'; onClose?.(); }}>
            <ArrowLeft size={18} /> Return to Safety Events
          </button>
        </div>
      </div>
    );
  }

  const hasSnapshot = event.aircraft_snapshot || event.aircraft_snapshot_2;
  const severityColor = getSeverityColor(event.severity);
  const telem1 = getCurrentTelemetry(event.icao);
  const telem2 = event.icao_2 ? getCurrentTelemetry(event.icao_2) : null;

  return (
    <div className="safety-event-page-v2">
      <style>{sliderStyles}</style>

      {/* Ambient background effects */}
      <div className="sep-ambient">
        <div className="sep-ambient-glow" style={{ '--severity-color': severityColor }} />
        <div className="sep-grid-overlay" />
      </div>

      {/* Top bar with event info */}
      <EventHeader
        event={event}
        eventId={eventId}
        acknowledged={acknowledged}
        acknowledging={acknowledging}
        onAcknowledge={acknowledgeEvent}
        onClose={onClose}
        severityColor={severityColor}
      />

      {/* Main content grid */}
      <div className="sep-main-grid">
        {/* Left column - Event details */}
        <div className="sep-info-column">
          {/* Event message card */}
          <div className="sep-message-card" style={{ '--accent': severityColor }}>
            <div className="sep-message-icon">
              <AlertTriangle size={24} />
            </div>
            <p className="sep-message-text">{event.message}</p>
          </div>

          {/* Aircraft cards */}
          <AircraftCards
            event={event}
            telem1={telem1}
            telem2={telem2}
            onSelectAircraft={onSelectAircraft}
          />

          {/* Telemetry graphs */}
          <FlightDataGraphs
            event={event}
            trackData={trackData}
            replayPosition={replayState.position}
            onPositionChange={handleReplayChange}
            graphsRef={flightGraphsRef}
          />

          {/* Raw telemetry section */}
          {hasSnapshot && (
            <CollapsibleSection
              title="Raw Telemetry Snapshot"
              icon={<Radar size={16} />}
              defaultExpanded={false}
              className="sep-telemetry-section"
            >
              <TelemetrySnapshotsContent
                event={event}
                onSelectAircraft={onSelectAircraft}
              />
            </CollapsibleSection>
          )}
        </div>

        {/* Right column - Map and replay */}
        <div className="sep-map-column">
          <EventMapVisualization
            event={event}
            trackData={trackData}
            replayPosition={replayState.position}
          />

          {/* Timeline/Replay controls */}
          <div ref={replayControlsRef}>
            <ReplayControls
              position={replayState.position}
              isPlaying={replayState.isPlaying}
              speed={replayState.speed}
              currentTime={getReplayTimestamp}
              onPositionChange={handleReplayChange}
              onPlayPause={togglePlay}
              onSkipToStart={skipToStart}
              onSkipToEnd={skipToEnd}
              onJumpToEvent={jumpToEvent}
              onSpeedChange={handleSpeedChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
