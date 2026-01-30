import React from 'react';
import { Plane } from 'lucide-react';
import { BentoCard } from '../../../ui/bento-card';
import { InfoRow } from './InfoRow';

/**
 * AirframeCard - Hero card displaying aircraft type and airframe information
 */
function AirframeCard({ data }) {
  const {
    type_name,
    type_code,
    manufacturer,
    model,
    serial_number,
    year_built,
    age_years,
  } = data;

  // Don't render if no airframe data
  const hasData = type_name || type_code || manufacturer || model || serial_number || year_built;
  if (!hasData) return null;

  return (
    <BentoCard
      variant="hero"
      size="lg"
      icon={Plane}
      title="Airframe"
      colSpan={2}
      aria-labelledby="airframe-heading"
    >
      <div className="space-y-1">
        <InfoRow label="Type" value={type_name} />
        <InfoRow label="ICAO Code" value={type_code} mono />
        <InfoRow label="Manufacturer" value={manufacturer} />
        <InfoRow label="Model" value={model} />
        <InfoRow label="Serial #" value={serial_number} mono />
        <InfoRow label="Year Built" value={year_built} />
        {age_years !== null && age_years !== undefined && (
          <InfoRow label="Age" value={`${age_years} years`} />
        )}
      </div>
    </BentoCard>
  );
}

export { AirframeCard };
