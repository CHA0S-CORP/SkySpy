# SkySpy ADS-B Dashboard - Modular Structure

## Directory Structure

```
src/
├── App.jsx                    # Main application component (89 lines)
├── App.css                    # All styles
├── main.jsx                   # React entry point
│
├── utils/                     # Utility functions and constants
│   ├── index.js               # Barrel export
│   ├── constants.js           # Configuration, default values, lookup tables
│   ├── config.js              # Config storage helpers
│   ├── aircraft.js            # Aircraft helper functions (ICAO decode, etc)
│   ├── time.js                # Time conversion utilities
│   ├── alerts.js              # Alert severity utilities
│   └── decoders.js            # METAR and PIREP decoders
│
├── hooks/                     # Custom React hooks
│   ├── index.js               # Barrel export
│   ├── useSSE.js              # SSE connection for real-time updates
│   ├── useApi.js              # API fetch with polling
│   ├── useAudioAlarms.js      # TCAS-style audio alarm system
│   ├── useAviationData.js     # Aviation data fetching (NAVAIDs, METARs, etc)
│   ├── useConflictDetection.js # Proximity conflict detection
│   └── useDraggable.js        # Draggable panel functionality
│
└── components/                # React components
    ├── index.js               # Barrel export
    ├── Sidebar.jsx            # Navigation sidebar
    ├── Header.jsx             # Top header with stats
    ├── SettingsModal.jsx      # Settings dialog
    │
    ├── common/                # Shared UI components
    │   └── LoadingSpinner.jsx
    │
    ├── aircraft/              # Aircraft-related components
    │   ├── index.js
    │   ├── AircraftDetailPage.jsx  # Full aircraft detail view
    │   └── AircraftTable.jsx       # Sortable aircraft table
    │
    ├── alerts/                # Alert system components
    │   ├── index.js
    │   ├── AlertRuleForm.jsx  # Rule creation/editing form
    │   └── AlertRuleList.jsx  # List of configured rules
    │
    ├── views/                 # Main view components
    │   ├── index.js
    │   ├── AircraftList.jsx   # Aircraft list view
    │   ├── StatsView.jsx      # Statistics dashboard
    │   ├── HistoryView.jsx    # Flight history viewer
    │   ├── AlertsView.jsx     # Alert configuration
    │   └── SystemView.jsx     # System status/monitoring
    │
    └── map/                   # Map/radar components (formerly ~5000 lines)
        ├── index.js           # Barrel export
        ├── MapView.jsx        # Main map orchestrator
        ├── MapControls.jsx    # Zoom, fullscreen, toggles
        ├── AircraftPopup.jsx  # Selected aircraft info popup
        ├── AircraftListPanel.jsx  # Floating aircraft list
        ├── ConflictBanner.jsx # TCAS conflict alerts
        ├── SafetyEventsPanel.jsx  # Emergency events
        ├── FilterMenu.jsx     # Traffic filtering controls
        ├── OverlayMenu.jsx    # Aviation data overlays
        ├── LegendPanel.jsx    # Map legend
        ├── AcarsPanel.jsx     # ACARS/VDL2 messages
        └── WeatherPopups.jsx  # METAR/PIREP/NAVAID/Airport popups
```

## Component Architecture

### Main App (App.jsx - 89 lines)
Clean orchestration of views with tab-based navigation.

### MapView Subsystem
The map view has been fully decomposed from ~5000 lines into:

**Custom Hooks:**
- `useAudioAlarms` - Three-stage Web Audio alarm system
- `useAviationData` - Fetches NAVAIDs, airports, METARs, PIREPs
- `useConflictDetection` - TCAS-style proximity detection
- `useDraggable` - Generic panel drag functionality

**Sub-components:**
- `MapControls` - Control buttons and range slider
- `AircraftPopup` - Draggable aircraft info with external links
- `AircraftListPanel` - Searchable, sortable aircraft list
- `ConflictBanner` - Real-time conflict alerts with audio
- `SafetyEventsPanel` - Emergency squawk monitoring
- `FilterMenu` - Traffic type/altitude filtering
- `OverlayMenu` - Aviation data layer toggles
- `LegendPanel` - Map symbol legend
- `AcarsPanel` - ACARS/VDL2 message display
- `WeatherPopups` - METAR, PIREP, NAVAID, Airport popups

## Usage Examples

### Importing Utilities
```javascript
import { 
  getConfig, saveConfig,
  getTailInfo, getCategoryName,
  windDirToCardinal,
  decodeMetar, decodePirep 
} from './utils';
```

### Importing Hooks
```javascript
import { useSSE, useApi } from './hooks';
import { useAudioAlarms, useConflictDetection } from './hooks';
```

### Importing Components
```javascript
import { Sidebar, Header, SettingsModal } from './components';
import { MapView } from './components/map';
import { AircraftList, StatsView } from './components/views';
```

## Key Features

### Conflict Detection
- Three severity levels: Critical (<0.5nm), Warning (<1nm), Low (<2nm)
- Vertical separation factored in
- Browser notifications for new conflicts
- Audio alarms with mute control

### Audio Alarms
- Stage 1: Double ding (low severity)
- Stage 2: Rapid triple ding (warning)
- Stage 3: High-low siren (critical)
- Web Audio API synthesis

### Aircraft Markers
- Color-coded by altitude:
  - Cyan: >35,000ft
  - Green: 18,000-35,000ft
  - Yellow: 100-18,000ft
  - Gray: Ground
- Red: Emergency
- Purple: Military
- White: Selected

### Track History
- 5-minute retention
- 120 points maximum per aircraft
- Polyline trails on map

### Persistence
- All preferences saved to localStorage
- Filter settings, overlay toggles, panel positions

## Build Stats
- Production JS: ~420KB (121KB gzipped)
- Production CSS: ~110KB (22KB gzipped)
- 1296 modules transformed
