// ============================================================================
// Wake Turbulence Categories
// ============================================================================
// FAA/ICAO Wake Turbulence Categories based on Maximum Takeoff Weight (MTOW)
// and wingspan. These determine required separation between aircraft.
//
// Categories:
// - J (Super): A380, AN-225 - exceptional wake turbulence
// - H (Heavy): MTOW > 136,000 kg (300,000 lbs) - B747, B777, B787, A330, A340, A350
// - M (Medium/Large): MTOW 7,000-136,000 kg - B737, A320, B757, regional jets
// - L (Light): MTOW < 7,000 kg - Small props, C172, PA28
//
// Colors follow standard aviation conventions and ATC radar displays

/**
 * Wake turbulence category definitions with colors
 */
export const WAKE_CATEGORY_INFO = {
  J: {
    name: 'Super',
    description: 'Super Heavy (A380, AN-225)',
    color: '#ff4444',
    shortName: 'J',
  },
  H: {
    name: 'Heavy',
    description: 'Heavy (>300,000 lbs MTOW)',
    color: '#ff8800',
    shortName: 'H',
  },
  M: {
    name: 'Medium',
    description: 'Medium/Large (15,500-300,000 lbs)',
    color: '#ffff00',
    shortName: 'M',
  },
  L: {
    name: 'Light',
    description: 'Light (<15,500 lbs MTOW)',
    color: '#44ff44',
    shortName: 'L',
  },
};

/**
 * Aircraft type code to wake category mapping
 * Based on ICAO Doc 8643 and FAA Order 7110.65
 */
export const WAKE_CATEGORIES = {
  // ============================================================================
  // Super (J) - Exceptional wake turbulence
  // ============================================================================
  A380: 'J', // Airbus A380
  A388: 'J', // Airbus A380-800
  A38F: 'J', // Airbus A380F (cargo variant designation)
  A225: 'J', // Antonov An-225 Mriya
  AN225: 'J', // Antonov An-225 (alternate code)

  // ============================================================================
  // Heavy (H) - MTOW > 300,000 lbs (136,000 kg)
  // ============================================================================

  // Boeing Wide-body
  B741: 'H', // Boeing 747-100
  B742: 'H', // Boeing 747-200
  B743: 'H', // Boeing 747-300
  B744: 'H', // Boeing 747-400
  B747: 'H', // Boeing 747 (generic)
  B74D: 'H', // Boeing 747 Dreamlifter
  B74R: 'H', // Boeing 747SR
  B74S: 'H', // Boeing 747SP
  B748: 'H', // Boeing 747-8
  B77L: 'H', // Boeing 777-200LR
  B772: 'H', // Boeing 777-200
  B773: 'H', // Boeing 777-300
  B77W: 'H', // Boeing 777-300ER
  B778: 'H', // Boeing 777-8
  B779: 'H', // Boeing 777-9
  B777: 'H', // Boeing 777 (generic)
  B788: 'H', // Boeing 787-8
  B789: 'H', // Boeing 787-9
  B78X: 'H', // Boeing 787-10
  B787: 'H', // Boeing 787 (generic)
  B764: 'H', // Boeing 767-400ER
  B763: 'H', // Boeing 767-300
  B762: 'H', // Boeing 767-200
  B767: 'H', // Boeing 767 (generic)

  // Airbus Wide-body
  A332: 'H', // Airbus A330-200
  A333: 'H', // Airbus A330-300
  A338: 'H', // Airbus A330-800neo
  A339: 'H', // Airbus A330-900neo
  A330: 'H', // Airbus A330 (generic)
  A342: 'H', // Airbus A340-200
  A343: 'H', // Airbus A340-300
  A345: 'H', // Airbus A340-500
  A346: 'H', // Airbus A340-600
  A340: 'H', // Airbus A340 (generic)
  A359: 'H', // Airbus A350-900
  A35K: 'H', // Airbus A350-1000
  A350: 'H', // Airbus A350 (generic)

  // McDonnell Douglas / Boeing
  MD11: 'H', // McDonnell Douglas MD-11
  DC10: 'H', // McDonnell Douglas DC-10
  L101: 'H', // Lockheed L-1011 TriStar

  // Antonov (except An-225)
  A124: 'H', // Antonov An-124 Ruslan
  AN124: 'H', // Antonov An-124 (alternate)
  A22: 'H', // Antonov An-22 Antei
  AN22: 'H', // Antonov An-22 (alternate)

  // Ilyushin
  IL96: 'H', // Ilyushin Il-96
  IL86: 'H', // Ilyushin Il-86
  IL76: 'H', // Ilyushin Il-76

  // Military Heavy
  C5: 'H', // Lockheed C-5 Galaxy
  C5M: 'H', // Lockheed C-5M Super Galaxy
  C17: 'H', // Boeing C-17 Globemaster III
  KC10: 'H', // McDonnell Douglas KC-10 Extender
  KC46: 'H', // Boeing KC-46 Pegasus
  B52: 'H', // Boeing B-52 Stratofortress
  B52H: 'H', // Boeing B-52H
  E4B: 'H', // Boeing E-4B Nightwatch
  VC25: 'H', // Boeing VC-25 (Air Force One)
  E3CF: 'H', // Boeing E-3 Sentry AWACS
  E3TF: 'H', // Boeing E-3 AWACS

  // ============================================================================
  // Medium/Large (M) - MTOW 15,500-300,000 lbs (7,000-136,000 kg)
  // ============================================================================

  // Boeing Narrow-body
  B736: 'M', // Boeing 737-600
  B737: 'M', // Boeing 737 (generic)
  B738: 'M', // Boeing 737-800
  B739: 'M', // Boeing 737-900
  B37M: 'M', // Boeing 737 MAX 7
  B38M: 'M', // Boeing 737 MAX 8
  B39M: 'M', // Boeing 737 MAX 9
  B3XM: 'M', // Boeing 737 MAX 10
  B752: 'M', // Boeing 757-200
  B753: 'M', // Boeing 757-300
  B757: 'M', // Boeing 757 (generic)
  B712: 'M', // Boeing 717-200
  B717: 'M', // Boeing 717 (generic)

  // Airbus Narrow-body
  A318: 'M', // Airbus A318
  A319: 'M', // Airbus A319
  A320: 'M', // Airbus A320
  A321: 'M', // Airbus A321
  A19N: 'M', // Airbus A319neo
  A20N: 'M', // Airbus A320neo
  A21N: 'M', // Airbus A321neo
  A32N: 'M', // Airbus A320neo (alternate)
  A321XLR: 'M', // Airbus A321XLR

  // McDonnell Douglas
  MD80: 'M', // McDonnell Douglas MD-80 series
  MD81: 'M', // McDonnell Douglas MD-81
  MD82: 'M', // McDonnell Douglas MD-82
  MD83: 'M', // McDonnell Douglas MD-83
  MD87: 'M', // McDonnell Douglas MD-87
  MD88: 'M', // McDonnell Douglas MD-88
  MD90: 'M', // McDonnell Douglas MD-90
  DC9: 'M', // McDonnell Douglas DC-9
  DC93: 'M', // McDonnell Douglas DC-9-30

  // Regional Jets
  E170: 'M', // Embraer E170
  E175: 'M', // Embraer E175
  E190: 'M', // Embraer E190
  E195: 'M', // Embraer E195
  E290: 'M', // Embraer E190-E2
  E295: 'M', // Embraer E195-E2
  E75S: 'M', // Embraer E175 short
  E75L: 'M', // Embraer E175 long
  CRJ1: 'M', // Bombardier CRJ100
  CRJ2: 'M', // Bombardier CRJ200
  CRJ7: 'M', // Bombardier CRJ700
  CRJ9: 'M', // Bombardier CRJ900
  CRJX: 'M', // Bombardier CRJ1000
  CRJ: 'M', // Bombardier CRJ (generic)
  ERJ: 'M', // Embraer ERJ (generic)
  E135: 'M', // Embraer ERJ-135
  E145: 'M', // Embraer ERJ-145
  E140: 'M', // Embraer ERJ-140

  // Bombardier/De Havilland Canada
  DH8A: 'M', // De Havilland Dash 8-100
  DH8B: 'M', // De Havilland Dash 8-200
  DH8C: 'M', // De Havilland Dash 8-300
  DH8D: 'M', // De Havilland Dash 8-400 (Q400)
  DHC8: 'M', // De Havilland Dash 8 (generic)
  Q400: 'M', // Bombardier Q400

  // ATR
  AT43: 'M', // ATR 42-300
  AT45: 'M', // ATR 42-500
  AT46: 'M', // ATR 42-600
  AT72: 'M', // ATR 72-200
  AT73: 'M', // ATR 72-500
  AT75: 'M', // ATR 72-500
  AT76: 'M', // ATR 72-600
  ATR: 'M', // ATR (generic)
  AT42: 'M', // ATR 42 (generic)

  // Business Jets (Larger)
  GLEX: 'M', // Bombardier Global Express
  GL5T: 'M', // Bombardier Global 5000
  GL6T: 'M', // Bombardier Global 6000
  GL7T: 'M', // Bombardier Global 7500
  G280: 'M', // Gulfstream G280
  G350: 'M', // Gulfstream G350
  G450: 'M', // Gulfstream G450
  G500: 'M', // Gulfstream G500
  G550: 'M', // Gulfstream G550
  G600: 'M', // Gulfstream G600
  G650: 'M', // Gulfstream G650
  G6: 'M', // Gulfstream G650 (short)
  GALX: 'M', // Gulfstream Galaxy (G200)
  GLF5: 'M', // Gulfstream V
  GLF4: 'M', // Gulfstream IV
  GLF6: 'M', // Gulfstream VI
  FA7X: 'M', // Dassault Falcon 7X
  FA8X: 'M', // Dassault Falcon 8X
  F900: 'M', // Dassault Falcon 900
  FA50: 'M', // Dassault Falcon 50
  CL60: 'M', // Bombardier Challenger 600
  CL35: 'M', // Bombardier Challenger 350
  CL30: 'M', // Bombardier Challenger 300
  BD70: 'M', // Bombardier BD-700 (Global series)

  // Fokker
  F70: 'M', // Fokker 70
  F100: 'M', // Fokker 100
  F50: 'M', // Fokker 50
  F27: 'M', // Fokker F27

  // Saab
  SF34: 'M', // Saab 340
  SB20: 'M', // Saab 2000

  // BAe
  B461: 'M', // BAe 146-100
  B462: 'M', // BAe 146-200
  B463: 'M', // BAe 146-300
  RJ85: 'M', // Avro RJ85
  RJ1H: 'M', // Avro RJ100

  // Military Medium
  C130: 'M', // Lockheed C-130 Hercules
  C130H: 'M', // Lockheed C-130H
  C130J: 'M', // Lockheed C-130J Super Hercules
  C27J: 'M', // Alenia C-27J Spartan
  KC135: 'M', // Boeing KC-135 Stratotanker
  E6B: 'M', // Boeing E-6B Mercury
  P3: 'M', // Lockheed P-3 Orion
  P8: 'M', // Boeing P-8 Poseidon
  E2: 'M', // Northrop Grumman E-2 Hawkeye
  C2: 'M', // Grumman C-2 Greyhound

  // Tupolev
  T154: 'M', // Tupolev Tu-154
  T204: 'M', // Tupolev Tu-204
  T214: 'M', // Tupolev Tu-214

  // Sukhoi
  SU95: 'M', // Sukhoi Superjet 100
  SSJ1: 'M', // Sukhoi Superjet 100

  // COMAC
  C919: 'M', // COMAC C919
  ARJ21: 'M', // COMAC ARJ21

  // ============================================================================
  // Light (L) - MTOW < 15,500 lbs (7,000 kg)
  // ============================================================================

  // Cessna Single Engine
  C150: 'L', // Cessna 150
  C152: 'L', // Cessna 152
  C172: 'L', // Cessna 172 Skyhawk
  C175: 'L', // Cessna 175 Skylark
  C177: 'L', // Cessna 177 Cardinal
  C180: 'L', // Cessna 180 Skywagon
  C182: 'L', // Cessna 182 Skylane
  C185: 'L', // Cessna 185 Skywagon
  C206: 'L', // Cessna 206 Stationair
  C207: 'L', // Cessna 207
  C208: 'L', // Cessna 208 Caravan (borderline M)
  C210: 'L', // Cessna 210 Centurion

  // Cessna Twins
  C303: 'L', // Cessna 303 Crusader
  C310: 'L', // Cessna 310
  C335: 'L', // Cessna 335
  C336: 'L', // Cessna 336 Skymaster
  C337: 'L', // Cessna 337 Super Skymaster
  C340: 'L', // Cessna 340
  C401: 'L', // Cessna 401
  C402: 'L', // Cessna 402
  C404: 'L', // Cessna 404 Titan
  C411: 'L', // Cessna 411
  C414: 'L', // Cessna 414
  C421: 'L', // Cessna 421 Golden Eagle
  C425: 'L', // Cessna 425 Corsair/Conquest I

  // Cessna Jets (Light)
  C500: 'L', // Cessna Citation I
  C510: 'L', // Cessna Citation Mustang
  C525: 'L', // Cessna CitationJet (CJ1)
  C25A: 'L', // Cessna Citation CJ2
  C25B: 'L', // Cessna Citation CJ3
  C25C: 'L', // Cessna Citation CJ4
  C550: 'L', // Cessna Citation II/Bravo
  C560: 'L', // Cessna Citation V/Ultra
  C56X: 'L', // Cessna Citation XLS
  C680: 'L', // Cessna Citation Sovereign
  C68A: 'L', // Cessna Citation Latitude
  C700: 'L', // Cessna Citation Longitude

  // Piper Single Engine
  PA18: 'L', // Piper PA-18 Super Cub
  PA22: 'L', // Piper PA-22 Tri-Pacer
  PA24: 'L', // Piper PA-24 Comanche
  PA28: 'L', // Piper PA-28 Cherokee/Warrior/Archer
  PA30: 'L', // Piper PA-30 Twin Comanche
  PA32: 'L', // Piper PA-32 Cherokee Six/Saratoga
  PA34: 'L', // Piper PA-34 Seneca
  PA38: 'L', // Piper PA-38 Tomahawk
  PA44: 'L', // Piper PA-44 Seminole
  PA46: 'L', // Piper PA-46 Malibu/Meridian

  // Piper Jets
  PRM1: 'L', // Piper PA-47 PiperJet

  // Beechcraft Single/Twin
  B33: 'L', // Beechcraft Bonanza (Debonair)
  B35: 'L', // Beechcraft Bonanza V35
  B36: 'L', // Beechcraft Bonanza A36
  B55: 'L', // Beechcraft Baron 55
  B58: 'L', // Beechcraft Baron 58
  BE55: 'L', // Beechcraft Baron 55
  BE58: 'L', // Beechcraft Baron 58
  BE60: 'L', // Beechcraft Duke
  BE76: 'L', // Beechcraft Duchess
  BE80: 'L', // Beechcraft Queen Air
  BE90: 'L', // Beechcraft King Air 90
  BE99: 'L', // Beechcraft 99
  C90: 'L', // Beechcraft King Air C90
  BE9L: 'L', // Beechcraft King Air C90
  E90: 'L', // Beechcraft King Air E90
  B190: 'L', // Beechcraft 1900
  B19D: 'L', // Beechcraft 1900D

  // Beechcraft Jets
  BE40: 'L', // Beechcraft 400A (Beechjet)
  BE4W: 'L', // Beechcraft 400XP

  // Diamond
  DA20: 'L', // Diamond DA20 Katana
  DA40: 'L', // Diamond DA40 Diamond Star
  DA42: 'L', // Diamond DA42 Twin Star
  DA50: 'L', // Diamond DA50 RG
  DA62: 'L', // Diamond DA62

  // Cirrus
  SR20: 'L', // Cirrus SR20
  SR22: 'L', // Cirrus SR22
  SF50: 'L', // Cirrus SF50 Vision Jet

  // Mooney
  M20: 'L', // Mooney M20 series
  M20J: 'L', // Mooney M20J 201
  M20K: 'L', // Mooney M20K 252
  M20M: 'L', // Mooney M20M Bravo
  M20R: 'L', // Mooney M20R Ovation
  M20T: 'L', // Mooney M20T Acclaim
  M20U: 'L', // Mooney M20U Ovation Ultra

  // Eclipse
  EA50: 'L', // Eclipse 500
  E500: 'L', // Eclipse 500 (alternate)
  EA55: 'L', // Eclipse 550

  // Embraer Light Jets
  PHEN: 'L', // Embraer Phenom 100/generic
  PH1: 'L', // Embraer Phenom 100 (short)
  E50P: 'L', // Embraer Phenom 100
  E55P: 'L', // Embraer Phenom 300

  // HondaJet
  HDJT: 'L', // HondaJet HA-420

  // Pilatus
  PC6: 'L', // Pilatus PC-6 Porter
  PC7: 'L', // Pilatus PC-7
  PC9: 'L', // Pilatus PC-9
  PC12: 'L', // Pilatus PC-12
  PC21: 'L', // Pilatus PC-21
  PC24: 'L', // Pilatus PC-24

  // Other Light Aircraft
  AA5: 'L', // Grumman AA-5 series
  BE23: 'L', // Beechcraft Musketeer
  BL8: 'L', // Bellanca 8 series
  COUR: 'L', // Helio Courier
  LANC: 'L', // Avro Lancaster
  P28A: 'L', // Piper PA-28
  P28R: 'L', // Piper PA-28R Arrow
  PA27: 'L', // Piper PA-27 Aztec
  PA31: 'L', // Piper PA-31 Navajo
  RV: 'L', // Van's RV series
  RV6: 'L', // Van's RV-6
  RV7: 'L', // Van's RV-7
  RV8: 'L', // Van's RV-8
  RV9: 'L', // Van's RV-9
  RV10: 'L', // Van's RV-10
  RV12: 'L', // Van's RV-12
  TRIN: 'L', // SOCATA TB-20 Trinidad
  TBM7: 'L', // SOCATA TBM 700
  TBM8: 'L', // SOCATA TBM 850
  TBM9: 'L', // Daher TBM 900/910/930/940

  // Helicopters (Light) - generally treated as Light wake category
  R22: 'L', // Robinson R22
  R44: 'L', // Robinson R44
  R66: 'L', // Robinson R66
  EC20: 'L', // Eurocopter EC120 Colibri
  EC30: 'L', // Eurocopter EC130
  EC35: 'L', // Eurocopter EC135
  EC45: 'L', // Eurocopter EC145
  AS50: 'L', // Eurocopter AS350 Ecureuil
  A109: 'L', // Leonardo AW109
  A119: 'L', // Leonardo AW119
  B06: 'L', // Bell 206 JetRanger
  B06T: 'L', // Bell 206L LongRanger
  B212: 'L', // Bell 212
  B407: 'L', // Bell 407
  B429: 'L', // Bell 429
  B412: 'L', // Bell 412
  B505: 'L', // Bell 505 Jet Ranger X
  S76: 'L', // Sikorsky S-76
  S92: 'L', // Sikorsky S-92 (borderline M)
  MD52: 'L', // MD 500 series
  MD60: 'L', // MD 600N
};

/**
 * Get wake turbulence category for an aircraft type code
 *
 * @param {string} aircraftType - ICAO aircraft type code (e.g., 'B738', 'A320')
 * @returns {string|null} Wake category letter ('J', 'H', 'M', 'L') or null if unknown
 */
export function getWakeCategory(aircraftType) {
  if (!aircraftType) return null;

  // Normalize to uppercase and trim
  const type = String(aircraftType).toUpperCase().trim();

  // Direct lookup
  if (WAKE_CATEGORIES[type]) {
    return WAKE_CATEGORIES[type];
  }

  // Try common variations (remove trailing numbers for generic matches)
  const baseType = type.replace(/\d+$/, '');
  if (baseType !== type && WAKE_CATEGORIES[baseType]) {
    return WAKE_CATEGORIES[baseType];
  }

  return null;
}

/**
 * Get wake category from ADS-B category code
 * ADS-B emitter category provides a hint about aircraft size
 *
 * @param {string} adsbCategory - ADS-B emitter category (e.g., 'A1', 'A5')
 * @returns {string|null} Wake category letter or null
 */
export function getWakeCategoryFromAdsbCategory(adsbCategory) {
  if (!adsbCategory) return null;

  const cat = String(adsbCategory).toUpperCase().trim();

  // ADS-B Category mapping:
  // A1: Light (< 15,500 lbs) -> L
  // A2: Small (15,500 to 75,000 lbs) -> M
  // A3: Large (75,000 to 300,000 lbs) -> M
  // A4: High Vortex Large (B757) -> M (but with heavy wake characteristics)
  // A5: Heavy (> 300,000 lbs) -> H
  // A6: High Performance (> 5g, > 400 kts) -> varies
  // A7: Rotorcraft -> L (generally)
  // B categories are surface vehicles/obstacles, not aircraft

  switch (cat) {
    case 'A1':
      return 'L'; // Light
    case 'A2':
    case 'A3':
    case 'A4':
    case 'A6':
      return 'M'; // Medium/Large
    case 'A5':
      return 'H'; // Heavy
    case 'A7':
      return 'L'; // Rotorcraft (generally light wake)
    default:
      return null;
  }
}

/**
 * Get the display color for a wake turbulence category
 *
 * @param {string} category - Wake category letter ('J', 'H', 'M', 'L')
 * @returns {string} Hex color code
 */
export function getWakeCategoryColor(category) {
  if (!category) return '#888888'; // Gray for unknown

  const cat = String(category).toUpperCase().trim();
  const info = WAKE_CATEGORY_INFO[cat];

  return info?.color || '#888888';
}

/**
 * Get full wake category info including name and description
 *
 * @param {string} category - Wake category letter ('J', 'H', 'M', 'L')
 * @returns {object|null} Category info object or null if invalid
 */
export function getWakeCategoryInfo(category) {
  if (!category) return null;

  const cat = String(category).toUpperCase().trim();
  return WAKE_CATEGORY_INFO[cat] || null;
}

/**
 * Determine wake category for an aircraft using all available data
 * Tries type code first, then falls back to ADS-B category
 *
 * @param {object} aircraft - Aircraft object with type, t, desc, category fields
 * @param {object} aircraftInfo - Enriched aircraft info with type_code field
 * @returns {string|null} Wake category letter or null if unable to determine
 */
export function determineWakeCategory(aircraft, aircraftInfo) {
  // Try aircraft type code first (most reliable)
  const typeCode =
    aircraftInfo?.type_code || aircraft?.t || aircraft?.type || aircraft?.desc || null;

  if (typeCode) {
    const category = getWakeCategory(typeCode);
    if (category) return category;
  }

  // Fall back to ADS-B emitter category
  const adsbCategory = aircraft?.category;
  if (adsbCategory) {
    return getWakeCategoryFromAdsbCategory(adsbCategory);
  }

  return null;
}

export default {
  WAKE_CATEGORIES,
  WAKE_CATEGORY_INFO,
  getWakeCategory,
  getWakeCategoryColor,
  getWakeCategoryInfo,
  getWakeCategoryFromAdsbCategory,
  determineWakeCategory,
};
