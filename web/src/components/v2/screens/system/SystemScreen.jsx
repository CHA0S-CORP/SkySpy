import React, { useMemo, useState } from 'react';
import { Icon, toast } from '../../primitives';
import { useSystemData, postAction } from './useSystemData';
import { deriveServices, deriveBanner, deriveGauges, sevColor, clock12 } from './systemModel';

function CardHeader({ icon, title, aside }) {
  return (
    <div className="v2-sys__cardhead">
      <Icon name={icon} size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
      <span className="v2-sys__cardtitle">{title}</span>
      {aside && <span className="v2-sys__cardaside">{aside}</span>}
    </div>
  );
}

function KV({ label, children, last }) {
  return (
    <div className={`v2-sys__kv ${last ? 'v2-sys__kv--last' : ''}`}>
      <span className="v2-sys__kv-label">{label}</span>
      <span className="v2-sys__kv-value">{children}</span>
    </div>
  );
}

function StatusPill({ sev, children }) {
  const c = sevColor(sev);
  return (
    <span
      className="v2-sys__pill"
      style={{ color: c, background: `color-mix(in srgb, ${c} 15%, transparent)` }}
    >
      {children}
    </span>
  );
}

/**
 * v2 System screen (designs/System.dc.html): status banner computed from
 * services, health gauges, card grid, recent events log, feeder location.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {boolean} props.wsConnected
 * @param {{lat?: number, lon?: number}|null} props.feederLocation
 */
export function SystemScreen({ apiBase, wsConnected, feederLocation }) {
  const { data, refetch, dataUpdatedAt } = useSystemData(apiBase);
  const [openService, setOpenService] = useState({});
  const [events, setEvents] = useState([]);

  const services = useMemo(
    () => deriveServices({ status: data?.status, health: data?.health, wsConnected }),
    [data, wsConnected]
  );
  const banner = useMemo(() => deriveBanner(services), [services]);
  const gauges = useMemo(() => deriveGauges({ status: data?.status, info: data?.info }), [data]);

  const addEvent = (msg, sev = 'ok') =>
    setEvents((prev) => [{ msg, sev, t: clock12() }, ...prev].slice(0, 12));

  const onTestNotification = async () => {
    const res = await postAction(`${apiBase}/api/v1/notifications/test/`);
    const ok = !!res?.success;
    addEvent(
      ok ? 'Test notification dispatched' : 'Test notification failed',
      ok ? 'info' : 'danger'
    );
    toast(ok ? 'Test notification sent' : 'Notification test failed');
  };
  const onTestSafety = async () => {
    const res = await postAction(`${apiBase}/api/v1/safety/events/test/`);
    const generated = res?.generated ?? 0;
    addEvent(
      generated > 0 ? `Generated ${generated} test safety events` : 'Safety test failed',
      generated > 0 ? 'ok' : 'danger'
    );
    toast(generated > 0 ? 'Safety self-test complete' : 'Safety test failed');
  };
  const onCopyCoords = async () => {
    const lat = feederLocation?.lat;
    const lon = feederLocation?.lon;
    if (lat == null || lon == null) return;
    try {
      await navigator.clipboard.writeText(`${lat}, ${lon}`);
      toast('Coordinates copied to clipboard');
      addEvent('Feeder coordinates copied', 'info');
    } catch {
      toast('Copy failed');
    }
  };
  const onRefresh = () => {
    refetch();
    addEvent('System status refreshed', 'ok');
    toast('System status refreshed');
  };

  // /system/databases describes the external lookup DBs, not the app DB -
  // the sighting/session counts live on /system/status
  const db = {
    total_sightings: data?.status?.total_sightings,
    total_sessions: data?.status?.total_sessions,
    ...(data?.status?.database || {}),
  };
  const notif = data?.notifConfig || {};
  const safety = data?.safetyStatus || {};
  const acars = data?.acarsStats || {};
  const status = data?.status || {};
  const info = data?.info || {};

  const acarsRunning = data?.acarsStatus?.running ?? acars?.running ?? acars?.enabled ?? false;
  const notifEnabled = notif?.enabled ?? (notif?.server_count ?? notif?.servers?.length ?? 0) > 0;
  const bannerTint = `color-mix(in srgb, ${banner.color} 12%, transparent)`;

  const num = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : (v ?? '--'));

  return (
    <div className="v2-sys" data-testid="v2-system">
      {/* Status banner */}
      <div
        className="v2-sys__banner"
        style={{
          background: `linear-gradient(90deg, ${bannerTint}, transparent 70%) var(--bg1)`,
          borderColor: `color-mix(in srgb, ${banner.color} 30%, var(--bord))`,
        }}
      >
        <div
          className="v2-sys__banner-icon"
          style={{ background: bannerTint, color: banner.color }}
        >
          <Icon
            name={banner.degraded ? 'alert-triangle' : 'shield-check'}
            size={24}
            strokeWidth={1.8}
          />
        </div>
        <div>
          <div className="v2-sys__banner-title" data-testid="v2-system-banner">
            {banner.title}
          </div>
          <div className="v2-sys__banner-sub">{banner.sub}</div>
        </div>
        <div className="v2-sys__banner-spacer" />
        <div className="v2-sys__dots">
          {services.map((s) => (
            <span
              key={s.id}
              title={`${s.name} · ${s.status}`}
              className="v2-sys__dot"
              style={{ background: s.color, boxShadow: `0 0 7px ${s.color}` }}
            />
          ))}
        </div>
        <button type="button" className="v2-btn" onClick={onRefresh}>
          <Icon name="refresh" size={14} strokeWidth={1.7} />
          Refresh
        </button>
      </div>

      {/* Health gauges */}
      <div className="v2-sys__gauges">
        {gauges.map((g) => (
          <div key={g.key} className="v2-sys__gauge">
            <div className="v2-sys__gauge-head">
              <span className="v2-sys__gauge-icon" style={{ color: g.color }}>
                <Icon
                  name={
                    g.key === 'gain'
                      ? 'signal'
                      : g.key === 'temp'
                        ? 'thermometer'
                        : g.key === 'mem'
                          ? 'memory'
                          : 'cpu'
                  }
                  size={14}
                  strokeWidth={1.8}
                />
              </span>
              <span className="v2-sys__gauge-label">{g.label}</span>
            </div>
            <div className="v2-sys__gauge-value">
              <span>{g.value}</span>
              <span className="v2-sys__gauge-unit">{g.unit}</span>
            </div>
            <div className="v2-sys__gauge-track">
              <div
                className="v2-sys__gauge-fill"
                style={{ width: `${Math.max(0, Math.min(100, g.pct))}%`, background: g.color }}
              />
            </div>
            <div className="v2-sys__gauge-note">{g.note}</div>
          </div>
        ))}
      </div>

      {/* Card grid */}
      <div className="v2-sys__grid">
        {/* Services */}
        <div className="v2-sys__card">
          <CardHeader
            icon="activity"
            title="Services"
            aside={`${services.filter((s) => s.sev !== 'danger').length}/${services.length} online`}
          />
          <div className="v2-sys__services">
            {services.map((s) => {
              const open = !!openService[s.id];
              return (
                <div key={s.id}>
                  <button
                    type="button"
                    className="v2-sys__service"
                    onClick={() => setOpenService((p) => ({ ...p, [s.id]: !p[s.id] }))}
                    aria-expanded={open}
                  >
                    <Icon
                      name="chevron-right"
                      size={12}
                      strokeWidth={2.2}
                      style={{ transform: open ? 'rotate(90deg)' : 'none', color: 'var(--dim2)' }}
                    />
                    <span
                      className="v2-sys__service-dot"
                      style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }}
                    />
                    <span className="v2-sys__service-name">{s.name}</span>
                    <StatusPill sev={s.sev}>{s.status}</StatusPill>
                  </button>
                  {open && (
                    <div className="v2-sys__service-detail">
                      <div>
                        <div className="v2-sys__service-dl">UPTIME</div>
                        <div className="v2-sys__service-dv">{s.uptime}</div>
                      </div>
                      <div>
                        <div className="v2-sys__service-dl">LATENCY</div>
                        <div className="v2-sys__service-dv">{s.latency}</div>
                      </div>
                      <div>
                        <div className="v2-sys__service-dl">LAST CHECK</div>
                        <div className="v2-sys__service-dv">{s.last}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Real-time */}
        <div className="v2-sys__card">
          <CardHeader icon="zap" title="Real-time" />
          <div className="v2-sys__cardbody">
            <KV label="WS Clients">{num(status.websocket_connections)}</KV>
            <KV label="Tracked Aircraft">
              <span style={{ color: 'var(--accent)' }}>
                {num(status.aircraft_count ?? status.aircraft_tracked)}
              </span>
            </KV>
            <KV label="Messages / s">{num(status.message_rate)}</KV>
            <KV label="Uptime" last>
              {status.uptime ?? '--'}
            </KV>
          </div>
        </div>

        {/* Database stats */}
        <div className="v2-sys__card">
          <CardHeader icon="database" title="Database Stats" />
          <div className="v2-sys__cardbody">
            <KV label="Total Sightings">{num(db.total_sightings ?? db.sightings)}</KV>
            <KV label="Total Sessions">{num(db.total_sessions ?? db.sessions)}</KV>
            <KV label="Aircraft Records">{num(db.total_aircraft ?? db.aircraft)}</KV>
            <KV label="Storage Used" last>
              {db.storage_used ?? db.db_size ?? '--'}
            </KV>
          </div>
        </div>

        {/* Notifications */}
        <div className="v2-sys__card">
          <CardHeader icon="bell" title="Notifications" />
          <div className="v2-sys__cardbody">
            <KV label="Status">
              <StatusPill sev={notifEnabled ? 'ok' : 'danger'}>
                {notifEnabled ? 'ENABLED' : 'DISABLED'}
              </StatusPill>
            </KV>
            <KV label="Servers">{num(notif.server_count ?? notif.servers?.length ?? 0)}</KV>
            <KV label="Cooldown" last>
              {notif.cooldown_seconds != null ? `${notif.cooldown_seconds} s` : '--'}
            </KV>
            <button type="button" className="v2-btn v2-sys__cardbtn" onClick={onTestNotification}>
              <Icon name="edit" size={14} strokeWidth={1.7} />
              Test Notification
            </button>
          </div>
        </div>

        {/* Safety monitor */}
        <div className="v2-sys__card">
          <CardHeader icon="alert-triangle" title="Safety Monitor" />
          <div className="v2-sys__cardbody">
            <KV label="Status">
              <StatusPill sev={safety.enabled === false ? 'danger' : 'ok'}>
                {safety.enabled === false ? 'DISABLED' : 'ENABLED'}
              </StatusPill>
            </KV>
            <KV label="Tracked Aircraft">
              {num(safety.tracked_aircraft ?? status.aircraft_count)}
            </KV>
            <KV label="Events Today" last>
              <span style={{ color: 'var(--warn)' }}>
                {num(safety.events_today ?? safety.active_events)}
              </span>
            </KV>
            <button type="button" className="v2-btn v2-sys__cardbtn" onClick={onTestSafety}>
              <Icon name="edit" size={14} strokeWidth={1.7} />
              Test Safety Events
            </button>
          </div>
        </div>

        {/* ACARS */}
        <div className="v2-sys__card">
          <CardHeader icon="wave" title="ACARS Service" />
          <div className="v2-sys__cardbody">
            <KV label="Status">
              <StatusPill sev={acarsRunning ? 'ok' : 'danger'}>
                {acarsRunning ? 'RUNNING' : 'STOPPED'}
              </StatusPill>
            </KV>
            <KV label="Last Hour">{num(acars.last_hour ?? 0)}</KV>
            <KV label="Last 24 h" last>
              {num(acars.last_24h ?? 0)}
            </KV>
            {/* ACARS runs as its own listener process (docker --profile acars /
                run_acars) - there is no runtime start endpoint to call */}
          </div>
        </div>

        {/* Recent events (span 2) */}
        <div className="v2-sys__card v2-sys__card--wide">
          <CardHeader icon="clock" title="Recent Events" aside={`${events.length} events`} />
          <div className="v2-sys__events">
            {events.length === 0 ? (
              <div className="v2-sys__events-empty">
                <Icon name="clock" size={30} strokeWidth={1.4} />
                <span>No recent events</span>
              </div>
            ) : (
              events.map((e, i) => (
                <div key={i} className="v2-sys__event">
                  <span className="v2-sys__event-dot" style={{ background: sevColor(e.sev) }} />
                  <span className="v2-sys__event-msg">{e.msg}</span>
                  <span className="v2-sys__event-time">{e.t}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Feeder location */}
        <div className="v2-sys__card">
          <CardHeader icon="map-pin" title="Feeder Location" />
          <div className="v2-sys__feeder">
            <div className="v2-sys__feeder-map">
              <div className="v2-sys__feeder-marker">
                <div className="v2-sys__feeder-ring" />
                <span className="v2-sys__feeder-dot" />
              </div>
            </div>
            <div className="v2-sys__feeder-coords">
              <div>
                <div className="v2-sys__service-dl">LATITUDE</div>
                <div className="v2-sys__feeder-coord">
                  {feederLocation?.lat?.toFixed(4) ?? '--'}
                </div>
              </div>
              <div>
                <div className="v2-sys__service-dl">LONGITUDE</div>
                <div className="v2-sys__feeder-coord">
                  {feederLocation?.lon?.toFixed(4) ?? '--'}
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <button type="button" className="v2-btn" onClick={onCopyCoords}>
                <Icon name="copy" size={13} strokeWidth={1.7} />
                Copy
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="v2-sys__footer">
        <span>API {info.api_version ?? 'v1'}</span>
        <span>Django {info.django_version ?? '--'}</span>
        <span>Python {info.python_version ?? '--'}</span>
        <span>Updated {dataUpdatedAt ? clock12(new Date(dataUpdatedAt)) : '--'}</span>
        <span
          className="v2-sys__footer-conn"
          style={{ color: wsConnected ? 'var(--accent)' : 'var(--danger)' }}
        >
          <Icon name="signal" size={13} strokeWidth={1.8} />
          {wsConnected ? 'connected' : 'disconnected'}
        </span>
      </div>
    </div>
  );
}
