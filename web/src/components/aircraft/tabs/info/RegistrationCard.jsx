import React from 'react';
import { Hash } from 'lucide-react';
import { BentoCard } from '../../../ui/bento-card';
import { Badge } from '../../../ui/badge';
import { InfoRow } from './InfoRow';

/**
 * RegistrationCard - Card displaying registration and identification information
 */
function RegistrationCard({ data, hex }) {
  const {
    registration,
    is_military,
    category,
  } = data;

  return (
    <BentoCard
      icon={Hash}
      title="Registration"
      aria-labelledby="registration-heading"
    >
      <div className="space-y-1">
        <InfoRow label="Registration" value={registration} mono />
        <InfoRow label="ICAO Hex" value={hex?.toUpperCase() || 'N/A'} mono />
        {is_military && (
          <div className="flex items-center justify-between gap-4 py-2 px-2 -mx-2">
            <span className="text-sm text-text-dim">Type</span>
            <Badge variant="military">Military</Badge>
          </div>
        )}
        <InfoRow label="Category" value={category} />
      </div>
    </BentoCard>
  );
}

export { RegistrationCard };
