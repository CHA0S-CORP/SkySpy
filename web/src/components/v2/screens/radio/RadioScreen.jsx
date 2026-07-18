import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../primitives';
import { useRadioFeed } from './useRadioFeed';
import {
  audioUrlOf,
  callsignOf,
  fmtDur,
  fmtFreq,
  fmtSize,
  isEmergency,
  matchAircraft,
  radioStats,
  selectTransmissions,
  statusOf,
  waveHeights,
} from './radioModel';
import { CATEGORY_COLORS, categoryOf } from '../list/listModel';

const RANGES = ['1h', '6h', '24h', '48h', '7d'];

function Waveform({ seed, bars, progress = null, color, onSeek }) {
  const heights = useMemo(() => waveHeights(seed, bars), [seed, bars]);
  const seekProps = onSeek
    ? {
        role: 'slider',
        tabIndex: 0,
        'aria-label': 'Seek',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': Math.round(progress ?? 0),
        onClick: (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
        },
        onKeyDown: (e) => {
          if (e.key === 'ArrowRight') onSeek(Math.min(100, (progress ?? 0) + 5));
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, (progress ?? 0) - 5));
        },
      }
    : {};
  return (
    <div className={`v2-radio__wave ${onSeek ? 'v2-radio__wave--seek' : ''}`} {...seekProps}>
      {heights.map((h, i) => {
        const played = progress != null && (i / bars) * 100 <= progress;
        return (
          <span key={i} style={{ height: `${h}%`, background: played ? 'var(--accent)' : color }} />
        );
      })}
    </div>
  );
}

/**
 * v2 Radio screen (designs/Radio.dc.html): stat strip, filter row,
 * transmission log with waveforms, bottom now-playing bar with real audio.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {object[]} props.aircraft - live aircraft for flight-info badges
 * @param {(hex: string, callsign?: string) => void} props.onSelectAircraft
 */
export function RadioScreen({ apiBase, aircraft, onSelectAircraft }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All Status');
  const [channel, setChannel] = useState('All Channels');
  const [emergency, setEmergency] = useState(false);
  const [range, setRange] = useState('24h');
  const [autoPlay, setAutoPlay] = useState(false);
  const [nowId, setNowId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const audioRef = useRef(null);
  const { transmissions, socketConnected } = useRadioFeed(apiBase, range);

  const stats = useMemo(() => radioStats(transmissions), [transmissions]);
  const channels = useMemo(
    () => ['All Channels', ...new Set(transmissions.map((t) => t.channel_name).filter(Boolean))],
    [transmissions]
  );
  const rows = useMemo(
    () => selectTransmissions(transmissions, { query, status, channel, emergency }),
    [transmissions, query, status, channel, emergency]
  );

  const now = useMemo(
    () => transmissions.find((t) => t.id === nowId) || null,
    [transmissions, nowId]
  );

  // Auto-play newest transmission when Auto is on
  const newestId = transmissions[0]?.id;
  useEffect(() => {
    if (autoPlay && newestId != null && socketConnected) {
      setNowId((prev) => (prev === newestId ? prev : newestId));
      setPlaying(true);
    }
    // intentionally only reacting to a *new* newest transmission
  }, [autoPlay, newestId, socketConnected]);

  // Drive the <audio> element
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const url = now && audioUrlOf(now);
    if (!url) {
      // the playing clip dropped out of the window/filter — stop, don't strand playback
      el.pause();
      return;
    }
    // el.src reads back absolutized, so compare resolved URLs - a raw
    // comparison against a relative url is always true and reset playback
    // to 0:00 on every pause toggle / refetch
    const resolved = new URL(url, window.location.href).href;
    if (el.src !== resolved) {
      el.src = resolved;
      setProgress(0);
    }
    if (playing) {
      el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }, [now, playing]);

  const onTimeUpdate = () => {
    const el = audioRef.current;
    if (el?.duration) setProgress((el.currentTime / el.duration) * 100);
  };
  const seekTo = (pct) => {
    const el = audioRef.current;
    if (el?.duration) {
      el.currentTime = (pct / 100) * el.duration;
      setProgress(pct);
    }
  };

  const playRow = (t) => {
    if (t.id === nowId) {
      setPlaying(!playing);
    } else {
      setNowId(t.id);
      setPlaying(true);
    }
  };

  const nowCs = now ? callsignOf(now) : null;
  const nowAc = now ? matchAircraft(nowCs, aircraft) : null;
  const nowColor = nowAc ? CATEGORY_COLORS[categoryOf(nowAc)] : 'var(--accent)';
  const nowDur = now?.duration_seconds || 0;
  const nowClock = `${fmtDur((progress / 100) * nowDur)} / ${fmtDur(nowDur)}`;

  return (
    <div className="v2-radio" data-testid="v2-radio">
      <div className="v2-radio__top">
        {/* stat strip */}
        <div className="v2-radio__stats">
          <div className="v2-radio__stat">
            <Icon name="rows" size={15} strokeWidth={1.7} style={{ color: 'var(--dim)' }} />
            <span className="v2-radio__stat-num">{stats.total}</span>
            <span className="v2-radio__stat-label">TOTAL</span>
          </div>
          <div className="v2-radio__stat">
            <Icon name="check" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
            <span className="v2-radio__stat-num" style={{ color: 'var(--accent)' }}>
              {stats.transcribed}
            </span>
            <span className="v2-radio__stat-label">TRANSCRIBED</span>
          </div>
          <div className="v2-radio__stat">
            <Icon name="clock" size={15} strokeWidth={1.7} style={{ color: 'var(--warn)' }} />
            <span className="v2-radio__stat-num" style={{ color: 'var(--warn)' }}>
              {stats.pending}
            </span>
            <span className="v2-radio__stat-label">PENDING</span>
          </div>
          <div className="v2-radio__stat">
            <Icon name="mic" size={15} strokeWidth={1.7} style={{ color: 'var(--accent2)' }} />
            <span className="v2-radio__stat-num">{stats.totalDur}</span>
            <span className="v2-radio__stat-label">DURATION</span>
          </div>
          <div className="v2-radio__spacer" />
          <div className="v2-radio__stat">
            <span
              className={`v2-radio__live-dot ${socketConnected ? '' : 'v2-radio__live-dot--off'}`}
            />
            <span
              className="v2-radio__live-label"
              style={{ color: socketConnected ? 'var(--accent)' : 'var(--danger)' }}
            >
              {socketConnected ? 'Live' : 'Offline'}
            </span>
            <span className="v2-radio__stat-label">RADIO</span>
          </div>
        </div>

        {/* filter row */}
        <div className="v2-radio__filters">
          <div className="v2-radio__search">
            <Icon name="search" size={15} strokeWidth={1.8} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transcripts, channels, frequency…"
              aria-label="Search transmissions"
            />
          </div>
          <select
            className="v2-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status filter"
          >
            {['All Status', 'Transcribed', 'Pending', 'Failed'].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <select
            className="v2-select"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            aria-label="Channel filter"
          >
            {channels.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <button
            type="button"
            className={`v2-radio__emerg ${emergency ? 'v2-radio__emerg--on' : ''}`}
            aria-pressed={emergency}
            onClick={() => setEmergency(!emergency)}
          >
            <Icon name="alert-triangle" size={14} strokeWidth={1.7} />
            Emergency
          </button>
          <div className="v2-radio__ranges">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={`v2-radio__range ${range === r ? 'v2-radio__range--on' : ''}`}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`v2-radio__auto ${autoPlay ? 'v2-radio__auto--on' : ''}`}
            aria-pressed={autoPlay}
            onClick={() => setAutoPlay(!autoPlay)}
          >
            <Icon name="play" size={13} />
            Auto
          </button>
        </div>
      </div>

      {/* transmission list */}
      <div className="v2-radio__list">
        {rows.length === 0 ? (
          <div className="v2-radio__empty">
            <Icon name="wave" size={36} strokeWidth={1.3} />
            <span>No transmissions match your filters</span>
          </div>
        ) : (
          rows.map((t, idx) => {
            const emerg = isEmergency(t);
            const isNow = t.id === nowId;
            const cs = callsignOf(t);
            const ac = matchAircraft(cs, aircraft);
            const acColor = ac ? CATEGORY_COLORS[categoryOf(ac)] : 'var(--accent)';
            const st = statusOf(t);
            const transcript = t.transcript || '';
            const rest =
              cs && transcript.toUpperCase().startsWith(cs)
                ? transcript.slice(cs.length)
                : transcript;
            return (
              <div
                key={t.id ?? idx}
                className={`v2-radio__row ${emerg ? 'v2-radio__row--emerg' : ''} ${isNow ? 'v2-radio__row--now' : ''}`}
                style={{ borderLeftColor: emerg ? 'var(--danger)' : acColor }}
                data-testid={`v2-radio-row-${t.id}`}
              >
                <button
                  type="button"
                  className={`v2-radio__play ${isNow ? 'v2-radio__play--now' : ''}`}
                  onClick={() => playRow(t)}
                  aria-label={isNow && playing ? 'Pause' : 'Play'}
                >
                  <Icon name={isNow && playing ? 'pause' : 'play'} size={15} />
                </button>
                <div className="v2-radio__row-body">
                  <div className="v2-radio__row-head">
                    <span
                      className="v2-radio__channel"
                      style={{ color: emerg ? 'var(--danger)' : 'var(--txt)' }}
                    >
                      {t.channel_name || 'Unknown Channel'}
                    </span>
                    <span className="v2-radio__freq">{fmtFreq(t.frequency_mhz)}</span>
                    {emerg && (
                      <span className="v2-radio__emerg-badge">
                        <Icon name="alert-circle" size={9} strokeWidth={2.4} />
                        EMERGENCY
                      </span>
                    )}
                    {ac && (
                      <button
                        type="button"
                        className="v2-radio__flight"
                        style={{
                          color: acColor,
                          borderColor: `color-mix(in srgb, ${acColor} 32%, transparent)`,
                        }}
                        onClick={() => onSelectAircraft(ac.hex, cs)}
                      >
                        <Icon name="send" size={10} />
                        {cs} · {ac.t || '—'}
                        <Icon name="chevron-right" size={9} strokeWidth={2} />
                      </button>
                    )}
                    <span className="v2-radio__spacer" />
                    <span className="v2-radio__time">
                      {t.created_at ? new Date(t.created_at).toLocaleTimeString() : '—'}
                    </span>
                  </div>
                  {transcript ? (
                    <div className="v2-radio__transcript">
                      {cs && <span style={{ color: emerg ? 'var(--danger)' : acColor }}>{cs}</span>}
                      <span className="v2-radio__transcript-rest">{rest}</span>
                    </div>
                  ) : (
                    <div className="v2-radio__transcript v2-radio__transcript--pending">
                      Awaiting transcription…
                    </div>
                  )}
                  <div className="v2-radio__row-foot">
                    <Waveform
                      seed={(typeof t.id === 'number' ? t.id : idx) + 1}
                      bars={56}
                      color={
                        emerg
                          ? 'color-mix(in srgb, var(--danger) 55%, transparent)'
                          : isNow
                            ? 'color-mix(in srgb, var(--accent) 60%, transparent)'
                            : 'var(--bord2)'
                      }
                    />
                    <span className="v2-radio__dur">{fmtDur(t.duration_seconds)}</span>
                    <span
                      className="v2-radio__status"
                      style={{
                        color:
                          st === 'Transcribed'
                            ? 'var(--accent)'
                            : st === 'Failed'
                              ? 'var(--danger)'
                              : 'var(--warn)',
                        background: `color-mix(in srgb, ${
                          st === 'Transcribed'
                            ? 'var(--accent)'
                            : st === 'Failed'
                              ? 'var(--danger)'
                              : 'var(--warn)'
                        } 14%, transparent)`,
                      }}
                    >
                      <Icon
                        name={st === 'Transcribed' ? 'check' : 'clock'}
                        size={10}
                        strokeWidth={2.2}
                      />
                      {st}
                    </span>
                    <span className="v2-radio__size">
                      {(t.format || 'mp3').toUpperCase()} · {fmtSize(t.file_size_bytes)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {rows.length > 0 && (
          <div className="v2-radio__count">
            Showing {rows.length} of {transmissions.length} transmissions
          </div>
        )}
      </div>

      {/* now playing bar */}
      {now && (
        <div className="v2-radio__nowbar" data-testid="v2-radio-nowbar">
          <button
            type="button"
            className="v2-radio__now-play"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            <Icon name={playing ? 'pause' : 'play'} size={18} />
          </button>
          <div className="v2-radio__now-meta">
            <div className="v2-radio__now-head">
              <span style={{ color: isEmergency(now) ? 'var(--danger)' : 'var(--txt)' }}>
                {now.channel_name || 'Unknown Channel'}
              </span>
              <span className="v2-radio__freq">{fmtFreq(now.frequency_mhz)}</span>
            </div>
            <div className="v2-radio__now-text">{now.transcript || 'Awaiting transcription…'}</div>
          </div>
          <Waveform
            seed={(typeof now.id === 'number' ? now.id : 0) + 99}
            bars={90}
            progress={progress}
            color="var(--bord2)"
            onSeek={seekTo}
          />
          <span className="v2-radio__now-clock">{nowClock}</span>
          {nowAc && (
            <button
              type="button"
              className="v2-radio__flight v2-radio__flight--now"
              style={{
                color: nowColor,
                borderColor: `color-mix(in srgb, ${nowColor} 34%, transparent)`,
              }}
              onClick={() => onSelectAircraft(nowAc.hex, nowCs)}
            >
              <Icon name="send" size={11} />
              {nowCs}
              <Icon name="chevron-right" size={10} strokeWidth={2} />
            </button>
          )}
        </div>
      )}

      {/* real playback element */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- ATC radio clips have no caption tracks; transcripts render inline */}
      <audio ref={audioRef} onTimeUpdate={onTimeUpdate} onEnded={() => setPlaying(false)} />
    </div>
  );
}
