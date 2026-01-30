import React from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import {
  AirframeCard,
  OperatorCard,
  RegistrationCard,
  PhotoCard,
  DataSourcesAccordion,
} from './info';

// Stagger animation variants for the bento grid
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
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
    // Airframe fields
    type_name: info.type_name || info.aircraft_type || info.type || info.t,
    type_code: info.type_code || info.icao_type || info.icaoAircraftType,
    manufacturer: info.manufacturer || info.manufacturerName,
    model: info.model || info.modelName,
    serial_number: info.serial_number || info.serialNumber || info.manufacturerSerial,
    year_built: info.year_built || info.yearBuilt || info.built,
    age_years: info.age_years ?? info.ageYears ?? (() => {
      const year = info.year_built || info.yearBuilt || info.built;
      const yearNum = Number(year);
      if (!year || isNaN(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear()) {
        return null;
      }
      return new Date().getFullYear() - yearNum;
    })(),

    // Operator fields
    operator: info.operator || info.operatorName || info.owner_operator,
    operator_icao: info.operator_icao || info.operatorIcao || info.airline_icao,
    owner: info.owner || info.ownerName || info.registered_owner,
    country: info.country || info.countryName || info.registered_country,

    // Registration fields
    registration: info.registration || info.tail_number || info.reg || info.r,
    is_military: info.is_military ?? info.military ?? info.isMilitary ?? false,
    category: info.category || info.aircraftCategory,
  };
}

/**
 * InfoTab - Aircraft information display with modern bento grid layout
 */
export function InfoTab({ info, hex, photoInfo }) {
  // Empty state
  if (!info) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 text-center text-text-secondary"
        role="status"
      >
        <Info size={48} className="mb-4 text-text-dim" aria-hidden="true" />
        <p className="text-lg font-medium">No aircraft information available</p>
        <span className="mt-1 text-sm text-text-dim">
          Data may not be available for this aircraft
        </span>
      </div>
    );
  }

  // Extract and normalize data
  const sourceData = info.source_data || [];
  const normalized = normalizeAircraftInfo(info);

  return (
    <motion.div
      className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4"
      id="panel-info"
      role="tabpanel"
      aria-labelledby="tab-info"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Hero: Airframe Card (spans 2 columns) */}
      <motion.div variants={itemVariants} className="md:col-span-2">
        <AirframeCard data={normalized} />
      </motion.div>

      {/* Operator Card */}
      <motion.div variants={itemVariants}>
        <OperatorCard data={normalized} />
      </motion.div>

      {/* Registration Card */}
      <motion.div variants={itemVariants}>
        <RegistrationCard data={normalized} hex={hex} />
      </motion.div>

      {/* Photo Card (spans 2 columns, optional) */}
      {photoInfo && (
        <motion.div variants={itemVariants} className="md:col-span-2">
          <PhotoCard photoInfo={photoInfo} />
        </motion.div>
      )}

      {/* Data Sources Accordion (spans 2 columns, optional) */}
      {sourceData.length > 0 && (
        <motion.div variants={itemVariants} className="md:col-span-2">
          <DataSourcesAccordion sourceData={sourceData} />
        </motion.div>
      )}
    </motion.div>
  );
}
