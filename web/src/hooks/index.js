// Data hooks
export { useApi, parseDRFError } from './useApi';
export { useSocketApi } from './useSocketApi';
export { useAviationData } from './useAviationData';
export { useAircraftInfo } from './useAircraftInfo';
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
