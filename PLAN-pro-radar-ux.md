# Pro Radar Mode UX Improvement Plan

## Current State Summary

The pro radar mode is a canvas-based rectangular radar display with:
- Linear cartesian coordinate mapping (vs polar for CRT mode)
- Cyan/blue color scheme on dark background
- GeoJSON terrain and aviation overlays (ARTCC, refueling tracks, etc.)
- Aircraft rendered as chevrons with data blocks
- Pan support via middle-mouse drag
- Range control (10-250nm)

---

## Proposed UX Improvements

### Phase 1: Enhanced Cursor Information & Interaction

#### 1.1 Cursor Position Readout
**Problem**: Users can't see coordinates/distance at cursor position
**Solution**: Add persistent cursor info overlay showing:
- Lat/Lon coordinates
- Distance from feeder (nm)
- Bearing from feeder (degrees)
- Display in bottom-left corner, updating in real-time

#### 1.2 Measurement Tool
**Problem**: No way to measure distances between arbitrary points
**Solution**: Shift+click to place measurement points:
- First click sets point A (marker appears)
- Second click sets point B (line drawn with distance label)
- ESC or third click clears measurement
- Show distance in nm and bearing

#### 1.3 Click-to-Center
**Problem**: Can only pan with middle mouse (not intuitive)
**Solution**: Double-click to center display on that location
- Smooth animated pan transition
- Works in conjunction with existing pan offset

---

### Phase 2: Aircraft Visualization Enhancements

#### 2.1 Altitude Trend Indicators
**Problem**: Vertical speed only visible in popup/data block
**Solution**: Add visual trend arrows on aircraft symbol:
- Up chevron (▲) for climbing > 500 fpm
- Down chevron (▼) for descending > 500 fpm
- Double chevrons for > 2000 fpm
- Color: Green (climbing) / Yellow (descending)

#### 2.2 Speed-Based Color Gradient
**Problem**: All civilian aircraft same color regardless of speed
**Solution**: Optional speed coloring mode:
- Slow (< 150 kts): Blue
- Medium (150-300 kts): Cyan (default)
- Fast (300-500 kts): Yellow
- Very fast (> 500 kts): Orange
- Toggle in settings or quick-key (S)

#### 2.3 Predicted Position Vector (PTL)
**Problem**: Velocity vector is short and hard to interpret
**Solution**: Extend prediction line showing:
- 30-second predicted position (dotted line)
- 60-second predicted position (fainter)
- Optional 2-minute lookahead for conflict analysis
- Toggle via keyboard shortcut (V)
- Configurable time intervals (30s/1m/2m/5m)

#### 2.4 Trail Enhancements
**Problem**: Trails are white-only, no altitude context
**Solution**: Altitude-colored trails option:
- Color gradient based on altitude at each point
- Low (< 10,000): Green
- Medium (10,000-30,000): Cyan
- High (> 30,000): Purple
- Shows climb/descent profile visually

---

### Phase 3: Safety & Conflict Visualization

#### 3.1 Closest Point of Approach (CPA) Display
**Problem**: Safety alerts shown but CPA not visualized
**Solution**: For aircraft pairs with proximity alerts:
- Draw line between current positions
- Show CPA point with X marker
- Display time to CPA
- Animate line pulsing for critical alerts

#### 3.2 Relative Altitude Labels
**Problem**: Must compare altitude numbers mentally
**Solution**: When two aircraft are in conflict:
- Show "+2500" or "-1000" relative altitude
- Position between the two aircraft
- Color-coded (red if < 1000ft separation)

#### 3.3 Conflict Wedge Visualization
**Problem**: Hard to see potential future conflicts
**Solution**: Draw semi-transparent wedge showing:
- Aircraft's projected path corridor (±5° heading uncertainty)
- Extends to 2-minute lookahead
- Highlights when wedges intersect between aircraft
- Toggle via keyboard shortcut (C)

#### 3.4 Conflict Probe (Look-Ahead)
**Problem**: Only see current conflicts, not developing ones
**Solution**: Predictive conflict detection:
- Analyze trajectories up to 5 minutes ahead
- Yellow warning for 2-5 minute conflicts
- Red alert for < 2 minute conflicts
- Display predicted conflict point on scope
- List view of all predicted conflicts with time-to-conflict

---

### Phase 4: Grid & Overlay Improvements

#### 4.1 Adaptive Grid Spacing
**Problem**: Grid spacing doesn't adapt to zoom level
**Solution**: Dynamic grid refinement:
- At 10nm range: 2nm minor lines, 5nm major lines
- At 50nm range: 10nm minor lines, 25nm major lines
- At 100nm range: 25nm minor lines, 50nm major lines
- Smooth transition when range changes

#### 4.2 Grid Opacity Control
**Problem**: Grid can obscure aircraft in dense areas
**Solution**: Add grid opacity slider (0-100%):
- Quick access in overlay menu
- Keyboard shortcut (G) to cycle: Full → Half → Off
- Remember preference in localStorage

#### 4.3 Compass Rose Toggle
**Problem**: No heading reference in pro mode (CRT has compass)
**Solution**: Optional compass rose overlay:
- Centered on feeder location
- Cardinal and intercardinal directions
- 10° tick marks
- Toggle via overlay menu

#### 4.4 Overlay Layer Controls
**Problem**: All-or-nothing overlay visibility
**Solution**: Individual layer toggles with opacity:
- ARTCC boundaries (separate toggle)
- Refueling tracks (separate toggle)
- Military zones (separate toggle)
- Water/coastlines (separate toggle)
- Each with 0-100% opacity slider

---

### Phase 5: Performance & Customization

#### 5.1 Color Theme Customization
**Problem**: Fixed cyan color scheme, no personalization
**Solution**: Theme selector with presets:
- **Classic Cyan** (current)
- **Amber/Gold** (traditional ATC style)
- **Green Phosphor** (retro terminal)
- **High Contrast** (accessibility)
- Custom: Primary/Secondary/Background color pickers

#### 5.2 Data Block Configuration
**Problem**: Fixed data block content, may show too much/little
**Solution**: Configurable data block fields:
- Callsign (always on)
- Altitude (toggle)
- Speed (toggle)
- Heading (toggle)
- Vertical speed (toggle)
- Aircraft type (toggle)
- Compact vs. expanded mode

#### 5.3 Performance Mode
**Problem**: Canvas rendering can lag with many aircraft
**Solution**: Auto-performance optimization:
- Reduce trail length when > 100 aircraft
- Simplify overlays when > 150 aircraft
- Skip velocity vectors when > 200 aircraft
- Show FPS counter (optional debug mode)

#### 5.4 Level of Detail (LOD)
**Problem**: Same detail level at all zoom levels
**Solution**: Automatic LOD based on range:
- Close range (< 25nm): Full detail, all labels
- Medium range (25-75nm): Reduced trail points
- Far range (> 75nm): Simplified symbols, fewer labels

---

### Phase 6: Keyboard Shortcuts & Quick Actions

#### 6.1 New Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `R` | Reset view (center on feeder, clear pan) |
| `V` | Toggle velocity vectors |
| `T` | Toggle trails |
| `G` | Cycle grid opacity |
| `C` | Toggle conflict visualization |
| `S` | Toggle speed coloring |
| `L` | Toggle labels/data blocks |
| `+/-` | Zoom in/out (range adjustment) |
| `1-5` | Quick range presets (10/25/50/100/250nm) |
| `Esc` | Clear measurement/selection |
| `J` | Toggle J-ring around selected aircraft |
| `W` | Toggle watch list panel |
| `A` | Toggle altitude filter panel |
| `N` | Add selected aircraft to watch list |
| `F` | Quick filter menu |
| `M` | Toggle MSAW warnings |
| `?` | Show keyboard shortcut help overlay |

#### 6.2 Quick Info Panel
**Problem**: Must click aircraft to see details
**Solution**: Hover info tooltip:
- Appears after 500ms hover delay
- Shows: Callsign, Type, Altitude, Speed, Origin/Dest
- Positioned near cursor, avoiding screen edges
- Disappears on mouse move

---

### Phase 7: Accessibility Improvements

#### 7.1 High Contrast Mode
**Problem**: Color-only differentiation excludes colorblind users
**Solution**: High contrast accessibility mode:
- Aircraft categories use shapes (not just colors):
  - Civilian: Triangle
  - Military: Diamond
  - Emergency: Circle with X
- Pattern fills instead of solid colors
- Increased text contrast (pure white on black)

#### 7.2 Screen Reader Support
**Problem**: Canvas content invisible to screen readers
**Solution**: Add ARIA live region:
- Announce new aircraft entering range
- Announce safety alerts
- Announce selected aircraft info
- Hidden visual element updated with current state

#### 7.3 Reduced Motion Mode
**Problem**: Animations may cause issues for some users
**Solution**: Respect `prefers-reduced-motion`:
- Disable sweep line animation
- Disable pulsing effects
- Use static indicators instead of flashing

---

### Phase 8: ATC-Style Tools (NEW)

#### 8.1 J-Rings (Range Rings)
**Problem**: Hard to judge distance from a specific aircraft
**Solution**: Concentric distance rings around selected aircraft:
- Toggle with `J` key when aircraft selected
- Configurable ring intervals (5nm, 10nm, 20nm)
- Rings follow aircraft as it moves
- Shows separation distance at a glance
- Optional: rings around feeder position as well

#### 8.2 Minimum Safe Altitude Warning (MSAW)
**Problem**: No terrain/altitude safety awareness
**Solution**: Visual and audible MSAW alerts:
- Compare aircraft altitude to terrain elevation data
- Yellow warning when within 1000ft of terrain
- Red alert when within 500ft of terrain
- Highlight affected aircraft with pulsing outline
- Optional terrain shading overlay
- Exclude aircraft in landing/takeoff phase near airports

#### 8.3 Altitude Filter Bands
**Problem**: Can't focus on specific altitude ranges
**Solution**: Selectable altitude filter with presets:
- Surface - 10,000ft (Low)
- 10,000 - 18,000ft (Transition)
- 18,000 - 29,000ft (High)
- 29,000 - 45,000ft (Upper)
- 45,000ft+ (Super High)
- Custom range slider (min/max FL)
- Filtered aircraft shown as dim outlines or hidden
- Quick toggle: Show All / Filter Active

#### 8.4 Wake Turbulence Categories
**Problem**: No awareness of wake turbulence hazards
**Solution**: Display wake category indicators:
- Super (A380, AN-225): `J` - Red
- Heavy (B747, B777, A340): `H` - Orange
- Large (B737, A320): `L` - Yellow
- Small (C172, PA28): `S` - Green
- Show required separation distances between pairs
- Alert when following aircraft too close to heavy

#### 8.5 Separation Tools
**Problem**: Can't easily verify separation standards
**Solution**: Visual separation aids:
- Draw line between any two aircraft on demand
- Show current separation (nm lateral, ft vertical)
- Color-coded: Green (adequate) / Yellow (marginal) / Red (violation)
- Display required minimum based on aircraft types and distance from radar
- Standard separation rules:
  - 3nm within 40nm of antenna
  - 5nm beyond 40nm
  - 1000ft vertical below FL290
  - 2000ft vertical at/above FL290 (RVSM)

---

### Phase 9: Watch List & Flight Strips (NEW)

#### 9.1 Watch List Panel
**Problem**: Can't track specific aircraft of interest
**Solution**: Persistent watch list sidebar:
- Add aircraft via right-click → "Add to Watch List" or `N` key
- Shows mini data block for each watched aircraft
- Visual indicator when watched aircraft enters/exits range
- Audio chime option for watch list events
- Highlight watched aircraft on scope with special marker
- Quick-jump: click watch list item to center on aircraft
- Persist watch list across sessions (localStorage)
- Import/export watch list (JSON)

#### 9.2 Flight Strip Display
**Problem**: No ATC-style strip view for organized tracking
**Solution**: Optional flight strip panel:
- Electronic flight strips showing:
  - Callsign / Squawk
  - Aircraft type / Wake category
  - Current altitude → Cleared altitude (if known)
  - Ground speed
  - Origin → Destination (if available)
  - Time in range
- Drag strips to reorder (manual sequencing)
- Color-code strips by status (normal/watched/emergency/conflict)
- Strip annotations/scratchpad per aircraft
- Auto-remove strips when aircraft exits range (configurable)

#### 9.3 Aircraft Scratchpad/Notes
**Problem**: Can't annotate aircraft with personal notes
**Solution**: Per-aircraft notes field:
- Right-click → "Add Note" or quick-key
- Notes persist for session (optionally saved to localStorage)
- Notes display in data block (abbreviated) and details panel (full)
- Use cases: "Possible go-around", "Check altitude", "VIP flight"

---

### Phase 10: Weather Integration (NEW)

#### 10.1 NEXRAD Weather Radar Overlay
**Problem**: No precipitation/weather context
**Solution**: Real-time weather radar layer:
- NEXRAD composite reflectivity overlay
- Color scale: Green (light) → Yellow → Red (heavy) → Purple (extreme)
- Configurable opacity (0-100%)
- Auto-refresh interval (5-15 minutes)
- Toggle via overlay menu or `X` key
- Data source: NOAA/NWS radar mosaic

#### 10.2 Convective SIGMET Display
**Problem**: No awareness of hazardous weather areas
**Solution**: Show active convective SIGMETs:
- Outlined polygons for convective activity
- Hatched areas for embedded thunderstorms
- Text overlay with SIGMET details on hover
- Link to full SIGMET text in panel

#### 10.3 METAR/TAF Integration
**Problem**: Airport weather only in separate panel
**Solution**: Inline airport weather indicators:
- Color-coded airport symbols by flight category:
  - VFR: Green
  - MVFR: Blue
  - IFR: Red
  - LIFR: Magenta
- Hover for quick METAR summary
- Wind barb display at airports
- Ceiling/visibility in hover tooltip

#### 10.4 Winds Aloft Overlay
**Problem**: No upper wind information
**Solution**: Optional winds aloft display:
- Wind barbs at configurable altitude levels
- Grid spacing adapts to zoom
- Color-coded by wind speed
- Toggle for specific altitude bands

---

### Phase 11: Arrival/Departure Tools (NEW)

#### 11.1 Airport Inbound/Outbound Lists
**Problem**: Can't easily see traffic flow for specific airports
**Solution**: Tabular arrival/departure lists:
- Select airport(s) to monitor
- Inbound list: Aircraft heading toward airport, sorted by ETA
- Outbound list: Recently departed aircraft, sorted by departure time
- Columns: Callsign, Type, Origin/Dest, Altitude, Distance, ETA
- Click row to select aircraft on scope
- Filter by time window (next 30min, 1hr, 2hr)

#### 11.2 ETA Calculations
**Problem**: No estimated time of arrival information
**Solution**: Display ETA to selected points:
- Click any point on map to see ETA from selected aircraft
- Show ETA to airports within range
- Factor in current ground speed and direct distance
- Display in aircraft details panel
- Optional: ETA to feeder position

#### 11.3 Holding Pattern Visualization
**Problem**: Can't see holding patterns
**Solution**: Display holding patterns when published:
- Draw racetrack pattern at holding fixes
- Show inbound course and turn direction
- Standard vs. non-standard pattern indication
- Highlight when aircraft is in holding

#### 11.4 Approach Path Visualization
**Problem**: No context for aircraft on approach
**Solution**: Show approach corridors:
- Extended runway centerlines
- ILS/localizer course lines
- Glideslope indicator (3° path)
- Final approach fix markers
- Toggle per-airport or globally

---

### Phase 12: Quick Filters & Search (NEW)

#### 12.1 Quick Filter Presets
**Problem**: Filtering requires multiple steps
**Solution**: One-click filter buttons:
- **Military Only**: Show only military aircraft
- **Emergencies**: Show only squawking 7500/7600/7700
- **Heavy/Super**: Show only wake category H/J
- **Low Altitude**: Show only aircraft below 10,000ft
- **Interesting**: Show military + government + law enforcement
- **Helicopters**: Show only rotorcraft
- **Jets Only**: Filter out props and turboprops
- Filters are additive (can combine multiple)
- Clear all filters button

#### 12.2 Enhanced Search
**Problem**: Search only matches exact text
**Solution**: Improved search capabilities:
- Fuzzy matching for typos
- Search by: callsign, registration, type, squawk, operator
- Autocomplete dropdown showing matches
- Recent searches history
- Regex support for power users
- Search highlighting on matching aircraft

#### 12.3 Aircraft Highlighting/Grouping
**Problem**: Can't visually group related aircraft
**Solution**: Custom highlighting rules:
- Define rules: "Highlight all Delta flights in blue"
- Grouping by operator, type, altitude band, etc.
- Named highlight groups with custom colors
- Toggle groups on/off independently
- Use for spotting same-type aircraft, airline traffic, etc.

---

### Phase 13: Historical Features (NEW)

#### 13.1 Track Playback
**Problem**: Can't review past traffic
**Solution**: Historical playback mode:
- Select time range to replay
- Playback controls: Play, Pause, Speed (1x, 2x, 4x, 8x)
- Scrub timeline to jump to specific time
- All aircraft shown at historical positions
- Toggle between live and playback mode
- Export playback as video (future enhancement)

#### 13.2 Heat Map Mode
**Problem**: No visualization of traffic patterns over time
**Solution**: Traffic density heat map:
- Aggregate position data over time period (1hr, 6hr, 24hr)
- Color gradient showing high-traffic areas
- Toggle between live traffic and heat map
- Useful for antenna optimization, coverage analysis

#### 13.3 Session Statistics
**Problem**: No summary of tracking session
**Solution**: Session stats panel:
- Total aircraft tracked
- Peak simultaneous aircraft
- Aircraft by category breakdown
- Busiest hours/times
- Most seen aircraft types
- Unique callsigns/registrations
- Coverage statistics (max range achieved)

---

### Phase 14: Multi-Scope & Advanced Display (NEW)

#### 14.1 Split/Multi-Scope View
**Problem**: Can't view multiple areas simultaneously
**Solution**: Multiple scope windows:
- Split screen: 2 or 4 independent scopes
- Each scope has own center point and range
- Sync option: same aircraft selection across scopes
- Use case: Local traffic + regional overview
- Detachable windows for multi-monitor setups

#### 14.2 Secondary Scope Modes
**Problem**: Only one display mode at a time
**Solution**: Picture-in-picture modes:
- Mini-map showing zoomed-out overview
- Selected aircraft zoomed view inset
- Position configurable (corner placement)
- Toggle with keyboard shortcut

#### 14.3 Data Tag Leader Lines
**Problem**: Data blocks can overlap or obscure aircraft
**Solution**: Adjustable data block positioning:
- Drag data blocks to reposition
- Leader line connects block to aircraft symbol
- Auto-deconfliction to prevent overlaps
- Reset to default positioning option
- Remember positions per aircraft (session)

---

## Implementation Priority

### Tier 1 - Foundation (High Impact, Core ATC Features)
1. Cursor position readout
2. Keyboard shortcuts (full set)
3. J-Rings around selected aircraft
4. Altitude filter bands
5. Quick filter presets
6. Watch list panel

### Tier 2 - Safety & Awareness
7. MSAW terrain warnings
8. Altitude trend indicators
9. Predicted position vectors (PTL)
10. Wake turbulence categories
11. CPA display for conflicts
12. Conflict probe (look-ahead)

### Tier 3 - Weather & Context
13. NEXRAD weather overlay
14. METAR/TAF airport indicators
15. Separation tools
16. Compass rose toggle
17. Adaptive grid spacing

### Tier 4 - Workflow Enhancement
18. Flight strip display
19. Aircraft scratchpad/notes
20. Arrival/departure lists
21. ETA calculations
22. Enhanced search with autocomplete

### Tier 5 - Polish & Advanced
23. Color theme customization
24. Data block configuration
25. Track playback
26. Multi-scope view
27. Heat map mode
28. Accessibility improvements

---

## Files to Modify

| File | Changes |
|------|---------|
| `MapView.jsx` | Cursor tracking, new render functions, keyboard handlers, J-rings, PTL |
| `MapControls.jsx` | New control buttons, overlay toggles |
| `ProSearchBar.jsx` | Quick filters, enhanced search |
| `ProDetailsPanel.jsx` | Scratchpad, ETA, wake category display |
| `pro-mode.css` | New overlay styles, theme variables, filter panel styles |
| `SettingsModal.jsx` | Theme customization, data block config, altitude bands |
| New: `useRadarSettings.js` | Hook for radar customization state |
| New: `useWatchList.js` | Hook for watch list management |
| New: `useAltitudeFilter.js` | Hook for altitude band filtering |
| New: `useWeatherOverlay.js` | Hook for NEXRAD/weather data |
| New: `WatchListPanel.jsx` | Watch list sidebar component |
| New: `FlightStripPanel.jsx` | Flight strip display component |
| New: `QuickFilterBar.jsx` | Quick filter buttons component |
| New: `ArrivalDepartureList.jsx` | Inbound/outbound traffic lists |
| New: `KeyboardShortcutHelp.jsx` | Shortcut overlay component |

---

## Data Requirements

### External APIs Needed
| Feature | Data Source | Update Frequency |
|---------|-------------|------------------|
| NEXRAD Weather | NOAA/NWS Radar Mosaic | 5-10 minutes |
| Terrain Elevation | SRTM/Mapbox Terrain | Static (cached) |
| Convective SIGMETs | aviationweather.gov | 15 minutes |
| Winds Aloft | NOAA GFS | 1 hour |
| Airport Procedures | FAA CIFP / Jeppesen | Monthly |

### Backend Enhancements
- Terrain elevation lookup endpoint for MSAW
- Historical track storage/retrieval API
- Session statistics aggregation
- Watch list persistence (user preferences)

---

## Summary

This plan transforms Pro Mode from a basic radar display into a comprehensive ATC-style monitoring system. Key themes:

1. **Situational Awareness**: J-rings, altitude filters, conflict probe, MSAW
2. **Weather Integration**: NEXRAD, METARs, SIGMETs for operational context
3. **Workflow Efficiency**: Watch lists, quick filters, keyboard shortcuts
4. **Safety Tools**: Wake turbulence, separation verification, terrain warnings
5. **Flexibility**: Customizable themes, data blocks, multi-scope views

The phased approach allows incremental delivery while building toward a professional-grade radar monitoring solution.
