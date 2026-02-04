import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  decodeMetar,
  decodePirep,
  getPirepMaxSeverity,
  getHazardSummary,
  getPirepAgeMinutes,
  getAgeFreshnessClass,
  getAgeOpacity,
  formatPirepAltitude,
} from './decoders';

describe('decodeMetar', () => {
  it('should return null for null input', () => {
    expect(decodeMetar(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(decodeMetar(undefined)).toBeNull();
  });

  describe('basic fields', () => {
    it('should decode station ID', () => {
      const metar = { stationId: 'KJFK' };
      const result = decodeMetar(metar);
      expect(result.station).toBe('KJFK');
    });

    it('should use icaoId if stationId not available', () => {
      const metar = { icaoId: 'KLAX' };
      const result = decodeMetar(metar);
      expect(result.station).toBe('KLAX');
    });

    it('should decode raw observation', () => {
      const metar = { rawOb: 'METAR KJFK 121756Z...' };
      const result = decodeMetar(metar);
      expect(result.raw).toBe('METAR KJFK 121756Z...');
    });

    it('should decode flight category', () => {
      const metar = { fltCat: 'VFR' };
      const result = decodeMetar(metar);
      expect(result.flightCategory).toBe('VFR');
      expect(result.flightCategoryDesc).toContain('Visual Flight Rules');
    });

    it('should handle MVFR category', () => {
      const metar = { fltCat: 'MVFR' };
      const result = decodeMetar(metar);
      expect(result.flightCategory).toBe('MVFR');
      expect(result.flightCategoryDesc).toContain('Marginal VFR');
    });

    it('should handle IFR category', () => {
      const metar = { fltCat: 'IFR' };
      const result = decodeMetar(metar);
      expect(result.flightCategory).toBe('IFR');
      expect(result.flightCategoryDesc).toContain('Instrument Flight Rules');
    });

    it('should handle LIFR category', () => {
      const metar = { fltCat: 'LIFR' };
      const result = decodeMetar(metar);
      expect(result.flightCategory).toBe('LIFR');
      expect(result.flightCategoryDesc).toContain('Low IFR');
    });
  });

  describe('wind decoding', () => {
    it('should decode wind direction and speed', () => {
      const metar = { wdir: 270, wspd: 15 };
      const result = decodeMetar(metar);
      expect(result.wind.direction).toBe(270);
      expect(result.wind.speed).toBe(15);
      expect(result.wind.text).toContain('270');
      expect(result.wind.text).toContain('15kt');
    });

    it('should decode wind with gusts', () => {
      const metar = { wdir: 180, wspd: 20, wgst: 30 };
      const result = decodeMetar(metar);
      expect(result.wind.gust).toBe(30);
      expect(result.wind.text).toContain('gusting 30kt');
    });

    it('should handle variable wind (dir 0)', () => {
      const metar = { wdir: 0, wspd: 5 };
      const result = decodeMetar(metar);
      expect(result.wind.text).toContain('Variable');
    });

    it('should describe calm winds', () => {
      const metar = { wdir: 0, wspd: 0 };
      const result = decodeMetar(metar);
      expect(result.wind.description).toBe('Calm winds');
    });

    it('should describe light winds', () => {
      const metar = { wdir: 90, wspd: 5 };
      const result = decodeMetar(metar);
      expect(result.wind.description).toBe('Light winds');
    });

    it('should describe moderate winds', () => {
      const metar = { wdir: 90, wspd: 15 };
      const result = decodeMetar(metar);
      expect(result.wind.description).toBe('Moderate winds');
    });

    it('should describe strong winds', () => {
      const metar = { wdir: 90, wspd: 25 };
      const result = decodeMetar(metar);
      expect(result.wind.description).toBe('Strong winds');
    });

    it('should describe high winds', () => {
      const metar = { wdir: 90, wspd: 35 };
      const result = decodeMetar(metar);
      expect(result.wind.description).toBe('High winds');
    });
  });

  describe('visibility decoding', () => {
    it('should decode visibility', () => {
      const metar = { visib: 10 };
      const result = decodeMetar(metar);
      expect(result.visibility.value).toBe(10);
      expect(result.visibility.unit).toBe('SM');
      expect(result.visibility.description).toBe('Unlimited visibility');
    });

    it('should describe good visibility', () => {
      const metar = { visib: 7 };
      const result = decodeMetar(metar);
      expect(result.visibility.description).toBe('Good visibility');
    });

    it('should describe moderate visibility', () => {
      const metar = { visib: 4 };
      const result = decodeMetar(metar);
      expect(result.visibility.description).toBe('Moderate visibility');
    });

    it('should describe low visibility', () => {
      const metar = { visib: 2 };
      const result = decodeMetar(metar);
      expect(result.visibility.description).toBe('Low visibility');
    });

    it('should describe very low visibility', () => {
      const metar = { visib: 0.5 };
      const result = decodeMetar(metar);
      expect(result.visibility.description).toBe('Very low visibility');
    });
  });

  describe('weather phenomena', () => {
    it('should decode rain', () => {
      const metar = { wxString: 'RA' };
      const result = decodeMetar(metar);
      expect(result.weather[0].code).toBe('RA');
      expect(result.weather[0].description).toContain('Rain');
    });

    it('should decode heavy rain', () => {
      const metar = { wxString: '+RA' };
      const result = decodeMetar(metar);
      expect(result.weather[0].description).toContain('Heavy');
    });

    it('should decode light rain', () => {
      const metar = { wxString: '-RA' };
      const result = decodeMetar(metar);
      expect(result.weather[0].description).toContain('Light');
    });

    it('should decode thunderstorm', () => {
      const metar = { wxString: 'TSRA' };
      const result = decodeMetar(metar);
      expect(result.weather[0].description).toContain('Thunderstorm');
    });

    it('should decode fog', () => {
      const metar = { wxString: 'FG' };
      const result = decodeMetar(metar);
      expect(result.weather[0].description).toContain('Fog');
    });

    it('should decode snow', () => {
      const metar = { wxString: 'SN' };
      const result = decodeMetar(metar);
      expect(result.weather[0].description).toContain('Snow');
    });
  });

  describe('cloud decoding', () => {
    it('should decode cloud layers', () => {
      const metar = {
        clouds: [
          { cover: 'FEW', base: 2500 },
          { cover: 'SCT', base: 5000 },
        ],
      };
      const result = decodeMetar(metar);
      expect(result.clouds).toHaveLength(2);
      expect(result.clouds[0].cover).toBe('FEW');
      expect(result.clouds[0].coverDesc).toContain('Few');
      expect(result.clouds[0].base).toBe(2500);
    });

    it('should decode broken clouds', () => {
      const metar = { clouds: [{ cover: 'BKN', base: 3000 }] };
      const result = decodeMetar(metar);
      expect(result.clouds[0].coverDesc).toContain('Broken');
    });

    it('should decode overcast', () => {
      const metar = { clouds: [{ cover: 'OVC', base: 1000 }] };
      const result = decodeMetar(metar);
      expect(result.clouds[0].coverDesc).toContain('Overcast');
    });
  });

  describe('temperature decoding', () => {
    it('should decode temperature', () => {
      const metar = { temp: 20 };
      const result = decodeMetar(metar);
      expect(result.temperature.celsius).toBe(20);
      expect(result.temperature.fahrenheit).toBe(68);
    });

    it('should describe cold temperature', () => {
      const metar = { temp: 5 };
      const result = decodeMetar(metar);
      expect(result.temperature.description).toBe('Cold');
    });

    it('should describe below freezing', () => {
      const metar = { temp: -5 };
      const result = decodeMetar(metar);
      expect(result.temperature.description).toBe('Below freezing');
    });

    it('should describe warm temperature', () => {
      const metar = { temp: 25 };
      const result = decodeMetar(metar);
      expect(result.temperature.description).toBe('Warm');
    });

    it('should describe hot temperature', () => {
      const metar = { temp: 35 };
      const result = decodeMetar(metar);
      expect(result.temperature.description).toBe('Hot');
    });
  });

  describe('dewpoint decoding', () => {
    it('should decode dewpoint', () => {
      const metar = { dewp: 15 };
      const result = decodeMetar(metar);
      expect(result.dewpoint.celsius).toBe(15);
      expect(result.dewpoint.fahrenheit).toBe(59);
    });

    it('should calculate temperature-dewpoint spread', () => {
      const metar = { temp: 20, dewp: 15 };
      const result = decodeMetar(metar);
      expect(result.dewpoint.spread).toBe(5);
    });

    it('should indicate high fog risk when spread is small', () => {
      const metar = { temp: 18, dewp: 16 };
      const result = decodeMetar(metar);
      expect(result.dewpoint.fogRisk).toContain('High');
    });

    it('should indicate moderate fog risk', () => {
      const metar = { temp: 20, dewp: 16 };
      const result = decodeMetar(metar);
      expect(result.dewpoint.fogRisk).toContain('Moderate');
    });

    it('should indicate low fog risk when spread is large', () => {
      const metar = { temp: 25, dewp: 10 };
      const result = decodeMetar(metar);
      expect(result.dewpoint.fogRisk).toContain('Low');
    });
  });

  describe('altimeter decoding', () => {
    it('should decode altimeter setting', () => {
      const metar = { altim: 2992 };
      const result = decodeMetar(metar);
      expect(result.altimeter.inhg).toBe('29.92');
    });

    it('should indicate high pressure', () => {
      const metar = { altim: 3050 };
      const result = decodeMetar(metar);
      expect(result.altimeter.description).toBe('High pressure');
    });

    it('should indicate low pressure', () => {
      const metar = { altim: 2950 };
      const result = decodeMetar(metar);
      expect(result.altimeter.description).toBe('Low pressure');
    });

    it('should indicate normal pressure', () => {
      const metar = { altim: 2992 };
      const result = decodeMetar(metar);
      expect(result.altimeter.description).toBe('Normal pressure');
    });
  });
});

describe('decodePirep', () => {
  it('should return null for null input', () => {
    expect(decodePirep(null)).toBeNull();
  });

  describe('backend-decoded PIREPs', () => {
    it('should use backend decoded data when available', () => {
      const pirep = {
        raw_text: 'UA /OV JFK/TM 1500/FL350/TB MOD',
        report_type: 'UA',
        decoded: {
          turbulence: { level: 3, label: 'Moderate', code: 'MOD', description: 'Test' },
          icing: null,
          wind_shear: null,
        },
      };
      const result = decodePirep(pirep);
      expect(result.turbulence).not.toBeNull();
      expect(result.turbulence.intensity).toBe('Moderate');
    });

    it('should decode backend icing data', () => {
      const pirep = {
        decoded: {
          icing: { level: 2, label: 'Light', code: 'LGT', description: 'Light icing' },
        },
      };
      const result = decodePirep(pirep);
      expect(result.icing).not.toBeNull();
      expect(result.icing.intensity).toBe('Light');
    });

    it('should decode backend wind shear data', () => {
      const pirep = {
        decoded: {
          wind_shear: {
            level: 2,
            label: 'Moderate',
            code: 'MOD',
            description: 'Wind shear',
            gain_loss: 'loss',
          },
        },
      };
      const result = decodePirep(pirep);
      expect(result.windshear).not.toBeNull();
      expect(result.windshear.gainLoss).toBe('Loss');
    });
  });

  describe('local PIREP decoding (fallback)', () => {
    it('should decode raw PIREP text', () => {
      const pirep = { raw_text: 'UA /OV JFK/TM 1500/FL350/TB MOD' };
      const result = decodePirep(pirep);
      expect(result.raw).toContain('JFK');
    });

    it('should decode UUA (urgent) report type', () => {
      const pirep = { raw_text: 'UUA /OV JFK', report_type: 'UUA' };
      const result = decodePirep(pirep);
      expect(result.type).toBe('UUA');
      expect(result.typeDesc).toContain('URGENT');
    });

    it('should decode flight level', () => {
      const pirep = { flight_level: 350 };
      const result = decodePirep(pirep);
      expect(result.altitude.flightLevel).toBe(350);
      expect(result.altitude.feet).toBe(35000);
    });

    it('should decode turbulence from raw text', () => {
      const pirep = { raw_text: '/TB MOD CAT' };
      const result = decodePirep(pirep);
      expect(result.turbulence).not.toBeNull();
      expect(result.turbulence.intensity).toBe('Moderate');
    });

    it('should decode severe turbulence', () => {
      const pirep = { turbulence_type: 'SEV' };
      const result = decodePirep(pirep);
      expect(result.turbulence.intensity).toBe('Severe');
      expect(result.turbulence.level).toBe(5);
    });

    it('should decode icing from raw text', () => {
      const pirep = { raw_text: '/IC LGT RIME' };
      const result = decodePirep(pirep);
      expect(result.icing).not.toBeNull();
      expect(result.icing.intensity).toBe('Light');
    });

    it('should decode moderate icing', () => {
      const pirep = { icing_type: 'MOD CLR' };
      const result = decodePirep(pirep);
      expect(result.icing.intensity).toBe('Moderate');
      expect(result.icing.type).toContain('Clear');
    });

    it('should decode wind shear (LLWS)', () => {
      const pirep = { raw_text: '/WS MOD LLWS' };
      const result = decodePirep(pirep);
      expect(result.windshear).not.toBeNull();
    });

    it('should decode temperature', () => {
      const pirep = { temperature_c: -45 };
      const result = decodePirep(pirep);
      expect(result.temperature.celsius).toBe(-45);
      expect(result.temperature.fahrenheit).toBe(-49);
    });

    it('should decode wind at altitude', () => {
      const pirep = { wind_dir: 270, wind_speed_kt: 50 };
      const result = decodePirep(pirep);
      expect(result.wind.direction).toBe(270);
      expect(result.wind.speed).toBe(50);
    });
  });
});

describe('getPirepMaxSeverity', () => {
  it('should return routine for null PIREP', () => {
    const result = getPirepMaxSeverity(null);
    expect(result.level).toBe(0);
    expect(result.type).toBe('routine');
  });

  it('should return max turbulence level', () => {
    const pirep = { turbulence_type: 'SEV' };
    const result = getPirepMaxSeverity(pirep);
    expect(result.level).toBe(5);
    expect(result.type).toBe('turbulence');
  });

  it('should return max icing level', () => {
    const pirep = { icing_type: 'MOD' };
    const result = getPirepMaxSeverity(pirep);
    expect(result.level).toBe(3);
    expect(result.type).toBe('icing');
  });

  it('should return "both" when turbulence and icing present', () => {
    const pirep = { turbulence_type: 'MOD', icing_type: 'LGT' };
    const result = getPirepMaxSeverity(pirep);
    expect(result.type).toBe('both');
  });

  it('should recognize UUA as urgent', () => {
    const pirep = { report_type: 'UUA' };
    const result = getPirepMaxSeverity(pirep);
    expect(result.isUrgent).toBe(true);
    expect(result.type).toBe('urgent');
    expect(result.level).toBeGreaterThanOrEqual(5);
  });

  it('should use backend severity when available', () => {
    const pirep = {
      severity: 'hazardous',
      decoded: { severity: 'hazardous' },
    };
    const result = getPirepMaxSeverity(pirep);
    expect(result.level).toBeGreaterThanOrEqual(4);
  });
});

describe('getHazardSummary', () => {
  it('should return null for null decoded', () => {
    expect(getHazardSummary(null)).toBeNull();
  });

  it('should return turbulence summary', () => {
    const decoded = { turbulence: { level: 3, intensity: 'Moderate' } };
    const result = getHazardSummary(decoded);
    expect(result).toContain('MODERATE TURBULENCE');
  });

  it('should return icing summary', () => {
    const decoded = { icing: { level: 2, intensity: 'Light' } };
    const result = getHazardSummary(decoded);
    expect(result).toContain('LIGHT ICING');
  });

  it('should return combined hazards', () => {
    const decoded = {
      turbulence: { level: 3, intensity: 'Moderate' },
      icing: { level: 2, intensity: 'Light' },
    };
    const result = getHazardSummary(decoded);
    expect(result).toContain('TURBULENCE');
    expect(result).toContain('ICING');
    expect(result).toContain('|');
  });

  it('should return wind shear summary', () => {
    const decoded = { windshear: { level: 2, intensity: 'Moderate' } };
    const result = getHazardSummary(decoded);
    expect(result).toContain('WIND SHEAR');
  });

  it('should return URGENT for UUA with no hazards', () => {
    const decoded = { type: 'UUA' };
    const result = getHazardSummary(decoded);
    expect(result).toContain('URGENT');
  });

  it('should return ROUTINE for no hazards', () => {
    const decoded = { type: 'UA' };
    const result = getHazardSummary(decoded);
    expect(result).toContain('ROUTINE');
  });
});

describe('getPirepAgeMinutes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return -1 for null PIREP', () => {
    expect(getPirepAgeMinutes(null)).toBe(-1);
  });

  it('should return -1 for missing observation time', () => {
    expect(getPirepAgeMinutes({})).toBe(-1);
  });

  it('should calculate age in minutes', () => {
    const pirep = { observation_time: '2024-06-15T11:30:00Z' };
    expect(getPirepAgeMinutes(pirep)).toBe(30);
  });

  it('should use obsTime field as fallback', () => {
    const pirep = { obsTime: '2024-06-15T11:00:00Z' };
    expect(getPirepAgeMinutes(pirep)).toBe(60);
  });
});

describe('getAgeFreshnessClass', () => {
  it('should return "unknown" for negative minutes', () => {
    expect(getAgeFreshnessClass(-1)).toBe('unknown');
  });

  it('should return "fresh" for 0-30 minutes', () => {
    expect(getAgeFreshnessClass(0)).toBe('fresh');
    expect(getAgeFreshnessClass(15)).toBe('fresh');
    expect(getAgeFreshnessClass(30)).toBe('fresh');
  });

  it('should return "recent" for 31-60 minutes', () => {
    expect(getAgeFreshnessClass(31)).toBe('recent');
    expect(getAgeFreshnessClass(45)).toBe('recent');
    expect(getAgeFreshnessClass(60)).toBe('recent');
  });

  it('should return "aging" for 61-120 minutes', () => {
    expect(getAgeFreshnessClass(61)).toBe('aging');
    expect(getAgeFreshnessClass(90)).toBe('aging');
    expect(getAgeFreshnessClass(120)).toBe('aging');
  });

  it('should return "stale" for > 120 minutes', () => {
    expect(getAgeFreshnessClass(121)).toBe('stale');
    expect(getAgeFreshnessClass(180)).toBe('stale');
  });
});

describe('getAgeOpacity', () => {
  it('should return 1.0 for negative minutes', () => {
    expect(getAgeOpacity(-1)).toBe(1.0);
  });

  it('should return 1.0 for fresh PIREPs', () => {
    expect(getAgeOpacity(15)).toBe(1.0);
    expect(getAgeOpacity(30)).toBe(1.0);
  });

  it('should return 0.85 for recent PIREPs', () => {
    expect(getAgeOpacity(45)).toBe(0.85);
    expect(getAgeOpacity(60)).toBe(0.85);
  });

  it('should return 0.7 for aging PIREPs', () => {
    expect(getAgeOpacity(90)).toBe(0.7);
    expect(getAgeOpacity(120)).toBe(0.7);
  });

  it('should return 0.55 for older PIREPs', () => {
    expect(getAgeOpacity(180)).toBe(0.55);
    expect(getAgeOpacity(240)).toBe(0.55);
  });

  it('should return 0.4 for very old PIREPs', () => {
    expect(getAgeOpacity(300)).toBe(0.4);
  });
});

describe('formatPirepAltitude', () => {
  it('should return null for null PIREP', () => {
    expect(formatPirepAltitude(null)).toBeNull();
  });

  it('should return null for PIREP without altitude', () => {
    expect(formatPirepAltitude({})).toBeNull();
  });

  it('should format high flight level', () => {
    expect(formatPirepAltitude({ flight_level: 350 })).toBe('FL350');
    expect(formatPirepAltitude({ fltLvl: 410 })).toBe('FL410');
  });

  it('should format low flight level in thousands', () => {
    expect(formatPirepAltitude({ flight_level: 100 })).toBe('10k');
    expect(formatPirepAltitude({ flight_level: 50 })).toBe('5k');
  });

  it('should format altitude_ft above 18000', () => {
    expect(formatPirepAltitude({ altitude_ft: 35000 })).toBe('FL350');
  });

  it('should format altitude_ft below 18000', () => {
    expect(formatPirepAltitude({ altitude_ft: 12000 })).toBe('12k');
  });
});
