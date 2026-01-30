import React from 'react';
import { Bell, Check } from 'lucide-react';
import { CHANNEL_TYPE_INFO } from './RuleFormConstants';

/**
 * ChannelButton component - renders a single channel selection button
 */
function ChannelButton({ channel, isSelected, onToggle }) {
  const typeInfo = CHANNEL_TYPE_INFO[channel.channel_type] || CHANNEL_TYPE_INFO.custom;

  return (
    <button
      type="button"
      className={`channel-select-btn ${isSelected ? 'selected' : ''}`}
      onClick={() => onToggle(channel.id)}
      aria-pressed={isSelected}
      style={{ '--channel-color': typeInfo.color }}
    >
      <span className="channel-icon">{typeInfo.icon}</span>
      <span className="channel-name">{channel.name}</span>
      {isSelected && <Check size={14} className="check-icon" />}
    </button>
  );
}

/**
 * NotificationChannelSelector component - allows selecting notification channels for a rule
 */
export function NotificationChannelSelector({
  channels = [],
  channelsLoading = false,
  selectedChannelIds = [],
  useGlobalNotifications = true,
  onToggleChannel,
  onToggleGlobal,
}) {
  // Filter to only enabled channels
  const enabledChannels = channels.filter(c => c.enabled);

  return (
    <fieldset className="form-group notification-channels-fieldset">
      <legend>
        <Bell size={16} aria-hidden="true" />
        Notification Channels
      </legend>

      <div className="form-row">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={useGlobalNotifications}
            onChange={(e) => onToggleGlobal(e.target.checked)}
          />
          <span>Use global notifications (from server config)</span>
        </label>
      </div>

      {enabledChannels.length > 0 ? (
        <div
          className="notification-channels-list"
          role="group"
          aria-label="Select notification channels"
        >
          {enabledChannels.map(channel => (
            <ChannelButton
              key={channel.id}
              channel={channel}
              isSelected={selectedChannelIds.includes(channel.id)}
              onToggle={onToggleChannel}
            />
          ))}
        </div>
      ) : (
        <p className="no-channels-hint">
          {channelsLoading
            ? 'Loading channels...'
            : 'No notification channels configured. Add channels in the Notifications tab.'}
        </p>
      )}

      {selectedChannelIds.length > 0 && (
        <span className="channels-selected-count">
          {selectedChannelIds.length} channel{selectedChannelIds.length !== 1 ? 's' : ''} selected
        </span>
      )}
    </fieldset>
  );
}

export default NotificationChannelSelector;
