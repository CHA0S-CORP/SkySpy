import React from 'react';
import {
  Search, Clock, MessageCircle, Bell, VolumeX, Filter, Layers,
  Navigation, Activity, Crosshair, Maximize2, Minimize2
} from 'lucide-react';

/**
 * ProSearchBar component - the search bar and header controls for Pro mode
 */
export function ProSearchBar({
  config,
  setConfig,
  searchQuery,
  setSearchQuery,
  soundMuted,
  setSoundMuted,
  showAcarsPanel,
  setShowAcarsPanel,
  showFilterMenu,
  setShowFilterMenu,
  showOverlayMenu,
  setShowOverlayMenu,
  showShortTracks,
  setShowShortTracks,
  showSelectedTrack,
  setShowSelectedTrack,
  selectedAircraft,
  proPanOffset,
  setProPanOffset,
  followingAircraft,
  setFollowingAircraft,
  setHashParams,
  isFullscreen,
  toggleFullscreen,
  acarsStatus,
}) {
  if (config.mapMode !== 'pro') return null;

  return (
    <div className="pro-search-bar">
      <Search size={18} className="search-icon" />
      <input
        type="text"
        placeholder="Search callsign, squawk, or ICAO..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="search-input"
      />
      <div className="pro-header-right">
        <div className="pro-time">
          <Clock size={14} />
          <span>{new Date().toISOString().slice(11, 19)} Z</span>
        </div>
        {acarsStatus && (
          <div className={`acars-status-badge ${acarsStatus.running ? 'running' : 'stopped'}`} title={`ACARS: ${acarsStatus.running ? 'Running' : 'Stopped'}`}>
            <MessageCircle size={12} />
            <span>{acarsStatus.buffer_size || 0}</span>
          </div>
        )}
        <button
          className={`pro-header-btn ${soundMuted ? 'muted' : ''}`}
          onClick={(e) => { e.stopPropagation(); setSoundMuted(!soundMuted); }}
          title={soundMuted ? 'Unmute' : 'Mute'}
        >
          {soundMuted ? <VolumeX size={18} /> : <Bell size={18} />}
        </button>
        <button
          className={`pro-header-btn ${showAcarsPanel ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setShowAcarsPanel(!showAcarsPanel); }}
          title="ACARS Messages"
        >
          <MessageCircle size={18} />
        </button>
        <button
          className={`pro-header-btn ${showFilterMenu ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setShowFilterMenu(!showFilterMenu); setShowOverlayMenu(false); }}
          title="Traffic Filters"
        >
          <Filter size={18} />
        </button>
        <button
          className={`pro-header-btn ${showOverlayMenu ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setShowOverlayMenu(!showOverlayMenu); setShowFilterMenu(false); }}
          title="Map Layers"
        >
          <Layers size={18} />
        </button>
        <button
          className={`pro-header-btn ${showShortTracks ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setShowShortTracks(!showShortTracks); }}
          title={showShortTracks ? 'Hide short tracks (ATC trails)' : 'Show short tracks (ATC trails)'}
        >
          <Navigation size={18} />
        </button>
        {showShortTracks && (
          <div className="pro-track-length-slider" onClick={(e) => e.stopPropagation()}>
            <input
              type="range"
              min="5"
              max="60"
              step="5"
              value={config.shortTrackLength || 15}
              onChange={(e) => setConfig({ ...config, shortTrackLength: parseInt(e.target.value) })}
              title={`Trail length: ${config.shortTrackLength || 15} positions`}
            />
            <span className="track-length-value">{config.shortTrackLength || 15}</span>
          </div>
        )}
        <button
          className={`pro-header-btn ${showSelectedTrack ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setShowSelectedTrack(!showSelectedTrack); }}
          title={showSelectedTrack ? 'Hide flight track' : 'Show flight track'}
          disabled={!selectedAircraft}
        >
          <Activity size={18} />
        </button>
        <button
          className={`pro-header-btn ${proPanOffset.x !== 0 || proPanOffset.y !== 0 || followingAircraft ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setProPanOffset({ x: 0, y: 0 });
            setFollowingAircraft(null);
            if (setHashParams) {
              setHashParams({ panX: undefined, panY: undefined });
            }
          }}
          title="Re-center view (middle-click + drag to pan)"
        >
          <Crosshair size={18} />
        </button>
        <button
          className="pro-header-btn"
          onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
    </div>
  );
}
