import React from 'react';
import { X, HelpCircle, Compass } from 'lucide-react';

/**
 * OverlayMenu component - map layers/overlays configuration menu
 */
export function OverlayMenu({
  config,
  showOverlayMenu,
  setShowOverlayMenu,
  overlays,
  updateOverlays,
  // Pro mode display settings
  proTheme,
  setProTheme,
  showCompassRose,
  setShowCompassRose,
  gridOpacity,
  setGridOpacity,
  showDataBlocks,
  setShowDataBlocks,
  showPredictionVectors,
  setShowPredictionVectors,
  showSpeedColors,
  setShowSpeedColors,
  showAltitudeTrails,
  setShowAltitudeTrails,
  showConflictVisualization,
  setShowConflictVisualization,
  // Data block config
  dataBlockConfig,
  setDataBlockConfig,
  // Layer opacities
  layerOpacities,
  setLayerOpacities,
  saveLayerOpacities,
  // Legend
  showLegend,
  setShowLegend,
}) {
  if (!showOverlayMenu) return null;

  return (
    <div className="overlay-menu" onClick={(e) => e.stopPropagation()}>
      <div className="overlay-menu-header">
        <span>Map Layers</span>
        <button onClick={() => setShowOverlayMenu(false)}><X size={14} /></button>
      </div>

      <label className="overlay-toggle">
        <input
          type="checkbox"
          checked={overlays.aircraft}
          onChange={() => updateOverlays({ ...overlays, aircraft: !overlays.aircraft })}
        />
        <span className="toggle-label">Aircraft</span>
      </label>

      <div className="overlay-divider" />

      <label className="overlay-toggle">
        <input
          type="checkbox"
          checked={overlays.vors}
          onChange={() => updateOverlays({ ...overlays, vors: !overlays.vors })}
        />
        <span className="toggle-label">VORs & NAVAIDs</span>
      </label>

      <label className="overlay-toggle">
        <input
          type="checkbox"
          checked={overlays.airports}
          onChange={() => updateOverlays({ ...overlays, airports: !overlays.airports })}
        />
        <span className="toggle-label">Airports</span>
      </label>

      <label className="overlay-toggle">
        <input
          type="checkbox"
          checked={overlays.airspace}
          onChange={() => updateOverlays({ ...overlays, airspace: !overlays.airspace })}
        />
        <span className="toggle-label">Airspace</span>
      </label>

      <label className="overlay-toggle">
        <input
          type="checkbox"
          checked={overlays.metars}
          onChange={() => updateOverlays({ ...overlays, metars: !overlays.metars })}
        />
        <span className="toggle-label">METARs (Weather)</span>
      </label>

      <label className="overlay-toggle">
        <input
          type="checkbox"
          checked={overlays.pireps}
          onChange={() => updateOverlays({ ...overlays, pireps: !overlays.pireps })}
        />
        <span className="toggle-label">PIREPs</span>
      </label>

      {config.mapMode === 'pro' && (
        <>
          <div className="overlay-divider" />
          <div className="overlay-section-title">Terrain Context</div>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.countries}
              onChange={() => updateOverlays({ ...overlays, countries: !overlays.countries })}
            />
            <span className="toggle-label">Countries</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.states}
              onChange={() => updateOverlays({ ...overlays, states: !overlays.states })}
            />
            <span className="toggle-label">States</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.counties}
              onChange={() => updateOverlays({ ...overlays, counties: !overlays.counties })}
            />
            <span className="toggle-label">Counties</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.water}
              onChange={() => updateOverlays({ ...overlays, water: !overlays.water })}
            />
            <span className="toggle-label">Water Bodies</span>
          </label>

          <div className="overlay-divider" />
          <div className="overlay-section-title">Aviation Overlays</div>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.usArtcc}
              onChange={() => updateOverlays({ ...overlays, usArtcc: !overlays.usArtcc })}
            />
            <span className="toggle-label">US ARTCC Boundaries</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.usRefueling}
              onChange={() => updateOverlays({ ...overlays, usRefueling: !overlays.usRefueling })}
            />
            <span className="toggle-label">US Refueling Tracks</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.ukMilZones}
              onChange={() => updateOverlays({ ...overlays, ukMilZones: !overlays.ukMilZones })}
            />
            <span className="toggle-label">UK Military Zones</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.euMilAwacs}
              onChange={() => updateOverlays({ ...overlays, euMilAwacs: !overlays.euMilAwacs })}
            />
            <span className="toggle-label">EU AWACS Orbits</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.trainingAreas}
              onChange={() => updateOverlays({ ...overlays, trainingAreas: !overlays.trainingAreas })}
            />
            <span className="toggle-label">Training Areas</span>
          </label>

          <div className="overlay-divider" />
          <div className="overlay-section-title">Pro Display Settings</div>

          {/* Theme Selector */}
          <div className="overlay-setting">
            <span className="setting-label">Color Theme</span>
            <select
              className="overlay-select"
              value={proTheme}
              onChange={(e) => {
                setProTheme(e.target.value);
                localStorage.setItem('adsb-pro-theme', e.target.value);
              }}
            >
              <option value="cyan">Classic Cyan</option>
              <option value="amber">Amber/Gold</option>
              <option value="green">Green Phosphor</option>
              <option value="high-contrast">High Contrast</option>
            </select>
          </div>

          {/* Compass Rose Toggle */}
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={showCompassRose}
              onChange={() => {
                const newVal = !showCompassRose;
                setShowCompassRose(newVal);
                localStorage.setItem('adsb-pro-compass-rose', String(newVal));
              }}
            />
            <span className="toggle-label"><Compass size={12} /> Compass Rose (P)</span>
          </label>

          {/* Grid Opacity */}
          <div className="overlay-setting">
            <span className="setting-label">Grid Opacity (G)</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(gridOpacity * 100)}
              onChange={(e) => {
                const newVal = parseInt(e.target.value) / 100;
                setGridOpacity(newVal);
                localStorage.setItem('adsb-pro-grid-opacity', String(newVal));
              }}
              className="overlay-slider"
            />
            <span className="setting-value">{Math.round(gridOpacity * 100)}%</span>
          </div>

          {/* Display toggles */}
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={showDataBlocks}
              onChange={() => {
                const newVal = !showDataBlocks;
                setShowDataBlocks(newVal);
                localStorage.setItem('adsb-pro-show-datablocks', String(newVal));
              }}
            />
            <span className="toggle-label">Data Blocks (L)</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={showPredictionVectors}
              onChange={() => {
                const newVal = !showPredictionVectors;
                setShowPredictionVectors(newVal);
                localStorage.setItem('adsb-pro-prediction-vectors', String(newVal));
              }}
            />
            <span className="toggle-label">Velocity Vectors (V)</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={showSpeedColors}
              onChange={() => {
                const newVal = !showSpeedColors;
                setShowSpeedColors(newVal);
                localStorage.setItem('adsb-pro-speed-colors', String(newVal));
              }}
            />
            <span className="toggle-label">Speed Coloring (S)</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={showAltitudeTrails}
              onChange={() => {
                const newVal = !showAltitudeTrails;
                setShowAltitudeTrails(newVal);
                localStorage.setItem('adsb-pro-altitude-trails', String(newVal));
              }}
            />
            <span className="toggle-label">Altitude-Colored Trails (A)</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={showConflictVisualization}
              onChange={() => {
                const newVal = !showConflictVisualization;
                setShowConflictVisualization(newVal);
                localStorage.setItem('adsb-pro-conflict-viz', String(newVal));
              }}
            />
            <span className="toggle-label">Conflict Visualization (C)</span>
          </label>

          <div className="overlay-divider" />
          <div className="overlay-section-title">Data Block Fields</div>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={dataBlockConfig.showAltitude}
              onChange={() => {
                const newConfig = { ...dataBlockConfig, showAltitude: !dataBlockConfig.showAltitude };
                setDataBlockConfig(newConfig);
                localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
              }}
            />
            <span className="toggle-label">Altitude</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={dataBlockConfig.showSpeed}
              onChange={() => {
                const newConfig = { ...dataBlockConfig, showSpeed: !dataBlockConfig.showSpeed };
                setDataBlockConfig(newConfig);
                localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
              }}
            />
            <span className="toggle-label">Speed</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={dataBlockConfig.showHeading}
              onChange={() => {
                const newConfig = { ...dataBlockConfig, showHeading: !dataBlockConfig.showHeading };
                setDataBlockConfig(newConfig);
                localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
              }}
            />
            <span className="toggle-label">Heading</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={dataBlockConfig.showVerticalSpeed}
              onChange={() => {
                const newConfig = { ...dataBlockConfig, showVerticalSpeed: !dataBlockConfig.showVerticalSpeed };
                setDataBlockConfig(newConfig);
                localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
              }}
            />
            <span className="toggle-label">Vertical Speed</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={dataBlockConfig.showAircraftType}
              onChange={() => {
                const newConfig = { ...dataBlockConfig, showAircraftType: !dataBlockConfig.showAircraftType };
                setDataBlockConfig(newConfig);
                localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
              }}
            />
            <span className="toggle-label">Aircraft Type</span>
          </label>

          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={dataBlockConfig.compact}
              onChange={() => {
                const newConfig = { ...dataBlockConfig, compact: !dataBlockConfig.compact };
                setDataBlockConfig(newConfig);
                localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
              }}
            />
            <span className="toggle-label">Compact Mode</span>
          </label>

          <div className="overlay-divider" />
          <div className="overlay-section-title">Layer Opacity</div>

          <div className="overlay-setting">
            <span className="setting-label">ARTCC</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round((layerOpacities.usArtcc || 0.5) * 100)}
              onChange={(e) => {
                const newVal = parseInt(e.target.value) / 100;
                const newOpacities = { ...layerOpacities, usArtcc: newVal };
                setLayerOpacities(newOpacities);
                saveLayerOpacities(newOpacities);
              }}
              className="overlay-slider"
            />
          </div>

          <div className="overlay-setting">
            <span className="setting-label">Refueling Tracks</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round((layerOpacities.usRefueling || 0.5) * 100)}
              onChange={(e) => {
                const newVal = parseInt(e.target.value) / 100;
                const newOpacities = { ...layerOpacities, usRefueling: newVal };
                setLayerOpacities(newOpacities);
                saveLayerOpacities(newOpacities);
              }}
              className="overlay-slider"
            />
          </div>

          <div className="overlay-setting">
            <span className="setting-label">Military Zones</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round((layerOpacities.ukMilZones || 0.5) * 100)}
              onChange={(e) => {
                const newVal = parseInt(e.target.value) / 100;
                const newOpacities = { ...layerOpacities, ukMilZones: newVal };
                setLayerOpacities(newOpacities);
                saveLayerOpacities(newOpacities);
              }}
              className="overlay-slider"
            />
          </div>

          <div className="overlay-setting">
            <span className="setting-label">Water Bodies</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round((layerOpacities.water || 0.5) * 100)}
              onChange={(e) => {
                const newVal = parseInt(e.target.value) / 100;
                const newOpacities = { ...layerOpacities, water: newVal };
                setLayerOpacities(newOpacities);
                saveLayerOpacities(newOpacities);
              }}
              className="overlay-slider"
            />
          </div>
        </>
      )}

      <div className="overlay-divider" />
      <button
        className="legend-toggle-btn"
        onClick={() => { setShowLegend(!showLegend); setShowOverlayMenu(false); }}
      >
        <HelpCircle size={14} />
        <span>Symbol Legend</span>
      </button>
      <div className="overlay-note">
        Weather data from aviationweather.gov
      </div>
    </div>
  );
}
