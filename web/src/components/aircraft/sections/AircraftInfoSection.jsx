import React from 'react';
import { AirframeCard, OperatorCard, RegistrationCard } from '../tabs/info';

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
 * AircraftInfoSection - Aircraft information cards
 *
 * Reuses existing cards: AirframeCard, OperatorCard, RegistrationCard
 */
export function AircraftInfoSection({ info, hex }) {
  const normalized = info ? normalizeAircraftInfo(info) : null;

  if (!normalized) {
    return null;
  }

  return (
    <div className="aircraft-info-grid">
      <AirframeCard data={normalized} />
      <OperatorCard data={normalized} />
      <RegistrationCard data={normalized} hex={hex} />
    </div>
  );
}
