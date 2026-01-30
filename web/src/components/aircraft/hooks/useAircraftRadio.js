import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getGlobalAudioState, subscribeToAudioStateChanges, setAutoplay, setAutoplayFilter, clearAutoplayFilter } from '../../views/AudioView';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

/**
 * Hook for managing aircraft radio transmissions fetching and playback
 */
export function useAircraftRadio({
  hex,
  baseUrl,
  callsign,
  activeTab,
  wsRequest,
  wsConnected,
  onLoaded,
}) {
  const [radioTransmissions, setRadioTransmissions] = useState([]);
  const [radioHours, setRadioHours] = useState(24);
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioSearchQuery, setRadioSearchQuery] = useState('');
  const [radioStatusFilter, setRadioStatusFilter] = useState('all');
  const [radioPlayingId, setRadioPlayingId] = useState(null);
  const [radioAudioProgress, setRadioAudioProgress] = useState({});
  const [radioAudioDurations, setRadioAudioDurations] = useState({});
  const [radioExpandedTranscript, setRadioExpandedTranscript] = useState({});
  const [radioAutoplay, setRadioAutoplay] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const prevRadioHoursRef = useRef(radioHours);

  // Reset when hex changes
  useEffect(() => {
    setLoaded(false);
    setRadioTransmissions([]);
    setRadioExpandedTranscript({});
  }, [hex]);

  // Subscribe to global audio state
  useEffect(() => {
    const unsubscribe = subscribeToAudioStateChanges((updates) => {
      if ('playingId' in updates) setRadioPlayingId(updates.playingId);
      if ('audioProgress' in updates) setRadioAudioProgress(updates.audioProgress);
      if ('audioDurations' in updates) setRadioAudioDurations(updates.audioDurations);
      if ('autoplay' in updates) setRadioAutoplay(updates.autoplay);
    });
    const audioState = getGlobalAudioState();
    setRadioPlayingId(audioState.playingId);
    setRadioAudioProgress(audioState.audioProgress);
    setRadioAudioDurations(audioState.audioDurations);
    setRadioAutoplay(audioState.autoplay);
    return unsubscribe;
  }, []);

  // Lazy load radio transmissions when tab becomes active
  useEffect(() => {
    if (activeTab !== 'radio' || loaded) return;

    const abortController = new AbortController();

    const fetchRadioTransmissions = async () => {
      setRadioLoading(true);
      try {
        let radioData = null;
        if (wsRequest && wsConnected) {
          try {
            const params = { icao: hex, include_radio_calls: true, radio_hours: radioHours, radio_limit: 50 };
            if (callsign) params.callsign = callsign;
            radioData = await wsRequest('aircraft-info', params);
            if (radioData?.error) radioData = null;
          } catch (err) {
            console.debug('Radio transmissions WS request failed:', err.message);
          }
        }

        if (abortController.signal.aborted) return;

        if (!radioData) {
          const params = new URLSearchParams({
            include_radio_calls: 'true',
            radio_hours: radioHours.toString(),
            radio_limit: '50',
          });
          if (callsign) params.append('callsign', callsign);
          const res = await fetch(`${baseUrl}/api/v1/audio/matched/?${params}`, {
            signal: abortController.signal
          });
          radioData = await safeJson(res);
        }

        if (!abortController.signal.aborted) {
          if (radioData) setRadioTransmissions(radioData.matched_calls || []);
          setLoaded(true);
          if (onLoaded) onLoaded('radio');
          setRadioLoading(false);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Radio transmissions fetch error:', err.message);
        if (!abortController.signal.aborted) {
          setRadioLoading(false);
        }
      }
    };
    fetchRadioTransmissions();

    return () => {
      abortController.abort();
    };
  }, [activeTab, loaded, hex, baseUrl, radioHours, callsign, wsRequest, wsConnected, onLoaded]);

  // Refetch radio transmissions when hours change
  useEffect(() => {
    if (prevRadioHoursRef.current === radioHours || !loaded) {
      prevRadioHoursRef.current = radioHours;
      return;
    }
    prevRadioHoursRef.current = radioHours;

    const abortController = new AbortController();

    const fetchRadioTransmissions = async () => {
      setRadioLoading(true);
      try {
        let radioData = null;
        if (wsRequest && wsConnected) {
          try {
            const params = { icao: hex, include_radio_calls: true, radio_hours: radioHours, radio_limit: 50 };
            if (callsign) params.callsign = callsign;
            radioData = await wsRequest('aircraft-info', params);
            if (radioData?.error) radioData = null;
          } catch (err) {
            console.debug('Radio transmissions WS request failed:', err.message);
          }
        }

        if (abortController.signal.aborted) return;

        if (!radioData) {
          const params = new URLSearchParams({
            include_radio_calls: 'true',
            radio_hours: radioHours.toString(),
            radio_limit: '50',
          });
          if (callsign) params.append('callsign', callsign);
          const res = await fetch(`${baseUrl}/api/v1/audio/matched/?${params}`, {
            signal: abortController.signal
          });
          radioData = await safeJson(res);
        }

        if (!abortController.signal.aborted) {
          if (radioData) setRadioTransmissions(radioData.matched_calls || []);
          setRadioLoading(false);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Radio transmissions fetch error:', err.message);
        if (!abortController.signal.aborted) {
          setRadioLoading(false);
        }
      }
    };
    fetchRadioTransmissions();

    return () => {
      abortController.abort();
    };
  }, [radioHours, loaded, hex, baseUrl, callsign, wsRequest, wsConnected]);

  // Filter radio transmissions
  const filteredRadioTransmissions = useMemo(() => {
    if (!radioTransmissions.length) return [];
    return radioTransmissions.filter(t => {
      if (radioSearchQuery) {
        const query = radioSearchQuery.toLowerCase();
        const matchesSearch =
          t.channel_name?.toLowerCase().includes(query) ||
          t.transcript?.toLowerCase().includes(query) ||
          t.matched_callsign?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      if (radioStatusFilter === 'transcribed' && !t.transcript) return false;
      if (radioStatusFilter === 'no_transcript' && t.transcript) return false;
      return true;
    });
  }, [radioTransmissions, radioSearchQuery, radioStatusFilter]);

  // Radio audio handlers
  const handleRadioPlay = useCallback((transmission) => {
    const globalState = getGlobalAudioState();
    const id = transmission.id;

    if (globalState.playingId && globalState.playingId !== id) {
      const prevAudio = globalState.audioRefs[globalState.playingId];
      if (prevAudio) {
        prevAudio.pause();
        prevAudio.currentTime = 0;
      }
    }

    let audio = globalState.audioRefs[id];
    if (!audio) {
      audio = new Audio(transmission.audio_url);
      globalState.audioRefs[id] = audio;

      audio.addEventListener('loadedmetadata', () => {
        globalState.audioDurations[id] = audio.duration;
        setRadioAudioDurations(prev => ({ ...prev, [id]: audio.duration }));
      });

      audio.addEventListener('ended', () => {
        globalState.playingId = null;
        globalState.audioProgress[id] = 0;
        setRadioPlayingId(null);
        setRadioAudioProgress(prev => ({ ...prev, [id]: 0 }));

        if (globalState.autoplay && globalState.autoplayFilter?.hex === hex) {
          const filteredList = filteredRadioTransmissions;
          const currentIndex = filteredList.findIndex(t => t.id === id);
          if (currentIndex !== -1 && currentIndex < filteredList.length - 1) {
            const nextTransmission = filteredList[currentIndex + 1];
            if (nextTransmission?.audio_url) {
              setTimeout(() => handleRadioPlay(nextTransmission), 100);
            }
          }
        }
      });

      audio.addEventListener('error', (e) => {
        console.error('Radio audio playback error:', e);
        globalState.playingId = null;
        setRadioPlayingId(null);
      });
    }

    if (globalState.playingId === id) {
      audio.pause();
      globalState.playingId = null;
      setRadioPlayingId(null);
      if (globalState.progressIntervalRef) clearInterval(globalState.progressIntervalRef);
    } else {
      audio.play().catch(err => console.error('Failed to play radio audio:', err));
      globalState.playingId = id;
      setRadioPlayingId(id);

      globalState.progressIntervalRef = setInterval(() => {
        if (audio && !audio.paused) {
          const progress = (audio.currentTime / audio.duration) * 100 || 0;
          globalState.audioProgress[id] = progress;
          setRadioAudioProgress(prev => ({ ...prev, [id]: progress }));
        }
      }, 100);
    }
  }, [hex, filteredRadioTransmissions]);

  const handleRadioSeek = useCallback((id, e) => {
    const globalState = getGlobalAudioState();
    const audio = globalState.audioRefs[id];
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audio.currentTime = percent * audio.duration;
    globalState.audioProgress[id] = percent * 100;
    setRadioAudioProgress(prev => ({ ...prev, [id]: percent * 100 }));
  }, []);

  const toggleRadioAutoplay = useCallback(() => {
    const globalState = getGlobalAudioState();
    if (radioAutoplay && globalState.autoplayFilter?.hex === hex) {
      setAutoplay(false);
      clearAutoplayFilter();
      setRadioAutoplay(false);
    } else {
      setAutoplay(true);
      setAutoplayFilter({ type: 'airframe', callsign, hex });
      setRadioAutoplay(true);
      if (!globalState.playingId && filteredRadioTransmissions.length > 0) {
        const first = filteredRadioTransmissions[0];
        if (first?.audio_url) handleRadioPlay(first);
      }
    }
  }, [hex, callsign, radioAutoplay, handleRadioPlay, filteredRadioTransmissions]);

  return {
    radioTransmissions,
    radioHours,
    setRadioHours,
    radioLoading,
    radioSearchQuery,
    setRadioSearchQuery,
    radioStatusFilter,
    setRadioStatusFilter,
    radioPlayingId,
    radioAudioProgress,
    radioAudioDurations,
    radioExpandedTranscript,
    setRadioExpandedTranscript,
    radioAutoplay,
    filteredRadioTransmissions,
    handleRadioPlay,
    handleRadioSeek,
    toggleRadioAutoplay,
    radioLoaded: loaded,
  };
}
