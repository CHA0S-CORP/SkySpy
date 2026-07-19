import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../primitives';
import { api } from '../../../../lib/api';
import { AirframeCard, GenerateTile } from './AirframeCard';
import { AirframeModal } from './AirframeModal';
import { useHashParamState } from '../../../../hooks/useHashParamState';
import { useAuth } from '../../../../contexts/AuthContext';
import { navigate } from '../../../../lib/hashRoute';
import { AIRFRAMES, CATEGORIES } from './airframesData';

const TYPE_CODE_RE = /^[A-Za-z0-9]{2,4}$/;

// "Seen" recency windows. `hours: null` = all time (no cutoff sent to the API).
const SEEN_WINDOWS = [
  { id: '1h', label: '1h', hours: 1 },
  { id: '12h', label: '12h', hours: 12 },
  { id: '24h', label: '24h', hours: 24 },
  { id: '7d', label: '7d', hours: 168 },
  { id: 'all', label: 'All', hours: null },
];

/**
 * v2 Airframes screen — a reference library of common airframe types rendered
 * as to-scale technical-blueprint cards. Static/offline data; searchable by
 * type designator / name / manufacturer and filterable by category.
 *
 * @param {object} props
 * @param {(hex: string) => void} [props.onSelectAircraft] - open an aircraft's detail page
 */
export function AirframesScreen({ onSelectAircraft }) {
  // Deep-linked view state (#airframes?q=&cat=&seen=&sel=). The open card is
  // keyed by its type id in the URL and resolved back to the object below.
  const [query, setQuery] = useHashParamState('q', '');
  const [cat, setCat] = useHashParamState('cat', 'all');
  // Active "seen" recency window (a SEEN_WINDOWS id) or null when the filter is off.
  const [seenWindow, setSeenWindow] = useHashParamState('seen', null);
  const [selId, setSelId] = useHashParamState('sel', null, { replace: false });

  const activeWindow = SEEN_WINDOWS.find((w) => w.id === seenWindow) || null;
  const seenHours = activeWindow ? activeWindow.hours : null;

  // On-demand card generation hits an LLM endpoint gated by CanUseLLM — an
  // authenticated user with `assistant.view`, even in public mode (relaxed in
  // dev). Mirror that so anonymous visitors get a "sign in to generate" CTA
  // instead of a generate button that would 403.
  const { config, hasPermission } = useAuth();
  const genLocked = !config.devMode && !hasPermission('assistant.view');

  const queryClient = useQueryClient();
  // Type codes whose on-demand generation is in flight (drives the tile spinner
  // and turns on polling until the finished card shows up in genData).
  const [pending, setPending] = useState(() => new Set());
  const [genErrors, setGenErrors] = useState(() => new Set());

  // Auto-generated cards for types seen here but missing from the static library.
  // Merged behind the curated set (a static entry always wins on a type collision)
  // so the render path stays identical — generated cards just carry `generated`.
  const { data: genData } = useQuery({
    queryKey: ['v2-generated-airframe-cards'],
    queryFn: () => api.getGeneratedAirframeCards(),
    staleTime: 5 * 60 * 1000,
    // While a generation is queued, poll so the fresh card appears on its own.
    refetchInterval: pending.size ? 4000 : false,
  });

  // Clear pending entries once their card lands in the fetched set.
  useEffect(() => {
    if (!pending.size) return;
    const have = new Set((genData?.cards || []).map((c) => (c.id || '').toUpperCase()));
    const still = [...pending].filter((t) => !have.has(t));
    if (still.length !== pending.size) setPending(new Set(still));
  }, [genData]);

  const generate = useMutation({
    mutationFn: (type) => api.generateAirframeCard(type),
    onMutate: (type) => {
      setGenErrors((s) => {
        const n = new Set(s);
        n.delete(type);
        return n;
      });
    },
    onSuccess: (_res, type) => {
      setPending((p) => new Set(p).add(type));
      // Safety valve: stop polling for this type after ~90s even if it never lands.
      setTimeout(
        () =>
          setPending((p) => {
            const n = new Set(p);
            n.delete(type);
            return n;
          }),
        90000
      );
    },
    onError: (_err, type) => setGenErrors((s) => new Set(s).add(type)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['v2-generated-airframe-cards'] }),
  });
  const tileState = (type) =>
    pending.has(type) ? 'pending' : genErrors.has(type) ? 'error' : 'idle';
  const catalog = useMemo(() => {
    const staticIds = new Set(AIRFRAMES.map((a) => a.id.toUpperCase()));
    const extra = (genData?.cards || []).filter((c) => !staticIds.has((c.id || '').toUpperCase()));
    return extra.length ? [...AIRFRAMES, ...extra] : AIRFRAMES;
  }, [genData]);

  // Resolve the URL's `sel` type id back to a catalog card (the modal subject).
  const selected = useMemo(
    () => (selId ? catalog.find((f) => f.id.toUpperCase() === selId.toUpperCase()) || null : null),
    [selId, catalog]
  );
  const setSelected = (frame) => setSelId(frame?.id || null);

  // Distinct-tail counts per type tracked here within the active window — drives
  // both the type filter and category-chip counts. Keyed by upper-cased ICAO
  // designator. Only fetched while a window is selected.
  const { data: seenData } = useQuery({
    queryKey: ['v2-seen-airframe-types', seenWindow],
    enabled: seenWindow != null,
    queryFn: () =>
      api.getSeenAirframeTypes(activeWindow?.hours ? { hours: activeWindow.hours } : {}),
    staleTime: 60 * 1000,
  });
  const seenCounts = seenData?.types || {};

  // All-time set of types ever tracked here — always fetched so cards/dossiers
  // can flag types this station has NEVER seen (independent of the window filter).
  const { data: everSeenData } = useQuery({
    queryKey: ['v2-ever-seen-airframe-types'],
    queryFn: () => api.getSeenAirframeTypes({}),
    staleTime: 60 * 1000,
  });
  const everSeen = useMemo(
    () => new Set(Object.keys(everSeenData?.types || {}).map((t) => t.toUpperCase())),
    [everSeenData]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((a) => {
      if (cat !== 'all' && a.category !== cat) return false;
      if (seenWindow && !(seenCounts[a.id.toUpperCase()] > 0)) return false;
      if (!q) return true;
      return (
        a.id.toLowerCase().includes(q) ||
        (a.name || '').toLowerCase().includes(q) ||
        (a.mfr || '').toLowerCase().includes(q) ||
        (a.role || '').toLowerCase().includes(q)
      );
    });
  }, [query, cat, seenWindow, seenCounts, catalog]);

  // Category-chip counts follow the seen filter: full catalog when off, else the
  // subset of types seen within the active window.
  const counts = useMemo(() => {
    const pool = seenWindow ? catalog.filter((a) => seenCounts[a.id.toUpperCase()] > 0) : catalog;
    const m = { all: pool.length };
    for (const c of CATEGORIES) m[c.id] = pool.filter((a) => a.category === c.id).length;
    return m;
  }, [seenWindow, seenCounts, catalog]);

  const catalogIds = useMemo(() => new Set(catalog.map((a) => a.id.toUpperCase())), [catalog]);

  // Types this station has tracked but has no reference card for — rendered as
  // "generate" tiles. Category is unknown for these, so only shown under "All".
  // Uses the active window's seen counts, else the all-time set.
  const missingTiles = useMemo(() => {
    if (cat !== 'all') return [];
    const q = query.trim().toLowerCase();
    const src = seenWindow ? seenCounts : everSeenData?.types || {};
    return Object.entries(src)
      .map(([t, n]) => [t.toUpperCase(), n])
      .filter(([t, n]) => n > 0 && !catalogIds.has(t) && (!q || t.toLowerCase().includes(q)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60)
      .map(([type, seen]) => ({ type, seen }));
  }, [cat, query, seenWindow, seenCounts, everSeenData, catalogIds]);

  // A searched, uncarded type designator (e.g. "SU95") the user can generate even
  // if this station has never tracked it — surfaced in the empty state.
  const searchedType = query.trim().toUpperCase();
  const canGenerateSearched =
    TYPE_CODE_RE.test(searchedType) &&
    !catalogIds.has(searchedType) &&
    !missingTiles.some((m) => m.type === searchedType);

  return (
    <div className="v2-af" data-testid="v2-airframes-screen">
      <header className="v2-af__masthead">
        <div className="v2-af__masthead-l">
          <div className="v2-af__eyebrow">
            <Icon name="layers" size={13} strokeWidth={1.9} />
            REFERENCE LIBRARY
          </div>
          <h1 className="v2-af__h1">Airframe Types</h1>
          <p className="v2-af__lede">
            To-scale top-view blueprints synthesised from published dimensions.{' '}
            <span className="v2-mono">{catalog.length}</span> types indexed by ICAO designator.
          </p>
        </div>
        <label className="v2-af__search">
          <Icon name="search" size={15} strokeWidth={1.8} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search type, model, maker…"
            aria-label="Search airframes"
          />
        </label>
      </header>

      <div className="v2-af__filters" role="tablist" aria-label="Category">
        <button
          type="button"
          role="tab"
          aria-selected={cat === 'all'}
          className={`v2-af__chip ${cat === 'all' ? 'v2-af__chip--on' : ''}`}
          onClick={() => setCat('all')}
        >
          All
          <span className="v2-af__chip-n v2-mono">{counts.all}</span>
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={cat === c.id}
            className={`v2-af__chip ${cat === c.id ? 'v2-af__chip--on' : ''}`}
            style={{ '--af-accent': c.color }}
            onClick={() => setCat(c.id)}
          >
            <span className="v2-af__chip-dot" />
            {c.label}
            <span className="v2-af__chip-n v2-mono">{counts[c.id]}</span>
          </button>
        ))}
        <div className="v2-af__seenwin" role="group" aria-label="Seen recency window">
          <span className="v2-af__seenwin-lbl v2-mono">
            <Icon name="eye" size={13} strokeWidth={1.9} />
            SEEN
          </span>
          {SEEN_WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              aria-pressed={seenWindow === w.id}
              className={`v2-af__win ${seenWindow === w.id ? 'v2-af__win--on' : ''}`}
              onClick={() => setSeenWindow((cur) => (cur === w.id ? null : w.id))}
              title={
                w.hours ? `Types seen in the last ${w.label}` : 'Types seen at any time (all-time)'
              }
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && missingTiles.length === 0 ? (
        <div className="v2-af__empty">
          <Icon name={seenWindow ? 'eye' : 'search'} size={22} strokeWidth={1.6} />
          <p>
            {query
              ? `No airframe matches “${query}”.`
              : seenWindow
                ? `No types seen ${activeWindow?.hours ? `in the last ${activeWindow.label}` : 'yet'}.`
                : 'No airframes.'}
          </p>
          {canGenerateSearched &&
            (genLocked ? (
              <button
                type="button"
                className="v2-af__gen-btn v2-mono"
                onClick={() => navigate('login')}
              >
                <Icon name="log-in" size={12} strokeWidth={2} />
                SIGN IN TO GENERATE
              </button>
            ) : (
              <button
                type="button"
                className="v2-af__gen-btn v2-mono"
                onClick={() => generate.mutate(searchedType)}
                disabled={pending.has(searchedType)}
              >
                <Icon name="cpu" size={12} strokeWidth={2} />
                {pending.has(searchedType) ? 'GENERATING…' : `GENERATE CARD FOR ${searchedType}`}
              </button>
            ))}
        </div>
      ) : (
        <div className="v2-af__grid">
          {filtered.map((frame) => (
            <AirframeCard
              key={frame.id}
              frame={frame}
              seenCount={seenCounts[frame.id.toUpperCase()] || 0}
              neverSeen={!everSeen.has(frame.id.toUpperCase())}
              onOpen={setSelected}
            />
          ))}
          {missingTiles.map((m) => (
            <GenerateTile
              key={`gen-${m.type}`}
              type={m.type}
              seenCount={m.seen}
              state={tileState(m.type)}
              locked={genLocked}
              onGenerate={generate.mutate}
            />
          ))}
        </div>
      )}

      <AirframeModal
        frame={selected}
        open={selected != null}
        onOpenChange={(o) => !o && setSelected(null)}
        onSelectAircraft={onSelectAircraft}
        seenHours={seenHours}
        neverSeen={selected ? !everSeen.has(selected.id.toUpperCase()) : false}
      />
    </div>
  );
}
