import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../primitives';
import { AssistantThread } from './AssistantThread';
import { useAssistantChat } from './useAssistantChat';
import { composePageContext, tabLabel, usePageContextStore } from './pageContext';

/**
 * App-wide support chat — a docked "copilot" reachable from any page. On send it
 * attaches a snapshot of what the user is currently looking at (composePageContext)
 * so they can ask about the page without restating it. Toggle with the corner
 * beacon or the `?` shortcut.
 */

const DOCK_SUGGESTIONS = [
  'Explain what I’m looking at on this page',
  'Summarize the key numbers here',
  'Anything unusual I should notice?',
  'Is anything orbiting or loitering right now?',
  'Any surveillance aircraft nearby?',
];

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function SupportChatDock({ onExpand }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  const store = usePageContextStore();
  const getContext = useCallback(() => composePageContext(store), [store]);
  const { messages, busy, send, clear } = useAssistantChat({ getContext });

  const pageName = tabLabel(store?.read?.().base?.tab);

  // `?` toggles the dock anywhere (except while typing); Escape closes it.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '?' && !isEditableTarget(e.target)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const submit = (text) => {
    setInput('');
    send(text ?? input);
  };

  return (
    <div className={`v2-dock ${open ? 'is-open' : ''}`} data-testid="support-dock">
      {open && (
        <section className="v2-dock__panel" role="dialog" aria-label="Support chat">
          <div className="v2-dock__scan" aria-hidden="true" />
          <header className="v2-dock__head">
            <span className="v2-dock__brand">
              <Icon name="radar" size={16} className="v2-dock__brand-icon" />
              Copilot
            </span>
            <span
              className="v2-dock__ctx"
              title={`This chat can see the ${pageName} page you have open`}
            >
              <span className="v2-dock__ctx-dot" />
              viewing&nbsp;·&nbsp;<b>{pageName}</b>
            </span>
            <span className="v2-dock__actions">
              {messages.length > 0 && (
                <button type="button" className="v2-dock__icon" onClick={clear} title="Clear chat">
                  <Icon name="x" size={14} />
                </button>
              )}
              {onExpand && (
                <button
                  type="button"
                  className="v2-dock__icon"
                  onClick={() => {
                    setOpen(false);
                    onExpand();
                  }}
                  title="Open full assistant"
                >
                  <Icon name="maximize" size={14} />
                </button>
              )}
              <button
                type="button"
                className="v2-dock__icon"
                onClick={() => setOpen(false)}
                title="Close (Esc)"
              >
                <Icon name="chevron-down" size={16} />
              </button>
            </span>
          </header>

          <div className="v2-dock__thread">
            <AssistantThread
              messages={messages}
              suggestions={DOCK_SUGGESTIONS}
              onPick={submit}
              emptyTitle={`Ask about the ${pageName} page — or anything SkySpy is tracking.`}
              emptyHint="This chat can see what's on your screen."
            />
          </div>

          <form
            className="v2-dock__composer"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              ref={inputRef}
              className="v2-dock__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask about ${pageName}…`}
              disabled={busy}
              aria-label="Support chat query"
            />
            <button type="submit" className="v2-dock__send" disabled={busy || !input.trim()}>
              <Icon name={busy ? 'refresh' : 'send'} size={15} />
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className="v2-dock__beacon"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Collapse support chat' : 'Open support chat'}
        title="Support chat (press ?)"
      >
        <span className="v2-dock__beacon-ring" aria-hidden="true" />
        <Icon name={open ? 'chevron-down' : 'message'} size={20} />
      </button>
    </div>
  );
}

export default SupportChatDock;
