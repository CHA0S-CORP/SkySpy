// @ts-check
/**
 * Deterministic Socket.IO stream mock for Playwright e2e.
 *
 * WHY THIS EXISTS
 * ---------------
 * The v2 Aircraft List is *socket-only*: rows come from the `aircraft:snapshot`
 * Socket.IO event (see web/src/hooks/socket/useSocketIOData.js ~line 111), not
 * from any REST endpoint. The legacy `window.io` mock is dead because the app
 * ESM-imports `io` from 'socket.io-client' (web/src/hooks/socket/useSocketIO.js
 * line 15) — a global stub is never consulted — so the list could not be seeded
 * or verified.
 *
 * HOW IT WORKS
 * ------------
 * The app creates its socket with `io(origin, { path: '/socket.io',
 * transports: ['websocket', 'polling'], upgrade: false, ... })`. With websocket
 * first in the transport list and `upgrade:false`, socket.io-client (v4.8.x,
 * Engine.IO protocol v4) opens the connection *directly* over a raw WebSocket at
 * `ws://<origin>/socket.io/?EIO=4&transport=websocket`. We intercept that socket
 * with `page.routeWebSocket` and speak the minimal Engine.IO v4 / Socket.IO v4
 * wire protocol by hand — no real server, fully deterministic.
 *
 * Engine.IO v4 packet types (single leading digit):
 *   0 = OPEN     (server → client handshake, carries sid/ping config as JSON)
 *   2 = PING     (heartbeat)
 *   3 = PONG
 *   4 = MESSAGE  (wraps a Socket.IO packet)
 * Socket.IO v4 packet types (digit *inside* an Engine.IO MESSAGE, i.e. after
 * the leading '4'):
 *   0 = CONNECT      ('40' for the '/' namespace; server replies with a sid)
 *   2 = EVENT        ('42' + JSON.stringify([eventName, ...args]))
 * So a full event frame on the wire is e.g.  42["aircraft:snapshot", {...}]
 *
 * The app connects on the default namespace '/' (useSocketIO passes
 * namespace: '/'), so we only handle the '40' CONNECT for '/'.
 */

/**
 * @typedef {object} SeedOptions
 * @property {number} [now] - snapshot `now` epoch seconds (defaults to Date.now()/1000)
 */

/**
 * Intercept the Socket.IO WebSocket and drive it with a seeded aircraft snapshot.
 *
 * Call this BEFORE `page.goto(...)` so the route is registered before the app
 * opens its socket.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object[]} aircraftArray - raw aircraft objects (hex/flight/t/ownOp/desc/year/r/…)
 * @param {SeedOptions} [options]
 */
export async function seedAircraftViaSocket(page, aircraftArray, options = {}) {
  const now = options.now ?? Date.now() / 1000;

  // Match the socket.io path regardless of origin/query (?EIO=4&transport=websocket&…).
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    // Engine.IO OPEN handshake. maxPayload/ping values are arbitrary but valid;
    // upgrades:[] tells the client not to attempt a transport upgrade.
    ws.send(
      '0' +
        JSON.stringify({
          sid: 'mock',
          upgrades: [],
          pingInterval: 25000,
          pingTimeout: 20000,
          maxPayload: 1000000,
        })
    );

    // Push the aircraft snapshot as a Socket.IO EVENT on the '/' namespace.
    const sendSnapshot = () => {
      const payload = { aircraft: aircraftArray, now, count: aircraftArray.length };
      ws.send('42' + JSON.stringify(['aircraft:snapshot', payload]));
    };

    ws.onMessage((raw) => {
      const msg = typeof raw === 'string' ? raw : raw.toString();

      // Engine.IO PING → PONG (keeps the client from timing out the connection).
      if (msg === '2') {
        ws.send('3');
        return;
      }

      // Socket.IO CONNECT to '/' namespace → acknowledge with a sid, then
      // immediately deliver the snapshot so rows render without any REST round-trip.
      if (msg === '40' || msg.startsWith('40')) {
        ws.send('40' + JSON.stringify({ sid: 'mock-sid' }));
        sendSnapshot();
        return;
      }

      // The app also emits a `subscribe` and an aircraft-snapshot `request`
      // ('42[...]') after connecting. Re-send the snapshot on the explicit
      // aircraft-snapshot request so the list is populated even if the initial
      // push raced the listener setup. All other client events are ignored.
      if (msg.startsWith('42')) {
        try {
          const parsed = JSON.parse(msg.slice(2));
          const eventName = Array.isArray(parsed) ? parsed[0] : null;
          const body = Array.isArray(parsed) ? parsed[1] : null;
          if (
            eventName === 'request' &&
            body &&
            (body.type === 'aircraft-snapshot' || body.type === 'aircraft_snapshot')
          ) {
            // Answer as a `response` event carrying the snapshot — useSocketIOData
            // routes request_type: 'aircraft-snapshot' responses through the same
            // processAircraftSnapshot path.
            ws.send(
              '42' +
                JSON.stringify([
                  'response',
                  {
                    request_id: body.request_id,
                    request_type: 'aircraft-snapshot',
                    data: { aircraft: aircraftArray, now, count: aircraftArray.length },
                  },
                ])
            );
          }
        } catch {
          // Non-JSON / unexpected frame — ignore.
        }
      }
    });

    // Do NOT call ws.connectToServer(): there is no real server in e2e, and we
    // fully synthesize the protocol above. Leaving the upstream unconnected makes
    // this a pure mock.
  });
}

/**
 * Three deterministic aircraft with the enrichment fields the v2 list surfaces:
 *   ownOp -> operator secondary line, desc -> full type name, year -> build year,
 *   r -> registration tail. Hexes are lowercase on the wire; the normalizer
 *   upper-cases them, so row/enrichment test ids use the UPPERCASE hex.
 *
 * @returns {object[]}
 */
export function makeSeedAircraft() {
  return [
    {
      hex: 'a7e198',
      flight: 'UAL245',
      r: 'N12345',
      t: 'B739',
      desc: 'Boeing 737-900',
      ownOp: 'United Airlines',
      year: 2018,
      squawk: '2456',
      alt: 34000,
      gs: 452,
      track: 271,
      vr: 512,
      distance_nm: 12.4,
      rssi: -8,
      category: 'A3',
    },
    {
      hex: 'ac82 f1'.replace(' ', ''), // ac82f1
      flight: 'DAL1120',
      r: 'N901DL',
      t: 'A321',
      desc: 'Airbus A321neo',
      ownOp: 'Delta Air Lines',
      year: 2021,
      squawk: '1200',
      alt: 28000,
      gs: 410,
      track: 95,
      vr: -640,
      distance_nm: 27.9,
      rssi: -20,
      category: 'A3',
    },
    {
      hex: 'ae1234',
      flight: 'RCH512',
      r: '08-8888',
      t: 'C17',
      desc: 'Boeing C-17 Globemaster III',
      ownOp: 'United States Air Force',
      year: 2008,
      squawk: '4712',
      alt: 22000,
      gs: 388,
      track: 180,
      vr: 0,
      distance_nm: 41.2,
      rssi: -28,
      military: true,
      category: 'A5',
    },
  ];
}

/**
 * Build a `/api/v1/airframes/bulk` response body for the given aircraft, seeding
 * the photo + privacy/interest flags the list renders. Keys are UPPERCASE hexes
 * (the DB icao_hex form the endpoint returns).
 *
 * @param {object[]} aircraftArray
 * @param {{ [hex: string]: { photo?: string, pia?: boolean, ladd?: boolean, interesting?: boolean } }} [flagsByHex]
 *   keyed by lowercase or uppercase hex
 * @returns {object}
 */
export function makeBulkResponse(aircraftArray, flagsByHex = {}) {
  const aircraft = {};
  for (const a of aircraftArray) {
    const up = String(a.hex).toUpperCase();
    const cfg = flagsByHex[up] || flagsByHex[String(a.hex).toLowerCase()] || {};
    aircraft[up] = {
      icao_hex: up,
      registration: a.r || null,
      photo_thumbnail_url: cfg.photo ?? `https://cdn.example.test/${up}.jpg`,
      // The serializer exposes is_pia/is_ladd/is_interesting only inside
      // per-source source_data rows; the hook ORs them across sources.
      source_data: [
        {
          source: 'mock',
          is_pia: Boolean(cfg.pia),
          is_ladd: Boolean(cfg.ladd),
          is_interesting: Boolean(cfg.interesting),
        },
      ],
    };
  }
  return { aircraft, found: Object.keys(aircraft).length, requested: aircraftArray.length };
}
