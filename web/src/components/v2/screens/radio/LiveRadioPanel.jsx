import React, { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'skyspy-live-radios-v1';

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
        volume: Number.isFinite(feed.volume) ? Math.max(0, Math.min(1, feed.volume)) : 0.7,
      }));
  } catch {
    return [];
  }
}

function LiveRadioPlayer({ feed, onVolume, onRemove }) {
  const audioRef = useRef(null);
  const attemptRef = useRef(0);
  const [status, setStatus] = useState('Stopped');
  const active = status === 'Connecting' || status === 'Playing';

  useEffect(() => {
    audioRef.current.volume = feed.volume;
  }, [feed.volume]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      attemptRef.current += 1;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, []);

  const stop = () => {
    attemptRef.current += 1;
    const audio = audioRef.current;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    setStatus('Stopped');
  };

  const play = async () => {
    const attempt = ++attemptRef.current;
    const audio = audioRef.current;
    audio.src = feed.url;
    setStatus('Connecting');
    try {
      await audio.play();
    } catch {
      if (attempt === attemptRef.current)
        setStatus('Unable to play. Check the stream URL and try again.');
    }
  };

  return (
    <div className="v2-radio-live__feed" role="group" aria-label={feed.label}>
      {/* Live audio has no caption track supplied by the provider. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => setStatus('Playing')}
        onWaiting={() => {
          if (audioRef.current?.getAttribute('src')) setStatus('Connecting');
        }}
        onError={() => {
          if (audioRef.current?.getAttribute('src'))
            setStatus('Unable to play. Check the stream URL and try again.');
        }}
        onEnded={() => setStatus('Stream ended. Press Play to reconnect.')}
      />
      <div className="v2-radio-live__identity">
        <strong>{feed.label}</strong>
        <small>{feed.url}</small>
        <span role="status">{status}</span>
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
          onChange={(e) => onVolume(Number(e.target.value) / 100)}
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
      { url: normalized, label: label.trim() || new URL(normalized).hostname, volume: 0.7 },
    ]);
    setUrl('');
    setLabel('');
    setError('');
  };

  return (
    <section className="v2-radio-live" aria-label="Live radio">
      <h2>Live radio</h2>
      <p>
        Listen to multiple audio streams together. Feeds and volumes are saved in this browser.
        Playback continues while you switch views or close these controls.
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
          onVolume={(volume) =>
            setFeeds((prev) =>
              prev.map((item) => (item.url === feed.url ? { ...item, volume } : item))
            )
          }
          onRemove={() => setFeeds((prev) => prev.filter((item) => item.url !== feed.url))}
        />
      ))}
    </section>
  );
}
