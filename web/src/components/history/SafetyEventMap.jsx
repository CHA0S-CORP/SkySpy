import React from 'react';
import { Play, Pause, SkipBack, SkipForward, AlertTriangle } from 'lucide-react';
import { MiniGraph } from './MiniGraph';

/**
 * Map and replay controls for a safety event
 */
export function SafetyEventMap({
  eventKey,
  event,
  trackData,
  replayState,
  graphZoomState,
  onInitializeMap,
  onReplayChange,
  onTogglePlay,
  onSkipToStart,
  onSkipToEnd,
  onSpeedChange,
  onJumpToEvent,
  onGraphWheel,
  onGraphDragStart,
  onGraphDragMove,
  onGraphDragEnd,
  onResetGraphZoom,
  getReplayTimestamp,
  onSelectAircraft
}) {
  const state = replayState[eventKey];

  return (
    <div className="safety-event-map-container">
      <div
        className="safety-event-map"
        ref={(el) => {
          if (el) {
            setTimeout(() => onInitializeMap(eventKey, event, el), 50);
          }
        }}
      />

      {/* Flight data graphs */}
      <div className="flight-graphs">
        {[event.icao, event.icao_2].filter(Boolean).map((icao, idx) => {
          const track = trackData[icao];
          if (!track || track.length < 2) return null;
          const color = idx === 0 ? '#00ff88' : '#44aaff';
          const position = state?.position ?? 100;
          return (
            <div key={icao} className="aircraft-graphs">
              <div className="graphs-header" style={{ color }}>
                {event[idx === 0 ? 'callsign' : 'callsign_2'] || icao}
              </div>
              <div className="graphs-row">
                <MiniGraph
                  track={track}
                  dataKey="altitude"
                  color={color}
                  label="Altitude"
                  unit="ft"
                  positionPercent={position}
                  eventKey={eventKey}
                  graphZoomState={graphZoomState}
                  onWheel={onGraphWheel}
                  onDragStart={onGraphDragStart}
                  onDragMove={onGraphDragMove}
                  onDragEnd={onGraphDragEnd}
                  onResetZoom={onResetGraphZoom}
                />
                <MiniGraph
                  track={track}
                  dataKey="gs"
                  color={color}
                  label="Speed"
                  unit="kts"
                  formatFn={v => v?.toFixed(0)}
                  positionPercent={position}
                  eventKey={eventKey}
                  graphZoomState={graphZoomState}
                  onWheel={onGraphWheel}
                  onDragStart={onGraphDragStart}
                  onDragMove={onGraphDragMove}
                  onDragEnd={onGraphDragEnd}
                  onResetZoom={onResetGraphZoom}
                />
                <MiniGraph
                  track={track}
                  dataKey="vr"
                  color={color}
                  label="V/S"
                  unit="fpm"
                  formatFn={v => (v > 0 ? '+' : '') + v}
                  positionPercent={position}
                  eventKey={eventKey}
                  graphZoomState={graphZoomState}
                  onWheel={onGraphWheel}
                  onDragStart={onGraphDragStart}
                  onDragMove={onGraphDragMove}
                  onDragEnd={onGraphDragEnd}
                  onResetZoom={onResetGraphZoom}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Replay controls */}
      <div className="replay-controls">
        <div className="replay-buttons">
          <button
            className="replay-btn"
            onClick={() => onSkipToStart(eventKey, event)}
            title="Skip to start"
          >
            <SkipBack size={16} />
          </button>
          <button
            className="replay-btn play-btn"
            onClick={() => onTogglePlay(eventKey, event)}
            title={state?.isPlaying ? 'Pause' : 'Play'}
          >
            {state?.isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            className="replay-btn"
            onClick={() => onSkipToEnd(eventKey, event)}
            title="Skip to end"
          >
            <SkipForward size={16} />
          </button>
          <button
            className="replay-btn event-btn"
            onClick={() => onJumpToEvent(eventKey, event)}
            title="Jump to event"
          >
            <AlertTriangle size={14} />
          </button>
          <select
            className="speed-select"
            value={state?.speed || 1}
            onChange={(e) => onSpeedChange(eventKey, parseFloat(e.target.value))}
            title="Playback speed"
          >
            <option value={0.25}>0.25x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>
        <div className="replay-slider-container">
          <input
            type="range"
            className="replay-slider"
            min="0"
            max="100"
            value={state?.position || 100}
            onChange={(e) => onReplayChange(eventKey, event, parseFloat(e.target.value))}
          />
          <div className="replay-time">
            {getReplayTimestamp(eventKey, event) || '--:--'}
          </div>
        </div>
      </div>

      <div className="safety-map-legend">
        <div className="legend-item">
          <span className="legend-marker event-marker"></span>
          <span>Event Location</span>
        </div>
        {event.aircraft_snapshot?.lat && (
          <div className="legend-item clickable" onClick={() => onSelectAircraft?.(event.icao)}>
            <span className="legend-marker ac1-marker"></span>
            <span className="legend-callsign">{event.callsign || event.icao}</span>
          </div>
        )}
        {event.aircraft_snapshot_2?.lat && (
          <div className="legend-item clickable" onClick={() => onSelectAircraft?.(event.icao_2)}>
            <span className="legend-marker ac2-marker"></span>
            <span className="legend-callsign">{event.callsign_2 || event.icao_2}</span>
          </div>
        )}
      </div>
    </div>
  );
}
