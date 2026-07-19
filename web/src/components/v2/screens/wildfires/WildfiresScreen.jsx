import React, { useMemo, useState } from 'react';
import { Icon } from '../../primitives';
import { useHashParamState } from '../../../../hooks/useHashParamState';
import { useWildfires, useWildfireBundle } from '../../../../hooks/queries';
import { CameraLightbox } from './CameraLightbox';

function threatTier(score) {
  const s = typeof score === 'number' ? score : 0;
  if (s >= 60) return { color: 'var(--danger)', label: 'HIGH', key: 'high' };
  if (s >= 20) return { color: 'var(--warn)', label: 'ELEVATED', key: 'elevated' };
  return { color: '#80ed99', label: 'LOW', key: 'low' };
}

function ago(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function compactNum(n) {
  if (n == null || Number.isNaN(n)) return '--';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return Number(n).toLocaleString();
}

/** Radial 0–100 threat gauge drawn as an SVG arc in the tier color. */
function ThreatGauge({ score, color, size = 76 }) {
  const s = Math.max(0, Math.min(100, typeof score === 'number' ? score : 0));
  const r = (size - 9) / 2;
  const c = 2 * Math.PI * r;
  const dash = (s / 100) * c;
  return (
    <div className="v2-fires__gauge" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--bord2)"
          strokeWidth="5"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            filter: `drop-shadow(0 0 4px ${color})`,
            transition: 'stroke-dasharray .6s ease',
          }}
        />
      </svg>
      <div className="v2-fires__gauge-val" style={{ color }}>
        {typeof score === 'number' ? Math.round(score) : '—'}
      </div>
    </div>
  );
}

/**
 * Full-page Wildfires screen. Lists active Watch Duty fires near the feeder,
 * ranked by threat, and opens a detail rail (reports / cameras / scanner feeds)
 * for the selected fire. Ember-heat aesthetic over the v2 tactical-dark theme.
 */
export function WildfiresScreen({ feederLocation, onOpenMap }) {
  const lat = feederLocation?.lat;
  const lon = feederLocation?.lon;
  const { data, isLoading, isError, refetch, isFetching } = useWildfires(
    { lat, lon, radiusNm: 500 },
    { enabled: lat != null && lon != null }
  );

  const fires = useMemo(() => {
    const list = data?.wildfires || [];
    return [...list].sort(
      (a, b) =>
        (b.threat_score ?? -1) - (a.threat_score ?? -1) || (b.acreage ?? 0) - (a.acreage ?? 0)
    );
  }, [data]);

  const [selId, setSelId] = useHashParamState('sel', null);
  const selectedId = selId != null ? Number(selId) : null;
  const selected = fires.find((f) => f.id === selectedId) || null;

  const counts = useMemo(() => {
    const c = { high: 0, elevated: 0, low: 0 };
    for (const f of fires) c[threatTier(f.threat_score).key] += 1;
    return c;
  }, [fires]);

  const readout = useMemo(() => {
    let acres = 0;
    let contSum = 0;
    let contN = 0;
    let evac = 0;
    for (const f of fires) {
      if (f.acreage != null) acres += Number(f.acreage) || 0;
      if (f.containment != null) {
        contSum += Number(f.containment) || 0;
        contN += 1;
      }
      if (f.evac_orders) evac += 1;
    }
    return {
      acres,
      avgCont: contN ? Math.round(contSum / contN) : null,
      evac,
      top: fires[0] || null,
    };
  }, [fires]);

  const showData = lat != null && !isLoading && !isError;

  return (
    <div className="v2-fires" data-testid="v2-wildfires-screen">
      <header className="v2-fires__masthead">
        <div className="v2-fires__haze" aria-hidden="true" />
        <div className="v2-fires__title">
          <span className="v2-fires__title-flame">
            <Icon name="flame" size={22} strokeWidth={1.7} />
          </span>
          <div>
            <h1>Wildfires</h1>
            <p>Active fires near the feeder · Watch Duty</p>
          </div>
        </div>
        <div className="v2-fires__legend">
          <span className="v2-fires__pill v2-fires__pill--high">{counts.high} high</span>
          <span className="v2-fires__pill v2-fires__pill--elevated">
            {counts.elevated} elevated
          </span>
          <span className="v2-fires__pill v2-fires__pill--low">{counts.low} low</span>
          <button
            type="button"
            className="v2-fires__refresh"
            onClick={() => refetch()}
            aria-label="Refresh"
          >
            <Icon
              name="refresh-cw"
              size={15}
              strokeWidth={1.9}
              className={isFetching ? 'is-spin' : ''}
            />
          </button>
        </div>
      </header>

      {showData && fires.length > 0 && (
        <div className="v2-fires__readout" role="status">
          <div className="v2-fires__readout-metric">
            <Icon name="flame" size={13} strokeWidth={1.8} />
            <span className="v2-fires__readout-val">{fires.length}</span>
            <span className="v2-fires__readout-key">tracked</span>
          </div>
          <span className="v2-fires__readout-sep" />
          <div className="v2-fires__readout-metric">
            <Icon name="layers" size={13} strokeWidth={1.8} />
            <span className="v2-fires__readout-val">{compactNum(readout.acres)}</span>
            <span className="v2-fires__readout-key">acres burning</span>
          </div>
          <span className="v2-fires__readout-sep" />
          <div className="v2-fires__readout-metric">
            <Icon name="shield-check" size={13} strokeWidth={1.8} />
            <span className="v2-fires__readout-val">
              {readout.avgCont != null ? `${readout.avgCont}%` : '--'}
            </span>
            <span className="v2-fires__readout-key">avg contained</span>
          </div>
          {readout.evac > 0 && (
            <>
              <span className="v2-fires__readout-sep" />
              <div className="v2-fires__readout-metric v2-fires__readout-metric--evac">
                <Icon name="alert-triangle" size={13} strokeWidth={1.9} />
                <span className="v2-fires__readout-val">{readout.evac}</span>
                <span className="v2-fires__readout-key">under evac order</span>
              </div>
            </>
          )}
          {readout.top && (
            <button
              type="button"
              className="v2-fires__readout-top"
              onClick={() => setSelId(String(readout.top.id))}
              style={{ '--fire-color': threatTier(readout.top.threat_score).color }}
            >
              <span className="v2-fires__readout-top-dot" />
              <span className="v2-fires__readout-top-label">Top threat</span>
              <span className="v2-fires__readout-top-name">
                {readout.top.name || `Fire #${readout.top.id}`}
              </span>
            </button>
          )}
        </div>
      )}

      <div className="v2-fires__body">
        <div className="v2-fires__list">
          {lat == null && <div className="v2-fires__empty">No feeder location configured.</div>}
          {lat != null && isLoading && (
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="v2-fires__skel" style={{ animationDelay: `${i * 90}ms` }} />
              ))}
            </>
          )}
          {isError && <div className="v2-fires__empty">Could not load wildfires.</div>}
          {showData && fires.length === 0 && (
            <div className="v2-fires__empty">
              <Icon name="flame" size={30} strokeWidth={1.3} style={{ color: 'var(--dim2)' }} />
              <span>No active wildfires within range.</span>
            </div>
          )}

          {fires.map((f, i) => {
            const tier = threatTier(f.threat_score);
            const active = f.id === selectedId;
            const cont = f.containment != null ? Math.round(Number(f.containment)) : null;
            return (
              <button
                key={f.id}
                type="button"
                className={`v2-fires__card ${active ? 'is-active' : ''} ${tier.key === 'high' ? 'is-hot' : ''}`}
                style={{ '--fire-color': tier.color, animationDelay: `${Math.min(i, 12) * 45}ms` }}
                onClick={() => setSelId(active ? null : String(f.id))}
                data-testid={`v2-fire-${f.id}`}
              >
                <span className="v2-fires__card-bar" />
                <div className="v2-fires__card-main">
                  <div className="v2-fires__card-top">
                    <span className="v2-fires__card-name">{f.name || `Fire #${f.id}`}</span>
                    <span className="v2-fires__card-tier" style={{ color: tier.color }}>
                      {typeof f.threat_score === 'number' ? Math.round(f.threat_score) : '—'}
                    </span>
                  </div>
                  <div className="v2-fires__card-meta">
                    <span>{f.acreage != null ? `${compactNum(f.acreage)} ac` : '—'}</span>
                    <span>·</span>
                    <span>{cont != null ? `${cont}% cont` : '—'}</span>
                    {f.evac_orders && <span className="v2-fires__card-evac">EVAC</span>}
                    <span className="v2-fires__card-ago">{ago(f.date_modified)}</span>
                  </div>
                  <div className="v2-fires__card-cont" aria-hidden="true">
                    <span className="v2-fires__card-cont-fill" style={{ width: `${cont ?? 0}%` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <FireDetail fire={selected} onOpenMap={onOpenMap} />
      </div>
    </div>
  );
}

function FireDetail({ fire, onOpenMap }) {
  const { data: bundle, isLoading, isError } = useWildfireBundle(fire?.id);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  if (!fire) {
    return (
      <div className="v2-fires__detail v2-fires__detail--empty">
        <span className="v2-fires__empty-flame">
          <Icon name="flame" size={40} strokeWidth={1.2} />
        </span>
        <span>Select a fire to see updates, cameras and scanner feeds.</span>
      </div>
    );
  }

  const tier = threatTier(fire.threat_score);
  const reports = bundle?.reports || [];
  const cameras = (bundle?.cameras || []).filter((c) => c.image_url && !c.is_offline);
  const feeds = bundle?.radio_feeds || [];
  const cont = fire.containment != null ? Math.round(Number(fire.containment)) : null;

  return (
    <div
      className="v2-fires__detail"
      style={{ '--fire-color': tier.color }}
      data-testid="v2-fire-detail"
    >
      <div className={`v2-fires__detail-head ${tier.key === 'high' ? 'is-hot' : ''}`}>
        <div className="v2-fires__glow" />
        <div className="v2-fires__detail-headrow">
          <div className="v2-fires__detail-headmain">
            <div className="v2-fires__detail-title">
              <Icon name="flame" size={20} strokeWidth={1.7} style={{ color: tier.color }} />
              <span>{fire.name || `Fire #${fire.id}`}</span>
            </div>
            <div className="v2-fires__detail-tier" style={{ color: tier.color }}>
              <span className="v2-fires__tier-dot" style={{ color: tier.color }} />
              {tier.label} THREAT
              {fire.is_prescribed && <span className="v2-fires__rx">PRESCRIBED</span>}
            </div>
            {onOpenMap && (
              <button type="button" className="v2-fires__map-btn" onClick={onOpenMap}>
                <Icon name="map" size={13} strokeWidth={1.8} /> View on map
              </button>
            )}
          </div>
          <ThreatGauge score={fire.threat_score} color={tier.color} />
        </div>
      </div>

      <div className="v2-fires__detail-body">
        <div className="v2-fires__stats">
          <div className="v2-fires__stat">
            <span className="v2-fires__stat-val">
              {fire.acreage != null ? Number(fire.acreage).toLocaleString() : '--'}
            </span>
            <span className="v2-fires__stat-label">acres</span>
          </div>
          <div className="v2-fires__stat">
            <span className="v2-fires__stat-val">{cont != null ? `${cont}%` : '--'}</span>
            <span className="v2-fires__stat-label">contained</span>
          </div>
          <div className="v2-fires__stat">
            <span className="v2-fires__stat-val">{ago(fire.date_modified) || '--'}</span>
            <span className="v2-fires__stat-label">updated</span>
          </div>
        </div>

        {cont != null && (
          <div className="v2-fires__contbar">
            <div className="v2-fires__contbar-track">
              <span className="v2-fires__contbar-fill" style={{ width: `${cont}%` }} />
            </div>
            <span className="v2-fires__contbar-cap">{cont}% contained</span>
          </div>
        )}

        {(fire.evac_orders || fire.evac_warnings) && (
          <div className="v2-fires__evac">
            {fire.evac_orders && (
              <div className="v2-fires__evac-row v2-fires__evac-row--order">
                <Icon name="alert-triangle" size={13} strokeWidth={1.8} />
                <span>
                  <strong>Evac orders:</strong> {fire.evac_orders}
                </span>
              </div>
            )}
            {fire.evac_warnings && (
              <div className="v2-fires__evac-row v2-fires__evac-row--warn">
                <Icon name="alert-circle" size={13} strokeWidth={1.8} />
                <span>
                  <strong>Warnings:</strong> {fire.evac_warnings}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="v2-fires__eyebrow">Updates</div>
        {isLoading && <div className="v2-fires__muted">Loading reports…</div>}
        {isError && <div className="v2-fires__muted">Reports unavailable.</div>}
        {!isLoading && !isError && reports.length === 0 && (
          <div className="v2-fires__muted">No recent updates.</div>
        )}
        <ul className="v2-fires__reports">
          {reports.slice(0, 20).map((r) => (
            <li key={r.id} className="v2-fires__report">
              <span className="v2-fires__report-time">{ago(r.date_created) || ''}</span>
              <span
                className="v2-fires__report-msg"
                dangerouslySetInnerHTML={{ __html: r.message || '' }}
              />
            </li>
          ))}
        </ul>

        {cameras.length > 0 && (
          <>
            <div className="v2-fires__eyebrow">
              Cameras <span className="v2-fires__eyebrow-count">{cameras.length}</span>
            </div>
            <div className="v2-fires__cams">
              {cameras.slice(0, 4).map((c, i) => (
                <figure key={c.id} className="v2-fires__cam">
                  <button
                    type="button"
                    className="v2-fires__cam-btn"
                    onClick={() => setLightboxIndex(i)}
                    aria-label={`Expand ${c.name || 'camera'}`}
                  >
                    <img src={c.image_url} alt={c.name || 'wildfire camera'} loading="lazy" />
                    <span className="lm-fire__cam-zoom">
                      <Icon name="maximize" size={13} strokeWidth={1.9} />
                    </span>
                  </button>
                  <span className="v2-fires__cam-live">LIVE</span>
                  <figcaption>{c.name}</figcaption>
                </figure>
              ))}
            </div>
          </>
        )}

        {feeds.length > 0 && (
          <>
            <div className="v2-fires__eyebrow">Scanner feeds</div>
            <ul className="v2-fires__feeds">
              {feeds.slice(0, 8).map((f) => (
                <li key={f.feed_id} className="v2-fires__feed">
                  <a href={f.listen_url} target="_blank" rel="noopener noreferrer">
                    <Icon name="radio" size={13} strokeWidth={1.7} />
                    <span>{f.name}</span>
                  </a>
                  <span className={`v2-fires__feed-live ${f.online ? 'is-online' : ''}`}>
                    {f.online ? `${f.listeners ?? 0} listening` : 'offline'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {lightboxIndex != null && (
        <CameraLightbox
          cameras={cameras}
          index={lightboxIndex}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
