import React, { useEffect, useCallback } from 'react';
import { Radar, MessageSquare } from 'lucide-react';

import { useAircraftDetail } from './hooks/useAircraftDetail';
import { SidebarHeader, AircraftHeroCard, LiveStatusBar } from './components/sidebar';
import {
  AircraftSection,
  OperatorSection,
  RegistrationSection,
  DataSourcesSection,
} from './components/sections';

import '../../styles/aircraft-sidebar.css';

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
  };
}

/**
 * AircraftSidebar - FlightRadar24-inspired sidebar panel
 *
 * Features:
 * - Fixed right sidebar (380px)
 * - Compact header with close/share buttons
 * - Hero photo with glass overlay
 * - Live status bar with metrics
 * - Collapsible sections for details
 * - External links footer
 */
export function AircraftSidebar({
  hex,
  apiUrl,
  onClose,
  onOpenDetail,
  aircraft,
  aircraftInfo,
  feederLocation,
  wsRequest,
  wsConnected,
}) {
  const state = useAircraftDetail({
    hex,
    apiUrl,
    aircraft,
    aircraftInfo,
    feederLocation,
    wsRequest,
    wsConnected,
    initialTab: 'overview',
  });

  const {
    info,
    loading,
    shareSuccess,
    handleShare,
    calculateDistance,
    expandedSections,
    toggleSection,
    photoInfo,
    photoUrl,
    photoState,
    photoRetryCount,
    useThumbnail,
    handlePhotoError,
    handlePhotoLoad,
    retryPhoto,
  } = state;

  // Normalize the info data - with explicit null check before calling normalizeAircraftInfo
  const normalized = info != null ? normalizeAircraftInfo(info) : null;
  const sourceData = info?.source_data || [];

  // Handle escape key to close
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // External links
  const callsign = aircraft?.flight?.trim();
  const externalLinks = [
    {
      name: 'FlightAware',
      url: callsign
        ? `https://flightaware.com/live/flight/${callsign}`
        : `https://flightaware.com/live/modes/${hex}`,
    },
    {
      name: 'Planespotters',
      url: `https://www.planespotters.net/hex/${hex?.toUpperCase()}`,
    },
    {
      name: 'ADS-B Exchange',
      url: `https://globe.adsbexchange.com/?icao=${hex}`,
    },
  ];

  return (
    <>
      {/* Backdrop for mobile */}
      <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />

      <aside
        className="aircraft-sidebar entering"
        aria-label={`Aircraft details for ${callsign || hex}`}
      >
        {/* Header */}
        <SidebarHeader
          hex={hex}
          aircraft={aircraft}
          info={info}
          shareSuccess={shareSuccess}
          onShare={handleShare}
          onClose={onClose}
        />

        {/* Hero Photo */}
        <AircraftHeroCard
          hex={hex}
          info={info}
          photoInfo={photoInfo}
          photoUrl={photoUrl}
          photoState={photoState}
          photoRetryCount={photoRetryCount}
          useThumbnail={useThumbnail}
          onPhotoLoad={handlePhotoLoad}
          onPhotoError={handlePhotoError}
          onRetry={retryPhoto}
        />

        {/* Live Status Bar */}
        <LiveStatusBar aircraft={aircraft} calculateDistance={calculateDistance} />

        {/* Scrollable Content */}
        <div className="sidebar-content">
          {loading ? (
            <div className="sidebar-loading">
              <div className="sidebar-loading-radar">
                <Radar size={24} aria-hidden="true" />
                <div className="sidebar-loading-sweep" />
              </div>
              <span>Loading aircraft data...</span>
            </div>
          ) : (
            <>
              {/* Aircraft Section */}
              <AircraftSection
                data={normalized}
                isExpanded={expandedSections.aircraft}
                onToggle={() => toggleSection('aircraft')}
              />

              {/* Operator Section */}
              <OperatorSection
                data={normalized}
                isExpanded={expandedSections.operator}
                onToggle={() => toggleSection('operator')}
              />

              {/* Registration Section */}
              <RegistrationSection
                data={normalized}
                hex={hex}
                isExpanded={expandedSections.registration}
                onToggle={() => toggleSection('registration')}
              />

              {/* Data Sources Section */}
              <DataSourcesSection
                sourceData={sourceData}
                isExpanded={expandedSections.sources}
                onToggle={() => toggleSection('sources')}
              />

              {/* View Full Details Button */}
              {onOpenDetail && (
                <button
                  className="sidebar-tabs-link"
                  onClick={() => onOpenDetail(hex)}
                  type="button"
                >
                  <MessageSquare size={14} />
                  View Full Details
                </button>
              )}
            </>
          )}
        </div>

        {/* External Links Footer */}
        <div className="sidebar-links">
          {externalLinks.map((link) => (
            <a
              key={link.name}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="sidebar-link"
            >
              {link.name}
            </a>
          ))}
        </div>
      </aside>
    </>
  );
}
