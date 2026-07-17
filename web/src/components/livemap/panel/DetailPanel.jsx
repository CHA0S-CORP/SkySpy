import React, { useMemo } from 'react';
import { Icon, Sparkline } from '../../v2/primitives';
import { useDetailData } from '../../v2/screens/detail/useDetailData';
import { flightStatus } from '../../v2/screens/detail/detailModel';
import { altitudeOf, CATEGORY_COLORS, categoryOf } from '../../v2/screens/list/listModel';

/**
 * 392px collapsible Live Map detail panel (design SkySpy.dc.html right pane):
 * photo banner, ID chips, 2×2 primary stat grid, more-details, performance
 * sparklines from track history, external links.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {object|null} props.aircraft - the selected live aircraft entry
 * @param {Array} [props.track] - recent track samples (for sparklines)
 * @param {() => void} props.onClose
 */
export function DetailPanel({ apiBase, aircraft, track = [], onClose, onOpenFull }) {
  const hex = aircraft?.hex;
  const callsign = (aircraft?.flight || '').trim();
  const { info } = useDetailData(apiBase, hex, callsign);
  const airframe = info.data || {};

  const status = flightStatus(aircraft);
  const cat = aircraft ? categoryOf(aircraft) : 'commercial';
  const catColor = CATEGORY_COLORS[cat];
  const alt = aircraft ? altitudeOf(aircraft) : 0;

  const altSeries = useMemo(
    () => track.map((p) => p.alt ?? p.altitude ?? 0).filter((v) => typeof v === 'number'),
    [track]
  );
  const spdSeries = useMemo(
    () => track.map((p) => p.spd ?? p.gs ?? 0).filter((v) => typeof v === 'number'),
    [track]
  );

  if (!aircraft) {
    return (
      <aside className="lm-panel lm-panel--empty" data-testid="lm-detail-panel">
        <Icon name="send" size={34} strokeWidth={1.4} style={{ color: 'var(--dim2)' }} />
        <span>Select an aircraft to view details</span>
      </aside>
    );
  }

  const chip = (label, value) => (
    <div className="lm-panel__chip">
      <span className="lm-panel__chip-label">{label}</span>
      <span className="lm-panel__chip-val">{value}</span>
    </div>
  );

  const num = (v, digits = 0) => (typeof v === 'number' ? v.toFixed(digits) : '--');

  return (
    <aside className="lm-panel" data-testid="lm-detail-panel">
      <div
        className="lm-panel__banner"
        style={airframe.photo_url ? { backgroundImage: `url(${airframe.photo_url})` } : undefined}
      >
        <div className="lm-panel__banner-scrim" />
        <button
          type="button"
          className="lm-panel__close"
          onClick={onClose}
          aria-label="Close panel"
        >
          <Icon name="x" size={16} strokeWidth={1.9} />
        </button>
        <div className="lm-panel__banner-id">
          <span className="lm-panel__cs">{callsign || (hex || '').toUpperCase()}</span>
          <span
            className="lm-panel__cat"
            style={{
              color: catColor,
              background: `color-mix(in srgb, ${catColor} 16%, transparent)`,
            }}
          >
            {cat.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="lm-panel__body">
        <div className="lm-panel__status" style={{ color: status.color }}>
          <span className="lm-panel__status-dot" style={{ background: status.color }} />
          {status.label}
        </div>

        <div className="lm-panel__chips">
          {chip('HEX', (hex || '').toUpperCase())}
          {chip('TYPE', airframe.aircraft_type || aircraft.t || '--')}
          {chip('SIZE', airframe.size || '--')}
          {chip('REG', airframe.registration || aircraft.r || '--')}
        </div>

        {(airframe.operator || airframe.owner) && (
          <div className="lm-panel__operator">{airframe.operator || airframe.owner}</div>
        )}

        <div className="lm-panel__stats">
          <div className="lm-panel__stat">
            <div className="lm-panel__stat-label">ALTITUDE</div>
            <div className="lm-panel__stat-val">
              {alt.toLocaleString('en-US')}
              <span> ft</span>
            </div>
          </div>
          <div className="lm-panel__stat">
            <div className="lm-panel__stat-label">GROUND SPD</div>
            <div className="lm-panel__stat-val">
              {num(aircraft.gs)}
              <span> kts</span>
            </div>
          </div>
          <div className="lm-panel__stat">
            <div className="lm-panel__stat-label">VERT SPEED</div>
            <div
              className="lm-panel__stat-val"
              style={{
                color:
                  aircraft.vr < 0 ? 'var(--warn)' : aircraft.vr > 0 ? 'var(--accent)' : undefined,
              }}
            >
              {aircraft.vr ?? '--'}
              <span> fpm</span>
            </div>
          </div>
          <div className="lm-panel__stat">
            <div className="lm-panel__stat-label">DISTANCE</div>
            <div className="lm-panel__stat-val">
              {num(aircraft.distance_nm, 1)}
              <span> nm</span>
            </div>
          </div>
        </div>

        <div className="lm-panel__eyebrow">MORE DETAILS</div>
        <div className="lm-panel__kv">
          <span>Track</span>
          <span className="v2-mono">
            {aircraft.track != null ? `${Math.round(aircraft.track)}°` : '--'}
          </span>
        </div>
        <div className="lm-panel__kv">
          <span>Squawk</span>
          <span className="v2-mono">{aircraft.squawk || '--'}</span>
        </div>
        <div className="lm-panel__kv">
          <span>RSSI</span>
          <span className="v2-mono">
            {aircraft.rssi != null ? `${aircraft.rssi.toFixed(1)} dB` : '--'}
          </span>
        </div>

        {(altSeries.length > 1 || spdSeries.length > 1) && (
          <>
            <div className="lm-panel__eyebrow">PERFORMANCE</div>
            <div className="lm-panel__spark-grid">
              {altSeries.length > 1 && (
                <div className="lm-panel__spark">
                  <span>Altitude</span>
                  <Sparkline data={altSeries} width={150} height={34} color="var(--accent)" area />
                </div>
              )}
              {spdSeries.length > 1 && (
                <div className="lm-panel__spark">
                  <span>Speed</span>
                  <Sparkline data={spdSeries} width={150} height={34} color="var(--accent2)" area />
                </div>
              )}
            </div>
          </>
        )}

        <button type="button" className="v2-btn lm-panel__full" onClick={() => onOpenFull?.(hex)}>
          <Icon name="external-link" size={14} strokeWidth={1.7} />
          Open full detail
        </button>
      </div>
    </aside>
  );
}
