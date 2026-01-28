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

#### 2.3 Predicted Position Vector
**Problem**: Velocity vector is short and hard to interpret
**Solution**: Extend prediction line showing:
- 30-second predicted position (dotted line)
- 60-second predicted position (fainter)
- Optional 2-minute lookahead for conflict analysis
- Toggle via keyboard shortcut (V)

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

## Implementation Priority

### High Priority (Phase 1-2)
1. Cursor position readout
2. Altitude trend indicators
3. Predicted position vectors
4. Keyboard shortcuts

### Medium Priority (Phase 3-4)
5. CPA display for conflicts
6. Adaptive grid spacing
7. Grid opacity control
8. Compass rose toggle

### Lower Priority (Phase 5-7)
9. Color theme customization
10. Data block configuration
11. Performance mode
12. Accessibility improvements

---

## Files to Modify

| File | Changes |
|------|---------|
| `MapView.jsx` | Cursor tracking, new render functions, keyboard handlers |
| `MapControls.jsx` | New control buttons, overlay toggles |
| `pro-mode.css` | New overlay styles, theme variables |
| `map.css` | Tooltip styles, measurement tool styles |
| `SettingsModal.jsx` | Theme customization, data block config |
| `constants.js` | Keyboard shortcut definitions |
| New: `useRadarSettings.js` | Hook for radar customization state |

---

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | Medium | None |
| Phase 2 | Medium | None |
| Phase 3 | High | Phase 2 |
| Phase 4 | Low | None |
| Phase 5 | Medium | None |
| Phase 6 | Low | Phases 1-5 |
| Phase 7 | Medium | Phase 5 |

Total: ~2-3 weeks of focused development
