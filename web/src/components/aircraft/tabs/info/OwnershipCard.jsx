import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { BentoCard } from '../../../ui/bento-card';
import { InfoRow } from './InfoRow';

const OWNER_TYPE_LABELS = {
  individual: 'Individual',
  partnership: 'Partnership',
  corporation: 'Corporation',
  co_owned: 'Co-Owned',
  government: 'Government',
  llc: 'LLC',
  non_citizen_corp: 'Non-Citizen Corp',
  non_citizen_co_owned: 'Non-Citizen Co-Owned',
  trust: 'Trust',
  unknown: 'Unknown',
};

// Human labels for the shell-score contributing factors.
const FACTOR_LABELS = {
  generic_llc_name: 'Generic LLC name',
  registered_agent_address: 'Registered-agent address',
  po_box_address: 'PO box address',
  multiple_transfers: 'Rapid ownership transfers',
  trust_ownership: 'Trust structure',
  sanctions_hit: 'Sanctions / PEP match',
  llc_no_web_presence: 'No web presence',
};

const RISK_STYLES = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  low: 'text-text-primary',
};

/**
 * OwnershipCard - Shell-company / trust / sanctions risk analysis for the owner.
 * All fields are computed server-side (registration_analysis) and arrive on the
 * airframe record: owner_type, is_shell_suspected, shell_score, ownership_flags.
 */
function OwnershipCard({ data }) {
  const { owner_type, is_shell_suspected, shell_score, ownership_flags } = data;

  const hasData = owner_type || shell_score != null || ownership_flags;
  if (!hasData) return null;

  const riskLevel = ownership_flags?.risk_level;
  const factors = ownership_flags?.factors || {};
  const sanctions = ownership_flags?.details?.sanctions;
  const fractional = ownership_flags?.fractional_owner;

  // Top contributing factors, strongest first, as a compact "Name 80%" list.
  const factorRows = Object.entries(factors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, val]) => (
      <InfoRow
        key={key}
        label={FACTOR_LABELS[key] || key}
        value={`${Math.round(val * 100)}%`}
        mono
      />
    ));

  return (
    <BentoCard icon={ShieldAlert} title="Ownership Analysis" aria-labelledby="ownership-heading">
      <div className="space-y-1">
        <InfoRow label="Owner type" value={OWNER_TYPE_LABELS[owner_type] || owner_type} />
        {shell_score != null && (
          <InfoRow
            label="Shell-company risk"
            value={`${Math.round(shell_score * 100)}%${riskLevel ? ` (${riskLevel})` : ''}`}
            valueClassName={RISK_STYLES[riskLevel] || undefined}
            mono
          />
        )}
        {is_shell_suspected && (
          <InfoRow label="Suspected shell" value="Yes" valueClassName="text-red-400" />
        )}
        {fractional && <InfoRow label="Fractional owner" value="Yes" />}
        {sanctions?.caption && (
          <InfoRow
            label="Sanctions match"
            value={sanctions.caption}
            valueClassName="text-red-400"
          />
        )}
        {sanctions?.topics?.length > 0 && (
          <InfoRow label="Sanctions topics" value={sanctions.topics.join(', ')} />
        )}
      </div>
      {factorRows.length > 0 && (
        <div className="mt-3 border-t border-white/5 pt-2">
          <div className="mb-1 text-xs uppercase tracking-wide text-text-dim">Risk factors</div>
          <div className="space-y-1">{factorRows}</div>
        </div>
      )}
    </BentoCard>
  );
}

export { OwnershipCard };
