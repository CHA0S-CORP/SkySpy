/**
 * useVoiceAlerts - Hook for text-to-speech threat announcements
 *
 * Provides voice alerts for Cannonball mode with:
 * - Text-to-speech announcements
 * - Configurable voice settings
 * - Queued announcements
 */
import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Format bearing to compass direction
 * @param {number} bearing - Bearing in degrees (0-360)
 * @returns {string} Compass direction
 */
function formatDirection(bearing) {
  if (bearing === null || bearing === undefined) return 'unknown direction';

  const directions = [
    'north', 'north northeast', 'northeast', 'east northeast',
    'east', 'east southeast', 'southeast', 'south southeast',
    'south', 'south southwest', 'southwest', 'west southwest',
    'west', 'west northwest', 'northwest', 'north northwest',
  ];

  const index = Math.round(bearing / 22.5) % 16;
  return directions[index];
}

/**
 * Format distance for speech
 * @param {number} distanceNm - Distance in nautical miles
 * @returns {string} Spoken distance
 */
function formatDistance(distanceNm) {
  if (distanceNm === null || distanceNm === undefined) return 'unknown distance';

  if (distanceNm < 0.5) {
    // Convert to feet (1nm = 6076.12ft)
    const feet = Math.round(distanceNm * 6076.12 / 100) * 100;
    return `${feet} feet`;
  } else if (distanceNm < 1) {
    return 'less than one mile';
  } else if (distanceNm < 2) {
    return `${distanceNm.toFixed(1)} miles`;
  } else {
    return `${Math.round(distanceNm)} miles`;
  }
}

/**
 * Voice alerts hook for threat announcements
 *
 * @param {Object} options Configuration options
 * @param {boolean} options.enabled Whether voice alerts are enabled
 * @param {number} options.rate Speech rate (0.5-2.0)
 * @param {number} options.pitch Speech pitch (0-2)
 * @param {number} options.volume Speech volume (0-1)
 * @param {string} options.voiceName Preferred voice name (optional)
 * @returns {Object} Voice alert controls
 */
export function useVoiceAlerts({
  enabled = true,
  rate = 1.1,
  pitch = 1.0,
  volume = 1.0,
  voiceName = null,
} = {}) {
  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);

  const queueRef = useRef([]);
  const announcedThreatsRef = useRef(new Set());
  const lastAnnouncementRef = useRef(null);

  // Check for speech synthesis support
  useEffect(() => {
    const supported = 'speechSynthesis' in window;
    setIsSupported(supported);

    if (supported) {
      // Load available voices
      const loadVoices = () => {
        const availableVoices = speechSynthesis.getVoices();
        setVoices(availableVoices);

        // Try to find preferred voice
        if (voiceName) {
          const preferred = availableVoices.find(v => v.name.includes(voiceName));
          if (preferred) setSelectedVoice(preferred);
        }

        // Default to first English voice
        if (!selectedVoice) {
          const englishVoice = availableVoices.find(v => v.lang.startsWith('en'));
          if (englishVoice) setSelectedVoice(englishVoice);
        }
      };

      loadVoices();
      speechSynthesis.onvoiceschanged = loadVoices;

      return () => {
        speechSynthesis.onvoiceschanged = null;
      };
    }
  }, [voiceName, selectedVoice]);

  // Speak text
  const speak = useCallback((text, options = {}) => {
    if (!enabled || !isSupported) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate ?? rate;
    utterance.pitch = options.pitch ?? pitch;
    utterance.volume = options.volume ?? volume;

    if (options.voice || selectedVoice) {
      utterance.voice = options.voice || selectedVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      lastAnnouncementRef.current = Date.now();
      processQueue();
    };
    utterance.onerror = (e) => {
      console.warn('Speech synthesis error:', e);
      setIsSpeaking(false);
      processQueue();
    };

    speechSynthesis.speak(utterance);
  }, [enabled, isSupported, rate, pitch, volume, selectedVoice]);

  // Process queued announcements
  const processQueue = useCallback(() => {
    if (queueRef.current.length > 0 && !speechSynthesis.speaking) {
      const next = queueRef.current.shift();
      speak(next.text, next.options);
    }
  }, [speak]);

  // Queue an announcement
  const queue = useCallback((text, options = {}) => {
    if (!enabled || !isSupported) return;

    queueRef.current.push({ text, options });

    if (!speechSynthesis.speaking) {
      processQueue();
    }
  }, [enabled, isSupported, processQueue]);

  // Announce a threat
  const announceThreat = useCallback((threat, options = {}) => {
    if (!enabled || !isSupported || !threat) return;

    const threatId = threat.hex || threat.callsign;
    const now = Date.now();

    // Debounce: don't announce same threat within 30 seconds
    const lastAnnounced = announcedThreatsRef.current.has(threatId);
    if (lastAnnounced && !options.force) {
      return;
    }

    // Build announcement text
    const parts = [];

    // Category/type
    const category = threat.category || (threat.is_helicopter ? 'Helicopter' : 'Aircraft');
    parts.push(category);

    // Distance
    parts.push(formatDistance(threat.distance_nm));

    // Direction
    if (threat.bearing !== null && threat.bearing !== undefined) {
      parts.push(`to the ${formatDirection(threat.bearing)}`);
    }

    // Trend
    if (threat.trend === 'approaching') {
      parts.push('approaching');
    } else if (threat.trend === 'departing') {
      parts.push('departing');
    }

    const text = parts.join(', ');

    // Track announced threats (auto-clear after 30s)
    announcedThreatsRef.current.add(threatId);
    setTimeout(() => {
      announcedThreatsRef.current.delete(threatId);
    }, 30000);

    // Use priority for critical threats
    if (threat.threat_level === 'critical') {
      // Cancel current speech and announce immediately
      speechSynthesis.cancel();
      queueRef.current = [];
      speak(text, { rate: rate * 1.1 });
    } else {
      queue(text);
    }
  }, [enabled, isSupported, speak, queue, rate]);

  // Announce new threat (only if it's new)
  const announceNewThreat = useCallback((threat) => {
    const threatId = threat.hex || threat.callsign;
    if (!announcedThreatsRef.current.has(threatId)) {
      announceThreat(threat);
    }
  }, [announceThreat]);

  // Announce clear status
  const announceClear = useCallback(() => {
    if (!enabled || !isSupported) return;

    // Only announce clear if we were tracking threats before
    if (announcedThreatsRef.current.size > 0 || lastAnnouncementRef.current) {
      queue('All clear');
      announcedThreatsRef.current.clear();
    }
  }, [enabled, isSupported, queue]);

  // Announce threat count
  const announceThreatCount = useCallback((count) => {
    if (!enabled || !isSupported) return;

    if (count === 0) {
      queue('No threats detected');
    } else if (count === 1) {
      queue('One threat detected');
    } else {
      queue(`${count} threats detected`);
    }
  }, [enabled, isSupported, queue]);

  // Stop all speech
  const stop = useCallback(() => {
    if (isSupported) {
      speechSynthesis.cancel();
      queueRef.current = [];
      setIsSpeaking(false);
    }
  }, [isSupported]);

  // Clear announced threats tracking
  const clearTracking = useCallback(() => {
    announcedThreatsRef.current.clear();
  }, []);

  return {
    // Status
    isSupported,
    isSpeaking,
    voices,

    // Voice selection
    selectedVoice,
    setSelectedVoice,

    // Core functions
    speak,
    queue,
    stop,

    // Threat announcements
    announceThreat,
    announceNewThreat,
    announceClear,
    announceThreatCount,
    clearTracking,
  };
}

export default useVoiceAlerts;
