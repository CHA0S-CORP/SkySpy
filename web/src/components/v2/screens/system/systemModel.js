/**
 * Pure derivations for the v2 System screen: service statuses, banner, gauges.
 * Maps /api/v1/system/* + safety/acars/notifications payloads onto the design.
 */

export function sevColor(sev) {
  if (sev === 'danger') return 'var(--danger)';
  if (sev === 'warn') return 'var(--warn)';
  if (sev === 'info') return 'var(--accent2)';
  return 'var(--accent)';
}

function healthEntry(health, key) {
  return health?.services?.[key] || health?.components?.[key] || null;
}

function isUp(entry) {
  return entry?.status === 'up' || entry?.status === 'healthy' || entry?.status === 'ok';
}

/**
 * Derive the 7 service rows (mock Services card) from live payloads.
 * @param {{status?: object, health?: object, wsConnected?: boolean}} data
 */
export function deriveServices({ status, health, wsConnected }) {
  const loading = status == null && health == null;
  const svcState = (key, extraOnline = false) => {
    const entry = healthEntry(health, key);
    if (isUp(entry) || extraOnline) return 'ok';
    if (loading) return 'warn';
    return 'danger';
  };
  const detail = (key) => {
    const e = healthEntry(health, key) || {};
    return {
      uptime: e.uptime || '—',
      latency:
        e.latency_ms != null
          ? `${e.latency_ms} ms`
          : e.response_time_ms != null
            ? `${e.response_time_ms} ms`
            : '—',
      last: e.last_check || '—',
    };
  };

  const adsbOnline =
    status?.receiver_online ?? status?.adsb_online ?? isUp(healthEntry(health, 'adsb'));
  const rows = [
    {
      id: 'client',
      name: 'Client Connection',
      status: wsConnected ? 'WEBSOCKET' : 'POLLING',
      sev: wsConnected ? 'info' : 'warn',
      ...detail('client'),
    },
    {
      id: 'adsb',
      name: 'ADS-B Receiver',
      status: adsbOnline ? 'CONNECTED' : loading ? 'CHECKING' : 'OFFLINE',
      sev: adsbOnline ? 'ok' : loading ? 'warn' : 'danger',
      ...detail('adsb'),
    },
    {
      id: 'database',
      name: 'Database',
      status:
        svcState('database') === 'ok'
          ? 'CONNECTED'
          : svcState('database') === 'warn'
            ? 'CHECKING'
            : 'OFFLINE',
      sev: svcState('database'),
      ...detail('database'),
    },
    {
      id: 'redis',
      name: 'Redis / Cache',
      status:
        svcState('cache', status?.redis_enabled) === 'ok'
          ? 'CONNECTED'
          : svcState('cache', status?.redis_enabled) === 'warn'
            ? 'CHECKING'
            : 'OFFLINE',
      sev: svcState('cache', status?.redis_enabled),
      ...detail('cache'),
    },
    {
      id: 'ws',
      name: 'WebSocket Server',
      status: wsConnected || status?.websocket_connections != null ? 'RUNNING' : 'UNKNOWN',
      sev: wsConnected || status?.websocket_connections != null ? 'ok' : 'warn',
      ...detail('websocket'),
    },
    {
      id: 'celery',
      name: 'Celery Workers',
      status:
        svcState('celery', status?.celery_running) === 'ok'
          ? 'RUNNING'
          : svcState('celery', status?.celery_running) === 'warn'
            ? 'CHECKING'
            : 'STOPPED',
      sev: svcState('celery', status?.celery_running),
      ...detail('celery'),
    },
    {
      id: 'api',
      name: 'REST API',
      status: health || status ? 'HEALTHY' : loading ? 'CHECKING' : 'UNREACHABLE',
      sev: health || status ? 'ok' : loading ? 'warn' : 'danger',
      ...detail('api'),
    },
  ];
  return rows.map((r) => ({ ...r, color: sevColor(r.sev) }));
}

/**
 * Banner computed from services (design: green operational vs amber degraded).
 * @param {ReturnType<typeof deriveServices>} services
 */
export function deriveBanner(services) {
  const total = services.length;
  const offline = services.filter((s) => s.sev === 'danger');
  const online = total - offline.length;
  const degraded = offline.length > 0;
  return {
    degraded,
    title: degraded ? 'Degraded Performance' : 'All Systems Operational',
    sub: degraded
      ? `${online} of ${total} services online · ${offline.map((s) => s.name).join(', ')} offline`
      : `${total}/${total} services online`,
    color: degraded ? 'var(--warn)' : 'var(--accent)',
  };
}

/**
 * Health gauges (CPU / Memory / SDR Temp / Gain) from status/info payloads.
 * @param {{status?: object, info?: object}} data
 */
export function deriveGauges({ status, info }) {
  const cpu = status?.cpu_percent ?? info?.cpu_percent;
  const mem = status?.memory_percent ?? info?.memory_percent;
  const temp = status?.sdr_temp;
  const gain = status?.sdr_gain;
  const level = (v, warnAt, critAt) =>
    v == null
      ? 'var(--dim2)'
      : v >= critAt
        ? 'var(--danger)'
        : v >= warnAt
          ? 'var(--warn)'
          : 'var(--accent)';
  const disp = (v) => (typeof v === 'number' ? Math.round(v) : '--');
  return [
    {
      key: 'cpu',
      label: 'CPU',
      value: disp(cpu),
      unit: '%',
      pct: cpu ?? 0,
      color: level(cpu, 70, 90),
      note: status?.load_average != null ? `load ${status.load_average}` : 'host processor load',
    },
    {
      key: 'mem',
      label: 'MEMORY',
      value: disp(mem),
      unit: '%',
      pct: mem ?? 0,
      color: level(mem, 75, 90),
      note:
        status?.memory_used_gb != null && status?.memory_total_gb != null
          ? `${status.memory_used_gb} / ${status.memory_total_gb} GB used`
          : 'system memory',
    },
    {
      key: 'temp',
      label: 'SDR TEMP',
      value: disp(temp),
      unit: '°C',
      pct: temp != null ? Math.min(100, (temp / 85) * 100) : 0,
      color: level(temp, 55, 70),
      note: temp != null ? 'nominal · < 70°C' : 'no sensor data',
    },
    {
      key: 'gain',
      label: 'GAIN',
      value: typeof gain === 'number' ? gain : '--',
      unit: 'dB',
      pct: typeof gain === 'number' ? Math.min(100, (gain / 60) * 100) : 0,
      color: 'var(--accent)',
      note: typeof gain === 'number' ? 'receiver gain' : 'no gain data',
    },
  ];
}

/**
 * Antenna coverage summary from /system/status `antenna` (present only when the
 * celery worker has published `antenna_analytics` to cache — otherwise null).
 * Returns null when the payload has no usable antenna metric.
 * @param {{status?: object}} data
 */
export function deriveAntenna({ status }) {
  const a = status?.antenna;
  if (!a) return null;
  const max = a.max_range_nm;
  const avg = a.avg_range_nm;
  const cov = a.coverage_percentage;
  if (max == null && avg == null && cov == null) return null;
  const disp = (v, digits = 1) => (typeof v === 'number' ? v.toFixed(digits) : '--');
  return {
    maxRange: max != null ? `${disp(max)} nm` : '--',
    avgRange: avg != null ? `${disp(avg)} nm` : '--',
    coverage: cov != null ? `${Math.round(cov)}%` : '--',
    coveragePct: typeof cov === 'number' ? Math.max(0, Math.min(100, cov)) : 0,
  };
}

/**
 * libacars (ACARS CFFI binding) status merged from /system/status `libacars`
 * (available/stats/error) and /system/health `services.libacars` (issues[]).
 * Returns null when neither payload carries libacars data.
 * @param {{status?: object, health?: object}} data
 */
export function deriveLibacars({ status, health }) {
  const s = status?.libacars;
  const h = healthEntry(health, 'libacars');
  if (!s && !h) return null;
  const available = s?.available ?? (h ? isUp(h) : undefined);
  const stats = s?.stats || null;
  const error = s?.error || h?.message || null;
  const issues = Array.isArray(h?.issues) ? h.issues : [];
  return {
    available: available === true,
    unknown: available == null,
    stats,
    error,
    issues,
  };
}

/** 12-hour clock string like the mock's now(). */
export function clock12(d = new Date()) {
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ${ap}`;
}
