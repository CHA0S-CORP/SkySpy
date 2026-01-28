/**
 * Audio test fixtures for e2e tests
 * Contains mock data for audio transmissions and related API responses
 */

export const audioTransmissions = [
  {
    id: 1,
    channel_name: 'Tower',
    frequency_mhz: 118.300,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
    duration_seconds: 8.5,
    format: 'mp3',
    file_size_bytes: 68000,
    s3_url: '/mock-audio/transmission1.mp3',
    transcription_status: 'completed',
    transcript: 'United 123 cleared for takeoff runway 28 left',
    transcript_confidence: 0.95,
    transcript_language: 'en',
    transcription_error: null,
    filename: 'tower_1706450400_118300.mp3',
    identified_airframes: [
      {
        callsign: 'UAL123',
        icao_hex: 'A12345',
        airline_icao: 'UAL',
        airline_name: 'United Airlines',
        type: 'airline',
        confidence: 0.92,
        raw_text: 'United 123'
      }
    ]
  },
  {
    id: 2,
    channel_name: 'Approach',
    frequency_mhz: 124.850,
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago
    duration_seconds: 12.3,
    format: 'mp3',
    file_size_bytes: 98400,
    s3_url: '/mock-audio/transmission2.mp3',
    transcription_status: 'completed',
    transcript: 'Delta 456 descend and maintain flight level 240',
    transcript_confidence: 0.88,
    transcript_language: 'en',
    transcription_error: null,
    filename: 'approach_1706450100_124850.mp3',
    identified_airframes: [
      {
        callsign: 'DAL456',
        icao_hex: 'B67890',
        airline_icao: 'DAL',
        airline_name: 'Delta Air Lines',
        type: 'airline',
        confidence: 0.89,
        raw_text: 'Delta 456'
      }
    ]
  },
  {
    id: 3,
    channel_name: 'Ground',
    frequency_mhz: 121.900,
    created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
    duration_seconds: 6.1,
    format: 'mp3',
    file_size_bytes: 48800,
    s3_url: '/mock-audio/transmission3.mp3',
    transcription_status: 'processing',
    transcript: null,
    transcript_confidence: null,
    transcript_language: null,
    transcription_error: null,
    filename: 'ground_1706449800_121900.mp3',
    identified_airframes: []
  },
  {
    id: 4,
    channel_name: 'Tower',
    frequency_mhz: 118.300,
    created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 minutes ago
    duration_seconds: 15.7,
    format: 'mp3',
    file_size_bytes: 125600,
    s3_url: '/mock-audio/transmission4.mp3',
    transcription_status: 'completed',
    transcript: 'Mayday mayday mayday American 789 engine failure requesting immediate return',
    transcript_confidence: 0.97,
    transcript_language: 'en',
    transcription_error: null,
    filename: 'tower_1706449500_118300.mp3',
    identified_airframes: [
      {
        callsign: 'AAL789',
        icao_hex: 'C24680',
        airline_icao: 'AAL',
        airline_name: 'American Airlines',
        type: 'airline',
        confidence: 0.96,
        raw_text: 'American 789'
      }
    ]
  },
  {
    id: 5,
    channel_name: 'ATIS',
    frequency_mhz: 127.650,
    created_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(), // 25 minutes ago
    duration_seconds: 45.2,
    format: 'mp3',
    file_size_bytes: 361600,
    s3_url: '/mock-audio/transmission5.mp3',
    transcription_status: 'completed',
    transcript: 'Information Bravo 2100 Zulu wind 280 at 12 visibility 10 miles few clouds at 3000',
    transcript_confidence: 0.91,
    transcript_language: 'en',
    transcription_error: null,
    filename: 'atis_1706449200_127650.mp3',
    identified_airframes: []
  },
  {
    id: 6,
    channel_name: 'Departure',
    frequency_mhz: 125.200,
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
    duration_seconds: 9.8,
    format: 'mp3',
    file_size_bytes: 78400,
    s3_url: '/mock-audio/transmission6.mp3',
    transcription_status: 'failed',
    transcript: null,
    transcript_confidence: null,
    transcript_language: null,
    transcription_error: 'Audio quality too low for transcription',
    filename: 'departure_1706448900_125200.mp3',
    identified_airframes: []
  },
  {
    id: 7,
    channel_name: 'Tower',
    frequency_mhz: 118.300,
    created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes ago
    duration_seconds: 7.2,
    format: 'mp3',
    file_size_bytes: 57600,
    s3_url: '/mock-audio/transmission7.mp3',
    transcription_status: 'queued',
    transcript: null,
    transcript_confidence: null,
    transcript_language: null,
    transcription_error: null,
    filename: 'tower_1706450580_118300.mp3',
    identified_airframes: []
  },
  {
    id: 8,
    channel_name: 'Approach',
    frequency_mhz: 124.850,
    created_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(), // 12 minutes ago
    duration_seconds: 11.4,
    format: 'mp3',
    file_size_bytes: 91200,
    s3_url: '/mock-audio/transmission8.mp3',
    transcription_status: 'completed',
    transcript: 'Pan pan pan pan Southwest 321 medical emergency on board requesting priority handling',
    transcript_confidence: 0.94,
    transcript_language: 'en',
    transcription_error: null,
    filename: 'approach_1706449980_124850.mp3',
    identified_airframes: [
      {
        callsign: 'SWA321',
        icao_hex: 'D13579',
        airline_icao: 'SWA',
        airline_name: 'Southwest Airlines',
        type: 'airline',
        confidence: 0.93,
        raw_text: 'Southwest 321'
      }
    ]
  },
  {
    id: 9,
    channel_name: 'Tower',
    frequency_mhz: 118.300,
    created_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(), // 8 minutes ago
    duration_seconds: 5.6,
    format: 'mp3',
    file_size_bytes: 44800,
    s3_url: '/mock-audio/transmission9.mp3',
    transcription_status: 'completed',
    transcript: 'November 12345 cleared to land runway 28 left',
    transcript_confidence: 0.87,
    transcript_language: 'en',
    transcription_error: null,
    filename: 'tower_1706450220_118300.mp3',
    identified_airframes: [
      {
        callsign: 'N12345',
        icao_hex: 'E97531',
        airline_icao: null,
        airline_name: null,
        type: 'general_aviation',
        confidence: 0.85,
        raw_text: 'November 12345'
      }
    ]
  },
  {
    id: 10,
    channel_name: 'Approach',
    frequency_mhz: 124.850,
    created_at: new Date(Date.now() - 18 * 60 * 1000).toISOString(), // 18 minutes ago
    duration_seconds: 8.9,
    format: 'mp3',
    file_size_bytes: 71200,
    s3_url: '/mock-audio/transmission10.mp3',
    transcription_status: 'completed',
    transcript: 'Air Force 1 radar contact descend and maintain 10000',
    transcript_confidence: 0.96,
    transcript_language: 'en',
    transcription_error: null,
    filename: 'approach_1706449620_124850.mp3',
    identified_airframes: [
      {
        callsign: 'AF1',
        icao_hex: 'AE0001',
        airline_icao: null,
        airline_name: 'US Air Force',
        type: 'military',
        confidence: 0.98,
        raw_text: 'Air Force 1'
      }
    ]
  }
];

export const audioStats = {
  total_transmissions: 847,
  total_transcribed: 623,
  pending_transcription: 45,
  total_duration_hours: 12.5,
  by_channel: {
    'Tower': 312,
    'Approach': 256,
    'Ground': 145,
    'Departure': 89,
    'ATIS': 45
  },
  by_status: {
    completed: 623,
    processing: 28,
    queued: 45,
    failed: 12,
    pending: 139
  }
};

export const systemStatus = {
  radio_enabled: true,
  status: 'healthy',
  version: '2.5.0',
  uptime_seconds: 86400
};

// Response builder for mocking API
export function buildAudioResponse(transmissions = audioTransmissions, stats = audioStats) {
  return {
    transmissions,
    total: transmissions.length,
    ...stats
  };
}

// Filter transmissions by status
export function filterByStatus(transmissions, status) {
  if (status === 'all') return transmissions;
  return transmissions.filter(t => t.transcription_status === status);
}

// Filter transmissions by channel
export function filterByChannel(transmissions, channel) {
  if (channel === 'all') return transmissions;
  return transmissions.filter(t => t.channel_name === channel);
}

// Filter transmissions by search query
export function filterBySearch(transmissions, query) {
  if (!query) return transmissions;
  const lowerQuery = query.toLowerCase();
  return transmissions.filter(t =>
    t.channel_name?.toLowerCase().includes(lowerQuery) ||
    t.transcript?.toLowerCase().includes(lowerQuery) ||
    t.frequency_mhz?.toString().includes(lowerQuery) ||
    t.identified_airframes?.some(af =>
      af.callsign?.toLowerCase().includes(lowerQuery) ||
      af.airline_name?.toLowerCase().includes(lowerQuery)
    )
  );
}

// WebSocket message for new transmission
export function createWebSocketTransmission(overrides = {}) {
  const defaultTransmission = {
    id: Date.now(),
    channel_name: 'Tower',
    frequency_mhz: 118.300,
    created_at: new Date().toISOString(),
    duration_seconds: 8.0,
    format: 'mp3',
    file_size_bytes: 64000,
    s3_url: '/mock-audio/live.mp3',
    transcription_status: 'queued',
    transcript: null,
    transcript_confidence: null,
    transcript_language: null,
    transcription_error: null,
    filename: `tower_${Date.now()}_118300.mp3`,
    identified_airframes: []
  };

  return {
    type: 'audio.transmission',
    data: { ...defaultTransmission, ...overrides }
  };
}

// Emergency keywords for testing
export const EMERGENCY_KEYWORDS = [
  'mayday',
  'pan pan',
  'pan-pan',
  'emergency',
  'declaring emergency',
  'fuel emergency',
  'medical emergency',
  'emergency descent',
  'squawk 7700',
  '7700',
  'souls on board',
  'distress',
  'urgent'
];

// Get transmissions with emergency keywords
export function getEmergencyTransmissions(transmissions = audioTransmissions) {
  return transmissions.filter(t => {
    if (!t.transcript) return false;
    const lowerTranscript = t.transcript.toLowerCase();
    return EMERGENCY_KEYWORDS.some(keyword => lowerTranscript.includes(keyword));
  });
}
