import React, { useMemo } from 'react';
import { Icon } from '../../primitives';
import { decodeMetar } from '../../../../utils/decoders';
import { FLIGHT_CATEGORIES, isMetarStale, getMetarAgeMinutes } from '../../../../utils/metarUtils';

/**
 * A decoded METAR rendered as an aviation "flight strip": station + flight
 * category, a dense readout grid (wind / visibility / ceiling / temp / dewpoint /
 * altimeter), weather-phenomena chips, cloud layers, and the raw observation.
 * Turns the cryptic raw METAR into human-readable fields via decodeMetar.
 *
 * @param {object} props
 * @param {object} props.metar - raw METAR object (from useAviationData)
 */
export function MetarStrip({ metar }) {
  const d = useMemo(() => decodeMetar(metar), [metar]);
  if (!d) return null;

  const cat = FLIGHT_CATEGORIES[d.flightCategory] || FLIGHT_CATEGORIES.VFR;
  const stale = isMetarStale(metar);
  const ageMin = getMetarAgeMinutes(metar);

  return (
    <div className={`v2-wx__strip ${stale ? 'is-stale' : ''}`} style={{ '--cat': cat.color }}>
      <div className="v2-wx__strip-spine" style={{ background: cat.color }} />
      <div className="v2-wx__strip-main">
        <div className="v2-wx__strip-head">
          <span className="v2-wx__strip-station v2-mono">{d.station || '----'}</span>
          <span className="v2-wx__strip-cat" style={{ color: cat.color, borderColor: cat.color }}>
            {cat.code}
          </span>
          <span className="v2-wx__strip-catname">{cat.name}</span>
          <span className="v2-wx__strip-time">
            <Icon name="clock" size={10} strokeWidth={1.8} />
            {ageMin != null ? `${ageMin}m ago` : d.time || ''}
          </span>
        </div>

        <div className="v2-wx__strip-grid">
          <Field label="WIND" value={d.wind?.text || 'calm'} sub={d.wind?.description} />
          <Field
            label="VIS"
            value={d.visibility ? `${d.visibility.value} ${d.visibility.unit}` : '—'}
            sub={d.visibility?.description}
          />
          <Field
            label="CEILING"
            value={ceilingText(d.clouds)}
            sub={
              d.clouds?.length
                ? `${d.clouds.length} layer${d.clouds.length === 1 ? '' : 's'}`
                : 'clear'
            }
          />
          <Field
            label="TEMP"
            value={d.temperature ? `${d.temperature.celsius}°C` : '—'}
            sub={d.temperature?.description}
          />
          <Field
            label="DEWPT"
            value={d.dewpoint ? `${d.dewpoint.celsius}°C` : '—'}
            sub={d.dewpoint ? `Δ${d.dewpoint.spread}° · ${d.dewpoint.fogRisk}` : null}
          />
          <Field
            label="ALTIM"
            value={d.altimeter ? `${d.altimeter.inhg}"` : '—'}
            sub={d.altimeter ? `${d.altimeter.mb} mb` : null}
          />
        </div>

        {(d.weather?.length > 0 || d.clouds?.length > 0) && (
          <div className="v2-wx__strip-tags">
            {d.weather?.map((w, i) => (
              <span key={`wx-${i}`} className="v2-wx__strip-wx" title={w.description}>
                {w.description}
              </span>
            ))}
            {d.clouds?.map((c, i) => (
              <span key={`cl-${i}`} className="v2-wx__strip-cloud">
                {c.cover}
                {c.base != null ? ` ${c.base.toLocaleString('en-US')}ft` : ''}
              </span>
            ))}
          </div>
        )}

        {d.raw && <div className="v2-wx__strip-raw v2-mono">{d.raw}</div>}
      </div>
    </div>
  );
}

function Field({ label, value, sub }) {
  return (
    <div className="v2-wx__strip-field">
      <span className="v2-wx__strip-flabel">{label}</span>
      <span className="v2-wx__strip-fval v2-mono">{value}</span>
      {sub && <span className="v2-wx__strip-fsub">{sub}</span>}
    </div>
  );
}

function ceilingText(clouds) {
  if (!clouds || clouds.length === 0) return 'Clear';
  const ceil = clouds.find((c) => c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV');
  if (!ceil) return 'None';
  return `${ceil.cover} ${ceil.base != null ? `${ceil.base.toLocaleString('en-US')}ft` : ''}`.trim();
}

export default MetarStrip;
