import { Moon, Sun, Filter, Layers, Navigation, Volume2, VolumeX, Maximize2, Minimize2 } from 'lucide-react';

function MapControlsBar({
  config,
  setConfig,
  saveConfig,
  showFilterMenu,
  setShowFilterMenu,
  showOverlayMenu,
  setShowOverlayMenu,
  showShortTracks,
  setShowShortTracks,
  soundMuted,
  setSoundMuted,
  isFullscreen,
  toggleDarkMode,
  toggleFullscreen,
  radarRange,
  updateRadarRange,
}) {
  return (
    <div className="map-controls">
      {config.mapMode === 'map' && (
        <>
          <button
            className={`map-control-btn ${config.mapDarkMode ? 'active' : ''}`}
            onClick={toggleDarkMode}
          >
            {config.mapDarkMode ? <Moon size={16} /> : <Sun size={16} />}
            <span>{config.mapDarkMode ? 'Dark' : 'Light'}</span>
          </button>
          <button
            className={`map-control-btn ${showShortTracks ? 'active' : ''}`}
            onClick={() => setShowShortTracks(!showShortTracks)}
            title={showShortTracks ? 'Hide short tracks' : 'Show short tracks (ATC trails)'}
          >
            <Navigation size={16} />
            <span>Trails</span>
          </button>
          {showShortTracks && (
            <div className="track-length-control">
              <input
                type="range"
                min="5"
                max="50"
                value={config.shortTrackLength || 15}
                onChange={(e) => {
                  const newValue = parseInt(e.target.value);
                  setConfig((prev) => {
                    const newConfig = { ...prev, shortTrackLength: newValue };
                    saveConfig(newConfig);
                    return newConfig;
                  });
                }}
                title={`Trail length: ${config.shortTrackLength || 15} positions`}
              />
              <span className="track-length-value">{config.shortTrackLength || 15}</span>
            </div>
          )}
        </>
      )}
      {(config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <>
          <button
            className={`map-control-btn ${showFilterMenu ? 'active' : ''}`}
            onClick={() => {
              setShowFilterMenu(!showFilterMenu);
              setShowOverlayMenu(false);
            }}
          >
            <Filter size={16} />
            <span>Filter</span>
          </button>
          <button
            className={`map-control-btn ${showOverlayMenu ? 'active' : ''}`}
            onClick={() => {
              setShowOverlayMenu(!showOverlayMenu);
              setShowFilterMenu(false);
            }}
          >
            <Layers size={16} />
            <span>Layers</span>
          </button>
          <button
            className={`map-control-btn ${showShortTracks ? 'active' : ''}`}
            onClick={() => setShowShortTracks(!showShortTracks)}
            title={showShortTracks ? 'Hide short tracks' : 'Show short tracks (ATC trails)'}
          >
            <Navigation size={16} />
            <span>Trails</span>
          </button>
          {showShortTracks && (
            <div className="track-length-control">
              <input
                type="range"
                min="5"
                max="50"
                value={config.shortTrackLength || 15}
                onChange={(e) => {
                  const newValue = parseInt(e.target.value);
                  setConfig((prev) => {
                    const newConfig = { ...prev, shortTrackLength: newValue };
                    saveConfig(newConfig);
                    return newConfig;
                  });
                }}
                title={`Trail length: ${config.shortTrackLength || 15} positions`}
              />
              <span className="track-length-value">{config.shortTrackLength || 15}</span>
            </div>
          )}
        </>
      )}
      <button
        className={`map-control-btn sound-mute-btn ${soundMuted ? 'muted' : ''}`}
        onClick={() => setSoundMuted(!soundMuted)}
        title={soundMuted ? 'Unmute alerts' : 'Mute alerts'}
      >
        {soundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      <button
        className="map-control-btn"
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      >
        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
    </div>
  );
}

export { MapControlsBar };
export default MapControlsBar;
