// Data hooks
export { useApi, parseDRFError } from './useApi';
export { useSocketApi } from './useSocketApi';
export { useAviationData } from './useAviationData';
export { useAircraftInfo } from './useAircraftInfo';
export { useTafData } from './useTafData';
export { useAlertNotifications } from './useAlertNotifications';
export { useNotificationChannels } from './useNotificationChannels';
export { useStats } from './useStats';
export { useStatsData } from './useStatsData';
export { useDataCache } from './useDataCache';

// Socket.IO hooks
export {
  useSocketIO,
  useSocketIODefault,
  useSocketIOData,
  useSocketIOPositions,
  useSocketIOAudio,
  retrySocketIOAudio,
  useSocketIOApi,
  useSocketIOCannonball,
} from './socket';

// Map hooks
export { useDraggable } from './useDraggable';
export { useTrackHistory } from './useTrackHistory';
export { useMapAlarms } from './useMapAlarms';
export { useSafetyEvents } from './useSafetyEvents';
export { useGestures } from './useGestures';
export { useConflictProbe } from './useConflictProbe';
export { useAirportTraffic } from './useAirportTraffic';
export {
  useHighlightGroups,
  DEFAULT_GROUPS,
  RULE_FIELDS,
  RULE_OPERATORS,
  COLOR_PALETTE,
  matchesRule,
  parseInValue,
  formatInValue,
} from './useHighlightGroups';

// History hooks
export { useHistoryStream } from './useHistoryStream';
export { useAcarsData } from './useAcarsData';
export { useReplayState } from './useReplayState';

// Cannonball mode hooks
export { useDeviceGPS } from './useDeviceGPS';
export { useVoiceAlerts } from './useVoiceAlerts';
export { useThreatHistory } from './useThreatHistory';
export { useHapticFeedback } from './useHapticFeedback';
export { useAudioTones } from './useAudioTones';
export { useCannonballAPI } from './useCannonballAPI';
export { useVoiceControl } from './useVoiceControl';

// Audio hooks
export { useAudioFavorites } from './useAudioFavorites';
export { useAudioHistory } from './useAudioHistory';
export { useAudioKeyboard } from './useAudioKeyboard';
export {
  useAudioState,
  globalAudioState,
  subscribeToAudioState,
  subscribeToAudioStateChanges,
  notifySubscribers,
  setAutoplay,
  setAutoplayFilter,
  clearAutoplayFilter,
  getGlobalAudioState,
  removeFromQueue,
  clearQueue,
  reorderQueue,
  processGlobalAutoplayQueue,
  playAudioFromGlobal,
  hasEmergencyKeyword,
  EMERGENCY_KEYWORDS,
  AUTOPLAY_MAX_AGE_MS,
} from './useAudioState';
export { useAudioPlayback } from './useAudioPlayback';

// UI hooks
export { useListPreferences } from './useListPreferences';
export { useSortState } from './useSortState';
export { useToast } from './useToast';
export { useWatchList } from './useWatchList';
export { useFlightStrips, getWakeCategory } from './useFlightStrips';

// Filter hooks
export { useAltitudeFilter, ALTITUDE_PRESETS } from './useAltitudeFilter';

// Pro mode safety hooks
export { useMSAW, MSAW_THRESHOLDS, AIRPORT_EXCLUSION } from './useMSAW';

// Search hooks
export { useSearchHistory } from './useSearchHistory';

// Pro Mode Multi-Scope hooks
export { useScopeLayout } from './useScopeLayout';

// Pro Mode Session Statistics (Phase 13.3)
export { useSessionStats } from './useSessionStats';

// Pro Mode Separation Tool (Phase 8.5)
export { useSeparationTool } from './useSeparationTool';

// Data Block Configuration (Phase 5.2)
export { useDataBlockConfig, FIELD_DEFINITIONS, MODE_DEFINITIONS } from './useDataBlockConfig';

// Pro Radar Settings (Phase 5.3)
export {
  useRadarSettings,
  THEME_PRESETS,
  OVERLAY_TYPES,
  PERFORMANCE_SETTINGS,
} from './useRadarSettings';

// Track Playback (Phase 13.1)
export { useTrackPlayback, TIME_RANGE_PRESETS, PLAYBACK_SPEEDS } from './useTrackPlayback';
