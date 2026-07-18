import React, { useMemo, useRef, useState } from 'react';
import { Icon } from '../../primitives';
import { AcarsAiAnalysis } from '../../../shared/AcarsAiAnalysis';

// ---------------------------------------------------------------------------
// Shared sort machinery
// ---------------------------------------------------------------------------

/** Read a (possibly nested) numeric/string sort value off a record. */
function sortValue(rec, key) {
  switch (key) {
    case 'time':
      return new Date(rec.__when || 0).getTime();
    case 'freq':
      return typeof rec.__freq === 'number' ? rec.__freq : -Infinity;
    case 'signal':
      return typeof rec.signal_level === 'number' ? rec.signal_level : -Infinity;
    case 'label':
      return (rec.label || '').toString();
    case 'confidence':
      return typeof rec.confidence === 'number' ? rec.confidence : -Infinity;
    case 'duration':
      return typeof rec.duration_seconds === 'number' ? rec.duration_seconds : -Infinity;
    default:
      return 0;
  }
}

/** Sort a normalized record list by key+dir without mutating the source. */
function sortRecords(list, key, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  return list.slice().sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv)) * mul;
    }
    return (av - bv) * mul;
  });
}

/** A row of sort chips; clicking the active key flips direction. */
function SortBar({ options, sortKey, sortDir, onSort }) {
  return (
    <div className="v2-det__sortbar">
      <span className="v2-det__sortbar-label">SORT</span>
      {options.map((o) => {
        const active = o.key === sortKey;
        return (
          <button
            key={o.key}
            type="button"
            className={`v2-det__sort-btn ${active ? 'is-active' : ''}`}
            onClick={() => onSort(o.key)}
          >
            {o.label}
            {active && (
              <Icon
                name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'}
                size={11}
                strokeWidth={2.2}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function useSort(defaultKey) {
  const [sortKey, setKey] = useState(defaultKey);
  const [sortDir, setDir] = useState('desc');
  const onSort = (key) => {
    if (key === sortKey) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setKey(key);
      // Times/numbers read best newest/largest first; labels A→Z.
      setDir(key === 'label' ? 'asc' : 'desc');
    }
  };
  return { sortKey, sortDir, onSort };
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', { hour12: false });
  const today = new Date().toDateString() === d.toDateString();
  if (today) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

// ---------------------------------------------------------------------------
// ACARS messages
// ---------------------------------------------------------------------------

const ACARS_SORTS = [
  { key: 'time', label: 'Time' },
  { key: 'label', label: 'Label' },
  { key: 'freq', label: 'Freq' },
  { key: 'signal', label: 'Signal' },
];

// Datalink labels worth colouring — OOOI/movement (green), weather (blue),
// clearance/ops (amber). Everything else stays neutral.
function acarsAccent(label) {
  const l = (label || '').toUpperCase();
  if (['H1', 'CA', 'C1', 'B9', 'B6'].includes(l)) return 'var(--warn)';
  if (['5U', '5Z', '80', '81', '82', '83'].includes(l)) return 'var(--accent2)';
  if (['10', '11', '12', '13', '14', '15', '16', '17'].includes(l)) return 'var(--accent)';
  return 'var(--dim)';
}

export function AcarsActivityCard({ messages, apiBase }) {
  const { sortKey, sortDir, onSort } = useSort('time');

  const rows = useMemo(() => {
    const norm = (messages || []).map((m) => ({
      ...m,
      __when: m.timestamp || m.created_at,
      __freq: typeof m.frequency === 'number' ? m.frequency : null,
    }));
    return sortRecords(norm, sortKey, sortDir);
  }, [messages, sortKey, sortDir]);

  return (
    <div className="v2-det__card">
      <div className="v2-det__card-head">
        <Icon name="radio" size={15} strokeWidth={1.7} style={{ color: 'var(--accent2)' }} />
        <span>ACARS Messages</span>
        <span className="v2-det__card-aside">{rows.length} in 24h</span>
      </div>
      <div className="v2-det__card-body">
        {rows.length === 0 ? (
          <div className="v2-det__activity-empty">
            <Icon name="inbox" size={16} strokeWidth={1.7} style={{ color: 'var(--dim)' }} />
            <span>No ACARS/VDL2 messages decoded for this airframe</span>
          </div>
        ) : (
          <>
            <SortBar options={ACARS_SORTS} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <div className="v2-det__acars-list">
              {rows.map((m, i) => (
                <AcarsRow key={m.id ?? i} m={m} apiBase={apiBase} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AcarsRow({ m, apiBase }) {
  const [open, setOpen] = useState(false);
  const body = m.formatted_text || m.text || '';
  const long = body.length > 220;
  const shown = open || !long ? body : `${body.slice(0, 220)}…`;
  const airports = m.decoded_text?.airports_mentioned || [];
  const levels = m.decoded_text?.flight_levels || [];
  const accent = acarsAccent(m.label);

  return (
    <div className="v2-det__acars-row" style={{ '--row-accent': accent }}>
      <div className="v2-det__acars-head">
        {m.label && (
          <span className="v2-det__acars-label" style={{ color: accent, borderColor: accent }}>
            {m.label}
          </span>
        )}
        <span className="v2-det__acars-ident">
          {m.callsign || m.registration || m.icao_hex || '—'}
        </span>
        {m.airline?.name && <span className="v2-det__acars-airline">{m.airline.name}</span>}
        <span className="v2-det__acars-src">{m.source || 'ACARS'}</span>
        <span className="v2-det__acars-when">{fmtWhen(m.timestamp || m.created_at)}</span>
      </div>

      {m.label_info?.name && <div className="v2-det__acars-labelname">{m.label_info.name}</div>}

      {body ? (
        <pre className="v2-det__acars-text">{shown}</pre>
      ) : (
        <div className="v2-det__acars-nobody">— no message body —</div>
      )}
      {long && (
        <button type="button" className="v2-det__acars-more" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show full message'}
        </button>
      )}

      <div className="v2-det__acars-meta">
        {typeof m.frequency === 'number' && (
          <span className="v2-det__tag">
            <Icon name="radio" size={10} strokeWidth={2} />
            {m.frequency.toFixed(3)} MHz
          </span>
        )}
        {typeof m.signal_level === 'number' && (
          <span className="v2-det__tag">
            <Icon name="bar-chart-2" size={10} strokeWidth={2} />
            {m.signal_level.toFixed(1)} dBm
          </span>
        )}
        {m.channel && <span className="v2-det__tag">ch {m.channel}</span>}
        {airports.slice(0, 6).map((a) => (
          <span key={a} className="v2-det__tag v2-det__tag--apt">
            <Icon name="map-pin" size={10} strokeWidth={2} />
            {a}
          </span>
        ))}
        {levels.slice(0, 4).map((fl) => (
          <span key={String(fl)} className="v2-det__tag v2-det__tag--fl">
            FL{fl}
          </span>
        ))}
        {typeof m.error_count === 'number' && m.error_count > 0 && (
          <span className="v2-det__tag v2-det__tag--err">{m.error_count} err</span>
        )}
      </div>

      {/* apiBase is intentionally '' (same-origin/relative), so gate on the id
          alone — AcarsAiAnalysis builds a relative /api/v1 URL when apiBase is
          empty. Gating on apiBase hid the analysis on the airframe page. */}
      {m.id != null && <AcarsAiAnalysis apiBase={apiBase} id={m.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radio calls (transcribed audio matched to this airframe)
// ---------------------------------------------------------------------------

const RADIO_SORTS = [
  { key: 'time', label: 'Time' },
  { key: 'freq', label: 'Freq' },
  { key: 'confidence', label: 'Match' },
  { key: 'duration', label: 'Length' },
];

export function RadioActivityCard({ calls }) {
  const { sortKey, sortDir, onSort } = useSort('time');
  const audioRef = useRef(null);
  const [playingId, setPlayingId] = useState(null);

  const rows = useMemo(() => {
    const norm = (calls || []).map((c) => ({
      ...c,
      __when: c.created_at || c.timestamp,
      __freq: typeof c.frequency_mhz === 'number' ? c.frequency_mhz : null,
    }));
    return sortRecords(norm, sortKey, sortDir);
  }, [calls, sortKey, sortDir]);

  const togglePlay = (call) => {
    const el = audioRef.current;
    if (!el || !call.audio_url) return;
    if (playingId === call.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = call.audio_url;
    el.play().then(
      () => setPlayingId(call.id),
      () => setPlayingId(null) // autoplay/network refusal — fail quietly
    );
  };

  return (
    <div className="v2-det__card">
      <div className="v2-det__card-head">
        <Icon name="mic" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>Radio Calls</span>
        <span className="v2-det__card-aside">{rows.length} matched</span>
      </div>
      <div className="v2-det__card-body">
        {rows.length === 0 ? (
          <div className="v2-det__activity-empty">
            <Icon name="mic-off" size={16} strokeWidth={1.7} style={{ color: 'var(--dim)' }} />
            <span>No radio calls matched to this airframe</span>
          </div>
        ) : (
          <>
            <SortBar options={RADIO_SORTS} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            {/* Playback-only element for matched ATC audio; no captions exist
                for scanner recordings. */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio ref={audioRef} onEnded={() => setPlayingId(null)} style={{ display: 'none' }} />
            <div className="v2-det__acars-list">
              {rows.map((c, i) => (
                <RadioRow
                  key={c.id ?? i}
                  c={c}
                  playing={playingId === c.id}
                  onPlay={() => togglePlay(c)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function confColor(conf) {
  if (typeof conf !== 'number') return 'var(--dim)';
  if (conf >= 0.75) return 'var(--accent)';
  if (conf >= 0.45) return 'var(--warn)';
  return 'var(--danger)';
}

function RadioRow({ c, playing, onPlay }) {
  const conf = c.confidence;
  const cColor = confColor(conf);
  return (
    <div className="v2-det__acars-row" style={{ '--row-accent': cColor }}>
      <div className="v2-det__acars-head">
        {c.audio_url && (
          <button
            type="button"
            className={`v2-det__radio-play ${playing ? 'is-playing' : ''}`}
            onClick={onPlay}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            <Icon name={playing ? 'pause' : 'play'} size={12} strokeWidth={2.2} />
          </button>
        )}
        <span className="v2-det__radio-freq">
          {typeof c.frequency_mhz === 'number'
            ? `${c.frequency_mhz.toFixed(3)} MHz`
            : c.channel_name || 'radio'}
        </span>
        {typeof conf === 'number' && (
          <span className="v2-det__radio-conf" style={{ color: cColor, borderColor: cColor }}>
            {Math.round(conf * 100)}% match
          </span>
        )}
        <span className="v2-det__acars-when">{fmtWhen(c.created_at || c.timestamp)}</span>
      </div>

      {c.transcript ? (
        <div className="v2-det__radio-text">“{c.transcript}”</div>
      ) : (
        <div className="v2-det__acars-nobody">— transcription pending —</div>
      )}

      <div className="v2-det__acars-meta">
        {typeof c.duration_seconds === 'number' && (
          <span className="v2-det__tag">
            <Icon name="clock" size={10} strokeWidth={2} />
            {c.duration_seconds.toFixed(1)}s
          </span>
        )}
        {c.channel_name && (
          <span className="v2-det__tag">
            <Icon name="hash" size={10} strokeWidth={2} />
            {c.channel_name}
          </span>
        )}
        {c.raw_text && c.raw_text !== c.transcript && (
          <span className="v2-det__tag v2-det__tag--raw" title={c.raw_text}>
            heard “{c.raw_text.length > 28 ? `${c.raw_text.slice(0, 28)}…` : c.raw_text}”
          </span>
        )}
      </div>
    </div>
  );
}
