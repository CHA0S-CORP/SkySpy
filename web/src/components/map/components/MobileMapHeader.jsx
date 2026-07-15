import {
  X,
  Menu,
  Plane,
  Filter,
  Layers,
  Navigation,
  LocateFixed,
  Volume2,
  VolumeX,
} from 'lucide-react';

function MobileMapHeader({
  searchQuery,
  setSearchQuery,
  showMobileControls,
  setShowMobileControls,
  showAircraftList,
  setShowAircraftList,
  showFilterMenu,
  setShowFilterMenu,
  showOverlayMenu,
  setShowOverlayMenu,
  showShortTracks,
  setShowShortTracks,
  soundMuted,
  setSoundMuted,
  config,
  leafletMapRef,
  feederLat,
  feederLon,
  setProPanOffset,
  aircraftCount,
}) {
  return (
    <>
      {/* Mobile Map Header - map controls for mobile devices */}
      <div className="mobile-map-header">
        <input
          type="text"
          className="mobile-search-input"
          placeholder="Search callsign, squawk, ICAO..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="mobile-search-clear"
            onClick={(e) => {
              e.stopPropagation();
              setSearchQuery('');
            }}
          >
            <X size={16} />
          </button>
        )}
        <div className="mobile-header-actions">
          <button
            className={`mobile-header-btn ${showShortTracks ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowShortTracks(!showShortTracks);
            }}
            title="Trails"
          >
            <Navigation size={18} />
          </button>
          <button
            className="mobile-header-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (config.mapMode === 'map' && leafletMapRef.current) {
                leafletMapRef.current.flyTo([feederLat, feederLon], 10, { duration: 1 });
              } else if (config.mapMode === 'pro' || config.mapMode === 'crt') {
                setProPanOffset({ x: 0, y: 0 });
              }
            }}
            title="Center"
          >
            <LocateFixed size={18} />
          </button>
          <button
            className={`mobile-header-btn ${soundMuted ? 'muted' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setSoundMuted(!soundMuted);
            }}
            title={soundMuted ? 'Unmute' : 'Mute'}
          >
            {soundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
        <button
          className={`mobile-menu-btn ${showMobileControls ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowMobileControls(!showMobileControls);
          }}
        >
          {showMobileControls ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Controls Dropdown */}
      {showMobileControls && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className="mobile-controls-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="mobile-controls-grid">
            <button
              className={`mobile-control-item ${showAircraftList ? 'active' : ''}`}
              onClick={() => {
                setShowAircraftList(!showAircraftList);
                setShowMobileControls(false);
              }}
            >
              <Plane size={18} />
              <span>Aircraft ({aircraftCount})</span>
            </button>
            <button
              className={`mobile-control-item ${showFilterMenu ? 'active' : ''}`}
              onClick={() => {
                setShowFilterMenu(!showFilterMenu);
                setShowOverlayMenu(false);
              }}
            >
              <Filter size={18} />
              <span>Filters</span>
            </button>
            <button
              className={`mobile-control-item ${showOverlayMenu ? 'active' : ''}`}
              onClick={() => {
                setShowOverlayMenu(!showOverlayMenu);
                setShowFilterMenu(false);
              }}
            >
              <Layers size={18} />
              <span>Layers</span>
            </button>
            <button
              className={`mobile-control-item ${showShortTracks ? 'active' : ''}`}
              onClick={() => setShowShortTracks(!showShortTracks)}
            >
              <Navigation size={18} />
              <span>Trails</span>
            </button>
            <button
              className="mobile-control-item"
              onClick={() => {
                if (config.mapMode === 'map' && leafletMapRef.current) {
                  leafletMapRef.current.flyTo([feederLat, feederLon], 10, { duration: 1 });
                } else if (config.mapMode === 'pro' || config.mapMode === 'crt') {
                  setProPanOffset({ x: 0, y: 0 });
                }
                setShowMobileControls(false);
              }}
            >
              <LocateFixed size={18} />
              <span>Center</span>
            </button>
            <button
              className={`mobile-control-item ${soundMuted ? 'active muted' : ''}`}
              onClick={() => setSoundMuted(!soundMuted)}
            >
              {soundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              <span>{soundMuted ? 'Unmute' : 'Mute'}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export { MobileMapHeader };
export default MobileMapHeader;
