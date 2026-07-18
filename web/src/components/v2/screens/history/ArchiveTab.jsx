import React, { useMemo, useState } from 'react';
import { Icon } from '../../primitives';
import { NotamCard, TfrCard, NotamStats, AirportSearch } from '../../../notams';
import {
  PirepHazardBanner,
  TimeFreshnessIndicator,
  SeverityGauge,
  AltitudeRangeViz,
} from '../../../pirep';
import { decodePirep, getPirepMaxSeverity, getPirepAgeMinutes } from '../../../../utils/decoders';

/**
 * Adapt the backend NOTAM stats payload (notams/stats/: total_notams,
 * active_notams, active_tfrs, by_type, last_refresh) to the shape the legacy
 * NotamStats component reads (total_active, tfr_count, last_update). Returns
 * null when there is nothing to show so the header collapses cleanly.
 *
 * @param {object} [raw]
 */
export function adaptNotamStats(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const total = raw.active_notams ?? raw.total_active ?? raw.total_notams ?? 0;
  const tfr = raw.active_tfrs ?? raw.tfr_count ?? 0;
  const lastUpdate = raw.last_refresh ?? raw.last_update ?? null;
  const byType = raw.by_type && typeof raw.by_type === 'object' ? raw.by_type : undefined;
  if (!total && !tfr && !lastUpdate && !byType) return null;
  return {
    total_active: total,
    tfr_count: tfr,
    last_update: lastUpdate,
    by_type: byType,
  };
}

/**
 * NOTAMs arrive with `notam_type` (backend) while NotamCard/TfrCard classify on
 * `type`; normalise so the legacy cards colour + branch correctly. Also expose a
 * boolean for the TFR split.
 *
 * @param {object} n
 */
export function normalizeNotam(n) {
  const type = n.type || n.notam_type || 'D';
  return { ...n, type, isTfr: String(type).toUpperCase() === 'TFR' };
}

function SectionEmpty({ icon, message }) {
  return (
    <div className="v2-arch__empty" data-testid="v2-arch-empty">
      <Icon name={icon} size={30} strokeWidth={1.4} />
      <span>{message}</span>
    </div>
  );
}

/**
 * One archived PIREP row: decodes the met payload and renders the reusable
 * hazard banner, altitude-range band, per-hazard severity gauges and freshness
 * indicator. Every field is guarded.
 *
 * @param {{pirep: object}} props
 */
function ArchivePirepCard({ pirep }) {
  const decoded = useMemo(() => decodePirep(pirep), [pirep]);
  const severity = useMemo(() => getPirepMaxSeverity(pirep), [pirep]);
  const ageMin = getPirepAgeMinutes(pirep);

  const label =
    (pirep.location || '').trim() || (decoded?.location || '').trim() || pirep.pirep_id || 'PIREP';
  const aircraft = pirep.aircraft_type || decoded?.aircraft || null;
  const hasTurb = decoded?.turbulence && decoded.turbulence.level > 0;
  const hasIce = decoded?.icing && decoded.icing.level > 0;
  const hasBands =
    pirep.turbulence_base_ft != null ||
    pirep.turbulence_top_ft != null ||
    pirep.icing_base_ft != null ||
    pirep.icing_top_ft != null;
  const raw = pirep.raw_text || pirep.rawOb || '';

  return (
    <div className="v2-arch__pirep" data-testid="v2-arch-pirep">
      <div className="v2-arch__pirep-head">
        <div className="v2-arch__pirep-titles">
          <span className="v2-arch__pirep-loc v2-mono">{label}</span>
          {aircraft && <span className="v2-arch__pirep-ac">{aircraft}</span>}
        </div>
        {ageMin >= 0 && <TimeFreshnessIndicator pirep={pirep} decoded={decoded} />}
      </div>

      <PirepHazardBanner decoded={decoded} severity={severity} />

      <div className="v2-arch__pirep-body">
        {hasBands && (
          <div className="v2-arch__pirep-viz">
            <AltitudeRangeViz decoded={decoded} pirep={pirep} />
          </div>
        )}
        <div className="v2-arch__pirep-gauges">
          {hasTurb && (
            <SeverityGauge type="turbulence" level={decoded.turbulence.level} label="Turbulence" />
          )}
          {hasIce && <SeverityGauge type="icing" level={decoded.icing.level} label="Icing" />}
          {decoded?.humanSummary && (
            <p className="v2-arch__pirep-summary">{decoded.humanSummary}</p>
          )}
          {raw && <pre className="v2-arch__pirep-raw">{raw}</pre>}
        </div>
      </div>
    </div>
  );
}

/**
 * v2 History → Archive tab. A searchable NOTAM + PIREP archive that reuses the
 * legacy notams/ and pirep/ components for parsing + visualisation.
 *
 * @param {object} props
 * @param {object} props.data - result of useHistoryData (archive queries)
 * @param {string} props.icao - current airport filter (upper-cased)
 * @param {(icao: string) => void} props.onSearch
 * @param {() => void} props.onClear
 */
export function ArchiveTab({ data, icao, onSearch, onClear }) {
  const [expanded, setExpanded] = useState(null);

  const { notamStats, archiveNotams, tfrs, archivePireps } = data;

  const stats = useMemo(() => adaptNotamStats(notamStats?.data), [notamStats?.data]);

  const notams = useMemo(
    () => (archiveNotams?.data || []).map(normalizeNotam),
    [archiveNotams?.data]
  );
  // A TFR list is served separately; also surface any TFR-typed NOTAMs.
  const tfrList = useMemo(() => {
    const fromEndpoint = tfrs?.data || [];
    const fromNotams = notams.filter((n) => n.isTfr);
    const seen = new Set(fromEndpoint.map((t) => t.notam_id));
    return [...fromEndpoint, ...fromNotams.filter((n) => !seen.has(n.notam_id))];
  }, [tfrs?.data, notams]);
  const regularNotams = useMemo(() => notams.filter((n) => !n.isTfr), [notams]);

  const pireps = archivePireps?.data || [];

  // Only gate the search button on the airport-scoped fetches — the initial
  // load of the general lists must not keep the button disabled.
  const loading = Boolean(archiveNotams?.isFetching || archivePireps?.isFetching);

  return (
    <div className="v2-arch" data-testid="v2-history-archive">
      {/* filter */}
      <div className="v2-arch__search">
        <AirportSearch onSearch={onSearch} loading={loading} />
        {icao && (
          <button type="button" className="v2-arch__clear" onClick={onClear}>
            <Icon name="x" size={13} strokeWidth={2} />
            {icao}
          </button>
        )}
      </div>

      {/* NOTAM section */}
      <section className="v2-arch__section" data-testid="v2-arch-notams">
        <h3 className="v2-arch__section-title">
          <Icon name="file" size={15} strokeWidth={1.8} style={{ color: 'var(--warn)' }} />
          NOTAMs {icao ? `· ${icao}` : ''}
        </h3>

        {stats ? (
          <NotamStats stats={stats} />
        ) : (
          <div className="v2-arch__note" data-testid="v2-arch-notam-stats-empty">
            No NOTAM statistics available.
          </div>
        )}

        {tfrList.length > 0 && (
          <div className="v2-arch__tfrs" data-testid="v2-arch-tfrs">
            {tfrList.map((tfr, i) => (
              <TfrCard key={tfr.notam_id ?? i} tfr={tfr} onViewDetails={() => {}} />
            ))}
          </div>
        )}

        {regularNotams.length > 0 ? (
          <div className="v2-arch__notam-list">
            {regularNotams.map((n, i) => {
              const key = n.notam_id ?? n.id ?? i;
              return (
                <NotamCard
                  key={key}
                  notam={n}
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                />
              );
            })}
          </div>
        ) : (
          tfrList.length === 0 && (
            <SectionEmpty
              icon="file"
              message={
                icao
                  ? `No NOTAMs found for ${icao}.`
                  : 'No active NOTAMs. NOTAM data refreshes periodically.'
              }
            />
          )
        )}
      </section>

      {/* PIREP section */}
      <section className="v2-arch__section" data-testid="v2-arch-pireps">
        <h3 className="v2-arch__section-title">
          <Icon name="message" size={15} strokeWidth={1.8} style={{ color: 'var(--accent2)' }} />
          Pilot Reports {icao ? `· ${icao}` : ''}
        </h3>

        {pireps.length > 0 ? (
          <div className="v2-arch__pirep-list">
            {pireps.map((p, i) => (
              <ArchivePirepCard key={p.pirep_id ?? p.id ?? i} pirep={p} />
            ))}
          </div>
        ) : (
          <SectionEmpty
            icon="message"
            message={
              icao ? `No pilot reports found for ${icao}.` : 'No pilot reports in the archive.'
            }
          />
        )}
      </section>
    </div>
  );
}

export default ArchiveTab;
