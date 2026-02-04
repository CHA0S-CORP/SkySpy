// ============================================================================
// Map Components - Fully Refactored
// ============================================================================

// Main MapView component
export { MapView } from './MapView';

// Sub-components
export { MapControls } from './MapControls';
export { AircraftPopup } from './AircraftPopup';
export { AircraftListPanel } from './AircraftListPanel';
export { LegendPanel } from './LegendPanel';
export { FilterMenu } from './FilterMenu';
export { OverlayMenu } from './OverlayMenu';
export { AcarsPanel } from './AcarsPanel';
export { SafetyEventsPanel } from './SafetyEventsPanel';
export { ConflictBanner } from './ConflictBanner';
export { MetarPopup, PirepPopup, NavaidPopup, AirportPopup } from './WeatherPopups';
export {
  WeatherRadarOverlay,
  WeatherRadarLegend,
  useWeatherRadarOverlay,
} from './components/WeatherRadarOverlay';

// Phase 14.1: Multi-Scope View components
export { MultiScopeWrapper, useScopeLayoutIntegration } from './MultiScopeWrapper';
export { MultiScopeContainer, LayoutToggle, ScopeControls } from './components/MultiScopeContainer';
export { RadarScope, useRadarScopeCoordinator } from './components/RadarScope';
