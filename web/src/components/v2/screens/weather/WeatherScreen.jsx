import React, { useMemo } from 'react';
import { Icon } from '../../primitives';
import { useHashParamState } from '../../../../hooks/useHashParamState';
import { useAviationData } from '../../../../hooks/useAviationData';
import { useAirspaceAdvisories } from '../../../../hooks/useAirspaceAdvisories';
import { useTurbulenceRiskList } from '../../../../hooks/useTurbulenceRiskList';
import { useAircraftTurbulence } from '../../../../hooks/useAircraftTurbulence';
import { usePointTurbulence, turbLevelMeta } from '../../../../hooks/usePointTurbulence';
import { getTurbulenceSeverity } from '../../../../hooks/useTurbulenceOverlay';
import { WeatherMap } from './WeatherMap';
import { MetarStrip } from './MetarStrip';
import { PirepCard } from './PirepCard';

const WX_TABS = ['Overview', 'Turbulence', 'METARs', 'PIREPs'];
const OVERLAYS = { metars: true, pireps: true, airspace: true };

const fl = (ft) => (ft == null ? null : `FL${Math.round(ft / 100)}`);
const levelClass = (lvl) => `v2-wx__risk-${lvl || 'none'}`;

/**
 * v2 Weather screen — an aviation-weather ops console. Aggregates the NWS/AWC
 * data already flowing through the app (METAR/PIREP/G-AIRMET) into a decoded,
 * map-backed picture and overlays the per-aircraft turbulence risk synthesized
 * by the backend. Raw METARs/PIREPs are decoded to plain fields; a live map
 * shows advisory polygons, station categories, PIREPs and at-risk aircraft.
 */
export function WeatherScreen({
  aircraft = [],
  wsRequest,
  wsConnected,
  feederLocation,
  onSelectAircraft,
  onOpenMap,
  apiBase = '',
}) {
  const [wxTab, setWxTab] = useHashParamState('wx', 'Overview');

  const feederLat = feederLocation?.lat ?? feederLocation?.latitude ?? null;
  const feederLon = feederLocation?.lon ?? feederLocation?.longitude ?? null;

  const { aviationData } = useAviationData(
    wsRequest,
    wsConnected,
    feederLat,
    feederLon,
    250,
    OVERLAYS
  );
  // Fetch ALL advisories (no server-side hazard filter — it exact-matches and
  // would drop TURB-LO/TURB-HI) and keep the turbulence family ourselves.
  const { advisories: allAdvisories } = useAirspaceAdvisories(wsRequest, wsConnected);
  const turbAdvisories = useMemo(
    () => (allAdvisories || []).filter((a) => (a.hazard || '').toUpperCase().startsWith('TURB')),
    [allAdvisories]
  );

  // The socket aircraft here don't carry turbulence risk (only MapView merges
  // that). Poll the scorer's per-hex map and stamp it on so the at-risk list and
  // map darts populate on this screen too.
  const { byHex: turbByHex } = useAircraftTurbulence({ enabled: true, apiBase });
  const scoredAircraft = useMemo(() => {
    if (!turbByHex || turbByHex.size === 0) return aircraft;
    return aircraft.map((ac) => {
      const t = turbByHex.get((ac.hex || '').toUpperCase());
      return t ? { ...ac, turbulenceLevel: t.level, turbulenceRisk: t.score } : ac;
    });
  }, [aircraft, turbByHex]);
  const { atRisk, countsByLevel } = useTurbulenceRiskList(scoredAircraft);

  // Turbulence at the receiver — the "sector" readout in the header. feederDefault
  // lets the backend assess the receiver even when the frontend feeder coords are
  // stripped (anonymous sessions).
  const sector = usePointTurbulence({
    lat: feederLat,
    lon: feederLon,
    apiBase,
    feederDefault: true,
  });
  const sectorMeta = turbLevelMeta(sector.level);

  const metars = aviationData?.metars || [];
  const pireps = aviationData?.pireps || [];

  // Aircraft flagged at risk that also carry a live position (for the map).
  const atRiskWithPos = useMemo(
    () => atRisk.filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number'),
    [atRisk]
  );

  const turbCards = useMemo(
    () => (turbAdvisories || []).map((a) => ({ ...a, severity: getTurbulenceSeverity(a) })),
    [turbAdvisories]
  );

  // Sort METARs worst-category-first so the strip surfaces IFR/LIFR up top.
  const catRank = { LIFR: 0, IFR: 1, MVFR: 2, VFR: 3 };
  const metarsSorted = useMemo(
    () => [...metars].sort((a, b) => (catRank[a.fltCat] ?? 4) - (catRank[b.fltCat] ?? 4)),
    [metars]
  );
  const pirepsWithHazard = useMemo(
    () => pireps.filter((p) => p.turbType || p.iceType || p.report_type === 'UUA'),
    [pireps]
  );

  const map = (
    <WeatherMap
      feederLat={feederLat}
      feederLon={feederLon}
      turbAdvisories={turbAdvisories || []}
      metars={metars}
      pireps={pireps}
      atRisk={atRiskWithPos}
      onSelectAircraft={onSelectAircraft}
    />
  );

  return (
    <div className="v2-wx">
      {/* ── command header ─────────────────────────────────────────── */}
      <header className="v2-wx__header">
        <div className="v2-wx__title">
          <span className="v2-eyebrow">NWS · AVIATION WEATHER CENTER</span>
          <h1>
            <Icon name="cloud" size={19} strokeWidth={1.8} />
            Weather &amp; Turbulence
          </h1>
        </div>

        <div className="v2-wx__sector" style={{ '--sev': sectorMeta.color }}>
          <div
            className="v2-wx__sector-dial"
            style={{
              background: `conic-gradient(${sectorMeta.color} ${sector.score * 3.6}deg, var(--bg3) 0)`,
            }}
          >
            <span className="v2-wx__sector-score v2-mono">{sector.score}</span>
          </div>
          <div className="v2-wx__sector-meta">
            <span className="v2-wx__sector-label">SECTOR TURBULENCE</span>
            <span className="v2-wx__sector-level" style={{ color: sectorMeta.color }}>
              {sectorMeta.label}
            </span>
            <span className="v2-wx__sector-sub">at receiver</span>
          </div>
        </div>

        <div className="v2-wx__kpis">
          <Kpi n={metars.length} label="METARs" icon="cloud" />
          <Kpi n={pireps.length} label="PIREPs" icon="alert-triangle" />
          <Kpi n={turbCards.length} label="TURB zones" icon="wind" />
          <Kpi n={atRisk.length} label="a/c at risk" icon="plane" alert={atRisk.length > 0} />
        </div>
      </header>

      {/* ── tab rail ───────────────────────────────────────────────── */}
      <nav className="v2-wx__tabs">
        {WX_TABS.map((t) => (
          <button
            key={t}
            aria-pressed={wxTab === t}
            className={`v2-wx__tab ${wxTab === t ? 'is-active' : ''}`}
            onClick={() => setWxTab(t)}
          >
            {t}
            {t === 'Turbulence' && atRisk.length > 0 && (
              <span className="v2-wx__tab-badge">{atRisk.length}</span>
            )}
          </button>
        ))}
      </nav>

      {/* ── body ───────────────────────────────────────────────────── */}
      <div className="v2-wx__body">
        {wxTab === 'Overview' && (
          <div className="v2-wx__console">
            {/* LEFT RAIL — risk */}
            <aside className="v2-wx__rail">
              <section className="v2-wx__panel">
                <div className="v2-wx__panel-head">
                  <Icon name="wind" size={13} strokeWidth={1.8} />
                  Turbulence Risk
                </div>
                <div className="v2-wx__risk-summary">
                  {['severe', 'moderate', 'light', 'none'].map((lvl) => (
                    <div key={lvl} className={`v2-wx__risk-chip ${levelClass(lvl)}`}>
                      <span className="v2-mono">{countsByLevel[lvl]}</span>
                      <span>{lvl}</span>
                    </div>
                  ))}
                </div>
                <AtRiskList
                  atRisk={atRisk}
                  onSelectAircraft={onSelectAircraft}
                  onOpenMap={onOpenMap}
                />
              </section>
            </aside>

            {/* CENTER — map + decoded METAR strips */}
            <div className="v2-wx__center">
              <section className="v2-wx__panel v2-wx__panel--map">
                <div className="v2-wx__panel-head">
                  <Icon name="map-pin" size={13} strokeWidth={1.8} />
                  Situation Map
                  <span className="v2-wx__legend">
                    <LegendDot color="var(--warn)" label="TURB" />
                    <LegendDot color="var(--accent)" label="VFR" />
                    <LegendDot color="var(--danger)" label="LIFR" />
                  </span>
                </div>
                <div className="v2-wx__map">{map}</div>
              </section>

              <section className="v2-wx__panel">
                <div className="v2-wx__panel-head">
                  <Icon name="cloud" size={13} strokeWidth={1.8} />
                  Decoded Observations
                  <span className="v2-wx__panel-aside">{metarsSorted.length} stations</span>
                </div>
                {metarsSorted.length === 0 && <p className="v2-wx__empty">No METARs in range.</p>}
                <div className="v2-wx__strips">
                  {metarsSorted.slice(0, 6).map((m, i) => (
                    <MetarStrip key={m.icaoId || m.stationId || i} metar={m} />
                  ))}
                </div>
              </section>
            </div>

            {/* RIGHT RAIL — advisories + pireps */}
            <aside className="v2-wx__rail">
              <section className="v2-wx__panel">
                <div className="v2-wx__panel-head">
                  <Icon name="layers" size={13} strokeWidth={1.8} />
                  G-AIRMET Turbulence
                  <span className="v2-wx__panel-aside">{turbCards.length}</span>
                </div>
                <TurbAdvisoryList cards={turbCards} />
              </section>
              <section className="v2-wx__panel">
                <div className="v2-wx__panel-head">
                  <Icon name="alert-triangle" size={13} strokeWidth={1.8} />
                  Recent PIREPs
                  <span className="v2-wx__panel-aside">{pirepsWithHazard.length} hazards</span>
                </div>
                {pirepsWithHazard.length === 0 && (
                  <p className="v2-wx__empty">No hazard PIREPs in range.</p>
                )}
                <div className="v2-wx__pireps">
                  {pirepsWithHazard.slice(0, 4).map((p, i) => (
                    <PirepCard key={p.pirep_id || i} pirep={p} />
                  ))}
                </div>
              </section>
            </aside>
          </div>
        )}

        {wxTab === 'Turbulence' && (
          <div className="v2-wx__two">
            <section className="v2-wx__panel v2-wx__panel--map">
              <div className="v2-wx__panel-head">
                <Icon name="map-pin" size={13} strokeWidth={1.8} />
                Turbulence Map
              </div>
              <div className="v2-wx__map v2-wx__map--tall">{map}</div>
            </section>
            <div className="v2-wx__two-stack">
              <section className="v2-wx__panel">
                <div className="v2-wx__panel-head">
                  <Icon name="plane" size={13} strokeWidth={1.8} />
                  Aircraft At Risk
                  <span className="v2-wx__panel-aside">{atRisk.length}</span>
                </div>
                <AtRiskList
                  atRisk={atRisk}
                  onSelectAircraft={onSelectAircraft}
                  onOpenMap={onOpenMap}
                  detailed
                />
              </section>
              <section className="v2-wx__panel">
                <div className="v2-wx__panel-head">
                  <Icon name="layers" size={13} strokeWidth={1.8} />
                  Active Advisories
                  <span className="v2-wx__panel-aside">{turbCards.length}</span>
                </div>
                <TurbAdvisoryList cards={turbCards} detailed />
              </section>
            </div>
          </div>
        )}

        {wxTab === 'METARs' && (
          <section className="v2-wx__panel">
            <div className="v2-wx__panel-head">
              <Icon name="cloud" size={13} strokeWidth={1.8} />
              Station Observations — Decoded
              <span className="v2-wx__panel-aside">{metarsSorted.length}</span>
            </div>
            {metarsSorted.length === 0 && <p className="v2-wx__empty">No METARs in range.</p>}
            <div className="v2-wx__strips v2-wx__strips--grid">
              {metarsSorted.map((m, i) => (
                <MetarStrip key={m.icaoId || m.stationId || i} metar={m} />
              ))}
            </div>
          </section>
        )}

        {wxTab === 'PIREPs' && (
          <section className="v2-wx__panel">
            <div className="v2-wx__panel-head">
              <Icon name="alert-triangle" size={13} strokeWidth={1.8} />
              Pilot Reports — Decoded
              <span className="v2-wx__panel-aside">{pireps.length}</span>
            </div>
            {pireps.length === 0 && <p className="v2-wx__empty">No recent PIREPs in range.</p>}
            <div className="v2-wx__pireps v2-wx__pireps--grid">
              {pireps.map((p, i) => (
                <PirepCard key={p.pirep_id || i} pirep={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Kpi({ n, label, icon, alert }) {
  return (
    <div className={`v2-wx__kpi ${alert ? 'v2-wx__kpi--alert' : ''}`}>
      <Icon name={icon} size={13} strokeWidth={1.8} className="v2-wx__kpi-icon" />
      <span className="v2-wx__kpi-n v2-mono">{n}</span>
      <span className="v2-wx__kpi-l">{label}</span>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="v2-wx__legend-item">
      <span className="v2-wx__legend-dot" style={{ background: color }} />
      {label}
    </span>
  );
}

function AtRiskList({ atRisk, onSelectAircraft, onOpenMap, detailed }) {
  if (!atRisk.length)
    return <p className="v2-wx__empty">No aircraft at moderate+ turbulence risk.</p>;
  return (
    <ul className="v2-wx__aclist">
      {atRisk.map((ac) => {
        const meta = turbLevelMeta(ac.turbulenceLevel);
        return (
          <li key={ac.hex} className="v2-wx__acrow" style={{ '--sev': meta.color }}>
            <span className="v2-wx__acbar" />
            <button className="v2-wx__aclink v2-mono" onClick={() => onSelectAircraft?.(ac.hex)}>
              {ac.flight?.trim() || ac.hex}
            </button>
            <span className="v2-wx__acscore v2-mono" style={{ color: meta.color }}>
              {ac.turbulenceRisk ?? '—'}
            </span>
            <span className="v2-wx__acmeta">
              {meta.label}
              {detailed && ac.alt_baro != null ? ` · ${fl(ac.alt_baro)}` : ''}
            </span>
            <button
              className="v2-wx__acmap"
              title="Show on live map"
              onClick={() => onOpenMap?.(ac.hex)}
            >
              <Icon name="map-pin" size={13} strokeWidth={1.8} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TurbAdvisoryList({ cards, detailed }) {
  if (!cards.length) return <p className="v2-wx__empty">No active turbulence advisories.</p>;
  return (
    <ul className="v2-wx__advlist">
      {cards.map((a) => (
        <li key={a.advisory_id || a.id} className="v2-wx__advrow">
          <span
            className="v2-wx__advsev"
            style={{ background: a.severity?.color, borderColor: a.severity?.stroke }}
          >
            {a.severity?.label}
          </span>
          <span className="v2-mono v2-wx__advhaz">{a.hazard}</span>
          <span className="v2-wx__advband v2-mono">
            {a.lower_alt_ft != null ? fl(a.lower_alt_ft) : 'SFC'}–
            {a.upper_alt_ft != null ? fl(a.upper_alt_ft) : '—'}
          </span>
          {detailed && a.valid_to && (
            <span className="v2-wx__advvalid">
              until {new Date(a.valid_to).toLocaleTimeString('en-US', { hour12: false })}Z
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default WeatherScreen;
