import { Plane, Radio } from 'lucide-react';

function SimpleRadarView({
  sortedAircraft,
  feederPos,
  selectAircraft,
  handleAircraftContextMenu,
  hasAircraftNote,
  getPosition,
}) {
  return (
    <div className="map-overlay">
      <div className="radar-grid">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="radar-ring"
            style={{ width: `${(i + 1) * 20}%`, height: `${(i + 1) * 20}%` }}
          />
        ))}
        <div className="radar-crosshair" />
      </div>

      {/* Feeder location marker */}
      <div
        className="feeder-marker-radar"
        style={{
          left: `${feederPos.x}%`,
          top: `${feederPos.y}%`,
        }}
        title="Feeder Location"
      >
        <Radio size={16} />
      </div>

      <div className="aircraft-blips">
        {sortedAircraft.slice(0, 100).map((ac) => {
          const pos = getPosition(ac.lat, ac.lon);
          return (
            <div
              key={ac.hex}
              className={`aircraft-blip ${ac.military ? 'military' : ''} ${ac.emergency ? 'emergency' : ''}`}
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: `translate(-50%, -50%) rotate(${ac.track || 0}deg)`,
              }}
              onClick={() => selectAircraft(ac)}
              onContextMenu={(e) => handleAircraftContextMenu(e, ac)}
              onKeyDown={(e) => e.key === 'Enter' && selectAircraft(ac)}
              role="button"
              tabIndex={0}
              title={`${ac.flight || ac.hex} - ${ac.alt || '?'}ft${hasAircraftNote(ac.hex) ? ' [Note]' : ''}`}
              aria-label={`Aircraft ${ac.flight || ac.hex}${hasAircraftNote(ac.hex) ? ', has note' : ''}`}
            >
              <Plane size={16} />
              {hasAircraftNote(ac.hex) && (
                <span className="aircraft-note-indicator" title="Has note" aria-hidden="true">
                  *
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { SimpleRadarView };
export default SimpleRadarView;
