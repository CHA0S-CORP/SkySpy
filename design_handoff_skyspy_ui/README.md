# Handoff: SkySpy — ADS-B / Aircraft-Tracking Console (UI Replacement)

## Overview
SkySpy is a real-time aircraft-tracking console (ADS-B / Mode-S / SDR feed). This handoff
covers a full visual + interaction redesign of the existing product across **9 screens**:
Live Map, Aircraft Detail, Aircraft List, History, Statistics, Radio, System, Alerts, and a
touch-first **Cannonball** driving mode. The goal is to **replace the current UI** with these
designs while wiring the data to a **realtime Socket.IO** transport wherever the view shows
live-updating data.

## About the Design Files
The files in `designs/` are **design references authored in HTML** (a small streaming
component runtime called "DC" — `*.dc.html` + `support.js`). They are **prototypes that show
the intended look, layout, and behavior — not production code to copy directly.**

Your task: **recreate these designs in the target codebase's existing environment** (React,
Vue, Svelte, etc.) using its established patterns, router, state layer, and component library.
If no frontend exists yet, choose the most appropriate modern framework — **React + Vite +
TypeScript is the recommended default** — and implement there. Do **not** ship the `.dc.html`
files or the `DC`/`support.js` runtime; they are a mock harness only. Lift the exact values
(hex, spacing, font stacks, radii, copy, SVG icon paths, chart math) from the HTML.

Open any `designs/*.dc.html` directly in a browser to see it live and interact with it.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, iconography, chart geometry, and
interactions are all specified. Recreate pixel-faithfully using the codebase's libraries.
The mock data in each file is illustrative — replace it with live data from the API/socket.

---

## Realtime architecture (Socket.IO)

Everything that changes while the operator watches must come over a **Socket.IO** connection
rather than polling. Use one shared client (a singleton / React context / store) and fan out
to screens.

### Client setup
```ts
import { io } from "socket.io-client";
export const socket = io("/", { transports: ["websocket"], reconnection: true });
```
- Show connection status in the header/rails ("SKY LINK", "WebSocket Active", the LIVE dot).
  Drive it from `socket.on("connect"|"disconnect"|"connect_error", …)`.
- Reconnect with backoff (built in). On reconnect, re-emit any active subscriptions.

### Server → client events (consume)
| Event | Payload (shape) | Drives |
|---|---|---|
| `aircraft:snapshot` | `Aircraft[]` (full current set) | initial Live Map + List hydrate |
| `aircraft:update` | `Aircraft` or `Aircraft[]` (delta, ~1 Hz) | blip position/altitude/speed, list rows, header count |
| `aircraft:remove` | `{ id }` | drop blip/row when it leaves coverage |
| `aircraft:detail` | `AircraftDetail` | Aircraft Detail page live fields + track |
| `safety:event` | `{ id, kind: "PROXIMITY"|"VS_REVERSAL"|"LOW_ALT"|…, severity, aircraftId }` | pulsing map rings + Alerts feed + Safety counters |
| `alert:fired` | `{ ruleId, ruleName, aircraft, priority, ts }` | Alerts → History tab, nav badge, toast |
| `radio:transmission` | `Transmission` | Radio log prepend + "Live" indicator |
| `radio:transcript` | `{ id, text, status }` | fills a pending transmission's transcript |
| `stats:tick` | `StatsSnapshot` | Statistics KPIs, sparklines, activity bars |
| `system:health` | `{ cpu, ram, sdrTemp, gain, services[] }` | System gauges + service statuses + banner |
| `system:event` | `{ msg, severity, ts }` | System "Recent Events" prepend |
| `gps:fix` | `{ lat, lon, locked }` | header LAT/LON, feeder location |

### Client → server events (emit)
| Event | Payload | When |
|---|---|---|
| `subscribe` | `{ view: "map"|"list"|"detail", bbox?, aircraftId? }` | on screen mount / viewport change |
| `unsubscribe` | `{ view }` | on unmount |
| `aircraft:follow` | `{ id }` | select an aircraft / "Follow" |
| `alert:create` | `AlertRule` | Create Alert Rule modal → Create |
| `alert:toggle` | `{ ruleId, enabled }` | rule enable switch |
| `alert:test` | `{ ruleId }` | "Test Safety Events" |
| `acars:start` / `acars:stop` | `{}` | System / ACARS controls |
| `playback:seek` | `{ aircraftId, t }` | Detail track scrubber |

If a given deployment has no socket for some domain (e.g. static airframe metadata), fall back
to REST; keep the live domains (positions, safety, radio, stats, system health) on the socket.

### Core data shape
```ts
type Category = "commercial" | "military" | "ga";
interface Aircraft {
  id: string;            // ICAO 24-bit hex, e.g. "A75B65"
  cs: string;            // callsign
  cat: Category;
  spd: number;           // ground speed, kts
  altk: number;          // altitude in hundreds of ft (30 => 3,000 ft)
  type: string;          // ICAO type, "A321"
  x: string; y: string;  // MOCK ONLY — replace with lat/lon projected to the map
  hdg: number;           // track, degrees
  vs: string;            // vertical speed fpm, signed ("-576")
  dist: number;          // nm from station
  squawk: string | null;
  reg: string; op: string; size: string; route: string;
  safety?: { label: string; severity: "info"|"warn"|"danger" };
}
```
In the mocks, position is a hard-coded `x%`/`y%`. In production, project `lat`/`lon` to the
map surface (screen-space for the schematic scope, or a real map lib — MapLibre/Leaflet — if
you swap the schematic radar for a slippy map).

---

## Design tokens

CSS custom properties (default "radar" theme; two alternates ship as `[data-theme]` blocks —
put these on `:root` / a theme provider):

```css
--bg0:#080b11; --bg1:#0d131b; --bg2:#141d28; --bg3:#1a2531;   /* surfaces, back→front */
--bord:#1b2531; --bord2:#28343f;                               /* borders */
--txt:#e8eff6; --dim:#8b98a7; --dim2:#586472;                  /* text: primary/secondary/tertiary */
--accent:#3ddc84;      /* emerald — primary / commercial / OK */
--accent2:#4cc9f0;     /* cyan — data / links / selection / lead lines */
--warn:#f5b544;        /* amber — caution / descending */
--danger:#f2585d;      /* red — critical / emergency */
--mil:#b39dff;         /* violet — military */
```
Theme "slate": accent `#4cc9f0`, accent2 `#5eead4`, cooler bg (`--bg0:#0a111e` …).
Theme "amber": accent `#f5b544`, accent2 `#ffd479`, warm bg (`--bg0:#0c0a06` …).

**Category → color:** commercial `--accent`, military `--mil`, GA `--accent2`.
**Priority/severity → color:** info `--accent2`, warning `--warn`, critical/emergency `--danger`.

**Typography**
- UI sans: `"IBM Plex Sans", system-ui, sans-serif` (400/500/600/700).
- All numerics, codes, coords, timestamps, callsigns: `"IBM Plex Mono"` (500/600/700).
- Section eyebrows: 10–11px, `letter-spacing:1–1.4px`, `font-weight:600`, `--dim`, UPPERCASE.
- Load both from Google Fonts.

**Spacing / shape**
- Radii: chips/inputs 6–11px, cards 12–14px, pills/round buttons full.
- Card = `--bg1` + `1px solid --bord`; raised/inset = `--bg2`/`--bg0`.
- Left status accent bar: `border-left:2–3px solid <category|priority>`.
- Standard control heights: 34 / 38–40 / 42px. Touch (Cannonball): 76–86px.
- Chrome: header 60px, left nav 214px.
- Custom scrollbars: 9–10px, thumb `--bord2`.

**Icons:** inline SVG, `viewBox="0 0 24 24"`, `stroke="currentColor"`, `stroke-width≈1.7`,
`fill="none"` (feather-style). Copy exact `d` paths from the mocks. Avoid an icon font unless
the codebase already has one whose glyphs match.

**Never** introduce gradients-as-decoration, emoji, or new hues; stay within the tokens above.

---

## Shared chrome (every screen except Cannonball)

- **Global header (60px):** SkySpy logo (radar glyph + wordmark, "Spy" in `--accent`); live
  stat cluster (aircraft count in `--accent`, LAT/LON in `--accent2`, ONLINE) separated by
  1px dividers; right side notifications + settings icon buttons + `HH:MM:SS UTC` mono clock.
  Counts and coords are **socket-driven**.
- **Left nav (214px, `--bg1`):** items Live Map, Aircraft List, Statistics, History, Radio,
  Alerts (amber count badge), System, then a highlighted red **Cannonball** entry; footer LIVE
  dot (pulsing) + version. Active item: left `2px --accent` bar + tinted gradient + `--accent`
  text. This is the app shell/router outlet; each screen is a route.

---

## Screens

### 1. Live Map (`SkySpy.dc.html`) — primary
Three-pane: nav | map | 392px detail panel (collapsible; a reopen tab appears when collapsed).

- **Toolbar (56px):** search input (⌘/ hint), grouped icon clusters with 1px dividers
  (status clock, comms, alerts/layers, zoom slider, activity/recenter/fullscreen). Tooltips via `title`.
- **Map surface:** radial-gradient bg, faint `<pattern>` grid, subtle coastline polylines,
  concentric **range rings** centered on the sensor, a cyan sensor dot, lat/lon edge labels,
  a bottom-left mono coordinate readout, center-bottom "Track Playback" pill, bottom-right
  mini compass. (The mock rings are static; keep them, or replace the whole surface with a
  real map lib and overlay the same symbology.)
- **Aircraft blips:** rotated dart SVG (`M12 2 19 21 12 16 5 21z`) filled by category color,
  drop-shadow glow, rotated by `hdg`. Selected = white dart + pulsing dashed cyan ring
  (`ringpulse` 2.2s). z-order: selected > hovered > safety > normal.
- **Lead line (velocity leader), per blip** — build as **rotated pixel elements**, not SVG, so
  dots stay round/undistorted. A wrapper `position:absolute; left/top:50%; transform:rotate(hdg)`:
  - **Solid stub:** fixed **20px** long, 2px wide, `--accent2`, at the nose. Uniform for all
    aircraft, always straight.
  - **Dotted trail:** starts after a gap ≈2× the dot gap; `width:2px; opacity:.7;`
    `background:repeating-linear-gradient(to top, var(--accent2) 0 4px, transparent 4px 11px)`
    (4px dash / 7px gap). Length scales with speed: `len = clamp(spd*0.26, 12, 84)` px;
    trail element `top: -(34 + len)px`, height `len`.
- **Safety highlight:** aircraft with an active `safety:event` get a severity-colored ring
  that both **pulses** (`ringpulse` 1.4s) and emits an expanding **ping** (`safeping` 1.6s),
  a matching glow, and a warning badge under the label. Their label is force-shown.
  Keyframes: `safeping { 0%{transform:translate(-50%,-50%) scale(.72);opacity:.85} 100%{…scale(1.95);opacity:0} }`.
- **Labels** (to the right of the blip). Two controls on the map: **Labels: auto ↔ All labels**
  (visibility) and **Full labels ↔ Minimal** (density):
  - *Full:* dark chip (`--bg1`-ish, `1px --bord`, `3px 7px`) — callsign (category color) /
    `{spd}kts · {altk}` (`--dim`) / `{type}` (`--dim2`).
  - *Minimal:* **minimally-opaque dark bg** `color-mix(in srgb,#05070a 55%,transparent)`, no
    border, `2px 6px`, subtle text-shadow; callsign light `#e9f1f8`, both data lines `--accent2`,
    slightly larger mono (14/13/13px).
  - Labels always show for selected, hovered, safety, or when "All labels" is on.
- **Detail panel (392px):** photo **header banner** (image with gradient scrim; overlay = US
  flag chip + callsign + category pill) → ID chips (hex / type·alt / size / reg) → operator →
  Alert buttons → **2×2 primary stat grid** (Altitude/GS/V-S/Distance with trend rows) →
  **MORE DETAILS** (track/squawk/RSSI/route — always expanded, not collapsible) → **Flight
  History** timeline → **Performance** sparkline cards → external links (FlightAware/ADSBx).
- **Theme switcher** (header segmented, 3 dots) sets `data-theme`.
- **Tweaks/props:** `accentTheme` (radar|slate|amber), `photoHeight`, `autoLabels`.
- **Realtime:** `subscribe{view:"map",bbox}` on mount; apply `aircraft:update/remove`;
  `aircraft:follow` on select; render `safety:event` rings; header from `gps:fix`.

### 2. Aircraft Detail (`Aircraft Detail.dc.html`)
Scrolling detail page. Identity bar (flag, callsign, Mode-S, type/operator chips, status pill,
Alert/Follow/Share/Close). 6-up **stat strip** (Altitude/GS/V-S/Track/Distance/Squawk with
trend sublines). Two-col body:
- Left (400px): **photo hero** (click → **lightbox**, `cursor:zoom-in`, "Enlarge" badge) →
  Aircraft Info (airframe + operator/registration rows) → **Flight Route** card (origin→dest,
  progress bar, DEP/ETA).
- Right: **Track & Position** — schematic street-map panel with the flight track polyline +
  rotated position marker + range ring; 3 mini graphs (Altitude/Speed/V-S) with a playback
  marker line; **transport controls** (restart/play-pause/skip, 0.5×–4× speed segmented,
  range scrubber `<input type=range>`, live clock). Then **Reception** (receiver list with
  signal bars + RSSI), **Transponder Log**, **Sighting History** (times *this station* saw the
  aircraft: callsign/route · age · peak dB · minutes tracked · closest range), **Safety Events**
  (severity icon + title + detail + sev pill + time), external links.
- **Realtime:** `subscribe{view:"detail",aircraftId}` → `aircraft:detail`; scrubber emits
  `playback:seek`; play advances a local timer between socket ticks.

### 3. Aircraft List (`Aircraft List.dc.html`)
Search + view toggles + Columns/Filters, a **filter-chip row** with live counts (Emergency,
Military, Climbing, Descending, On Ground, Interesting, High/Low Alt, Strong/Weak Signal), and
a **sortable table** (grid rows; click header to sort, arrow shows dir). Columns: ICAO,
Callsign, Type, Altitude (`ground` chip vs number), Speed, V/S (↑green/↓amber/—), Heading
(deg + compass chip), Distance, **Signal** (4 colored bars + wave icon), Squawk (emergency
codes red). Airborne rows get a category left-accent + brighter callsign; ground rows dimmed;
military rows show a shield. **Rows link to Aircraft Detail.** Footer: shown/total + legend.
Search/chips/sort filter live. **Realtime:** `aircraft:snapshot` then `aircraft:update/remove`.

### 4. History (`History.dc.html`)
Session browser. Time-range selector (1h…7d), 5 KPI cards, a 24h activity sparkline, section
tabs (Sessions/Sightings/ACARS/Safety/NOTAMs/PIREPs/Archive). Consolidated filter row (search
+ Category/Type/Airline selects + Military/Safety toggles) and a sort-chip row. Grid of
**session cards**: callsign + hex + type chip + duration badge; altitude gradient bar; signal
bars + dB; 4-metric grid (distance range, max V/S, msgs, squawks); first/last times. Safety
sessions get an amber accent + flag. Cards → Aircraft Detail. Non-Sessions tabs show a proper
empty state. Search/filters/sort all live (client-side over fetched history; use REST here).

### 5. Statistics (`Statistics.dc.html`)
Dense 3-rail analytics (live-feed rail | center | system/safety rail). Toolbar: time range +
Military-only + Filters. Left rail: Closest/Fastest/Highest lists + Squawk watchlist. Center:
3 KPI cards w/ sparklines (Traffic/Reception/System) → Altitude Distribution + Flight Categories
bars → Safety Events bars → **Antenna Analytics** (polar coverage polygon + Signal-vs-Distance
scatter with regression line) → **Historical Analytics** (tabs Trends/Top Performers/Distance/
Speed/Patterns; Trends = dual-line area chart, others = bar panels) → **Extended Analytics**
(tabs; Flight Patterns = Top Routes + Activity-by-Hour heatmap + Aircraft Types + Avg Duration;
other tabs = keyed list panels). Right rail: System Health gauges, Safety Events counters,
Connection, ACARS, Safety Monitor. All charts are hand-built inline SVG in the mock — copy the
point-math or swap for the codebase's chart lib (Recharts/visx) keeping identical colors/axes.
**Realtime:** `stats:tick`.

### 6. Radio (`Radio.dc.html`)
ATC transmission log. Stat strip (Total/Transcribed/Pending/Duration + Live). Filter row
(search + Status/Channel/Type selects + Emergency toggle + range + Auto). List of transmission
rows: round play button, channel + freq chip + type chip + (EMERGENCY badge), **flight-info
badge** when the callsign matches a tracked aircraft (`callsign · type · operator`, links to
Detail), one-line transcript, a **waveform** (thin bars), duration, Transcribed/Pending pill,
`MP3 · size`. Emergency rows tinted red. **Now-Playing bar** (bottom): play/pause, channel,
scrubbable waveform, clock, flight badge. **Realtime:** `radio:transmission` prepends,
`radio:transcript` fills pending; audio plays the row's clip URL.

### 7. System (`System.dc.html`)
Status banner **computed from services** (green "All Systems Operational" vs amber "Degraded
Performance · N of M online · X offline") with a per-service dot row + Refresh. **Health
gauges** (CPU/Memory/SDR Temp/Gain — value + progress bar + note). Card grid: **Services**
(expandable rows → uptime/latency/last-check; status chip color = severity), Real-time,
Database Stats, Notifications (+Test → toast+event), Safety Monitor (+Test), ACARS (+Start),
**Recent Events** (log; Test/Start/Copy prepend + toast), Feeder Location (mini map + coords +
Copy). Footer: API/Django/Python versions + Updated + connection. **Realtime:** `system:health`
drives gauges/services/banner; `system:event` prepends events.

### 8. Alerts (`Alerts.dc.html`)
Tabs Rules / History / Notifications + Import + **New Rule**. Rules tab: search + Priority +
Status selects; grid of **rule cards** (priority left-accent + icon, name, desc, mono condition
summary, trigger count, last-fired, edit button, **enable switch**). History tab: fired-alert
feed. Notifications tab: channel cards with switches (Browser/Audio/Webhook/Email).
**Create Alert Rule modal** (overlay, scrolls): 6 **Quick-Start Templates** (prefill),
Rule Name, **Priority** segmented (Info/Warning/Critical/Emergency), **Conditions** builder
(field/op/value rows, Add Condition), live "Matching N of 150" preview, Cooldown, Enabled,
global-notifications toggle, Cancel / Create. **Realtime:** `alert:fired` → History + nav badge
+ toast; modal Create emits `alert:create`; switches emit `alert:toggle`.

### 9. Cannonball (`Cannonball.dc.html`) — touch / in-car
Clean-sheet **car-headunit** "sky watch" mode; leans on aircraft tracking to warn of
law-enforcement air units overhead. Full mode: top bar (wordmark, trip timer, GPS/Sky link),
color-coded **threat strip** (CLEAR green / CAUTION amber / AIR-UNIT-ALERT red — drives accent,
scope highlight, nearest-unit panel), trip-stat cards, big **speedometer** (gauge ring + huge
mono number + LIMIT pill), **sky-scope** radar w/ sweep + blips, nearest-air-unit panel, and
86px touch buttons (**Drive Focus** / Alerts-mute / Mark / Scan). **Focus mode:** collapses to
a slim threat bar + a huge speed readout; tap anywhere to exit — the driving-safe view.
- **Layout note (real device fix):** target 480–600px landscape headunits. Constrain the
  content grid with `grid-template-rows:minmax(0,1fr)` + per-column `min-height:0;overflow:hidden`,
  size the gauge/scope by `vh`, and keep stat cards compact so nothing clips or overlaps the
  touch controls.
- Tweak/prop: `units` (mph|kmh).
- **Realtime:** speed/heading from the vehicle GPS/OBD; overhead threats from `aircraft:update`
  filtered to nearby low-altitude helicopters + operator/category = law-enforcement, surfaced
  via `safety:event`-style logic.

---

## Interactions & behavior (global)
- **Toasts:** small bottom-right pill, ~2s auto-dismiss, accent-bordered, checkmark icon
  (Test actions, Copy, Refresh, rule created). One per app, queue latest.
- **Switches:** 44×24 pill, 18px knob, `--accent` on / `--bord2` off, knob slides 3px↔23px.
- **Segmented controls / tabs:** active = tinted bg + full-color text/arrow; inactive `--dim`.
- **Hover:** cards/rows lift to `--bg2`; icon buttons gain `--bg2` bg + brighter icon; primary
  buttons keep gradient.
- **Selects:** custom-styled `<select>` (appearance:none), option bg `--bg2`.
- **Empty states:** centered icon + message + (optional) primary action — never a blank pane.
- **Animations:** `blink` (LIVE dots) 2s; `sweep` (radar) 8s linear; `ringpulse` 1.4–2.2s;
  `safeping` 1.6s; toast slide-in 0.2s. Respect `prefers-reduced-motion`.

## State management
Per-screen UI state (filters, search, sort, tab, modal open, selection, playback pos, theme)
is local/component state. Shared/live state (aircraft set, selected aircraft, safety events,
alert rules, system health, connection status) belongs in a store (Zustand/Redux/Pinia) fed by
the single Socket.IO client so every screen and the nav badges stay in sync. Persist `theme`
and `units`. Restore playback position where relevant.

## Assets
- **Fonts:** IBM Plex Sans + IBM Plex Mono (Google Fonts).
- **Icons:** all inline SVG in the mocks — copy the paths (or map to the codebase's icon set).
- **Imagery:** aircraft photos and the street/feeder maps are **striped placeholders** in the
  mocks — wire to the real photo provider (e.g. Planespotters) and a map source. No brand
  assets are included; use the codebase's own if any.

## Files
`designs/` contains the 9 screen prototypes + `support.js` (the DC runtime — **reference only,
do not port**):
- `SkySpy.dc.html` — Live Map (primary)
- `Aircraft Detail.dc.html`, `Aircraft List.dc.html`, `History.dc.html`,
  `Statistics.dc.html`, `Radio.dc.html`, `System.dc.html`, `Alerts.dc.html`, `Cannonball.dc.html`
Open each in a browser to inspect live styling, the exact SVG icon paths, chart math, and
interaction logic (the `<script data-dc-script>` class at the bottom of each file).
