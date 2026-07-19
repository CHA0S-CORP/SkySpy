import React, { useMemo } from 'react';
import { SeverityGauge, TimeFreshnessIndicator } from '../../../pirep';
import { decodePirep, getPirepMaxSeverity } from '../../../../utils/decoders';

/**
 * A decoded PIREP rendered as a rich card: hazard headline, turbulence + icing
 * severity gauges, altitude/aircraft context, and freshness. Reuses the existing
 * /components/pirep visualizations. Decodes the raw report via decodePirep.
 *
 * @param {object} props
 * @param {object} props.pirep - raw PIREP object
 */
export function PirepCard({ pirep }) {
  const decoded = useMemo(() => decodePirep(pirep), [pirep]);
  const sev = useMemo(() => getPirepMaxSeverity(pirep), [pirep]);
  if (!decoded) return null;

  const urgent = decoded.type === 'UUA';
  const turbLevel = decoded.turbulence?.level ?? 0;
  const iceLevel = decoded.icing?.level ?? 0;

  return (
    <div
      className={`v2-wx__pirep ${urgent ? 'is-urgent' : ''} sev-${sev?.backendSeverity || 'routine'}`}
    >
      <div className="v2-wx__pirep-head">
        <span className="v2-wx__pirep-loc v2-mono">
          {decoded.location || pirep.location || '—'}
        </span>
        {urgent && <span className="v2-wx__pirep-urgent">URGENT</span>}
        <span className="v2-wx__pirep-alt v2-mono">{decoded.altitude?.text || ''}</span>
        <span className="v2-wx__pirep-spacer" />
        <TimeFreshnessIndicator pirep={pirep} decoded={decoded} />
      </div>

      {decoded.aircraft && (
        <div className="v2-wx__pirep-ac">
          {decoded.aircraft}
          {decoded.temperature ? ` · ${decoded.temperature.celsius}°C` : ''}
          {decoded.wind?.text ? ` · wind ${decoded.wind.text}` : ''}
        </div>
      )}

      <div className="v2-wx__pirep-gauges">
        {turbLevel > 0 && (
          <div className="v2-wx__pirep-gauge">
            <SeverityGauge type="turbulence" level={turbLevel} label="Turbulence" />
            {decoded.turbulence?.type && (
              <span className="v2-wx__pirep-gtype">{decoded.turbulence.type}</span>
            )}
          </div>
        )}
        {iceLevel > 0 && (
          <div className="v2-wx__pirep-gauge">
            <SeverityGauge type="icing" level={iceLevel} label="Icing" />
            {decoded.icing?.type && (
              <span className="v2-wx__pirep-gtype">{decoded.icing.type}</span>
            )}
          </div>
        )}
        {turbLevel === 0 && iceLevel === 0 && (
          <span className="v2-wx__pirep-smooth">Smooth · no hazards reported</span>
        )}
      </div>

      {decoded.raw && <div className="v2-wx__pirep-raw v2-mono">{decoded.raw}</div>}
    </div>
  );
}

export default PirepCard;
