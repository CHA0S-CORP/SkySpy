import React from 'react';
import { Camera } from 'lucide-react';
import { BentoCard } from '../../../ui/bento-card';
import { InfoRow } from './InfoRow';

/**
 * PhotoCard - Card displaying photo attribution information
 */
function PhotoCard({ photoInfo }) {
  if (!photoInfo) return null;

  const { photographer, source } = photoInfo;
  const hasData = photographer || source;
  if (!hasData) return null;

  return (
    <BentoCard
      icon={Camera}
      title="Photo"
      colSpan={2}
      aria-labelledby="photo-heading"
    >
      <div className="space-y-1">
        <InfoRow label="Photographer" value={photographer} />
        <InfoRow label="Source" value={source} />
      </div>
    </BentoCard>
  );
}

export { PhotoCard };
