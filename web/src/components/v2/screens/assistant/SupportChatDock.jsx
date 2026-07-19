import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../primitives';
import { useBreakpoint } from '../../../../hooks/useBreakpoint';
import { AssistantThread, NextPrompts } from './AssistantThread';
import { ChatSessionsSidebar } from './ChatSessionsSidebar';
import { useAssistantChat } from './useAssistantChat';
import { composePageContext, tabLabel, usePageContextStore } from './pageContext';
import { LockedFeature } from '../../../shared/LockedFeature';

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

// On the live radar the copilot can drive the map (radar_filter → live filter +
// fit-to-view), so lead with filter/zoom actions instead of the generic prompts.
const MAP_SUGGESTIONS = [
  'Show only military aircraft',
  'Filter the radar to law enforcement traffic',
  'Show helicopters below 3,000 ft',
  'Show all 737s within 50 nm',
  'Anything squawking an emergency?',
  'Zoom to general aviation traffic near me',
];

function suggestionsForTab(tab) {
  return tab === 'map' ? MAP_SUGGESTIONS : DOCK_SUGGESTIONS;
}

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const SIZE_KEY = 'skyspy.dock.size';
const POS_KEY = 'skyspy.dock.pos';
const MIN_W = 320;
const MIN_H = 360;

function loadJson(key, valid) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (valid(raw)) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

const loadSize = () => loadJson(SIZE_KEY, (r) => r && Number.isFinite(r.w) && Number.isFinite(r.h));
const loadPos = () => loadJson(POS_KEY, (r) => r && Number.isFinite(r.left) && Number.isFinite(r.top));

export function SupportChatDock({ onExpand, onRadarCommand, onRadarTracks }) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState('');
  const [size, setSize] = useState(loadSize);
  const [pos, setPos] = useState(loadPos);
  const inputRef = useRef(null);
  const dragRef = useRef(null);
  const panelRef = useRef(null);
  // On phones the dock is a fixed full-width bottom sheet (CSS) — ignore any
  // persisted floating position/size and disable drag/resize.
  const { isMobile } = useBreakpoint();

  const persist = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  };

  // Drag the top-left grip to resize, keeping the bottom-right corner fixed.
  const onResizeStart = useCallback((e) => {
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = rect.width;
    const startH = rect.height;
    const startLeft = rect.left;
    const startTop = rect.top;
    const maxW = window.innerWidth - 32;
    const maxH = window.innerHeight - 32;
    let latest = null;

    const onMove = (ev) => {
      const w = Math.max(MIN_W, Math.min(maxW, startW - (ev.clientX - startX)));
      const h = Math.max(MIN_H, Math.min(maxH, startH - (ev.clientY - startY)));
      setSize({ w, h });
      // When floating (explicit position), shift left/top so the bottom-right
      // corner stays anchored as the panel grows from the top-left grip.
      setPos((p) => {
        if (!p) return p;
        latest = { left: startLeft + (startW - w), top: startTop + (startH - h) };
        return latest;
      });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      setSize((s) => {
        if (s) persist(SIZE_KEY, s);
        return s;
      });
      if (latest) persist(POS_KEY, latest);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  // Drag the header to move the panel. Ignores clicks on the action buttons.
  const onMoveStart = useCallback((e) => {
    if (isMobile) return; // dock is a fixed bottom sheet on phones
    if (e.target.closest('button')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;
    let latest = null;

    const onMove = (ev) => {
      const left = Math.max(8, Math.min(maxLeft, startLeft + (ev.clientX - startX)));
      const top = Math.max(8, Math.min(maxTop, startTop + (ev.clientY - startY)));
      latest = { left, top };
      setPos(latest);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (latest) persist(POS_KEY, latest);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [isMobile]);

  const store = usePageContextStore();
  const getContext = useCallback(() => composePageContext(store), [store]);
  const { messages, busy, locked, sessionId, suggestions, send, newChat, loadSession } =
    useAssistantChat({
      getContext,
      onRadarCommand,
      onRadarTracks,
      surface: 'dock',
    });

  const tab = store?.read?.().base?.tab;
  const pageName = tabLabel(tab);
  const dockSuggestions = suggestionsForTab(tab);

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
        <section
          ref={panelRef}
          className={`v2-dock__panel ${pos && !isMobile ? 'is-floating' : ''}`}
          role="dialog"
          aria-label="Support chat"
          style={
            isMobile
              ? undefined
              : {
                  ...(size ? { width: `${size.w}px`, height: `${size.h}px` } : null),
                  ...(pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : null),
                }
          }
        >
          {!isMobile && (
            <div
              ref={dragRef}
              className="v2-dock__resize"
              onPointerDown={onResizeStart}
              role="separator"
              aria-label="Resize chat"
              title="Drag to resize"
            />
          )}
          <div className="v2-dock__scan" aria-hidden="true" />
          <header className="v2-dock__head" onPointerDown={onMoveStart}>
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
              <button
                type="button"
                className={`v2-dock__icon ${showHistory ? 'is-active' : ''}`}
                onClick={() => setShowHistory((h) => !h)}
                title="Chat history"
                aria-pressed={showHistory}
              >
                <Icon name="history" size={14} />
              </button>
              <button
                type="button"
                className="v2-dock__icon"
                onClick={() => {
                  newChat();
                  setShowHistory(false);
                }}
                title="New chat"
              >
                <Icon name="plus" size={14} />
              </button>
              {onExpand && (
                <button
                  type="button"
                  className="v2-dock__icon"
                  onClick={() => {
                    setOpen(false);
                    // Carry the current session so the full assistant reopens it.
                    onExpand(sessionId);
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
            {locked ? (
              <LockedFeature
                title="Sign in to unlock the copilot"
                subtitle="Ask the AI about any SkySpy page or the traffic it's tracking. Available to signed-in users."
                variant="card"
                className="lockfx--fill"
              />
            ) : showHistory ? (
              <ChatSessionsSidebar
                compact
                activeId={sessionId}
                onSelect={(id) => {
                  loadSession(id);
                  setShowHistory(false);
                }}
                onNewChat={() => {
                  newChat();
                  setShowHistory(false);
                }}
              />
            ) : (
              <AssistantThread
                messages={messages}
                suggestions={dockSuggestions}
                onPick={submit}
                emptyTitle={`Ask about the ${pageName} page — or anything SkySpy is tracking.`}
                emptyHint="This chat can see what's on your screen."
              />
            )}
          </div>

          {!locked && !showHistory && !busy && messages.length > 0 && (
            <NextPrompts suggestions={suggestions} onPick={submit} />
          )}

          {!locked && (
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
          )}
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
