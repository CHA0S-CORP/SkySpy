import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, X, Save, Trash2, Settings, Bell, BellOff, Send, CheckCircle,
  AlertCircle, Globe, Lock, ChevronDown, ExternalLink, RefreshCw
} from 'lucide-react';
import { useNotificationChannels } from '../../hooks/useNotificationChannels';

// Channel type icons and labels
const CHANNEL_TYPE_INFO = {
  discord: { label: 'Discord', icon: '💬', color: '#5865F2' },
  slack: { label: 'Slack', icon: '💼', color: '#4A154B' },
  telegram: { label: 'Telegram', icon: '✈️', color: '#0088cc' },
  pushover: { label: 'Pushover', icon: '📱', color: '#249DF1' },
  email: { label: 'Email', icon: '📧', color: '#EA4335' },
  webhook: { label: 'Webhook', icon: '🔗', color: '#6366f1' },
  ntfy: { label: 'ntfy', icon: '🔔', color: '#57A773' },
  gotify: { label: 'Gotify', icon: '📣', color: '#1e88e5' },
  home_assistant: { label: 'Home Assistant', icon: '🏠', color: '#41BDF5' },
  twilio: { label: 'Twilio SMS', icon: '📲', color: '#F22F46' },
  custom: { label: 'Custom', icon: '⚙️', color: '#6b7280' },
};

// Channel Form Modal
function ChannelFormModal({ channel, channelTypes, onClose, onSave }) {
  const [name, setName] = useState(channel?.name || '');
  const [channelType, setChannelType] = useState(channel?.channel_type || 'webhook');
  const [appriseUrl, setAppriseUrl] = useState(channel?.apprise_url || '');
  const [description, setDescription] = useState(channel?.description || '');
  const [supportsRich, setSupportsRich] = useState(channel?.supports_rich || false);
  const [isGlobal, setIsGlobal] = useState(channel?.is_global || false);
  const [enabled, setEnabled] = useState(channel?.enabled !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const modalRef = useRef(null);
  const firstInputRef = useRef(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      await onSave({
        name,
        channel_type: channelType,
        apprise_url: appriseUrl,
        description,
        supports_rich: supportsRich,
        is_global: isGlobal,
        enabled,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedTypeInfo = CHANNEL_TYPE_INFO[channelType] || CHANNEL_TYPE_INFO.custom;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal channel-form-modal"
        ref={modalRef}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-form-title"
      >
        <div className="modal-header">
          <h3 id="channel-form-title">
            {channel ? 'Edit Notification Channel' : 'Add Notification Channel'}
          </h3>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="form-error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="channel-name">Name</label>
            <input
              id="channel-name"
              ref={firstInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Discord Channel"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="channel-type">Channel Type</label>
            <div className="channel-type-select">
              <select
                id="channel-type"
                value={channelType}
                onChange={(e) => setChannelType(e.target.value)}
              >
                {Object.entries(CHANNEL_TYPE_INFO).map(([value, info]) => (
                  <option key={value} value={value}>
                    {info.icon} {info.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="select-arrow" />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="apprise-url">
              Apprise URL
              <a
                href="https://github.com/caronc/apprise/wiki"
                target="_blank"
                rel="noopener noreferrer"
                className="help-link"
              >
                <ExternalLink size={12} /> Help
              </a>
            </label>
            <input
              id="apprise-url"
              type="text"
              value={appriseUrl}
              onChange={(e) => setAppriseUrl(e.target.value)}
              placeholder={getUrlPlaceholder(channelType)}
              required
            />
            <span className="form-hint">
              {getUrlHint(channelType)}
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="channel-description">Description (optional)</label>
            <input
              id="channel-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div className="form-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={supportsRich}
                onChange={(e) => setSupportsRich(e.target.checked)}
              />
              <span>Supports rich formatting (embeds)</span>
            </label>
          </div>

          <div className="form-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isGlobal}
                onChange={(e) => setIsGlobal(e.target.checked)}
              />
              <span>Global channel (available to all users)</span>
            </label>
          </div>

          <div className="form-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Helper functions for URL placeholders
function getUrlPlaceholder(type) {
  const placeholders = {
    discord: 'discord://webhook_id/webhook_token',
    slack: 'slack://token_a/token_b/token_c',
    telegram: 'tgram://bot_token/chat_id',
    pushover: 'pover://user_key@app_token',
    email: 'mailto://user:password@gmail.com',
    webhook: 'json://example.com/webhook',
    ntfy: 'ntfy://topic',
    gotify: 'gotify://hostname/token',
    home_assistant: 'hassio://hostname/access_token',
    twilio: 'twilio://account_sid:auth_token@from_phone/to_phone',
    custom: 'apprise://...',
  };
  return placeholders[type] || 'Enter Apprise URL';
}

function getUrlHint(type) {
  const hints = {
    discord: 'Use your Discord webhook URL',
    slack: 'Use incoming webhook from Slack app',
    telegram: 'Bot token and chat ID from @BotFather',
    pushover: 'User key and application token',
    email: 'SMTP server credentials',
    webhook: 'HTTP endpoint that accepts POST requests',
    ntfy: 'Your ntfy.sh topic name',
    gotify: 'Gotify server URL and app token',
    home_assistant: 'Home Assistant webhook or API',
    twilio: 'Twilio account credentials',
    custom: 'Any Apprise-compatible URL',
  };
  return hints[type] || '';
}

// Main Component
export function NotificationChannelsManager({ apiBase }) {
  const {
    channels,
    channelTypes,
    loading,
    error,
    refetch,
    createChannel,
    updateChannel,
    deleteChannel,
    testChannel,
    toggleChannel,
  } = useNotificationChannels(apiBase);

  const [showForm, setShowForm] = useState(false);
  const [editChannel, setEditChannel] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const handleSave = async (data) => {
    if (editChannel) {
      await updateChannel(editChannel.id, data);
    } else {
      await createChannel(data);
    }
  };

  const handleDelete = async (channel) => {
    if (!confirm(`Delete channel "${channel.name}"? This cannot be undone.`)) return;
    await deleteChannel(channel.id);
  };

  const handleTest = async (channel) => {
    setTestingId(channel.id);
    setTestResult(null);
    try {
      const result = await testChannel(channel.id);
      setTestResult({ id: channel.id, success: true, message: result.message || 'Test sent!' });
    } catch (err) {
      setTestResult({ id: channel.id, success: false, message: err.message });
    } finally {
      setTestingId(null);
    }
  };

  if (loading && channels.length === 0) {
    return (
      <div className="channels-loading">
        <RefreshCw size={24} className="spin" />
        <span>Loading channels...</span>
      </div>
    );
  }

  return (
    <div className="notification-channels-manager">
      <div className="channels-header">
        <h4>Notification Channels</h4>
        <p className="channels-description">
          Configure where alerts are sent. Channels can be assigned to individual rules.
        </p>
        <button
          className="btn-primary"
          onClick={() => { setEditChannel(null); setShowForm(true); }}
        >
          <Plus size={16} /> Add Channel
        </button>
      </div>

      {error && (
        <div className="channels-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={refetch} className="btn-secondary btn-sm">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      <div className="channels-list" role="list">
        {channels.length === 0 ? (
          <div className="channels-empty">
            <Bell size={32} />
            <p>No notification channels configured</p>
            <button
              className="btn-primary"
              onClick={() => { setEditChannel(null); setShowForm(true); }}
            >
              <Plus size={16} /> Add Your First Channel
            </button>
          </div>
        ) : (
          channels.map(channel => {
            const typeInfo = CHANNEL_TYPE_INFO[channel.channel_type] || CHANNEL_TYPE_INFO.custom;
            const isBeingTested = testingId === channel.id;
            const result = testResult?.id === channel.id ? testResult : null;

            return (
              <div
                key={channel.id}
                className={`channel-card ${channel.enabled ? '' : 'disabled'}`}
                role="listitem"
              >
                <div className="channel-card-header">
                  <div
                    className="channel-type-badge"
                    style={{ backgroundColor: typeInfo.color }}
                  >
                    <span className="channel-type-icon">{typeInfo.icon}</span>
                    <span>{typeInfo.label}</span>
                  </div>

                  <div className="channel-status-badges">
                    {channel.is_global && (
                      <span className="badge badge-global" title="Global channel">
                        <Globe size={12} /> Global
                      </span>
                    )}
                    {!channel.is_global && (
                      <span className="badge badge-private" title="Private channel">
                        <Lock size={12} /> Private
                      </span>
                    )}
                    {channel.verified && (
                      <span className="badge badge-verified" title="Verified">
                        <CheckCircle size={12} /> Verified
                      </span>
                    )}
                  </div>

                  <button
                    className={`toggle-btn ${channel.enabled ? 'enabled' : ''}`}
                    onClick={() => toggleChannel(channel)}
                    title={channel.enabled ? 'Disable' : 'Enable'}
                    aria-pressed={channel.enabled}
                  >
                    <div className="toggle-track">
                      <div className="toggle-thumb"></div>
                    </div>
                  </button>
                </div>

                <div className="channel-card-body">
                  <h5 className="channel-name">{channel.name}</h5>
                  {channel.description && (
                    <p className="channel-description">{channel.description}</p>
                  )}
                  {channel.alert_rule_count > 0 && (
                    <span className="channel-rule-count">
                      Used by {channel.alert_rule_count} rule{channel.alert_rule_count !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {result && (
                  <div className={`channel-test-result ${result.success ? 'success' : 'error'}`}>
                    {result.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                    <span>{result.message}</span>
                  </div>
                )}

                <div className="channel-card-actions">
                  <button
                    className="action-btn test"
                    onClick={() => handleTest(channel)}
                    disabled={isBeingTested || !channel.enabled}
                    title="Send test notification"
                  >
                    {isBeingTested ? (
                      <RefreshCw size={14} className="spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    <span>{isBeingTested ? 'Testing...' : 'Test'}</span>
                  </button>
                  <button
                    className="action-btn edit"
                    onClick={() => { setEditChannel(channel); setShowForm(true); }}
                    title="Edit channel"
                  >
                    <Settings size={14} />
                    <span>Edit</span>
                  </button>
                  <button
                    className="action-btn delete"
                    onClick={() => handleDelete(channel)}
                    title="Delete channel"
                  >
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showForm && (
        <ChannelFormModal
          channel={editChannel}
          channelTypes={channelTypes}
          onClose={() => { setShowForm(false); setEditChannel(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

export default NotificationChannelsManager;
