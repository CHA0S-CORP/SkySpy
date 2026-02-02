---
title: Frontend Architecture
slug: frontend
category:
  uri: components
position: 2
privacy:
  view: public
---

# ⚛️ SkySpy Frontend Architecture

> **Premium React application for real-time aircraft tracking and monitoring**

![React](https://img.shields.io/badge/React-18+-61DAFB?style=for-the-badge&logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5+-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9+-199900?style=for-the-badge&logo=leaflet&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-Real--time-FF6B6B?style=for-the-badge&logo=socket.io&logoColor=white)

---

## 🎯 Overview

The SkySpy frontend is a **modern React application** built with Vite, delivering a real-time aircraft tracking and monitoring dashboard. Features include a modular component architecture, Socket.IO-based real-time data streaming, and responsive design for desktop and mobile.

> 📸 **Screenshot Placeholder**
> ![Main Dashboard](screenshots/dashboard-overview.png)
> *The main dashboard showing live aircraft tracking with real-time updates*

---

## 🛠️ Technology Stack

| Technology | Purpose | Badge |
|:----------:|:--------|:-----:|
| ⚛️ **React 18+** | UI framework with hooks-based architecture | ![React](https://img.shields.io/badge/-React-61DAFB?logo=react&logoColor=black) |
| ⚡ **Vite** | Lightning-fast build tool and dev server | ![Vite](https://img.shields.io/badge/-Vite-646CFF?logo=vite&logoColor=white) |
| 🗺️ **Leaflet** | Interactive map rendering | ![Leaflet](https://img.shields.io/badge/-Leaflet-199900?logo=leaflet&logoColor=white) |
| 🔌 **Socket.IO** | Real-time data streaming | ![Socket.IO](https://img.shields.io/badge/-Socket.IO-010101?logo=socket.io&logoColor=white) |
| 🎨 **CSS3** | Custom styling with CSS variables | ![CSS3](https://img.shields.io/badge/-CSS3-1572B6?logo=css3&logoColor=white) |
| 🔷 **Lucide** | Icon library | ![Lucide](https://img.shields.io/badge/-Lucide-F56565?logo=lucide&logoColor=white) |

---

## 📁 Directory Structure

```
web/src/
├── 📄 App.jsx                    # 🚀 Main application entry point
│
├── 📂 components/                # React components by feature
│   ├── 🛩️ aircraft/             # Aircraft detail components
│   ├── 📋 aircraft-list/        # Aircraft list view
│   ├── 🔔 alerts/               # Alert rule management
│   ├── 📦 archive/              # Historical data archive
│   ├── 🎵 audio/                # Radio transmission playback
│   ├── 🔐 auth/                 # Authentication components
│   ├── 🎯 cannonball/           # Mobile proximity mode
│   ├── 🧩 common/               # Shared components
│   ├── 🏆 gamification/         # Achievement system
│   ├── 📜 history/              # Historical views
│   ├── 📐 layout/               # Layout (Sidebar, Header)
│   ├── 🗺️ map/                  # Map view and overlays
│   ├── 📋 notams/               # NOTAM display
│   ├── ⚠️ safety/               # Safety event components
│   └── 👁️ views/                # Main view containers
│
├── 📂 contexts/                  # React context providers
│   └── 🔑 AuthContext.jsx       # Auth state management
│
├── 📂 hooks/                     # Custom React hooks
│   ├── 📡 channels/             # Socket.IO handlers
│   └── ℹ️ aircraftInfo/         # Data fetching utilities
│
├── 📂 styles/                    # CSS stylesheets
└── 📂 utils/                     # Utility functions
```

---

## 🏗️ Application Architecture

### Main Application Flow

The application uses **hash-based routing** for view navigation. `App.jsx` serves as the central orchestrator:

```mermaid
flowchart TB
    subgraph App["🚀 App.jsx"]
        Nav["📍 Navigation State"]
        WS["🔌 Socket.IO Connections"]
        Config["⚙️ Global Configuration"]
        Auth["🔐 Authentication"]
    end

    subgraph Routes["🛣️ Hash Routes"]
        Map["#map"]
        Aircraft["#aircraft"]
        Airframe["#airframe?icao=ABC123"]
        Event["#event?id=42"]
    end

    App --> Routes
```

> 💡 **Tip**
> Hash routing enables deep linking and browser history support without server-side routing configuration.

### 🗺️ Valid Navigation Tabs

| Tab | Icon | Description |
|:----|:----:|:------------|
| `map` | 🗺️ | Live aircraft map *(default)* |
| `aircraft` | ✈️ | Sortable aircraft list |
| `stats` | 📊 | Statistics dashboard |
| `history` | 📜 | Historical data (sessions, sightings, ACARS, safety) |
| `audio` | 🎵 | Radio transmission archive |
| `notams` | 📋 | NOTAMs display |
| `archive` | 📦 | Data archive browser |
| `alerts` | 🔔 | Alert rule management |
| `system` | ⚙️ | System status and configuration |
| `airframe` | 🛩️ | Aircraft detail page |
| `event` | ⚠️ | Safety event detail page |

---

## 🧩 Component Hierarchy

### 🏠 Layout Architecture

```mermaid
graph TB
    subgraph App["⚛️ App"]
        subgraph Sidebar["📱 Sidebar"]
            Logo["🔷 Logo"]
            NavTabs["📍 Navigation"]
            ExtLinks["🔗 External Links"]
            ConnStatus["🟢 Connection Status"]
        end

        subgraph Header["🎯 Header"]
            Stats["📊 Stats Display"]
            Location["📍 Location Info"]
            Users["👥 Online Users"]
        end

        subgraph Main["📄 Main Content"]
            ActiveView["🖼️ Active View Component"]
        end
    end

    Sidebar --> Main
    Header --> Main
```

### 🗺️ Map View Components

> 📸 **Screenshot Placeholder**
> ![Map View](screenshots/map-view.png)
> *Interactive map with aircraft tracking, safety events, and ACARS panel*

```mermaid
graph TB
    subgraph MapView["🗺️ MapView.jsx"]
        Leaflet["🌍 Leaflet Map"]

        subgraph Panels["📊 Panels"]
            ListPanel["📋 AircraftListPanel"]
            SafetyPanel["⚠️ SafetyEventsPanel"]
            AcarsPanel["📡 AcarsPanel"]
        end

        subgraph Controls["🎛️ Controls"]
            MapCtrl["🔧 MapControls"]
            Filter["🔍 FilterMenu"]
            Overlay["📂 OverlayMenu"]
            Legend["📖 LegendPanel"]
        end

        subgraph Overlays["🎨 Overlays"]
            Popup["💬 AircraftPopup"]
            Banner["🚨 ConflictBanner"]
        end
    end
```

#### 🎨 Map Display Modes

| Mode | Description | Preview |
|:-----|:------------|:-------:|
| `radar` | Traditional radar display with sweep animation | 🟢 |
| `crt` | Retro CRT-style phosphor display | 🟡 |
| `pro` | Professional ATC-style with customizable themes | 🔵 |
| `map` | Standard map with satellite/terrain options | 🟠 |

**Pro Mode Theme Colors:**
- 🔵 **Classic Cyan** — Default professional look
- 🟡 **Amber/Gold** — Traditional ATC aesthetic
- 🟢 **Green Phosphor** — Retro terminal style
- ⚪ **High Contrast** — Accessibility optimized

---

### 🛩️ Aircraft Detail Components

```mermaid
graph TB
    subgraph AircraftDetailPage["🛩️ AircraftDetailPage"]
        Header["📝 AircraftHeader"]
        Photo["📷 AircraftPhotoHero"]

        subgraph Tabs["📑 Tab Navigation"]
            Info["ℹ️ InfoTab"]
            Live["📡 LiveTab"]
            Radio["📻 RadioTab"]
            Acars["📨 AcarsTab"]
            Safety["⚠️ SafetyTab"]
            History["📜 HistoryTab"]
            Track["🛤️ TrackTab"]
        end
    end

    Header --> Tabs
    Photo --> Tabs
```

> ⚡ **Performance**
> All tabs are **lazy-loaded** using `React.lazy()` for optimal initial load performance.

---

### 🔔 Alerts System Components

```mermaid
graph TB
    subgraph AlertsView["🔔 AlertsView"]
        Toolbar["🔧 AlertsFilterToolbar"]

        subgraph Rules["📜 Rules"]
            RuleCard["🎴 AlertRuleCard"]
            RuleForm["📝 RuleForm"]
        end

        subgraph RuleFormParts["📝 Rule Form Components"]
            Conditions["🔀 ConditionBuilder"]
            Preview["👁️ LivePreview"]
            Channels["📢 NotificationChannelSelector"]
            Templates["📋 RuleTemplates"]
        end

        subgraph History["📜 Alert History"]
            HistToolbar["🔧 AlertHistoryToolbar"]
            HistItem["📄 AlertHistoryItem"]
        end

        TestModal["🧪 TestRuleModal"]
        ImportModal["📥 ImportRulesModal"]
    end
```

#### 🎯 Alert Condition Types

> ℹ️ **Supported Alert Conditions**
> Create complex rules using AND/OR logic with these condition types:

| Category | Conditions |
|:---------|:-----------|
| **🔢 Identifiers** | ICAO hex, Callsign pattern, Squawk code, Aircraft type |
| **📏 Telemetry** | Altitude thresholds, Speed thresholds, Distance proximity |
| **🏷️ Classification** | Military aircraft, Emergency status, Law enforcement, Helicopter |
| **📱 Mobile** | Proximity detection (Cannonball mode) |

---

### 📊 Stats Dashboard Layout

> 📸 **Screenshot Placeholder**
> ![Stats Dashboard](screenshots/stats-dashboard.png)
> *Bento grid layout with live data, charts, and system status*

```mermaid
graph LR
    subgraph StatsView["📊 StatsView - Bento Grid"]
        subgraph Left["📋 Left Column"]
            Leaderboard["🏆 LeaderboardCard"]
            Squawk["📡 SquawkWatchlist"]
        end

        subgraph Center["📈 Center Column"]
            KPI["📊 KPI Cards"]
            Sparkline["📈 LiveSparklines"]
            Bar["📊 HorizontalBarChart"]
            Acars["📨 AcarsSection"]
            Antenna["📡 Antenna Analytics"]
        end

        subgraph Right["⚙️ Right Column"]
            System["💻 SystemStatusCard"]
            Safety["⚠️ SafetyAlertsSummary"]
            Conn["🔌 ConnectionStatusCard"]
        end
    end
```

---

### 🎯 Cannonball Mode (Mobile)

> 📸 **Screenshot Placeholder**
> ![Cannonball Mode](screenshots/cannonball-mode.png)
> *Fullscreen mobile proximity detection with HUD overlay*

A **fullscreen mobile-optimized mode** for proximity-based aircraft detection:

| Component | Purpose | Icon |
|:----------|:--------|:----:|
| `CannonballMode.jsx` | Main container | 🎯 |
| `HeadsUpDisplay.jsx` | HUD-style overlay | 🎮 |
| `RadarView.jsx` | Radar-style display | 📡 |
| `ThreatDisplay.jsx` | Proximity threat cards | ⚠️ |
| `ThreatList.jsx` | Sorted threat list | 📋 |
| `StatusBar.jsx` | GPS and connection status | 📍 |
| `EdgeIndicators.jsx` | Off-screen aircraft indicators | ↗️ |

---

## 🔄 State Management

### State Flow Diagram

```mermaid
flowchart TB
    subgraph Sources["📡 Data Sources"]
        WS1["🔌 Main Socket.IO"]
        WS2["🔌 Position Socket.IO"]
        API["🌐 REST API"]
        LS["💾 localStorage"]
    end

    subgraph State["⚛️ React State"]
        Context["🔑 AuthContext"]
        Local["📍 Local State"]
        Ref["🔗 useRef"]
    end

    subgraph UI["🖼️ UI Components"]
        Views["👁️ Views"]
        Map["🗺️ Map"]
        Lists["📋 Lists"]
    end

    WS1 -->|"aircraft, safety, alerts"| Local
    WS2 -->|"positions (60fps)"| Ref
    API -->|"fetch"| Local
    LS -->|"config"| Context

    Context --> Views
    Local --> Views
    Ref --> Map
```

### 🔑 AuthContext API

```javascript
const {
  // 📊 State
  status,           // 'loading' | 'anonymous' | 'authenticated'
  user,             // User object with permissions
  config,           // Auth configuration
  error,            // Last auth error
  isAuthenticated,  // Boolean shorthand

  // 🔧 Methods
  login,            // Username/password login
  logout,           // Clear session
  loginWithOIDC,    // OAuth/OIDC popup flow
  authFetch,        // Authenticated fetch wrapper
  hasPermission,    // Check single permission
  hasAnyPermission, // Check any of the permissions
  hasAllPermissions,// Check all permissions
  canAccessFeature, // Feature-based access check
  getAccessToken,   // Get JWT for Socket.IO
} = useAuth();
```

### 🔌 Socket.IO State

```mermaid
sequenceDiagram
    participant B as 🖥️ Backend
    participant M as 📡 Main Socket
    participant P as 📍 Position Socket
    participant R as ⚛️ React

    B->>M: aircraft:snapshot
    M->>R: setState(aircraft)

    B->>M: safety:event
    M->>R: setState(events)

    B->>P: position:update (1Hz)
    P->>R: positionsRef.current = positions
    Note over R: No re-render! 🚀
```

### 💾 localStorage Keys

| Key | Purpose | Icon |
|:----|:--------|:----:|
| `adsb-dashboard-config` | Map mode, dark mode, notifications | ⚙️ |
| `adsb-dashboard-overlays` | Map overlay visibility | 🗺️ |
| `adsb-layer-opacities` | Overlay opacity settings | 🎨 |
| `adsb-show-aircraft-list` | List panel visibility | 📋 |
| `adsb-show-short-tracks` | Track trail display | 🛤️ |
| `adsb-sound-muted` | Sound preferences | 🔇 |
| `skyspy-auth-tokens` | JWT access/refresh tokens | 🔑 |
| `skyspy-user` | Cached user profile | 👤 |

---

## 🪝 Custom Hooks Reference

### 📡 Data Hooks

| Hook | Purpose | Example |
|:-----|:--------|:--------|
| `useApi` | HTTP API calls with loading/error states | `const { data, loading, error } = useApi('/api/stats')` |
| `useSocketApi` | HTTP with Socket.IO fallback | `useSocketApi('/api/aircraft', wsData)` |
| `useAircraftInfo` | Aircraft registry lookups with caching | `const info = useAircraftInfo(icao)` |
| `useAviationData` | Aviation reference data (airports, VORs) | `const { airports } = useAviationData()` |
| `useAlertRules` | Alert rule CRUD operations | `const { rules, createRule } = useAlertRules()` |
| `useStatsData` | Statistics data aggregation | `const stats = useStatsData(timeRange)` |

### 🔌 Socket.IO Hooks

```javascript
// 📡 Main channels socket
const { aircraft, safetyEvents, acarsMessages } = useChannelsSocket();

// 📍 High-frequency position updates (ref-based)
const positionsRef = usePositionChannels();

// 🎵 Audio streaming
const { transmissions, isConnected } = useAudioSocket();
```

### 🗺️ Map Hooks

| Hook | Purpose | Returns |
|:-----|:--------|:--------|
| `useTrackHistory` | Aircraft track trail management | `{ tracks, addTrack, clearTracks }` |
| `useMapAlarms` | Proximity and alert sound triggers | `{ playAlarm, stopAlarm }` |
| `useSafetyEvents` | Safety event state management | `{ events, activeEvent }` |
| `useGestures` | Touch gesture handling | `{ onPinch, onPan }` |
| `useDraggable` | Drag interaction for panels | `{ position, handlers }` |

### 🎯 Cannonball Mode Hooks

```javascript
// 📍 GPS tracking
const { position, accuracy, error } = useDeviceGPS();

// ⚠️ Threat calculation
const threats = useThreatCalculation(aircraft, position);

// 🔊 Voice alerts
const { speak, isSpeaking } = useVoiceAlerts();

// 📳 Haptic feedback
const { vibrate } = useHapticFeedback();

// 🔒 Screen wake lock
const { requestWakeLock, releaseWakeLock } = useWakeLock();
```

---

## 🔧 Utility Functions

### ✈️ Aircraft Utilities

```javascript
import {
  icaoToNNumber,
  getCountryFromIcao,
  getTailNumber,
  getCategoryName,
  callsignsMatch,
  getPirepType
} from '@/utils/aircraft';

// 🔢 ICAO to N-number conversion
icaoToNNumber('A1B2C3');      // → "N12345"

// 🌍 Country identification
getCountryFromIcao('A1B2C3'); // → { country: 'USA', flag: '🇺🇸' }

// 📋 Category names
getCategoryName('A1');        // → "Light"

// 🔀 Callsign matching (IATA/ICAO)
callsignsMatch('AAL123', 'AA123'); // → true
```

### 🔔 Alert Evaluation

```javascript
import {
  evaluateCondition,
  evaluateConditionGroup,
  evaluateRule,
  findMatchingAircraft,
  getMatchReasons
} from '@/utils/alertEvaluator';

// ✅ Single condition evaluation
evaluateCondition(condition, aircraft, distanceNm);

// 🔀 Group evaluation with AND/OR logic
evaluateConditionGroup(group, aircraft, distanceNm);

// 📋 Find all matching aircraft
const matches = findMatchingAircraft(rule, aircraftList, feederLocation);

// 💬 Human-readable match reasons
const reasons = getMatchReasons(rule, aircraft, distanceNm);
// → ["Squawk 7700 (Emergency)", "Altitude below 1000ft"]
```

---

## 🎨 Styling Architecture

### 📁 CSS File Organization

```
styles/
├── 📄 index.css              # 🚀 Main entry, imports all
├── 📄 base.css               # 🎨 Variables, reset, typography
├── 📄 layout.css             # 📐 Layout grid and containers
├── 📄 components.css         # 🧩 Shared component styles
├── 📄 map.css                # 🗺️ Map-specific styles
├── 📄 pro-mode.css           # 📡 Pro radar mode
├── 📄 views.css              # 👁️ View-specific styles
├── 📄 aircraft-detail.css    # 🛩️ Aircraft detail page
├── 📄 stats-extended.css     # 📊 Statistics dashboard
├── 📄 cannonball.css         # 🎯 Cannonball mode
├── 📄 acars.css              # 📨 ACARS messages
├── 📄 auth.css               # 🔐 Authentication forms
├── 📄 toast.css              # 🔔 Toast notifications
├── 📄 visualizations.css     # 📈 Charts and graphs
└── 📄 responsive.css         # 📱 Mobile breakpoints
```

### 🎨 CSS Variables Reference

```css
:root {
  /* 🎨 Colors */
  --bg-primary: #0a0d12;      /* Main background */
  --bg-secondary: #141922;    /* Card background */
  --text-primary: #e5e5e5;    /* Main text */
  --text-secondary: #9ca3af;  /* Muted text */

  /* 🌈 Accent Colors */
  --accent-cyan: #00c8ff;     /* Primary accent */
  --accent-green: #10b981;    /* Success states */
  --accent-red: #ef4444;      /* Error/danger */
  --accent-yellow: #f59e0b;   /* Warning states */

  /* 📏 Spacing Scale */
  --spacing-xs: 0.25rem;      /* 4px */
  --spacing-sm: 0.5rem;       /* 8px */
  --spacing-md: 1rem;         /* 16px */
  --spacing-lg: 1.5rem;       /* 24px */
  --spacing-xl: 2rem;         /* 32px */

  /* 🔤 Typography */
  --font-mono: 'JetBrains Mono', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  /* ⚡ Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
}
```

#### 🎨 Color Palette Visual

| Variable | Color | Usage |
|:---------|:-----:|:------|
| `--bg-primary` | ![#0a0d12](https://via.placeholder.com/20/0a0d12/0a0d12.png) `#0a0d12` | Main background |
| `--bg-secondary` | ![#141922](https://via.placeholder.com/20/141922/141922.png) `#141922` | Card background |
| `--accent-cyan` | ![#00c8ff](https://via.placeholder.com/20/00c8ff/00c8ff.png) `#00c8ff` | Primary accent |
| `--accent-green` | ![#10b981](https://via.placeholder.com/20/10b981/10b981.png) `#10b981` | Success states |
| `--accent-red` | ![#ef4444](https://via.placeholder.com/20/ef4444/ef4444.png) `#ef4444` | Error/danger |
| `--accent-yellow` | ![#f59e0b](https://via.placeholder.com/20/f59e0b/f59e0b.png) `#f59e0b` | Warnings |

### 📱 Responsive Breakpoints

```mermaid
graph LR
    subgraph Breakpoints["📱 Responsive Breakpoints"]
        Mobile["📱 Mobile<br/>≤768px"]
        Tablet["📱 Tablet<br/>769-1024px"]
        Desktop["💻 Desktop<br/>1025-1439px"]
        Large["🖥️ Large<br/>≥1440px"]
    end

    Mobile --> Tablet --> Desktop --> Large
```

---

## 🏗️ Build and Development

### ⚡ Vite Configuration

```javascript
// vite.config.js
export default defineConfig({
  plugins: [react()],
  base: '/static/',           // 🗂️ Django static path
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: apiTarget.replace('http', 'ws'),
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
```

### 🛠️ Development Commands

```bash
# 📦 Install dependencies
npm install

# 🚀 Start development server
npm run dev

# 🏗️ Build for production
npm run build

# 👁️ Preview production build
npm run preview

# 🔍 Lint code
npm run lint
```

### 🌍 Environment Variables

| Variable | Purpose | Default |
|:---------|:--------|:--------|
| `VITE_API_TARGET` | Backend API URL for dev proxy | `http://localhost:8000` |

> 📝 **Note**
> In production, the frontend is served by Django using relative URLs. `VITE_API_TARGET` is only used for the Vite dev server proxy.

---

## ⚡ Performance Optimization

> ✅ **Performance Tips**
> SkySpy is optimized for real-time data at 60fps. Here's how:

### 🚀 Virtual Scrolling

Large lists use the `VirtualList` component to render **only visible items**, enabling smooth scrolling with thousands of aircraft.

### 🧠 Memoization

```javascript
// ✅ Expensive computations memoized
const filteredAircraft = useMemo(() => {
  return aircraft
    .filter(a => matchesFilters(a, filters))
    .sort((a, b) => sortComparator(a, b, sortField));
}, [aircraft, filters, sortField]);
```

### 🔗 Ref-Based State for High-Frequency Data

```javascript
// 🚀 Positions in ref = no React re-renders!
const positionsRef = useRef({});

// Animation loop reads directly from ref
requestAnimationFrame(() => {
  const positions = positionsRef.current;
  // Update map markers at 60fps
  // Zero React overhead! ⚡
});
```

### ⏱️ Debounced Updates

Search and filter inputs are **debounced** to prevent excessive re-renders during typing.

### 📦 Lazy Loading

```javascript
// 📦 Components loaded on-demand
const InfoTab = lazy(() => import('./tabs/InfoTab'));
const LiveTab = lazy(() => import('./tabs/LiveTab'));
const RadioTab = lazy(() => import('./tabs/RadioTab'));
const AcarsTab = lazy(() => import('./tabs/AcarsTab'));
const SafetyTab = lazy(() => import('./tabs/SafetyTab'));
const HistoryTab = lazy(() => import('./tabs/HistoryTab'));
const TrackTab = lazy(() => import('./tabs/TrackTab'));
```

### 🛡️ Error Boundaries

```jsx
// 🛡️ Prevents cascading failures
<ErrorBoundary
  onRetry={retry}
  fallback={<ErrorFallback />}
>
  {renderTabContent()}
</ErrorBoundary>
```

---

## 🔐 Authentication Integration

### 🔑 Token Management

```mermaid
sequenceDiagram
    participant U as 👤 User
    participant A as ⚛️ App
    participant B as 🖥️ Backend

    U->>A: Login
    A->>B: POST /api/auth/login
    B->>A: JWT tokens
    A->>A: Store in localStorage
    A->>A: Schedule refresh (30s before expiry)

    Note over A: Token expires in 30s...

    A->>B: POST /api/auth/refresh
    B->>A: New JWT tokens
    A->>A: Update localStorage
```

### 🔒 Permission-Based UI

```jsx
const { canAccessFeature } = useAuth();

// 🔐 Conditional rendering based on permissions
if (canAccessFeature('alerts', 'write')) {
  return <AlertRuleForm />;
}

// 🛡️ Protected route wrapper
<ProtectedRoute permission="audio:read">
  <AudioView />
</ProtectedRoute>
```

---

## 🌐 Browser Compatibility

### Desktop Browsers

| Browser | Version | Status |
|:--------|:--------|:------:|
| ![Chrome](https://img.shields.io/badge/-Chrome-4285F4?logo=google-chrome&logoColor=white) | 90+ | ✅ Supported |
| ![Firefox](https://img.shields.io/badge/-Firefox-FF7139?logo=firefox-browser&logoColor=white) | 88+ | ✅ Supported |
| ![Safari](https://img.shields.io/badge/-Safari-000000?logo=safari&logoColor=white) | 14+ | ✅ Supported |
| ![Edge](https://img.shields.io/badge/-Edge-0078D7?logo=microsoft-edge&logoColor=white) | 90+ | ✅ Supported |

### Mobile Browsers

| Browser | Version | Status |
|:--------|:--------|:------:|
| ![iOS Safari](https://img.shields.io/badge/-iOS_Safari-000000?logo=safari&logoColor=white) | 14+ | ✅ Supported |
| ![Chrome Android](https://img.shields.io/badge/-Chrome_Android-4285F4?logo=google-chrome&logoColor=white) | 90+ | ✅ Supported |

---

## 📚 Related Documentation

| Document | Description |
|:---------|:------------|
| 📡 [Backend API Documentation](./07-api.md) | REST API reference |
| 🔌 [Socket.IO API](./socketio/00-overview.md) | Real-time streaming protocol |
| 🚀 [Deployment Guide](./03-deployment.md) | Production deployment |
| ⚙️ [Configuration Reference](./02-configuration.md) | Environment configuration |

---

<div align="center">

**Built with ⚛️ React + ⚡ Vite + 🗺️ Leaflet**

*Real-time aircraft tracking at 60fps*

</div>
