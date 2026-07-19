import React, { useState } from 'react';
import { Icon, Switch, Select, toast } from '../../primitives';
import {
  useNotificationChannels,
  useNotificationChannelTypes,
  useCreateNotificationChannel,
  useUpdateNotificationChannel,
  useDeleteNotificationChannel,
  useTestNotificationChannel,
} from '../../../../hooks/queries/useNotificationChannels';

const FALLBACK_TYPES = [
  { value: 'webhook', label: 'Generic Webhook' },
  { value: 'discord', label: 'Discord' },
  { value: 'slack', label: 'Slack' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'ntfy', label: 'ntfy' },
  { value: 'gotify', label: 'Gotify' },
  { value: 'email', label: 'Email' },
  { value: 'pushover', label: 'Pushover' },
  { value: 'home_assistant', label: 'Home Assistant' },
  { value: 'twilio', label: 'Twilio SMS' },
  { value: 'custom', label: 'Custom Apprise URL' },
];

const URL_HINTS = {
  webhook: 'json://user:pass@host/path',
  discord: 'discord://webhook_id/webhook_token',
  slack: 'slack://tokenA/tokenB/tokenC',
  telegram: 'tgram://bottoken/ChatID',
  ntfy: 'ntfy://topic  or  ntfys://host/topic',
  gotify: 'gotify://host/token',
  email: 'mailto://user:pass@gmail.com',
  pushover: 'pover://user@token',
  home_assistant: 'hassio://host/accesstoken',
  twilio: 'twilio://sid:token@from/to',
  custom: 'Any Apprise-compatible URL',
};

/**
 * v2 Notifications tab: local browser sink (sound + desktop push, client-side)
 * plus a real notification-channel manager (custom alert targets) backed by
 * /api/v1/notifications/channels/ (webhook, Discord, Slack, ntfy, … via Apprise).
 *
 * @param {object} props
 * @param {{sound: boolean, browser: boolean}} props.local - local-sink settings
 * @param {(id: 'sound'|'browser', on: boolean) => void} props.onLocalChange
 */
export function NotificationsTab({ local, onLocalChange }) {
  const { data: channels = [], isLoading } = useNotificationChannels();
  const { data: types = [] } = useNotificationChannelTypes();
  const createCh = useCreateNotificationChannel();
  const updateCh = useUpdateNotificationChannel();
  const deleteCh = useDeleteNotificationChannel();
  const testCh = useTestNotificationChannel();

  const typeOptions = types.length ? types : FALLBACK_TYPES;

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', channel_type: 'webhook', apprise_url: '' });
  const [testingId, setTestingId] = useState(null);

  const resetForm = () => setForm({ name: '', channel_type: 'webhook', apprise_url: '' });

  const submit = async () => {
    if (!form.name.trim() || !form.apprise_url.trim()) {
      toast('Name and URL are required');
      return;
    }
    try {
      await createCh.mutateAsync({
        name: form.name.trim(),
        channel_type: form.channel_type,
        apprise_url: form.apprise_url.trim(),
        enabled: true,
      });
      toast('Channel added');
      resetForm();
      setShowAdd(false);
    } catch {
      toast('Failed to add channel');
    }
  };

  const toggle = async (ch, enabled) => {
    try {
      await updateCh.mutateAsync({ id: ch.id, data: { enabled } });
    } catch {
      toast('Failed to update channel');
    }
  };

  const remove = async (ch) => {
    try {
      await deleteCh.mutateAsync(ch.id);
      toast('Channel removed');
    } catch {
      toast('Failed to remove channel');
    }
  };

  const test = async (ch) => {
    setTestingId(ch.id);
    try {
      const res = await testCh.mutateAsync(ch.id);
      toast(res?.success ? 'Test notification sent' : res?.message || 'Test failed');
    } catch {
      toast('Test failed');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="v2-alerts__scroll v2-alerts__scroll--padded">
      {/* Local browser sink */}
      <div className="v2-alerts__modal-section-head">
        <Icon name="radio" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>Local Sink</span>
      </div>
      <div className="v2-alerts__channels">
        <div className="v2-alerts__channel">
          <span className="v2-alerts__channel-icon" style={{ color: 'var(--accent)' }}>
            <Icon name="volume" size={19} strokeWidth={1.7} />
          </span>
          <div className="v2-alerts__channel-body">
            <div className="v2-alerts__channel-name">Play sound</div>
            <div className="v2-alerts__channel-detail">
              Chime in this browser when an alert fires
            </div>
          </div>
          <Switch
            checked={!!local.sound}
            onCheckedChange={(on) => onLocalChange('sound', on)}
            label="Play sound"
          />
        </div>
        <div className="v2-alerts__channel">
          <span className="v2-alerts__channel-icon" style={{ color: 'var(--accent2)' }}>
            <Icon name="bell" size={19} strokeWidth={1.7} />
          </span>
          <div className="v2-alerts__channel-body">
            <div className="v2-alerts__channel-name">Desktop notifications</div>
            <div className="v2-alerts__channel-detail">Browser push notification on trigger</div>
          </div>
          <Switch
            checked={!!local.browser}
            onCheckedChange={(on) => onLocalChange('browser', on)}
            label="Desktop notifications"
          />
        </div>
      </div>

      {/* Server channels (custom targets) */}
      <div className="v2-alerts__modal-section-head" style={{ marginTop: 20 }}>
        <Icon name="send" size={15} strokeWidth={1.7} style={{ color: 'var(--warn)' }} />
        <span>Notification Channels</span>
        <div className="v2-alerts__topbar-spacer" />
        <button type="button" className="v2-btn" onClick={() => setShowAdd((s) => !s)}>
          <Icon name={showAdd ? 'x' : 'plus'} size={14} strokeWidth={2.2} />
          {showAdd ? 'Cancel' : 'Add Channel'}
        </button>
      </div>

      {showAdd && (
        <div className="v2-alerts__channel-form">
          <div className="v2-alerts__field-label">NAME *</div>
          <input
            className="v2-input"
            style={{ width: '100%' }}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g., Ops Discord"
            aria-label="Channel name"
          />
          <div className="v2-alerts__field-label" style={{ marginTop: 10 }}>
            TYPE
          </div>
          <Select
            options={typeOptions}
            value={form.channel_type}
            onChange={(v) => setForm((f) => ({ ...f, channel_type: v }))}
            label="Channel type"
            className="v2-alerts__type-select"
          />
          <div className="v2-alerts__field-label" style={{ marginTop: 10 }}>
            APPRISE URL *
          </div>
          <input
            className="v2-input"
            style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
            value={form.apprise_url}
            onChange={(e) => setForm((f) => ({ ...f, apprise_url: e.target.value }))}
            placeholder={URL_HINTS[form.channel_type] || 'Apprise URL'}
            aria-label="Apprise URL"
          />
          <div className="v2-alerts__hint">{URL_HINTS[form.channel_type]}</div>
          <div className="v2-alerts__modal-actions">
            <button
              type="button"
              className="v2-alerts__create"
              onClick={submit}
              disabled={createCh.isPending}
            >
              {createCh.isPending ? 'Adding…' : 'Add Channel'}
            </button>
          </div>
        </div>
      )}

      <div className="v2-alerts__channels">
        {isLoading && <div className="v2-alerts__hint">Loading channels…</div>}
        {!isLoading && channels.length === 0 && (
          <div className="v2-alerts__hint">
            No channels yet. Add a webhook, Discord, Slack, ntfy, … target to receive alerts.
          </div>
        )}
        {channels.map((ch) => (
          <div key={ch.id} className="v2-alerts__channel" data-testid={`v2-channel-${ch.id}`}>
            <span className="v2-alerts__channel-icon" style={{ color: 'var(--warn)' }}>
              <Icon name="link" size={18} strokeWidth={1.7} />
            </span>
            <div className="v2-alerts__channel-body">
              <div className="v2-alerts__channel-name">
                {ch.name}
                {ch.verified && (
                  <Icon
                    name="check"
                    size={13}
                    strokeWidth={2.4}
                    style={{ color: 'var(--ok, #46d17e)', marginLeft: 6 }}
                  />
                )}
              </div>
              <div className="v2-alerts__channel-detail v2-mono">
                {ch.channel_type} · {ch.apprise_url || '••••'}
              </div>
            </div>
            <button
              type="button"
              className="v2-btn v2-alerts__channel-test"
              onClick={() => test(ch)}
              disabled={testingId === ch.id}
            >
              <Icon name="send" size={13} strokeWidth={1.9} />
              {testingId === ch.id ? 'Testing…' : 'Test'}
            </button>
            <Switch
              checked={!!ch.enabled}
              onCheckedChange={(on) => toggle(ch, on)}
              label={`Enable ${ch.name}`}
            />
            <button
              type="button"
              className="v2-iconbtn"
              onClick={() => remove(ch)}
              aria-label={`Delete ${ch.name}`}
            >
              <Icon name="x" size={15} strokeWidth={1.9} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
