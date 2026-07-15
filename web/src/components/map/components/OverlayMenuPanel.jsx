import React from 'react';
import { X, Wind, Compass, HelpCircle, Settings2 } from 'lucide-react';
import { WINDS_ALOFT_LEVELS } from '../../../hooks/useWindsAloft';
import { saveLayerOpacities } from '../../../utils';

/**
 * OverlayMenuPanel - Full overlay menu panel extracted from MapView.jsx.
 * Contains all map layer toggles, airspace type filters, weather advisory filters,
 * winds aloft, pro display settings, data block configuration, and layer opacity controls.
 */
export default function OverlayMenuPanel({
  overlays,
  updateOverlays,
  showAirspaceLabels,
  setShowAirspaceLabels,
  airspaceTypeFilters,
  setAirspaceTypeFilters,
  weatherAdvisoryFilters,
  setWeatherAdvisoryFilters,
  windsAloftLevel,
  setWindsAloftLevel,
  showCompassRose,
  setShowCompassRose,
  gridOpacity,
  setGridOpacity,
  showDataBlocks,
  setShowDataBlocks,
  showPredictionVectors,
  setShowPredictionVectors,
  showVsTrend,
  setShowVsTrend,
  showSpeedColors,
  setShowSpeedColors,
  showAltitudeTrails,
  setShowAltitudeTrails,
  showConflictVisualization,
  setShowConflictVisualization,
  dataBlockConfig,
  setDataBlockConfig,
  layerOpacities,
  setLayerOpacities,
  proTheme,
  setProTheme,
  showLegend,
  setShowLegend,
  config,
  onClose,
  setShowDataBlockConfigPanel,
}) {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="overlay-menu" onClick={(e) => e.stopPropagation()}>
      <div className="overlay-menu-header">
        <span>Map Layers</span>
        <button onClick={onClose}>
          <X size={14} />
        </button>
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
      {overlays.airspace && (
        <>
          <label className="overlay-toggle" style={{ paddingLeft: '20px' }}>
            <input
              type="checkbox"
              checked={showAirspaceLabels}
              onChange={() => {
                const newVal = !showAirspaceLabels;
                setShowAirspaceLabels(newVal);
                localStorage.setItem('adsb-show-airspace-labels', String(newVal));
              }}
            />
            <span className="toggle-label">Show Labels</span>
          </label>
          <div
            className="overlay-section-title"
            style={{ paddingLeft: '20px', fontSize: '10px', marginTop: '8px' }}
          >
            Airspace Types
          </div>
          {[
            { key: 'B', label: 'Class B' },
            { key: 'C', label: 'Class C' },
            { key: 'D', label: 'Class D' },
            { key: 'E', label: 'Class E' },
            { key: 'MOA', label: 'MOA' },
            { key: 'RESTRICTED', label: 'Restricted' },
            { key: 'WARNING', label: 'Warning' },
            { key: 'PROHIBITED', label: 'Prohibited' },
            { key: 'TFR', label: 'TFR' },
            { key: 'ALERT', label: 'Alert' },
          ].map(({ key, label }) => (
            <label key={key} className="overlay-toggle" style={{ paddingLeft: '30px' }}>
              <input
                type="checkbox"
                checked={airspaceTypeFilters[key] ?? true}
                onChange={() => {
                  const newFilters = {
                    ...airspaceTypeFilters,
                    [key]: !airspaceTypeFilters[key],
                  };
                  setAirspaceTypeFilters(newFilters);
                  localStorage.setItem('adsb-airspace-type-filters', JSON.stringify(newFilters));
                }}
              />
              <span className="toggle-label">{label}</span>
            </label>
          ))}
          <div
            className="overlay-section-title"
            style={{ paddingLeft: '20px', fontSize: '10px', marginTop: '8px' }}
          >
            Weather Advisories (G-AIRMET)
          </div>
          {[
            { key: 'IFR', label: 'IFR Conditions' },
            { key: 'TURB', label: 'Turbulence' },
            { key: 'ICE', label: 'Icing' },
            { key: 'TS', label: 'Thunderstorm' },
            { key: 'MT_OBSC', label: 'Mountain Obscuration' },
            { key: 'LLWS', label: 'Low Level Wind Shear' },
            { key: 'SFC_WND', label: 'Surface Wind' },
            { key: 'FZLVL', label: 'Freezing Level' },
          ].map(({ key, label }) => (
            <label key={key} className="overlay-toggle" style={{ paddingLeft: '30px' }}>
              <input
                type="checkbox"
                checked={weatherAdvisoryFilters[key] ?? true}
                onChange={() => {
                  const newFilters = {
                    ...weatherAdvisoryFilters,
                    [key]: !weatherAdvisoryFilters[key],
                  };
                  setWeatherAdvisoryFilters(newFilters);
                  localStorage.setItem('adsb-weather-advisory-filters', JSON.stringify(newFilters));
                }}
              />
              <span className="toggle-label">{label}</span>
            </label>
          ))}
        </>
      )}
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
          checked={overlays.tafs}
          onChange={() => updateOverlays({ ...overlays, tafs: !overlays.tafs })}
        />
        <span className="toggle-label">TAFs (Forecasts)</span>
      </label>
      <label className="overlay-toggle">
        <input
          type="checkbox"
          checked={overlays.pireps}
          onChange={() => updateOverlays({ ...overlays, pireps: !overlays.pireps })}
        />
        <span className="toggle-label">PIREPs</span>
      </label>
      <label className="overlay-toggle">
        <input
          type="checkbox"
          checked={overlays.convectiveSigmets}
          onChange={() =>
            updateOverlays({ ...overlays, convectiveSigmets: !overlays.convectiveSigmets })
          }
        />
        <span className="toggle-label">Convective SIGMETs</span>
      </label>
      {config.mapMode === 'pro' && (
        <>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.windsAloft}
              onChange={() => updateOverlays({ ...overlays, windsAloft: !overlays.windsAloft })}
            />
            <span className="toggle-label">
              <Wind size={12} /> Winds Aloft (Shift+W)
            </span>
          </label>
          {overlays.windsAloft && (
            <div className="overlay-setting" style={{ paddingLeft: '20px' }}>
              <span className="setting-label">Altitude Level</span>
              <select
                className="overlay-select"
                value={windsAloftLevel}
                onChange={(e) => {
                  const level = parseInt(e.target.value, 10);
                  setWindsAloftLevel(level);
                  localStorage.setItem('adsb-winds-aloft-level', String(level));
                }}
              >
                {WINDS_ALOFT_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </div>
          )}
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
              onChange={() =>
                updateOverlays({ ...overlays, trainingAreas: !overlays.trainingAreas })
              }
            />
            <span className="toggle-label">Training Areas</span>
          </label>
          <div className="overlay-divider" />
          <div className="overlay-section-title">Pro Display Settings</div>
          {/* Phase 5.1: Theme Selector */}
          <div className="overlay-setting">
            <span className="setting-label">Color Theme (Shift+T)</span>
            <select
              className="overlay-select"
              value={proTheme}
              onChange={(e) => setProTheme(e.target.value)}
            >
              <option value="cyan">Classic Cyan</option>
              <option value="amber">Amber/Gold</option>
              <option value="green">Green Phosphor</option>
              <option value="high-contrast">High Contrast</option>
            </select>
          </div>
          {/* Phase 4.3: Compass Rose Toggle */}
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
            <span className="toggle-label">
              <Compass size={12} /> Compass Rose (P)
            </span>
          </label>
          {/* Phase 4.2: Grid Opacity */}
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
              checked={showVsTrend}
              onChange={() => {
                const newVal = !showVsTrend;
                setShowVsTrend(newVal);
                localStorage.setItem('adsb-pro-vs-trend', String(newVal));
              }}
            />
            <span className="toggle-label">VS Trend Indicators (Y)</span>
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
          {/* Phase 5.2: Data Block Configuration */}
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={dataBlockConfig.showAltitude}
              onChange={() => {
                const newConfig = {
                  ...dataBlockConfig,
                  showAltitude: !dataBlockConfig.showAltitude,
                };
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
                const newConfig = {
                  ...dataBlockConfig,
                  showHeading: !dataBlockConfig.showHeading,
                };
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
                const newConfig = {
                  ...dataBlockConfig,
                  showVerticalSpeed: !dataBlockConfig.showVerticalSpeed,
                };
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
                const newConfig = {
                  ...dataBlockConfig,
                  showAircraftType: !dataBlockConfig.showAircraftType,
                };
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
          <button
            className="legend-toggle-btn"
            onClick={() => {
              setShowDataBlockConfigPanel(true);
              onClose();
            }}
            style={{ marginTop: '8px' }}
          >
            <Settings2 size={14} />
            <span>Advanced Config...</span>
          </button>
          <div className="overlay-divider" />
          <div className="overlay-section-title">Layer Opacity</div>
          {/* Phase 4.4: Layer Opacity Controls */}
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
        onClick={() => {
          setShowLegend(!showLegend);
          onClose();
        }}
      >
        <HelpCircle size={14} />
        <span>Symbol Legend</span>
      </button>
      <div className="overlay-note">Weather data from aviationweather.gov</div>
    </div>
  );
}
