import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../../primitives';
import { AssistantThread, NextPrompts } from './AssistantThread';
import { ChatSessionsSidebar } from './ChatSessionsSidebar';
import { useAssistantChat } from './useAssistantChat';
import { LockedFeature } from '../../../shared/LockedFeature';

/**
 * SkySpy Assistant — full-page chat over the LangChain tool-calling agent.
 * Streams the answer token-by-token, renders markdown / charts / maps / photos,
 * and auto-links aviation entities. Chat engine + thread are shared with the
 * app-wide SupportChatDock (see useAssistantChat / AssistantThread).
 */

const SUGGESTIONS = [
  // Traffic & analytics
  'How many military aircraft in the last 24h?',
  'Busiest hours and top operators this week',
  'Chart ACARS message volume per hour for the last 12 hours',
  'Show me a breakdown of aircraft by type as a chart',
  'Top 10 operators this week as a bar chart',
  // Maps
  'Show the military aircraft being tracked on a map',
  // Safety
  'Any safety events today?',
  'Plot safety events by severity',
  // Airframes
  'Which tracked airframes are registered to a trust?',
  'Show me a photo of the closest aircraft',
  // Insight & correlation
  "What's statistically unusual about tonight's traffic?",
  'Is signal strength correlated with distance?',
  'Which telemetry fields are most strongly correlated?',
  // Behavior & surveillance
  'Is anything orbiting or loitering right now?',
  'Trace the flight path of the closest aircraft',
  'Are there any police or surveillance aircraft nearby?',
  'Is anything watching the receiver?',
  // Semantic history search
  'Have we seen a close-proximity conflict like this before?',
  'Find ACARS messages about a diversion or engine fault',
  // Weather / reference
  'Current weather (METAR) at KSEA',
  'Any recent PIREPs with turbulence?',
  'Are there active NOTAMs at KLAX?',
];

export function AssistantScreen({ hashParams } = {}) {
  const [input, setInput] = useState('');
  const { messages, busy, locked, sessionId, suggestions, send, newChat, loadSession } =
    useAssistantChat({
      surface: 'screen',
    });

  // Deep-link to a saved session (e.g. the dock's "open full assistant" button
  // passes #assistant?session=<id>). Load it once per distinct id.
  const loadedSessionRef = useRef(null);
  useEffect(() => {
    const id = hashParams?.session;
    if (id && String(id) !== String(loadedSessionRef.current)) {
      loadedSessionRef.current = id;
      loadSession(id);
    }
  }, [hashParams?.session, loadSession]);

  const submit = (text) => {
    setInput('');
    send(text ?? input);
  };

  return (
    <div
      className={`v2-asst ${locked ? '' : 'v2-asst--with-sidebar'}`}
      data-testid="assistant-screen"
    >
      {/* Anonymous users get the sign-in gate over the whole screen — the chat
          sessions / new-chat sidebar is hidden since there's nothing to browse. */}
      {!locked && (
        <ChatSessionsSidebar activeId={sessionId} onSelect={loadSession} onNewChat={newChat} />
      )}

      <div className="v2-asst__main">
        <div className="v2-asst__header">
          <Icon name="message" size={17} style={{ color: 'var(--accent)' }} />
          <span>Assistant</span>
          <span className="v2-asst__sub">Ask about traffic, safety, airframes & analytics</span>
          {!locked && messages.length > 0 && (
            <button type="button" className="v2-asst__clear" onClick={newChat} title="New chat">
              <Icon name="plus" size={13} />
              New chat
            </button>
          )}
        </div>

        {locked ? (
          <div className="v2-asst__thread">
            <LockedFeature
              title="Sign in to unlock the assistant"
              subtitle="Ask the AI about live traffic, safety, airframes & analytics — grounded in what this station is tracking. Available to signed-in users."
              variant="card"
              className="lockfx--fill"
            />
          </div>
        ) : (
          <>
            <div className="v2-asst__thread">
              <AssistantThread messages={messages} suggestions={SUGGESTIONS} onPick={submit} />
            </div>

            {!busy && messages.length > 0 && (
              <NextPrompts suggestions={suggestions} onPick={submit} />
            )}

            <form
              className="v2-asst__composer"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                className="v2-asst__input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the assistant…"
                disabled={busy}
                aria-label="Assistant query"
              />
              <button type="submit" className="v2-asst__send" disabled={busy || !input.trim()}>
                <Icon name={busy ? 'refresh' : 'send'} size={16} />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default AssistantScreen;
