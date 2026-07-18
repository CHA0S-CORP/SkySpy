import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../../primitives';
import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantMap } from './AssistantMap';

/**
 * Presentational chat thread shared by the full-page assistant and the
 * app-wide support dock. Renders the message list (markdown / charts / maps /
 * auto-links via AssistantMarkdown) plus an empty state with suggestion chips.
 */

export function ToolTrace({ steps, sources }) {
  const [open, setOpen] = useState(false);
  if (!steps?.length && !sources?.length) return null;
  return (
    <div className="v2-asst__trace">
      <button type="button" className="v2-asst__trace-toggle" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        {steps.length} tool{steps.length === 1 ? '' : 's'} used
        {sources?.length ? ` · ${sources.length} source${sources.length === 1 ? '' : 's'}` : ''}
      </button>
      {open && (
        <div className="v2-asst__trace-body">
          {steps.map((s, i) => (
            <div key={i} className="v2-asst__trace-step">
              <code>{s.tool}</code>
              {s.args ? (
                <span className="v2-asst__trace-args"> {JSON.stringify(s.args)}</span>
              ) : null}
            </div>
          ))}
          {sources?.length ? (
            <div className="v2-asst__trace-sources">
              {sources.map((src, i) => (
                <a
                  key={i}
                  href={
                    src.icao_hex
                      ? `#airframe?icao=${src.icao_hex}`
                      : `#airframe?tail=${src.registration || ''}`
                  }
                  className="v2-asst__src"
                >
                  {src.registration || src.icao_hex}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`v2-asst__msg v2-asst__msg--${isUser ? 'user' : 'assistant'}`}>
      {!isUser && <Icon name="message" size={15} className="v2-asst__avatar" />}
      <div className="v2-asst__bubble">
        {msg.error ? (
          <span className="v2-asst__err">Assistant unavailable: {msg.error}</span>
        ) : isUser ? (
          <span className="v2-asst__text">{msg.text}</span>
        ) : msg.text ? (
          <AssistantMarkdown text={msg.text} />
        ) : (
          <span className="v2-asst__text v2-asst__typing">
            <i />
            <i />
            <i />
          </span>
        )}
        {!isUser && msg.photos?.length ? (
          <div className="v2-asst__photos">
            {msg.photos.map((p, i) => (
              <figure key={i} className="v2-asst-photo">
                <img
                  className="v2-asst-md__img"
                  src={p.src}
                  alt={p.alt || 'aircraft photo'}
                  loading="lazy"
                />
                {p.photographer || p.source ? (
                  <figcaption className="v2-asst-photo__credit">
                    {p.photographer ? `© ${p.photographer}` : ''}
                    {p.photographer && p.source ? ' · ' : ''}
                    {p.source || ''}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ) : null}
        {!isUser && msg.maps?.length
          ? msg.maps.map((m, i) => <AssistantMap key={i} spec={m} />)
          : null}
        {!isUser && <ToolTrace steps={msg.steps || []} sources={msg.sources || []} />}
      </div>
    </div>
  );
}

export function AssistantThread({ messages, suggestions = [], onPick, emptyTitle, emptyHint }) {
  const endRef = useRef(null);

  // Keep the newest message in view as tokens stream in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  if (!messages.length) {
    return (
      <div className="v2-asst__empty">
        <p className="v2-asst__empty-title">
          {emptyTitle || 'Ask a question about what SkySpy is tracking.'}
        </p>
        {emptyHint ? <p className="v2-asst__empty-hint">{emptyHint}</p> : null}
        {suggestions.length ? (
          <div className="v2-asst__suggest">
            {suggestions.map((s) => (
              <button key={s} type="button" className="v2-asst__chip" onClick={() => onPick?.(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {messages.map((msg, i) => (
        <Message key={i} msg={msg} />
      ))}
      <div ref={endRef} />
    </>
  );
}

export default AssistantThread;
