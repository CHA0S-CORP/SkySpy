import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, X, Trash2, Radio, Clock, List } from 'lucide-react';
import { getGlobalAudioState, subscribeToAudioStateChanges, removeFromQueue, clearQueue, reorderQueue } from '../views/AudioView';

export function AudioQueue({ isExpanded, onToggleExpanded }) {
  const [queue, setQueue] = useState([]);

  // Subscribe to global audio state changes
  useEffect(() => {
    const unsubscribe = subscribeToAudioStateChanges((updates) => {
      if ('autoplayQueue' in updates) {
        setQueue([...updates.autoplayQueue]);
      }
    });

    // Initialize with current queue
    const audioState = getGlobalAudioState();
    setQueue([...audioState.autoplayQueue]);

    return unsubscribe;
  }, []);

  const handleRemove = (index) => {
    removeFromQueue(index);
  };

  const handleClearAll = () => {
    clearQueue();
  };

  const handleMoveUp = (index) => {
    if (index > 0) {
      reorderQueue(index, index - 1);
    }
  };

  const handleMoveDown = (index) => {
    if (index < queue.length - 1) {
      reorderQueue(index, index + 1);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds || !isFinite(seconds) || seconds < 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (dateString) => {
    if (!dateString) return '--:--';
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Get callsigns from transmission
  const getCallsigns = (transmission) => {
    if (!transmission.identified_airframes || transmission.identified_airframes.length === 0) {
      return null;
    }
    return transmission.identified_airframes.map(af => af.callsign).join(', ');
  };

  return (
    <div className={`audio-queue-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="audio-queue-header"
        onClick={onToggleExpanded}
        aria-expanded={isExpanded}
        aria-controls="audio-queue-content"
      >
        <div className="queue-header-left">
          <List size={14} />
          <span className="queue-title">Queue</span>
          {queue.length > 0 && (
            <span className="queue-count">{queue.length}</span>
          )}
        </div>
        <div className="queue-header-right">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
      </button>

      {isExpanded && (
        <div id="audio-queue-content" className="audio-queue-content">
          {queue.length === 0 ? (
            <div className="queue-empty">
              <Radio size={20} />
              <span>Queue is empty</span>
              <span className="queue-empty-hint">New transmissions will appear here when autoplay is enabled</span>
            </div>
          ) : (
            <>
              <div className="queue-actions">
                <button
                  className="queue-clear-btn"
                  onClick={handleClearAll}
                  title="Clear all items from queue"
                >
                  <Trash2 size={12} />
                  <span>Clear All</span>
                </button>
              </div>
              <div className="queue-list">
                {queue.map((transmission, index) => {
                  const callsigns = getCallsigns(transmission);
                  return (
                    <div key={transmission.id} className="queue-item">
                      <div className="queue-item-order">
                        <div className="queue-reorder-btns">
                          <button
                            className="queue-reorder-btn"
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                            title="Move up"
                            aria-label="Move up in queue"
                          >
                            <ChevronUp size={12} />
                          </button>
                          <button
                            className="queue-reorder-btn"
                            onClick={() => handleMoveDown(index)}
                            disabled={index === queue.length - 1}
                            title="Move down"
                            aria-label="Move down in queue"
                          >
                            <ChevronDown size={12} />
                          </button>
                        </div>
                        <span className="queue-item-number">{index + 1}</span>
                      </div>
                      <div className="queue-item-info">
                        <div className="queue-item-main">
                          {callsigns ? (
                            <span className="queue-item-callsign">{callsigns}</span>
                          ) : (
                            <span className="queue-item-channel">{transmission.channel_name || 'Unknown'}</span>
                          )}
                          {callsigns && (
                            <span className="queue-item-channel-small">{transmission.channel_name}</span>
                          )}
                        </div>
                        <div className="queue-item-meta">
                          <span className="queue-item-duration">
                            <Clock size={10} />
                            {formatDuration(transmission.duration_seconds)}
                          </span>
                          <span className="queue-item-time">{formatTime(transmission.created_at)}</span>
                        </div>
                      </div>
                      <button
                        className="queue-item-remove"
                        onClick={() => handleRemove(index)}
                        title="Remove from queue"
                        aria-label={`Remove ${callsigns || transmission.channel_name || 'item'} from queue`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default AudioQueue;
