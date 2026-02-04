import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('useVoiceAlerts', () => {
  let mockSpeechSynthesis;
  let mockUtterances;
  let mockVoices;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockUtterances = [];

    // Mock voices
    mockVoices = [
      { name: 'Google US English', lang: 'en-US' },
      { name: 'Google UK English Female', lang: 'en-GB' },
      { name: 'Google French', lang: 'fr-FR' },
    ];

    // Mock speechSynthesis
    mockSpeechSynthesis = {
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      getVoices: vi.fn(() => mockVoices),
      speak: vi.fn((utterance) => {
        mockSpeechSynthesis.speaking = true;
        mockUtterances.push(utterance);
        // Simulate async start
        setTimeout(() => {
          utterance.onstart?.();
        }, 0);
      }),
      cancel: vi.fn(() => {
        mockSpeechSynthesis.speaking = false;
      }),
      pause: vi.fn(),
      resume: vi.fn(),
    };

    // Mock SpeechSynthesisUtterance
    window.SpeechSynthesisUtterance = vi.fn().mockImplementation((text) => ({
      text,
      rate: 1,
      pitch: 1,
      volume: 1,
      voice: null,
      lang: '',
      onstart: null,
      onend: null,
      onerror: null,
      onpause: null,
      onresume: null,
      onmark: null,
      onboundary: null,
    }));

    // Set up speechSynthesis on window
    Object.defineProperty(window, 'speechSynthesis', {
      value: mockSpeechSynthesis,
      writable: true,
      configurable: true,
    });

    // Reset modules to ensure fresh import
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockUtterances = [];
  });

  describe('initialization', () => {
    it('should detect speech synthesis support', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      expect(result.current.isSupported).toBe(true);
    });

    it('should return isSupported false when speechSynthesis not available', async () => {
      // Remove speechSynthesis by deleting the property
      // Note: We need to re-import the module after changing the global
      delete window.speechSynthesis;
      vi.resetModules();

      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      expect(result.current.isSupported).toBe(false);

      // Restore speechSynthesis for other tests
      Object.defineProperty(window, 'speechSynthesis', {
        value: mockSpeechSynthesis,
        writable: true,
        configurable: true,
      });
    });

    it('should load available voices', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      expect(result.current.voices).toEqual(mockVoices);
    });

    it('should select first English voice by default', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      expect(result.current.selectedVoice).toEqual(mockVoices[0]);
    });

    it('should select preferred voice by name', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() =>
        useVoiceAlerts({ voiceName: 'UK English' })
      );

      expect(result.current.selectedVoice).toEqual(mockVoices[1]);
    });
  });

  describe('speak function', () => {
    it('should speak text', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.speak('Test message');
      });

      expect(window.SpeechSynthesisUtterance).toHaveBeenCalledWith('Test message');
      expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
    });

    it('should not speak when disabled', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts({ enabled: false }));

      act(() => {
        result.current.speak('Test message');
      });

      expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();
    });

    it('should apply rate, pitch, and volume options', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() =>
        useVoiceAlerts({ rate: 1.5, pitch: 0.8, volume: 0.9 })
      );

      act(() => {
        result.current.speak('Test message');
      });

      expect(mockUtterances.length).toBe(1);
      expect(mockUtterances[0].rate).toBe(1.5);
      expect(mockUtterances[0].pitch).toBe(0.8);
      expect(mockUtterances[0].volume).toBe(0.9);
    });

    it('should set isSpeaking true when speaking starts', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.speak('Test message');
      });

      await act(async () => {
        mockUtterances[0].onstart?.();
      });

      expect(result.current.isSpeaking).toBe(true);
    });

    it('should set isSpeaking false when speaking ends', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.speak('Test message');
      });

      await act(async () => {
        mockUtterances[0].onstart?.();
      });

      expect(result.current.isSpeaking).toBe(true);

      mockSpeechSynthesis.speaking = false;
      await act(async () => {
        mockUtterances[0].onend?.();
      });

      expect(result.current.isSpeaking).toBe(false);
    });

    it('should handle speech error', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.speak('Test message');
      });

      await act(async () => {
        mockUtterances[0].onstart?.();
        mockSpeechSynthesis.speaking = false;
        mockUtterances[0].onerror?.({ error: 'synthesis-failed' });
      });

      expect(result.current.isSpeaking).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('queue function', () => {
    it('should queue announcements and process when not speaking', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.queue('First message');
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);
    });

    it('should process queue when speech ends', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.queue('First message');
      });

      // Simulate speaking
      mockSpeechSynthesis.speaking = true;

      act(() => {
        result.current.queue('Second message');
      });

      // Second message should be queued, not immediately spoken
      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);

      // End first speech
      mockSpeechSynthesis.speaking = false;
      await act(async () => {
        mockUtterances[0].onend?.();
      });

      // Second message should now be spoken
      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    });
  });

  describe('announceThreat', () => {
    it('should announce threat with distance and direction', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat = {
        hex: 'ABC123',
        distance_nm: 2.5,
        bearing: 45,
        category: 'Helicopter',
        trend: 'approaching',
      };

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockUtterances.length).toBe(1);
      expect(mockUtterances[0].text).toContain('Helicopter');
      expect(mockUtterances[0].text).toContain('miles');
      expect(mockUtterances[0].text).toContain('northeast');
      expect(mockUtterances[0].text).toContain('approaching');
    });

    it('should format distance correctly for close threats', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat = {
        hex: 'ABC123',
        distance_nm: 0.3,
        bearing: 90,
      };

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockUtterances[0].text).toContain('feet');
    });

    it('should not announce same threat within 30 seconds', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat = {
        hex: 'ABC123',
        distance_nm: 2,
        bearing: 0,
      };

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);

      act(() => {
        result.current.announceThreat(threat);
      });

      // Should not announce again
      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);
    });

    it('should allow re-announcement after 30 seconds', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat = {
        hex: 'ABC123',
        distance_nm: 2,
        bearing: 0,
      };

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);

      // Advance time past 30 seconds
      act(() => {
        vi.advanceTimersByTime(31000);
      });

      // Complete first speech and reset speaking state
      mockSpeechSynthesis.speaking = false;

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    });

    it('should force announce with force option', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat = {
        hex: 'ABC123',
        distance_nm: 2,
        bearing: 0,
      };

      act(() => {
        result.current.announceThreat(threat);
      });

      // Complete first and reset speaking
      mockSpeechSynthesis.speaking = false;
      await act(async () => {
        mockUtterances[0].onend?.();
      });

      act(() => {
        result.current.announceThreat(threat, { force: true });
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    });

    it('should cancel current speech for critical threats', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      mockSpeechSynthesis.speaking = true;

      const threat = {
        hex: 'ABC123',
        distance_nm: 0.5,
        bearing: 0,
        threat_level: 'critical',
      };

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    });

    it('should include departing trend in announcement', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat = {
        hex: 'ABC123',
        distance_nm: 2,
        bearing: 180,
        trend: 'departing',
      };

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockUtterances[0].text).toContain('departing');
    });

    it('should use is_helicopter flag for category', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat = {
        hex: 'ABC123',
        distance_nm: 2,
        bearing: 0,
        is_helicopter: true,
      };

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockUtterances[0].text).toContain('Helicopter');
    });
  });

  describe('announceNewThreat', () => {
    it('should only announce if not already announced', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat = {
        hex: 'ABC123',
        distance_nm: 2,
        bearing: 0,
      };

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);

      act(() => {
        result.current.announceNewThreat(threat);
      });

      // Should not announce again via announceNewThreat
      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);
    });

    it('should announce new threat if not previously announced', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat1 = { hex: 'ABC123', distance_nm: 2, bearing: 0 };
      const threat2 = { hex: 'DEF456', distance_nm: 3, bearing: 90 };

      act(() => {
        result.current.announceNewThreat(threat1);
      });

      // Complete first and reset
      mockSpeechSynthesis.speaking = false;
      await act(async () => {
        mockUtterances[0].onend?.();
      });

      act(() => {
        result.current.announceNewThreat(threat2);
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    });
  });

  describe('announceClear', () => {
    it('should announce all clear after tracking threats', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      // First announce a threat
      act(() => {
        result.current.announceThreat({ hex: 'ABC123', distance_nm: 2, bearing: 0 });
      });

      mockSpeechSynthesis.speaking = false;
      await act(async () => {
        mockUtterances[0].onend?.();
      });

      // Then announce clear
      act(() => {
        result.current.announceClear();
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
      expect(mockUtterances[1].text).toBe('All clear');
    });

    it('should not announce clear if no threats were tracked', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.announceClear();
      });

      expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();
    });
  });

  describe('announceThreatCount', () => {
    it('should announce no threats detected', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.announceThreatCount(0);
      });

      expect(mockUtterances[0].text).toBe('No threats detected');
    });

    it('should announce one threat detected', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.announceThreatCount(1);
      });

      expect(mockUtterances[0].text).toBe('One threat detected');
    });

    it('should announce multiple threats detected', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.announceThreatCount(5);
      });

      expect(mockUtterances[0].text).toBe('5 threats detected');
    });
  });

  describe('stop function', () => {
    it('should cancel speech and clear queue', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.queue('First message');
      });

      mockSpeechSynthesis.speaking = true;

      act(() => {
        result.current.queue('Second message');
      });

      act(() => {
        result.current.stop();
      });

      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
      expect(result.current.isSpeaking).toBe(false);
    });
  });

  describe('clearTracking', () => {
    it('should clear announced threats tracking', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const threat = { hex: 'ABC123', distance_nm: 2, bearing: 0 };

      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);

      // Normally wouldn't announce again
      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);

      // Clear tracking
      act(() => {
        result.current.clearTracking();
      });

      // Complete any pending speech
      mockSpeechSynthesis.speaking = false;

      // Now should announce again
      act(() => {
        result.current.announceThreat(threat);
      });

      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    });
  });

  describe('voice selection', () => {
    it('should allow changing selected voice', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.setSelectedVoice(mockVoices[1]);
      });

      expect(result.current.selectedVoice).toEqual(mockVoices[1]);
    });

    it('should use selected voice when speaking', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      act(() => {
        result.current.setSelectedVoice(mockVoices[1]);
      });

      act(() => {
        result.current.speak('Test message');
      });

      expect(mockUtterances[0].voice).toEqual(mockVoices[1]);
    });
  });

  describe('direction formatting', () => {
    it('should format cardinal directions correctly', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result } = renderHook(() => useVoiceAlerts());

      const testCases = [
        { bearing: 0, expected: 'north' },
        { bearing: 90, expected: 'east' },
        { bearing: 180, expected: 'south' },
        { bearing: 270, expected: 'west' },
      ];

      for (const { bearing, expected } of testCases) {
        // Clear tracking for new threat
        act(() => {
          result.current.clearTracking();
        });
        mockSpeechSynthesis.speaking = false;

        const threat = {
          hex: `TEST${bearing}`,
          distance_nm: 2,
          bearing,
        };

        act(() => {
          result.current.announceThreat(threat);
        });

        const lastUtterance = mockUtterances[mockUtterances.length - 1];
        expect(lastUtterance.text).toContain(expected);
      }
    });
  });

  describe('cleanup', () => {
    it('should clear timeouts on unmount', async () => {
      const { useVoiceAlerts } = await import('./useVoiceAlerts');
      const { result, unmount } = renderHook(() => useVoiceAlerts());

      const threat = { hex: 'ABC123', distance_nm: 2, bearing: 0 };

      act(() => {
        result.current.announceThreat(threat);
      });

      // Should not throw on unmount
      unmount();
    });
  });
});
