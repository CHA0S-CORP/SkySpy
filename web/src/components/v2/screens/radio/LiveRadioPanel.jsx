import React, { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'skyspy-live-radios-v1';

function resetAudio(audio) {
  if (!audio?.hasAttribute('src')) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

function streamUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function loadFeeds() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved)) return [];
    const seen = new Set();
    return saved
      .filter((feed) => {
        if (!feed || !streamUrl(feed.url) || seen.has(streamUrl(feed.url))) return false;
        seen.add(streamUrl(feed.url));
        return true;
      })
      .map((feed) => ({
        url: streamUrl(feed.url),
        label: typeof feed.label === 'string' ? feed.label.slice(0, 100) : feed.url,
        pan: Number.isFinite(feed.pan) ? Math.max(-1, Math.min(1, feed.pan)) : 0,
        volume: Number.isFinite(feed.volume) ? Math.max(0, Math.min(1, feed.volume)) : 0.7,
      }));
  } catch {
    return [];
  }
}

function LiveRadioPlayer({ feed, onSettings, onRemove }) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const canPan = Boolean(AudioContext?.prototype.createStereoPanner);
  const audioRef = useRef(null);
  const stereoAudioRef = useRef(null);
  const graphRef = useRef(null);
  const attemptRef = useRef(0);
  const [status, setStatus] = useState('Stopped');
  const [directPlayback, setDirectPlayback] = useState(false);
  const active = status === 'Connecting' || status === 'Playing';

  useEffect(() => {
    audioRef.current.volume = feed.volume;
    if (stereoAudioRef.current) stereoAudioRef.current.volume = feed.volume;
  }, [feed.volume]);

  useEffect(() => {
    if (graphRef.current) graphRef.current.panner.pan.value = feed.pan;
  }, [feed.pan]);

  useEffect(() => {
    const audio = audioRef.current;
    const stereoAudio = stereoAudioRef.current;
    return () => {
      attemptRef.current += 1;
      resetAudio(audio);
      resetAudio(stereoAudio);
      graphRef.current?.context.close().catch(() => {});
      graphRef.current = null;
    };
  }, []);

  const stop = () => {
    attemptRef.current += 1;
    resetAudio(audioRef.current);
    resetAudio(stereoAudioRef.current);
    setStatus('Stopped');
    setDirectPlayback(false);
  };

  const play = async () => {
    const attempt = ++attemptRef.current;
    const audio = audioRef.current;
    const stereoAudio = stereoAudioRef.current;
    resetAudio(audio);
    resetAudio(stereoAudio);
    setStatus('Connecting');
    setDirectPlayback(false);

    if (stereoAudio) {
      try {
        if (!graphRef.current) {
          const context = new AudioContext();
          try {
            const panner = context.createStereoPanner();
            panner.connect(context.destination);
            context.createMediaElementSource(stereoAudio).connect(panner);
            graphRef.current = { context, panner };
          } catch (error) {
            context.close().catch(() => {});
            throw error;
          }
        }
        const { context, panner } = graphRef.current;
        panner.pan.value = feed.pan;
        stereoAudio.src = feed.url;
        await Promise.all([context.resume(), stereoAudio.play()]);
        return;
      } catch {
        if (attempt !== attemptRef.current) return;
        // Some providers allow direct playback but do not allow Web Audio access.
        resetAudio(stereoAudio);
        setDirectPlayback(true);
        setStatus('Connecting');
      }
    }

    audio.src = feed.url;
    try {
      await audio.play();
    } catch {
      if (attempt === attemptRef.current)
        setStatus('Unable to play. Check the stream URL and try again.');
    }
  };

  const audioEvents = {
    onPlaying: (e) => {
      if (e.currentTarget.hasAttribute('src')) setStatus('Playing');
    },
    onWaiting: (e) => {
      if (e.currentTarget.hasAttribute('src')) setStatus('Connecting');
    },
    onError: (e) => {
      if (e.currentTarget.hasAttribute('src'))
        setStatus('Unable to play. Check the stream URL and try again.');
    },
    onEnded: (e) => {
      if (e.currentTarget.hasAttribute('src')) setStatus('Stream ended. Press Play to reconnect.');
    },
  };
  const panPercent = Math.round(feed.pan * 100);
  const panText =
    panPercent === 0 ? 'Center' : `${Math.abs(panPercent)}% ${panPercent < 0 ? 'left' : 'right'}`;

  return (
    <div className="v2-radio-live__feed" role="group" aria-label={feed.label}>
      {/* Live audio has no caption track supplied by the provider. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="none" {...audioEvents} />
      {canPan && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio ref={stereoAudioRef} crossOrigin="anonymous" preload="none" {...audioEvents} />
      )}
      <div className="v2-radio-live__identity">
        <strong>{feed.label}</strong>
        <small>{feed.url}</small>
        <span role="status">{status}</span>
        {directPlayback && <small>Stereo pan unavailable for this playback.</small>}
        {!canPan && <small>Stereo pan unavailable in this browser.</small>}
      </div>
      <button
        type="button"
        onClick={active ? stop : play}
        aria-label={`${active ? 'Stop' : 'Play'} ${feed.label}`}
      >
        {active ? 'Stop' : 'Play'}
      </button>
      <label className="v2-radio-live__volume">
        Volume {Math.round(feed.volume * 100)}%
        <input
          aria-label={`${feed.label} volume`}
          type="range"
          min="0"
          max="100"
          value={Math.round(feed.volume * 100)}
          onChange={(e) => onSettings({ volume: Number(e.target.value) / 100 })}
        />
      </label>
      <label className="v2-radio-live__pan">
        Pan {panText}
        <input
          aria-label={`${feed.label} left/right pan`}
          aria-valuetext={panText}
          type="range"
          min="-100"
          max="100"
          value={panPercent}
          disabled={!canPan || directPlayback}
          onChange={(e) => onSettings({ pan: Number(e.target.value) / 100 })}
        />
      </label>
      <button type="button" onClick={onRemove} aria-label={`Remove ${feed.label}`}>
        Remove
      </button>
    </div>
  );
}

export function LiveRadioPanel() {
  const [feeds, setFeeds] = useState(loadFeeds);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(feeds));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [feeds]);

  const addFeed = (event) => {
    event.preventDefault();
    const normalized = streamUrl(url.trim());
    if (!normalized) {
      setError('Enter a valid HTTP or HTTPS stream URL without embedded credentials.');
      return;
    }
    if (feeds.some((feed) => feed.url === normalized)) {
      setError('That feed is already in your list.');
      return;
    }
    setFeeds((prev) => [
      ...prev,
      { url: normalized, label: label.trim() || new URL(normalized).hostname, volume: 0.7, pan: 0 },
    ]);
    setUrl('');
    setLabel('');
    setError('');
  };

  return (
    <section className="v2-radio-live" aria-label="Live radio">
      <h2>Live radio</h2>
      <p>
        Listen to multiple audio streams together. Feeds and mixer settings are saved in this
        browser. Playback continues while you switch views or close these controls.
      </p>
      <form onSubmit={addFeed} className="v2-radio-live__form">
        <label>
          Stream URL
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://radio.example.org/stream"
            maxLength={4096}
            required
          />
        </label>
        <label>
          Label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My radio"
            maxLength={100}
          />
        </label>
        <button type="submit">Add radio</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {feeds.length === 0 && <p>No radios added. Add a streaming audio URL to start listening.</p>}
      {feeds.map((feed) => (
        <LiveRadioPlayer
          key={feed.url}
          feed={feed}
          onSettings={(settings) =>
            setFeeds((prev) =>
              prev.map((item) => (item.url === feed.url ? { ...item, ...settings } : item))
            )
          }
          onRemove={() => setFeeds((prev) => prev.filter((item) => item.url !== feed.url))}
        />
      ))}
    </section>
  );
}
