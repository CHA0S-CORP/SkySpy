import React from 'react';
import { Building2 } from 'lucide-react';
import { BentoCard } from '../../../ui/bento-card';
import { InfoRow } from './InfoRow';

/**
 * OperatorCard - Card displaying operator and owner information
 */
function OperatorCard({ data }) {
  const {
    operator,
    operator_icao,
    owner,
    country,
  } = data;

  // Don't render if no operator data
  const hasData = operator || operator_icao || owner || country;
  if (!hasData) return null;

  return (
    <BentoCard
      icon={Building2}
      title="Operator"
      aria-labelledby="operator-heading"
    >
      <div className="space-y-1">
        <InfoRow label="Operator" value={operator} />
        <InfoRow label="ICAO" value={operator_icao} mono />
        <InfoRow label="Owner" value={owner} />
        <InfoRow label="Country" value={country} />
      </div>
    </BentoCard>
  );
}

export { OperatorCard };
