import React, { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Modal, Icon } from '../../primitives';
import { api } from '../../../../lib/api';
import { Planform } from './Planform';
import { CATEGORY_COLOR, CATEGORIES } from './airframesData';

const SEEN_PAGE = 25;

const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

// unit conversions
const M_TO_FT = 3.28084;
const KG_TO_LB = 2.20462;
const KT_TO_KMH = 1.852;
const NM_TO_KM = 1.852;
const FT_TO_M = 0.3048;
const r0 = (n) => Math.round(n).toLocaleString();
const r1 = (n) => (Math.round(n * 10) / 10).toLocaleString();

/** One dual-unit spec row in the technical readout. */
function SpecRow({ k, primary, secondary }) {
  return (
    <div className="v2-afm__row">
      <span className="v2-afm__row-k">{k}</span>
      <span className="v2-afm__row-v v2-mono">
        {primary}
        {secondary != null && <span className="v2-afm__row-s"> {secondary}</span>}
      </span>
    </div>
  );
}

/** Reference photograph with graceful fallback to the blueprint on load error. */
function TypePhoto({ frame, color }) {
  const [failed, setFailed] = useState(false);
  if (!frame.photoFull || failed) {
    return (
      <div className="v2-afm__photo v2-afm__photo--empty">
        <Planform
          length={frame.length}
          span={frame.span}
          shape={frame.shape}
          color={color}
          w={360}
          h={280}
        />
        <span className="v2-afm__nophoto v2-mono">NO REFERENCE IMAGE — SYNTHESISED PLAN</span>
      </div>
    );
  }
  return (
    <figure className="v2-afm__photo">
      <img
        src={frame.photoFull}
        alt={`${frame.mfr} ${frame.name}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <span className="v2-afm__scanline" />
      <figcaption className="v2-afm__credit v2-mono">
        <Icon name="file" size={10} strokeWidth={1.8} />
        REF. PHOTO · {frame.credit || 'Wikimedia Commons'}
      </figcaption>
    </figure>
  );
}

/**
 * Lazy-loaded list of tails of this type actually tracked by the station,
 * newest last-seen first. Each row links to the aircraft's detail page.
 *
 * @param {object} props
 * @param {string} props.type - ICAO type designator (frame.id)
 * @param {boolean} props.open - only fetch while the modal is open
 * @param {number|null} [props.hours] - recency window (matches the screen filter); null = all-time
 * @param {(hex: string) => void} [props.onSelect]
 */
function SeenTails({ type, open, hours, onSelect }) {
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['v2-seen-airframes', type, hours ?? 'all'],
      enabled: open && !!type,
      initialPageParam: 0,
      queryFn: ({ pageParam }) =>
        api.getSeenAirframesByType(type, {
          limit: SEEN_PAGE,
          offset: pageParam,
          ...(hours ? { hours } : {}),
        }),
      getNextPageParam: (last) => last?.next_offset ?? undefined,
      staleTime: 60 * 1000,
    });

  const rows = (data?.pages || []).flatMap((p) => p?.results || []);
  const total = data?.pages?.[0]?.count ?? 0;

  return (
    <section className="v2-afm__seen">
      <div className="v2-afm__sheet-head v2-mono">
        SEEN HERE{total > 0 && <span className="v2-afm__seen-n"> · {total}</span>}
      </div>

      {isLoading ? (
        <div className="v2-afm__seen-empty v2-mono">LOADING…</div>
      ) : isError ? (
        <div className="v2-afm__seen-empty v2-mono">Could not load sightings.</div>
      ) : rows.length === 0 ? (
        <div className="v2-afm__seen-empty v2-mono">No tails of this type seen yet.</div>
      ) : (
        <>
          <ul className="v2-afm__seen-list">
            {rows.map((r) => (
              <li key={r.icao_hex}>
                <button
                  type="button"
                  className="v2-afm__seen-row"
                  onClick={() => onSelect?.(r.icao_hex)}
                  title="Open aircraft detail"
                >
                  <span className="v2-afm__seen-reg v2-mono">{r.registration || r.icao_hex}</span>
                  {r.operator && <span className="v2-afm__seen-op">{r.operator}</span>}
                  <span className="v2-afm__seen-meta v2-mono">
                    {r.times_seen}×
                    {r.last_seen ? ` · ${new Date(r.last_seen).toLocaleDateString()}` : ''}
                  </span>
                  <Icon name="chevron-right" size={13} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
          {hasNextPage && (
            <button
              type="button"
              className="v2-afm__seen-more v2-mono"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'LOADING…' : 'LOAD MORE'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Full technical dossier for one airframe type: reference photograph, annotated
 * engineering blueprint, dual-unit spec sheet and reference notes.
 *
 * @param {object} props
 * @param {import('./airframesData').Airframe|null} props.frame
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {(hex: string) => void} [props.onSelectAircraft] - open a tail's detail page
 * @param {number|null} [props.seenHours] - recency window for the "seen here" list (null = all-time)
 * @param {boolean} [props.neverSeen] - this station has never tracked this type (all-time)
 */
export function AirframeModal({
  frame,
  open,
  onOpenChange,
  onSelectAircraft,
  seenHours = null,
  neverSeen = false,
}) {
  if (!frame) return null;
  const color = CATEGORY_COLOR[frame.category] || 'var(--accent2)';
  const ratio = (frame.span / frame.length).toFixed(2);

  const title = (
    <div className="v2-afm__title" style={{ '--af-accent': color }}>
      <span className="v2-afm__title-type v2-mono">{frame.id}</span>
      <span className="v2-afm__title-sep" />
      <span className="v2-afm__title-name">{frame.name}</span>
      <span className="v2-afm__title-cat">{CAT_LABEL[frame.category]}</span>
    </div>
  );

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} width="min(920px, 94vw)">
      <div className="v2-afm" style={{ '--af-accent': color }}>
        {/* ── top: photo + primary identity ─────────────────────────────── */}
        <div className="v2-afm__hero">
          <TypePhoto frame={frame} color={color} />
          <div className="v2-afm__ident">
            {neverSeen && (
              <div className="v2-afm__unseen v2-mono" title="Reference data only — no local sightings">
                <Icon name="eye-off" size={12} strokeWidth={1.9} />
                NEVER SEEN AT THIS STATION
              </div>
            )}
            <div className="v2-afm__maker">{frame.mfr}</div>
            <div className="v2-afm__role">
              <Icon name="target" size={13} strokeWidth={1.9} />
              {frame.role}
            </div>
            {frame.blurb && <p className="v2-afm__blurb">{frame.blurb}</p>}
            {frame.generated && (
              <p className="v2-afm__auto-note">
                <Icon name="cpu" size={12} strokeWidth={1.9} />
                Auto-generated from an AI summary
                {typeof frame.confidence === 'number'
                  ? ` (confidence ${Math.round(frame.confidence * 100)}%)`
                  : ''}
                . Figures are approximate — verify before operational use.
              </p>
            )}
            <dl className="v2-afm__tags">
              {frame.powerplant && (
                <div className="v2-afm__tag">
                  <dt>
                    <Icon name="zap" size={12} strokeWidth={1.9} /> Powerplant
                  </dt>
                  <dd>{frame.powerplant}</dd>
                </div>
              )}
              {frame.variants && (
                <div className="v2-afm__tag">
                  <dt>
                    <Icon name="layers" size={12} strokeWidth={1.9} /> Variants
                  </dt>
                  <dd>{frame.variants}</dd>
                </div>
              )}
              {frame.wtc && (
                <div className="v2-afm__tag">
                  <dt>
                    <Icon name="wave" size={12} strokeWidth={1.9} /> Wake cat.
                  </dt>
                  <dd>{frame.wtc}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* ── bottom: blueprint + spec sheet ────────────────────────────── */}
        <div className="v2-afm__tech">
          <div className="v2-afm__blueprint">
            <div className="v2-afm__bp-head v2-mono">
              <span>DRG · TOP PLAN — {frame.id}</span>
              <span className="v2-afm__bp-rev">REV — REF ONLY · NOT TO BUILD</span>
            </div>
            <Planform
              length={frame.length}
              span={frame.span}
              shape={frame.shape}
              color={color}
              w={440}
              h={360}
              detailed
              label={frame.id}
            />
          </div>

          <div className="v2-afm__sheet">
            <div className="v2-afm__sheet-head v2-mono">SPECIFICATIONS</div>
            <SpecRow
              k="Length"
              primary={`${r1(frame.length)} m`}
              secondary={`${r1(frame.length * M_TO_FT)} ft`}
            />
            <SpecRow
              k="Wingspan"
              primary={`${r1(frame.span)} m`}
              secondary={`${r1(frame.span * M_TO_FT)} ft`}
            />
            <SpecRow
              k="Height"
              primary={`${r1(frame.height)} m`}
              secondary={`${r1(frame.height * M_TO_FT)} ft`}
            />
            <SpecRow
              k="MTOW"
              primary={`${r0(frame.mtow)} kg`}
              secondary={`${r0(frame.mtow * KG_TO_LB)} lb`}
            />
            <SpecRow
              k="Cruise"
              primary={`${frame.cruise} kt`}
              secondary={`${r0(frame.cruise * KT_TO_KMH)} km/h`}
            />
            <SpecRow
              k="Range"
              primary={`${r0(frame.range)} nm`}
              secondary={`${r0(frame.range * NM_TO_KM)} km`}
            />
            <SpecRow
              k="Ceiling"
              primary={`${r0(frame.ceiling)} ft`}
              secondary={`${r0(frame.ceiling * FT_TO_M)} m`}
            />
            <SpecRow k="Span : length" primary={`${ratio} : 1`} />
            <SpecRow k="First flight" primary={`${frame.firstFlight}`} />
          </div>
        </div>

        {/* ── seen tails of this type (lazy-loaded) ─────────────────────── */}
        <SeenTails
          type={frame.id}
          open={open}
          hours={seenHours}
          onSelect={(hex) => {
            onSelectAircraft?.(hex);
            onOpenChange?.(false);
          }}
        />
      </div>
    </Modal>
  );
}
