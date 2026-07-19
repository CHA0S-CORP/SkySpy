# 21 — Deep Linking (URL Parameters)

SkySpy's dashboard is a single page that routes on the URL **hash**:

```
#<tab>?<key>=<value>&<key>=<value>
```

The tab picks the screen; the query params carry that screen's **navigable view
state** (search, filters, sort, active sub-tab, selected item, time range). Every
such param is deep-linkable: it survives reload, is shareable, and restores on
browser back/forward. Examples:

```
#map?selected=A0E2E5
#aircraft?filter=military&sort=dist&sortDir=asc
#stats?range=24h&mil=1
#history?data=acars&airline=UAL
#analytics?x=distance_nm&y=rssi
```

## How it works

- Routing core lives in `web/src/lib/hashRoute.js` (`parseHash`, `buildHash`,
  `getHashParams`, `setHashParams`, `navigate`). `App.jsx` uses it for top-level
  tab routing.
- Screens read/write a single param with the `useHashParamState(key, default,
  opts)` hook (`web/src/hooks/useHashParamState.js`). **The URL is the source of
  truth** — the hook subscribes to `hashchange`, so no props need threading from
  `App`.
- A param is **omitted** when it equals its default, keeping URLs clean.
- **History behavior**: in-screen filter/search/sort changes use
  `history.replaceState` (no new history entry, so Back isn't spammed);
  tab/selection changes push a new entry (Back undoes them).
- Booleans serialize as `=1` (absent = false). Lists are comma-separated.

Adding a new deep-linked param to a screen is one line:

```js
const [range, setRange] = useHashParamState('range', '24h');
const [mil, setMil] = useHashParamState('mil', false, boolParam);
const [hexes, setHexes] = useHashParamState('filter', [], csvParam);
```

## Reference

Values below are the common/enumerated options; anything else is free text.

### `#map` — Live Map
| Param | Meaning | Example |
|---|---|---|
| `selected` | ICAO hex to highlight/open | `selected=A0E2E5` |
| `filter` | comma list of hex/callsign to show | `filter=A0E2E5,AE1234` |
| `rf` | rich radar-filter spec (JSON; usually assistant-generated) | `rf=%7B…%7D` |
| `labelMode` | label density: `auto` \| `all` \| `none` | `labelMode=all` |
| `toolPanel` | open toolbar panel: `filters` \| `layers` \| `legend` | `toolPanel=layers` |
| `legacy` | `1` forces the legacy MapView | `legacy=1` |

### `#aircraft` — Aircraft List
| Param | Meaning | Example |
|---|---|---|
| `q` | search text | `q=UAL` |
| `filter` | chip filter: `emergency`,`military`,`climbing`,`descending`,`ground`,`interesting`,`highalt`,`lowalt`,`strong`,`weak` | `filter=military` |
| `sort` | column: `dist`,`alt`,`spd`,`callsign`,… | `sort=alt` |
| `sortDir` | `asc` \| `desc` | `sortDir=desc` |
| `ghosts` | `1` shows non-ICAO tracks | `ghosts=1` |

### `#stats` — Statistics
| Param | Meaning | Example |
|---|---|---|
| `range` | `1h` \| `6h` \| `24h` \| `48h` \| `7d` | `range=24h` |
| `mil` | `1` = military only | `mil=1` |
| `histTab` | historical sub-tab: `Trends`,`Top Performers`,`Distance`,`Duration`,`Patterns` | `histTab=Distance` |

### `#analytics` — Advanced Analytics
| Param | Meaning | Example |
|---|---|---|
| `range` | time window (as above) | `range=48h` |
| `x` / `y` | scatter axis fields (`distance_nm`,`rssi`,…) | `x=distance_nm&y=rssi` |
| `mil` | `all` \| `civ` \| `mil` | `mil=mil` |

### `#airframes` — Airframe Library
| Param | Meaning | Example |
|---|---|---|
| `q` | search text | `q=A320` |
| `cat` | category: `airliner`,`regional`,`bizjet`,`turboprop`,`ga`,`military`,`rotor` | `cat=rotor` |
| `seen` | recency window: `1h`,`12h`,`24h`,`7d`,`all` | `seen=24h` |
| `sel` | open a type card by its ICAO type id | `sel=A320` |

### `#history` — History (default sub-tab `sessions`)
| Param | Meaning | Example |
|---|---|---|
| `data` | sub-tab: `sessions`,`sightings`,`acars`,`safety`,`notams`,`pireps`,`archive` (legacy `#notams`/`#pireps`/`#archive` fold in) | `data=acars` |
| `range` | time window | `range=24h` |
| `q` | search text | `q=N123` |
| `cat` / `type` / `airline` | filters | `airline=UAL` |
| `mil` / `safe` | `1` = military-only / safety-only | `mil=1` |
| `sort` / `sortDir` | sort column + direction | `sort=time&sortDir=desc` |
| `icao` | archive-tab aircraft filter (hex) | `icao=A0E2E5` |

### `#audio` — Radio / ACARS audio
| Param | Meaning | Example |
|---|---|---|
| `q` | search text | `q=tower` |
| `status` / `channel` | filters | `channel=Ground` |
| `emergency` | `1` = emergency only | `emergency=1` |
| `range` | time window | `range=6h` |

### `#alerts` — Alerts
| Param | Meaning | Example |
|---|---|---|
| `tab` | sub-tab: `rules`,`inbox`,`history`,`notif` | `tab=inbox` |
| `q` | rule search | `q=squawk` |
| `priority` | `all`,`info`,`warning`,`critical`,`emergency` | `priority=critical` |
| `status` | `all`,`enabled`,`disabled` | `status=enabled` |

### Detail / identity routes
| Route | Param(s) | Notes |
|---|---|---|
| `#airframe` | `icao=HEX` \| `call=CALLSIGN` \| `tail=REGISTRATION` | any identifier form resolves to the aircraft |
| `#event` | `id` | safety event detail |
| `#notam` | `id` | NOTAM detail |
| `#assistant` | `session` | chat session id |

## The assistant knows these

The LLM assistant's system prompt (`services/assistant/agent.py`, LINKING /
DEEP LINKS section) documents these routes so answers can hand the user a
clickable link to a pre-filtered view. Bare ICAO hex / callsigns / N-numbers in
its text are auto-linked by `remarkLinkifyEntities.js`. For a **live** category
view the assistant calls the `radar_filter` tool (which also filters the on-screen
radar) rather than hand-writing a `#map?filter=` link.
