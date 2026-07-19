import React, { useState } from 'react';
import { Icon } from '../../v2/primitives';
import { useWildfireBundle } from '../../../hooks/queries';
import { CameraLightbox } from '../../v2/screens/wildfires/CameraLightbox';

/**
 * Threat tier → ember color, mirroring the canvas marker + libwatchduty tiers
 * (red high ≥60, amber medium ≥20, else green/contained).
 */
function threatTier(score) {
  const s = typeof score === 'number' ? score : 0;
  if (s >= 60) return { color: 'var(--danger)', label: 'HIGH' };
  if (s >= 20) return { color: 'var(--warn)', label: 'ELEVATED' };
  return { color: '#80ed99', label: 'LOW' };
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

/**
 * Live Map wildfire detail panel. Given a selected Watch Duty fire marker, loads
 * the per-fire bundle (reports feed, PTZ camera stills, Broadcastify scanner
 * feeds) and renders it with an ember-heat aesthetic inside the shared lm-panel.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {object} props.fire - selected marker: {id,name,lat,lon,acreage,containment,threat_score,evac_orders,...}
 * @param {() => void} props.onClose
 */
export function WildfirePanel({ fire, onClose }) {
  const { data: bundle, isLoading, isError } = useWildfireBundle(fire?.id);

  const tier = threatTier(fire?.threat_score);
  const reports = bundle?.reports || [];
  const cameras = (bundle?.cameras || []).filter((c) => c.image_url && !c.is_offline);
  const feeds = bundle?.radio_feeds || [];
  // Header image = the closest camera's still (cameras are proximity-ranked).
  const heroCam = cameras[0] || null;
  // Index into `cameras` currently expanded in the lightbox (null = closed).
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const num = (v, digits = 0) => (typeof v === 'number' ? v.toFixed(digits) : '--');

  return (
    <aside className="lm-panel lm-fire" data-testid="lm-wildfire-panel">
      <div
        className={`lm-panel__banner lm-fire__banner ${heroCam ? 'lm-fire__banner--photo' : ''}`}
        style={{
          '--fire-color': tier.color,
          ...(heroCam ? { backgroundImage: `url(${heroCam.image_url})` } : null),
        }}
      >
        <div className="lm-fire__glow" />
        {heroCam && <div className="lm-fire__banner-scrim" />}
        {heroCam?.name && <span className="lm-fire__cam-tag">{heroCam.name}</span>}
        {heroCam && (
          <button
            type="button"
            className="lm-fire__expand"
            onClick={() => setLightboxIndex(0)}
            aria-label="Expand camera image"
          >
            <Icon name="maximize" size={15} strokeWidth={1.9} />
          </button>
        )}
        <button
          type="button"
          className="lm-panel__close"
          onClick={onClose}
          aria-label="Close panel"
        >
          <Icon name="x" size={16} strokeWidth={1.9} />
        </button>
        <div className="lm-fire__head">
          <Icon name="flame" size={22} strokeWidth={1.7} style={{ color: tier.color }} />
          <span className="lm-fire__name">{fire?.name || `Fire #${fire?.id}`}</span>
        </div>
        <div className="lm-fire__tier" style={{ color: tier.color }}>
          <span className="lm-fire__tier-dot" style={{ background: tier.color }} />
          {tier.label} THREAT
          {typeof fire?.threat_score === 'number' && (
            <span className="lm-fire__score">{Math.round(fire.threat_score)}</span>
          )}
          {fire?.is_prescribed && <span className="lm-fire__rx">PRESCRIBED</span>}
        </div>
      </div>

      <div className="lm-panel__body">
        <div className="lm-fire__stats">
          <div className="lm-fire__stat">
            <span className="lm-fire__stat-val">
              {fire?.acreage != null ? Number(fire.acreage).toLocaleString() : '--'}
            </span>
            <span className="lm-fire__stat-label">acres</span>
          </div>
          <div className="lm-fire__stat">
            <span className="lm-fire__stat-val">
              {fire?.containment != null ? `${num(fire.containment)}%` : '--'}
            </span>
            <span className="lm-fire__stat-label">contained</span>
          </div>
          <div className="lm-fire__stat">
            <span className="lm-fire__stat-val">{ago(fire?.date_modified) || '--'}</span>
            <span className="lm-fire__stat-label">updated</span>
          </div>
        </div>

        {fire?.containment != null && (
          <div className="lm-fire__contain">
            <div
              className="lm-fire__contain-fill"
              style={{ width: `${Math.max(0, Math.min(100, fire.containment))}%` }}
            />
          </div>
        )}

        {(fire?.evac_orders || fire?.evac_warnings) && (
          <div className="lm-fire__evac">
            {fire.evac_orders && (
              <div className="lm-fire__evac-row lm-fire__evac-row--order">
                <Icon name="alert-triangle" size={13} strokeWidth={1.8} />
                <span>
                  <strong>Evac orders:</strong> {fire.evac_orders}
                </span>
              </div>
            )}
            {fire.evac_warnings && (
              <div className="lm-fire__evac-row lm-fire__evac-row--warn">
                <Icon name="alert-circle" size={13} strokeWidth={1.8} />
                <span>
                  <strong>Warnings:</strong> {fire.evac_warnings}
                </span>
              </div>
            )}
          </div>
        )}

        {fire?.address && <div className="lm-fire__addr">{fire.address}</div>}

        {cameras.length > 1 && (
          <>
            <div className="lm-panel__eyebrow">MORE CAMERAS</div>
            <div className="lm-fire__cams">
              {cameras.slice(1, 4).map((c, i) => (
                <figure key={c.id} className="lm-fire__cam">
                  <button
                    type="button"
                    className="lm-fire__cam-btn"
                    onClick={() => setLightboxIndex(i + 1)}
                    aria-label={`Expand ${c.name || 'camera'}`}
                  >
                    <img src={c.image_url} alt={c.name || 'wildfire camera'} loading="lazy" />
                    <span className="lm-fire__cam-zoom">
                      <Icon name="maximize" size={13} strokeWidth={1.9} />
                    </span>
                  </button>
                  <figcaption>
                    {c.name}
                    {typeof c.distance_km === 'number' && (
                      <span className="lm-fire__cam-dist"> · {c.distance_km.toFixed(1)} km</span>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          </>
        )}

        <div className="lm-panel__eyebrow">UPDATES</div>
        {isLoading && <div className="lm-fire__muted">Loading reports…</div>}
        {isError && <div className="lm-fire__muted">Reports unavailable.</div>}
        {!isLoading && !isError && reports.length === 0 && (
          <div className="lm-fire__muted">No recent updates.</div>
        )}
        <ul className="lm-fire__reports">
          {reports.slice(0, 8).map((r) => (
            <li key={r.id} className="lm-fire__report">
              <span className="lm-fire__report-time">{ago(r.date_created) || ''}</span>
              <span
                className="lm-fire__report-msg"
                // Watch Duty report messages are short server-sanitized HTML fragments.
                dangerouslySetInnerHTML={{ __html: r.message || '' }}
              />
            </li>
          ))}
        </ul>

        {feeds.length > 0 && (
          <>
            <div className="lm-panel__eyebrow">SCANNER FEEDS</div>
            <ul className="lm-fire__feeds">
              {feeds.slice(0, 5).map((f) => (
                <li key={f.feed_id} className="lm-fire__feed">
                  <a href={f.listen_url} target="_blank" rel="noopener noreferrer">
                    <Icon name="radio" size={13} strokeWidth={1.7} />
                    <span className="lm-fire__feed-name">{f.name}</span>
                  </a>
                  <span className={`lm-fire__feed-live ${f.online ? 'is-online' : ''}`}>
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
    </aside>
  );
}
