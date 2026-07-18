// @ts-check
import { test as base, expect } from '@playwright/test';
import { mockData } from '../../fixtures/test-setup.js';
import { screenshotState } from './screenshot-state.js';
import { animationHelpers } from './animation-helpers.js';

/**
 * Curated mock data for documentation screenshots
 * These provide visually interesting, realistic scenarios
 */
export const docMockData = {
  /**
   * Generate curated aircraft for beautiful map screenshots
   * Includes diverse aircraft types, positions, and states
   */
  generateCuratedAircraft() {
    const baseTime = Date.now() / 1000;
    return [
      // Commercial jets in flight
      {
        hex: 'A12345',
        flight: 'UAL1234',
        registration: 'N12345',
        type: 'B738',
        squawk: '1200',
        lat: 37.7849,
        lon: -122.4094,
        altitude: 35000,
        speed: 450,
        track: 45,
        vertical_rate: 0,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 1500,
        category: 'A3',
        emergency: null,
        operator: 'United Airlines',
        origin: 'SFO',
        destination: 'JFK',
      },
      {
        hex: 'A23456',
        flight: 'DAL567',
        registration: 'N23456',
        type: 'A321',
        squawk: '2341',
        lat: 37.8049,
        lon: -122.3894,
        altitude: 28000,
        speed: 420,
        track: 90,
        vertical_rate: -1500,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 890,
        category: 'A3',
        emergency: null,
        operator: 'Delta Air Lines',
        origin: 'LAX',
        destination: 'SFO',
      },
      {
        hex: 'A34567',
        flight: 'SWA789',
        registration: 'N34567',
        type: 'B737',
        squawk: '4521',
        lat: 37.7549,
        lon: -122.4494,
        altitude: 15000,
        speed: 320,
        track: 180,
        vertical_rate: 2000,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 456,
        category: 'A3',
        emergency: null,
        operator: 'Southwest Airlines',
      },
      // Wide-body international
      {
        hex: 'A45678',
        flight: 'BAW286',
        registration: 'G-XWBA',
        type: 'A350',
        squawk: '6712',
        lat: 37.8249,
        lon: -122.3594,
        altitude: 39000,
        speed: 490,
        track: 315,
        vertical_rate: 0,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 2100,
        category: 'A5',
        emergency: null,
        operator: 'British Airways',
        origin: 'LHR',
        destination: 'SFO',
      },
      // Cargo aircraft
      {
        hex: 'A56789',
        flight: 'FDX123',
        registration: 'N56789',
        type: 'B77F',
        squawk: '3456',
        lat: 37.7149,
        lon: -122.4894,
        altitude: 32000,
        speed: 480,
        track: 270,
        vertical_rate: 500,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 780,
        category: 'A5',
        emergency: null,
        operator: 'FedEx',
      },
      // Regional jet
      {
        hex: 'A67890',
        flight: 'SKW4521',
        registration: 'N67890',
        type: 'E175',
        squawk: '5432',
        lat: 37.7649,
        lon: -122.3794,
        altitude: 22000,
        speed: 380,
        track: 135,
        vertical_rate: -800,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 345,
        category: 'A3',
        emergency: null,
        operator: 'SkyWest Airlines',
      },
      // Private jet
      {
        hex: 'A78901',
        flight: 'N789GS',
        registration: 'N789GS',
        type: 'G650',
        squawk: '1234',
        lat: 37.7949,
        lon: -122.4294,
        altitude: 41000,
        speed: 510,
        track: 60,
        vertical_rate: 0,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 234,
        category: 'A2',
        emergency: null,
        operator: 'Private',
      },
      // Helicopter - news
      {
        hex: 'A89012',
        flight: 'N7NEWS',
        registration: 'N7NEWS',
        type: 'AS50',
        squawk: '0000',
        lat: 37.7749,
        lon: -122.4194,
        altitude: 1500,
        speed: 80,
        track: 240,
        vertical_rate: 0,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 567,
        category: 'A7',
        emergency: null,
        operator: 'KRON News',
      },
      // Military aircraft
      {
        hex: 'AE1234',
        flight: 'RCH123',
        registration: '05-5139',
        type: 'C17',
        squawk: '7777',
        lat: 37.8449,
        lon: -122.2994,
        altitude: 25000,
        speed: 420,
        track: 200,
        vertical_rate: -500,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 890,
        category: 'A5',
        emergency: null,
        operator: 'US Air Force',
        is_military: true,
      },
      // Coast Guard
      {
        hex: 'AE5678',
        flight: 'USCG65',
        registration: '6545',
        type: 'HC130',
        squawk: '1277',
        lat: 37.6949,
        lon: -122.5094,
        altitude: 8000,
        speed: 280,
        track: 350,
        vertical_rate: 0,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 456,
        category: 'A5',
        emergency: null,
        operator: 'US Coast Guard',
        is_military: true,
      },
      // Emergency aircraft - squawking 7700
      {
        hex: 'A90123',
        flight: 'AAL456',
        registration: 'N90123',
        type: 'B772',
        squawk: '7700',
        lat: 37.7349,
        lon: -122.4594,
        altitude: 12000,
        speed: 250,
        track: 90,
        vertical_rate: -2500,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 2345,
        category: 'A5',
        emergency: 'general',
        operator: 'American Airlines',
        origin: 'DFW',
        destination: 'SFO',
      },
      // VIP aircraft (Air Force One pattern)
      {
        hex: 'ADFDF8',
        flight: 'SAM38',
        registration: '92-9000',
        type: 'VC25',
        squawk: '0001',
        lat: 37.8649,
        lon: -122.2694,
        altitude: 30000,
        speed: 460,
        track: 280,
        vertical_rate: -1000,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 4567,
        category: 'A5',
        emergency: null,
        operator: 'US Air Force',
        is_military: true,
        is_interesting: true,
      },
      // Small GA aircraft
      {
        hex: 'A01234',
        flight: 'N172SP',
        registration: 'N172SP',
        type: 'C172',
        squawk: '1200',
        lat: 37.6549,
        lon: -122.3894,
        altitude: 3500,
        speed: 110,
        track: 180,
        vertical_rate: 500,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 123,
        category: 'A1',
        emergency: null,
        operator: 'Private',
      },
      // Turboprop
      {
        hex: 'A11234',
        flight: 'EJA456',
        registration: 'N456QS',
        type: 'PC12',
        squawk: '3456',
        lat: 37.7049,
        lon: -122.5294,
        altitude: 25000,
        speed: 280,
        track: 45,
        vertical_rate: 0,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 345,
        category: 'A1',
        emergency: null,
        operator: 'NetJets',
      },
      // International carrier
      {
        hex: 'A21234',
        flight: 'JAL1',
        registration: 'JA873J',
        type: 'B789',
        squawk: '5678',
        lat: 37.8849,
        lon: -122.2394,
        altitude: 37000,
        speed: 500,
        track: 300,
        vertical_rate: 0,
        seen: baseTime,
        seen_pos: baseTime,
        messages: 1890,
        category: 'A5',
        emergency: null,
        operator: 'Japan Airlines',
        origin: 'NRT',
        destination: 'SFO',
      },
    ];
  },

  /**
   * Generate curated ACARS messages for communications tab
   */
  generateCuratedAcars() {
    const baseTime = Date.now();
    return [
      {
        id: 1,
        timestamp: new Date(baseTime - 30000).toISOString(),
        flight: 'UAL1234',
        registration: 'N12345',
        label: 'H1',
        text: 'POS REPORT N37.78 W122.41 ALT 35000 GS 450 HDG 045',
        mode: 'VHF',
        frequency: 131.550,
        signal_strength: -45,
      },
      {
        id: 2,
        timestamp: new Date(baseTime - 120000).toISOString(),
        flight: 'DAL567',
        registration: 'N23456',
        label: 'SA',
        text: 'ATIS INFO ALPHA WIND 280/12 VIS 10SM FEW250 TEMP 18/08 A3002',
        mode: 'VHF',
        frequency: 130.025,
        signal_strength: -52,
      },
      {
        id: 3,
        timestamp: new Date(baseTime - 300000).toISOString(),
        flight: 'AAL456',
        registration: 'N90123',
        label: 'B6',
        text: 'FREETEXT DECLARING EMERGENCY MEDICAL DIVERT SFO',
        mode: 'VHF',
        frequency: 131.550,
        signal_strength: -38,
      },
      {
        id: 4,
        timestamp: new Date(baseTime - 450000).toISOString(),
        flight: 'BAW286',
        registration: 'G-XWBA',
        label: 'H1',
        text: 'ETA UPDATE KSFO 1845Z FUEL 45.2 TONS PAX 287',
        mode: 'VHF',
        frequency: 131.725,
        signal_strength: -61,
      },
      {
        id: 5,
        timestamp: new Date(baseTime - 600000).toISOString(),
        flight: 'FDX123',
        registration: 'N56789',
        label: 'Q0',
        text: 'CREW UPDATE DELAY EXPECTED CARGO HANDLING OAK',
        mode: 'VHF',
        frequency: 130.450,
        signal_strength: -48,
      },
    ];
  },

  /**
   * Generate curated alert rules for documentation
   */
  generateCuratedAlertRules() {
    return [
      {
        id: 1,
        name: 'Emergency Squawk Alert',
        description: 'Alert when aircraft squawks emergency code (7500, 7600, 7700)',
        enabled: true,
        conditions: [
          { field: 'squawk', operator: 'in', value: ['7500', '7600', '7700'] },
        ],
        actions: ['push_notification', 'email', 'sound'],
        priority: 'critical',
        created_at: '2024-01-15T10:30:00Z',
        triggered_count: 3,
        last_triggered: '2024-02-01T14:22:00Z',
      },
      {
        id: 2,
        name: 'Military Aircraft Nearby',
        description: 'Alert when military aircraft enters coverage area',
        enabled: true,
        conditions: [
          { field: 'category', operator: 'equals', value: 'military' },
          { field: 'distance_nm', operator: 'less_than', value: 50 },
        ],
        actions: ['push_notification'],
        priority: 'high',
        created_at: '2024-01-20T08:15:00Z',
        triggered_count: 47,
        last_triggered: '2024-02-02T09:45:00Z',
      },
      {
        id: 3,
        name: 'Low Altitude Alert',
        description: 'Large aircraft flying below 5000ft outside airport zone',
        enabled: true,
        conditions: [
          { field: 'altitude', operator: 'less_than', value: 5000 },
          { field: 'category', operator: 'in', value: ['A3', 'A4', 'A5'] },
          { field: 'distance_from_airport', operator: 'greater_than', value: 10 },
        ],
        actions: ['push_notification', 'sound'],
        priority: 'medium',
        created_at: '2024-01-25T16:00:00Z',
        triggered_count: 12,
        last_triggered: '2024-02-01T18:30:00Z',
      },
      {
        id: 4,
        name: 'Interesting Aircraft',
        description: 'Notable registrations, callsigns, or aircraft types',
        enabled: true,
        conditions: [
          {
            field: 'any',
            operator: 'matches',
            value: {
              registration: ['N1', 'AF1', 'SAM'],
              type: ['VC25', 'E4B', 'C32'],
              callsign: ['EXEC', 'SAM', 'VENUS'],
            },
          },
        ],
        actions: ['push_notification'],
        priority: 'low',
        created_at: '2024-02-01T12:00:00Z',
        triggered_count: 5,
        last_triggered: '2024-02-02T11:15:00Z',
      },
      {
        id: 5,
        name: 'Speed Record Alert',
        description: 'Aircraft exceeding 600 knots ground speed',
        enabled: false,
        conditions: [
          { field: 'ground_speed', operator: 'greater_than', value: 600 },
        ],
        actions: ['push_notification'],
        priority: 'low',
        created_at: '2024-02-02T09:00:00Z',
        triggered_count: 0,
        last_triggered: null,
      },
    ];
  },

  /**
   * Generate curated safety events for safety view
   */
  generateCuratedSafetyEvents() {
    const baseTime = Date.now();
    return [
      {
        id: 1,
        event_type: 'tcas_ra',
        severity: 'critical',
        timestamp: new Date(baseTime - 300000).toISOString(),
        aircraft_1: { hex: 'A12345', flight: 'UAL1234', type: 'B738' },
        aircraft_2: { hex: 'A23456', flight: 'DAL567', type: 'A321' },
        min_separation_ft: 800,
        min_separation_nm: 1.2,
        resolution: 'climb',
        location: { lat: 37.78, lon: -122.40 },
      },
      {
        id: 2,
        event_type: 'altitude_deviation',
        severity: 'warning',
        timestamp: new Date(baseTime - 1800000).toISOString(),
        aircraft_1: { hex: 'A34567', flight: 'SWA789', type: 'B737' },
        deviation_ft: 350,
        assigned_altitude: 15000,
        actual_altitude: 15350,
        location: { lat: 37.75, lon: -122.45 },
      },
      {
        id: 3,
        event_type: 'go_around',
        severity: 'info',
        timestamp: new Date(baseTime - 3600000).toISOString(),
        aircraft_1: { hex: 'A67890', flight: 'SKW4521', type: 'E175' },
        runway: '28R',
        reason: 'unstabilized_approach',
        airport: 'KSFO',
        location: { lat: 37.62, lon: -122.38 },
      },
    ];
  },

  /**
   * Generate curated history sessions
   */
  generateCuratedHistorySessions() {
    const baseTime = Date.now();
    return [
      {
        id: 1,
        start_time: new Date(baseTime - 7200000).toISOString(),
        end_time: new Date(baseTime - 3600000).toISOString(),
        duration_minutes: 60,
        aircraft_count: 45,
        messages_received: 12500,
        unique_aircraft: 38,
        peak_aircraft: 52,
        coverage_score: 0.94,
      },
      {
        id: 2,
        start_time: new Date(baseTime - 86400000).toISOString(),
        end_time: new Date(baseTime - 82800000).toISOString(),
        duration_minutes: 60,
        aircraft_count: 67,
        messages_received: 18900,
        unique_aircraft: 54,
        peak_aircraft: 71,
        coverage_score: 0.97,
      },
      {
        id: 3,
        start_time: new Date(baseTime - 172800000).toISOString(),
        end_time: new Date(baseTime - 169200000).toISOString(),
        duration_minutes: 60,
        aircraft_count: 32,
        messages_received: 8400,
        unique_aircraft: 28,
        peak_aircraft: 35,
        coverage_score: 0.88,
      },
    ];
  },

  /**
   * Generate curated NOTAMs for the History → NOTAMs / Archive tabs
   * (`/api/v1/notams/`). Shape mirrors the backend NOTAM serializer.
   */
  generateCuratedNotams() {
    const baseTime = Date.now();
    return [
      {
        id: 1,
        notam_id: 'KLAX-A0842/25',
        notam_type: 'D',
        location: 'KLAX',
        text: 'RWY 07L/25R CLSD FOR MAINT. TWY B BTN TWY C AND TWY D CLSD.',
        latitude: 33.9425,
        longitude: -118.4081,
        radius_nm: 5,
        floor_ft: 0,
        ceiling_ft: 0,
        is_permanent: false,
        is_active: true,
        effective_start: new Date(baseTime - 2 * 86400000).toISOString(),
        effective_end: new Date(baseTime + 5 * 86400000).toISOString(),
      },
      {
        id: 2,
        notam_id: 'FDC 5/1234',
        notam_type: 'FDC',
        location: 'KVNY',
        text: 'IAP VAN NUYS, VAN NUYS, CA. RNAV (GPS) RWY 16R, AMDT 1B... MINIMA NA.',
        latitude: 34.2098,
        longitude: -118.4899,
        radius_nm: 3,
        floor_ft: 0,
        ceiling_ft: 5000,
        is_permanent: false,
        is_active: true,
        effective_start: new Date(baseTime - 6 * 86400000).toISOString(),
        effective_end: new Date(baseTime + 12 * 86400000).toISOString(),
      },
      {
        id: 3,
        notam_id: 'GPS 12/045',
        notam_type: 'GPS',
        location: 'KBUR',
        text: 'GPS RAIM OUTAGE PREDICTED WI 20NM RADIUS OF BUR.',
        latitude: 34.2007,
        longitude: -118.359,
        radius_nm: 20,
        floor_ft: 0,
        ceiling_ft: 18000,
        is_permanent: false,
        is_active: true,
        effective_start: new Date(baseTime - 1 * 86400000).toISOString(),
        effective_end: new Date(baseTime + 3 * 86400000).toISOString(),
      },
      {
        id: 4,
        notam_id: 'KLAX-A0901/25',
        notam_type: 'MIL',
        location: 'KLAX',
        text: 'MIL OPS WI 15NM RADIUS OF LAX SFC-8000FT. CTC ATC.',
        latitude: 33.9416,
        longitude: -118.4085,
        radius_nm: 15,
        floor_ft: 0,
        ceiling_ft: 8000,
        is_permanent: false,
        is_active: true,
        effective_start: new Date(baseTime - 3 * 86400000).toISOString(),
        effective_end: new Date(baseTime + 8 * 86400000).toISOString(),
      },
    ];
  },

  /**
   * Generate curated national TFRs for the History → NOTAMs / Archive tabs
   * (`/api/v1/notams/tfrs/`).
   */
  generateCuratedTfrs() {
    const baseTime = Date.now();
    return [
      {
        id: 'tfr-1',
        notam_id: 'TFR 5/2871',
        notam_type: 'TFR',
        is_tfr: true,
        location: 'KLAX',
        text: 'AIRSPACE SPECIAL SECURITY INSTRUCTIONS WI AN AREA DEFINED AS 10NM RADIUS OF LAX SFC-4000FT.',
        latitude: 33.9416,
        longitude: -118.4085,
        radius_nm: 10,
        floor_ft: 0,
        ceiling_ft: 4000,
        is_permanent: false,
        is_active: true,
        effective_start: new Date(baseTime - 1 * 86400000).toISOString(),
        effective_end: new Date(baseTime + 2 * 86400000).toISOString(),
      },
    ];
  },

  /**
   * Generate curated PIREPs for the History → PIREPs / Archive tabs
   * (`/api/v1/aviation/pireps/`, payload keyed under `data`).
   */
  generateCuratedPireps() {
    const baseTime = Date.now();
    return [
      {
        pirep_id: 'PIREP-1001',
        report_type: 'UUA',
        location: 'KLAX',
        observation_time: new Date(baseTime - 2 * 3600000).toISOString(),
        aircraft_type: 'B738',
        altitude_ft: 12000,
        flight_level: 120,
        sky_cover: 'BKN',
        visibility_sm: 6,
        weather: 'RA',
        temperature_c: 4,
        wind_dir: 250,
        wind_speed_kt: 35,
        turbulence_type: 'CHOP',
        turbulence_freq: 'OCNL',
        turbulence_intensity: 'MOD',
        turbulence_base_ft: 10000,
        turbulence_top_ft: 14000,
        icing_type: 'RIME',
        icing_intensity: 'LGT',
        icing_base_ft: 11000,
        icing_top_ft: 13000,
        raw_text: 'LAX UUA /OV LAX180010/TM 1830/FL120/TP B738/TB MOD/IC LGT RIME/RM DURGC',
      },
      {
        pirep_id: 'PIREP-1002',
        report_type: 'UA',
        location: 'KVNY',
        observation_time: new Date(baseTime - 5 * 3600000).toISOString(),
        aircraft_type: 'C172',
        altitude_ft: 6500,
        flight_level: null,
        sky_cover: 'SCT',
        visibility_sm: 10,
        weather: null,
        temperature_c: 12,
        wind_dir: 270,
        wind_speed_kt: 15,
        turbulence_type: null,
        turbulence_freq: null,
        turbulence_intensity: 'SMTH',
        turbulence_base_ft: null,
        turbulence_top_ft: null,
        icing_type: null,
        icing_intensity: 'NEG',
        icing_base_ft: null,
        icing_top_ft: null,
        raw_text: 'VNY UA /OV VNY/TM 1530/FL065/TP C172/SK SCT/TA 12/WV 27015/TB SMTH',
      },
      {
        pirep_id: 'PIREP-1003',
        report_type: 'UUA',
        location: 'KBUR',
        observation_time: new Date(baseTime - 8 * 3600000).toISOString(),
        aircraft_type: 'A320',
        altitude_ft: 34000,
        flight_level: 340,
        sky_cover: 'CLR',
        visibility_sm: null,
        weather: null,
        temperature_c: -48,
        wind_dir: 290,
        wind_speed_kt: 95,
        turbulence_type: 'CAT',
        turbulence_freq: 'CONS',
        turbulence_intensity: 'SEV',
        turbulence_base_ft: 33000,
        turbulence_top_ft: 35000,
        icing_type: null,
        icing_intensity: 'NEG',
        icing_base_ft: null,
        icing_top_ft: null,
        raw_text: 'BUR UUA /OV BUR/TM 1200/FL340/TP A320/TB SEV CAT/RM DURGC',
      },
    ];
  },

  /**
   * Generate curated NOTAM summary stats for the History → Archive tab
   * (`/api/v1/notams/stats/`; shape consumed by ArchiveTab.adaptNotamStats).
   */
  generateCuratedNotamStats() {
    return {
      active_notams: 214,
      active_tfrs: 6,
      last_refresh: new Date().toISOString(),
      by_type: { D: 118, FDC: 52, TFR: 6, GPS: 21, MIL: 14, POINTER: 3 },
    };
  },

  /**
   * Generate curated stats for dashboard
   */
  generateCuratedStats() {
    return {
      today: {
        aircraft_seen: 847,
        messages_received: 245678,
        acars_messages: 156,
        alerts_triggered: 12,
        peak_aircraft: 89,
        coverage_hours: 18.5,
      },
      week: {
        aircraft_seen: 4523,
        messages_received: 1567890,
        acars_messages: 892,
        alerts_triggered: 67,
        unique_aircraft: 2156,
      },
      month: {
        aircraft_seen: 18945,
        messages_received: 6789012,
        acars_messages: 3456,
        alerts_triggered: 234,
        unique_aircraft: 8234,
      },
      top_aircraft_types: [
        { type: 'B738', count: 1234 },
        { type: 'A320', count: 1089 },
        { type: 'B77W', count: 567 },
        { type: 'A321', count: 456 },
        { type: 'E175', count: 345 },
      ],
      top_operators: [
        { name: 'United Airlines', count: 2345 },
        { name: 'Delta Air Lines', count: 1890 },
        { name: 'American Airlines', count: 1567 },
        { name: 'Southwest Airlines', count: 1234 },
        { name: 'Alaska Airlines', count: 678 },
      ],
    };
  },

  /**
   * Generate curated audio transmissions
   */
  generateCuratedAudioTransmissions() {
    const baseTime = Date.now();
    return [
      {
        id: 1,
        timestamp: new Date(baseTime - 30000).toISOString(),
        frequency: 120.500,
        frequency_name: 'NorCal Approach',
        duration_seconds: 8.5,
        signal_strength: -42,
        has_transcript: true,
        transcript: 'United 1234 descend and maintain flight level two four zero',
        aircraft_hex: 'A12345',
        flight: 'UAL1234',
      },
      {
        id: 2,
        timestamp: new Date(baseTime - 90000).toISOString(),
        frequency: 118.850,
        frequency_name: 'SFO Tower',
        duration_seconds: 5.2,
        signal_strength: -38,
        has_transcript: true,
        transcript: 'Delta 567 cleared to land runway two eight right',
        aircraft_hex: 'A23456',
        flight: 'DAL567',
      },
      {
        id: 3,
        timestamp: new Date(baseTime - 180000).toISOString(),
        frequency: 121.500,
        frequency_name: 'Guard',
        duration_seconds: 12.3,
        signal_strength: -55,
        has_transcript: true,
        transcript: 'MAYDAY MAYDAY American 456 declaring emergency medical diversion SFO',
        aircraft_hex: 'A90123',
        flight: 'AAL456',
        is_emergency: true,
      },
    ];
  },

  /**
   * Generate curated Cannonball threats for dramatic screenshots
   */
  generateCuratedCannonballThreats() {
    const userPosition = { lat: 37.7749, lon: -122.4194 };
    return [
      {
        icao_hex: 'A00001',
        hex: 'A00001',
        callsign: 'N911LA',
        category: 'Law Enforcement',
        description: 'LAPD Air Support Division helicopter',
        distance_nm: 2.3,
        bearing: 45,
        direction: 'NE',
        altitude: 1200,
        ground_speed: 65,
        track: 225,
        trend: 'approaching',
        threat_level: 'critical',
        is_law_enforcement: true,
        is_helicopter: true,
        is_known_le: true,
        known_le: true,
        lat: userPosition.lat + 0.033,
        lon: userPosition.lon + 0.033,
        closing_speed: 55,
        urgency_score: 92,
        patterns: [{ type: 'circling', confidence_score: 0.89 }],
        agency_name: 'LAPD Air Support',
        agency_type: 'local',
        operator_name: 'LAPD Air Support Division',
      },
      {
        icao_hex: 'A00002',
        hex: 'A00002',
        callsign: 'CHP452',
        category: 'State Police',
        description: 'California Highway Patrol fixed-wing',
        distance_nm: 5.8,
        bearing: 180,
        direction: 'S',
        altitude: 3500,
        ground_speed: 140,
        track: 0,
        trend: 'approaching',
        threat_level: 'warning',
        is_law_enforcement: true,
        is_helicopter: false,
        is_known_le: true,
        known_le: true,
        lat: userPosition.lat - 0.097,
        lon: userPosition.lon,
        closing_speed: 32,
        urgency_score: 68,
        patterns: [{ type: 'grid_search', confidence_score: 0.72 }],
        agency_name: 'California Highway Patrol',
        agency_type: 'state',
        operator_name: 'CHP Aviation Unit',
      },
      {
        icao_hex: 'A00003',
        hex: 'A00003',
        callsign: 'N7NEWS',
        category: 'News Helicopter',
        description: 'News helicopter - not law enforcement',
        distance_nm: 8.2,
        bearing: 270,
        direction: 'W',
        altitude: 2000,
        ground_speed: 85,
        track: 90,
        trend: 'holding',
        threat_level: 'info',
        is_law_enforcement: false,
        is_helicopter: true,
        is_known_le: false,
        known_le: false,
        lat: userPosition.lat,
        lon: userPosition.lon - 0.137,
        closing_speed: -5,
        urgency_score: 25,
        patterns: [],
        agency_name: null,
        agency_type: null,
        operator_name: 'KRON News',
      },
    ];
  },

  /**
   * Curated payloads for the Advanced Analytics screen (scatter explorer,
   * correlation matrix, cross-domain rollup, geographic + flight-pattern panels).
   * Shapes mirror the backend endpoints consumed by useAnalyticsData.js.
   */
  generateCuratedAnalytics() {
    const fields = [
      { key: 'altitude_baro', label: 'Altitude', unit: 'ft' },
      { key: 'ground_speed', label: 'Ground Speed', unit: 'kts' },
      { key: 'distance_nm', label: 'Distance', unit: 'nm' },
      { key: 'rssi', label: 'Signal (RSSI)', unit: 'dBFS' },
      { key: 'vertical_rate', label: 'Vertical Rate', unit: 'ft/min' },
      { key: 'hour', label: 'Hour of Day', unit: 'h' },
    ];
    // Deterministic scatter cloud with a mild positive altitude→speed trend
    const points = Array.from({ length: 120 }, (_, i) => {
      const x = 5000 + ((i * 37) % 350) * 100;
      const y = 180 + ((i * 53) % 300) + x / 400;
      return { x, y };
    });
    const matrix = [
      [1, 0.62, -0.31, 0.18, 0.05, -0.12],
      [0.62, 1, -0.44, 0.27, 0.11, -0.08],
      [-0.31, -0.44, 1, -0.52, -0.07, 0.21],
      [0.18, 0.27, -0.52, 1, 0.03, -0.15],
      [0.05, 0.11, -0.07, 0.03, 1, 0.44],
      [-0.12, -0.08, 0.21, -0.15, 0.44, 1],
    ];
    return {
      fields: { fields },
      scatter: { points, slope: 0.0042, intercept: 165, r: 0.62, n: points.length, sampled: false },
      matrix: { fields, matrix },
      crossDomain: {
        aircraft: [
          { registration: 'N90123', icao_hex: 'A90123', alerts: 3, safety_events: 1, acars: 12 },
          { registration: 'RCH123', icao_hex: 'AE1234', alerts: 5, safety_events: 0, acars: 4 },
          { registration: 'G-XWBA', icao_hex: 'A45678', alerts: 1, safety_events: 0, acars: 21 },
          { registration: 'N7NEWS', icao_hex: 'A89012', alerts: 2, safety_events: 0, acars: 0 },
          { registration: 'SAM38', icao_hex: 'ADFDF8', alerts: 8, safety_events: 2, acars: 6 },
        ],
      },
      correlation: {
        // The screen maps these as arrays of banded averages.
        altitude_vs_speed: [
          { altitude_band: '0–10k', avg_speed: 240 },
          { altitude_band: '10–20k', avg_speed: 320 },
          { altitude_band: '20–30k', avg_speed: 420 },
          { altitude_band: '30–40k', avg_speed: 470 },
          { altitude_band: '40k+', avg_speed: 500 },
        ],
        distance_vs_altitude: [
          { distance_band: '0–25nm', avg_altitude: 6000 },
          { distance_band: '25–50nm', avg_altitude: 14000 },
          { distance_band: '50–100nm', avg_altitude: 26000 },
          { distance_band: '100–150nm', avg_altitude: 34000 },
          { distance_band: '150nm+', avg_altitude: 39000 },
        ],
      },
      countries: {
        countries: [
          { country: 'United States', count: 1245 },
          { country: 'Canada', count: 210 },
          { country: 'United Kingdom', count: 142 },
          { country: 'Germany', count: 118 },
          { country: 'France', count: 96 },
          { country: 'Japan', count: 74 },
          { country: 'Mexico', count: 61 },
          { country: 'Ireland', count: 38 },
        ],
      },
      operators: {
        operators: [
          { operator: 'United Airlines', count: 342 },
          { operator: 'Delta Air Lines', count: 288 },
          { operator: 'American Airlines', count: 254 },
          { operator: 'Southwest Airlines', count: 201 },
          { operator: 'SkyWest Airlines', count: 143 },
          { operator: 'FedEx', count: 98 },
          { operator: 'Alaska Airlines', count: 87 },
          { operator: 'NetJets', count: 52 },
        ],
      },
      busiestHours: {
        busiest_hours: Array.from({ length: 24 }, (_, h) => ({
          hour: h,
          position_count: Math.round(200 + 800 * Math.sin(((h - 6) / 24) * Math.PI) ** 2),
          unique_aircraft: 20 + ((h * 7) % 40),
        })),
      },
      routes: {
        total_routes: 148,
        routes: [
          { route_key: 'SFO-JFK', origin: 'SFO', destination: 'JFK', count: 62, sample_callsigns: ['UAL1234', 'AAL22'] },
          { route_key: 'LAX-SFO', origin: 'LAX', destination: 'SFO', count: 54, sample_callsigns: ['DAL567'] },
          { route_key: 'LHR-SFO', origin: 'LHR', destination: 'SFO', count: 33, sample_callsigns: ['BAW286'] },
          { route_key: 'SEA-SFO', origin: 'SEA', destination: 'SFO', count: 29, sample_callsigns: ['ASA411'] },
          { route_key: 'ORD-SFO', origin: 'ORD', destination: 'SFO', count: 24, sample_callsigns: ['UAL88'] },
        ],
      },
      aircraftTypes: {
        total_types: 96,
        aircraft_types: [
          { type_code: 'B738', type_name: 'Boeing 737-800', manufacturer: 'Boeing', session_count: 412, unique_aircraft: 210, military_pct: 0 },
          { type_code: 'A320', type_name: 'Airbus A320', manufacturer: 'Airbus', session_count: 356, unique_aircraft: 188, military_pct: 0 },
          { type_code: 'A321', type_name: 'Airbus A321', manufacturer: 'Airbus', session_count: 233, unique_aircraft: 121, military_pct: 0 },
          { type_code: 'E175', type_name: 'Embraer 175', manufacturer: 'Embraer', session_count: 189, unique_aircraft: 96, military_pct: 0 },
          { type_code: 'C17', type_name: 'Boeing C-17', manufacturer: 'Boeing', session_count: 41, unique_aircraft: 12, military_pct: 100 },
        ],
      },
      militaryBreakdown: {
        military_breakdown: [
          { country: 'United States', military_count: 96, civilian_count: 1149, total: 1245, military_pct: 7.7 },
          { country: 'United Kingdom', military_count: 14, civilian_count: 128, total: 142, military_pct: 9.9 },
          { country: 'Canada', military_count: 9, civilian_count: 201, total: 210, military_pct: 4.3 },
          { country: 'Germany', military_count: 6, civilian_count: 112, total: 118, military_pct: 5.1 },
        ],
      },
    };
  },

  /**
   * Curated payloads for the System screen — status/health/info/databases plus
   * safety-monitor, ACARS and notifications status. Shapes mirror the endpoints
   * consumed by useSystemData.js + systemModel.js derivations.
   */
  generateCuratedSystem() {
    return {
      status: {
        status: 'healthy',
        uptime: 864000,
        version: '2.5.0',
        cpu_percent: 34,
        memory_percent: 58,
        memory_used_gb: 4.6,
        memory_total_gb: 8,
        load_average: 0.82,
        sdr_temp: 48,
        sdr_gain: 42,
        receiver_online: true,
        adsb_online: true,
        redis_enabled: true,
        celery_running: true,
        websocket_connections: 7,
        antenna: { max_range_nm: 214.6, avg_range_nm: 128.3, coverage_percentage: 78 },
        libacars: { available: true, stats: { decoded: 1284, errors: 3 }, error: null },
        receivers: {
          adsb: { connected: true, messages_per_second: 185 },
          acars: { connected: true, messages_per_second: 8 },
        },
        database: { connected: true, size_mb: 2048 },
      },
      health: {
        status: 'healthy',
        services: {
          adsb: { status: 'up', uptime: '10d', latency_ms: 4, last_check: '14:30:00' },
          database: { status: 'up', uptime: '10d', latency_ms: 2, last_check: '14:30:00' },
          cache: { status: 'up', uptime: '10d', latency_ms: 1, last_check: '14:30:00' },
          celery: { status: 'up', uptime: '10d', last_check: '14:30:00' },
          websocket: { status: 'up', uptime: '10d', last_check: '14:30:00' },
          api: { status: 'up', uptime: '10d', latency_ms: 12, last_check: '14:30:00' },
          libacars: { status: 'up', issues: [] },
        },
      },
      info: { version: '2.5.0', cpu_percent: 34, memory_percent: 58, python: '3.12', platform: 'linux' },
      databases: {
        databases: [
          { name: 'PostgreSQL', connected: true, size_mb: 2048, tables: 84 },
          { name: 'Redis (cache)', connected: true, size_mb: 64, keys: 1820 },
        ],
      },
      safetyStatus: { enabled: true, running: true, monitored_aircraft: 42, events_today: 3 },
      acarsStats: { total: 156, last_hour: 8, decoded: 152, errors: 4 },
      acarsStatus: { connected: true, mode: 'VHF', messages_per_second: 8 },
      notifConfig: {
        channels: [
          { name: 'Discord', enabled: true },
          { name: 'Email', enabled: true },
          { name: 'Push', enabled: false },
        ],
      },
    };
  },

  /**
   * Curated runtime configuration for the Admin Config screen. Shape mirrors
   * GET /api/v1/admin/config/ ({ categories: [{ name, configs: [...] }] }) plus
   * a small audit log.
   */
  generateCuratedAdminConfig() {
    return {
      config: {
        categories: [
          {
            name: 'General',
            description: 'Site identity and defaults',
            configs: [
              { key: 'SITE_NAME', value: 'SkySpy', data_type: 'str', description: 'Public site name' },
              { key: 'FEEDER_LAT', value: '37.7749', data_type: 'float', description: 'Antenna latitude' },
              { key: 'FEEDER_LON', value: '-122.4194', data_type: 'float', description: 'Antenna longitude' },
            ],
          },
          {
            name: 'Authentication',
            description: 'Access control',
            configs: [
              { key: 'AUTH_MODE', value: 'public', data_type: 'str', description: 'public | private | hybrid' },
              { key: 'OIDC_ENABLED', value: 'false', data_type: 'bool', description: 'Enable OIDC/SSO' },
            ],
          },
          {
            name: 'Safety Monitoring',
            description: 'Emergency + proximity detection',
            configs: [
              { key: 'SAFETY_MONITORING_ENABLED', value: 'true', data_type: 'bool', description: 'Master safety toggle' },
              { key: 'PROXIMITY_NM', value: '3.0', data_type: 'float', description: 'Proximity alert radius (nm)' },
            ],
          },
        ],
      },
      auditLog: {
        results: [
          { id: 1, key: 'SITE_NAME', old_value: 'ADS-B', new_value: 'SkySpy', user: 'admin', timestamp: '2024-02-15T14:12:00Z' },
          { id: 2, key: 'PROXIMITY_NM', old_value: '5.0', new_value: '3.0', user: 'admin', timestamp: '2024-02-15T13:48:00Z' },
        ],
      },
    };
  },
};

/**
 * Extended test fixture for documentation screenshots
 */
export const test = base.extend({
  /**
   * Doc-specific mock API with curated data
   */
  docMockApi: async ({ page }, use) => {
    const mocks = new Map();

    const docMockApi = {
      /**
       * Set up a mock response for an API endpoint
       */
      async mock(path, response, options = {}) {
        const { status = 200, headers = {}, method = '*' } = options;
        const fullPath = path.startsWith('/api') ? path : `/api/v1${path}`;

        mocks.set(fullPath, { response, status, headers, method });

        await page.route(`**${fullPath}*`, async (route) => {
          const request = route.request();
          const mockConfig = mocks.get(fullPath);

          if (mockConfig.method !== '*' && request.method() !== mockConfig.method) {
            return route.continue();
          }

          const responseData =
            typeof mockConfig.response === 'function'
              ? mockConfig.response(request)
              : mockConfig.response;

          await route.fulfill({
            status: mockConfig.status,
            contentType: 'application/json',
            headers: mockConfig.headers,
            body: JSON.stringify(responseData),
          });
        });
      },

      /**
       * Set up all curated mocks for a complete documentation scenario
       */
      async setupAllMocks() {
        // Auth config - public mode
        await this.mock('/auth/config', {
          auth_enabled: false,
          auth_mode: 'public',
          oidc_enabled: false,
        });

        // System status (rich shape drives the System screen gauges + services)
        const system = docMockData.generateCuratedSystem();
        await this.mock('/system/status', system.status);

        // Aircraft
        await this.mock('/aircraft', {
          aircraft: docMockData.generateCuratedAircraft(),
          now: Date.now() / 1000,
        });

        // ACARS
        await this.mock('/acars', {
          messages: docMockData.generateCuratedAcars(),
        });

        // Alerts
        await this.mock('/alerts/rules', docMockData.generateCuratedAlertRules());

        // Stats
        await this.mock('/stats/summary', docMockData.generateCuratedStats());
        await this.mock('/stats/today', docMockData.generateCuratedStats().today);
        await this.mock('/stats/week', docMockData.generateCuratedStats().week);

        // History sessions
        await this.mock('/history/sessions', {
          sessions: docMockData.generateCuratedHistorySessions(),
        });

        // History → NOTAMs / PIREPs / Archive tabs. Register the /notams/stats/
        // sub-path AFTER the base /notams/ so it wins under Playwright's
        // most-recent-route-first matching.
        await this.mock('/notams/', { notams: docMockData.generateCuratedNotams() });
        await this.mock('/notams/tfrs/', { tfrs: docMockData.generateCuratedTfrs() });
        await this.mock('/notams/stats/', docMockData.generateCuratedNotamStats());
        await this.mock('/aviation/pireps/', { data: docMockData.generateCuratedPireps() });

        // Safety events
        await this.mock('/safety/events', {
          events: docMockData.generateCuratedSafetyEvents(),
        });

        // Audio
        await this.mock('/audio/transmissions', {
          transmissions: docMockData.generateCuratedAudioTransmissions(),
        });

        // Cannonball
        await this.mock('/cannonball/threats', {
          threats: docMockData.generateCuratedCannonballThreats(),
          count: 3,
          timestamp: new Date().toISOString(),
        });
        await this.mock('/cannonball/location', { status: 'ok' }, { method: 'POST' });
        await this.mock('/cannonball/activate', { status: 'activated' }, { method: 'POST' });
        await this.mock('/cannonball/sessions', {
          sessions: mockData.generateCannonballSessions(),
          count: 2,
        });
        await this.mock('/cannonball/patterns', {
          patterns: mockData.generateCannonballPatterns(),
          count: 3,
        });
        await this.mock('/cannonball/alerts', {
          alerts: mockData.generateCannonballAlerts(),
          count: 3,
        });
        await this.mock('/cannonball/stats/summary', mockData.generateCannonballStats());
        await this.mock('/cannonball/known-aircraft', {
          aircraft: mockData.generateCannonballKnownAircraft(),
          count: 3,
        });

        // System screen (remaining endpoints; /system/status set above)
        await this.mock('/system/health', system.health);
        await this.mock('/system/info', system.info);
        await this.mock('/system/databases', system.databases);
        await this.mock('/safety/events/monitor/status', system.safetyStatus);
        await this.mock('/acars/stats', system.acarsStats);
        await this.mock('/acars/status', system.acarsStatus);
        await this.mock('/notifications/config', system.notifConfig);

        // Advanced Analytics screen. Register the generic /analytics/ (fields)
        // FIRST so the specific sub-paths registered after it win in Playwright's
        // most-recent-route-first matching.
        const analytics = docMockData.generateCuratedAnalytics();
        await this.mock('/analytics/', analytics.fields);
        await this.mock('/analytics/scatter/', analytics.scatter);
        await this.mock('/analytics/matrix/', analytics.matrix);
        await this.mock('/analytics/cross-domain/', analytics.crossDomain);
        await this.mock('/history/analytics/correlation/', analytics.correlation);
        await this.mock('/stats/geographic/countries/', analytics.countries);
        await this.mock('/stats/geographic/operators/', analytics.operators);
        await this.mock('/stats/geographic/military-breakdown/', analytics.militaryBreakdown);
        await this.mock('/stats/flight-patterns/busiest-hours/', analytics.busiestHours);
        await this.mock('/stats/flight-patterns/routes/', analytics.routes);
        await this.mock('/stats/flight-patterns/aircraft-types/', analytics.aircraftTypes);

        // Admin Config screen. Register the audit-log sub-path AFTER the base
        // /admin/config/ so it wins under most-recent-route-first matching.
        const admin = docMockData.generateCuratedAdminConfig();
        await this.mock('/admin/config/', admin.config);
        await this.mock('/admin/config/audit_log/', admin.auditLog);
      },

      /**
       * Clear all mocks
       */
      async clear() {
        mocks.clear();
        await page.unrouteAll();
      },
    };

    await use(docMockApi);
  },

  /**
   * Screenshot state manager for deterministic captures
   */
  screenshotState: async ({ page }, use) => {
    await use(screenshotState(page));
  },

  /**
   * Animation helpers for dynamic captures
   */
  animationHelpers: async ({ page }, use) => {
    await use(animationHelpers(page));
  },

  /**
   * Screenshot helper with consistent settings
   */
  screenshotHelper: async ({ page }, use) => {
    const { ScreenshotManager } = await import('../utils/screenshot-manager.js');
    const manager = new ScreenshotManager(page);
    // Route captures into the per-viewport output dir (desktop/tablet/mobile).
    // test.info() returns the current TestInfo inside a fixture.
    manager.viewport = base.info().project.name || 'desktop';
    await use(manager);
  },
});

export { expect };
export { mockData };
