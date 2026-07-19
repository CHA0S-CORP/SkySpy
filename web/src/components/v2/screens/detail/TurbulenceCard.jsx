import React from 'react';
import { Icon } from '../../primitives';
import { usePointTurbulence, turbLevelMeta } from '../../../../hooks/usePointTurbulence';

const FL = (ft) => (ft == null ? null : `FL${Math.round(ft / 100)}`);

/**
 * Turbulence risk card for the Aircraft Detail screen. Assesses the turbulence
 * at the aircraft's live position/altitude (NWS G-AIRMET forecast + nearby
 * PIREPs + winds-aloft shear) and renders a gauge + source breakdown. Falls back
 * to the scorer's own per-aircraft level (live.turbulenceLevel) when a live
 * position isn't available for an on-demand assessment.
 *
 * @param {object} props
 * @param {object|undefined} props.live - live socket aircraft entry
 * @param {string} props.apiBase
 */
export function TurbulenceCard({ live, apiBase }) {
  const lat = typeof live?.lat === 'number' ? live.lat : null;
  const lon = typeof live?.lon === 'number' ? live.lon : null;
  const altFt = live?.alt_baro ?? live?.alt ?? null;

  const { level, score, gairmet, pireps, winds, loading } = usePointTurbulence({
    lat,
    lon,
    altitudeFt: typeof altFt === 'number' ? altFt : null,
    enabled: true,
    apiBase,
  });

  // Prefer the on-demand point assessment; fall back to the scorer's cached
  // per-aircraft level when we can't assess (no live position).
  const effLevel = lat != null && lon != null ? level : live?.turbulenceLevel || 'none';
  const effScore = lat != null && lon != null ? score : (live?.turbulenceRisk ?? 0);
  const meta = turbLevelMeta(effLevel);
  const rank = meta.rank;

  const hasPosition = lat != null && lon != null;

  return (
    <div className="v2-det__card v2-turbcard" data-testid="v2-detail-turbulence">
      <div className="v2-det__card-head">
        <Icon name="wind" size={15} strokeWidth={1.7} style={{ color: meta.color }} />
        <span>Turbulence Risk</span>
        <span className="v2-det__card-aside">
          {hasPosition ? 'at aircraft position' : 'last known'}
        </span>
      </div>
      <div className="v2-det__card-body">
        {/* Score dial */}
        <div className="v2-turbcard__hero">
          <div
            className="v2-turbcard__dial"
            style={{
              background: `conic-gradient(${meta.color} ${effScore * 3.6}deg, var(--bg3) ${effScore * 3.6}deg)`,
            }}
          >
            <div className="v2-turbcard__dial-inner">
              <span className="v2-turbcard__score" style={{ color: meta.color }}>
                {loading && !hasPosition ? '··' : effScore}
              </span>
              <span className="v2-turbcard__score-max">/100</span>
            </div>
          </div>
          <div className="v2-turbcard__hero-meta">
            <span className="v2-turbcard__level" style={{ color: meta.color }}>
              {meta.label}
            </span>
            <span className="v2-turbcard__level-sub">
              {altFt != null ? `${Math.round(altFt).toLocaleString('en-US')} ft` : 'altitude n/a'}
              {FL(altFt) ? ` · ${FL(altFt)}` : ''}
            </span>
            {/* severity ladder */}
            <div className="v2-turbcard__ladder">
              {['none', 'light', 'moderate', 'severe'].map((lv, i) => {
                const lm = turbLevelMeta(lv);
                return (
                  <span
                    key={lv}
                    className="v2-turbcard__rung"
                    title={lm.label}
                    style={{
                      background: i <= rank ? lm.color : 'var(--bg3)',
                      opacity: i <= rank ? 1 : 0.5,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Contributing sources */}
        <div className="v2-turbcard__sources">
          <SourceRow
            icon="layers"
            label="G-AIRMET forecast"
            active={gairmet.length > 0}
            detail={
              gairmet.length
                ? gairmet
                    .map((g) => g.hazard + (g.severity ? ` ${g.severity}` : ''))
                    .slice(0, 2)
                    .join(', ')
                : 'no turbulence advisory here'
            }
          />
          <SourceRow
            icon="alert-triangle"
            label="Pilot reports"
            active={pireps.length > 0}
            detail={
              pireps.length
                ? `${pireps.length} nearby PIREP${pireps.length === 1 ? '' : 's'}`
                : 'no nearby turbulence PIREPs'
            }
          />
          <SourceRow
            icon="wind"
            label="Winds-aloft shear"
            active={!!winds}
            detail={
              winds?.shear_kt_per_kft != null
                ? `${winds.shear_kt_per_kft} kt / 1000 ft`
                : 'shear data unavailable'
            }
          />
        </div>

        {!hasPosition && (
          <div className="v2-turbcard__note">
            <Icon name="info" size={11} strokeWidth={1.9} />
            No live position — showing the last risk the tracker computed.
          </div>
        )}
      </div>
    </div>
  );
}

function SourceRow({ icon, label, active, detail }) {
  return (
    <div className={`v2-turbcard__src ${active ? 'is-active' : ''}`}>
      <span className="v2-turbcard__src-icon">
        <Icon name={icon} size={13} strokeWidth={1.8} />
      </span>
      <span className="v2-turbcard__src-label">{label}</span>
      <span className="v2-turbcard__src-detail">{detail}</span>
      <span className={`v2-turbcard__src-dot ${active ? 'is-on' : ''}`} />
    </div>
  );
}

export default TurbulenceCard;
