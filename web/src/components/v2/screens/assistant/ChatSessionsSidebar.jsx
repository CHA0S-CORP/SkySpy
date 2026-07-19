import React from 'react';
import { Icon } from '../../primitives';
import {
  useChatSessions,
  useDeleteChatSession,
} from '../../../../hooks/queries/useChatSessionQueries';

/**
 * Saved chat sessions list — shared by the full AssistantScreen (column) and the
 * SupportChatDock (compact drawer). Lists past conversations newest-first, marks
 * the active one, lets you start a New chat, and deletes sessions.
 *
 * @param {object} props
 * @param {number|null} props.activeId - currently open session id
 * @param {(id:number)=>void} props.onSelect - open a session
 * @param {()=>void} props.onNewChat - start a fresh conversation
 * @param {boolean} [props.compact] - denser styling for the dock
 */
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ChatSessionsSidebar({ activeId, onSelect, onNewChat, compact = false }) {
  const { data: sessions = [], isLoading } = useChatSessions();
  const del = useDeleteChatSession();

  const handleDelete = (e, id) => {
    e.stopPropagation();
    del.mutate(id, {
      onSuccess: () => {
        // If we deleted the open session, drop back to a fresh chat.
        if (id === activeId) onNewChat();
      },
    });
  };

  return (
    <aside className={`v2-asst-sessions ${compact ? 'is-compact' : ''}`} aria-label="Chat history">
      <button type="button" className="v2-asst-sessions__new" onClick={onNewChat}>
        <Icon name="plus" size={14} />
        New chat
      </button>

      <div className="v2-asst-sessions__list">
        {isLoading && <div className="v2-asst-sessions__empty">Loading…</div>}
        {!isLoading && sessions.length === 0 && (
          <div className="v2-asst-sessions__empty">No saved chats yet.</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`v2-asst-sessions__item ${s.id === activeId ? 'is-active' : ''}`}
            onClick={() => onSelect(s.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(s.id);
              }
            }}
          >
            <Icon name="message" size={13} className="v2-asst-sessions__item-icon" />
            <span className="v2-asst-sessions__item-body">
              <span className="v2-asst-sessions__item-title">{s.title || 'Untitled chat'}</span>
              <span className="v2-asst-sessions__item-time">{relativeTime(s.updated_at)}</span>
            </span>
            <button
              type="button"
              className="v2-asst-sessions__del"
              onClick={(e) => handleDelete(e, s.id)}
              title="Delete chat"
              aria-label="Delete chat"
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

export default ChatSessionsSidebar;
