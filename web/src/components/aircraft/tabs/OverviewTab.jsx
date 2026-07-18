import React from 'react';
import { motion } from 'framer-motion';
import { Info, WifiOff, Crosshair, Navigation, TrendingUp, MapPin, Radio } from 'lucide-react';
import { getCardinalDirection } from '../../../utils';
import {
  AirframeCard,
  OperatorCard,
  RegistrationCard,
  RouteCard,
  OwnershipCard,
  PhotoCard,
  DataSourcesAccordion,
} from './info';
import { MetricCard, MetricsGrid } from '../../ui/metric-card';
import { FlightHistoryCard } from '../../shared/FlightHistoryCard';

// Stagger animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: {
    opacity: 0,
    y: 15,
    scale: 0.98,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

/**
 * Normalize aircraft info from various API response formats
 */
function normalizeAircraftInfo(info) {
  return {
    type_name: info.type_name || info.aircraft_type || info.type || info.t,
    type_code: info.type_code || info.icao_type || info.icaoAircraftType,
    manufacturer: info.manufacturer || info.manufacturerName,
    model: info.model || info.modelName,
    serial_number: info.serial_number || info.serialNumber || info.manufacturerSerial,
    year_built: info.year_built || info.yearBuilt || info.built,
    age_years:
      info.age_years ??
      info.ageYears ??
      (() => {
        const year = info.year_built || info.yearBuilt || info.built;
        const yearNum = Number(year);
        if (!year || isNaN(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear()) {
          return null;
        }
        return new Date().getFullYear() - yearNum;
      })(),
    operator: info.operator || info.operatorName || info.owner_operator,
    operator_icao: info.operator_icao || info.operatorIcao || info.airline_icao,
    owner: info.owner || info.ownerName || info.registered_owner,
    country: info.country || info.countryName || info.registered_country,
    registration: info.registration || info.tail_number || info.reg || info.r,
    is_military: info.is_military ?? info.military ?? info.isMilitary ?? false,
    category: info.category || info.aircraftCategory,
    // Route (origin/destination) resolved server-side from the callsign.
    route: info.route || info.route_data || null,
    // Ownership analysis (shell/trust/sanctions risk) computed server-side.
    owner_type: info.owner_type || null,
    is_shell_suspected: info.is_shell_suspected ?? false,
    shell_score: info.shell_score ?? null,
    ownership_flags: info.ownership_flags || null,
  };
}

function isEmergencySquawk(squawk) {
  return ['7500', '7600', '7700'].includes(squawk);
}

/**
 * LiveTelemetrySection - Real-time flight data display
 */
function LiveTelemetrySection({ aircraft, trackHistory: _trackHistory, calculateDistance }) {
  if (!aircraft) {
    return (
      <div className="detail-empty" role="status">
        <WifiOff size={32} aria-hidden="true" />
        <p>Aircraft not currently tracked</p>
        <span className="text-sm text-text-dim">Not in range of the receiver</span>
      </div>
    );
  }

  const verticalRate = aircraft.vr ?? aircraft.baro_rate ?? aircraft.geom_rate ?? null;
  const isExtremeVS = verticalRate !== null && Math.abs(verticalRate) > 3000;
  const vsClass = verticalRate > 0 ? 'climbing' : verticalRate < 0 ? 'descending' : '';

  const altitude =
    aircraft.alt_baro !== 'ground' && aircraft.alt_baro
      ? aircraft.alt_baro
      : (aircraft.alt_geom ?? aircraft.alt);

  const speed = aircraft.gs ?? aircraft.tas ?? aircraft.ias;
  const track = aircraft.track ?? aircraft.true_heading ?? aircraft.mag_heading;
  const distance = calculateDistance(aircraft);

  // Format values
  const formatAlt = (alt) => alt?.toLocaleString() || '--';
  const formatSpeed = (s) => s?.toFixed(0) || '--';
  const formatVS = (vs) => {
    if (vs === null) return '--';
    return vs > 0 ? `+${vs}` : `${vs}`;
  };
  const formatTrack = (t) => (t != null ? `${t.toFixed(0)}°` : '--');

  return (
    <div
      className="live-telemetry-section"
      role="region"
      aria-label="Live telemetry"
      aria-live="polite"
    >
      <MetricsGrid columns={3} gap={3}>
        <MetricCard label="Altitude" value={formatAlt(altitude)} unit="ft" icon={Crosshair} />
        <MetricCard label="Ground Speed" value={formatSpeed(speed)} unit="kts" icon={Navigation} />
        <MetricCard
          label="Vertical Rate"
          value={formatVS(verticalRate)}
          unit="fpm"
          icon={TrendingUp}
          valueClassName={`${vsClass} ${isExtremeVS ? 'extreme-vs' : ''}`}
        />
        <MetricCard label="Track" value={formatTrack(track)} unit={getCardinalDirection(track)} />
        <MetricCard label="Distance" value={distance?.toFixed(1) ?? '--'} unit="nm" icon={MapPin} />
        <MetricCard
          label="Squawk"
          value={aircraft.squawk || '----'}
          icon={Radio}
          variant={isEmergencySquawk(aircraft.squawk) ? 'emergency' : 'default'}
        />
      </MetricsGrid>

      {/* Position coordinates */}
      <div className="position-info mt-3 px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
        <span className="text-xs text-text-dim uppercase tracking-wide">Position</span>
        <div className="flex gap-4 mt-1 font-mono text-sm text-text-secondary">
          <span>Lat: {aircraft.lat?.toFixed(5) || '--'}</span>
          <span>Lon: {aircraft.lon?.toFixed(5) || '--'}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * OverviewTab - Combined Info + Live tab for aircraft detail modal
 *
 * Layout:
 * - Live Telemetry section (top) - always visible if aircraft is tracked
 * - Aircraft Info section - airframe, operator, registration cards
 * - Photo card (if available)
 * - Data sources accordion (if available)
 */
export function OverviewTab({
  info,
  hex,
  apiUrl,
  photoInfo,
  aircraft,
  trackHistory,
  calculateDistance,
}) {
  // Normalize info data
  const normalized = info ? normalizeAircraftInfo(info) : null;
  const sourceData = info?.source_data || [];
  const apiBase = (apiUrl || '').replace(/\/$/, '');

  return (
    <motion.div
      className="overview-tab"
      id="panel-overview"
      role="tabpanel"
      aria-labelledby="tab-overview"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Live Telemetry Section */}
      <motion.section
        variants={itemVariants}
        className="overview-section live-section"
        aria-label="Live telemetry"
      >
        <h3 className="overview-section-title">
          <span className="live-indicator" aria-hidden="true" />
          Live Telemetry
        </h3>
        <LiveTelemetrySection
          aircraft={aircraft}
          trackHistory={trackHistory}
          calculateDistance={calculateDistance}
        />
      </motion.section>

      {/* Aircraft Information Section */}
      {normalized && (
        <motion.section
          variants={itemVariants}
          className="overview-section info-section"
          aria-label="Aircraft information"
        >
          <h3 className="overview-section-title">Aircraft Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Airframe Card (full width on md) */}
            <motion.div variants={itemVariants} className="md:col-span-2">
              <AirframeCard data={normalized} />
            </motion.div>

            {/* Route Card (full width on md; self-hides without route data) */}
            <motion.div variants={itemVariants} className="md:col-span-2">
              <RouteCard data={normalized} />
            </motion.div>

            {/* Operator Card */}
            <motion.div variants={itemVariants}>
              <OperatorCard data={normalized} />
            </motion.div>

            {/* Registration Card */}
            <motion.div variants={itemVariants}>
              <RegistrationCard data={normalized} hex={hex} />
            </motion.div>

            {/* Ownership Analysis Card (shell/trust/sanctions; self-hides without data) */}
            <motion.div variants={itemVariants} className="md:col-span-2">
              <OwnershipCard data={normalized} />
            </motion.div>
          </div>
        </motion.section>
      )}

      {/* LLM flight-history narrative (self-hides when LLM off / no history) */}
      {hex && (
        <motion.div variants={itemVariants}>
          <FlightHistoryCard apiBase={apiBase} hex={hex} variant="legacy" />
        </motion.div>
      )}

      {/* Photo Card (if available) */}
      {photoInfo && (
        <motion.section variants={itemVariants} className="overview-section photo-section">
          <PhotoCard photoInfo={photoInfo} />
        </motion.section>
      )}

      {/* Data Sources Accordion (if available) */}
      {sourceData.length > 0 && (
        <motion.section variants={itemVariants} className="overview-section sources-section">
          <DataSourcesAccordion sourceData={sourceData} />
        </motion.section>
      )}

      {/* Empty state for info */}
      {!normalized && (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center py-8 text-center text-text-secondary"
          role="status"
        >
          <Info size={32} className="mb-3 text-text-dim" aria-hidden="true" />
          <p className="text-base font-medium">No aircraft information available</p>
          <span className="mt-1 text-sm text-text-dim">
            Data may not be available for this aircraft
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}
