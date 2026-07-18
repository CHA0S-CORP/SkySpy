import React, { useMemo, useState } from 'react';
import { Icon } from '../../primitives';
import { AirframeCard } from './AirframeCard';
import { AirframeModal } from './AirframeModal';
import { AIRFRAMES, CATEGORIES } from './airframesData';

/**
 * v2 Airframes screen — a reference library of common airframe types rendered
 * as to-scale technical-blueprint cards. Static/offline data; searchable by
 * type designator / name / manufacturer and filterable by category.
 */
export function AirframesScreen() {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return AIRFRAMES.filter((a) => {
      if (cat !== 'all' && a.category !== cat) return false;
      if (!q) return true;
      return (
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.mfr.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q)
      );
    });
  }, [query, cat]);

  const counts = useMemo(() => {
    const m = { all: AIRFRAMES.length };
    for (const c of CATEGORIES) m[c.id] = AIRFRAMES.filter((a) => a.category === c.id).length;
    return m;
  }, []);

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
            <span className="v2-mono">{AIRFRAMES.length}</span> common types indexed by ICAO
            designator.
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
      </div>

      {filtered.length === 0 ? (
        <div className="v2-af__empty">
          <Icon name="search" size={22} strokeWidth={1.6} />
          <p>No airframe matches “{query}”.</p>
        </div>
      ) : (
        <div className="v2-af__grid">
          {filtered.map((frame) => (
            <AirframeCard key={frame.id} frame={frame} onOpen={setSelected} />
          ))}
        </div>
      )}

      <AirframeModal
        frame={selected}
        open={selected != null}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}
